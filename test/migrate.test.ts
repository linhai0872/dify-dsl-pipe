import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { DifyClient } from "../src/core/client.js";
import type { Config } from "../src/config/types.js";
import { runMigrate } from "../src/core/migrate.js";
import { PipeError } from "../src/core/errors.js";
import { Command } from "commander";
import { registerMigrateCommand } from "../src/commands/migrate.js";

// ── DSL fixtures ──────────────────────────────────────────
const UUID = "123e4567-e89b-42d3-a456-426614174000";

function dslDoc(name: string, mode = "workflow", extra: Record<string, unknown> = {}) {
  return stringifyYaml({
    app: { name, mode, icon: "🤖", icon_background: "#FFEAD5" },
    kind: "app",
    version: "0.4.0",
    dependencies: [],
    workflow: {
      graph: { nodes: [], edges: [] },
      environment_variables: [{ id: UUID, name: "e1", value: "v" }],
    },
    ...extra,
  });
}

// ── fake Dify（fetch stub，两端各自一个 host） ─────────────
interface FakeBackend {
  apps: { id: string; name: string; mode: string }[];
  dsl: Record<string, string>;
  publishFail?: boolean;
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

function stubFetch(backends: Record<string, FakeBackend>, calls: { url: string; method: string; body?: string }[]) {
  const mock = vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url, method, body: init?.body });

    const host = Object.keys(backends).find((h) => url.startsWith(h));
    if (!host) return new Response("not found", { status: 404 });
    const b = backends[host];
    const u = new URL(url);
    const path = u.pathname;

    const json = (body: unknown, headers: Record<string, string> = {}) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json", "x-version": "1.18.0", ...headers },
      });

    if (path === "/apps" && method === "GET") {
      const page = Number(u.searchParams.get("page") ?? "1");
      const data = page === 1 ? b.apps : [];
      return json({ data, total: b.apps.length, has_more: false });
    }
    const expMatch = path.match(/^\/apps\/([^/]+)\/export$/);
    if (expMatch && method === "GET") {
      const id = expMatch[1];
      const dsl = b.dsl[id];
      if (!dsl) return new Response("{}", { status: 404 });
      return json({ data: dsl });
    }
    if (path === "/apps/imports" && method === "POST") {
      const body = JSON.parse(init?.body ?? "{}") as { name?: string };
      const newId = `imp-${(body.name ?? "x").toLowerCase()}`;
      b.apps.push({ id: newId, name: body.name ?? "?", mode: "workflow" });
      return json({ app_id: newId, status: "completed" });
    }
    const depMatch = path.match(/^\/apps\/imports\/([^/]+)\/check-dependencies$/);
    if (depMatch && method === "GET") {
      return json({ leaked_dependencies: [] });
    }
    const pubMatch = path.match(/^\/apps\/([^/]+)\/workflows\/publish$/);
    if (pubMatch && method === "POST") {
      if (b.publishFail) return new Response("RBAC denied", { status: 403 });
      return json({});
    }
    return json({});
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

function realConnect() {
  return async (config: Config, name: string) => {
    const profile = config.profiles[name];
    if (!profile) throw new PipeError("ERR_PROFILE_NOT_FOUND", `Profile "${name}" 未找到`);
    const inst = config.instances.find((i) => i.name === profile.instance);
    if (!inst) throw new PipeError("ERR_PROFILE_NOT_FOUND", `instance "${profile.instance}" 未找到`);
    const client = new DifyClient({
      baseUrl: inst.url,
      token: inst.token,
      timeout: inst.timeout,
      maxRetries: inst.maxRetries,
    });
    await client.connect();
    return { client, name: inst.name };
  };
}

function tmpWorkdirBase() {
  return mkdtempSync(join(tmpdir(), "migrate-base-"));
}

