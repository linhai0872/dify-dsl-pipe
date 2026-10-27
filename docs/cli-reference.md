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
| `--zip` | `false` | 打包为 ZIP 文件 |
| `--workspace <id>` | — | 指定 Workspace ID |
| `--all-workspaces` | `false` | 导出所有 Workspace（自动遍历，pattern 默认升级为 `by-workspace`） |
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
| `--s3-force-path-style` | `false` | 强制 Path Style（**MinIO 必须开启**） |
| `--git-repo <path>` | — | Git 仓库路径或 URL |
| `--git-branch <branch>` | `main` | Git 分支 |
| `--on-conflict <strategy>` | `skip` | 冲突策略：`skip`（跳过）/ `overwrite`（覆盖） |
| `--dry-run` | `false` | 预览模式，列出将执行的操作，不实际导入 |
| `--fix` | `false` | 自动修复预检 blocking 问题（删 local 文件 default、非法变量 id 换 UUID） |
| `--publish` | `false` | 导入后发布 workflow / advanced-chat 应用（默认只导入为草稿；chat / completion 无需发布） |
| `--target-dify-version <ver>` | 探测值 | 目标 Dify 版本，用于 DSL schema 兼容 warning |
| `--workspace <id>` | — | 指定 Workspace ID |
| `--json` | `false` | JSON 格式输出 |
| `--verbose` | `false` | 详细日志 |

> **强烈建议**导入前先加 `--dry-run` 预览，确认无误后再去掉执行。

> 导入的 workflow / advanced-chat 应用默认**只写入草稿**：新建应用在发布前 Service API / Web App 不可用；覆盖导入时线上仍运行旧发布版本。加 `--publish` 在导入后自动发布；发布失败的应用保留已导入状态并报告 `PUBLISH_FAILED`。

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
| `--json` | `false` | JSON 格式输出 |
| `--verbose` | `false` | 详细日志 |

详细用法见 [定时备份服务](serve.md) 和 [MCP Server 集成](mcp.md)。

---

## migrate

一条命令完成跨实例迁移：导出 → 清洗 → 预演 →（确认后）导入。

```bash
npx dify-dsl-pipe migrate --to <profile> (--from <profile> | --source <localDir>) [options]
```

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--to <profile>` | — | 目标 profile（必填） |
| `--from <profile>` | — | 源 profile，从该实例导出（与 `--source` 二选一） |
| `--source <localDir>` | — | 本地 DSL 目录，跳过导出（与 `--from` 二选一；仅本地目录，远程源用 `import`） |
| `--yes` | `false` | 实际执行导入；不加时只做预演，**不发任何导入请求** |
| `--ephemeral` | `false` | 使用系统临时目录作为工作目录（全部成功后删除，失败保留） |
| `--on-conflict <strategy>` | `skip` | 冲突策略：`skip` / `overwrite`（导入阶段透传） |
| `--fix` | `false` | 自动修复预检 blocking 问题（导入阶段透传） |
| `--publish` | `false` | 导入后发布 workflow / advanced-chat 应用（导入阶段透传） |
| `--filter <expr>` | — | 过滤表达式，语法同 export（`type:` / `tag:` / `name:`） |
| `-c, --config <path>` | — | 配置文件路径 |
| `--json` | `false` | JSON 格式输出 |
| `--verbose` | `false` | 详细日志 |

流程与约定：

- 先用 `init --name ...` 建好两个 profile（见 [配置文件参考](config-file.md)）。
- 导出固定参数：local 存储、sanitize 开、不导版本历史、不打 zip、非增量、`by-type` 命名。
- 工作目录默认 `./.dify-pipe-migrate/<时间戳>/`，路径写入 PipeReport 的 `meta.workdir`。
- 预演结束（无 `--yes`）人类输出会提示「加 --yes 执行导入」。
- 退出码：导出失败项、导入失败项、未修复的 blocking、发布失败任一存在 → 1，否则 0（预演按 dry-run 规则）。

---

## diff

对比 DSL 备份与线上 Dify 实例（或两份备份）的差异。**只读，不修改任何内容**。

```bash
npx dify-dsl-pipe diff --profile <p> [-s <source> + 存储 flags]     # 备份 ↔ 线上
npx dify-dsl-pipe diff --baseline <dir> [-s <source> + 存储 flags]  # 两份备份互比，不连 Dify
```

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--profile <name>` | — | 使用配置文件中的 profile（比线上） |
| `--baseline <dir>` | — | 本地目录，作为基准与 `--source` 侧互比（不连 Dify） |
| `-s, --source <path>` | `./dify-backup` | DSL 源目录或前缀 |
| `--storage <type>` | `local` | 源存储类型：`local` / `s3` / `git` |
| `--s3-*` / `--git-*` | — | 同 import 的存储参数 |
| `--filter <expr>` | — | 过滤表达式（**仅支持 `name:` / `type:`**；`tag:` 报 `ERR_CONFIG_INVALID`，备份 DSL 无 tag 信息会造成假漂移） |
| `--check` | `false` | 存在任一漂移时以退出码 1 结束（CI 用） |
| `--show-chunks` | `false` | 在 detail 中列出变化路径及两边取值（每值截断 200 字符，最多 20 条） |
| `--full` | `false` | 整文档深比较，不做语义投影（审计用，会含噪声） |
| `-c, --config <path>` | — | 配置文件路径 |
| `--json` | `false` | JSON 格式输出 |
| `--verbose` | `false` | 详细日志 |

