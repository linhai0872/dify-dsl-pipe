# CLI 完整参数参考

> 工具主页：https://github.com/linhai0872/dify-dsl-pipe

---

## export

导出 Dify 应用 DSL。

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--url <url>` | — | Dify Console API 地址（必须以 `/console/api` 结尾） |
| `--token <token>` | — | Access Token（与 email+password 二选一） |
| `--email <email>` | — | 登录邮箱 |
| `--password <password>` | — | 登录密码 |
| `--profile <name>` | — | 使用配置文件中的 profile |
| `-c, --config <path>` | — | 配置文件路径 |
| `-o, --out <path>` | `./dify-backup` | 本地输出目录 |
| `--storage <type>` | `local` | 存储类型：`local` / `s3` / `git` |
| `--s3-bucket <bucket>` | — | S3 Bucket 名称 |
| `--s3-endpoint <endpoint>` | — | S3 端点（兼容各云厂商） |
| `--s3-region <region>` | `us-east-1` | S3 区域 |
| `--s3-access-key <key>` | — | S3 Access Key ID |
| `--s3-secret-key <key>` | — | S3 Secret Access Key |
| `--s3-force-path-style` | `false` | 强制 Path Style（MinIO 必须开启） |
| `--git-repo <path>` | — | Git 仓库路径或 URL |
| `--git-branch <branch>` | `main` | Git 分支 |
| `--pattern <pattern>` | `by-type` | 文件命名预设：`flat` / `by-type` / `by-tag` / `by-workspace` / `full` |
| `--filter <expr>` | — | 过滤表达式，如 `type:workflow,tag:核心,name:关键词` |
| `--include-secret` | `false` | 包含敏感信息（API Key 等） |
| `--no-include-secret` | — | 不包含敏感信息（默认） |
| `--include-versions` | `true` | 包含版本历史（默认） |
| `--no-include-versions` | — | 不包含版本历史（加速导出） |
| `--incremental` | `false` | 增量导出（只导出有变更的应用） |
| `--archive <format>` | `none` | 打包格式：`none` / `zip` |
| `--workspace <id>` | — | 指定 Workspace ID |
| `--json` | `false` | JSON 格式输出（供程序解析） |
| `--verbose` | `false` | 详细日志 |

---

## import

导入 DSL 到 Dify 实例。

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--url <url>` | — | 目标 Dify Console API 地址 |
| `--token <token>` | — | Access Token |
| `--email <email>` | — | 登录邮箱 |
| `--password <password>` | — | 登录密码 |
| `--profile <name>` | — | 使用配置文件中的 profile |
| `-c, --config <path>` | — | 配置文件路径 |
| `-s, --source <path>` | `./dify-backup` | DSL 源目录或前缀 |
| `--storage <type>` | `local` | 源存储类型：`local` / `s3` / `git` |
| `--s3-bucket <bucket>` | — | S3 Bucket |
| `--s3-endpoint <endpoint>` | — | S3 端点 |
| `--s3-region <region>` | `us-east-1` | S3 区域 |
| `--s3-access-key <key>` | — | S3 Access Key ID |
| `--s3-secret-key <key>` | — | S3 Secret Access Key |
| `--git-repo <path>` | — | Git 仓库路径或 URL |
| `--git-branch <branch>` | `main` | Git 分支 |
| `--on-conflict <strategy>` | `skip` | 冲突策略：`skip`（跳过）/ `overwrite`（覆盖） |
| `--dry-run` | `false` | 预览模式，不实际导入 |
| `--workspace <id>` | — | 指定 Workspace ID |
| `--json` | `false` | JSON 格式输出 |
| `--verbose` | `false` | 详细日志 |

---

## serve

启动 HTTP API 服务或 MCP Server。

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--mcp` | `false` | 以 MCP Server 模式启动（stdio transport） |
| `--port <port>` | `3000` | HTTP 端口 |
| `--host <host>` | `127.0.0.1` | 绑定地址（对外暴露用 `0.0.0.0`） |
| `--url <url>` | — | Dify Console API 地址 |
| `--token <token>` | — | Access Token |
| `--email <email>` | — | 登录邮箱 |
| `--password <password>` | — | 登录密码 |
| `--profile <name>` | — | 使用配置文件中的 profile |
| `-c, --config <path>` | — | 配置文件路径（多实例时推荐） |
| `--storage <type>` | `local` | 存储类型 |
| `--s3-*` | — | 同 export 的 S3 参数 |
| `--git-*` | — | 同 export 的 Git 参数 |
| `-o, --out <path>` | `./dify-backup` | 本地输出目录 |
| `--pattern <pattern>` | `by-type` | 文件命名预设 |
| `--webhook <url>` | — | 任务完成通知地址（Slack/企业微信/钉钉/通用 HTTP POST） |
| `--verbose` | `false` | 详细日志 |

### HTTP API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/status` | 运行状态、已连实例列表、uptime |
| POST | `/export` | 立即触发导出 |
| POST | `/import` | 立即触发导入 |
| GET | `/jobs` | 列出所有定时任务 |
| POST | `/jobs` | 创建定时任务 `{"cron":"0 2 * * *","action":"export","instance":"prod"}` |
| DELETE | `/jobs/:id` | 删除定时任务 |

### MCP 暴露的工具

| 工具名 | 说明 |
|--------|------|
| `list_instances` | 列出已连接的 Dify 实例 |
| `list_apps` | 列出指定实例的所有应用 |
| `export_apps` | 导出应用 DSL（支持 filter、incremental） |
| `import_apps` | 导入 DSL（支持 onConflict、dryRun） |

---

## init

交互式创建 `dify-pipe.yaml` 配置文件。无额外参数，直接运行：

```bash
npx dify-dsl-pipe init
```

## presets

列出可用的文件命名预设：

```bash
npx dify-dsl-pipe presets
```

预设说明：

| 预设 | 路径格式 |
|------|---------|
| `flat` | `AppName.yml` |
| `by-type` | `workflow/AppName.yml`（默认） |
| `by-tag` | `标签名/AppName.yml` |
| `by-workspace` | `WorkspaceName/AppName.yml` |
| `full` | `WorkspaceName/type/AppName.yml` |