function tmpSourceDir(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "migrate-src-"));
  for (const [p, content] of Object.entries(files)) {
    const full = join(dir, p);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── tests ──────────────────────────────────────────────────
describe("runMigrate", () => {
  it("--from prod --to staging（无 --yes）→ dry-run：导出到 workdir，0 个导入请求", async () => {
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

    const report = await runMigrate({
      config: makeConfig(),
      from: "prod",
      to: "staging",
      yes: false,
      connect: realConnect(),
      workdirBase: tmpWorkdirBase(),
    });

    expect(report.command).toBe("migrate");
    expect(report.stats!.exported).toBe(1);
    expect(report.stats!.created).toBe(1); // dry-run 计划数
    // dry-run 下无 POST /apps/imports、无 publish
    const importCalls = calls.filter((c) => c.url.includes("/apps/imports") && c.method === "POST");
    const pubCalls = calls.filter((c) => c.url.includes("/workflows/publish"));
    expect(importCalls).toHaveLength(0);
    expect(pubCalls).toHaveLength(0);
    // workdir 存在、含导出文件
    expect(report.meta!.workdir).toBeDefined();
    expect(existsSync(report.meta!.workdir!)).toBe(true);
    const ymls = readdirSync(report.meta!.workdir!, { recursive: true }) as string[];
    expect(ymls.some((f) => String(f).endsWith(".yml"))).toBe(true);
  });

  it("同一秒启动两次迁移 → 各自独占不同 workdir，不混入对方的 DSL", async () => {
    stubFetch(
      {
        "http://prod.local": {
          apps: [{ id: "a1", name: "App1", mode: "workflow" }],
          dsl: { a1: dslDoc("App1") },
        },
        "http://stg.local": { apps: [], dsl: {} },
      },
      []
    );
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-27T10:00:00"));
    try {
      const base = tmpWorkdirBase();
      const run = () =>
        runMigrate({ config: makeConfig(), from: "prod", to: "staging", connect: realConnect(), workdirBase: base });
      const r1 = await run();
      const r2 = await run();
      expect(r1.meta!.workdir).not.toBe(r2.meta!.workdir);
      expect(r2.meta!.workdir!.endsWith("-2")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("加 --yes → 实际导入 staging，stats 含 exported 与 created", async () => {
    const calls: { url: string; method: string }[] = [];
    const stg: FakeBackend = { apps: [], dsl: {} };
    stubFetch(
      {
        "http://prod.local": {
          apps: [{ id: "a1", name: "App1", mode: "workflow" }],
          dsl: { a1: dslDoc("App1") },
        },
        "http://stg.local": stg,
      },
      calls
    );

    const report = await runMigrate({
      config: makeConfig(),
      from: "prod",
      to: "staging",
      yes: true,
      connect: realConnect(),
      workdirBase: tmpWorkdirBase(),
    });

    expect(report.success).toBe(true);
    expect(report.stats!.exported).toBe(1);
    expect(report.stats!.created).toBe(1);
    expect(stg.apps.some((a) => a.name === "App1")).toBe(true);
    const importCalls = calls.filter((c) => c.url.includes("/apps/imports") && c.method === "POST");
    expect(importCalls).toHaveLength(1);
  });

  it("--to staging --source ./backup --yes → 跳过导出，直接从本地目录导入", async () => {
    const calls: { url: string; method: string }[] = [];
    const stg: FakeBackend = { apps: [], dsl: {} };
    stubFetch({ "http://stg.local": stg }, calls);

    const src = tmpSourceDir({ "app.yml": dslDoc("LocalApp") });
    const report = await runMigrate({
      config: makeConfig(),
      to: "staging",
      source: src,
      yes: true,
      connect: realConnect(),
      workdirBase: tmpWorkdirBase(),
    });

    expect(report.success).toBe(true);
    expect(report.stats!.exported).toBe(0);
    expect(report.stats!.created).toBe(1);
    expect(report.meta?.workdir).toBeUndefined();
    // 没有对 prod 的任何请求
    expect(calls.filter((c) => c.url.includes("prod.local"))).toHaveLength(0);
  });

  it("--yes --ephemeral 全部成功 → 临时目录被删除", async () => {
    stubFetch(
      {
        "http://prod.local": {
          apps: [{ id: "a1", name: "App1", mode: "workflow" }],
          dsl: { a1: dslDoc("App1") },
        },
        "http://stg.local": { apps: [], dsl: {} },
      },
      []
    );

    const report = await runMigrate({
      config: makeConfig(),
      from: "prod",
      to: "staging",
      yes: true,
      ephemeral: true,
      connect: realConnect(),
    });

    expect(report.success).toBe(true);
    expect(report.meta!.workdir).toMatch(/dify-pipe-migrate-/);
    expect(existsSync(report.meta!.workdir!)).toBe(false);
  });

  it("--yes --ephemeral 有失败 → 临时目录保留，meta.workdir 指向它", async () => {
    // staging 上导入失败：让 importAppDSL 返回 failed
    const calls: { url: string; method: string; body?: string }[] = [];
    const mock = vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ url, method, body: init?.body });
      const u = new URL(url);
      const path = u.pathname;
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json", "x-version": "1.18.0" },
        });

      if (url.startsWith("http://prod.local")) {
        if (path === "/apps" && method === "GET") return json({ data: [{ id: "a1", name: "App1", mode: "workflow" }], total: 1, has_more: false });
        if (path.match(/^\/apps\/a1\/export$/)) return json({ data: dslDoc("App1") });
      }
      if (url.startsWith("http://stg.local")) {
        if (path === "/apps" && method === "GET") return json({ data: [], total: 0, has_more: false });
        if (path === "/apps/imports" && method === "POST") return json({ status: "failed", error: "bad dsl" });
        if (path.match(/check-dependencies/)) return json({ leaked_dependencies: [] });
      }
      return json({});
    });
    vi.stubGlobal("fetch", mock);

    const report = await runMigrate({
      config: makeConfig(),
      from: "prod",
      to: "staging",
      yes: true,
      ephemeral: true,
      connect: realConnect(),
    });

    expect(report.success).toBe(false);
    expect(report.stats!.failed).toBe(1);
    expect(existsSync(report.meta!.workdir!)).toBe(true);
  });

  it("预检 blocking 且未 --fix：该应用不导入，其余照常，success=false", async () => {
    // 坏 DSL：非法 YAML（parser 报错 → blocking UNKNOWN）
    const badDsl = "app: [unclosed";
    const calls: { url: string; method: string }[] = [];
    const stg: FakeBackend = { apps: [], dsl: {} };
    stubFetch(
      {
        "http://prod.local": {
          apps: [
            { id: "a1", name: "Good", mode: "workflow" },
            { id: "a2", name: "Bad", mode: "workflow" },
          ],
          dsl: { a1: dslDoc("Good"), a2: badDsl },
        },
        "http://stg.local": stg,
      },
      calls
    );

    const report = await runMigrate({
      config: makeConfig(),
      from: "prod",
      to: "staging",
      yes: true,
      connect: realConnect(),
      workdirBase: tmpWorkdirBase(),
    });

    expect(report.success).toBe(false);
    // 好应用已导入，坏应用未发 import 请求
    const imports = calls.filter((c) => c.url.includes("/apps/imports") && c.method === "POST");
    expect(imports).toHaveLength(1);
    expect(stg.apps.some((a) => a.name === "Good")).toBe(true);
    expect(stg.apps.some((a) => a.name === "Bad")).toBe(false);
  });

  it("--yes --publish 且发布被拒 → PUBLISH_FAILED，success=false", async () => {
    const calls: { url: string; method: string }[] = [];
    const stg: FakeBackend = { apps: [], dsl: {}, publishFail: true };
    stubFetch(
      {
        "http://prod.local": {
          apps: [{ id: "a1", name: "App1", mode: "workflow" }],
          dsl: { a1: dslDoc("App1") },
        },
        "http://stg.local": stg,
      },
      calls
    );

    const report = await runMigrate({
      config: makeConfig(),
      from: "prod",
      to: "staging",
      yes: true,
      publish: true,
      connect: realConnect(),
      workdirBase: tmpWorkdirBase(),
    });

    expect(report.success).toBe(false);
    expect(report.stats!.publishFailed).toBe(1);
    const pfIssue = report.items.find((i) => i.code === "PUBLISH_FAILED");
    expect(pfIssue).toBeDefined();
    const pubs = calls.filter((c) => c.url.includes("/workflows/publish"));
    expect(pubs).toHaveLength(1);
  });

  it("--from prod --to prod → ERR_CONFIG_INVALID，不连任何实例", async () => {
    const calls: { url: string; method: string }[] = [];
    stubFetch({ "http://prod.local": { apps: [], dsl: {} } }, calls);

    await expect(
      runMigrate({
        config: makeConfig(),
        from: "prod",
        to: "prod",
        connect: realConnect(),
        workdirBase: tmpWorkdirBase(),
      })
    ).rejects.toMatchObject({ code: "ERR_CONFIG_INVALID" });

    expect(calls).toHaveLength(0); // 未发任何请求
  });

  it("--to nope（profile 不存在）→ ERR_PROFILE_NOT_FOUND", async () => {
    const calls: { url: string; method: string }[] = [];
    stubFetch({ "http://stg.local": { apps: [], dsl: {} } }, calls);

    await expect(
      runMigrate({
        config: makeConfig(),
        from: "prod",
        to: "nope",
        connect: realConnect(),
        workdirBase: tmpWorkdirBase(),
      })
    ).rejects.toMatchObject({ code: "ERR_PROFILE_NOT_FOUND" });
  });

  it("导出无版本历史 → workdir 中没有 _versions/ 目录", async () => {
    stubFetch(
      {
        "http://prod.local": {
          apps: [{ id: "a1", name: "App1", mode: "workflow" }],
          dsl: { a1: dslDoc("App1") },
        },
        "http://stg.local": { apps: [], dsl: {} },
      },
      []
    );

    const report = await runMigrate({
      config: makeConfig(),
      from: "prod",
      to: "staging",
      connect: realConnect(),
      workdirBase: tmpWorkdirBase(),
    });

    const files = readdirSync(report.meta!.workdir!, { recursive: true }) as string[];
    expect(files.some((f) => String(f).includes("_versions"))).toBe(false);
  });
});

describe("CLI migrate 人类输出", () => {
  it("--yes 导入 workflow 后逐条展示 NOT_PUBLISHED 草稿提示", async () => {
    stubFetch({ "http://stg.local": { apps: [], dsl: {} } }, []);
    const src = tmpSourceDir({ "app.yml": dslDoc("LocalApp") });
    const cfgPath = join(mkdtempSync(join(tmpdir(), "migrate-cfg-")), "dify-pipe.yaml");
    writeFileSync(cfgPath, stringifyYaml(makeConfig()));

    const out: string[] = [];
    vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { out.push(a.map(String).join(" ")); });
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { out.push(a.map(String).join(" ")); });
    vi.spyOn(process.stderr, "write").mockImplementation(((c: unknown) => { out.push(String(c)); return true; }) as never);

    const program = new Command();
    program.exitOverride();
    registerMigrateCommand(program);
    try {
      await program.parseAsync(["node", "dify-dsl-pipe", "migrate", "--to", "staging", "--source", src, "--yes", "-c", cfgPath]);
    } finally {
      vi.restoreAllMocks();
    }

    const text = out.join("\n");
    expect(text).toContain("NOT_PUBLISHED");
    expect(text).toContain("LocalApp");
  });
});
