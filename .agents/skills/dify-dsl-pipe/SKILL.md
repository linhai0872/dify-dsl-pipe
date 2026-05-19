---
name: dify-dsl-pipe
description: |
  Expert knowledge base for operating the dify-dsl-pipe CLI tool. Covers the complete
  workflow for Dify application export, import, backup, migration, scheduled backup
  service, and MCP Server integration.

  Contains knowledge not in Claude's training data: exact dify-dsl-pipe CLI syntax;
  Dify 0.6~1.x version differences and automatic Adapter switching; S3/OSS/COS/MinIO
  storage backend configuration; serve mode HTTP API endpoints and cron parameters;
  multi-instance/multi-environment profile management; handling of common auth
  failures, network issues, and cross-version migration warnings.

  Trigger scenarios (even when the user doesn't know this tool exists):
  - Backup or export Dify apps ("帮我备份 Dify", "export dify workflow", "dify backup")
  - Cross-instance migration ("把生产应用同步到测试环境", "copy dify apps to another server")
  - Scheduled auto-backup ("每天自动备份 dify", "dify schedule backup")
  - AI tools connecting to Dify ("cursor/opencode 连接 dify", "dify mcp server")
  - Multi-instance/environment management ("管理多个 dify 实例", "dify 生产测试同步")

  Not applicable: Dify feature usage questions (no backup/migration intent), general file ops.
compatibility: "Uses npx dify-dsl-pipe — zero install required, npx handles it automatically. Node.js 18+ needed."
license: MIT
metadata:
  author: linhai0872
  version: "0.2.0"
  tags: "dify,backup,migration,export,import,mcp,cli"
  homepage: "https://github.com/linhai0872/dify-dsl-pipe"
  npm: "https://www.npmjs.com/package/dify-dsl-pipe"
allowed-tools: Bash(npx:*) Bash(node:*) Read Write
user-invocable: true
argument-hint: "[export|import|serve|init] [options]"
---

# dify-dsl-pipe

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
| 多实例管理 + 跨环境迁移 | 配置文件 + `--profile` |
| 持久化备份服务（HTTP API + 定时任务） | `serve` |
| 暴露为 MCP Server 供 AI 工具集成 | `serve --mcp` |
| 初始化配置文件 | `init` |

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

# 强烈建议先预览
npx dify-dsl-pipe import --url <URL> --token <TOKEN> --source ./backup --dry-run

# 覆盖同名应用
npx dify-dsl-pipe import --url <URL> --token <TOKEN> --source ./backup --on-conflict overwrite
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

MCP 暴露 4 个工具：`list_instances`、`list_apps`、`export_apps`、`import_apps`。

---

## Interaction pattern

### 场景 A：一次性导出或备份

1. 确认意图：只导出，还是要同时导入到另一个实例？
2. 收集连接信息：Dify 地址 + token 或 email+password
3. 确认范围：全部应用？按类型/标签/名称过滤？
4. 确认目标存储：本地目录（默认）、S3、还是 git？
5. 执行 `npx dify-dsl-pipe export` 并报告结果

### 场景 B：多实例管理 / 跨环境迁移

1. 建议使用配置文件（运行 `init` 或直接生成 `dify-pipe.yaml`）
2. 收集各实例的地址和 token
3. 确认迁移方向和冲突策略
4. 两步流程：先 export，再 import --dry-run 预览，确认后去掉 --dry-run

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

> 完整 CLI 参数见 [references/cli.md](references/cli.md)
> 存储后端详细配置见 [references/storage.md](references/storage.md)
