# 配置文件参考

← [返回 README](../README.md)

运行 `npx dify-dsl-pipe init` 可交互式生成配置文件，或参考 [dify-pipe.example.yaml](../dify-pipe.example.yaml) 手动创建。

默认读取当前目录的 `dify-pipe.yaml`，也可用 `-c` 指定路径：

```bash
npx dify-dsl-pipe export --profile prod -c /path/to/dify-pipe.yaml
```

### `init` 非交互模式（upsert）

带 `--name` 即进入非交互模式，适合脚本化与 migrate 前置准备：

```bash
npx dify-dsl-pipe init --name prod --url https://dify.prod.com/console/api --token TOKEN
npx dify-dsl-pipe init --name staging --url https://dify.staging.com/console/api \
  --email admin@example.com --password PASS --storage-path ./backup/staging
```

- 读取已有配置文件并 **upsert**：写入同名 `instance` 与同名 `profile`（storage 为 local，默认 `./dify-backup/<name>`，可用 `--storage-path` 改）。
- 同名已存在且不带 `--force` → `ERR_CONFIG_INVALID`，文件不变；带 `--force` 覆盖。
- 不连接 Dify、不修改 `.gitignore`。参数缺失（无 url、token 与 email/password 都缺）→ `ERR_CONFIG_INVALID`。
- `-o` 指定输出配置文件路径（默认 `dify-pipe.yaml`）。

> **配置文件包含凭据（token / 密码），请勿提交到版本库。**

---

## 完整结构

```yaml
# ── 实例列表 ─────────────────────────────────
instances:
  - name: prod                                    # 实例标识（字母/数字/连字符）
    url: "https://dify.prod.com/console/api"      # 必填，以 /console/api 结尾
    token: "your-access-token"                    # 认证方式 1：Access Token
    # email: "admin@example.com"                  # 认证方式 2：邮箱（二选一）
    # password: "your-password"                   # 认证方式 2：密码
    timeout: 30                                   # 请求超时（秒），默认 30
    maxRetries: 3                                 # 重试次数，默认 3

  - name: staging
    url: "https://dify-staging.com/console/api"
    token: "staging-token"

# ── Profile ─────────────────────────────────
# Profile 绑定一个实例 + 一套存储配置 + 默认导出选项
profiles:
  prod:
    instance: prod          # 引用上方 instances 中的 name
    storage:
      type: local
      path: "./backup/prod"
    export:
      pattern: "by-type"
      includeVersionHistory: true
      includeSecret: false
      incremental: false
    import:
      onConflict: "skip"    # skip | overwrite
      dryRun: false

  prod-s3:
    instance: prod
    storage:
      type: s3
      bucket: "my-dify-backups"
      endpoint: "https://s3.oss-cn-hangzhou.aliyuncs.com"   # 阿里云 OSS 示例
      region: "cn-hangzhou"
      accessKeyId: "YOUR_ACCESS_KEY"
      secretAccessKey: "YOUR_SECRET_KEY"
      # forcePathStyle: true    # MinIO 需要开启，其他云厂商禁用

  prod-git:
    instance: prod
    storage:
      type: git
      repo: "/path/to/backup-repo"
      branch: "main"
      push: true

# ── 全局默认值 ────────────────────────────────
# 可被 profile 配置或 CLI 参数覆盖
defaults:
  export:
    includeSecret: false
    includeVersionHistory: true
    incremental: false
    pattern: "by-type"
  import:
    onConflict: "skip"      # skip | overwrite
    dryRun: false
  notification:
    enabled: false          # 全局开关，true 时才发送通知
    webhookUrl: ""          # Slack / 企业微信 / 钉钉 / 飞书 / 通用 HTTP POST
    onFailure: true
    onSuccess: false
```

---

## 字段说明

### instances[]

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | ✅ | 实例唯一标识，供 profile 引用 |
| `url` | ✅ | Console API 地址，必须以 `/console/api` 结尾 |
| `token` | ⚠️ | Access Token（与 email+password 二选一） |
| `email` | ⚠️ | 登录邮箱 |
| `password` | ⚠️ | 登录密码 |
| `timeout` | — | 请求超时秒数，默认 `30` |
| `maxRetries` | — | 失败重试次数，默认 `3` |

### profiles[]

| 字段 | 必填 | 说明 |
|------|------|------|
| `instance` | ✅ | 引用 instances 中的 name |
| `workspace` | — | 指定 Workspace ID |
| `storage` | — | 存储配置（见下方） |
| `export` | — | 导出默认选项 |
| `import` | — | 导入默认选项（`onConflict`、`dryRun`） |

### storage（通用字段）

| 字段 | 说明 |
|------|------|
| `type` | `local` / `s3` / `git` |

#### type: local

| 字段 | 说明 |
|------|------|
| `path` | 本地目录路径，默认 `./dify-backup` |

#### type: s3

| 字段 | 说明 |
|------|------|
| `bucket` | Bucket 名称 |
| `endpoint` | S3 兼容端点，AWS S3 可不填 |
| `region` | 区域（Cloudflare R2 填 `auto`） |
| `accessKeyId` | Access Key ID |
| `secretAccessKey` | Secret Access Key |
| `forcePathStyle` | 仅 MinIO 需要设为 `true` |
| `prefix` | 对象前缀路径，如 `dify-backups/` |

#### type: git

| 字段 | 说明 |
|------|------|
| `repo` | 仓库本地路径或远程 URL |
| `branch` | 分支名，默认 `main` |
| `push` | 是否自动 push，默认 `true` |
