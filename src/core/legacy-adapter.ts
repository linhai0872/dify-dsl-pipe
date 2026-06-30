import type { DifyAdapter, AdapterConfig } from "./adapter.js";
import type { DifyApp, DifyWorkspace, WorkflowVersion } from "./types.js";
import { HttpClient } from "./http.js";

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
    };
    if (workflowId) params.workflow_id = workflowId;

    const res = await this.http.get(`/apps/${appId}/export`, params);
    const body = res.body as { data?: string };
    return body.data ?? "";
  }

  async importAppDSL(dslContent: string, opts?: { name?: string; appId?: string }) {
    if (opts?.appId) {
      await this.http.post(`/apps/${opts.appId}/workflows/draft/import`, {
        data: dslContent,
      });
      return { appId: opts.appId, status: "completed" };
    }

    const res = await this.http.post("/apps/import", {
      data: dslContent,
      name: opts?.name,
    });
    const body = res.body as { app_id?: string };
    return { appId: body.app_id ?? "", status: "completed" };
  }

  /** Legacy 无 check-dependencies 端点。 */
  async checkImportDependencies(_importId: string): Promise<{ leaked: unknown[] }> {
    return { leaked: [] };
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
