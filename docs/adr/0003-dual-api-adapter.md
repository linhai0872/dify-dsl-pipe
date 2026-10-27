# 双 Adapter 适配 Dify 版本

工具通过 API 响应头 `X-Version` 自动检测 Dify 版本，选择对应的 API adapter：Legacy（0.6.0~0.15.3）或 Modern（1.0.0+）。不支持 0.6.0 以下版本（DSL 概念尚不存在）。

两个版本段的关键差异：认证机制（Bearer token vs HttpOnly Cookie + CSRF）、导入端点路径（`/apps/{id}/workflows/draft/import` vs `/apps/imports`）、DSL 格式（是否含 `dependencies` 字段）。

Modern adapter 内部还有一个子版本边界：Dify **1.11.2** 起（PR #29659，2025-12-16 合并）登录接口要求密码 Base64 编码，之前版本接受明文。工具在 `login()` 阶段通过已探测的版本号自动选择编码方式，版本探测不准时回退到 401 重试机制兜底，对调用方透明。

## Considered Options

- **只支持最新稳定版**：实现最简单，但社区中仍有大量 0.x 用户（尤其是 0.15.3 作为 1.0 前最后的稳定版），完全不管会丢失用户。
- **全版本兼容**：维护成本过高，0.3~0.5 时代 API 变化大且用户极少。

---

## 修订（2026-08）

原边界「Legacy 0.6.0~0.15.3 / Modern 1.0.0+」已更正为 **Legacy < 0.12.0 / Modern ≥ 0.12.0**。

依据：Dify 自 **0.12.0** 起引入两阶段导入 `POST /apps/imports`（+ confirm），且核心端点（`/apps`、`/apps/{id}/export`、登录）在 0.12.0 ~ 1.x 完全一致，故 0.12.0 起走 Modern adapter；**< 0.12.0 没有 DSL 导入 API**，Legacy adapter 只支持导出备份（`importAppDSL` / `publishWorkflow` 抛 `ERR_VERSION_UNSUPPORTED`）。

另：Dify **1.18** 起 `GET /apps/{id}/export` 不带 `format` 默认返回 `.ifpkg` zip；工具一律带 `format=yaml` 获取 YAML（1.18 之前各版本忽略未知 `format` 参数，可无条件发送）。
