# 存储后端配置参考

> 工具主页：https://github.com/linhai0872/dify-dsl-pipe

所有 S3 兼容存储统一使用 `--storage s3 + --s3-endpoint`，无独立存储类型。

---

## local（本地目录）

默认存储，无需额外参数。

```bash
npx dify-dsl-pipe export --url <URL> --token <TOKEN>
# 默认输出到 ./dify-backup

npx dify-dsl-pipe export --url <URL> --token <TOKEN> --out ./my-backup
```

---

## git（Git 仓库自动 commit）

```bash
npx dify-dsl-pipe export --url <URL> --token <TOKEN> \
  --storage git --git-repo /path/to/backup-repo --git-branch main
```

配置文件方式：

```yaml
storage:
  type: git
  repo: "/path/to/backup-repo"
  branch: "main"
  push: true
```

---

## MinIO（自建 S3）

**必须**加 `--s3-force-path-style`，region 填任意值。

```bash
npx dify-dsl-pipe export --url <URL> --token <TOKEN> \
  --storage s3 --s3-bucket my-bucket \
  --s3-endpoint http://minio.local:9000 \
  --s3-region us-east-1 \
  --s3-access-key minioadmin --s3-secret-key minioadmin \
  --s3-force-path-style
```

---

## AWS S3

无需 endpoint，region 填 bucket 所在区域。

```bash
npx dify-dsl-pipe export --url <URL> --token <TOKEN> \
  --storage s3 --s3-bucket my-bucket \
  --s3-region us-east-1 \
  --s3-access-key <ACCESS_KEY_ID> --s3-secret-key <SECRET_ACCESS_KEY>
```

---

## Cloudflare R2

region 固定填 `auto`，endpoint 含 Account ID。

```bash
npx dify-dsl-pipe export --url <URL> --token <TOKEN> \
  --storage s3 --s3-bucket my-bucket \
  --s3-endpoint https://<ACCOUNT_ID>.r2.cloudflarestorage.com \
  --s3-region auto \
  --s3-access-key <R2_ACCESS_KEY_ID> --s3-secret-key <R2_SECRET_ACCESS_KEY>
```

Account ID 在 Cloudflare Dashboard → R2 页面查看。

---

## 阿里云 OSS

S3 兼容 endpoint 有 `s3.` 前缀（与原生 OSS SDK 不同），**禁止**使用 forcePathStyle。

```bash
npx dify-dsl-pipe export --url <URL> --token <TOKEN> \
  --storage s3 --s3-bucket my-bucket \
  --s3-endpoint https://s3.oss-cn-hangzhou.aliyuncs.com \
  --s3-region cn-hangzhou \
  --s3-access-key <AccessKeyId> --s3-secret-key <AccessKeySecret>
```

常用 region：`cn-hangzhou`、`cn-beijing`、`cn-shanghai`、`cn-shenzhen`

⚠️ endpoint 格式是 `s3.oss-{region}.aliyuncs.com`，不是 `oss-{region}.aliyuncs.com`（后者是原生 OSS SDK 用的，与 S3 兼容 API 入口不同）。

---

## 腾讯云 COS

bucket 名称必须包含 APPID，格式为 `BucketName-APPID`（如 `my-backup-1250000000`）。

```bash
npx dify-dsl-pipe export --url <URL> --token <TOKEN> \
  --storage s3 --s3-bucket my-backup-1250000000 \
  --s3-endpoint https://cos.ap-guangzhou.myqcloud.com \
  --s3-region ap-guangzhou \
  --s3-access-key <SecretId> --s3-secret-key <SecretKey>
```

常用 region：`ap-guangzhou`、`ap-beijing`、`ap-shanghai`、`ap-chengdu`

---

## 火山云 TOS

**禁止**使用 forcePathStyle（会报 `InvalidPathAccess`）。

```bash
npx dify-dsl-pipe export --url <URL> --token <TOKEN> \
  --storage s3 --s3-bucket my-bucket \
  --s3-endpoint https://tos-cn-beijing.volces.com \
  --s3-region cn-beijing \
  --s3-access-key <AccessKey> --s3-secret-key <SecretKey>
```

常用 region：`cn-beijing`、`cn-guangzhou`、`cn-shanghai`

---

## 配置文件方式（推荐多实例场景）

```yaml
profiles:
  prod-oss:
    instance: prod
    storage:
      type: s3
      bucket: "my-dify-backups"
      endpoint: "https://s3.oss-cn-hangzhou.aliyuncs.com"
      region: "cn-hangzhou"
      accessKeyId: "YOUR_ACCESS_KEY"
      secretAccessKey: "YOUR_SECRET_KEY"

  prod-minio:
    instance: prod
    storage:
      type: s3
      bucket: "dify"
      endpoint: "http://minio.internal:9000"
      region: "us-east-1"
      accessKeyId: "minioadmin"
      secretAccessKey: "minioadmin"
      forcePathStyle: true
```
