---
name: dify-dsl-pipe
description: 操作 dify-dsl-pipe CLI，完成 Dify 应用导出、导入、备份、跨实例迁移、定时备份与 MCP 集成。Expert knowledge base for operating the dify-dsl-pipe CLI — export, import, backup, migration, scheduled backup, and MCP Server integration. WHEN user wants to backup/export Dify apps, cross-instance migration, scheduled auto-backup, AI tools connecting to Dify via MCP, multi-instance profile management, 帮我备份 Dify, export dify workflow, 把生产应用同步到测试环境, 每天自动备份 dify, cursor/opencode 连接 dify, 管理多个 dify 实例; not for general Dify feature usage without backup/migration intent.
compatibility: "Uses npx dify-dsl-pipe — zero install required, npx handles it automatically. Node.js 20+ needed."
license: MIT
metadata:
  author: linhai0872
  version: "0.4.1"
  tags: "dify,backup,migration,export,import,mcp,cli"
  homepage: "https://github.com/linhai0872/dify-dsl-pipe"
  npm: "https://www.npmjs.com/package/dify-dsl-pipe"
allowed-tools: Bash(npx:*) Bash(node:*) Read Write
user-invocable: true
argument-hint: "[export|import|migrate|diff|lint|serve|init] [options]"
---

# dify-dsl-pipe

## 何时使用

- 用户要备份或导出 Dify 应用（workflow、chatbot 等）
- 用户要在生产/测试等多个 Dify 实例间迁移或同步应用
- 用户要部署定时自动备份服务（cron + HTTP API）
- 用户要让 Cursor、OpenCode 等 AI 工具通过 MCP 连接 Dify
- 用户要管理多个 Dify 实例的 profile 配置

Dify DSL 一站式管道工具。零安装（`npx` 直接使用），支持导出、导入、跨实例迁移、定时备份服务，以及标准 MCP Server 集成。

- **GitHub**: https://github.com/linhai0872/dify-dsl-pipe
- **npm**: https://www.npmjs.com/package/dify-dsl-pipe
- **完整 CLI 参数**: [references/cli.md](references/cli.md)
- **存储后端配置**: [references/storage.md](references/storage.md)

> 此 Skill 遵循开放 Skill 协议，可被任何兼容该协议的 agent 应用加载和调用，包括 Claude Code、hermes-agent、openclaw、cursor、codex、opencode、gemini cli 等。

---

## 工具能力概览

| 场景 | 命令 |
|------|------|
| 一次性导出备份 | `export` |
| 从备份还原 / 跨实例导入 | `import` |
| 一条命令跨实例迁移（预演 → `--yes`） | `migrate` |
| 备份 ↔ 线上差异对比（CI 用 `--check`） | `diff` |
| 离线检查备份能否干净导入（CI） | `lint` |
| 多实例管理 + 跨环境迁移 | 配置文件 + `--profile` |
| 持久化备份服务（HTTP API + 定时任务） | `serve` |
| 暴露为 MCP Server 供 AI 工具集成 | `serve --mcp` |
| 初始化配置文件（含非交互 `--name`） | `init` |

---

## 认证方式

两种方式二选一：

```bash
# 方式 1：Access Token（从浏览器 DevTools 获取）
npx dify-dsl-pipe export --url <URL> --token <TOKEN>

# 方式 2：邮箱 + 密码（长期有效，适合自动化）
npx dify-dsl-pipe export --url <URL> --email admin@example.com --password <PASSWORD>
```

---

## 核心命令速查

### 导出

```bash
# 最简用法
npx dify-dsl-pipe export --url <CONSOLE_API_URL> --token <TOKEN>

# 按类型/标签过滤
npx dify-dsl-pipe export --url <URL> --token <TOKEN> --filter "type:workflow,tag:生产"

# 增量导出（只导出有变更的）
npx dify-dsl-pipe export --url <URL> --token <TOKEN> --incremental

# 导出到 S3（适用所有 S3 兼容存储）
npx dify-dsl-pipe export --url <URL> --token <TOKEN> \
  --storage s3 --s3-bucket <BUCKET> --s3-endpoint <ENDPOINT> \
  --s3-access-key <AK> --s3-secret-key <SK>

# 使用 profile
npx dify-dsl-pipe export --profile prod
```

