#!/usr/bin/env bash
# run-tests.sh <version> <host_port> [host] [migrate_target_port]
# 在【本地】跑兼容性冒烟测试，直连 GZ 上已就绪的 Dify 实例。
#   登录(带凭据) → import fixture → export 回来 → dry-run 预检 → 报告
#   新增（v0.4）：导出文件非空且合法 YAML、PLUGIN_MISSING 检出、lint、
#               migrate roundtrip（仅当传入 migrate_target_port）。
# 结果写入 test/compat/results/<version>.log，并打印 PASS/FAIL 摘要。
set -uo pipefail
# 不用 -e：逐步记录失败而非中途退出，保证矩阵报告完整。

VERSION="${1:?}"
HOST_PORT="${2:?}"
HOST="${3:-100.84.215.119}"
MIGRATE_TARGET_PORT="${4:-}"
. "$(dirname "${BASH_SOURCE[0]}")/config.sh"
BASE_URL="http://${HOST}:${HOST_PORT}/console/api"
EMAIL="$ADMIN_EMAIL"
PASSWORD="$ADMIN_PASSWORD"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
FIXTURE_DIR="${SCRIPT_DIR}/../fixtures"
RESULTS="${SCRIPT_DIR}/../results"
mkdir -p "$RESULTS"
LOG="${RESULTS}/${VERSION}.log"
WORK="$(mktemp -d)"

CLI="${REPO_ROOT}/dist/index.js"
if [ ! -f "$CLI" ]; then
  echo "!! 未找到 dist/index.js，请先在仓库根目录 npm run build" | tee -a "$LOG"
fi

pass() { echo "PASS  [$VERSION] $*" | tee -a "$LOG"; }
fail() { echo "FAIL  [$VERSION] $*" | tee -a "$LOG"; FAILED=1; }
FAILED=0
: > "$LOG"
echo "== compat test ${VERSION} @ ${BASE_URL} $(date -u +%FT%TZ) ==" | tee -a "$LOG"

# 版本比较：is_at_least 1.0 → 只对 1.x 跑某些检查
is_at_least() {
  local want_major="${1%%.*}"
  local have_major="${VERSION%%.*}"
  [ "$have_major" -ge "$want_major" ]
}

