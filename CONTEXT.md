# dify-dsl-pipe

Dify 应用 DSL 的一站式管道工具。通过 CLI、Skill、HTTP API 三层入口，实现 Dify 应用的导出、导入和跨实例迁移。

## Language

### 核心概念

**Pipe**:
DSL 数据从 Dify 实例流出（导出）或流入（导入）的管道。
_Avoid_: exporter, syncer, manager

**DSL**:
Dify 应用的 YAML 格式配置描述文件，包含应用的完整定义（工作流图、模型配置、变量等）。
_Avoid_: config, template, blueprint

**Instance**:
一个独立的 Dify 部署，由 base_url 唯一标识。
_Avoid_: server, deployment, environment

**Workspace**:
Instance 内的租户隔离空间。同一账号可访问多个 Workspace，通过 tenant_id 切换。
_Avoid_: tenant, team, organization

**Profile**:
配置文件中的一组 Instance + Workspace + Storage 绑定，用于 CLI 快速切换目标。
_Avoid_: config, preset, environment

**Storage Backend**:
导出文件的持久化目标。v1 支持 local、S3 协议（通吃 AWS/阿里云/腾讯云/MinIO 等）、git。
_Avoid_: destination, target, output

**Adapter**:
针对不同 Dify 版本的 API 兼容层。Legacy（0.6.0~0.15.3）和 Modern（1.0.0+）两套。
_Avoid_: driver, connector, plugin

**Naming Pattern**:
导出文件的路径模板字符串，使用 `{name}`, `{type}`, `{tags}`, `{date}` 等变量。
_Avoid_: template, format, schema

### 内部架构

**PipeRunner**:
CLI / HTTP API / MCP 共用的编排层。负责加载配置、创建 Instance 连接、构建 Storage Backend。三个入口只做参数解析和结果展示，所有管道逻辑经由 PipeRunner 执行。
_Avoid_: orchestrator, engine, core

**PipeError**:
带机器可解析 error code（`ERR_AUTH_FAILED`、`ERR_STORAGE_CONNECT_FAILED` 等）的错误类型。`--json` 模式下输出 `{success, error, code}` 结构，供 Skill 和 MCP 客户端解析和重试。
_Avoid_: exception, fault

### 用户入口

**Skill**:
Claude Code 的 agent 交互层。用户用自然语言描述需求，Skill 翻译为 CLI 命令执行。是产品的"第一入口"，降低认知负担。
_Avoid_: prompt, instruction, agent

**CLI**:
命令行界面，`npx dify-dsl-pipe <command>` 直接使用。面向开发者和 agent 调用。
_Avoid_: terminal, shell, command-line tool

## Relationships

- 一个 **Instance** 包含一个或多个 **Workspace**
- 一个 **Profile** 绑定一个 **Instance**（可指定 Workspace）和一个 **Storage Backend**
- **Pipe** 操作在 **Instance** 和 **Storage Backend** 之间搬运 **DSL**
- **Adapter** 根据 **Instance** 的 Dify 版本自动选择
- **Naming Pattern** 决定 **DSL** 写入 **Storage Backend** 时的路径结构
- **Skill** 通过调用 **CLI** 驱动所有操作；**CLI** 是唯一的执行层
- **PipeRunner** 是 CLI / HTTP API / MCP 三入口共用的编排 seam
- **PipeError** 携带 error code，`--json` 模式下输出结构化错误供 agent 消费

## Example dialogue

> **用户:** "帮我把生产 Dify 里打了'核心'标签的应用备份到 git 仓库"
> **Agent (via Skill):** "你的生产 Dify 地址是？我需要一个 access token 来连接。"
> **用户:** "地址是 https://dify.prod.com，token 是 xxx"
> **Agent:** "好的，我来导出打了'核心'标签的应用到 git 仓库。" → 执行 `npx dify-dsl-pipe export --url https://dify.prod.com --token xxx --filter "tag:核心" --storage git --git-repo ...`
> **Agent:** "完成。共导出 12 个应用，已 commit 到 git 仓库 main 分支。其中 3 个 workflow 类型包含版本历史。"

> **用户:** "把这些应用导入到测试环境"
> **Agent:** "测试环境的 Dify 地址和 token？"
> **用户:** "用 profile 里的 staging"
> **Agent:** "导入前先预览一下——" → 执行 `npx dify-dsl-pipe import --source ./dify-backup --profile staging --dry-run`
> **Agent:** "预览结果：12 个应用，其中 2 个同名应用已存在（会跳过）。确认导入吗？"

## Flagged ambiguities

- "环境"曾被用于指代 **Instance**（"生产环境"）和系统环境变量——已解决：Dify 部署用 **Instance**，系统变量用"环境变量"。
- "版本"同时指 Dify 平台版本（影响 **Adapter** 选择）和应用的 workflow 版本历史——已解决：前者称"Dify 版本"，后者称"版本历史"。
- "配置"同时指工具自身的配置文件和 Dify 应用的 DSL 配置——已解决：前者称"配置文件"或 **Profile**，后者称 **DSL**。
