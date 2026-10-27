import { describe, it, expect, vi, afterEach } from "vitest";
import { sendWebhook } from "../src/serve/webhook.js";

const WECOM = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=wecom-secret";
const DINGTALK = "https://oapi.dingtalk.com/robot/send?access_token=ding-secret";
const FEISHU = "https://open.feishu.cn/open-apis/bot/v2/hook/feishu-secret";
const LARK = "https://open.larksuite.com/open-apis/bot/v2/hook/lark-secret";
const SLACK = "https://hooks.slack.com/services/T000/B000/slack-secret";
const GENERIC = "https://example.com/notify?token=generic-secret";

function stubFetch(response: Response | Error) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sentBody(fetchMock: ReturnType<typeof stubFetch>) {
  return JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sendWebhook 渠道格式", () => {
  it("企业微信用 msgtype=text", async () => {
    const fetchMock = stubFetch(json({ errcode: 0, errmsg: "ok" }));
    expect(await sendWebhook(WECOM, "导出完成")).toBe(true);
    expect(sentBody(fetchMock)).toEqual({ msgtype: "text", text: { content: "导出完成" } });
  });

  it("钉钉用 msgtype=text", async () => {
    const fetchMock = stubFetch(json({ errcode: 0, errmsg: "ok" }));
    expect(await sendWebhook(DINGTALK, "导出完成")).toBe(true);
    expect(sentBody(fetchMock)).toEqual({ msgtype: "text", text: { content: "导出完成" } });
  });

  it.each([FEISHU, LARK])("飞书 / Lark 用 msg_type=text: %s", async (url) => {
    const fetchMock = stubFetch(json({ code: 0, msg: "success" }));
    expect(await sendWebhook(url, "导出完成")).toBe(true);
    expect(sentBody(fetchMock)).toEqual({ msg_type: "text", content: { text: "导出完成" } });
  });

  it("Slack 用 text", async () => {
    const fetchMock = stubFetch(new Response("ok", { status: 200 }));
    expect(await sendWebhook(SLACK, "导出完成")).toBe(true);
    expect(sentBody(fetchMock)).toEqual({ text: "导出完成" });
  });

  it("其他地址保持 text + content 兼容格式", async () => {
    const fetchMock = stubFetch(new Response(null, { status: 204 }));
    expect(await sendWebhook(GENERIC, "导出完成")).toBe(true);
    expect(sentBody(fetchMock)).toEqual({ text: "导出完成", content: "导出完成" });
  });
});

describe("sendWebhook 失败可见且不泄露密钥", () => {
  function captureLogs() {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    return () => errSpy.mock.calls.map((c) => c.join(" ")).join("\n");
  }

  it("HTTP 非 2xx 返回 false 并警告", async () => {
    const logs = captureLogs();
    stubFetch(new Response("invalid_token", { status: 403 }));
    expect(await sendWebhook(SLACK, "x")).toBe(false);
    expect(logs()).toContain("403");
    expect(logs()).not.toContain("slack-secret");
  });

  it("跳转视为失败（无效 Slack webhook 会 302）", async () => {
    const logs = captureLogs();
    const fetchMock = stubFetch(new Response(null, { status: 302, headers: { location: "https://api.slack.com/" } }));
    expect(await sendWebhook(SLACK, "x")).toBe(false);
    expect(fetchMock.mock.calls[0][1]!.redirect).toBe("manual");
    expect(logs()).toContain("302");
  });

  it("企业微信 200 但 errcode 非 0 视为失败", async () => {
    const logs = captureLogs();
    stubFetch(json({ errcode: 93000, errmsg: "invalid webhook url" }));
    expect(await sendWebhook(WECOM, "x")).toBe(false);
    expect(logs()).toContain("invalid webhook url");
    expect(logs()).not.toContain("wecom-secret");
  });

  it("钉钉关键词校验失败视为失败", async () => {
    const logs = captureLogs();
    stubFetch(json({ errcode: 310000, errmsg: "keywords not in content" }));
    expect(await sendWebhook(DINGTALK, "x")).toBe(false);
    expect(logs()).toContain("keywords not in content");
    expect(logs()).not.toContain("ding-secret");
  });

  it("飞书 200 但 code 非 0 视为失败", async () => {
    const logs = captureLogs();
    stubFetch(json({ code: 19001, msg: "param invalid: incoming webhook access token invalid" }));
    expect(await sendWebhook(FEISHU, "x")).toBe(false);
    expect(logs()).toContain("19001");
    expect(logs()).not.toContain("feishu-secret");
  });

  it("网络异常不抛出，返回 false 并警告", async () => {
    const logs = captureLogs();
    stubFetch(new TypeError("fetch failed"));
    expect(await sendWebhook(GENERIC, "x")).toBe(false);
    expect(logs()).toContain("fetch failed");
    expect(logs()).not.toContain("generic-secret");
  });
});
