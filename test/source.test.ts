import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listDslFiles, parseFilterExpr, resolveSourceStorage } from "../src/core/source.js";
import { LocalStorage } from "../src/storage/local.js";

describe("listDslFiles", () => {
  it("只返回 .yml/.yaml，跳过 _versions/、.orig、状态文件", async () => {
    const dir = mkdtempSync(join(tmpdir(), "src-"));
    mkdirSync(join(dir, "workflow/app_versions"), { recursive: true });
    writeFileSync(join(dir, "workflow/app.yml"), "a");
    writeFileSync(join(dir, "workflow/app.yaml"), "b");
    writeFileSync(join(dir, "workflow/app_versions/v1.yml"), "c");
    writeFileSync(join(dir, "workflow/app.yml.orig"), "d");
    writeFileSync(join(dir, ".dify-pipe-state.json"), "{}");
    writeFileSync(join(dir, "workflow/readme.md"), "x");

    const storage = new LocalStorage({ path: dir });
    const files = await listDslFiles(storage);
    expect(files.sort()).toEqual(["workflow/app.yaml", "workflow/app.yml"]);
  });

  it("prefix 限定时只列前缀下文件", async () => {
    const dir = mkdtempSync(join(tmpdir(), "src-"));
    mkdirSync(join(dir, "sub"), { recursive: true });
    writeFileSync(join(dir, "a.yml"), "a");
    writeFileSync(join(dir, "sub/b.yml"), "b");

    const storage = new LocalStorage({ path: dir });
    const files = await listDslFiles(storage, "sub");
    expect(files).toEqual(["sub/b.yml"]);
  });
});

describe("parseFilterExpr", () => {
  it("解析 type/tag/name，逗号分隔，value 可含冒号", () => {
    const f = parseFilterExpr("type:workflow,tag:核心,name:a:b");
    expect(f).toEqual({ types: ["workflow"], tags: ["核心"], names: ["a:b"] });
  });

  it("未命中 key 或空 value 被忽略；无有效项返回 undefined", () => {
    expect(parseFilterExpr("foo:bar,type:")).toBeUndefined();
    expect(parseFilterExpr("type:chat")).toEqual({ types: ["chat"] });
  });

  it("空输入返回 undefined", () => {
    expect(parseFilterExpr(undefined)).toBeUndefined();
    expect(parseFilterExpr("")).toBeUndefined();
  });
});

describe("resolveSourceStorage", () => {
  const baseFlags = {
    storage: "local",
    source: "./backup/prod",
  };

  it("config.defaults.storage 存在时优先返回它（fromConfig=true）", () => {
    const config = {
      instances: [],
      profiles: {},
      defaults: { storage: { type: "local" as const, path: "/cfg/storage" } },
    };
    const r = resolveSourceStorage(baseFlags, config);
    expect(r.fromConfig).toBe(true);
    expect(r.storage).toEqual({ type: "local", path: "/cfg/storage" });
  });

  it("无 defaults.storage 时按 flags 构建 local（fromConfig=false）", () => {
    const config = { instances: [], profiles: {} };
    const r = resolveSourceStorage(baseFlags, config);
    expect(r.fromConfig).toBe(false);
    expect(r.storage).toEqual({ type: "local", path: "./backup/prod" });
  });

  it("无 defaults.storage 时按 flags 构建 s3（fromConfig=false）", () => {
    const config = { instances: [], profiles: {} };
    const r = resolveSourceStorage(
      { ...baseFlags, storage: "s3", s3Bucket: "b", s3AccessKey: "ak", s3SecretKey: "sk" },
      config
    );
    expect(r.fromConfig).toBe(false);
    expect(r.storage.type).toBe("s3");
  });
});
