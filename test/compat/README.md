# 兼容性测试矩阵（test/compat）

对 dify-dsl-pipe 做**跨 Dify 版本**的自动化兼容性回归：在 GZ 服务器上并行起多个最小化官方 Dify 实例，用本仓库当前代码（`dist/index.js`）对每个版本跑 import / export / roundtrip / lint / migrate 冒烟测试。

## 测试矩阵

| 版本 | 端口 | Adapter | 覆盖点 |
|------|------|---------|--------|
| 0.15.3 | 15153 | legacy* | Legacy 上限（无 DSL 导入 API，跳过 PLUGIN_MISSING / migrate） |
| 1.10.1 | 15101 | modern | Modern + 明文密码（< 1.11.2） |
| 1.14.2 | 15142 | modern | 社区稳定版（#36996 基准） |
| 1.16.1 | 15161 | modern | Base64 密码（≥ 1.11.2） |
| 1.17.1 | 15171 | modern | 1.17.x 覆盖 |
| 1.18.0 | 15180 | modern | 1.18.x：`format=yaml` 导出、agent_backend 依赖、plugin_daemon 0.6.10 |

矩阵定义在 `matrix.conf`（`版本|端口|adapter|说明`）。

## 每个版本跑的检查（run-tests.sh）

1. `import --dry-run` / `import` / `export`（`--url + --email + --password`，`--json`）。
2. **roundtrip**：导出产物里能找到 `Compat Smoke Workflow`。
3. **导出 YAML 校验**：每个 `.yml/.yaml` 非空且能被 YAML 解析（1.18 修复 `format=yaml` 的回归点：不带 format 时 1.18 默认吐 `.ifpkg` zip）。
4. **PLUGIN_MISSING**（仅 ≥1.0）：导入 `fixtures/plugin-deps-workflow.yml`（声明一个不存在的 marketplace 插件），断言报告 `items[].code` 含 `PLUGIN_MISSING`。
5. **lint**：对 fixture 目录离线 lint，验证新命令可用。
6. **migrate roundtrip**（`compat-run.sh`/`local-compat.sh` 传入对端端口时）：
   `init --name` 非交互建双 profile → `migrate --from <本版本> --to <下一版本> --yes --on-conflict overwrite --json`
   → 从目标实例导出 → `diff --baseline <migrate 的 meta.workdir（源快照）> -s <目标导出> --json`，
   断言无 `DRIFT_CONTENT` 且无 `DRIFT_ONLY_ONLINE`（baseline 侧即源实例；目标实例多出的应用不算失败）。

## 架构

- **GZ 服务器**：只跑 Dify 容器（bash 脚本），无外网 node 依赖。
- **本地 / CI**：跑测试驱动（`node dist/index.js`），直连 GZ 映射端口（默认 `100.84.215.119`）。
- 每个版本一个独立 compose project（`dify-compat-<版本>`），互不干扰，可并行常驻。

### 最小化栈

- **≤1.17.x（4 容器）**：`api + db_postgres + redis + plugin_daemon`。
- **≥1.18.0（5 容器）**：以上 + `agent_backend`。
  1.18 起 api `depends_on: agent_backend`（service_started）；agent_backend 还需要
  非空 `DIFY_AGENT_API_TOKEN`（prepare-env.sh 自动派生 `compat-agent-token-<hash>`，可由
  `COMPAT_AGENT_API_TOKEN` 覆盖）。`local_sandbox` / `agent_ssrf_proxy` 只在真正跑 Agent
  时需要，冒烟不跑 Agent，故不纳入。
- plugin_daemon 镜像按官方 compose 对齐：≤1.17 用 `0.6.3-local`，1.18 用 `0.6.10-local`。

> **为什么保留 plugin_daemon**：Dify 1.x 导出 workflow 应用时，`export_dsl` 会**无条件**调用
> 插件依赖分析（`generate_dependencies` → plugin_daemon），与应用是否用插件无关。
> 没有 plugin_daemon，export 直接 400。这是 Dify 的硬依赖，不可裁剪。

## 用法

### 日常：本地一键回归（推荐）

改完代码后，在仓库根目录跑：

```bash
npm run test:compat
```

它会自动：构建当前代码 → 确保 GZ 各版本环境在线 → 逐版本冒烟测试 → 打印汇总。
退出码 0 = 全部版本兼容，非 0 = 有失败版本（日志在 `test/compat/results/`）。

### 手动：分步操作（调试用）

```bash
# —— GZ 侧（通过 ssh 别名 GZ-vtrust-workstation）——
bash test/compat/scripts/prepare-env.sh 1.18.0 15180   # 拉官方 docker 目录 + 生成最小 compose
bash test/compat/scripts/up-and-init.sh 1.18.0 15180   # 起栈 + 建 dify_plugin 库 + 无人值守建管理员

# —— 本地侧 ——
npm run build                                                       # 先构建当前代码
bash test/compat/scripts/run-tests.sh 1.18.0 15180                  # 单版本冒烟（无 migrate）
bash test/compat/scripts/run-tests.sh 1.18.0 15180 100.84.215.119 15101  # 含 migrate roundtrip

# —— GZ 侧批量编排 ——
bash test/compat/scripts/compat-run.sh up                # 全部版本并行启动
bash test/compat/scripts/compat-run.sh down              # 全部停止
```

测试凭据（仅测试环境）：`admin@compat.test` / `***REMOVED***`。

> 说明：本测试为**内部手动回归**，不接 GitHub CI、不公网暴露（依赖内网 Tailscale 与 GZ SSH）。

## 结果

`test/compat/results/<版本>.log`：逐步 PASS/FAIL + `RESULT [版本] ALL PASS|HAS FAILURES`。

## 已踩到的坑（务必知晓）

1. **storage 目录权限**：api 容器以 uid 1001 运行，`volumes/app/storage` 需先 `chown -R 1001:1001`
   （替代官方 `init_permissions` 容器）。`up-and-init.sh` 已内置。
2. **dify_plugin 库**：plugin_daemon 用独立的 `dify_plugin` 数据库，postgres 启动后需手动
   `CREATE DATABASE dify_plugin`。`up-and-init.sh` 已内置。
3. **plugin_daemon 必配** `PLUGIN_REMOTE_INSTALLING_HOST`（如 `0.0.0.0`），否则启动失败。
4. **新版 compose 依赖链深**：api → agent_backend → plugin_daemon/local_sandbox，
   `depends_on` 硬编码无法用 override 删除，故最小栈**自包含**（不 `-f` 官方 compose）。
5. **登录密码编码**：≥ 1.11.2 需 Base64 密码（PR #29659）；登录成功 token 经 Cookie 返回，
   body 无 access_token。本工具 modern-adapter 已处理。
6. **1.18 导出默认格式变了**：`GET /apps/{id}/export` 不带 `format` 返回 `.ifpkg` zip；
   v0.4 起两个 adapter 一律带 `format=yaml`（1.17 及以前忽略未知参数，安全）。
7. **1.18 agent_backend**：见上方「最小化栈」。token 必须是**非空**字符串，空值会导致
   api 侧 Agent 相关校验失败；本栈不配 local_sandbox（sandbox auth token 也因此不需要）。
