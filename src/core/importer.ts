import { parse as parseYaml } from "yaml";
import type { DifyClient } from "./client.js";
import type { StorageBackend } from "../storage/interface.js";
import type { ImportResult, ImportItem, DifyApp } from "./types.js";
import type { RuleIssue } from "./report.js";
import type { ImportOptions } from "../config/types.js";
import { preflightImportDSL } from "./dsl-rules.js";
import { listDslFiles } from "./source.js";
import { log } from "../utils/logger.js";

export const DEFAULT_SOURCE = "./dify-backup";

/**
 * 决定传给 importApps 的 list 前缀。
 * 关键在于 source 此刻代表"storage 根目录"还是"根目录下的子前缀"：
 * - local 且 storage 由 --source 即时构建（fromConfig=false）：source 已是 storage 根，
 *   再当前缀会重复拼接，返回 undefined。
 * - 其余情况（s3/git，或 storage 来自 config）：source 是根之下的 list 前缀
 *   （s3 object key / 子目录），非默认值时保留。
 */
export function resolveImportPrefix(args: {
  storageType: string;
  source: string;
  fromConfig: boolean;
  defaultSource?: string;
}): string | undefined {
  const { storageType, source, fromConfig, defaultSource = DEFAULT_SOURCE } = args;
  if (storageType === "local" && !fromConfig) return undefined;
  return source !== defaultSource ? source : undefined;
}

