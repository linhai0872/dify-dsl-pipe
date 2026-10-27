import { parse as parseYaml } from "yaml";
import type { Config } from "../config/types.js";
import type { StorageBackend } from "../storage/interface.js";
import type { DifyApp } from "./types.js";
import type { RuleIssue, PipeReport } from "./report.js";
import { buildReport } from "./report.js";
import { PipeError } from "./errors.js";
import { connectProfile } from "./runner.js";
import { listDslFiles, resolveSourceStorage, parseFilterExpr } from "./source.js";
import { createStorage } from "../storage/factory.js";
import { sanitizeExportDSL } from "./dsl-rules.js";
import { projectDSL } from "./dsl-projection.js";
import { resolveImportPrefix, DEFAULT_SOURCE } from "./importer.js";
import { log } from "../utils/logger.js";

export interface DiffStorageFlags {
  storage?: string;
  s3Bucket?: string;
  s3Endpoint?: string;
  s3Region?: string;
  s3AccessKey?: string;
  s3SecretKey?: string;
  s3ForcePathStyle?: boolean;
  gitRepo?: string;
  gitBranch?: string;
}

export interface DiffOptions {
  /** 已加载的 Config（MCP 进程内调用时传入）。 */
  config: Config;
  /** 在线模式：profile 名。 */
  profile?: string;
  /** 离线模式：作为基准的本地目录（与 source 侧互比，不连 Dify）。 */
  baseline?: string;
  /** 备份侧源目录或前缀，默认 ./dify-backup。 */
  source?: string;
  storage?: DiffStorageFlags;
  filter?: string;
  check?: boolean;
  showChunks?: boolean;
  full?: boolean;
  /** 测试注入：替换 connectProfile。 */
  connect?: typeof connectProfile;
}

interface SideEntry {
  name: string;
  file?: string;
  dsl: string;
  mode?: string;
}

interface DiffChunk {
  path: string;
  backup: string;
  online: string;
}

/** 深比较，按路径列出所有差异（键序无关）。path 用 a.b[0] 形式。 */
function diffValues(a: unknown, b: unknown, path: string, out: DiffChunk[]): void {
  if (a === b) return;
  if (typeof a !== typeof b || a === null || b === null ||
      typeof a !== "object" || Array.isArray(a) !== Array.isArray(b)) {
    out.push({ path: path || "$", backup: stringifyShort(a), online: stringifyShort(b) });
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      diffValues(a[i], b[i], `${path}[${i}]`, out);
    }
    return;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) {
    diffValues(ao[k], bo[k], path ? `${path}.${k}` : k, out);
  }
}

function stringifyShort(v: unknown): string {
  if (v === undefined) return "undefined";
  const s = typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v) ?? String(v);
  return s.length > 200 ? s.slice(0, 200) + "…" : s;
}

/** 提取应用名：app.name，缺则文件名（同 importer）。 */
function extractName(dsl: string, file: string): string {
  try {
    const doc = parseYaml(dsl);
    const name = (doc as Record<string, unknown> | undefined)?.app as Record<string, unknown> | undefined;
    if (typeof name?.name === "string" && name.name) return name.name;
  } catch {
    // fall through
  }
  const filename = file.split("/").pop() ?? file;
  return filename.replace(/\.ya?ml$/, "").replace(/_\d{8}$/, "").replace(/_current$/, "");
}

function extractMode(dsl: string): string | undefined {
  try {
    const doc = parseYaml(dsl);
    const mode = (doc as Record<string, unknown> | undefined)?.app as Record<string, unknown> | undefined;
    return typeof mode?.mode === "string" ? mode.mode : undefined;
  } catch {
    return undefined;
  }
}

function extractVersion(dsl: string): string | undefined {
  try {
    const doc = parseYaml(dsl);
    const v = (doc as Record<string, unknown> | undefined)?.version;
    return typeof v === "string" ? v : undefined;
  } catch {
    return undefined;
  }
}

