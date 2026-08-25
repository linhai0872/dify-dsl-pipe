<p align="center">
  <img src="assets/logo.svg" alt="dify-dsl-pipe" width="480">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dify-dsl-pipe"><img src="https://img.shields.io/npm/v/dify-dsl-pipe" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/dify-dsl-pipe"><img src="https://img.shields.io/npm/dt/dify-dsl-pipe" alt="npm downloads"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green" alt="License"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node.js">
</p>

<p align="center">
  English | <a href="README.md">中文</a>
</p>

An all-in-one pipeline tool for Dify application DSL — covering export, import, backup, migration, scheduled service, and MCP Server integration.

No installation required. Run directly with `npx`.

---

## Features

<table>
<tr><td><b>Export & Backup</b></td><td>Bulk export all app DSLs with flexible filtering by type, tag, or name. Incremental mode syncs only changed apps.</td></tr>
<tr><td><b>Import & Migrate</b></td><td>Restore from backup or migrate apps across instances. Dry-run preview and conflict strategy included — review before committing.</td></tr>
<tr><td><b>Multiple Storage Backends</b></td><td>Local directory, Git repo (auto-commit), AWS S3 and all S3-compatible storage (Aliyun OSS / Tencent COS / Volcengine TOS / MinIO / Cloudflare R2).</td></tr>
<tr><td><b>Multi-instance Management</b></td><td>Manage prod, staging, and multi-tenant Dify environments through a single config file. Switch targets with <code>--profile</code>.</td></tr>
<tr><td><b>Scheduled Backup Service</b></td><td>serve mode runs as a lightweight HTTP API with built-in cron job management and Webhook notifications for Slack, WeCom, DingTalk, and more.</td></tr>
<tr><td><b>MCP Server</b></td><td>Exposes operations as a standard MCP Server. Claude Code, Cursor, OpenCode and other AI tools can manage Dify apps through tool calls.</td></tr>
<tr><td><b>Auto Version Detection</b></td><td>Automatically detects Dify version and switches the correct Adapter, no manual configuration needed. Import and export are verified against Dify 0.12–1.16 in real environments; versions before 0.12 support export and backup.</td></tr>
</table>

---

## Quick Start

### Option 1: CLI

No installation required — run directly with `npx`:

```bash
# Export all apps to ./dify-backup
npx dify-dsl-pipe export --url https://your-dify.com/console/api --token YOUR_TOKEN

# Authenticate with email + password (alternative)
npx dify-dsl-pipe export --url https://your-dify.com/console/api \
  --email admin@example.com --password your-password

# Import to a target instance (dry-run first is recommended)
npx dify-dsl-pipe import --url https://target-dify.com/console/api --token TOKEN \
  --source ./dify-backup --dry-run

# Interactively create a config file
npx dify-dsl-pipe init
```

> `--url` must point to the Console API, ending with `/console/api`.

### Option 2: Agent Skill

In AI tools that support the Skill protocol (Claude Code, Cursor, OpenCode, etc.), install the Skill and invoke it explicitly:

```bash
# Install the Skill
npx skills add linhai0872/dify-dsl-pipe
```

After installation, use `/dify-dsl-pipe` to explicitly invoke the Skill in your AI conversation, then describe what you need:

> `/dify-dsl-pipe` Back up all workflow apps from my production Dify at https://dify.example.com/console/api to local storage.

The Skill will interpret your intent, ask for any missing details, assemble the correct command, and execute it — no manual parameter input required.

---

## Documentation

| Doc | Contents |
|-----|----------|
| [CLI Reference](docs/cli-reference.md) | All parameters for export / import / serve |
| [Storage Backends](docs/storage.md) | local / git / MinIO / AWS S3 / Cloudflare R2 / Aliyun OSS / Tencent COS / Volcengine TOS |
| [Config File Reference](docs/config-file.md) | Full dify-pipe.yaml field reference |
| [Scheduled Backup Service](docs/serve.md) | serve mode, HTTP API endpoints, cron job management |
| [MCP Server Integration](docs/mcp.md) | Connect AI tools directly to Dify |

---

## Multi-instance Management

Run `npx dify-dsl-pipe init` to create a config file interactively, or create `dify-pipe.yaml` manually:

```yaml
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
  staging:
    instance: staging
    storage:
      type: local
      path: "./backup/staging"
```

```bash
npx dify-dsl-pipe export --profile prod
npx dify-dsl-pipe import --profile staging --source ./backup/prod
```

---

## Migrating from the Python Version

Users of the original Python-based `dify-dsl-exporter`: the config format has changed completely. Run `npx dify-dsl-pipe init` to regenerate `dify-pipe.yaml`. Email+password auth remains supported. Storage backends are now unified under `--storage s3 + --s3-endpoint` — see [Storage Backends](docs/storage.md) for per-provider endpoint details.

---

## License

MIT
