import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { Command } from "commander";
import { runDiff } from "../src/core/diff.js";
import { registerDiffCommand } from "../src/commands/diff.js";
import type { DifyClient } from "../src/core/client.js";
import type { Config } from "../src/config/types.js";

// ---------- helpers ----------

function dslDoc(
  app: Record<string, unknown>,
  extra: Record<string, unknown> = {}
): string {
  return stringifyYaml({
    app: { mode: "workflow", icon: "🤖", icon_type: "emoji", ...app },
    kind: "app",
    version: "0.4.0",
    dependencies: [],
    workflow: {
      graph: {
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [
          {
            id: "n1",
            position: { x: 1, y: 1 },
            data: { type: "start", title: "开始" },
          },
        ],
        edges: [],
      },
      environment_variables: [],
      conversation_variables: [],
    },
    ...extra,
  });
}

function tmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeDsl(dir: string, file: string, content: string): void {
  const full = join(dir, file);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf-8");
}

function emptyConfig(): Config {
  return { instances: [], profiles: {} } as Config;
}

/** fake connect：返回带可控 getAllApps / exportAppDSL 的 client。 */
function fakeConnect(opts: {
  apps: { id: string; name: string; mode: string }[];
  dslById: Record<string, string>;
}) {
  const calls = { getAllApps: [] as unknown[], exportAppDSL: [] as unknown[] };
  const client = {
    getAllApps: vi.fn(async (filter?: unknown) => {
      calls.getAllApps.push(filter);
      let apps = opts.apps;
      const f = filter as { names?: string[]; types?: string[] } | undefined;
      if (f?.types?.length) apps = apps.filter((a) => f.types!.includes(a.mode));
      if (f?.names?.length) {
        const lowers = f.names.map((n) => n.toLowerCase());
        apps = apps.filter((a) => lowers.some((n) => a.name.toLowerCase().includes(n)));
      }
      return apps;
    }),
    exportAppDSL: vi.fn(async (id: string) => {
      calls.exportAppDSL.push(id);
      return opts.dslById[id] ?? dslDoc({ name: "?" });
    }),
  } as unknown as DifyClient;
  const connect = vi.fn(async () => ({ client, name: "test" }));
  return { connect, client, calls };
}

// ---------- tests ----------

