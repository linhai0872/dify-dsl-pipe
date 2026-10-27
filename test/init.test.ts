import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { parse as parseYaml } from "yaml";
import { registerInitCommand } from "../src/commands/init.js";
import { loadConfig } from "../src/config/loader.js";

function makeProgram() {
  const program = new Command();
  program.exitOverride();
  registerInitCommand(program);
  return program;
}

async function runInit(args: string[]) {
  const program = makeProgram();
  await program.parseAsync(["node", "dify-dsl-pipe", "init", ...args]);
}

describe("init 非交互模式", () => {
  let dir: string;
  let exitCode: number | undefined;
  let stdoutLines: string[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "init-test-"));
    exitCode = undefined;
    stdoutLines = [];
    vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        exitCode = code;
        return undefined as never;
      }) as never);
    vi
      .spyOn(process.stdout, "write")
      .mockImplementation(((chunk: unknown) => {
        stdoutLines.push(String(chunk));
        return true;
      }) as never);
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      stdoutLines.push(a.map(String).join(" "));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("无配置文件时生成 dify-pipe.yaml，含 instance 与 profile，可被 loadConfig 解析", async () => {
    const out = join(dir, "dify-pipe.yaml");
    await runInit([
      "--name",
      "prod",
      "--url",
      "https://x/console/api",
      "--token",
      "t",
      "-o",
      out,
    ]);

    expect(exitCode).toBe(0);
    expect(existsSync(out)).toBe(true);
    // 含凭据：仅所有者可读写
    if (process.platform !== "win32") expect(statSync(out).mode & 0o777).toBe(0o600);

    const raw = parseYaml(readFileSync(out, "utf-8"));
    const inst = raw.instances.find((i: { name: string }) => i.name === "prod");
    expect(inst).toBeDefined();
    expect(inst.url).toBe("https://x/console/api");
    expect(inst.token).toBe("t");
    expect(raw.profiles.prod).toBeDefined();
    expect(raw.profiles.prod.instance).toBe("prod");
    expect(raw.profiles.prod.storage).toEqual({
      type: "local",
      path: "./dify-backup/prod",
    });

    // loadConfig 解析无验证错误
    const config = loadConfig(out);
    expect(config.instances.some((i) => i.name === "prod")).toBe(true);
    expect(config.profiles.prod).toBeDefined();
  });

  it("已有 instance staging 时追加 prod，staging 原样保留", async () => {
    const out = join(dir, "dify-pipe.yaml");
    writeFileSync(
      out,
      [
        "instances:",
        "  - name: staging",
        "    url: https://staging/console/api",
        "    token: st",
        "profiles:",
        "  staging:",
        "    instance: staging",
        "    storage:",
        "      type: local",
        "      path: ./dify-backup/staging",
        "",
      ].join("\n"),
      { encoding: "utf-8", mode: 0o644 },
    );

    await runInit([
      "--name",
      "prod",
      "--url",
      "https://x/console/api",
      "--token",
      "t",
      "-o",
      out,
    ]);

    expect(exitCode).toBe(0);
    // 已有宽松权限的文件写入凭据前被收紧
    if (process.platform !== "win32") expect(statSync(out).mode & 0o777).toBe(0o600);
    const raw = parseYaml(readFileSync(out, "utf-8"));
    expect(raw.instances).toHaveLength(2);
    const staging = raw.instances.find(
      (i: { name: string }) => i.name === "staging",
    );
    expect(staging).toEqual({
      name: "staging",
      url: "https://staging/console/api",
      token: "st",
    });
    expect(raw.profiles.staging.storage.path).toBe("./dify-backup/staging");
    expect(raw.profiles.prod).toBeDefined();
  });

  it("同名已存在且无 --force 报 ERR_CONFIG_INVALID，文件不变；带 --force 覆盖", async () => {
    const out = join(dir, "dify-pipe.yaml");
    const original = [
      "instances:",
      "  - name: prod",
      "    url: https://old/console/api",
      "    token: old-token",
      "profiles:",
      "  prod:",
      "    instance: prod",
      "    storage:",
      "      type: local",
      "      path: ./old-path",
      "",
    ].join("\n");
    writeFileSync(out, original, "utf-8");

    await runInit([
      "--name",
      "prod",
      "--url",
      "https://new/console/api",
      "--token",
      "new-token",
      "-o",
      out,
    ]);

    expect(exitCode).toBe(1);
    expect(readFileSync(out, "utf-8")).toBe(original);

    // --force 覆盖
    await runInit([
      "--name",
      "prod",
      "--url",
      "https://new/console/api",
      "--token",
      "new-token",
      "--force",
      "-o",
      out,
    ]);

    expect(exitCode).toBe(0);
    const raw = parseYaml(readFileSync(out, "utf-8"));
    const prod = raw.instances.find(
      (i: { name: string }) => i.name === "prod",
    );
    expect(prod.url).toBe("https://new/console/api");
    expect(prod.token).toBe("new-token");
  });

  it("缺 url 或缺认证信息时报 ERR_CONFIG_INVALID 且不写文件", async () => {
    const out = join(dir, "dify-pipe.yaml");

    // 只有 name+url，无 token/email/password
    await runInit(["--name", "prod", "--url", "https://x/console/api", "-o", out]);
    expect(exitCode).toBe(1);
    expect(existsSync(out)).toBe(false);

    // 只有 name+token，无 url
    exitCode = undefined;
    await runInit(["--name", "prod", "--token", "t", "-o", out]);
    expect(exitCode).toBe(1);
    expect(existsSync(out)).toBe(false);
  });

  it("--email/--password 方式写入 email+password 而非 token", async () => {
    const out = join(dir, "dify-pipe.yaml");
    await runInit([
      "--name",
      "prod",
      "--url",
      "https://x/console/api",
      "--email",
      "a@b.com",
      "--password",
      "secret",
      "-o",
      out,
    ]);

    expect(exitCode).toBe(0);
    const raw = parseYaml(readFileSync(out, "utf-8"));
    const inst = raw.instances.find(
      (i: { name: string }) => i.name === "prod",
    );
    expect(inst.email).toBe("a@b.com");
    expect(inst.password).toBe("secret");
    expect(inst.token).toBeUndefined();
  });

  it("--workspace 与 --storage-path 写入 profile", async () => {
    const out = join(dir, "dify-pipe.yaml");
    await runInit([
      "--name",
      "prod",
      "--url",
      "https://x/console/api",
      "--token",
      "t",
      "--workspace",
      "ws-123",
      "--storage-path",
      "/data/backup",
      "-o",
      out,
    ]);

    expect(exitCode).toBe(0);
    const raw = parseYaml(readFileSync(out, "utf-8"));
    expect(raw.profiles.prod.workspace).toBe("ws-123");
    expect(raw.profiles.prod.storage.path).toBe("/data/backup");
  });

  it("--json 成功时 stdout 仅输出 {success:true,path}", async () => {
    const out = join(dir, "dify-pipe.yaml");
    await runInit([
      "--name",
      "prod",
      "--url",
      "https://x/console/api",
      "--token",
      "t",
      "--json",
      "-o",
      out,
    ]);

    expect(exitCode).toBe(0);
    expect(stdoutLines).toHaveLength(1);
    const parsed = JSON.parse(stdoutLines[0]);
    expect(parsed.success).toBe(true);
    expect(parsed.path).toBe(out);
  });

  it("--json 失败时 stdout 输出 PipeError 信封，exit 1", async () => {
    const out = join(dir, "dify-pipe.yaml");
    await runInit([
      "--name",
      "prod",
      "--url",
      "https://x/console/api",
      "--json",
      "-o",
      out,
    ]);

    expect(exitCode).toBe(1);
    expect(stdoutLines).toHaveLength(1);
    const parsed = JSON.parse(stdoutLines[0]);
    expect(parsed.success).toBe(false);
    expect(parsed.code).toBe("ERR_CONFIG_INVALID");
    expect(existsSync(out)).toBe(false);
  });
});
