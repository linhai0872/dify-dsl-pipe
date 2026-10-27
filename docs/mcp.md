# MCP Server 集成

← [返回 README](../README.md)

`dify-dsl-pipe` 可作为标准 MCP Server 运行，通过 stdio transport 向 AI 工具暴露操作 Dify 的能力。Claude Code、Cursor、OpenCode 等任何兼容 MCP 协议的客户端均可接入。

---

## 暴露的工具

| 工具名 | 说明 |
|--------|------|
| `list_instances` | 列出已连接的 Dify 实例及版本信息 |
| `list_apps` | 列出指定实例的所有应用（含类型、标签） |
| `export_apps` | 导出应用 DSL（参数：`instance`、`filter`、`incremental`） |
| `import_apps` | 导入 DSL 到指定实例（参数：`instance`、`onConflict`、`dryRun`、`fix`、`publish`） |
| `migrate_apps` | 跨实例迁移（参数：`to`、`from?`、`source?`、`yes?`、`fix?`、`publish?`、`onConflict?`）。`yes` 默认 false，只做预演不发导入请求 |
| `diff_apps` | 备份 ↔ 线上语义对比（参数：`profile`、`source`、`check?`）。`check` 且存在漂移时返回 `isError: true` |

### 返回值约定

- `export_apps` / `import_apps` / `migrate_apps` / `diff_apps` 统一返回 **PipeReport** JSON（与 CLI `--json` 同一信封：`{command, success, summary, stats, meta, items[]}`，见 [CLI 参考](cli-reference.md#-json-输出pipereport-信封)）。
- 所有工具出错时统一返回 PipeError 信封 `{success:false, error, code}` 并置 `isError: true`，不再直接抛异常；无法归类的异常（如 HTTP 4xx/5xx、网络错误）`code` 为 `ERR_UNKNOWN`。
- `migrate_apps` / `diff_apps` 需要的 profile 从 serve 启动时加载的配置文件读取（需以 `--config` 启动）。

---

## 启动 MCP Server

```bash
# 单实例
npx dify-dsl-pipe serve --mcp \
  --url https://your-dify.com/console/api --token YOUR_TOKEN

# 多实例（推荐）
npx dify-dsl-pipe serve --mcp --config /path/to/dify-pipe.yaml
```

MCP 模式下进程接管 stdin/stdout 与客户端通信，**持续运行不退出，属正常行为**。日志写到 stderr，不干扰 MCP 协议。

---

## 客户端配置示例

各 AI 工具的配置字段名可能略有不同，以下为常见格式，请以各工具官方文档为准。

### Claude Code / claude_desktop_config.json

```json
{
  "mcpServers": {
    "dify-dsl-pipe": {
      "command": "npx",
      "args": ["-y", "dify-dsl-pipe", "serve", "--mcp",
               "--config", "/path/to/dify-pipe.yaml"]
    }
  }
}
```

单实例写法：

```json
{
  "mcpServers": {
    "dify-dsl-pipe": {
      "command": "npx",
      "args": ["-y", "dify-dsl-pipe", "serve", "--mcp",
               "--url", "https://your-dify.com/console/api",
               "--token", "YOUR_TOKEN"]
    }
  }
}
```

### Cursor / .cursor/mcp.json

```json
{
  "mcpServers": {
    "dify-dsl-pipe": {
      "command": "npx",
      "args": ["-y", "dify-dsl-pipe", "serve", "--mcp",
               "--config", "/path/to/dify-pipe.yaml"]
    }
  }
}
```

### OpenCode / opencode.json

```json
{
  "mcp": {
    "servers": {
      "dify-dsl-pipe": {
        "command": "npx",
        "args": ["-y", "dify-dsl-pipe", "serve", "--mcp",
                 "--config", "/path/to/dify-pipe.yaml"]
      }
    }
  }
}
```

---

## 注意事项

- 配置文件路径建议用**绝对路径**，避免不同工具的工作目录不一致导致找不到文件
- 修改 `dify-pipe.yaml` 后需重启 MCP Server 进程才能生效
- 多实例场景强烈建议用 `--config` 而非逐一传 `--url --token`
- MCP Server 与 Skill 是两个独立入口：Skill 面向 agent 自然语言交互，MCP 面向工具调用协议
