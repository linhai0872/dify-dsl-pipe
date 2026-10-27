import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { DifyClient } from "./client.js";
import type { Config } from "../config/types.js";
import type { RuleIssue, PipeReport } from "./report.js";
import { buildReport } from "./report.js";
import { PipeError } from "./errors.js";
import { connectProfile } from "./runner.js";
import { exportApps } from "./exporter.js";
import { importApps } from "./importer.js";
import { parseFilterExpr } from "./source.js";
import { LocalStorage } from "../storage/local.js";
import { log } from "../utils/logger.js";

export interface MigrateOptions {
  /** 已加载的配置（MCP / CLI 共用）。CLI 用 loadConfig(-c) 构造。 */
  config: Config;
  /** 源 profile 名；与 source 二选一。 */
  from?: string;
  /** 目标 profile 名（必填）。 */
  to: string;
  /** 本地 DSL 目录；与 from 二选一，跳过导出。 */
  source?: string;
  /** 无 --yes → 预演（dry-run），不发任何导入请求。 */
  yes?: boolean;
  /** workdir 用系统临时目录；全部成功后删除，失败保留。 */
  ephemeral?: boolean;
  onConflict?: "skip" | "overwrite";
  fix?: boolean;
  publish?: boolean;
  /** 过滤表达式（type:/tag:/name:，逗号分隔）。 */
  filter?: string;
  /** 依赖注入：测试用 fake connect；默认 connectProfile。 */
  connect?: (config: Config, name: string) => Promise<{ client: DifyClient; name: string }>;
  /** 覆盖默认 workdir 根（测试用：避开 cwd 下 .dify-pipe-migrate/）。 */
  workdirBase?: string;
}

function timestampDirName(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

/** 独占创建时间戳 workdir：同秒已存在则加 -2、-3… 后缀，绝不复用其他任务的目录。 */
function createExclusiveWorkdir(base: string): string {
  mkdirSync(base, { recursive: true });
  const stamp = timestampDirName();
  for (let i = 1; ; i++) {
    const dir = join(base, i === 1 ? stamp : `${stamp}-${i}`);
    try {
      mkdirSync(dir);
      return dir;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
}

/**
 * migrate 主流程：
 *   连接 to →（--from 时）连接 from 并导出到 workdir → 对 workdir 跑 import
 *   （无 --yes 时 dry-run）→ 汇总 PipeReport。
 *
 * 校验在任何连接之前完成：from===to / from 与 source 缺一或同时给 → ERR_CONFIG_INVALID。
 */
export async function runMigrate(opts: MigrateOptions): Promise<PipeReport> {
  // ── 前置校验（不连任何实例） ──────────────────────────────
  if (opts.from && opts.source) {
    throw new PipeError(
      "ERR_CONFIG_INVALID",
      "--from 与 --source 只能选一个"
    );
  }
  if (!opts.from && !opts.source) {
    throw new PipeError(
      "ERR_CONFIG_INVALID",
      "必须指定 --from <profile> 或 --source <localDir> 之一"
    );
  }
  if (opts.from && opts.from === opts.to) {
    throw new PipeError(
      "ERR_CONFIG_INVALID",
      `源与目标不能是同一个 profile（"${opts.from}"）`
    );
  }

  const connect = opts.connect ?? connectProfile;

  // ── 连接目标（必须先连 to，from 校验完成后才连 from） ────
  const { client: toClient } = await connect(opts.config, opts.to);

  // ── workdir / 源存储 ────────────────────────────────────
  let workdir: string | undefined;
  let ephemeralDir: string | undefined;
  let storage: LocalStorage;

  if (opts.source) {
    storage = new LocalStorage({ path: opts.source });
  } else {
    if (opts.ephemeral) {
      ephemeralDir = mkdtempSync(join(tmpdir(), "dify-pipe-migrate-"));
      workdir = ephemeralDir;
    } else {
      workdir = createExclusiveWorkdir(resolve(opts.workdirBase ?? ".dify-pipe-migrate"));
    }
    storage = new LocalStorage({ path: workdir });
    log.info(`工作目录：${workdir}`);
  }

  // ── 导出（仅 --from） ───────────────────────────────────
  const issues: RuleIssue[] = [];
  let exported = 0;
  let exportFailed = 0;

  if (opts.from) {
    const { client: fromClient, name: fromName } = await connect(opts.config, opts.from);
    log.info(`从 ${fromName} 导出到 ${workdir}`);

    const filter = parseFilterExpr(opts.filter);
    const exp = await exportApps(fromClient, storage, {
      sanitize: true,
      preserveLocalFiles: false,
      keepOriginal: false,
      includeVersionHistory: false,
      includeSecret: false,
      incremental: false,
      archive: "none",
      pattern: "by-type",
      filter,
      instanceName: fromName,
    });

    exported = exp.success.length;
    exportFailed = exp.failed.length;

    for (const s of exp.success) {
      if (s.issues?.length) issues.push(...s.issues);
    }
    for (const f of exp.failed) {
      issues.push({
        severity: "warning",
        code: "UNKNOWN",
        app: f.app.name,
        problem: `导出失败：${f.error}`,
        suggestion: "检查源实例连通性或该应用是否可导出后重试",
      });
    }
  }

  // ── 导入（dry-run 或真实） ──────────────────────────────
  const targetVersion = toClient.getInfo().version;
  const imp = await importApps(toClient, storage, {
    dryRun: !opts.yes,
    onConflict: opts.onConflict ?? "skip",
    fix: opts.fix ?? false,
    publish: opts.publish ?? false,
    targetDifyVersion: targetVersion,
  });

  issues.push(...imp.issues);

  // ── 汇总 ────────────────────────────────────────────────
  const blocking = issues.filter((i) => i.severity === "blocking").length;
  const success =
    exportFailed === 0 &&
    imp.failed.length === 0 &&
    imp.publishFailed.length === 0 &&
    blocking === 0;

  const report = buildReport(
    "migrate",
    issues,
    success,
    {
      exported,
      exportFailed,
      created: imp.created.length,
      skipped: imp.skipped.length,
      overwritten: imp.overwritten.length,
      failed: imp.failed.length,
      published: imp.published.length,
      publishFailed: imp.publishFailed.length,
    },
    workdir ? { workdir } : undefined
  );

  // ── ephemeral 清理：全部成功才删，失败保留供排查 ────────
  if (ephemeralDir && success) {
    try {
      rmSync(ephemeralDir, { recursive: true, force: true });
      log.debug(`已删除临时目录 ${ephemeralDir}`);
    } catch {
      log.warn(`临时目录清理失败：${ephemeralDir}`);
    }
  }

  return report;
}
