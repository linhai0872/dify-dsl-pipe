# CLI 参数参考

← [返回 README](../README.md)

---

## export

导出 Dify 应用 DSL 到指定存储。

```bash
npx dify-dsl-pipe export [options]
```

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
| `--s3-endpoint <endpoint>` | — | S3 端点（各云厂商见[存储文档](storage.md)） |
| `--s3-region <region>` | `us-east-1` | S3 区域 |
| `--s3-access-key <key>` | — | S3 Access Key ID（或环境变量 `AWS_ACCESS_KEY_ID`） |
| `--s3-secret-key <key>` | — | S3 Secret Access Key（或环境变量 `AWS_SECRET_ACCESS_KEY`） |
| `--s3-force-path-style` | `false` | 强制 Path Style（**MinIO 必须开启**，其他云厂商禁用） |
| `--git-repo <path>` | — | Git 仓库路径或 URL |
| `--git-branch <branch>` | `main` | Git 分支 |
| `--pattern <pattern>` | `by-type` | 文件命名预设（见下方说明） |
| `--filter <expr>` | — | 过滤表达式，如 `type:workflow,tag:核心,name:关键词` |
| `--include-secret` | `false` | 包含敏感信息（API Key 等） |
| `--no-include-versions` | — | 不导出版本历史（默认导出，加此参数可加速） |
| `--incremental` | `false` | 增量导出，只导出上次之后有变更的应用 |
| `--archive <format>` | `none` | 打包格式：`none` / `zip` |
| `--workspace <id>` | — | 指定 Workspace ID |
| `--json` | `false` | JSON 格式输出，供程序解析 |
| `--verbose` | `false` | 详细日志 |

### 文件命名预设（--pattern）

| 预设 | 路径格式 |
|------|---------|
| `flat` | `AppName.yml` |
| `by-type`（默认） | `workflow/AppName.yml` |
| `by-tag` | `标签名/AppName_日期.yml` |
| `by-workspace` | `WorkspaceName/type/AppName_日期.yml` |
| `full` | `InstanceName/WorkspaceName/type/AppName_日期.yml` |

`flat` 和 `by-type` 为覆盖写模式（无日期），适合配合 git 做版本管理；其余预设为归档模式（含日期），每次导出新增文件。版本历史（`_versions/` 子目录）始终使用版本创建时间戳，命名版本保留版本名，未命名版本以 app 名+时间戳区分。

运行 `npx dify-dsl-pipe presets` 查看完整列表。

### 过滤表达式（--filter）

多条件用逗号组合，同类型条件为 OR，不同类型为 AND：

```bash
--filter "type:workflow"                    # 只导出 workflow 类型
--filter "tag:生产"                         # 只导出打了"生产"标签的
--filter "type:workflow,tag:生产"           # workflow 类型 AND 打了"生产"标签
--filter "name:客服"                        # 名称包含"客服"的
```

可用 `type` 值：`chat`、`agent-chat`、`completion`、`workflow`、`advanced-chat`

---

## import

从存储中导入 DSL 到 Dify 实例。

```bash
npx dify-dsl-pipe import [options]
```

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
| `--dry-run` | `false` | 预览模式，列出将执行的操作，不实际导入 |
| `--workspace <id>` | — | 指定 Workspace ID |
| `--json` | `false` | JSON 格式输出 |
| `--verbose` | `false` | 详细日志 |

> **强烈建议**导入前先加 `--dry-run` 预览，确认无误后再去掉执行。

---

## serve

启动 HTTP API 服务（含定时任务）或 MCP Server。

```bash
npx dify-dsl-pipe serve [options]
```

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--mcp` | `false` | 以 MCP Server 模式启动（stdio transport） |
| `--port <port>` | `3000` | HTTP 端口 |
| `--host <host>` | `127.0.0.1` | 绑定地址（对外暴露用 `0.0.0.0`，注意无内置认证） |
| `--url <url>` | — | Dify Console API 地址（单实例时用） |
| `--token <token>` | — | Access Token |
| `--email <email>` | — | 登录邮箱 |
| `--password <password>` | — | 登录密码 |
| `--profile <name>` | — | 使用配置文件中的 profile |
| `-c, --config <path>` | — | 配置文件路径（多实例时推荐，自动连接所有 instances） |
| `--storage <type>` | `local` | 存储类型 |
| `--s3-*` | — | 同 export 的 S3 参数 |
| `--git-*` | — | 同 export 的 Git 参数 |
| `-o, --out <path>` | `./dify-backup` | 本地输出目录 |
| `--pattern <pattern>` | `by-type` | 文件命名预设 |
| `--webhook <url>` | — | 任务完成通知（Slack / 企业微信 / 钉钉 / 通用 HTTP POST） |
| `--verbose` | `false` | 详细日志 |

详细用法见 [定时备份服务](serve.md) 和 [MCP Server 集成](mcp.md)。

---

## init

交互式创建 `dify-pipe.yaml` 配置文件。

```bash
npx dify-dsl-pipe init
```

---

## presets

列出所有可用的文件命名预设。

```bash
npx dify-dsl-pipe presets
```
