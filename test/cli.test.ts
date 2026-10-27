import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

// 直接跑源码入口：CI / pre-push 在 build 之前（或并行）跑测试，不能依赖 dist
const ENTRY = join(__dirname, "..", "src", "index.ts");

describe("CLI --help", () => {
  it("列出全部 7 个子命令（含 lint / migrate / diff）", () => {
    const out = execFileSync(process.execPath, ["--import", "tsx", ENTRY, "--help"], { encoding: "utf-8" });
    for (const cmd of ["export", "import", "init", "serve", "lint", "migrate", "diff"]) {
      expect(out).toMatch(new RegExp(`\\b${cmd}\\b`));
    }
  });
});
