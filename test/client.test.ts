import { describe, it, expect, vi, afterEach } from "vitest";
import { DifyClient, resolveAdapterType } from "../src/core/client.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

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

describe("DifyClient passthrough", () => {
  function jsonResponse(body: unknown) {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json", "x-version": "1.18.0" },
    });
  }

  async function connectedClient() {
    const client = new DifyClient({
      baseUrl: "http://x/console/api",
      token: "t",
      timeout: 30,
      maxRetries: 0,
    });
    await client.connect();
    return client;
  }

  it("publishWorkflow POSTs /apps/{id}/workflows/publish", async () => {
    const fetchMock = vi.fn((_url: unknown) =>
      Promise.resolve(jsonResponse({ result: "success" })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = await connectedClient();
    await client.publishWorkflow("app7");

    const publishCall = fetchMock.mock.calls.find(([u]) =>
      String(u).includes("/apps/app7/workflows/publish"),
    );
    expect(publishCall).toBeDefined();
  });

  it("importAppDSL returns the new shape with warnings", async () => {
    const warnings = [{ code: "w", message: "m" }];
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/apps/imports")) {
        return jsonResponse({ app_id: "app1", status: "completed-with-warnings", warnings });
      }
      return jsonResponse({ data: [], total: 0, has_more: false });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = await connectedClient();
    const result = await client.importAppDSL("dsl-yaml");

    expect(result.appId).toBe("app1");
    expect(result.status).toBe("completed-with-warnings");
    expect(result.warnings).toEqual(warnings);
  });

  it("checkImportDependencies passes through to the adapter", async () => {
    const fetchMock = vi.fn((_url: unknown) =>
      Promise.resolve(jsonResponse({ leaked_dependencies: [{ name: "p" }] })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = await connectedClient();
    const result = await client.checkImportDependencies("app9");

    expect(result.leaked).toEqual([{ name: "p" }]);
  });
});
