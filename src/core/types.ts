import type { RuleIssue } from "./report.js";

export interface DifyApp {
  id: string;
  name: string;
  mode: AppMode;
  description: string;
  icon: string;
  icon_type?: string;
  icon_background?: string;
  tags?: DifyTag[];
  created_at: string | number;
  updated_at: string | number;
}

export type AppMode =
  | "chat"
  | "agent-chat"
  | "completion"
  | "workflow"
  | "advanced-chat";

export interface DifyTag {
  id: string;
  name: string;
  type: string;
}

export interface DifyWorkspace {
  id: string;
  name: string;
  role: string;
  status: string;
}

export interface WorkflowVersion {
  id: string;
  version?: string;
  marked_name?: string;
  marked_comment?: string;
  created_at: string | number;
  updated_at?: string | number;
  created_by?: { name?: string };
}

export interface ExportedApp {
  app: DifyApp;
  dslContent: string;
  filePath: string;
  versions?: ExportedVersion[];
  /** export sanitize 产出的 info 级 issue（被清洗项）。 */
  issues?: RuleIssue[];
}

export interface ExportedVersion {
  version: WorkflowVersion;
  dslContent: string;
  filePath: string;
}

export interface ExportResult {
  success: ExportedApp[];
  failed: { app: DifyApp; error: string }[];
  totalApps: number;
  duration: number;
}

export interface ImportItem {
  name: string;
  filePath: string;
  dslContent: string;
  action: "create" | "skip" | "overwrite";
  reason?: string;
}

export interface ImportResult {
  created: { name: string; appId: string }[];
  skipped: { name: string; reason: string }[];
  overwritten: { name: string; appId: string }[];
  failed: { name: string; error: string }[];
  /** 发布成功的应用（仅 --publish 时）。 */
  published: { name: string; appId: string }[];
  /** 发布失败的应用（导入仍计入 created/overwritten）。 */
  publishFailed: { name: string; error: string }[];
  /** 预检 + check-dependencies + 发布/未发布产出的 issue（blocking/warning/info）。 */
  issues: RuleIssue[];
  duration: number;
}

export interface AppFilter {
  names?: string[];
  ids?: string[];
  tags?: string[];
  types?: string[];
  updatedAfter?: Date;
}

export interface DifyInstanceInfo {
  version: string;
  url: string;
  adapterType: "legacy" | "modern";
}

export interface PipeState {
  lastExportAt: string;
  apps: Record<string, { updatedAt: string; exportedAt: string }>;
}
