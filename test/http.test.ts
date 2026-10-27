import { describe, it, expect, vi, afterEach } from "vitest";
import { HttpClient, HttpError } from "../src/core/http.js";
import { PipeError } from "../src/core/errors.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HttpClient error handling", () => {
  it("throws HttpError carrying the status for >= 400", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("bad request body", { status: 400 })),
    );
    const client = new HttpClient("http://x/console/api", 30, 0);

    const err = await client.get("/apps").catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(400);
    expect(err.message).toContain("HTTP 400");
    expect(err.message).toContain("bad request body");
  });

  it("turns 403 into PipeError ERR_FORBIDDEN with the original text and RBAC hint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("permission denied", { status: 403 })),
    );
    const client = new HttpClient("http://x/console/api", 30, 0);

    const err = await client.get("/apps").catch((e) => e);
    expect(err).toBeInstanceOf(PipeError);
    expect(err.code).toBe("ERR_FORBIDDEN");
    expect(err.message).toContain("HTTP 403");
    expect(err.message).toContain("permission denied");
    expect(err.message).toContain("可能是 RBAC 权限不足");
    // 调用方可按 status 分支（经 cause 上的 HttpError）
    expect((err.cause as HttpError).status).toBe(403);
  });

  it("retries 429 then succeeds (retry behaviour unchanged)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new HttpClient("http://x/console/api", 30, 3);
    const res = await client.get("/apps");
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 10000);
});
