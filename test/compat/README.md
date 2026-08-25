# 兼容性测试矩阵（test/compat）

对 dify-dsl-pipe 做**跨 Dify 版本**的自动化兼容性回归：在 GZ 服务器上并行起多个最小化官方 Dify 实例，用本仓库当前代码（`dist/index.js`）对每个版本跑 import / export / roundtrip 冒烟测试。

## 测试矩阵

| 版本 | 端口 | Adapter | 覆盖点 |
|------|------|---------|--------|
| 0.15.3 | 15153 | legacy* | Legacy 上限 |
| 1.10.1 | 15101 | modern | Modern + 明文密码（< 1.11.2） |
| 1.14.2 | 15142 | modern | 社区稳定版（#36996 基准） |
| 1.16.1 | 15161 | modern | 最新版 + Base64 密码（≥ 1.11.2） |

矩阵定义在 `matrix.conf`（`版本|端口|adapter|说明`）。

## 架构

- **GZ 服务器**：只跑 Dify 容器（bash 脚本），无外网 node 依赖。
- **本地 / CI**：跑测试驱动（`node dist/index.js`），直连 GZ 映射端口（默认 `100.84.215.119`）。
- 每个版本一个独立 compose project（`dify-compat-<版本>`），互不干扰，可并行常驻。

### 最小化栈（每版本 4 容器）

`api + db_postgres + redis + plugin_daemon`，砍掉 web / nginx / 向量库 / 沙箱 / worker。

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
bash test/compat/scripts/prepare-env.sh 1.16.1 15161   # 拉官方 docker 目录 + 生成最小 compose
bash test/compat/scripts/up-and-init.sh 1.16.1 15161   # 起栈 + 建 dify_plugin 库 + 无人值守建管理员

# —— 本地侧 ——
npm run build                                            # 先构建当前代码
bash test/compat/scripts/run-tests.sh 1.16.1 15161       # 对单个版本跑冒烟测试

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
4. **新版 compose 依赖链深**：1.16.1 的 api → agent_backend → plugin_daemon/local_sandbox，
   `depends_on` 硬编码无法用 override 删除，故最小栈**自包含**（不 `-f` 官方 compose）。
5. **登录密码编码**：≥ 1.11.2 需 Base64 密码（PR #29659）；登录成功 token 经 Cookie 返回，
   body 无 access_token。本工具 modern-adapter 已处理。
