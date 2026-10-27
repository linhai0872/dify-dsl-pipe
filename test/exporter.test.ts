import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { stringify as stringifyYaml, parse as parseYaml } from "yaml";
import type { DifyClient } from "../src/core/client.js";
import { exportApps } from "../src/core/exporter.js";
import { LocalStorage } from "../src/storage/local.js";

function app(id: string, name: string, mode = "workflow") {
  return {
    id, name, mode,
    description: "", icon: "🤖",
    created_at: 1700000000, updated_at: 1700000000,
  };
}

function fakeClient(over: Partial<Record<string, unknown>> = {}) {
  return {
    getAllApps: vi.fn(async () => over.apps ?? []),
    exportAppDSL: vi.fn(async (id: string) => {
      const map = (over.dslById ?? {}) as Record<string, string>;
      return map[id] ?? stringifyYaml({ app: { name: id, mode: "workflow" }, workflow: {} });
    }),
    getWorkflowVersions: vi.fn(async () => []),
    getWorkspaces: vi.fn(async () => []),
  } as unknown as DifyClient;
}

const baseOpts = {
  includeSecret: false,
  includeVersionHistory: false,
  incremental: false,
  archive: "none" as const,
  pattern: "{name}.yml",
  sanitize: true,
  preserveLocalFiles: false,
  keepOriginal: false,
};

