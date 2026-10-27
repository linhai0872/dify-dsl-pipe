# 定时备份服务

← [返回 README](../README.md)

`serve` 命令启动一个轻量 HTTP API 服务，支持通过 REST 接口管理定时备份任务，适合部署在服务器上做持续自动备份。

---

## 启动服务

```bash
# 单实例（最简）
npx dify-dsl-pipe serve --url https://dify.example.com/console/api --token TOKEN

# 多实例（推荐用配置文件）
npx dify-dsl-pipe serve --config dify-pipe.yaml

# 自定义端口和对外暴露（注意：当前无内置认证，自行做访问控制）
npx dify-dsl-pipe serve --config dify-pipe.yaml --port 8080 --host 0.0.0.0

# 带 Webhook 通知
npx dify-dsl-pipe serve --config dify-pipe.yaml \
  --webhook https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx
```

服务默认只监听 `127.0.0.1:3000`（本地安全），对外暴露时加 `--host 0.0.0.0`。

---

## 进程管理

建议用 pm2 或 systemd 管理进程，避免终端关闭后服务退出：

```bash
# pm2
npm install -g pm2
pm2 start "npx dify-dsl-pipe serve --config dify-pipe.yaml" --name dify-backup
pm2 save && pm2 startup

# systemd（/etc/systemd/system/dify-backup.service）
[Unit]
Description=dify-dsl-pipe backup service

[Service]
ExecStart=npx dify-dsl-pipe serve --config /opt/dify-pipe.yaml
Restart=on-failure
WorkingDirectory=/opt

[Install]
WantedBy=multi-user.target
```

---

## HTTP API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/status` | 服务状态、已连实例列表、uptime |
| `POST` | `/export` | 立即触发一次导出 |
| `POST` | `/import` | 立即触发一次导入 |
| `GET` | `/jobs` | 列出所有定时任务 |
| `POST` | `/jobs` | 创建定时任务 |
| `DELETE` | `/jobs/:id` | 删除定时任务 |

---

## 管理定时任务

### 创建任务

```bash
# 每天凌晨 2 点自动导出 prod 实例
curl -X POST http://localhost:3000/jobs \
  -H "content-type: application/json" \
  -d '{"cron": "0 2 * * *", "action": "export", "instance": "prod"}'

# 每小时导出
curl -X POST http://localhost:3000/jobs \
  -H "content-type: application/json" \
  -d '{"cron": "0 * * * *", "action": "export"}'
```

请求体字段：

| 字段 | 必填 | 说明 |
|------|------|------|
| `cron` | ✅ | cron 表达式（5 段，标准格式） |
| `action` | ✅ | `export` 或 `import` |
| `instance` | — | 指定实例名，不填则使用第一个实例 |

### 常用 cron 表达式

| 表达式 | 含义 |
|--------|------|
| `0 2 * * *` | 每天凌晨 2 点 |
| `0 * * * *` | 每小时整点 |
| `0 3 * * 1` | 每周一凌晨 3 点 |
| `0 2 * * 1,5` | 每周一、五凌晨 2 点 |
| `*/30 * * * *` | 每 30 分钟 |

### 查看任务列表

```bash
curl http://localhost:3000/jobs
```

### 删除任务

```bash
curl -X DELETE http://localhost:3000/jobs/<job-id>
```

---

## Webhook 通知

服务支持在任务完成时推送通知。根据 Webhook 地址自动选择消息格式：

| 渠道 | 识别的地址 | 消息体 |
|------|-----------|--------|
| 企业微信 | `qyapi.weixin.qq.com` | `{"msgtype":"text","text":{"content":"..."}}` |
| 钉钉 | `oapi.dingtalk.com` | `{"msgtype":"text","text":{"content":"..."}}` |
| 飞书 / Lark | `open.feishu.cn` / `open.larksuite.com` | `{"msg_type":"text","content":{"text":"..."}}` |
| Slack | `hooks.slack.com` | `{"text":"..."}` |
| 其他 | 任意 HTTP POST 地址 | `{"text":"...","content":"..."}` |

发送失败（HTTP 非 2xx、跳转，或企业微信 / 钉钉 / 飞书响应体里的错误码非 0）会在服务日志中输出警告，日志里的 Webhook 地址只保留域名。钉钉机器人的「加签」安全设置暂不支持，请改用「自定义关键词」或「IP 地址段」；使用关键词时，消息以「导出完成」「导入完成」「任务失败」开头。

```bash
# 企业微信
npx dify-dsl-pipe serve --config dify-pipe.yaml \
  --webhook "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx"

# Slack
npx dify-dsl-pipe serve --config dify-pipe.yaml \
  --webhook "https://hooks.slack.com/services/xxx/yyy/zzz"
```

或在配置文件中设置：

```yaml
defaults:
  notification:
    webhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx"
    onFailure: true
    onSuccess: false
```