export async function importApps(
  client: DifyClient,
  storage: StorageBackend,
  opts: ImportOptions & { source?: string }
): Promise<ImportResult> {
  const start = Date.now();
  const created: { name: string; appId: string }[] = [];
  const skipped: { name: string; reason: string }[] = [];
  const overwritten: { name: string; appId: string }[] = [];
  const failed: { name: string; error: string }[] = [];
  const published: { name: string; appId: string }[] = [];
  const publishFailed: { name: string; error: string }[] = [];
  const issues: RuleIssue[] = [];

  // 收集要导入的文件
  const prefix = opts.source ?? "";
  const ymlFiles = await listDslFiles(storage, prefix);

  if (!ymlFiles.length) {
    log.warn("未找到任何 DSL 文件");
    return { created, skipped, overwritten, failed, published, publishFailed, issues, duration: Date.now() - start };
  }

  log.info(`找到 ${ymlFiles.length} 个 DSL 文件`);

  // 获取目标实例现有应用（用于冲突检测）
  const existingApps = await client.getAllApps();
  const existingByName = new Map<string, DifyApp>();
  for (const app of existingApps) {
    existingByName.set(app.name.toLowerCase(), app);
  }

  // 解析、预检、规划导入
  const items: ImportItem[] = [];
  for (const file of ymlFiles) {
    try {
      const content = await storage.read(file);
      const name = extractAppName(content) ?? fileToAppName(file);
      const existing = existingByName.get(name.toLowerCase());

      let action: "create" | "skip" | "overwrite";
      let reason: string | undefined;

      if (existing) {
        // Dify 1.18 拒绝覆盖已有 Agent 应用（HTTP 400 "only supports creating a new Agent App"）
        const isAgent = existing.mode === "agent" || extractAppMode(content) === "agent";
        if (opts.onConflict === "overwrite" && isAgent) {
          action = "skip";
          reason = "Dify 不支持覆盖 Agent 应用";
          issues.push({
            severity: "warning",
            code: "AGENT_OVERWRITE_UNSUPPORTED",
            app: name,
            file,
            problem: `同名 Agent 应用已存在（${existing.id.slice(0, 8)}），Dify 不支持覆盖 Agent 应用，已跳过`,
            suggestion: "在 Dify 中删除或改名旧应用后重新导入",
          });
        } else if (opts.onConflict === "overwrite") {
          action = "overwrite";
        } else {
          action = "skip";
          reason = `同名应用已存在 (ID: ${existing.id.slice(0, 8)})`;
          issues.push({
            severity: "info",
            code: "NAME_CONFLICT",
            app: name,
            file,
            problem: `同名应用已存在（${existing.id.slice(0, 8)}）`,
            suggestion: "skip 跳过；需覆盖用 --on-conflict overwrite",
          });
        }
      } else {
        action = "create";
      }

      // 预检（与 lint 共用 core，D6 单点）
      const pre = preflightImportDSL(content, {
        app: name,
        file,
        fix: !!opts.fix,
        targetDifyVersion: opts.targetDifyVersion,
      });
      // 非 dry-run 时，preflight 的声明级 PLUGIN_MISSING 让位给导入后的 check-dependencies
      // （确认级），避免同 app 重复报同 code；dry-run 不跑 check-dep，保留 preflight 的提示
      const preIssues = opts.dryRun
        ? pre.issues
        : pre.issues.filter((i) => i.code !== "PLUGIN_MISSING");
      issues.push(...preIssues);

      let dslContent = content;
      // 仍有 blocking 就阻断：--fix 能修的已降级 info，剩下的 blocking 是修不了的
      // （如 YAML 解析失败），不能拿坏 DSL 去真实 import
      const blocking = pre.issues.some((i) => i.severity === "blocking");
      if (blocking) {
        failed.push({ name, error: "预检阻断（blocking），加 --fix 自动修复或手动处理后重试" });
        continue;
      }
      if (pre.fixedDsl) dslContent = pre.fixedDsl;

      items.push({ name, filePath: file, dslContent, action, reason });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failed.push({ name: file, error: msg.slice(0, 200) });
    }
  }

  // dry-run: 只输出计划 + 预检
  if (opts.dryRun) {
    for (const item of items) {
      if (item.action === "create") created.push({ name: item.name, appId: "(dry-run)" });
      else if (item.action === "skip") skipped.push({ name: item.name, reason: item.reason ?? "" });
      else if (item.action === "overwrite") overwritten.push({ name: item.name, appId: "(dry-run)" });
    }
    return { created, skipped, overwritten, failed, published, publishFailed, issues, duration: Date.now() - start };
  }

  // 执行导入
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    log.progress(i + 1, items.length, `${item.name} (${item.action})`);

    if (item.action === "skip") {
      skipped.push({ name: item.name, reason: item.reason ?? "" });
      continue;
    }

    try {
      const importOpts: { name?: string; appId?: string } = {};
      if (item.action === "overwrite") {
        const existing = existingByName.get(item.name.toLowerCase());
        if (existing) importOpts.appId = existing.id;
      }
      importOpts.name = item.name;

      const result = await client.importAppDSL(item.dslContent, importOpts);

      if (item.action === "overwrite") {
        overwritten.push({ name: item.name, appId: result.appId });
      } else {
        created.push({ name: item.name, appId: result.appId });
      }

      // Dify 1.18 导入 warnings → DIFY_IMPORT_WARNING
      for (const w of result.warnings ?? []) {
        issues.push({
          severity: "warning",
          code: "DIFY_IMPORT_WARNING",
          app: item.name,
          file: item.filePath,
          problem: w.message,
          suggestion: "按 Dify 提示补齐缺失依赖或配置后重新运行",
          location: w.path,
          detail: JSON.stringify(w),
        });
      }

      // 导入成功后 check-dependencies（按 appId，不是 importId；H2）
      try {
        const dep = await client.checkImportDependencies(result.appId);
        if (dep.leaked.length) {
          issues.push({
            severity: "warning",
            code: "PLUGIN_MISSING",
            app: item.name,
            file: item.filePath,
            problem: `目标实例缺少 ${dep.leaked.length} 个插件依赖`,
            suggestion: "按提示安装对应插件后重新运行应用；或走 grilling 确认插件来源",
            detail: JSON.stringify(dep.leaked),
          });
        }
      } catch {
        // check-dependencies 不可用（老版本）→ 静默跳过
      }

      // 发布（仅 workflow / advanced-chat）
      const mode = extractAppMode(item.dslContent);
      if (mode === "workflow" || mode === "advanced-chat") {
        if (opts.publish) {
          try {
            await client.publishWorkflow(result.appId);
            published.push({ name: item.name, appId: result.appId });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            publishFailed.push({ name: item.name, error: msg.slice(0, 200) });
            issues.push({
              severity: "warning",
              code: "PUBLISH_FAILED",
              app: item.name,
              file: item.filePath,
              problem: `发布失败：${msg.slice(0, 150)}`,
              suggestion: "在 Dify 中手动发布，或修复问题后重试 --publish",
            });
          }
        } else {
          issues.push({
            severity: "info",
            code: "NOT_PUBLISHED",
            app: item.name,
            file: item.filePath,
            problem:
              item.action === "overwrite"
                ? "草稿已替换，线上仍运行旧发布版本"
                : "已导入为草稿，发布前 Service API / Web App 不可用",
            suggestion: "加 --publish 自动发布，或在 Dify 中手动发布",
          });
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failed.push({ name: item.name, error: msg.slice(0, 200) });
      log.warn(`导入失败 ${item.name}: ${msg.slice(0, 100)}`);
    }
  }

  return { created, skipped, overwritten, failed, published, publishFailed, issues, duration: Date.now() - start };
}

function extractAppName(dslContent: string): string | null {
  try {
    const parsed = parseYaml(dslContent);
    return parsed?.app?.name ?? null;
  } catch {
    return null;
  }
}

function extractAppMode(dslContent: string): string | null {
  try {
    const parsed = parseYaml(dslContent);
    const mode = parsed?.app?.mode;
    return typeof mode === "string" ? mode : null;
  } catch {
    return null;
  }
}

function fileToAppName(filePath: string): string {
  const filename = filePath.split("/").pop() ?? filePath;
  return filename.replace(/\.ya?ml$/, "").replace(/_\d{8}$/, "").replace(/_current$/, "");
}