/** 备份侧（或 baseline 侧）从存储读 DSL 列表；不可读文件记为 blocking（比较不完整）。 */
async function loadSideFromStorage(
  storage: StorageBackend,
  prefix: string | undefined,
  issues: RuleIssue[]
): Promise<SideEntry[]> {
  const files = await listDslFiles(storage, prefix);
  const out: SideEntry[] = [];
  for (const file of files) {
    try {
      const dsl = await storage.read(file);
      out.push({ name: extractName(dsl, file), file, dsl, mode: extractMode(dsl) });
    } catch (e) {
      issues.push({
        severity: "blocking",
        code: "UNKNOWN",
        file,
        problem: `文件不可读，未参与比较：${e instanceof Error ? e.message : String(e)}`,
        suggestion: "检查文件权限或存储连接后重试 diff",
      });
    }
  }
  return out;
}

/** 在线侧：getAllApps + exportAppDSL，不落盘。 */
async function loadSideOnline(
  client: { getAllApps: (f?: { names?: string[]; types?: string[] }) => Promise<DifyApp[]>; exportAppDSL: (id: string, secret: boolean) => Promise<string> },
  filter?: { names?: string[]; types?: string[] }
): Promise<SideEntry[]> {
  const apps = await client.getAllApps(
    filter && (filter.names?.length || filter.types?.length)
      ? { names: filter.names, types: filter.types }
      : undefined
  );
  const out: SideEntry[] = [];
  for (const app of apps) {
    const dsl = await client.exportAppDSL(app.id, false);
    out.push({ name: app.name, dsl, mode: app.mode });
  }
  return out;
}

function applyNameTypeFilter(entries: SideEntry[], filter?: { names?: string[]; types?: string[] }): SideEntry[] {
  if (!filter) return entries;
  let out = entries;
  if (filter.types?.length) {
    out = out.filter((e) => e.mode !== undefined && filter.types!.includes(e.mode));
  }
  if (filter.names?.length) {
    const lowers = filter.names.map((n) => n.toLowerCase());
    out = out.filter((e) => lowers.some((n) => e.name.toLowerCase().includes(n)));
  }
  return out;
}

/** 同一侧按小写 name 分组；重名项报 DUPLICATE_NAME，重名 key 记入 dupKeys（调用方从两侧一并排除）。 */
function dedupeSide(
  entries: SideEntry[],
  sideLabel: string,
  issues: RuleIssue[],
  dupKeys: Set<string>
): Map<string, SideEntry> {
  const byName = new Map<string, SideEntry[]>();
  for (const e of entries) {
    const key = e.name.toLowerCase();
    const arr = byName.get(key) ?? [];
    arr.push(e);
    byName.set(key, arr);
  }
  const ok = new Map<string, SideEntry>();
  for (const [key, arr] of byName) {
    if (arr.length > 1) {
      dupKeys.add(key);
      for (const e of arr) {
        issues.push({
          severity: "warning",
          code: "DUPLICATE_NAME",
          app: e.name,
          file: e.file,
          problem: `${sideLabel}存在 ${arr.length} 个同名应用「${e.name}」（大小写不敏感），无法确定配对`,
          suggestion: "重命名或删除多余应用后重试 diff",
        });
      }
      continue;
    }
    ok.set(key, arr[0]);
  }
  return ok;
}

/**
 * diff 主流程：备份 ↔ 线上，或两份本地目录互比。
 * - 默认语义投影比较；--full 整文档比较。
 * - report-only：不写任何存储。
 */