### 导入

```bash
# 从本地目录导入
npx dify-dsl-pipe import --url <URL> --token <TOKEN> --source ./dify-backup

# 强烈建议先预览（含预检：blocking/warning）
npx dify-dsl-pipe import --url <URL> --token <TOKEN> --source ./backup --dry-run

# 预检阻断时，--fix 自动修（删 local 文件 default、非法变量 id 换 UUID）后导入
npx dify-dsl-pipe import --url <URL> --token <TOKEN> --source ./backup --fix

# 覆盖同名应用
npx dify-dsl-pipe import --url <URL> --token <TOKEN> --source ./backup --on-conflict overwrite

# 导入后直接发布 workflow / advanced-chat（默认只导入为草稿）
npx dify-dsl-pipe import --url <URL> --token <TOKEN> --source ./backup --publish
```

### 跨实例迁移（migrate）

```bash
# 前置：先用非交互 init 建两个 profile（各含 instance + local storage）
npx dify-dsl-pipe init --name prod    --url <PROD_URL>    --token <PROD_TOKEN>
npx dify-dsl-pipe init --name staging --url <STAGING_URL> --token <STAGING_TOKEN>

# 预演：导出 prod → 清洗 → dry-run 导入 staging，不发任何导入请求
npx dify-dsl-pipe migrate --from prod --to staging

# 用户确认后执行导入
npx dify-dsl-pipe migrate --from prod --to staging --yes

# 已有本地备份目录时跳过导出
npx dify-dsl-pipe migrate --source ./dify-backup --to staging --yes
```

### 备份 ↔ 线上对比（diff）

```bash
# 语义对比备份与线上（只读；忽略排序/坐标等噪声）
npx dify-dsl-pipe diff --profile prod --source ./dify-backup

# CI 用法：发现漂移即退出码 1
npx dify-dsl-pipe diff --profile prod --source ./dify-backup --check

# 列出具体变化路径与两边取值
npx dify-dsl-pipe diff --profile prod --source ./dify-backup --show-chunks

# 两份本地备份互比（不连 Dify）
npx dify-dsl-pipe diff --baseline ./backup-old --source ./backup-new
```

### 离线检查（lint）

```bash
# 不连 Dify，对备份目录跑导入预检规则（CI 前置）
npx dify-dsl-pipe lint --source ./dify-backup

# warning 也视为失败
npx dify-dsl-pipe lint --source ./dify-backup --strict
```

### 多实例配置文件

```yaml
# dify-pipe.yaml
instances:
  - name: prod
    url: "https://dify.prod.com/console/api"
    token: "prod-token"
  - name: staging
    url: "https://dify-staging.com/console/api"
    token: "staging-token"

profiles:
  prod:
    instance: prod
    storage:
      type: local
      path: "./backup/prod"
```

```bash
npx dify-dsl-pipe export --profile prod
npx dify-dsl-pipe import --profile staging --source ./backup/prod
```

### Serve 模式

```bash
# 启动 HTTP API 服务
npx dify-dsl-pipe serve --config dify-pipe.yaml --port 3000

# 创建定时任务
curl -X POST http://localhost:3000/jobs \
  -H "content-type: application/json" \
  -d '{"cron": "0 2 * * *", "action": "export", "instance": "prod"}'
```

### MCP Server

```bash
npx dify-dsl-pipe serve --mcp --config dify-pipe.yaml
```

MCP 暴露 6 个工具：`list_instances`、`list_apps`、`export_apps`、`import_apps`（新增 `publish` 参数）、`migrate_apps`（`yes` 默认 false 只预演）、`diff_apps`（`check` 有漂移时 `isError: true`）。全部返回 PipeReport JSON；出错返回 `{success:false, error, code}` + `isError`。

---

## Interaction pattern

### 场景 A：一次性导出或备份

1. 确认意图：只导出，还是要同时导入到另一个实例？
2. 收集连接信息：Dify 地址 + token 或 email+password
3. 确认范围：全部应用？按类型/标签/名称过滤？
4. 确认目标存储：本地目录（默认）、S3、还是 git？
5. 执行 `npx dify-dsl-pipe export` 并报告结果

