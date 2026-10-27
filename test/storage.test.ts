import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalStorage } from "../src/storage/local.js";

describe("LocalStorage.write", () => {
  it("string 按 utf-8 写入", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stor-"));
    const s = new LocalStorage({ path: dir });
    await s.write("a/b.txt", "你好");
    expect(readFileSync(join(dir, "a/b.txt"), "utf-8")).toBe("你好");
  });

  it("Buffer 按二进制写入（zip 头不被转码）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stor-"));
    const s = new LocalStorage({ path: dir });
    const buf = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00, 0xfe]);
    await s.write("out.zip", buf);
    const onDisk = readFileSync(join(dir, "out.zip"));
    expect(onDisk).toEqual(buf);
    expect(onDisk[0]).toBe(0x50);
    expect(onDisk[1]).toBe(0x4b);
  });
});

describe("LocalStorage.list", () => {
  it("悬空软链接被跳过，其余文件照常列出", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stor-"));
    writeFileSync(join(dir, "a.yml"), "x");
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub/b.yml"), "y");
    symlinkSync(join(dir, "gone"), join(dir, "sub/dangling"));

    const s = new LocalStorage({ path: dir });
    expect((await s.list()).sort()).toEqual(["a.yml", "sub/b.yml"]);
  });
});
