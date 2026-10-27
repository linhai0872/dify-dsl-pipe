import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { Command } from "commander";
import { runLint } from "../src/core/lint.js";
import { registerLintCommand } from "../src/commands/lint.js";
import { LocalStorage } from "../src/storage/local.js";
import { setJsonMode } from "../src/utils/logger.js";

const NON_EXISTENT_CONFIG = join(tmpdir(), "lint-test-不存在的配置.yml");

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

/** 非 UUID 变量 id → INVALID_VARIABLE_ID（blocking）。 */
const INVALID_VAR_DSL = dslDoc(
  { name: "BadVar" },
  {
    workflow: {
      conversation_variables: [{ id: "not-a-uuid", name: "cv" }],
      graph: { nodes: [], edges: [] },
    },
  }
);

/** 插件依赖声明 → PLUGIN_MISSING（warning）。 */
const PLUGIN_DEP_DSL = dslDoc(
  { name: "PluginApp" },
  { dependencies: [{ type: "plugin", value: { plugin_unique_identifier: "x/y" } }] }
);

function tmpDir(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "lint-"));
  for (const [p, content] of Object.entries(files)) {
    const full = join(dir, p);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

function makeProgram() {
  const program = new Command();
  program.exitOverride();
  registerLintCommand(program);
  return program;
}

describe("lint", () => {
  let exitCode: number | undefined;
  let stdoutLines: string[];
  let stderrLines: string[];
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  async function runCli(args: string[]) {
    const program = makeProgram();
    try {
      await program.parseAsync(["node", "dify-dsl-pipe", "lint", ...args]);
    } catch {
      // commander exitOverride 抛出的 CommanderError 不影响断言（exitCode 已记录）
    }
  }

  beforeEach(() => {
    setJsonMode(false); // logger 的 jsonMode 是模块级状态，上个 --json 用例会残留
    exitCode = undefined;
    stdoutLines = [];
    stderrLines = [];
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      exitCode = code;
      return undefined as never;
    }) as never);
    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
      stdoutLines.push(String(chunk));
      return true;
    }) as never);
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
      stderrLines.push(String(chunk));
      return true;
    }) as never);
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      stdoutLines.push(a.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      stderrLines.push(a.map(String).join(" "));
    });
    // lint 是离线命令：任何网络调用都直接让测试失败
    fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("lint 不允许网络请求"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("变量 id 非 UUID → INVALID_VARIABLE_ID blocking，退出码 1，且无网络请求", async () => {
    const dir = tmpDir({ "bad.yml": INVALID_VAR_DSL });
    await runCli(["-s", dir, "-c", NON_EXISTENT_CONFIG]);

    expect(exitCode).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(stderrLines.join("")).toContain("INVALID_VARIABLE_ID");
  });

  it("只有 warning（插件依赖）→ 退出码 0；加 --strict → 退出码 1", async () => {
    const dir = tmpDir({ "p.yml": PLUGIN_DEP_DSL });

    await runCli(["-s", dir, "-c", NON_EXISTENT_CONFIG]);
    expect(exitCode).toBe(0);

    exitCode = undefined;
    await runCli(["-s", dir, "-c", NON_EXISTENT_CONFIG, "--strict"]);
    expect(exitCode).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("_versions/ 历史文件和 .orig 原件不检查、不计入 stats.files", async () => {
    const dir = tmpDir({
      "ok.yml": dslDoc({ name: "Ok" }),
      "_versions/a_20240101.yml": INVALID_VAR_DSL,
      "broken.yml.orig": INVALID_VAR_DSL,
      ".dify-pipe-state.json": "{}",
    });
    await runCli(["-s", dir, "-c", NON_EXISTENT_CONFIG, "--json"]);

    expect(exitCode).toBe(0);
    const report = JSON.parse(stdoutLines[0]);
    expect(report.stats.files).toBe(1);
    expect(report.items).toHaveLength(0);
  });

  it("目录为空 → 退出码 0，提示未找到 DSL 文件", async () => {
    const dir = tmpDir({});
    await runCli(["-s", dir, "-c", NON_EXISTENT_CONFIG]);

    expect(exitCode).toBe(0);
    expect(stderrLines.join("")).toContain("未找到任何 DSL 文件");
  });

  it("--json：stdout 只有一行 command 为 lint 的 PipeReport", async () => {
    const dir = tmpDir({ "bad.yml": INVALID_VAR_DSL });
    await runCli(["-s", dir, "-c", NON_EXISTENT_CONFIG, "--json"]);

    expect(exitCode).toBe(1);
    expect(stdoutLines).toHaveLength(1);
    const report = JSON.parse(stdoutLines[0]);
    expect(report.command).toBe("lint");
    expect(report.success).toBe(false);
    expect(report.stats).toMatchObject({ files: 1, blocking: 1 });
    expect(report.items[0].code).toBe("INVALID_VARIABLE_ID");
  });

  it("runLint：应用名取 DSL app.name，缺 app.name 时回退到文件名", async () => {
    const named = dslDoc(
      { name: "Named" },
      {
        workflow: {
          conversation_variables: [{ id: "x", name: "v" }],
          graph: { nodes: [], edges: [] },
        },
      }
    );
    const unnamed = stringifyYaml({
      kind: "app",
      version: "0.4.0",
      workflow: {
        conversation_variables: [{ id: "x", name: "v" }],
        graph: { nodes: [], edges: [] },
      },
    });
    const dir = tmpDir({ "named.yml": named, "fallback-app.yml": unnamed });
    const report = await runLint(new LocalStorage({ path: dir }));

    const apps = report.items.map((i) => i.app).sort();
    expect(apps).toEqual(["Named", "fallback-app"]);
    expect(report.success).toBe(false);
    expect(report.stats).toMatchObject({ files: 2, blocking: 2 });
  });

  it("runLint：不出现 NAME_CONFLICT；strict 且仅 warning → success=false", async () => {
    const dir = tmpDir({ "p.yml": PLUGIN_DEP_DSL });
    const storage = new LocalStorage({ path: dir });

    const normal = await runLint(storage);
    expect(normal.success).toBe(true);
    expect(normal.items.every((i) => i.code === "PLUGIN_MISSING")).toBe(true);

    const strict = await runLint(storage, { strict: true });
    expect(strict.success).toBe(false);
    expect(strict.items.some((i) => i.code === "NAME_CONFLICT")).toBe(false);
  });
});
