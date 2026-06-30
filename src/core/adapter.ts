import type { DifyApp, DifyWorkspace, WorkflowVersion } from "./types.js";

export interface DifyAdapter {
  login(): Promise<void>;
  getApps(page: number, limit: number): Promise<{ data: DifyApp[]; total: number; hasMore: boolean }>;
  exportAppDSL(appId: string, includeSecret: boolean, workflowId?: string): Promise<string>;
  importAppDSL(dslContent: string, opts?: { name?: string; appId?: string }): Promise<{ appId: string; status: string; importId?: string }>;
  checkImportDependencies(importId: string): Promise<{ leaked: unknown[] }>;
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
