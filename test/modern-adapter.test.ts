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

function newPasswordAdapter(version?: string) {
  return new ModernAdapter({
    baseUrl: "http://x/console/api",
    email: "a@b.c",
    password: "secret",
    timeout: 30,
    maxRetries: 0,
    version,
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

    expect(result).toEqual({ appId: "app1", status: "completed", importId: "imp1", warnings: [] });

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
    expect(result.warnings).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats completed-with-warnings as success and returns the warnings", async () => {
    const warnings = [
      { code: "plugin_missing", path: "graph.nodes[0]", message: "缺少插件 a" },
      { code: "model_missing", message: "缺少模型 b" },
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ app_id: "app3", status: "completed-with-warnings", warnings }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = newAdapter();
    const result = await adapter.importAppDSL("dsl-yaml");

    expect(result.appId).toBe("app3");
    expect(result.status).toBe("completed-with-warnings");
    expect(result.warnings).toEqual(warnings);
  });

  it("reads warnings from the confirm response when status was pending", async () => {
    const warnings = [{ code: "plugin_missing", message: "缺少插件 a" }];
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/confirm")) {
        return jsonResponse({ app_id: "app1", status: "completed-with-warnings", warnings });
      }
      return jsonResponse({ id: "imp1", status: "pending" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = newAdapter();
    const result = await adapter.importAppDSL("dsl-yaml");

    expect(result.status).toBe("completed-with-warnings");
    expect(result.warnings).toEqual(warnings);
  });

  it("throws with Dify's error field when status is failed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ status: "failed", error: "Invalid DSL version" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = newAdapter();
    await expect(adapter.importAppDSL("dsl-yaml")).rejects.toThrow("Invalid DSL version");
  });
});

describe("ModernAdapter.login", () => {
  it("retries with the alternate password encoding after a 401", async () => {
    const passwords: string[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      passwords.push(JSON.parse(init!.body as string).password);
      if (passwords.length === 1) {
        return new Response("unauthorized", { status: 401 });
      }
      return jsonResponse({ result: "success", data: { access_token: "tok" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    // version 不设置 → coerce fallback "1.0.0" < 1.11.2 → 先明文，401 后换 base64
    const adapter = newPasswordAdapter();
    await adapter.login();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(passwords[0]).toBe("secret");
    expect(passwords[1]).toBe(Buffer.from("secret").toString("base64"));
  });

  it("does not retry on non-401 errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("server error", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = newPasswordAdapter();
    await expect(adapter.login()).rejects.toThrow("HTTP 500");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("ModernAdapter.exportAppDSL", () => {
  it("sends format=yaml and returns YAML text on Dify 1.18", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const u = new URL(String(url));
      if (u.searchParams.get("format") !== "yaml") {
        // 模拟 1.18：无 format → 二进制 zip
        return new Response(new Uint8Array([0x50, 0x4b]), {
          status: 200,
          headers: { "content-type": "application/zip" },
        });
      }
      return jsonResponse({ data: "app: yaml-text" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = newAdapter();
    const result = await adapter.exportAppDSL("app1", false);

    expect(result).toBe("app: yaml-text");
    const calledUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(calledUrl.searchParams.get("format")).toBe("yaml");
  });
});

describe("ModernAdapter.checkImportDependencies", () => {
  it("GET /apps/imports/{appId}/check-dependencies returns leaked_dependencies", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ leaked_dependencies: [{ name: "p" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = newAdapter();
    const result = await adapter.checkImportDependencies("app9");

    expect(String(fetchMock.mock.calls[0][0])).toContain("/apps/imports/app9/check-dependencies");
    expect(result.leaked).toEqual([{ name: "p" }]);
  });

  it("returns empty leaked on missing endpoint (old version)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    const adapter = newAdapter();
    const result = await adapter.checkImportDependencies("app9");
    expect(result.leaked).toEqual([]);
  });
});

describe("ModernAdapter.publishWorkflow", () => {
  it("POSTs to /apps/{id}/workflows/publish with empty object body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ result: "success" }));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = newAdapter();
    await adapter.publishWorkflow("app7");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/apps/app7/workflows/publish");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({});
  });

  it("propagates errors (403 → ERR_FORBIDDEN)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("forbidden", { status: 403 })),
    );
    const adapter = newAdapter();
    await expect(adapter.publishWorkflow("app7")).rejects.toMatchObject({
      code: "ERR_FORBIDDEN",
    });
  });
});