### 场景 B：多实例管理 / 跨环境迁移

1. 用 `init --name <n> --url <u> --token <t>` 非交互建好各 profile（或交互 `init` / 手写 `dify-pipe.yaml`）
2. 确认迁移方向和冲突策略
3. 先 `migrate --from <src> --to <dst>` 预演（导出→清洗→dry-run 导入），把 blocking / warning / NOT_PUBLISHED 报告给用户
4. 用户确认后加 `--yes` 执行；是否 `--publish` 必须由用户拍板（见 grilling 触发词）
5. 迁移后可用 `diff --profile <dst> --source <workdir>` 复核

### 场景 C：部署定时自动备份服务

1. 确认部署环境（本地长期运行 / 服务器）
2. 收集连接信息，先 `init` 创建配置文件
3. 确认备份频率（cron 表达式）和通知方式（Slack/企业微信/钉钉）
4. 生成 `serve` 启动命令，建议用 pm2 / systemd 管理进程
5. 服务启动后调用 POST /jobs 创建定时任务

### 场景 D：配置 AI 工具直连 Dify（MCP 集成）

1. 确认使用的 AI 工具，了解该工具的 MCP 配置方式
2. 收集 Dify 连接信息，建议用配置文件
3. 生成 MCP Server 配置并告知注意事项

---

## Gotchas

- `--url` 必须指向 **Console API**，以 `/console/api` 结尾，`/apps` 结尾的是错的
- Access token 会过期，报 401 时让用户从浏览器 DevTools 刷新；或改用 `--email + --password`
- S3 兼容存储统一用 `--storage s3 + --s3-endpoint`；MinIO 需加 `--s3-force-path-style`；阿里云 OSS 的 S3 兼容 endpoint 有 `s3.` 前缀（`s3.oss-cn-hangzhou.aliyuncs.com`）
- `--filter` 语法用冒号：`type:workflow`，不是 `type=workflow`
- 导入前**强烈建议先 `--dry-run`** 预览
- **serve 模式**默认只监听 `127.0.0.1`，对外暴露加 `--host 0.0.0.0`，当前无内置认证
- **MCP 模式**进程持续运行不退出，属正常行为；日志写到 stderr 不干扰 MCP 协议
- 跨版本迁移（Dify 0.x → 1.x）自动切换 Adapter，DSL 格式差异可能引起导入警告，属正常现象
- **email+password 认证**：Dify ≥ 1.11.2 要求密码 Base64 编码，工具自动处理，无需用户关心；若遇到持续 401 建议改用 `--token`
- **版本历史文件命名**：命名版本 → `版本名_时间戳.yml`；未命名版本 → `app名_时间戳.yml`（精确到分钟，同天多版本不冲突）
- **导入即草稿**：import / migrate 后 workflow / advanced-chat 是草稿，线上行为不变；发布要 `--publish`（且需用户确认）
- **Dify 1.18 导出**：一律走 `format=yaml`；不带 format 会得到 `.ifpkg` zip，工具不使用该格式

## 预检与 sanitize（迁移可信）

跨环境迁移的 silent failure 由两层兜底：

- **export sanitize（默认开）**：去掉 file/file-list 变量 default 里跨 workspace 无效的 `local_file` 引用（`upload_file_id`/`uploadedId`），保留 `remote_url` 类 default。`--no-sanitize` 关；`--preserve-local-files` 同 Instance 还原时保留；`--keep-original` 额外写 `.orig`。对齐 Dify PR #37022。
- **import 预检（dry-run 即跑，lint 离线同源）**：`LOCAL_FILE_DEFAULT` / `INVALID_VARIABLE_ID` 为 **blocking**（不 `--fix` 则阻断该 app 导入）；`PLUGIN_MISSING` / `DSL_VERSION_MISMATCH` / `AGENT_ASSETS_OMITTED` 为 **warning**。import 成功后自动调 `check-dependencies`，缺插件 → warning；Dify 返回的 warnings 透出为 `DIFY_IMPORT_WARNING`。
- **`--fix`**：删 local 文件 default、给非 UUID 变量 id 换 UUID（变量按 name 引用，换 id 安全）。
- **`--json` 统一 PipeReport**：`{command, success, summary:{total,blocking,warnings}, stats?, meta?, items:[{severity,code,app,file,problem,suggestion,location,detail}]}`；stdout 只有一个 JSON 对象，日志走 stderr。Skill/agent 只解析这一种。
- **sanitize/`--fix` 会重新格式化 YAML**：清洗或修复后 DSL 会被重新序列化，手写注释和原始键序会丢失。Dify 导出的 DSL 本身无注释，影响的主要是手改过的 DSL；需保留原件用 `--keep-original`（export）。

