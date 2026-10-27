import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer, type McpContext } from "../src/serve/mcp.js";
import { LocalStorage } from "../src/storage/local.js";
import type { DifyClient } from "../src/core/client.js";
import type { Config } from "../src/config/types.js";
import type { PipeReport } from "../src/core/report.js";

// ---------- fixtures ----------

const UUID = "123e4567-e89b-42d3-a456-426614174000";

function dslDoc(name: string, mode = "workflow") {
  return stringifyYaml({
    app: { name, mode, icon: "🤖", icon_background: "#FFEAD5" },
    kind: "app",
    version: "0.4.0",
    dependencies: [],
    workflow: {
      graph: { nodes: [], edges: [] },
      environment_variables: [{ id: UUID, name: "e1", value: "v" }],
    },
  });
}

function fakeClient(overrides: Partial<{
  apps: { id: string; name: string; mode: string; tags?: { name: string }[] }[];
  dslById: Record<string, string>;
}> = {}): DifyClient {
  return {
    getInfo: () => ({ version: "1.18.0", url: "http://fake", adapterType: "modern" }),
    getAllApps: vi.fn(async () => overrides.apps ?? []),
    exportAppDSL: vi.fn(async (id: string) => overrides.dslById?.[id] ?? dslDoc("?")),
  } as unknown as DifyClient;
}

function makeConfig(): Config {
  return {
    instances: [
      { name: "prod-inst", url: "http://prod.local", token: "pt", timeout: 30, maxRetries: 0 },
      { name: "stg-inst", url: "http://stg.local", token: "st", timeout: 30, maxRetries: 0 },
    ],
    profiles: {
      prod: { instance: "prod-inst", storage: { type: "local", path: "./x" } },
      staging: { instance: "stg-inst", storage: { type: "local", path: "./x" } },
    },
  };
}

interface FakeBackend {
  apps: { id: string; name: string; mode: string }[];
  dsl: Record<string, string>;
  forbidden?: boolean;
}

function stubFetch(backends: Record<string, FakeBackend>, calls: { url: string; method: string }[]) {
  const mock = vi.fn(async (input: unknown, init?: { method?: string }) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url, method });

    const host = Object.keys(backends).find((h) => url.startsWith(h));
    if (!host) return new Response("not found", { status: 404 });
    const b = backends[host];
    const u = new URL(url);
    const path = u.pathname;

    if (b.forbidden) return new Response("RBAC denied", { status: 403 });

    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json", "x-version": "1.18.0" },
      });

    if (path === "/apps" && method === "GET") {
      const page = Number(u.searchParams.get("page") ?? "1");
      const data = page === 1 ? b.apps : [];
      return json({ data, total: b.apps.length, has_more: false });
    }
    const expMatch = path.match(/^\/apps\/([^/]+)\/export$/);
    if (expMatch && method === "GET") {
      const dsl = b.dsl[expMatch[1]];
      if (!dsl) return new Response("{}", { status: 404 });
      return json({ data: dsl });
    }
    if (path === "/apps/imports" && method === "POST") {
      return json({ app_id: "imp-x", status: "completed" });
    }
    if (path.match(/check-dependencies/)) return json({ leaked_dependencies: [] });
    return json({});
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

// ---------- harness ----------

async function connect(ctx: McpContext) {
  const server = createMcpServer(ctx);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "0.0.1" });
  await client.connect(clientT);
  return { client, server };
}

async function callTool(client: Client, name: string, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as { type: string; text: string }[])[0].text;
  return { body: JSON.parse(text) as PipeReport & Record<string, unknown>, isError: !!res.isError };
}