describe("exportApps", () => {
  it("带 omitted_assets 的应用导出后 issues 含 AGENT_ASSETS_OMITTED，文件照常写出", async () => {
    const dir = mkdtempSync(join(tmpdir(), "exp-"));
    const storage = new LocalStorage({ path: dir });
    const dsl = stringifyYaml({
      app: { name: "AgentApp", mode: "advanced-chat" },
      workflow: {},
      agent_packages: {
        agent_1: { omitted_assets: [{ kind: "skill", name: "web-search" }] },
      },
    });
    const client = fakeClient({
      apps: [app("id1", "AgentApp", "advanced-chat")],
      dslById: { id1: dsl },
    });

    const r = await exportApps(client, storage, { ...baseOpts });
    expect(r.success).toHaveLength(1);
    const agentIssue = r.success[0].issues?.find((i) => i.code === "AGENT_ASSETS_OMITTED");
    expect(agentIssue).toBeDefined();
    expect(agentIssue!.severity).toBe("warning");
    // 文件照常写出
    expect(readFileSync(join(dir, "AgentApp.yml"), "utf-8")).toContain("agent_packages");
  });

  it("--zip 写出真正的二进制 zip（PK 头，非 base64 文本）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "exp-"));
    const storage = new LocalStorage({ path: dir });
    const client = fakeClient({
      apps: [app("id1", "W1")],
      dslById: { id1: stringifyYaml({ app: { name: "W1" }, workflow: {} }) },
    });

    const r = await exportApps(client, storage, { ...baseOpts, archive: "zip" });
    expect(r.success).toHaveLength(1);

    const files = readdirSync(dir);
    const zipName = files.find((f) => f.endsWith(".zip"));
    expect(zipName).toBeDefined();

    const zipPath = join(dir, zipName!);
    const buf = readFileSync(zipPath);
    // PK zip signature（非 base64 文本）
    expect([...buf.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    // 用标准 unzip 校验 CRC 并解出条目：归档可解压且内容完整
    execFileSync("unzip", ["-tq", zipPath]);
    const entry = execFileSync("unzip", ["-p", zipPath, "W1.yml"], { encoding: "utf-8" });
    expect(parseYaml(entry)).toMatchObject({ app: { name: "W1" } });
  });
});

describe("exportApps 重名应用", () => {
  const dslOf = (name: string, marker: string) => stringifyYaml({ app: { name, mode: "workflow" }, workflow: { marker } });

  it("同名应用不互相覆盖：先出现的保留原名，后出现的加 id 后缀，并报 DUPLICATE_NAME", async () => {
    const dir = mkdtempSync(join(tmpdir(), "exp-"));
    const client = fakeClient({
      apps: [app("aaaaaaaa-1", "Same"), app("bbbbbbbb-2", "Same")],
      dslById: { "aaaaaaaa-1": dslOf("Same", "first"), "bbbbbbbb-2": dslOf("Same", "second") },
    });

    const r = await exportApps(client, new LocalStorage({ path: dir }), { ...baseOpts });
    expect(readFileSync(join(dir, "Same.yml"), "utf-8")).toContain("first");
    expect(readFileSync(join(dir, "Same__bbbbbbbb.yml"), "utf-8")).toContain("second");
    const dup = r.success[1].issues?.find((i) => i.code === "DUPLICATE_NAME");
    expect(dup).toMatchObject({ severity: "warning", app: "Same", file: "Same__bbbbbbbb.yml" });
    expect(r.success[0].issues?.some((i) => i.code === "DUPLICATE_NAME")).toBe(false);
  });

  it("仅大小写不同也视为重名（大小写不敏感文件系统会互相覆盖）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "exp-"));
    const client = fakeClient({ apps: [app("aaaaaaaa-1", "Flow"), app("bbbbbbbb-2", "flow")] });

    await exportApps(client, new LocalStorage({ path: dir }), { ...baseOpts });
    expect(readdirSync(dir).sort()).toEqual(["Flow.yml", "flow__bbbbbbbb.yml"]);
  });

  it("不重名时文件名不变", async () => {
    const dir = mkdtempSync(join(tmpdir(), "exp-"));
    const client = fakeClient({ apps: [app("aaaaaaaa-1", "A"), app("bbbbbbbb-2", "B")] });

    const r = await exportApps(client, new LocalStorage({ path: dir }), { ...baseOpts });
    expect(readdirSync(dir).sort()).toEqual(["A.yml", "B.yml"]);
    expect(r.success.flatMap((e) => e.issues ?? [])).toHaveLength(0);
  });

  it("增量模式只导出后一个同名应用时，仍写到带后缀的文件，不覆盖前一个", async () => {
    const dir = mkdtempSync(join(tmpdir(), "exp-"));
    const storage = new LocalStorage({ path: dir });
    const first = app("aaaaaaaa-1", "Same");
    const second = { ...app("bbbbbbbb-2", "Same"), updated_at: 1800000000 };
    await storage.write(".dify-pipe-state.json", JSON.stringify({
      apps: {
        "aaaaaaaa-1": { updatedAt: new Date(1700000000 * 1000).toISOString(), exportedAt: "x" },
        "bbbbbbbb-2": { updatedAt: new Date(1700000000 * 1000).toISOString(), exportedAt: "x" },
      },
    }));
    const client = fakeClient({ apps: [first, second], dslById: { "bbbbbbbb-2": dslOf("Same", "second") } });

    const r = await exportApps(client, storage, { ...baseOpts, incremental: true });
    expect(r.success.map((e) => e.filePath)).toEqual(["Same__bbbbbbbb.yml"]);
    expect(readdirSync(dir)).not.toContain("Same.yml");
  });

  it("带后缀应用的版本历史写到带后缀的 _versions 目录", async () => {
    const dir = mkdtempSync(join(tmpdir(), "exp-"));
    const client = fakeClient({ apps: [app("aaaaaaaa-1", "Same"), app("bbbbbbbb-2", "Same")] });
    (client.getWorkflowVersions as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) =>
      id === "bbbbbbbb-2" ? [{ id: "v1", marked_name: "v1", created_at: 1700000000 }] : [],
    );

    const r = await exportApps(client, new LocalStorage({ path: dir }), { ...baseOpts, includeVersionHistory: true });
    expect(r.success[1].versions?.[0].filePath).toMatch(/^Same__bbbbbbbb_versions\/v1_/);
  });
});
