import { describe, it, expect, vi, afterEach } from "vitest";
import { LegacyAdapter } from "../src/core/legacy-adapter.js";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function newAdapter() {
  return new LegacyAdapter({
    baseUrl: "http://x/console/api",
    token: "t",
    timeout: 30,
    maxRetries: 0,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LegacyAdapter.exportAppDSL", () => {
  it("sends format=yaml (ignored by old versions) and returns YAML text", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const u = new URL(String(url));
      expect(u.searchParams.get("format")).toBe("yaml");
      return jsonResponse({ data: "app: yaml-text" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = newAdapter();
    const result = await adapter.exportAppDSL("app1", false);

    expect(result).toBe("app: yaml-text");
  });
});

describe("LegacyAdapter.importAppDSL", () => {
  it("throws ERR_VERSION_UNSUPPORTED (Dify < 0.12 无 DSL 导入 API)", async () => {
    const adapter = newAdapter();
    await expect(adapter.importAppDSL("dsl-yaml")).rejects.toMatchObject({
      code: "ERR_VERSION_UNSUPPORTED",
    });
    await expect(adapter.importAppDSL("dsl-yaml")).rejects.toThrow("仅支持导出备份");
  });
});

describe("LegacyAdapter.publishWorkflow", () => {
  it("throws ERR_VERSION_UNSUPPORTED", async () => {
    const adapter = newAdapter();
    await expect(adapter.publishWorkflow("app1")).rejects.toMatchObject({
      code: "ERR_VERSION_UNSUPPORTED",
    });
    await expect(adapter.publishWorkflow("app1")).rejects.toThrow("仅支持导出备份");
  });
});