function makeCtx(overrides: Partial<McpContext> = {}): McpContext {
  return {
    clients: new Map([["cli", { client: fakeClient(), name: "cli" }]]),
    storage: new LocalStorage({ path: mkdtempSync(join(tmpdir(), "mcp-store-")) }),
    exportOpts: {
      includeSecret: false,
      includeVersionHistory: true,
      incremental: false,
      archive: "none",
      pattern: "by-type",
      sanitize: true,
      preserveLocalFiles: false,
      keepOriginal: false,
    },
    config: makeConfig(),
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------- tests ----------

describe("MCP tools", () => {
  it("import_apps dryRun → PipeReport command=import，含 stats", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-import-"));
    writeFileSync(join(dir, "a.yml"), dslDoc("AppA"));

    const ctx = makeCtx({ storage: new LocalStorage({ path: dir }) });
    const { client } = await connect(ctx);

    const { body, isError } = await callTool(client, "import_apps", { dryRun: true });
    expect(isError).toBe(false);
    expect(body.command).toBe("import");
    expect(body.success).toBe(true);
    expect(body.stats).toMatchObject({ created: 1, failed: 0 });
    expect(Array.isArray(body.items)).toBe(true);
  });

  it("export_apps → PipeReport command=export，含 stats", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-export-"));
    const ctx = makeCtx({
      clients: new Map([["cli", {
        client: fakeClient({
          apps: [{ id: "a1", name: "AppA", mode: "workflow" }],
          dslById: { a1: dslDoc("AppA") },
        }),
        name: "cli",
      }]]),
      storage: new LocalStorage({ path: dir }),
    });
    const { client } = await connect(ctx);

    const { body, isError } = await callTool(client, "export_apps", {
      filter: "type:workflow",
      instance: "cli",
    });
    expect(isError).toBe(false);
    expect(body.command).toBe("export");
    expect(body.stats).toMatchObject({ exported: 1, failed: 0 });
  });

  it("migrate_apps 只给 to+from → 预览（无导入请求），报告含 meta.workdir", async () => {
    const calls: { url: string; method: string }[] = [];
    stubFetch(
      {
        "http://prod.local": {
          apps: [{ id: "a1", name: "App1", mode: "workflow" }],
          dsl: { a1: dslDoc("App1") },
        },
        "http://stg.local": { apps: [], dsl: {} },
      },
      calls
    );

    const ctx = makeCtx();
    const { client } = await connect(ctx);

    const { body, isError } = await callTool(client, "migrate_apps", {
      from: "prod",
      to: "staging",
    });
    expect(isError).toBe(false);
    expect(body.command).toBe("migrate");
    expect(body.meta?.workdir).toBeDefined();
    expect(body.stats?.exported).toBe(1);
    // 预览：没有 POST /apps/imports
    const imports = calls.filter((c) => c.url.includes("/apps/imports") && c.method === "POST");
    expect(imports).toHaveLength(0);
  });

  it("diff_apps check:true 且有漂移 → isError:true，内容是 diff PipeReport", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-diff-"));
    writeFileSync(join(dir, "b.yml"), dslDoc("OnlyBackup"));

    const calls: { url: string; method: string }[] = [];
    stubFetch(
      { "http://prod.local": { apps: [{ id: "a1", name: "OnlyOnline", mode: "workflow" }], dsl: { a1: dslDoc("OnlyOnline") } } },
      calls
    );

    const ctx = makeCtx();
    const { client } = await connect(ctx);

    const { body, isError } = await callTool(client, "diff_apps", {
      profile: "prod",
      source: dir,
      check: true,
    });
    expect(isError).toBe(true);
    expect(body.command).toBe("diff");
    expect(body.success).toBe(false);
    expect(body.stats?.onlyOnline).toBe(1);
    expect(body.stats?.onlyInBackup).toBe(1);
  });

  it("diff_apps 无漂移 → success:true", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-diff2-"));
    writeFileSync(join(dir, "a.yml"), dslDoc("Same"));

    stubFetch(
      { "http://prod.local": { apps: [{ id: "a1", name: "Same", mode: "workflow" }], dsl: { a1: dslDoc("Same") } } },
      []
    );

    const ctx = makeCtx();
    const { client } = await connect(ctx);
    const { body, isError } = await callTool(client, "diff_apps", {
      profile: "prod",
      source: dir,
      check: true,
    });
    expect(isError).toBe(false);
    expect(body.success).toBe(true);
  });

  it("migrate_apps 未知 profile → {success:false,error,code} 信封 + isError，服务不崩溃", async () => {
    const ctx = makeCtx();
    const { client, server } = await connect(ctx);

    const { body, isError } = await callTool(client, "migrate_apps", { to: "nope", from: "prod" });
    expect(isError).toBe(true);
    expect(body.success).toBe(false);
    expect(body.code).toBe("ERR_PROFILE_NOT_FOUND");
    expect(typeof body.error).toBe("string");

    // 服务还活着：再调一次正常工具
    const again = await callTool(client, "list_instances");
    expect(again.isError).toBe(false);
    await server.close();
  });

  it("export_apps instance 不存在 → ERR_INSTANCE_NOT_FOUND 信封", async () => {
    const ctx = makeCtx();
    const { client } = await connect(ctx);
    const { body, isError } = await callTool(client, "export_apps", { instance: "nope" });
    expect(isError).toBe(true);
    expect(body.code).toBe("ERR_INSTANCE_NOT_FOUND");
  });

  it("diff_apps 对 403 的实例 → {success:false,error,code:ERR_FORBIDDEN} + isError", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-diff403-"));
    stubFetch({ "http://prod.local": { apps: [], dsl: {}, forbidden: true } }, []);

    const ctx = makeCtx();
    const { client } = await connect(ctx);
    const { body, isError } = await callTool(client, "diff_apps", {
      profile: "prod",
      source: dir,
    });
    expect(isError).toBe(true);
    expect(body.success).toBe(false);
    expect(body.code).toBe("ERR_FORBIDDEN");
  });

  it("list_apps 保持数据形状，instance 不存在走错误信封", async () => {
    const ctx = makeCtx({
      clients: new Map([["cli", {
        client: fakeClient({ apps: [{ id: "a1", name: "AppA", mode: "workflow", tags: [{ name: "核心" }] }] }),
        name: "cli",
      }]]),
    });
    const { client } = await connect(ctx);

    const { body } = await callTool(client, "list_apps", { instance: "cli" });
    expect(Array.isArray(body)).toBe(true);
    const arr = body as unknown as { id: string; name: string; mode: string; tags: string[] }[];
    expect(arr[0]).toMatchObject({ id: "a1", name: "AppA", mode: "workflow", tags: ["核心"] });

    const bad = await callTool(client, "list_apps", { instance: "nope" });
    expect(bad.isError).toBe(true);
    expect(bad.body.code).toBe("ERR_INSTANCE_NOT_FOUND");
  });

  it("非 PipeError 异常（如 HTTP 400）→ 信封仍带 code: ERR_UNKNOWN", async () => {
    const broken = {
      getInfo: () => ({ version: "1.18.0", url: "http://fake", adapterType: "modern" }),
      getAllApps: vi.fn(async () => { throw new Error("HTTP 400: bad request"); }),
    } as unknown as DifyClient;
    const ctx = makeCtx({ clients: new Map([["cli", { client: broken, name: "cli" }]]) });
    const { client } = await connect(ctx);

    const { body, isError } = await callTool(client, "list_apps", { instance: "cli" });
    expect(isError).toBe(true);
    expect(body).toMatchObject({ success: false, error: "HTTP 400: bad request", code: "ERR_UNKNOWN" });
  });
});
