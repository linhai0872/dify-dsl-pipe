import type { DifyAdapter, AdapterConfig, ImportResult } from "./adapter.js";
import type { DifyApp, DifyWorkspace, WorkflowVersion } from "./types.js";
import { HttpClient } from "./http.js";
import { PipeError } from "./errors.js";

export class LegacyAdapter implements DifyAdapter {
  private http: HttpClient;
  private email?: string;
  private password?: string;
  private token?: string;

  constructor(config: AdapterConfig) {
    this.http = new HttpClient(config.baseUrl, config.timeout, config.maxRetries);
    this.email = config.email;
    this.password = config.password;
    this.token = config.token;
  }

  async login(): Promise<void> {
    if (this.token) {
      this.http.setHeader("authorization", `Bearer ${this.token}`);
      return;
    }
    if (!this.email || !this.password) {
      throw new Error("Legacy adapter: 需要 token 或 email+password");
    }

    const res = await this.http.post("/login", {
      email: this.email,
      password: this.password,
      remember_me: false,
    });
    const data = res.body as { result?: string; data?: { access_token?: string } };
    if (data.result !== "success" || !data.data?.access_token) {
      throw new Error("登录失败：无法获取 access_token");
    }
    this.token = data.data.access_token;
    this.http.setHeader("authorization", `Bearer ${this.token}`);
  }

  async getApps(page: number, limit: number) {
    const res = await this.http.get("/apps", {
      page: String(page),
      limit: String(limit),
    });
    const body = res.body as { data?: DifyApp[]; total?: number; has_more?: boolean };
    return {
      data: body.data ?? [],
      total: body.total ?? 0,
      hasMore: body.has_more ?? false,
    };
  }

  async exportAppDSL(appId: string, includeSecret: boolean, workflowId?: string) {
    const params: Record<string, string> = {
      include_secret: String(includeSecret),
      // 与 modern 保持一致；< 0.12 无 format 概念但忽略未知参数
      format: "yaml",
    };
    if (workflowId) params.workflow_id = workflowId;

    const res = await this.http.get(`/apps/${appId}/export`, params);
    const body = res.body as { data?: string };
    return body.data ?? "";
  }

  async importAppDSL(_dslContent: string, _opts?: { name?: string; appId?: string }): Promise<ImportResult> {
    throw new PipeError(
      "ERR_VERSION_UNSUPPORTED",
      "Dify < 0.12 不支持 DSL 导入，仅支持导出备份",
    );
  }

  /** Legacy 无 check-dependencies 端点。 */
  async checkImportDependencies(_appId: string): Promise<{ leaked: unknown[] }> {
    return { leaked: [] };
  }

  async publishWorkflow(_appId: string): Promise<void> {
    throw new PipeError(
      "ERR_VERSION_UNSUPPORTED",
      "Dify < 0.12 不支持发布，仅支持导出备份",
    );
  }

  async getWorkflowVersions(appId: string): Promise<WorkflowVersion[]> {
    try {
      const res = await this.http.get(`/apps/${appId}/workflows`, {
        page: "1",
        limit: "100",
        named_only: "false",
      });
      const body = res.body as { items?: WorkflowVersion[] };
      return body.items ?? [];
    } catch {
      return [];
    }
  }

  async getAppTags(appId: string): Promise<string[]> {
    try {
      const res = await this.http.get(`/apps/${appId}`);
      const body = res.body as { tags?: { name: string }[] };
      return (body.tags ?? []).map((t) => t.name);
    } catch {
      return [];
    }
  }

  async switchWorkspace(workspaceId: string): Promise<void> {
    await this.http.post("/workspaces/switch", { tenant_id: workspaceId });
  }

  async getWorkspaces(): Promise<DifyWorkspace[]> {
    const res = await this.http.get("/workspaces");
    const body = res.body as { workspaces?: DifyWorkspace[]; data?: DifyWorkspace[] } | DifyWorkspace[];
    if (Array.isArray(body)) return body;
    return body.workspaces ?? body.data ?? [];
  }
}