export async function runDiff(opts: DiffOptions): Promise<PipeReport> {
  const { config } = opts;
  if (!opts.profile && !opts.baseline) {
    throw new PipeError("ERR_CONFIG_INVALID", "diff 需要 --profile（比线上）或 --baseline（两份备份互比）之一");
  }
  if (opts.profile && opts.baseline) {
    throw new PipeError("ERR_CONFIG_INVALID", "--profile 与 --baseline 互斥，只能选其一");
  }

  const filter = parseFilterExpr(opts.filter);
  if (filter?.tags?.length) {
    throw new PipeError(
      "ERR_CONFIG_INVALID",
      "diff 不支持按标签过滤：备份 DSL 无标签信息，会造成假漂移"
    );
  }

  const connect = opts.connect ?? connectProfile;

  // --- 备份侧（source 指定的存储） ---
  const { storage: sourceCfg, fromConfig } = resolveSourceStorage(
    {
      storage: opts.storage?.storage,
      source: opts.source ?? DEFAULT_SOURCE,
      s3Bucket: opts.storage?.s3Bucket,
      s3Endpoint: opts.storage?.s3Endpoint,
      s3Region: opts.storage?.s3Region,
      s3AccessKey: opts.storage?.s3AccessKey,
      s3SecretKey: opts.storage?.s3SecretKey,
      s3ForcePathStyle: opts.storage?.s3ForcePathStyle,
      gitRepo: opts.storage?.gitRepo,
      gitBranch: opts.storage?.gitBranch,
    },
    config
  );
  const sourceStorage = createStorage(sourceCfg);
  if (!(await sourceStorage.testConnection())) {
    throw new PipeError("ERR_STORAGE_CONNECT_FAILED", "备份源存储连接失败");
  }
  const sourcePrefix = resolveImportPrefix({
    storageType: sourceCfg.type,
    source: opts.source ?? DEFAULT_SOURCE,
    fromConfig,
  });
  const issues: RuleIssue[] = [];
  const backupEntries = await loadSideFromStorage(sourceStorage, sourcePrefix, issues);
  log.info(`备份侧：${backupEntries.length} 个应用`);

  // --- 对侧 ---
  let onlineEntries: SideEntry[];
  const sideLabel = opts.profile ? "线上" : "baseline";
  if (opts.profile) {
    const { client } = await connect(config, opts.profile);
    onlineEntries = await loadSideOnline(client, filter);
    log.info(`线上侧：${onlineEntries.length} 个应用`);
  } else {
    // baseline：本地目录直接建 LocalStorage，不经 resolveSourceStorage（离线、无网络）
    const baselineStorage = createStorage({ type: "local", path: opts.baseline! });
    if (!(await baselineStorage.testConnection())) {
      throw new PipeError("ERR_STORAGE_CONNECT_FAILED", `baseline 目录不可读: ${opts.baseline}`);
    }
    onlineEntries = await loadSideFromStorage(baselineStorage, undefined, issues);
    log.info(`baseline 侧：${onlineEntries.length} 个应用`);
  }

  // name/type filter 同时作用于两侧（在线侧已在 list 时过滤一次；此处对两侧统一兜底，保证 baseline 侧也被过滤）
  const filteredBackup = applyNameTypeFilter(backupEntries, filter);
  const filteredOnline = applyNameTypeFilter(onlineEntries, filter);

  // 任一侧重名的名字，两侧都不参与比较（否则另一侧的同名项会被误报为单侧独有）
  const dupKeys = new Set<string>();
  const backupMap = dedupeSide(filteredBackup, "备份侧", issues, dupKeys);
  const onlineMap = dedupeSide(filteredOnline, sideLabel + "侧", issues, dupKeys);
  for (const k of dupKeys) {
    backupMap.delete(k);
    onlineMap.delete(k);
  }

  const items: RuleIssue[] = [];
  const stats = { onlyInBackup: 0, onlyOnline: 0, changed: 0, same: 0 };

  // 只在线上：按 name 排序，保证输出稳定
  const onlyOnline = [...onlineMap.keys()].filter((k) => !backupMap.has(k)).sort();
  for (const k of onlyOnline) {
    const e = onlineMap.get(k)!;
    stats.onlyOnline++;
    items.push({
      severity: "info",
      code: "DRIFT_ONLY_ONLINE",
      app: e.name,
      problem: `应用「${e.name}」仅存在于${sideLabel}`,
      suggestion: "如属预期可忽略；如需纳入备份，先 export",
    });
  }

  // 只在备份
  const onlyBackup = [...backupMap.keys()].filter((k) => !onlineMap.has(k)).sort();
  for (const k of onlyBackup) {
    const e = backupMap.get(k)!;
    stats.onlyInBackup++;
    items.push({
      severity: "info",
      code: "DRIFT_ONLY_IN_BACKUP",
      app: e.name,
      file: e.file,
      problem: `应用「${e.name}」仅存在于备份`,
      suggestion: "如属预期可忽略；如需恢复，用 import 导入",
    });
  }

  // 两边都有：深比较
  const common = [...backupMap.keys()].filter((k) => onlineMap.has(k)).sort();
  for (const k of common) {
    const b = backupMap.get(k)!;
    const o = onlineMap.get(k)!;

    let bDoc: unknown;
    let oDoc: unknown;
    try {
      bDoc = parseYaml(b.dsl);
      oDoc = parseYaml(o.dsl);
    } catch (e) {
      issues.push({
        severity: "blocking",
        code: "UNKNOWN",
        app: b.name,
        file: b.file,
        problem: `DSL 解析失败，未完成比较：${e instanceof Error ? e.message : String(e)}`,
        suggestion: "检查备份 DSL 是否为合法 YAML",
      });
      continue;
    }

    // version 不一致 → warning（独立于内容比较结果）
    const bv = extractVersion(b.dsl);
    const ov = extractVersion(o.dsl);
    if (bv !== undefined && ov !== undefined && bv !== ov) {
      issues.push({
        severity: "warning",
        code: "DSL_VERSION_MISMATCH",
        app: b.name,
        file: b.file,
        problem: `DSL schema 版本不一致（备份 ${bv} / ${sideLabel} ${ov}），语义投影可能失真`,
        suggestion: "用 --full 复核完整差异，或人工确认 schema 兼容性",
      });
    }

    if (!opts.full) {
      // 语义投影：先 sanitize（去 local 文件 default），再投影
      const bSan = sanitizeExportDSL(b.dsl, { app: b.name, file: b.file });
      const oSan = sanitizeExportDSL(o.dsl, { app: o.name, file: o.file });
      try {
        bDoc = projectDSL(parseYaml(bSan.dsl));
        oDoc = projectDSL(parseYaml(oSan.dsl));
      } catch (e) {
        issues.push({
          severity: "blocking",
          code: "UNKNOWN",
          app: b.name,
          file: b.file,
          problem: `sanitize 后 DSL 解析失败，未完成比较：${e instanceof Error ? e.message : String(e)}`,
          suggestion: "检查 DSL 内容",
        });
        continue;
      }
    }

    const chunks: DiffChunk[] = [];
    diffValues(bDoc, oDoc, "", chunks);
    if (!chunks.length) {
      stats.same++;
      continue;
    }
    stats.changed++;
    const location = chunks.slice(0, 5).map((c) => c.path).join(", ");
    items.push({
      severity: "info",
      code: "DRIFT_CONTENT",
      app: b.name,
      file: b.file,
      problem: `应用「${b.name}」内容有 ${chunks.length} 处差异`,
      suggestion: "如需对齐，用 import 从备份恢复，或在 Dify 中手动修改",
      location,
      ...(opts.showChunks
        ? { detail: JSON.stringify(chunks.slice(0, 20)) }
        : {}),
    });
  }

  // 输出顺序：ONLY_ONLINE → ONLY_IN_BACKUP → CONTENT → warnings
  const allItems = [...items, ...issues];
  const anyDrift = stats.onlyInBackup + stats.onlyOnline + stats.changed > 0;
  // 读/解析失败（blocking）= 比较不完整，按"错误 → 1"处理，不能当作无漂移
  const compareFailed = issues.some((i) => i.severity === "blocking");
  const success = !compareFailed && !(opts.check && anyDrift);
  return buildReport("diff", allItems, success, { ...stats });
}
