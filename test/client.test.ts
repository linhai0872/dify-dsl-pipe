import { describe, it, expect } from "vitest";
import { resolveAdapterType } from "../src/core/client.js";

// 版本 → adapter 选择边界。
// 实测（test/compat，2026-08-25）：
//   - 0.12.0 起 Dify 引入两阶段导入 POST /apps/imports（+confirm），与 Modern 一致；
//     核心端点（/apps、/apps/{id}/export、login）在 0.12.0~1.x 完全一致。
//   - Legacy 的同步 POST /apps/import（单数）对 0.12.0~0.15.3 返回 404 —— 这些版本必须走 Modern。
//   - < 0.12.0 无 DSL 导入 API，保留 Legacy（仅 export/list 可用）。
describe("resolveAdapterType", () => {
  it("0.12.0 及以后走 modern（两阶段导入）", () => {
    expect(resolveAdapterType("0.12.0")).toBe("modern");
    expect(resolveAdapterType("0.13.0")).toBe("modern");
    expect(resolveAdapterType("0.15.3")).toBe("modern");
    expect(resolveAdapterType("1.0.0")).toBe("modern");
    expect(resolveAdapterType("1.16.1")).toBe("modern");
  });

  it("0.12.0 之前走 legacy", () => {
    expect(resolveAdapterType("0.11.2")).toBe("legacy");
    expect(resolveAdapterType("0.10.1")).toBe("legacy");
    expect(resolveAdapterType("0.6.0")).toBe("legacy");
  });

  it("低于最低支持版本抛错", () => {
    expect(() => resolveAdapterType("0.5.0")).toThrow(/不受支持/);
  });

  it("无法解析的版本按 modern 处理", () => {
    expect(resolveAdapterType("unknown")).toBe("modern");
  });
});
