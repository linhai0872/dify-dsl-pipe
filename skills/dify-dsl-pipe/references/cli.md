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
| `--zip` | `false` | 打包为 ZIP 文件 |
| `--no-sanitize` | — | 关闭导出清洗（默认开启：去掉跨 workspace 无效的 local 文件 default） |
| `--preserve-local-files` | `false` | 保留 tenant-local 文件 default（同 Instance 完整还原场景） |
| `--keep-original` | `false` | 被清洗时额外写 `.orig` 原件 |
| `--workspace <id>` | — | 指定 Workspace ID |
| `--all-workspaces` | `false` | 导出所有 Workspace（自动遍历，pattern 默认升级为 `by-workspace`） |
| `--json` | `false` | JSON 格式输出（PipeReport 信封：`{command,success,summary,items[]}`） |
| `--verbose` | `false` | 详细日志 |

> 多个应用落到同一路径（重名，不区分大小写）时，先创建的保留原名，其余文件名加 `__<id 前 8 位>` 后缀并报 `DUPLICATE_NAME`(warning)。

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
| `--s3-force-path-style` | `false` | 强制 Path Style（MinIO 必须开启） |
| `--git-repo <path>` | — | Git 仓库路径或 URL |
| `--git-branch <branch>` | `main` | Git 分支 |
| `--on-conflict <strategy>` | `skip` | 冲突策略：`skip`（跳过）/ `overwrite`（覆盖） |
| `--dry-run` | `false` | 预览模式，不实际导入 |
| `--fix` | `false` | 自动修复预检 blocking 问题（删 local 文件 default、非法变量 id 换 UUID） |
| `--publish` | `false` | 导入后发布 workflow / advanced-chat 应用（默认只导入为草稿；chat / completion 无需发布） |
| `--target-dify-version <ver>` | 探测值 | 目标 Dify 版本，用于 DSL schema 兼容 warning |
| `--workspace <id>` | — | 指定 Workspace ID |
| `--json` | `false` | JSON 格式输出（PipeReport 信封：`{command,success,summary,stats?,meta?,items[]}`；stdout 只有一个 JSON 对象，日志走 stderr） |
| `--verbose` | `false` | 详细日志 |

> 导入的 workflow / advanced-chat 默认**只写草稿**；新建发布前 Service API / Web App 不可用，覆盖时线上仍运行旧发布版本。是否发布由用户决定（`NOT_PUBLISHED` → 必问），不自动追加 `--publish`。

> Dify 1.18 不支持覆盖已有 Agent 应用：`--on-conflict overwrite` 遇到同名 Agent 应用时跳过并报 `AGENT_OVERWRITE_UNSUPPORTED`(warning)，计入 skipped，同批其他应用照常覆盖。

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
| `--webhook <url>` | — | 任务完成通知地址（Slack/企业微信/钉钉/飞书/通用 HTTP POST） |
| `--json` | `false` | JSON 格式输出 |
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
| `export_apps` | 导出应用 DSL（参数：instance、filter、incremental） |
| `import_apps` | 导入 DSL（参数：instance、onConflict、dryRun、fix、publish） |
| `migrate_apps` | 跨实例迁移（参数：to、from?、source?、yes?、fix?、publish?、onConflict?）；yes 默认 false 只预演 |
| `diff_apps` | 备份 ↔ 线上语义对比（参数：profile、source、check?）；check 且有漂移时 isError: true |

全部管道类工具返回 PipeReport JSON；出错统一 `{success:false, error, code}` + `isError: true`。

---

## migrate

