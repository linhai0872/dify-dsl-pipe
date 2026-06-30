import semver from "semver";
import type { DifyAdapter, AdapterConfig } from "./adapter.js";
import type { DifyApp, DifyWorkspace, WorkflowVersion, DifyInstanceInfo, AppFilter } from "./types.js";
import { LegacyAdapter } from "./legacy-adapter.js";
import { ModernAdapter } from "./modern-adapter.js";
import { HttpClient } from "./http.js";

const LEGACY_MAX = "0.15.3";
const MODERN_MIN = "1.0.0";
const MINIMUM_SUPPORTED = "0.6.0";

export class DifyClient {
  private adapter!: DifyAdapter;
  private instanceInfo!: DifyInstanceInfo;
  private config: AdapterConfig;

  constructor(config: AdapterConfig) {
    this.config = config;
  }

  async connect(): Promise<DifyInstanceInfo> {
    const version = await this.detectVersion();
    this.instanceInfo = this.buildInstanceInfo(version);
    this.adapter = this.createAdapter(this.instanceInfo.adapterType);
    await this.adapter.login();
    return this.instanceInfo;
  }

  getInfo(): DifyInstanceInfo {
    return this.instanceInfo;
  }

  private async detectVersion(): Promise<string> {
    const http = new HttpClient(this.config.baseUrl, this.config.timeout, 1);
    // 带上认证信息才能成功请求
    if (this.config.token) {
      http.setHeader("authorization", `Bearer ${this.config.token}`);
    }

    try {
      const res = await http.get("/apps", { page: "1", limit: "1" });
      const version = res.headers["x-version"];
      if (version) return version;
    } catch {
      // 可能未认证或者版本太旧没有 x-version header
    }

    // fallback: 尝试公开端点
    try {
      const res = await http.get("/setup");
      const version = res.headers["x-version"];
      if (version) return version;
    } catch {
      // ignore
    }

    // 无法检测，默认使用 modern
    return MODERN_MIN;
  }

  private buildInstanceInfo(version: string): DifyInstanceInfo {
    const clean = semver.coerce(version)?.version ?? version;

    if (semver.valid(clean) && semver.lt(clean, MINIMUM_SUPPORTED)) {
      throw new Error(
        `Dify ${version} 不受支持（最低要求 ${MINIMUM_SUPPORTED}）。请升级 Dify。`
      );
    }

    const adapterType =
      semver.valid(clean) && semver.lte(clean, LEGACY_MAX) ? "legacy" : "modern";

    return {
      version,
      url: this.config.baseUrl,
      adapterType,
    };
  }

  private createAdapter(type: "legacy" | "modern"): DifyAdapter {
    const config = { ...this.config, version: this.instanceInfo.version };
    return type === "legacy"
      ? new LegacyAdapter(config)
      : new ModernAdapter(config);
  }

  async getAllApps(filter?: AppFilter): Promise<DifyApp[]> {
    const allApps: DifyApp[] = [];
    let page = 1;
    const limit = 100;

    while (true) {
      const result = await this.adapter.getApps(page, limit);
      if (!result.data.length) break;
      allApps.push(...result.data);
      if (allApps.length >= result.total || !result.hasMore) break;
      page++;
    }

    allApps.sort((a, b) => {
      const ta = typeof a.created_at === "number" ? a.created_at : Date.parse(a.created_at) || 0;
      const tb = typeof b.created_at === "number" ? b.created_at : Date.parse(b.created_at) || 0;
      return ta - tb;
    });

    if (!filter) return allApps;
    return this.applyFilter(allApps, filter);
  }

  private applyFilter(apps: DifyApp[], filter: AppFilter): DifyApp[] {
    let result = apps;

    if (filter.types?.length) {
      result = result.filter((a) => filter.types!.includes(a.mode));
    }
    if (filter.names?.length) {
      const lowerNames = filter.names.map((n) => n.toLowerCase());
      result = result.filter((a) =>
        lowerNames.some((n) => a.name.toLowerCase().includes(n))
      );
    }
    if (filter.ids?.length) {
      result = result.filter((a) => filter.ids!.includes(a.id));
    }
    if (filter.tags?.length) {
      result = result.filter((a) => {
        const appTags = (a.tags ?? []).map((t) => t.name.toLowerCase());
        return filter.tags!.some((ft) => appTags.includes(ft.toLowerCase()));
      });
    }
    if (filter.updatedAfter) {
      const afterTs = filter.updatedAfter.getTime() / 1000;
      result = result.filter((a) => {
        const ts = typeof a.updated_at === "number" ? a.updated_at : Date.parse(a.updated_at) / 1000 || 0;
        return ts > afterTs;
      });
    }

    return result;
  }

  async exportAppDSL(appId: string, includeSecret = false, workflowId?: string) {
    return this.adapter.exportAppDSL(appId, includeSecret, workflowId);
  }

  async importAppDSL(dslContent: string, opts?: { name?: string; appId?: string }) {
    return this.adapter.importAppDSL(dslContent, opts);
  }

  async checkImportDependencies(importId: string): Promise<{ leaked: unknown[] }> {
    return this.adapter.checkImportDependencies(importId);
  }

  async getWorkflowVersions(appId: string): Promise<WorkflowVersion[]> {
    return this.adapter.getWorkflowVersions(appId);
  }

  async getAppTags(appId: string): Promise<string[]> {
    return this.adapter.getAppTags(appId);
  }

  async switchWorkspace(workspaceId: string) {
    return this.adapter.switchWorkspace(workspaceId);
  }

  async getWorkspaces(): Promise<DifyWorkspace[]> {
    return this.adapter.getWorkspaces();
  }
}