**语义投影**（默认）：两侧先做同一投影再深比较（键序无关）——套用 sanitize 语义、删除版本/坐标/选中态等噪声字段、secret 类 env 变量去 `value`、知识库 id 归一化为占位、`nodes` / `edges` 按 `id` 排序。`--full` 跳过投影做整文档比较。

输出每个差异应用一条 `DRIFT_ONLY_IN_BACKUP` / `DRIFT_ONLY_ONLINE` / `DRIFT_CONTENT`（info）；同名重复（不区分大小写）报 `DUPLICATE_NAME`(warning) 且不参与比较；两侧 DSL `version` 不同附 `DSL_VERSION_MISMATCH`(warning)。

退出码：默认 0；`--check` 且存在任一 DRIFT → 1；错误 → 1。

---

## lint

离线检查 DSL 备份目录，不连 Dify，提前发现会导致迁移失败的问题。源存储解析规则与 `import` 完全一致。

```bash
npx dify-dsl-pipe lint [options]
```

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

规则与 import 预检相同（`LOCAL_FILE_DEFAULT`、`INVALID_VARIABLE_ID` blocking；`PLUGIN_MISSING`、`DSL_VERSION_MISMATCH`、`AGENT_ASSETS_OMITTED` warning），不报 `NAME_CONFLICT`。

退出码：有 blocking → 1；仅 warning → 0；`--strict` 时 warning 也 → 1；无文件 → 0（给 warning 日志）。

---

## init

交互式创建 `dify-pipe.yaml` 配置文件，或加 `--name` 进入非交互模式。