describe("runDiff", () => {
  describe("在线模式（--profile）", () => {
    it("acceptance#1: C 仅线上 / B 仅备份 / D 内容不同 / A 一致，stats 与条目顺序正确", async () => {
      const dir = tmpDir("diff-");
      writeDsl(dir, "a.yml", dslDoc({ name: "A" }));
      writeDsl(dir, "b.yml", dslDoc({ name: "B" }));
      writeDsl(dir, "d.yml", dslDoc({ name: "D" }, { workflow: { graph: { nodes: [{ id: "n1", data: { title: "线上版" } }] } } }));

      const { connect } = fakeConnect({
        apps: [
          { id: "a1", name: "A", mode: "workflow" },
          { id: "c1", name: "C", mode: "workflow" },
          { id: "d1", name: "D", mode: "workflow" },
        ],
        dslById: {
          a1: dslDoc({ name: "A" }),
          c1: dslDoc({ name: "C" }),
          d1: dslDoc({ name: "D" }, { workflow: { graph: { nodes: [{ id: "n1", data: { title: "备份版" } }] } } }),
        },
      });

      const report = await runDiff({ config: emptyConfig(), profile: "p", source: dir, connect });
      expect(report.command).toBe("diff");
      expect(report.stats).toEqual({ onlyInBackup: 1, onlyOnline: 1, changed: 1, same: 1 });

      const codes = report.items.map((i) => i.code);
      expect(codes.indexOf("DRIFT_ONLY_ONLINE")).toBeLessThan(codes.indexOf("DRIFT_ONLY_IN_BACKUP"));
      expect(codes.indexOf("DRIFT_ONLY_IN_BACKUP")).toBeLessThan(codes.indexOf("DRIFT_CONTENT"));

      const c = report.items.find((i) => i.code === "DRIFT_ONLY_ONLINE");
      expect(c!.app).toBe("C");
      const b = report.items.find((i) => i.code === "DRIFT_ONLY_IN_BACKUP");
      expect(b!.app).toBe("B");
      expect(b!.file).toBe("b.yml");
      const d = report.items.find((i) => i.code === "DRIFT_CONTENT");
      expect(d!.app).toBe("D");
      expect(report.items.find((i) => i.app === "A")).toBeUndefined();
    });

    it("acceptance#2: 只差画布/viewport/dependencies/变量id/知识库id → 一致", async () => {
      const backupYaml = stringifyYaml({
        app: { name: "A", mode: "workflow" },
        kind: "app",
        version: "0.4.0",
        dependencies: [],
        workflow: {
          graph: {
            viewport: { x: 0, y: 0, zoom: 1 },
            nodes: [{ id: "n1", position: { x: 1, y: 1 }, data: { type: "start", title: "开始", dataset_ids: ["ds-1"] } }],
            edges: [],
          },
          environment_variables: [{ id: "uuid-a", name: "K", value: "v" }],
          conversation_variables: [{ id: "uuid-b", name: "c" }],
        },
      });
      const dir = tmpDir("diff-");
      writeDsl(dir, "a.yml", backupYaml);

      const noisy = stringifyYaml({
        app: { name: "A", mode: "workflow" },
        kind: "app",
        version: "0.4.0",
        dependencies: [{ type: "plugin", value: "zzz" }],
        workflow: {
          graph: {
            viewport: { x: 99, y: 99, zoom: 2 },
            nodes: [{ id: "n1", position: { x: 500, y: 500 }, positionAbsolute: { x: 5, y: 5 }, selected: true, width: 300, height: 90, dragging: false, zIndex: 1, sourcePosition: "right", targetPosition: "left", data: { type: "start", title: "开始", dataset_ids: ["ds-other"] } }],
            edges: [],
          },
          environment_variables: [{ id: "different-uuid", name: "K", value: "v" }],
          conversation_variables: [{ id: "another-uuid", name: "c" }],
        },
      });
      const { connect } = fakeConnect({
        apps: [{ id: "a1", name: "A", mode: "workflow" }],
        dslById: { a1: noisy },
      });

      const report = await runDiff({ config: emptyConfig(), profile: "p", source: dir, connect });
      expect(report.stats!.same).toBe(1);
      expect(report.stats!.changed).toBe(0);
      expect(report.items.filter((i) => i.code === "DRIFT_CONTENT")).toHaveLength(0);
    });

    it("acceptance#3: 同样差异加 --full → DRIFT_CONTENT", async () => {
      const dir = tmpDir("diff-");
      writeDsl(dir, "a.yml", dslDoc({ name: "A" }));
      const noisy = dslDoc({ name: "A" }, {
        dependencies: [{ type: "plugin", value: "zzz" }],
        workflow: { graph: { viewport: { x: 9, y: 9, zoom: 2 }, nodes: [{ id: "n1", position: { x: 5, y: 5 }, data: { type: "start", title: "开始" } }], edges: [] } },
      });
      const { connect } = fakeConnect({
        apps: [{ id: "a1", name: "A", mode: "workflow" }],
        dslById: { a1: noisy },
      });

      const report = await runDiff({ config: emptyConfig(), profile: "p", source: dir, connect, full: true });
      expect(report.stats!.changed).toBe(1);
      expect(report.items.some((i) => i.code === "DRIFT_CONTENT")).toBe(true);
    });

    it("acceptance#4: --no-sanitize 备份（含 local file default）与线上一致", async () => {
      // 备份侧含 local file default；线上被 sanitize 后没有 → 默认模式一致
      const backup = stringifyYaml({
        app: { name: "A", mode: "workflow" },
        version: "0.4.0",
        workflow: {
          graph: {
            nodes: [{
              id: "n1",
              data: {
                type: "start",
                variables: [{
                  variable: "f", type: "file",
                  default: { transfer_method: "local_file", upload_file_id: "u-1" },
                }],
              },
            }],
            edges: [],
          },
        },
      });
      const online = stringifyYaml({
        app: { name: "A", mode: "workflow" },
        version: "0.4.0",
        workflow: {
          graph: {
            nodes: [{
              id: "n1",
              data: {
                type: "start",
                variables: [{ variable: "f", type: "file" }],
              },
            }],
            edges: [],
          },
        },
      });
      const dir = tmpDir("diff-");
      writeDsl(dir, "a.yml", backup);
      const { connect } = fakeConnect({
        apps: [{ id: "a1", name: "A", mode: "workflow" }],
        dslById: { a1: online },
      });
      const report = await runDiff({ config: emptyConfig(), profile: "p", source: dir, connect });
      expect(report.stats!.same).toBe(1);
      expect(report.stats!.changed).toBe(0);
    });

    it("acceptance#5: --show-chunks 时 detail 含变化路径和两边取值；不加时 location 只列前 5 个路径", async () => {
      const dir = tmpDir("diff-");
      writeDsl(dir, "d.yml", dslDoc({ name: "D" }, { workflow: { graph: { nodes: [{ id: "n1", data: { p1: "a", p2: "a", p3: "a", p4: "a", p5: "a", p6: "a" } }] } } }));
      const online = dslDoc({ name: "D" }, { workflow: { graph: { nodes: [{ id: "n1", data: { p1: "b", p2: "b", p3: "b", p4: "b", p5: "b", p6: "b" } }] } } });
      const { connect } = fakeConnect({
        apps: [{ id: "d1", name: "D", mode: "workflow" }],
        dslById: { d1: online },
      });

      // 不加 show-chunks
      const r1 = await runDiff({ config: emptyConfig(), profile: "p", source: dir, connect });
      const item1 = r1.items.find((i) => i.code === "DRIFT_CONTENT")!;
      expect(item1.detail).toBeUndefined();
      expect(item1.location!.split(", ").length).toBeLessThanOrEqual(5);

      // 加 show-chunks
      const r2 = await runDiff({ config: emptyConfig(), profile: "p", source: dir, connect, showChunks: true });
      const item2 = r2.items.find((i) => i.code === "DRIFT_CONTENT")!;
      const chunks = JSON.parse(item2.detail!);
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.length).toBeLessThanOrEqual(20);
      expect(chunks[0]).toHaveProperty("path");
      expect(chunks[0]).toHaveProperty("backup");
      expect(chunks[0]).toHaveProperty("online");
    });

    it("acceptance#6: 两边 version 不同 → DSL_VERSION_MISMATCH warning", async () => {
      const dir = tmpDir("diff-");
      writeDsl(dir, "a.yml", dslDoc({ name: "A" }, { version: "0.3.0" }));
      const online = dslDoc({ name: "A" }, { version: "0.4.0" });
      const { connect } = fakeConnect({
        apps: [{ id: "a1", name: "A", mode: "workflow" }],
        dslById: { a1: online },
      });
      const report = await runDiff({ config: emptyConfig(), profile: "p", source: dir, connect });
      const w = report.items.find((i) => i.code === "DSL_VERSION_MISMATCH");
      expect(w).toBeDefined();
      expect(w!.severity).toBe("warning");
      expect(w!.app).toBe("A");
    });

    it("acceptance#7: 备份两个文件同名（大小写不同）→ 两条 DUPLICATE_NAME，不参与比较", async () => {
      const dir = tmpDir("diff-");
      writeDsl(dir, "a.yml", dslDoc({ name: "MyApp" }));
      writeDsl(dir, "b.yml", dslDoc({ name: "myapp" }));
      const { connect } = fakeConnect({ apps: [], dslById: {} });

      const report = await runDiff({ config: emptyConfig(), profile: "p", source: dir, connect });
      const dups = report.items.filter((i) => i.code === "DUPLICATE_NAME");
      expect(dups).toHaveLength(2);
      expect(dups.every((d) => d.severity === "warning")).toBe(true);
      // 不参与比较：stats 为 0
      expect(report.stats).toEqual({ onlyInBackup: 0, onlyOnline: 0, changed: 0, same: 0 });
    });

    it("线上重名、备份单个同名 → 该名字两侧都不参与比较，不报单侧漂移", async () => {
      const dir = tmpDir("diff-");
      writeDsl(dir, "a.yml", dslDoc({ name: "Dup" }));
      const { connect } = fakeConnect({
        apps: [
          { id: "d1", name: "Dup", mode: "workflow" },
          { id: "d2", name: "dup", mode: "workflow" },
        ],
        dslById: { d1: dslDoc({ name: "Dup" }), d2: dslDoc({ name: "dup" }) },
      });

      const report = await runDiff({ config: emptyConfig(), profile: "p", source: dir, connect, check: true });
      expect(report.items.filter((i) => i.code === "DUPLICATE_NAME")).toHaveLength(2);
      expect(report.items.some((i) => i.code.startsWith("DRIFT_"))).toBe(false);
      expect(report.stats).toEqual({ onlyInBackup: 0, onlyOnline: 0, changed: 0, same: 0 });
      expect(report.success).toBe(true);
    });

    it("配对应用线上 DSL 解析失败 → blocking，success=false（不能当作无漂移）", async () => {
      const dir = tmpDir("diff-");
      writeDsl(dir, "a.yml", dslDoc({ name: "A" }));
      const { connect } = fakeConnect({
        apps: [{ id: "a1", name: "A", mode: "workflow" }],
        dslById: { a1: "app: [" },
      });

      const report = await runDiff({ config: emptyConfig(), profile: "p", source: dir, connect, check: true });
      expect(report.success).toBe(false);
      expect(report.summary.blocking).toBe(1);
      expect(report.stats).toEqual({ onlyInBackup: 0, onlyOnline: 0, changed: 0, same: 0 });
    });

    it("acceptance#11: 在线模式不向存储写任何文件", async () => {
      const dir = tmpDir("diff-");
      writeDsl(dir, "a.yml", dslDoc({ name: "A" }));
      const before = readdirSync(dir).sort();
      const { connect } = fakeConnect({
        apps: [{ id: "a1", name: "A", mode: "workflow" }],
        dslById: { a1: dslDoc({ name: "A" }) },
      });
      await runDiff({ config: emptyConfig(), profile: "p", source: dir, connect });
      const after = readdirSync(dir).sort();
      expect(after).toEqual(before);
    });
  });

  describe("离线模式（--baseline）", () => {
    it("acceptance#9: --baseline 不发出任何网络请求，按同样规则比较", async () => {
      const a = tmpDir("diff-a-");
      const b = tmpDir("diff-b-");
      writeDsl(a, "x.yml", dslDoc({ name: "X" }));
      writeDsl(b, "x.yml", dslDoc({ name: "X" }));
      writeDsl(b, "y.yml", dslDoc({ name: "Y" }));

      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);

      const report = await runDiff({ config: emptyConfig(), baseline: a, source: b });
      expect(fetchSpy).not.toHaveBeenCalled();
      // x 一致，y 仅 source 侧（source 视为"备份"侧，baseline 视为"线上"侧的对偶——baseline 独有 → ONLY_ONLINE 语义反过来：实际上 baseline 是"左"、source 是"右"
      // 实现上 baseline 占据 onlineEntries 位置，source 占据 backupEntries 位置
      expect(report.stats!.same).toBe(1);
      expect(report.stats!.onlyInBackup).toBe(1); // Y 在 source 侧独有
      expect(report.items.some((i) => i.code === "DRIFT_ONLY_IN_BACKUP" && i.app === "Y")).toBe(true);
    });
  });

  describe("参数校验", () => {
    it("无 --profile / --baseline → ERR_CONFIG_INVALID", async () => {
      await expect(runDiff({ config: emptyConfig(), source: "/tmp" })).rejects.toMatchObject({ code: "ERR_CONFIG_INVALID" });
    });

    it("acceptance#10: --filter tag:core → ERR_CONFIG_INVALID", async () => {
      await expect(
        runDiff({ config: emptyConfig(), profile: "p", source: "/tmp", filter: "tag:core", connect: vi.fn() })
      ).rejects.toMatchObject({ code: "ERR_CONFIG_INVALID" });
    });

    it("--filter name:/type: 正常通过（两侧都被过滤）", async () => {
      const dir = tmpDir("diff-");
      writeDsl(dir, "a.yml", dslDoc({ name: "Alpha" }));
      writeDsl(dir, "b.yml", dslDoc({ name: "Beta" }));
      const { connect } = fakeConnect({
        apps: [
          { id: "a1", name: "Alpha", mode: "workflow" },
          { id: "b1", name: "Beta", mode: "workflow" },
        ],
        dslById: {
          a1: dslDoc({ name: "Alpha" }),
          b1: dslDoc({ name: "Beta", extra: "different" }),
        },
      });
      const report = await runDiff({
        config: emptyConfig(), profile: "p", source: dir,
        filter: "name:alpha", connect,
      });
      // 只比 Alpha；Beta 两侧都被过滤掉
      expect(report.stats!.same).toBe(1);
      expect(report.items.find((i) => i.app === "Beta")).toBeUndefined();
    });
  });
});

