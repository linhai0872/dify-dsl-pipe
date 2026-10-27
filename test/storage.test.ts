import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
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