```bash
npx dify-dsl-pipe init                # 交互向导
npx dify-dsl-pipe init --name prod --url https://dify.prod.com/console/api --token TOKEN
```

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--name <name>` | — | 实例/Profile 名称（提供后进入非交互模式） |
| `--url <url>` | — | Dify Console API 地址 |
| `--token <token>` | — | Access Token（与 `--email` + `--password` 二选一） |
| `--email <email>` | — | 登录邮箱 |
| `--password <password>` | — | 登录密码 |
| `--workspace <id>` | — | Workspace ID |
| `--storage-path <dir>` | `./dify-backup/<name>` | 本地存储路径 |
| `-o, --out <path>` | `dify-pipe.yaml` | 配置文件输出路径 |
| `--force` | `false` | 同名 instance/profile 已存在时覆盖（否则报 `ERR_CONFIG_INVALID`，文件不变） |
| `--json` | `false` | JSON 格式输出 |

非交互模式读取已有配置文件并 **upsert**：写入同名 instance 与同名 profile（storage 为 local）。不连接 Dify、不修改用户 `.gitignore`。参数缺失（无 url、token 与 email/password 都缺）→ `ERR_CONFIG_INVALID`。

> 配置文件含凭据，请勿提交到版本库。

---

## presets

列出所有可用的文件命名预设。

```bash
npx dify-dsl-pipe presets
```

---

## `--json` 输出：PipeReport 信封

所有管道命令（export / import / lint / migrate / diff）的 `--json` 模式向 **stdout 输出恰好一个 JSON 对象**（PipeReport 或 PipeError 信封），日志全部走 stderr，可直接管道给 `jq` 或 agent 解析。

```jsonc
{
  "command": "import",
  "success": false,
  "summary": { "total": 4, "blocking": 1, "warnings": 2 },
  "stats":   { "created": 2, "skipped": 0, "overwritten": 1, "failed": 1, "published": 0, "publishFailed": 0 },
  "meta":    { "workdir": "./.dify-pipe-migrate/20261027-103000" },   // 仅 migrate 等命令带
  "items": [
    { "severity": "blocking", "code": "LOCAL_FILE_DEFAULT", "app": "客服", "file": "workflow/客服.yml",
      "problem": "...", "suggestion": "...", "location": "..." }
  ]
}
```

| 字段 | 说明 |
|------|------|
| `command` | `export` / `import` / `lint` / `migrate` / `diff` |
| `success` | 整体是否成功 |
| `summary` | `{total, blocking, warnings}`：items 计数汇总 |
| `stats` | 按命令的计数（见下表） |
| `meta` | 附加元信息（如 migrate 的 `workdir`） |
| `items[]` | 每个问题一条：`{severity, code, app?, file?, problem, suggestion, location?, detail?}`；severity ∈ `blocking` / `warning` / `info` |
| `error` / `code` | 仅命令整体抛错（PipeError）时出现，如 `{success:false, error:"...", code:"ERR_CONFIG_INVALID"}`；由条目结果导致的 `success=false` **不带**这两个字段 |

`stats` 键按命令固定：

| 命令 | stats 键 |
|------|----------|
| export | `exported`, `failed` |
| import | `created`, `skipped`, `overwritten`, `failed`, `published`, `publishFailed` |
| lint | `files`, `blocking`, `warnings` |
| migrate | `exported`, `exportFailed`, `created`, `skipped`, `overwritten`, `failed`, `published`, `publishFailed` |
| diff | `onlyInBackup`, `onlyOnline`, `changed`, `same` |

### items[].code 一览

| code | severity | 含义 |
|------|----------|------|
| `LOCAL_FILE_DEFAULT` | blocking | file/file-list 变量 default 引用原 workspace 的文件 id，跨环境不可用（`--fix` 可修） |
| `INVALID_VARIABLE_ID` | blocking | 变量 id 非法，`--fix` 重新生成 UUID |
| `NAME_CONFLICT` | warning | 同名应用已存在（按 on-conflict 处理） |
| `PLUGIN_MISSING` | warning | 目标实例缺少 DSL 依赖的插件 |
| `DSL_VERSION_MISMATCH` | warning | DSL major 版本与目标 Dify 不一致，或 diff 两侧 DSL version 不同 |
| `AGENT_ASSETS_OMITTED` | warning | 内嵌 Agent 包的 Skill / 文件未随 YAML 导出携带；建议改用 .ifpkg（Dify UI）迁移该应用 |
| `DIFY_IMPORT_WARNING` | warning | Dify 导入接口返回的 warning（1.18 `completed-with-warnings`），detail 带原始 code/path/message |
| `NOT_PUBLISHED` | info | 应用已导入为草稿未发布：新建→发布前 Service API / Web App 不可用；覆盖→线上仍运行旧发布版本 |
| `PUBLISH_FAILED` | warning | 导入成功但发布失败（应用保留已导入状态，计入 stats.publishFailed，命令 success=false） |
| `DUPLICATE_NAME` | warning | diff 中同一侧重名（不区分大小写），该名字不参与比较 |
| `DRIFT_ONLY_IN_BACKUP` | info | 仅备份中存在的应用 |
| `DRIFT_ONLY_ONLINE` | info | 仅线上存在的应用 |
| `DRIFT_CONTENT` | info | 两侧都有但内容不同（location 列前 5 个变化路径） |
| `UNKNOWN` | warning | 未归类问题 |
