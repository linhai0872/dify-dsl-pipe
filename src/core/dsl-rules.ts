import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { randomUUID } from "node:crypto";
import semver from "semver";
import type { IssueCode, RuleIssue, PipeReport } from "./report.js";

// ---- 共用规则常量（对齐 Dify PR #37022）----
// 真实样本：Start 节点 data.variables[] 里 type=file/file-list 的变量带 default；
// features.file_upload.transfer_methods（复数列表）与 code 节点代码字面量均非清洗目标。
const FILE_VARIABLE_TYPES = new Set(["file", "file-list"]);
const LOCAL_FILE_ID_KEYS = ["upload_file_id", "uploadedId"] as const;
const LOCAL_FILE_TRANSFER_METHODS = new Set(["local_file"]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUUID(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/**
 * 判定一个 file/file-list 变量的 default 是否含 tenant-local 文件引用。
 * 对齐 PR #37022：transfer_method == local_file，或含 upload_file_id/uploadedId。
 * file-list 的 default 是数组——任一项 local 即算（与 sanitizeFileDefault 共用语义，D6 单点）。
 */
function isTenantLocalFileDefault(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(isTenantLocalFileDefault);
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const tm = v.transfer_method ?? v.transferMethod;
  return tm === "local_file" || LOCAL_FILE_ID_KEYS.some((k) => k in v);
}

/**
 * 清洗单个 file default（dict）或 file-list default（array）。
 * 返回 null 表示该 default 应被整体删除；否则返回清洗后的值。
 * - local → null（整体删）
 * - remote → 保留，删 upload_file_id/uploadedId
 * - file-list → 逐项清洗，local 项 drop，空则 null
 */
function sanitizeFileDefault(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (!value.length) return value; // 空 list 无 local 项，原样返回
    const kept = value.map(sanitizeFileDefault).filter((x) => x !== null);
    return kept.length ? kept : null;
  }
  if (!value || typeof value !== "object") return value;
  if (isTenantLocalFileDefault(value)) return null;
  // 非 local（remote_url 等）：仅当残留 id 键时才复制并清除；否则原样返回，避免误标 modified
  const v = value as Record<string, unknown>;
  if (!LOCAL_FILE_ID_KEYS.some((k) => k in v)) return value;
  const copy: Record<string, unknown> = { ...v };
  for (const k of LOCAL_FILE_ID_KEYS) delete copy[k];
  return copy;
}

interface FileVarLoc {
  nodeIndex: number;
  nodeId: string | number | undefined;
  varIndex: number;
  varName: string | undefined;
}

/** 遍历 workflow.graph.nodes[].data.variables[] 中 file/file-list 类型变量。 */
function walkFileVariables(
  workflow: unknown,
  cb: (variable: Record<string, unknown>, loc: FileVarLoc) => void
): void {
  const wf = workflow as Record<string, unknown> | undefined;
  const graph = wf?.graph as { nodes?: unknown[] } | undefined;
  const nodes = graph?.nodes;
  if (!Array.isArray(nodes)) return;
  nodes.forEach((node, ni) => {
    const data = (node as Record<string, unknown>)?.data as
      | { variables?: unknown[] }
      | undefined;
    const vars = data?.variables;
    if (!Array.isArray(vars)) return;
    vars.forEach((variable, vi) => {
      const v = variable as Record<string, unknown>;
      if (v && FILE_VARIABLE_TYPES.has(v.type as string)) {
        cb(v, {
          nodeIndex: ni,
          nodeId: (node as Record<string, unknown>).id as string | number | undefined,
          varIndex: vi,
          varName: v.variable as string | undefined,
        });
      }
    });
  });
}

function locStr(loc: FileVarLoc): string {
  const node = loc.nodeId ?? `#${loc.nodeIndex}`;
  const v = loc.varName ?? `#${loc.varIndex}`;
  return `graph.nodes[${node}].data.variables[${v}]`;
}

// ============ Export 侧：sanitize ============

export interface SanitizeOptions {
  /** 保留 tenant-local file default（同 Instance 完整还原场景）。默认 false。 */
  preserveLocalFiles?: boolean;
}

export interface SanitizeResult {
  dsl: string;
  modified: boolean;
  issues: RuleIssue[];
}

/**
 * Export 侧清洗：去掉 file/file-list 变量 default 中的 tenant-local 文件引用。
 * 默认开启（export.ts 控制）；preserveLocalFiles 时整体跳过。
 * 对齐 PR #37022。返回清洗后的 DSL + info 级 issues（记录被清洗项）。
 */
export function sanitizeExportDSL(
  dsl: string,
  ctx: { app: string; file?: string },
  opts: SanitizeOptions = {}
): SanitizeResult {
  const issues: RuleIssue[] = [];
  if (opts.preserveLocalFiles) return { dsl, modified: false, issues };

  let doc: unknown;
  try {
    doc = parseYaml(dsl);
  } catch {
    // 无法解析则原样返回，不阻断（export 流程继续）
    return { dsl, modified: false, issues };
  }

  const workflow = (doc as Record<string, unknown>)?.workflow;
  if (!workflow || typeof workflow !== "object") return { dsl, modified: false, issues };

  let modified = false;
  walkFileVariables(workflow, (variable, loc) => {
    if (!("default" in variable)) return;
    const cleaned = sanitizeFileDefault(variable.default);
    if (cleaned === null) {
      delete variable.default;
      modified = true;
      issues.push({
        severity: "info",
        code: "LOCAL_FILE_DEFAULT",
        app: ctx.app,
        file: ctx.file,
        problem: `file 变量 ${loc.varName ?? ""} 的 default 引用了 tenant-local 文件，跨 workspace 会导致 Test Run 卡住`,
        suggestion: "已删除该 default（remote_url 类 default 保留）",
        location: locStr(loc),
      });
    } else if (cleaned !== variable.default) {
      variable.default = cleaned;
      modified = true;
      issues.push({
        severity: "info",
        code: "LOCAL_FILE_DEFAULT",
        app: ctx.app,
        file: ctx.file,
        problem: `file 变量 ${loc.varName ?? ""} 的 remote default 含残留 upload_file_id，已防御性清除`,
        suggestion: "保留 remote_url default，仅删 id 键",
        location: locStr(loc),
      });
    }
  });

  if (!modified) return { dsl, modified: false, issues };
  return { dsl: stringifyYaml(doc), modified: true, issues };
}

// ============ Import 侧：preflight + --fix ============

export interface PreflightOptions {
  fix?: boolean;
  /** 目标 Dify 版本（用于 DSL 版本兼容 warning）。 */
  targetDifyVersion?: string;
  app?: string;
  file?: string;
}

export interface PreflightResult {
  issues: RuleIssue[];
  /** fix=true 时返回修复后的 DSL；否则不返回。 */
  fixedDsl?: string;
  modified: boolean;
}

/**
 * Import 侧预检。与 lint 共用同一 core（D6 单点）。
 * - local file default → blocking（fix 删 default）
 * - 非法 conversation/env 变量 id → blocking（fix 换 UUID，变量按 name 引用故安全）
 * - yaml 内插件 dependencies → warning
 * - DSL version vs 目标 Dify → warning
 * 返回 issues；fix=true 时同步返回 fixedDsl。
 */
export function preflightImportDSL(
  dsl: string,
  opts: PreflightOptions = {}
): PreflightResult {
  const issues: RuleIssue[] = [];
  let doc: unknown;
  try {
    doc = parseYaml(dsl);
  } catch {
    return {
      issues: [
        {
          severity: "blocking",
          code: "UNKNOWN",
          app: opts.app,
          file: opts.file,
          problem: "DSL YAML 解析失败",
          suggestion: "检查文件是否为合法 Dify DSL YAML",
        },
      ],
      modified: false,
    };
  }

  const root = doc as Record<string, unknown> | undefined;
  const workflow = root?.workflow as Record<string, unknown> | undefined;
  let modified = false;

  // 1) local file default — 与 export sanitize 共用检测/清洗函数（D6 单点）
  if (workflow) {
    walkFileVariables(workflow, (variable, loc) => {
      if (!("default" in variable)) return;
      if (!isTenantLocalFileDefault(variable.default)) return;
      const issue: RuleIssue = {
        severity: "blocking",
        code: "LOCAL_FILE_DEFAULT",
        app: opts.app,
        file: opts.file,
        problem: `file 变量 ${loc.varName ?? ""} 的 default 引用 tenant-local 文件，跨 workspace 导入会致 Test Run 卡住`,
        suggestion: "删除 local 项后导入（--fix 自动处理；remote 项保留）",
        location: locStr(loc),
      };
      issues.push(issue);
      if (opts.fix) {
        const cleaned = sanitizeFileDefault(variable.default);
        if (cleaned === null) delete variable.default;
        else variable.default = cleaned;
        modified = true;
        // 修复成功 → 降级为 info（"已做"），summary.blocking 只数未修项
        issue.severity = "info";
        issue.problem = `已修复：file 变量 ${loc.varName ?? ""} 的 local 文件 default 已清除（remote 项保留）`;
      }
    });
  }

  // 2) 变量 id 必须为 UUID（issue #37196：非 UUID 导入成功但 run 必挂）
  for (const key of ["conversation_variables", "environment_variables"] as const) {
    const vars = workflow?.[key] as { id?: unknown; name?: string }[] | undefined;
    if (!Array.isArray(vars)) continue;
    vars.forEach((v, i) => {
      if (v && !isUUID(v.id)) {
        const issue: RuleIssue = {
          severity: "blocking",
          code: "INVALID_VARIABLE_ID",
          app: opts.app,
          file: opts.file,
          problem: `${key} 「${v.name ?? `#${i}`}」的 id 不是合法 UUID，导入后运行会失败`,
          suggestion: "重新生成 UUID（--fix 自动处理；变量按 name 引用，换 id 安全）",
          location: `workflow.${key}[${i}]`,
        };
        issues.push(issue);
        if (opts.fix) {
          v.id = randomUUID();
          modified = true;
          issue.severity = "info";
          issue.problem = `已修复：${key} 「${v.name ?? `#${i}`}」的 id 已重新生成为 UUID`;
        }
      }
    });
  }

  // 3) yaml 内插件 dependencies — warning（无法离线判定是否安装）
  const deps = root?.dependencies;
  if (Array.isArray(deps) && deps.length) {
    issues.push({
      severity: "warning",
      code: "PLUGIN_MISSING",
      app: opts.app,
      file: opts.file,
      problem: `DSL 声明了 ${deps.length} 个插件依赖，目标实例若未安装则应用运行失败`,
      suggestion: "导入后将自动 check-dependencies；缺插件时按提示安装或走 grilling",
    });
  }

  // 4) DSL 版本 vs 目标 Dify — warning 启发式（major 不一致）
  const dslVersion = root?.version;
  if (opts.targetDifyVersion && typeof dslVersion === "string") {
    const dslMaj = semver.coerce(dslVersion)?.major;
    const tgtMaj = semver.coerce(opts.targetDifyVersion)?.major;
    if (dslMaj != null && tgtMaj != null && dslMaj !== tgtMaj) {
      issues.push({
        severity: "warning",
        code: "DSL_VERSION_MISMATCH",
        app: opts.app,
        file: opts.file,
        problem: `DSL schema version ${dslVersion} 与目标 Dify ${opts.targetDifyVersion} 主版本不一致，跨版本可能 schema 不兼容`,
        suggestion: "导入后 dry-run / 验 run 确认；必要时 --target-dify-version 指定对齐",
      });
    }
  }

  return {
    issues,
    fixedDsl: opts.fix && modified ? stringifyYaml(doc) : undefined,
    modified,
  };
}

/** 汇总 issues 为 PipeReport。 */
export function buildReport(
  command: string,
  items: RuleIssue[],
  success = true
): PipeReport {
  return {
    command,
    success,
    summary: {
      total: items.length,
      blocking: items.filter((i) => i.severity === "blocking").length,
      warnings: items.filter((i) => i.severity === "warning").length,
    },
    items,
  };
}
