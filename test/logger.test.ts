import { describe, it, expect, vi, afterEach } from "vitest";
import { log, setJsonMode, setLogLevel } from "../src/utils/logger.js";

describe("logger JSON 模式", () => {
  afterEach(() => {
    setJsonMode(false);
    setLogLevel("info");
    vi.restoreAllMocks();
  });

  it("JSON 模式下日志走 stderr（console.error），stdout（console.log）无输出", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    setJsonMode(true);
    log.info("hello", { a: 1 });
    log.warn("w");
    log.error("e");

    expect(logSpy).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalledTimes(3);
    const first = JSON.parse(errSpy.mock.calls[0][0] as string);
    expect(first).toMatchObject({ level: "info", msg: "hello", a: 1 });
    expect(first.ts).toBeDefined();
  });

  it("非 JSON 模式保持 console.error 输出（现有行为不变）", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    log.info("plain");
    expect(logSpy).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(String(errSpy.mock.calls[0][0])).toContain("plain");
  });
});