### 告知模板（自动修）

执行 `--fix` 或 sanitize 后，按四段告知用户：

- 【问题】blocking/warning 项的人话描述 + 背景（如「file 变量 PO_files 的 default 引用了原 workspace 的文件 id，跨环境会导致 Test Run 卡住」）
- 【已做】工具自动做了什么 + 文件/节点位置（如「已删除该 default」「已为变量 cv 重新生成 UUID」）
- 【结果】导入/导出结果（创建/跳过/覆盖/失败计数；blocking 是否清零）
- 【未动】未自动处理、需用户决策的项（插件缺失、DSL 版本不一致、on-conflict、未发布草稿）

### 告知模板（提示类）

- **`AGENT_ASSETS_OMITTED`**（导出/预检/lint 命中，YAML 未携带内嵌 Agent 的 Skill/文件）：「该应用内嵌 Agent 的 Skill / 文件未随 YAML 导出携带，迁移后会缺失。建议在 Dify UI 用 .ifpkg 单独迁移该应用，或导入后手动补齐 Skill/文件。」
- **`DIFY_IMPORT_WARNING`**（Dify 导入接口返回 warning）：「Dify 返回了导入警告（原始 code/path/message 见 detail），应用已导入但建议核对警告项。」
- **`AGENT_OVERWRITE_UNSUPPORTED`**（overwrite 遇到同名 Agent 应用）：「Dify 不支持覆盖 Agent 应用，已跳过。需要替换的话，先在 Dify 中删除或改名旧应用再导入。」
- **`DUPLICATE_NAME`**（export 命中，应用重名）：「该应用与其他应用重名，已写入带 id 后缀的文件以免覆盖。建议在 Dify 中改成唯一名称。」
- **`NOT_PUBLISHED`**：「已导入为草稿，发布前 Service API / Web App 不可用」（新建）；「草稿已替换，线上仍运行旧发布版本」（覆盖）。

### grilling 触发词（一次一问，需用户拍板）

以下场景**不要自动决定**，逐个问用户：

- **插件缺失**（`PLUGIN_MISSING`）：目标实例缺插件 → 问用户是否已安装 / 从哪安装 / 是否跳过该 app
- **DSL 版本不一致**（`DSL_VERSION_MISMATCH`）：DSL major 与目标 Dify major 不同 → 问是否仍导入 / 降级 `--full` 对齐
- **on-conflict**：同名应用已存在 → 问 skip 还是 overwrite，不擅自覆盖
- **`NOT_PUBLISHED`（必问）**：workflow / advanced-chat 导入后只是草稿 → 问用户是否发布：发布方式是 `--on-conflict overwrite --publish` 重跑（默认 skip 会跳过已存在的应用、不会发布），或在 Dify UI 手动发布；**覆盖场景必须问**——线上仍运行旧发布版本，发布与否直接影响线上行为
- **`PUBLISH_FAILED`**：导入成功但发布失败 → 如实报告失败原因，问用户如何处理（修复后重发 / 保持草稿）
- **migrate `--yes`**：预演结束后是否执行导入由用户确认，不自动追加 `--yes`
- **sanitize 关闭**：用户明确要 `--preserve-local-files`（同 Instance 还原）时确认意图

> 规则：**绝不**在未获用户确认时自动加 `--publish` 或 `--yes`。

> 完整 CLI 参数见 [references/cli.md](references/cli.md)
> 存储后端详细配置见 [references/storage.md](references/storage.md)
