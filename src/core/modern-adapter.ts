import semver from "semver";
import type { DifyAdapter, AdapterConfig, ImportWarning } from "./adapter.js";
import type { DifyApp, DifyWorkspace, WorkflowVersion } from "./types.js";
import { HttpClient, HttpError } from "./http.js";

// Dify ≥ 1.11.2 expects Base64-encoded password (PR #29659, merged 2025-12-16)
const PASSWORD_BASE64_MIN = "1.11.2";

export class ModernAdapter implements DifyAdapter {
  private http: HttpClient;
  private email?: string;
  private password?: string;
  private token?: string;
  private version?: string;

  constructor(config: AdapterConfig) {
    this.http = new HttpClient(config.baseUrl, config.timeout, config.maxRetries);
    this.email = config.email;
    this.password = config.password;
    this.token = config.token;
    this.version = config.version;
  }

  async login(): Promise<void> {
    if (this.token) {
      this.http.setHeader("authorization", `Bearer ${this.token}`);
      return;
    }
    if (!this.email || !this.password) {
      throw new Error("Modern adapter: 需要 token 或 email+password");
    }

    const { email, password } = this;
    const clean = semver.coerce(this.version ?? "1.0.0")?.version ?? "1.0.0";
    const b64 = Buffer.from(password).toString("base64");

    // 版本探测可能不准（/setup 无 x-version header 时 fallback 到 1.0.0），
    // 按版本给出首选编码顺序，401 时自动换另一种重试一次
    const attempts = semver.gte(clean, PASSWORD_BASE64_MIN)
      ? [b64, password]   // ≥ 1.11.2: 优先 Base64
      : [password, b64];  // < 1.11.2: 优先明文

    let lastError: Error | undefined;
    for (const pw of attempts) {
      try {
        await this.doLogin(email, pw);
        return;
      } catch (e) {
        if (e instanceof HttpError && e.status === 401) {
          lastError = e;
        } else {
          throw e;
        }
      }
    }
    throw lastError ?? new Error("登录失败：email 或密码错误");
  }

  private async doLogin(email: string, password: string): Promise<void> {
    const res = await this.http.post("/login", {
      email,
      password,
      remember_me: false,
    });

    const body = res.body as { result?: string; data?: { access_token?: string } };

    // Modern 版本 token 可能在 cookie 中，也可能在 response body 中（兼容过渡期）
    const cookieToken = this.http.getCookie("access_token");
    const bodyToken = body.data?.access_token;
    this.token = cookieToken ?? bodyToken;

    if (this.token && !cookieToken) {
      this.http.setHeader("authorization", `Bearer ${this.token}`);
    }

    // 设置 CSRF token
    const csrfToken = this.http.getCookie("csrf_token");
    if (csrfToken) {
      this.http.setHeader("x-csrf-token", csrfToken);
    }

    if (!this.token && !cookieToken) {
      throw new Error("登录失败：无法获取认证凭据");
    }
  }

  async getApps(page: number, limit: number, mode?: string) {
    const params: Record<string, string> = { page: String(page), limit: String(limit) };
    if (mode) params.mode = mode;
    const res = await this.http.get("/apps", params);
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
      // Dify 1.18 起不带 format 默认返回 .ifpkg zip；旧版本忽略未知参数，故无条件发送
      format: "yaml",
    };
    if (workflowId) params.workflow_id = workflowId;

    const res = await this.http.get(`/apps/${appId}/export`, params);
    const body = res.body as { data?: string };
    return body.data ?? "";
  }

  async importAppDSL(dslContent: string, opts?: { name?: string; appId?: string }) {
    const payload: Record<string, unknown> = {
      mode: "yaml-content",
      yaml_content: dslContent,
    };
    if (opts?.name) payload.name = opts.name;
    if (opts?.appId) payload.app_id = opts.appId;

    const res = await this.http.post("/apps/imports", payload);
    const body = res.body as {
      id?: string;
      status?: string;
      app_id?: string;
      warnings?: ImportWarning[];
      error?: string;
    };

    // 如果状态是 PENDING，需要 confirm
    if (String(body.status ?? "").toLowerCase() === "pending" && body.id) {
      const confirmRes = await this.http.post(`/apps/imports/${body.id}/confirm`);
      const confirmBody = confirmRes.body as {
        app_id?: string;
        status?: string;
        warnings?: ImportWarning[];
        error?: string;
      };
      if (String(confirmBody.status ?? "").toLowerCase() === "failed") {
        throw new Error(confirmBody.error ?? "导入失败");
      }
      return {
        appId: confirmBody.app_id ?? body.app_id ?? "",
        status: confirmBody.status ?? "completed",
        importId: body.id,
        warnings: confirmBody.warnings ?? body.warnings ?? [],
      };
    }

    if (String(body.status ?? "").toLowerCase() === "failed") {
      throw new Error(body.error ?? "导入失败");
    }

    return {
      appId: body.app_id ?? "",
      status: body.status ?? "completed",
      importId: body.id,
      warnings: body.warnings ?? [],
    };
  }

  /** GET /apps/imports/{appId}/check-dependencies（Dify 1.15+，路径参数是 app id）。返回 leaked dependencies。 */
  async checkImportDependencies(appId: string): Promise<{ leaked: unknown[] }> {
    try {
      const res = await this.http.get(`/apps/imports/${appId}/check-dependencies`);
      const body = res.body as { leaked_dependencies?: unknown[] };
      return { leaked: body.leaked_dependencies ?? [] };
    } catch {
      // 老版本无此端点 → 不阻断 import，按无泄漏处理
      return { leaked: [] };
    }
  }

  /** POST /apps/{id}/workflows/publish（0.15.3~1.18.0 通用，空 body）。导入只写草稿，发布需显式调用。 */
  async publishWorkflow(appId: string): Promise<void> {
    await this.http.post(`/apps/${appId}/workflows/publish`, {});
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
