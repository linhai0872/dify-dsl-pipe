import type { DifyApp, DifyWorkspace, WorkflowVersion } from "./types.js";

/** Dify 导入响应里的单条警告（1.18+，`completed-with-warnings` 时返回）。 */
export interface ImportWarning {
  code: string;
  path?: string;
  message: string;
}

export interface ImportResult {
  appId: string;
  status: string;
  importId?: string;
  warnings: ImportWarning[];
}

export interface DifyAdapter {
  login(): Promise<void>;
  getApps(page: number, limit: number, mode?: string): Promise<{ data: DifyApp[]; total: number; hasMore: boolean }>;
  exportAppDSL(appId: string, includeSecret: boolean, workflowId?: string): Promise<string>;
  importAppDSL(dslContent: string, opts?: { name?: string; appId?: string }): Promise<ImportResult>;
  /** 按 app id 检查依赖泄漏（路径参数是 app_id，不是 import id）。 */
  checkImportDependencies(appId: string): Promise<{ leaked: unknown[] }>;
  publishWorkflow(appId: string): Promise<void>;
  getWorkflowVersions(appId: string): Promise<WorkflowVersion[]>;
  getAppTags(appId: string): Promise<string[]>;
  switchWorkspace(workspaceId: string): Promise<void>;
  getWorkspaces(): Promise<DifyWorkspace[]>;
}

export interface AdapterConfig {
  baseUrl: string;
  email?: string;
  password?: string;
  token?: string;
  timeout: number;
  maxRetries: number;
  version?: string;
}