describe("CLI diff --check", () => {
  let exitCode: number | undefined;
  let stdoutLines: string[];
  let stderrLines: string[];

  beforeEach(() => {
    exitCode = undefined;
    stdoutLines = [];
    stderrLines = [];
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      exitCode = code;
      return undefined as never;
    }) as never);
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      stdoutLines.push(a.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      stderrLines.push(a.map(String).join(" "));
    });
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
      stderrLines.push(String(chunk));
      return true;
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function makeProgram() {
    const program = new Command();
    program.exitOverride();
    registerDiffCommand(program);
    return program;
  }

  it("acceptance#8: --check 有漂移 → exit 1；无漂移或不加 --check → exit 0", async () => {
    const dir = tmpDir("diff-cli-");
    writeDsl(dir, "a.yml", dslDoc({ name: "A" }));

    // 无 --check + 无漂移 → 0（offline baseline 模式，目录相同）
    const dir2 = tmpDir("diff-cli2-");
    writeDsl(dir2, "a.yml", dslDoc({ name: "A" }));
    const prog1 = makeProgram();
    await prog1.parseAsync(["node", "x", "diff", "--baseline", dir, "-s", dir2, "-c", "/nonexistent.yaml"]);
    expect(exitCode).toBe(0);

    // --check + 有漂移（baseline 多一个应用）→ 1
    exitCode = undefined;
    writeDsl(dir2, "b.yml", dslDoc({ name: "B" }));
    const prog2 = makeProgram();
    await prog2.parseAsync(["node", "x", "diff", "--baseline", dir, "-s", dir2, "--check", "-c", "/nonexistent.yaml"]);
    expect(exitCode).toBe(1);
  });
});
