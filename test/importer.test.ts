import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import type { DifyClient } from "../src/core/client.js";
import { importApps } from "../src/core/importer.js";
import { LocalStorage } from "../src/storage/local.js";

function dslDoc(app: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return stringifyYaml({
    app: { name: "T", mode: "workflow", ...app },
    kind: "app",
    version: "0.4.0",
    dependencies: [],
    workflow: { graph: { nodes: [], edges: [] } },
    ...extra,
  });
}

function tmpStorage(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "imp-"));
  for (const [p, content] of Object.entries(files)) {
    const full = join(dir, p);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return new LocalStorage({ path: dir });
}

/** 构造 fake DifyClient：只实现 importApps 用到的方法。 */
function fakeClient(over: Partial<Record<keyof DifyClient, unknown>> = {}) {
  const calls = { importAppDSL: [] as unknown[][], checkDeps: [] as string[], publish: [] as string[] };
  const client = {
    getAllApps: vi.fn(async () => over.existingApps ?? []),
    importAppDSL: vi.fn(async (...args: unknown[]) => {
      calls.importAppDSL.push(args);
      return over.importResult ?? { appId: "app1", status: "completed", warnings: [] };
    }),
    checkImportDependencies: vi.fn(async (appId: string) => {
      calls.checkDeps.push(appId);
      return over.depResult ?? { leaked: [] };
    }),
    publishWorkflow: vi.fn(async (appId: string) => {
      calls.publish.push(appId);
      if (over.publishError) throw over.publishError;
    }),
    getInfo: vi.fn(() => ({ version: "1.18.0", url: "http://x", adapterType: "modern" as const })),
  } as unknown as DifyClient;
  return { client, calls };
}

const baseOpts = { dryRun: false, onConflict: "skip" as const, fix: false, publish: false };