一条命令跨实例迁移：导出 → 清洗 → 预演 →（`--yes`）导入。

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--to <profile>` | — | 目标 profile（必填） |
| `--from <profile>` | — | 源 profile（与 `--source` 二选一） |
| `--source <localDir>` | — | 本地 DSL 目录，跳过导出（仅本地目录） |
| `--yes` | `false` | 实际执行导入（默认只预演，不发导入请求） |
| `--ephemeral` | `false` | 工作目录用系统临时目录（成功后删除，失败保留） |
| `--on-conflict <strategy>` | `skip` | 冲突策略：`skip` / `overwrite` |
| `--fix` | `false` | 自动修复预检 blocking 问题 |
| `--publish` | `false` | 导入后发布 workflow / advanced-chat |
| `--filter <expr>` | — | 过滤表达式（`type:` / `tag:` / `name:`） |
| `-c, --config <path>` | — | 配置文件路径 |
| `--json` | `false` | JSON 格式输出 |
| `--verbose` | `false` | 详细日志 |

前置：`init --name` 建好 from/to 两个 profile。工作目录默认 `./.dify-pipe-migrate/<时间戳>/`（写入 `meta.workdir`）。`--from` 与 `--to` 相同 → `ERR_CONFIG_INVALID`；profile 不存在 → `ERR_PROFILE_NOT_FOUND`。

---

## diff

对比 DSL 备份与线上（或两份备份）的差异，只读。

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--profile <name>` | — | 比线上的 profile（与 `--baseline` 二选一） |
| `--baseline <dir>` | — | 本地基准目录，与 `--source` 互比（不连 Dify） |
| `-s, --source <path>` | `./dify-backup` | DSL 源目录或前缀 |
| `--storage <type>` | `local` | 源存储类型：`local` / `s3` / `git` |
| `--s3-*` / `--git-*` | — | 同 import 的存储参数 |
| `--filter <expr>` | — | 仅支持 `name:` / `type:`（`tag:` 报 `ERR_CONFIG_INVALID`） |
| `--check` | `false` | 存在漂移时退出码 1（CI 用） |
| `--show-chunks` | `false` | detail 中列变化路径与两边取值（最多 20 条） |
| `--full` | `false` | 整文档深比较（不做语义投影，含噪声） |
| `-c, --config <path>` | — | 配置文件路径 |
| `--json` | `false` | JSON 格式输出 |
| `--verbose` | `false` | 详细日志 |

默认做语义投影后深比较；漂移报 `DRIFT_ONLY_IN_BACKUP` / `DRIFT_ONLY_ONLINE` / `DRIFT_CONTENT`(info)；同侧重名报 `DUPLICATE_NAME`(warning)。`--check` + 漂移 → 退出码 1。

---

## lint

离线检查 DSL 备份目录，不连 Dify，文件集合与源存储解析同 import。

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `-s, --source <path>` | `./dify-backup` | DSL 源目录或前缀 |
| `--storage <type>` | `local` | 源存储类型：`local` / `s3` / `git` |
| `--s3-*` / `--git-*` | — | 同 import 的存储参数 |
| `-c, --config <path>` | — | 配置文件路径 |
| `--target-dify-version <ver>` | — | 目标 Dify 版本，用于 DSL schema 兼容 warning |
| `--strict` | `false` | warning 也视为失败（退出码 1） |
| `--json` | `false` | JSON 格式输出 |
| `--verbose` | `false` | 详细日志 |

规则同 import 预检（`LOCAL_FILE_DEFAULT` / `INVALID_VARIABLE_ID` blocking；`PLUGIN_MISSING` / `DSL_VERSION_MISMATCH` / `AGENT_ASSETS_OMITTED` warning），不报 `NAME_CONFLICT`。退出码：blocking → 1；仅 warning → 0；`--strict` 时 warning → 1；无文件 → 0。

---

## init

交互式创建 `dify-pipe.yaml` 配置文件；加 `--name` 进入非交互模式（读取已有文件并 upsert 同名 instance + profile，storage 为 local）。

```bash
npx dify-dsl-pipe init
npx dify-dsl-pipe init --name prod --url <URL> --token <TOKEN> [--storage-path <dir>] [-o dify-pipe.yaml] [--force]
```

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--name <name>` | — | 实例/Profile 名称（提供后非交互） |
| `--url <url>` | — | Dify Console API 地址 |
| `--token <token>` | — | Access Token（与 `--email`+`--password` 二选一） |
| `--email <email>` / `--password <password>` | — | 邮箱密码认证 |
| `--workspace <id>` | — | Workspace ID |
| `--storage-path <dir>` | `./dify-backup/<name>` | 本地存储路径 |
| `-o, --out <path>` | `dify-pipe.yaml` | 配置文件输出路径 |
| `--force` | `false` | 同名已存在时覆盖（否则 `ERR_CONFIG_INVALID`，文件不变） |
| `--json` | `false` | JSON 格式输出 |

不连 Dify、不改 `.gitignore`。配置文件含凭据，勿提交。

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
