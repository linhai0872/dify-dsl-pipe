# Dify DSL 批量导出工具

<div align="center">

[简体中文](README.md) | [English](README_EN.md)

一个轻量级的 Python 工具，用于批量导出 Dify 应用的 DSL 配置文件，支持多种云存储后端和 Docker 部署。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/downloads/)
[![Docker](https://img.shields.io/badge/docker-supported-blue.svg)](https://www.docker.com/)

</div>

## ✨ 功能特性

| 功能 | 说明 |
|------|------|
| 📦 **批量导出** | 自动导出所有 Dify 应用的 DSL 配置，支持按类型过滤 |
| 🕐 **版本历史** | 可选导出工作流应用的所有已发布版本，自动生成版本信息文档 |
| 🗂️ **结构化组织** | 按创建时间排序，文件夹命名包含时间戳和应用 ID |
| 🏷️ **标签支持** | 可将应用标签添加到文件名，便于分类管理 |
| ☁️ **多云存储** | 支持本地存储、阿里云 OSS、AWS S3、MinIO、火山云 TOS、腾讯云 COS |
| 🐳 **Docker 部署** | 开箱即用，使用国内镜像源加速构建 |
| ⏰ **定时备份** | 支持单次执行或通过 cron/systemd 定时备份 |
| 🔒 **安全可控** | 可选择是否导出敏感信息（如 API 密钥） |

## 📋 目录

- [快速开始](#快速开始)
- [配置说明](#配置说明)
- [导出文件结构](#导出文件结构)
- [定时备份](#定时备份)
- [常见问题](#常见问题)
- [开发指南](#开发指南)

## 🚀 快速开始

### 方式一：Docker 部署（推荐）

```bash
# 1. 克隆项目
git clone https://github.com/yourusername/dify-dsl-exporter.git
cd dify-dsl-exporter

# 2. 配置
cp config.yaml.example config.yaml
# 编辑 config.yaml，填写你的 Dify 配置

# 3. 构建并运行
docker-compose build
docker-compose run --rm dify-exporter
```

### 方式二：Python 本地运行

```bash
# 1. 安装依赖（需要 Python 3.11+）
pip install -r requirements.txt

# 2. 配置
cp config.yaml.example config.yaml
# 编辑 config.yaml

# 3. 运行
python -m src.main --config config.yaml
```

### 方式三：使用启动脚本

```bash
# Docker 方式
./run.sh docker --build

# Python 方式
./run.sh python

# 测试模式（不上传）
./run.sh docker --dry-run
```

## ⚙️ 配置说明

### 基础配置

```yaml
# ===== Dify 配置 =====
dify:
  base_url: "http://your-dify-host/console/api"
  
  # 认证方式 1：邮箱密码（推荐）
  email: "your-email@example.com"
  password: "your-password"
  
  # 认证方式 2：Access Token（可选）
  # access_token: "your-token"
  
  include_secret: false  # 是否导出敏感信息
  timeout: 30
  max_retries: 3

# ===== 导出配置 =====
export:
  temp_dir: "/tmp/dify-export"
  archive_format: "zip"
  cleanup_after_upload: true
  
  # 应用类型过滤（留空表示全部）
  app_types: []  # 可选：chat, agent-chat, completion, workflow, advanced-chat
  
  # 版本历史控制
  export_version_history: true  # 是否导出历史版本
  
  # 标签控制
  include_tags_in_filename: false  # 是否在文件名中包含标签

# ===== 存储配置 =====
storage:
  backend: "local"  # 可选：local, aliyun_oss, aws_s3, minio, volcengine, tencent_cos
  
  local:
    path: "/opt/dify-backups"
```

### 存储后端配置

<details>
<summary><b>阿里云 OSS</b></summary>

```yaml
storage:
  backend: "aliyun_oss"
  aliyun_oss:
    endpoint: "oss-cn-hangzhou.aliyuncs.com"
    access_key_id: "your-key-id"
    access_key_secret: "your-key-secret"
    bucket_name: "your-bucket"
    prefix: "dify-backups/"
```
</details>

<details>
<summary><b>AWS S3</b></summary>

```yaml
storage:
  backend: "aws_s3"
  aws_s3:
    region: "us-east-1"
    access_key_id: "your-key-id"
    secret_access_key: "your-secret-key"
    bucket_name: "your-bucket"
    prefix: "dify-backups/"
```
</details>

<details>
<summary><b>MinIO</b></summary>

```yaml
storage:
  backend: "minio"
  minio:
    endpoint: "localhost:9000"
    access_key: "your-access-key"
    secret_key: "your-secret-key"
    bucket_name: "your-bucket"
    prefix: "dify-backups/"
    secure: true
```
</details>

<details>
<summary><b>火山云 TOS</b></summary>

```yaml
storage:
  backend: "volcengine"
  volcengine:
    endpoint: "tos-cn-beijing.volces.com"
    access_key_id: "your-key-id"
    secret_access_key: "your-secret-key"
    bucket_name: "your-bucket"
    prefix: "dify-backups/"
    region: "cn-beijing"
```
</details>

<details>
<summary><b>腾讯云 COS</b></summary>

```yaml
storage:
  backend: "tencent_cos"
  tencent_cos:
    region: "ap-guangzhou"
    secret_id: "your-secret-id"
    secret_key: "your-secret-key"
    bucket_name: "your-bucket-appid"
    prefix: "dify-backups/"
```
</details>

### Docker 配置同步

**重要提示**：使用 Docker 时，`docker-compose.yml` 中的路径映射必须与 `config.yaml` 一致。

```yaml
# config.yaml
storage:
  local:
    path: "/opt/dify-backups"

# docker-compose.yml
volumes:
  - /opt/dify-backups:/opt/dify-backups  # 宿主机路径:容器内路径
```

## 📁 导出文件结构

### 基本结构

```
dify-export-20240110_120000.zip
└── dify-export-20240110_120000/
    ├── App1_20240101_100000_abc12345/
    │   ├── App1_current.yml                    # 当前版本
    │   └── versions/                           # 历史版本（可选）
    │       ├── README.md                       # 版本信息文档
    │       ├── App1_v1_20240101_100000.yml
    │       └── App1_v2_20240105_150000.yml
    ├── App2_20240102_140000_def67890/
    │   └── App2_current.yml
    └── ...
```

### 启用标签后

```
├── App1_current-生产环境-重要应用.yml
└── versions/
    ├── README.md
    └── App1_v1_20240101_100000-生产环境-重要应用.yml
```

### 版本信息文档示例

`versions/README.md` 包含：

```markdown
# App1 - 版本历史

**导出时间**: 2025-01-10 12:00:00
**版本统计**: 共 3 个版本 （✅ 3 成功）

---

## 1. 开发版本3

**描述**: 优化了提示词，调整了节点配置

**创建时间**: 2024年01月08日 09:00:00

**创建者**: John Doe

**文件**: `App1_v3_20240108_090000.yml`

✅ **导出成功**

---
```

## ⏰ 定时备份

### 使用 Cron（推荐）

```bash
# 编辑 crontab
crontab -e

# 每天凌晨 2 点执行
0 2 * * * cd /path/to/dify-dsl-exporter && docker-compose run --rm dify-exporter >> /var/log/dify-export.log 2>&1

# 每周日凌晨 3 点执行
0 3 * * 0 cd /path/to/dify-dsl-exporter && docker-compose run --rm dify-exporter >> /var/log/dify-export.log 2>&1
```

### 使用 Systemd Timer

创建 `/etc/systemd/system/dify-export.service`:

```ini
[Unit]
Description=Dify DSL Export Service

[Service]
Type=oneshot
WorkingDirectory=/path/to/dify-dsl-exporter
ExecStart=/usr/bin/docker-compose run --rm dify-exporter
User=your-user
```

创建 `/etc/systemd/system/dify-export.timer`:

```ini
[Unit]
Description=Dify DSL Export Timer

[Timer]
OnCalendar=daily
Persistent=true

[Install]
WantedBy=timers.target
```

启用定时器：

```bash
sudo systemctl enable dify-export.timer
sudo systemctl start dify-export.timer
sudo systemctl status dify-export.timer
```

## ❓ 常见问题

<details>
<summary><b>Q: 无法连接到 Dify API</b></summary>

**解决方案：**
1. 检查 `base_url` 格式是否正确（应包含 `/console/api`）
2. 确认邮箱密码或 access_token 是否有效
3. 如果使用 Docker，检查网络配置
4. 查看 Dify API 日志
</details>

<details>
<summary><b>Q: 版本历史导出失败</b></summary>

**解决方案：**
1. 确认应用类型是 `workflow` 或 `advanced-chat`
2. 检查是否有已发布的版本（草稿不算）
3. 设置 `export_version_history: false` 只导出当前版本
</details>

<details>
<summary><b>Q: Docker 容器权限问题</b></summary>

**解决方案：**
```bash
# 确保挂载目录有写入权限
sudo chmod 777 /opt/dify-backups
```
</details>

<details>
<summary><b>Q: 如何获取 access_token？</b></summary>

**方法 1：使用邮箱密码（推荐）**
直接在 config.yaml 中配置邮箱和密码，程序会自动获取 token。

**方法 2：手动获取**
1. 登录 Dify 控制台
2. 打开浏览器开发者工具（F12）
3. 切换到 Network 标签
4. 刷新页面，查看任意 API 请求的 Authorization header
5. 复制 Bearer 后面的 token 值
</details>

<details>
<summary><b>Q: 为什么会跳过 draft 版本？</b></summary>

Draft（草稿）是当前工作版本，不是已发布的历史版本，因此会被自动跳过。只有正式发布的版本才会被导出。
</details>

## 🛠️ 开发指南

### 项目结构

```
dify-dsl-exporter/
├── src/
│   ├── __init__.py
│   ├── main.py              # 主程序入口
│   ├── config.py            # 配置管理
│   ├── dify_client.py       # Dify API 客户端
│   ├── exporter.py          # 导出核心逻辑
│   └── storage/             # 存储后端
│       ├── base.py          # 抽象基类
│       ├── local.py         # 本地存储
│       ├── aliyun_oss.py    # 阿里云 OSS
│       ├── aws_s3.py        # AWS S3
│       ├── minio.py         # MinIO
│       ├── volcengine.py    # 火山云 TOS
│       └── tencent_cos.py   # 腾讯云 COS
├── config.yaml.example      # 配置示例
├── requirements.txt         # Python 依赖
├── Dockerfile              # Docker 镜像
├── docker-compose.yml      # Docker Compose 配置
├── run.sh                  # 启动脚本
└── README.md               # 本文档
```

### 添加新的存储后端

```python
# src/storage/new_backend.py
from .base import StorageBackend

class NewBackend(StorageBackend):
    def __init__(self, config: dict):
        super().__init__(config)
        # 初始化逻辑
    
    def upload(self, local_path: str, remote_path: str) -> str:
        # 实现上传逻辑
        pass
    
    def test_connection(self) -> bool:
        # 实现连接测试
        pass
```

### 命令行参数

```bash
python -m src.main [选项]

选项:
  -c, --config CONFIG   配置文件路径（默认: config.yaml）
  --dry-run            测试模式，只导出不上传
  --version            显示版本信息
  -h, --help           显示帮助信息
```

## 🔒 安全建议

1. **API 凭证保护**：不要将 API Token 或密码提交到版本控制系统
2. **敏感信息控制**：生产环境建议设置 `include_secret: false`
3. **网络隔离**：在内网环境中运行，避免暴露到公网
4. **定期轮换**：定期更换 API Token 和云存储凭证
5. **访问控制**：配置云存储的访问策略，限制 IP 白名单

## 📄 许可证

本项目采用 [MIT 许可证](LICENSE)。

## 🙏 致谢

感谢 [Dify](https://github.com/langgenius/dify) 项目提供强大的 LLM 应用开发平台。

## 📮 支持与贡献

- 🐛 [提交 Bug](https://github.com/yourusername/dify-dsl-exporter/issues)
- 💡 [功能建议](https://github.com/yourusername/dify-dsl-exporter/issues)
- 🤝 [贡献代码](https://github.com/yourusername/dify-dsl-exporter/pulls)

---

<div align="center">

如果这个项目对你有帮助，欢迎给个 ⭐ Star！

</div>
