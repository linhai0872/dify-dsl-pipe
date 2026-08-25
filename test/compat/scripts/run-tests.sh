#!/usr/bin/env bash
# run-tests.sh <version> <host_port> [host]
# 在【本地】跑兼容性冒烟测试，直连 GZ 上已就绪的 Dify 实例。
#   登录(带凭据) → import fixture → export 回来 → dry-run 预检 → 报告
# 结果写入 test/compat/results/<version>.log，并打印 PASS/FAIL 摘要。
set -uo pipefail
# 不用 -e：逐步记录失败而非中途退出，保证矩阵报告完整。

VERSION="${1:?}"
HOST_PORT="${2:?}"
HOST="${3:-100.84.215.119}"
BASE_URL="http://${HOST}:${HOST_PORT}/console/api"
EMAIL="admin@compat.test"
PASSWORD="***REMOVED***"

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

mkdir -p "${WORK}/src/workflow"
cp "${FIXTURE_DIR}/minimal-workflow.yml" "${WORK}/src/workflow/"

step() {
  local name="$1"; shift
  if node "$CLI" "$@" > "${WORK}/out.json" 2>&1; then
    pass "$name"
  else
    fail "$name"; sed 's/^/    /' "${WORK}/out.json" >> "$LOG"
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

if [ "$FAILED" -eq 0 ]; then
  echo "RESULT [$VERSION] ALL PASS" | tee -a "$LOG"
else
  echo "RESULT [$VERSION] HAS FAILURES" | tee -a "$LOG"
fi
rm -rf "$WORK"
exit $FAILED
