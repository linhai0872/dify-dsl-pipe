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