# 用 node 解析 YAML（仓库依赖 yaml；脚本在 REPO_ROOT 下运行可命中 node_modules）。
# 用法: yaml_check <file> — 静默返回 0/1
yaml_check() {
  (cd "$REPO_ROOT" && node --input-type=module -e "
    import { readFileSync } from 'node:fs';
    import { parse } from 'yaml';
    const f = process.argv[1];
    try { parse(readFileSync(f, 'utf-8')); process.exit(0); }
    catch { process.exit(1); }
  " "$1") 2>/dev/null
}

# 从 PipeReport stdout JSON 提取 items[].code 出现次数。用法: count_code <json_file> <code>
count_code() {
  node -e "
    const fs = require('node:fs');
    try {
      const r = JSON.parse(fs.readFileSync('$1', 'utf-8'));
      console.log((r.items ?? []).filter(i => i.code === '$2').length);
    } catch { console.log(0); }
  " 2>/dev/null
}

mkdir -p "${WORK}/src/workflow"
cp "${FIXTURE_DIR}/minimal-workflow.yml" "${WORK}/src/workflow/"

step() {
  local name="$1"; shift
  # --json 时 stdout 是 PipeReport；人类日志在 stderr（分开捕获，避免污染解析）
  if node "$CLI" "$@" > "${WORK}/out.json" 2>"${WORK}/err.log"; then
    pass "$name"
  else
    fail "$name"; sed 's/^/    /' "${WORK}/err.log" >> "$LOG"
  fi
}

step "import --dry-run" import --url "$BASE_URL" --email "$EMAIL" --password "$PASSWORD" \
  --source "${WORK}/src" --dry-run --json
step "import" import --url "$BASE_URL" --email "$EMAIL" --password "$PASSWORD" \
  --source "${WORK}/src" --json
step "export" export --url "$BASE_URL" --email "$EMAIL" --password "$PASSWORD" \
  --out "${WORK}/out" --json

if find "${WORK}/out" \( -name '*.yml' -o -name '*.yaml' \) 2>/dev/null | grep -q .; then
  if grep -rl "Compat Smoke Workflow" "${WORK}/out" >/dev/null 2>&1; then
    pass "roundtrip 导出含目标应用"
  else
    fail "roundtrip 导出未找到目标应用"
  fi
else
  fail "roundtrip 导出无 yaml 产物"
fi

# ── 导出文件非空且为合法 YAML（1.18 format=yaml 修复的回归） ──
yml_files=$(find "${WORK}/out" \( -name '*.yml' -o -name '*.yaml' \) 2>/dev/null || true)
if [ -z "$yml_files" ]; then
  fail "导出后无任何 .yml/.yaml 文件可校验"
else
  bad=0
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    if [ ! -s "$f" ]; then
      fail "导出文件为空: $f"; bad=1
    elif ! yaml_check "$f"; then
      fail "导出文件不是合法 YAML: $f"; bad=1
    fi
  done <<< "$yml_files"
  [ "$bad" -eq 0 ] && pass "导出文件均非空且为合法 YAML"
fi

# ── PLUGIN_MISSING：声明未安装插件依赖的 fixture（仅 ≥1.0） ──
if is_at_least 1.0; then
  mkdir -p "${WORK}/plugin-src/workflow"
  cp "${FIXTURE_DIR}/plugin-deps-workflow.yml" "${WORK}/plugin-src/workflow/"
  if node "$CLI" import --url "$BASE_URL" --email "$EMAIL" --password "$PASSWORD" \
      --source "${WORK}/plugin-src" --on-conflict overwrite --json \
      > "${WORK}/plugin-import.json" 2>"${WORK}/plugin-import.err"; then
    if [ "$(count_code "${WORK}/plugin-import.json" PLUGIN_MISSING)" -ge 1 ]; then
      pass "PLUGIN_MISSING 检出（导入后 check-dependencies）"
    else
      fail "导入含插件依赖的应用未报 PLUGIN_MISSING"; cat "${WORK}/plugin-import.json" >> "$LOG"
    fi
  else
    fail "PLUGIN_MISSING 检查：import 命令失败"; cat "${WORK}/plugin-import.err" >> "$LOG"
  fi
fi

# ── lint：离线命令冒烟 ──
step "lint" lint -s "${WORK}/src" --json

# ── migrate roundtrip：当前版本 → 目标版本（需 compat-run.sh 传入对端端口） ──
if [ -n "$MIGRATE_TARGET_PORT" ]; then
  MIGRATE_URL="http://${HOST}:${MIGRATE_TARGET_PORT}/console/api"
  MIGRATE_CONF="${WORK}/dify-pipe-migrate.yaml"
  TARGET_DIR="${WORK}/migrate-backup"

  if node "$CLI" init --name "compat_src" --url "$BASE_URL" \
      --email "$EMAIL" --password "$PASSWORD" --storage-path "${WORK}/src-backup" \
      -o "$MIGRATE_CONF" --json >/dev/null 2>"${WORK}/init.err" \
  && node "$CLI" init --name "compat_dst" --url "$MIGRATE_URL" \
      --email "$EMAIL" --password "$PASSWORD" --storage-path "$TARGET_DIR" \
      -o "$MIGRATE_CONF" --json >/dev/null 2>>"${WORK}/init.err"; then
    pass "init 非交互创建双 profile 配置"
  else
    fail "init 非交互创建配置失败"; cat "${WORK}/init.err" >> "$LOG"
  fi

  # 目标实例自己的冒烟已导入同名 fixture：必须 overwrite，否则全被 skip，stats 恒为 0
  if node "$CLI" migrate --from compat_src --to compat_dst --yes --on-conflict overwrite --json \
      -c "$MIGRATE_CONF" > "${WORK}/migrate.json" 2>"${WORK}/migrate.err"; then
    mig_created=$(node -e "
      const r = JSON.parse(require('node:fs').readFileSync('${WORK}/migrate.json','utf-8'));
      const s = r.stats ?? {};
      console.log((s.created ?? 0) + (s.overwritten ?? 0));
    " 2>/dev/null || echo 0)
    if [ "${mig_created:-0}" -ge 1 ]; then
      pass "migrate --yes 已将应用迁移到 ${MIGRATE_TARGET_PORT}"
    else
      fail "migrate 成功但 stats 无 created/overwritten"; cat "${WORK}/migrate.json" >> "$LOG"
    fi
  else
    fail "migrate --from compat_src --to compat_dst --yes"; cat "${WORK}/migrate.err" >> "$LOG"
  fi

  # baseline 用 migrate 实际导出的源快照（meta.workdir，含之后导入的插件 fixture），
  # 而不是更早的 ${WORK}/out；取不到时退回 ${WORK}/out
  MIGRATE_BASELINE=$(node -e "
    const r = JSON.parse(require('node:fs').readFileSync('${WORK}/migrate.json','utf-8'));
    console.log(r.meta?.workdir ?? '');
  " 2>/dev/null || true)
  [ -n "$MIGRATE_BASELINE" ] || MIGRATE_BASELINE="${WORK}/out"

  # 从目标实例导出，与源快照做 diff --baseline
  if node "$CLI" export --url "$MIGRATE_URL" --email "$EMAIL" --password "$PASSWORD" \
      --out "${WORK}/out-target" --json >/dev/null 2>"${WORK}/export-target.err"; then
    pass "目标实例导出（diff 数据源）"
  else
    fail "目标实例导出失败"; cat "${WORK}/export-target.err" >> "$LOG"
  fi

  if node "$CLI" diff --baseline "$MIGRATE_BASELINE" -s "${WORK}/out-target" --show-chunks --json \
      -c "$MIGRATE_CONF" > "${WORK}/diff.json" 2>"${WORK}/diff.err"; then
    # --baseline 模式下 baseline（源快照）是"线上侧"（chunk.online），-s（目标导出）是"备份侧"（chunk.backup）：
    # - 源有、目标无的应用 → DRIFT_ONLY_ONLINE（丢失）
    # - 跨版本时目标 Dify 导出会补新字段（1.10 rag_pipeline_variables、1.14 icon_type、1.18 site），
    #   这些 chunk 的源侧为 "undefined"，不算丢失；源侧已有的值被改/删才算（altered）
    # 目标多出的应用（ONLY_IN_BACKUP）不算失败
    missing=$(count_code "${WORK}/diff.json" DRIFT_ONLY_ONLINE)
    altered=$(node -e "
      const r = JSON.parse(require('node:fs').readFileSync('${WORK}/diff.json', 'utf-8'));
      let n = 0;
      for (const i of r.items ?? []) {
        if (i.code !== 'DRIFT_CONTENT') continue;
        for (const c of JSON.parse(i.detail ?? '[]')) if (c.online !== 'undefined') { n++; console.error('  altered: ' + i.app + ' ' + c.path); }
      }
      console.log(n);
    " 2>>"$LOG" || echo 1)
    if [ "${altered:-1}" -eq 0 ] && [ "${missing:-0}" -eq 0 ]; then
      pass "diff --baseline 源应用内容在目标完整保留（仅目标版本新增字段）"
    else
      fail "迁移后源内容丢失或被改动 (altered=${altered:-?} ONLY_ONLINE=${missing:-0})"
      cat "${WORK}/diff.json" >> "$LOG"
    fi
  else
    fail "diff --baseline 执行失败"; cat "${WORK}/diff.err" >> "$LOG"
  fi
else
  echo "SKIP  [$VERSION] migrate roundtrip（未提供 migrate_target_port）" | tee -a "$LOG"
fi

if [ "$FAILED" -eq 0 ]; then
  echo "RESULT [$VERSION] ALL PASS" | tee -a "$LOG"
else
  echo "RESULT [$VERSION] HAS FAILURES" | tee -a "$LOG"
fi
rm -rf "$WORK"
exit $FAILED
