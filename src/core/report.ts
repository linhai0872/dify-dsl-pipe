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
  items: RuleIssue[];
  /** 失败时：沿用 PipeError 信封。 */
  error?: string;
  code?: string;
}
