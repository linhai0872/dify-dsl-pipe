import { describe, it, expect, vi, afterEach } from "vitest";
import { ModernAdapter } from "../src/core/modern-adapter.js";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function newAdapter() {
  return new ModernAdapter({
    baseUrl: "http://x/console/api",
    token: "t",
    timeout: 30,
    maxRetries: 0,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ModernAdapter.importAppDSL", () => {
  it("sends kebab-case import mode and yaml_content in the request body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ app_id: "app2", status: "completed" }));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = newAdapter();
    await adapter.importAppDSL("dsl-yaml", { name: "foo" });

    expect(fetchMock).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/apps/imports");

    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.mode).toBe("yaml-content");
    expect(sentBody.yaml_content).toBe("dsl-yaml");
    expect(sentBody.name).toBe("foo");
  });

  it("confirms the import when status is lowercase pending", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/confirm")) {
        return jsonResponse({ app_id: "app1", status: "completed" });
      }
      return jsonResponse({ id: "imp1", status: "pending" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = newAdapter();
    const result = await adapter.importAppDSL("dsl-yaml", { name: "foo" });

    expect(result).toEqual({ appId: "app1", status: "completed", importId: "imp1" });

    const confirmCalled = fetchMock.mock.calls.some(([url]) =>
      String(url).includes("/apps/imports/imp1/confirm"),
    );
    expect(confirmCalled).toBe(true);
  });

  it("returns appId directly when import completes without pending", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ app_id: "app2", status: "completed" }));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = newAdapter();
    const result = await adapter.importAppDSL("dsl-yaml");

    expect(result.appId).toBe("app2");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("ModernAdapter.checkImportDependencies", () => {
  it("GET /apps/imports/{id}/check-dependencies returns leaked_dependencies", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ leaked_dependencies: [{ name: "p" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = newAdapter();
    const result = await adapter.checkImportDependencies("imp1");

    expect(String(fetchMock.mock.calls[0][0])).toContain("/apps/imports/imp1/check-dependencies");
    expect(result.leaked).toEqual([{ name: "p" }]);
  });

  it("returns empty leaked on missing endpoint (old version)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    const adapter = newAdapter();
    const result = await adapter.checkImportDependencies("imp1");
    expect(result.leaked).toEqual([]);
  });
});
