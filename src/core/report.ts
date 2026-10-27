// PipeReport 统一信封（R0.4-4）。v0.3 先接入 export/import（含 dry-run），
// v0.4 由 migrate/lint/diff 复用。Skill / MCP 消费同一套检查规则。

export type IssueSeverity = "blocking" | "warning" | "info";

/**
 * 已知问题的稳定枚举。未知归类用 UNKNOWN + 可选 detail。
 * 与 D6 单点（dsl-rules）共用，避免 export/import/lint 规则漂移。
 */
export type IssueCode =
  | "LOCAL_FILE_DEFAULT"
  | "INVALID_VARIABLE_ID"
  | "PLUGIN_MISSING"
  | "DSL_VERSION_MISMATCH"
  | "NAME_CONFLICT"
  | "DRIFT_CONTENT"
  | "DRIFT_ONLY_IN_BACKUP"
  | "DRIFT_ONLY_ONLINE"
  | "AGENT_ASSETS_OMITTED"
  | "DIFY_IMPORT_WARNING"
  | "AGENT_OVERWRITE_UNSUPPORTED"
  | "NOT_PUBLISHED"
  | "PUBLISH_FAILED"
  | "DUPLICATE_NAME"
  | "UNKNOWN";

export interface RuleIssue {
  severity: IssueSeverity;
  code: IssueCode;
  app?: string;
  file?: string;
  problem: string;
  suggestion: string;
  location?: string;
  detail?: string;
}

export interface PipeReport {
  command: string;
  success: boolean;
  summary: { total: number; blocking: number; warnings: number };
  /** 按命令的计数（如 import: created/skipped/failed/published/publishFailed）。 */
  stats?: Record<string, number>;
  /** 附加元信息（如 migrate 的 workdir）。 */
  meta?: Record<string, string>;
  items: RuleIssue[];
  /** 失败时：沿用 PipeError 信封。 */
  error?: string;
  code?: string;
}

/** 汇总 issues 为 PipeReport。stats/meta 未传时不出现在 JSON 中。 */
export function buildReport(
  command: string,
  items: RuleIssue[],
  success = true,
  stats?: Record<string, number>,
  meta?: Record<string, string>
): PipeReport {
  return {
    command,
    success,
    summary: {
      total: items.length,
      blocking: items.filter((i) => i.severity === "blocking").length,
      warnings: items.filter((i) => i.severity === "warning").length,
    },
    ...(stats !== undefined ? { stats } : {}),
    ...(meta !== undefined ? { meta } : {}),
    items,
  };
}

/** 人类输出需逐条告知的 code（草稿未发布 / Agent 资源缺失 / Dify 导入警告 / Agent 不可覆盖 / 发布失败）。 */
const NOTICE_CODES: ReadonlySet<IssueCode> = new Set<IssueCode>([
  "NOT_PUBLISHED",
  "PUBLISH_FAILED",
  "AGENT_ASSETS_OMITTED",
  "DIFY_IMPORT_WARNING",
  "AGENT_OVERWRITE_UNSUPPORTED",
]);

/** 挑出需逐条展示给用户的条目（import / migrate 非 JSON 输出用）。 */
export function noticeItems(items: RuleIssue[]): RuleIssue[] {
  return items.filter((i) => NOTICE_CODES.has(i.code));
}
