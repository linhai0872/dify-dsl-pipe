import { parse as parseYaml } from "yaml";
import type { DifyClient } from "./client.js";
import type { StorageBackend } from "../storage/interface.js";
import type { ImportResult, ImportItem, DifyApp } from "./types.js";
import type { ImportOptions } from "../config/types.js";
import { log, formatDuration } from "../utils/logger.js";

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

  // 收集要导入的文件
  const prefix = opts.source ?? "";
  const files = await storage.list(prefix);
  const ymlFiles = files.filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));

  if (!ymlFiles.length) {
    log.warn("未找到任何 DSL 文件");
    return { created, skipped, overwritten, failed, duration: Date.now() - start };
  }

  log.info(`找到 ${ymlFiles.length} 个 DSL 文件`);

  // 获取目标实例现有应用（用于冲突检测）
  const existingApps = await client.getAllApps();
  const existingByName = new Map<string, DifyApp>();
  for (const app of existingApps) {
    existingByName.set(app.name.toLowerCase(), app);
  }

  // 解析和规划导入
  const items: ImportItem[] = [];
  for (const file of ymlFiles) {
    // 跳过版本历史文件
    if (file.includes("_versions/")) continue;
    // 跳过状态文件
    if (file.endsWith(".json")) continue;

    try {
      const content = await storage.read(file);
      const name = extractAppName(content) ?? fileToAppName(file);
      const existing = existingByName.get(name.toLowerCase());

      let action: "create" | "skip" | "overwrite";
      let reason: string | undefined;

      if (existing) {
        if (opts.onConflict === "overwrite") {
          action = "overwrite";
        } else {
          action = "skip";
          reason = `同名应用已存在 (ID: ${existing.id.slice(0, 8)})`;
        }
      } else {
        action = "create";
      }

      items.push({ name, filePath: file, dslContent: content, action, reason });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failed.push({ name: file, error: msg.slice(0, 200) });
    }
  }

  // dry-run: 只输出计划
  if (opts.dryRun) {
    for (const item of items) {
      if (item.action === "create") created.push({ name: item.name, appId: "(dry-run)" });
      else if (item.action === "skip") skipped.push({ name: item.name, reason: item.reason ?? "" });
      else if (item.action === "overwrite") overwritten.push({ name: item.name, appId: "(dry-run)" });
    }
    return { created, skipped, overwritten, failed, duration: Date.now() - start };
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
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failed.push({ name: item.name, error: msg.slice(0, 200) });
      log.warn(`导入失败 ${item.name}: ${msg.slice(0, 100)}`);
    }
  }

  return { created, skipped, overwritten, failed, duration: Date.now() - start };
}

function extractAppName(dslContent: string): string | null {
  try {
    const parsed = parseYaml(dslContent);
    return parsed?.app?.name ?? null;
  } catch {
    return null;
  }
}

function fileToAppName(filePath: string): string {
  const filename = filePath.split("/").pop() ?? filePath;
  return filename.replace(/\.ya?ml$/, "").replace(/_\d{8}$/, "").replace(/_current$/, "");
}
