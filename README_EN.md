# Dify DSL Batch Exporter

<div align="center">

[简体中文](README.md) | [English](README_EN.md)

A lightweight Python tool for batch exporting Dify application DSL configuration files, supporting multiple cloud storage backends and Docker deployment.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/downloads/)
[![Docker](https://img.shields.io/badge/docker-supported-blue.svg)](https://www.docker.com/)

</div>

## ✨ Features

| Feature | Description |
|---------|-------------|
| 📦 **Batch Export** | Automatically export all Dify application DSL configurations with type filtering |
| 🕐 **Version History** | Optional export of all published versions for workflow apps with auto-generated version documentation |
| 🗂️ **Structured Organization** | Sorted by creation time, folder naming includes timestamp and app ID |
| 🏷️ **Tag Support** | Add application tags to filenames for easy categorization |
| ☁️ **Multi-Cloud Storage** | Support for local storage, Aliyun OSS, AWS S3, MinIO, Volcengine TOS, Tencent COS |
| 🐳 **Docker Deployment** | Out-of-the-box with China mirror sources for faster builds |
| ⏰ **Scheduled Backup** | Support for one-time execution or scheduled backups via cron/systemd |
| 🔒 **Security Control** | Optional export of sensitive information (e.g., API keys) |

## 📋 Table of Contents

- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Export Structure](#export-structure)
- [Scheduled Backup](#scheduled-backup)
- [FAQ](#faq)
- [Development Guide](#development-guide)

## 🚀 Quick Start

### Option 1: Docker Deployment (Recommended)

```bash
# 1. Clone the repository
git clone https://github.com/yourusername/dify-dsl-exporter.git
cd dify-dsl-exporter

# 2. Configure
cp config.yaml.example config.yaml
# Edit config.yaml with your Dify configuration

# 3. Build and run
docker-compose build
docker-compose run --rm dify-exporter
```

### Option 2: Local Python

```bash
# 1. Install dependencies (Python 3.11+ required)
pip install -r requirements.txt

# 2. Configure
cp config.yaml.example config.yaml
# Edit config.yaml

# 3. Run
python -m src.main --config config.yaml
```

### Option 3: Using Launch Script

```bash
# Docker mode
./run.sh docker --build

# Python mode
./run.sh python

# Test mode (no upload)
./run.sh docker --dry-run
```

## ⚙️ Configuration

### Basic Configuration

```yaml
# ===== Dify Configuration =====
dify:
  base_url: "http://your-dify-host/console/api"
  
  # Auth Method 1: Email/Password (Recommended)
  email: "your-email@example.com"
  password: "your-password"
  
  # Auth Method 2: Access Token (Optional)
  # access_token: "your-token"
  
  include_secret: false  # Whether to export sensitive info
  timeout: 30
  max_retries: 3

# ===== Export Configuration =====
export:
  temp_dir: "/tmp/dify-export"
  archive_format: "zip"
  cleanup_after_upload: true
  
  # App type filter (empty means all)
  app_types: []  # Options: chat, agent-chat, completion, workflow, advanced-chat
  
  # Version history control
  export_version_history: true  # Whether to export version history
  
  # Tag control
  include_tags_in_filename: false  # Whether to include tags in filename

# ===== Storage Configuration =====
storage:
  backend: "local"  # Options: local, aliyun_oss, aws_s3, minio, volcengine, tencent_cos
  
  local:
    path: "/opt/dify-backups"
```

### Storage Backend Configuration

<details>
<summary><b>Aliyun OSS</b></summary>

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
<summary><b>Volcengine TOS</b></summary>

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
<summary><b>Tencent COS</b></summary>

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

### Docker Path Mapping

**Important**: When using Docker, path mapping in `docker-compose.yml` must match `config.yaml`.

```yaml
# config.yaml
storage:
  local:
    path: "/opt/dify-backups"

# docker-compose.yml
volumes:
  - /opt/dify-backups:/opt/dify-backups  # host:container
```

## 📁 Export Structure

### Basic Structure

```
dify-export-20240110_120000.zip
└── dify-export-20240110_120000/
    ├── App1_20240101_100000_abc12345/
    │   ├── App1_current.yml                    # Current version
    │   └── versions/                           # Version history (optional)
    │       ├── README.md                       # Version info doc
    │       ├── App1_v1_20240101_100000.yml
    │       └── App1_v2_20240105_150000.yml
    ├── App2_20240102_140000_def67890/
    │   └── App2_current.yml
    └── ...
```

### With Tags Enabled

```
├── App1_current-production-important.yml
└── versions/
    ├── README.md
    └── App1_v1_20240101_100000-production-important.yml
```

### Version Info Document Example

`versions/README.md` contains:

```markdown
# App1 - Version History

**Export Time**: 2025-01-10 12:00:00
**Version Stats**: 3 versions total (✅ 3 succeeded)

---

## 1. Development Version 3

**Description**: Optimized prompts and adjusted node configuration

**Created At**: January 08, 2024 09:00:00

**Created By**: John Doe

**File**: `App1_v3_20240108_090000.yml`

✅ **Export Succeeded**

---
```

## ⏰ Scheduled Backup

### Using Cron (Recommended)

```bash
# Edit crontab
crontab -e

# Run daily at 2 AM
0 2 * * * cd /path/to/dify-dsl-exporter && docker-compose run --rm dify-exporter >> /var/log/dify-export.log 2>&1

# Run weekly on Sunday at 3 AM
0 3 * * 0 cd /path/to/dify-dsl-exporter && docker-compose run --rm dify-exporter >> /var/log/dify-export.log 2>&1
```

### Using Systemd Timer

Create `/etc/systemd/system/dify-export.service`:

```ini
[Unit]
Description=Dify DSL Export Service

[Service]
Type=oneshot
WorkingDirectory=/path/to/dify-dsl-exporter
ExecStart=/usr/bin/docker-compose run --rm dify-exporter
User=your-user
```

Create `/etc/systemd/system/dify-export.timer`:

```ini
[Unit]
Description=Dify DSL Export Timer

[Timer]
OnCalendar=daily
Persistent=true

[Install]
WantedBy=timers.target
```

Enable the timer:

```bash
sudo systemctl enable dify-export.timer
sudo systemctl start dify-export.timer
sudo systemctl status dify-export.timer
```

## ❓ FAQ

<details>
<summary><b>Q: Cannot connect to Dify API</b></summary>

**Solution:**
1. Check if `base_url` format is correct (should include `/console/api`)
2. Verify email/password or access_token is valid
3. If using Docker, check network configuration
4. Review Dify API logs
</details>

<details>
<summary><b>Q: Version history export failed</b></summary>

**Solution:**
1. Confirm app type is `workflow` or `advanced-chat`
2. Check if there are published versions (drafts don't count)
3. Set `export_version_history: false` to export current version only
</details>

<details>
<summary><b>Q: Docker container permission issue</b></summary>

**Solution:**
```bash
# Ensure mount directory has write permission
sudo chmod 777 /opt/dify-backups
```
</details>

<details>
<summary><b>Q: How to get access_token?</b></summary>

**Method 1: Use Email/Password (Recommended)**
Configure email and password in config.yaml, the program will automatically obtain the token.

**Method 2: Manual Retrieval**
1. Login to Dify console
2. Open browser developer tools (F12)
3. Switch to Network tab
4. Refresh page, view Authorization header of any API request
5. Copy the token value after Bearer
</details>

<details>
<summary><b>Q: Why are draft versions skipped?</b></summary>

Draft is the current working version, not a published historical version, so it's automatically skipped. Only officially published versions are exported.
</details>

## 🛠️ Development Guide

### Project Structure

```
dify-dsl-exporter/
├── src/
│   ├── __init__.py
│   ├── main.py              # Main entry point
│   ├── config.py            # Configuration management
│   ├── dify_client.py       # Dify API client
│   ├── exporter.py          # Core export logic
│   └── storage/             # Storage backends
│       ├── base.py          # Abstract base class
│       ├── local.py         # Local storage
│       ├── aliyun_oss.py    # Aliyun OSS
│       ├── aws_s3.py        # AWS S3
│       ├── minio.py         # MinIO
│       ├── volcengine.py    # Volcengine TOS
│       └── tencent_cos.py   # Tencent COS
├── config.yaml.example      # Configuration example
├── requirements.txt         # Python dependencies
├── Dockerfile              # Docker image
├── docker-compose.yml      # Docker Compose config
├── run.sh                  # Launch script
└── README.md               # Documentation
```

### Adding New Storage Backend

```python
# src/storage/new_backend.py
from .base import StorageBackend

class NewBackend(StorageBackend):
    def __init__(self, config: dict):
        super().__init__(config)
        # Initialization logic
    
    def upload(self, local_path: str, remote_path: str) -> str:
        # Implement upload logic
        pass
    
    def test_connection(self) -> bool:
        # Implement connection test
        pass
```

### Command Line Arguments

```bash
python -m src.main [options]

Options:
  -c, --config CONFIG   Config file path (default: config.yaml)
  --dry-run            Test mode, export only without upload
  --version            Show version info
  -h, --help           Show help message
```

## 🔒 Security Recommendations

1. **API Credential Protection**: Don't commit API tokens or passwords to version control
2. **Sensitive Info Control**: Set `include_secret: false` in production
3. **Network Isolation**: Run in internal network, avoid public exposure
4. **Regular Rotation**: Regularly rotate API tokens and cloud storage credentials
5. **Access Control**: Configure cloud storage access policies with IP whitelist

## 📄 License

This project is licensed under the [MIT License](LICENSE).

## 🙏 Acknowledgments

Thanks to the [Dify](https://github.com/langgenius/dify) project for providing a powerful LLM application development platform.

## 📮 Support & Contribution

- 🐛 [Report Bug](https://github.com/yourusername/dify-dsl-exporter/issues)
- 💡 [Feature Request](https://github.com/yourusername/dify-dsl-exporter/issues)
- 🤝 [Contribute Code](https://github.com/yourusername/dify-dsl-exporter/pulls)

---

<div align="center">

If this project helps you, please give it a ⭐ Star!

</div>