describe("importApps", () => {
  it("导入成功后用 appId（非 importId）调 check-dependencies；缺插件 → PLUGIN_MISSING", async () => {
    const storage = tmpStorage({ "a.yml": dslDoc({ name: "A" }) });
    const { client, calls } = fakeClient({
      importResult: { appId: "app-xyz", status: "completed", importId: "imp-1", warnings: [] },
      depResult: { leaked: [{ name: "plugin-p" }] },
    });

    const r = await importApps(client, storage, { ...baseOpts });
    expect(calls.checkDeps).toEqual(["app-xyz"]);
    const issue = r.issues.find((i) => i.code === "PLUGIN_MISSING");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("warning");
    expect(issue!.problem).toContain("1 个插件依赖");
    expect(r.created).toEqual([{ name: "A", appId: "app-xyz" }]);
  });

  it("check-dependencies 报错 → 静默跳过，不影响导入结果", async () => {
    const storage = tmpStorage({ "a.yml": dslDoc({ name: "A" }) });
    const { client } = fakeClient();
    (client.checkImportDependencies as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("404"));

    const r = await importApps(client, storage, { ...baseOpts });
    expect(r.created).toHaveLength(1);
    expect(r.issues.filter((i) => i.code === "PLUGIN_MISSING")).toHaveLength(0);
  });

  it("Dify 返回 warnings → 每条变 DIFY_IMPORT_WARNING，应用仍计入 created", async () => {
    const warnings = [
      { code: "plugin_missing", path: "graph.nodes[0]", message: "缺少插件 a" },
      { code: "model_missing", message: "缺少模型 b" },
    ];
    const storage = tmpStorage({ "a.yml": dslDoc({ name: "A" }) });
    const { client } = fakeClient({
      importResult: { appId: "app1", status: "completed-with-warnings", warnings },
    });

    const r = await importApps(client, storage, { ...baseOpts });
    const wIssues = r.issues.filter((i) => i.code === "DIFY_IMPORT_WARNING");
    expect(wIssues).toHaveLength(2);
    expect(wIssues[0].problem).toBe("缺少插件 a");
    expect(wIssues[0].location).toBe("graph.nodes[0]");
    expect(JSON.parse(wIssues[0].detail!)).toEqual(warnings[0]);
    expect(r.created).toHaveLength(1);
  });

  it("新 workflow 应用未加 publish → NOT_PUBLISHED(info) 提示草稿不可用", async () => {
    const storage = tmpStorage({ "a.yml": dslDoc({ name: "A", mode: "workflow" }) });
    const { client } = fakeClient();
    const r = await importApps(client, storage, { ...baseOpts });

    const issue = r.issues.find((i) => i.code === "NOT_PUBLISHED");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("info");
    expect(issue!.problem).toContain("草稿");
    expect(issue!.suggestion).toContain("--publish");
  });

  it("覆盖已有 workflow 未加 publish → NOT_PUBLISHED 提示线上仍运行旧版本", async () => {
    const storage = tmpStorage({ "a.yml": dslDoc({ name: "A", mode: "workflow" }) });
    const { client } = fakeClient({
      existingApps: [{ id: "old-1", name: "A", mode: "workflow" }],
    });
    const r = await importApps(client, storage, { ...baseOpts, onConflict: "overwrite" });

    const issue = r.issues.find((i) => i.code === "NOT_PUBLISHED");
    expect(issue!.problem).toContain("旧发布版本");
    expect(r.overwritten).toHaveLength(1);
  });

  // 实测（GZ 1.18.0）：覆盖已有 Agent 应用 → HTTP 400 "Agent DSL import only supports creating a new Agent App"
  it("overwrite 遇到已有 Agent 应用 → 跳过并报 AGENT_OVERWRITE_UNSUPPORTED，其他应用照常覆盖", async () => {
    const storage = tmpStorage({
      "agent.yml": dslDoc({ name: "Ag", mode: "agent" }),
      "flow.yml": dslDoc({ name: "Flow", mode: "workflow" }),
    });
    const { client, calls } = fakeClient({
      existingApps: [
        { id: "ag-1", name: "Ag", mode: "agent" },
        { id: "wf-1", name: "Flow", mode: "workflow" },
      ],
    });
    const r = await importApps(client, storage, { ...baseOpts, onConflict: "overwrite" });

    expect(calls.importAppDSL).toHaveLength(1);
    expect(r.overwritten.map((o) => o.name)).toEqual(["Flow"]);
    expect(r.skipped.map((s) => s.name)).toEqual(["Ag"]);
    expect(r.failed).toHaveLength(0);
    const issue = r.issues.find((i) => i.code === "AGENT_OVERWRITE_UNSUPPORTED");
    expect(issue).toMatchObject({ severity: "warning", app: "Ag" });
  });

  it("dry-run 同样把已有 Agent 应用的 overwrite 计为跳过", async () => {
    const storage = tmpStorage({ "agent.yml": dslDoc({ name: "Ag", mode: "agent" }) });
    const { client } = fakeClient({ existingApps: [{ id: "ag-1", name: "Ag", mode: "agent" }] });
    const r = await importApps(client, storage, { ...baseOpts, dryRun: true, onConflict: "overwrite" });

    expect(r.skipped.map((s) => s.name)).toEqual(["Ag"]);
    expect(r.overwritten).toHaveLength(0);
  });

  it("chat 应用不报 NOT_PUBLISHED", async () => {
    const storage = tmpStorage({ "a.yml": dslDoc({ name: "A", mode: "chat" }) });
    const { client } = fakeClient();
    const r = await importApps(client, storage, { ...baseOpts });
    expect(r.issues.filter((i) => i.code === "NOT_PUBLISHED")).toHaveLength(0);
  });

  it("--publish 时 workflow 应用调 publishWorkflow 并计入 published", async () => {
    const storage = tmpStorage({ "a.yml": dslDoc({ name: "A", mode: "workflow" }) });
    const { client, calls } = fakeClient({ importResult: { appId: "app9", status: "completed", warnings: [] } });
    const r = await importApps(client, storage, { ...baseOpts, publish: true });

    expect(calls.publish).toEqual(["app9"]);
    expect(r.published).toEqual([{ name: "A", appId: "app9" }]);
    expect(r.issues.filter((i) => i.code === "NOT_PUBLISHED")).toHaveLength(0);
  });

  it("--publish 发布失败 → PUBLISH_FAILED warning，仍计入 created、不计入 failed", async () => {
    const storage = tmpStorage({ "a.yml": dslDoc({ name: "A", mode: "workflow" }) });
    const { client } = fakeClient({
      importResult: { appId: "app9", status: "completed", warnings: [] },
      publishError: new Error("RBAC 拒绝"),
    });
    const r = await importApps(client, storage, { ...baseOpts, publish: true });

    expect(r.publishFailed).toHaveLength(1);
    expect(r.publishFailed[0].error).toContain("RBAC");
    expect(r.created).toHaveLength(1);
    expect(r.failed).toHaveLength(0);
    const issue = r.issues.find((i) => i.code === "PUBLISH_FAILED");
    expect(issue!.severity).toBe("warning");
    expect(issue!.problem).toContain("RBAC");
  });

  it("dry-run + publish：不发 import / check-deps / publish 请求", async () => {
    const storage = tmpStorage({ "a.yml": dslDoc({ name: "A", mode: "workflow" }) });
    const { client, calls } = fakeClient();
    const r = await importApps(client, storage, { ...baseOpts, dryRun: true, publish: true });

    expect(calls.importAppDSL).toHaveLength(0);
    expect(calls.checkDeps).toHaveLength(0);
    expect(calls.publish).toHaveLength(0);
    expect(r.created[0].appId).toBe("(dry-run)");
  });

  it("chat 应用加 --publish 也不调 publishWorkflow", async () => {
    const storage = tmpStorage({ "a.yml": dslDoc({ name: "A", mode: "chat" }) });
    const { client, calls } = fakeClient();
    await importApps(client, storage, { ...baseOpts, publish: true });
    expect(calls.publish).toHaveLength(0);
  });

  it("结果含 published / publishFailed 字段", async () => {
    const storage = tmpStorage({ "a.yml": dslDoc({ name: "A" }) });
    const { client } = fakeClient();
    const r = await importApps(client, storage, { ...baseOpts });
    expect(r.published).toEqual([]);
    expect(r.publishFailed).toEqual([]);
  });
});
