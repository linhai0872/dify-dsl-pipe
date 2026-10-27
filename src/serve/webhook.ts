import { log } from "../utils/logger.js";

type Channel = "wecom" | "dingtalk" | "feishu" | "slack" | "generic";

function detectChannel(url: URL): Channel {
  const host = url.hostname;
  if (host === "qyapi.weixin.qq.com") return "wecom";
  if (host === "oapi.dingtalk.com") return "dingtalk";
  if (host === "open.feishu.cn" || host === "open.larksuite.com") return "feishu";
  if (host === "hooks.slack.com") return "slack";
  return "generic";
}

function buildBody(channel: Channel, message: string): unknown {
  switch (channel) {
    case "wecom":
    case "dingtalk":
      return { msgtype: "text", text: { content: message } };
    case "feishu":
      return { msg_type: "text", content: { text: message } };
    case "slack":
      return { text: message };
    default:
      return { text: message, content: message };
  }
}

/** 企业微信 / 钉钉 / 飞书出错时也返回 HTTP 200，错误在响应体里 */
function bodyError(channel: Channel, text: string): string | undefined {
  if (channel !== "wecom" && channel !== "dingtalk" && channel !== "feishu") return undefined;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (channel === "feishu") {
    const code = data.code ?? data.StatusCode;
    if (code !== undefined && code !== 0) return `code ${code}: ${data.msg ?? data.StatusMessage ?? ""}`;
    return undefined;
  }
  if (data.errcode !== undefined && data.errcode !== 0) return `errcode ${data.errcode}: ${data.errmsg ?? ""}`;
  return undefined;
}

/** webhook 的密钥在 path 或 query 里，日志只保留 origin */
function redact(url: URL): string {
  return `${url.origin}/***`;
}

/** 按 URL 识别 IM 渠道并发送文本消息；失败只告警不抛出，返回是否送达 */
export async function sendWebhook(webhookUrl: string, message: string): Promise<boolean> {
  const url = new URL(webhookUrl);
  const channel = detectChannel(url);
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildBody(channel, message)),
      // 无效的 Slack webhook 会 302 到 api.slack.com 的 200 页面，跟随跳转会误判为送达
      redirect: "manual",
    });
    const text = await res.text();
    const error = res.ok ? bodyError(channel, text) : `HTTP ${res.status}: ${text.slice(0, 200)}`;
    if (error) {
      log.warn(`Webhook 通知发送失败 (${redact(url)}): ${error}`);
      return false;
    }
    return true;
  } catch (e) {
    log.warn(`Webhook 通知发送失败 (${redact(url)}): ${e instanceof Error ? e.message : e}`);
    return false;
  }
}
