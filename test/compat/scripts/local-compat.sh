#!/usr/bin/env bash
# local-compat.sh — 本地一键兼容性回归（内部 CI）
# 改完代码后跑它：构建当前代码 → 确保 GZ 各版本环境在线 → 逐版本冒烟测试 → 汇总。
# 用法: npm run test:compat   （或 bash test/compat/scripts/local-compat.sh）
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
MATRIX="${SCRIPT_DIR}/../matrix.conf"
GZ_HOST="${GZ_HOST:-100.84.215.119}"
GZ_SSH="${GZ_SSH:-GZ-vtrust-workstation}"

cd "$REPO_ROOT"

echo "==> 1/3 构建当前代码"
npm run build >/dev/null 2>&1 || { echo "构建失败"; exit 1; }

echo "==> 2/3 确保 GZ 各版本环境在线 [${GZ_SSH}]"
# 同步最新脚本，再幂等启动（已 running 则跳过）
tar czf - -C "${SCRIPT_DIR}/.." . 2>/dev/null | ssh "${GZ_SSH}" \
  "mkdir -p /opt/dify-compat && tar xzf - -C /opt/dify-compat" 2>/dev/null || true
ssh "${GZ_SSH}" "bash /opt/dify-compat/scripts/compat-run.sh up" 2>&1 \
  | grep -E "就绪|healthy|Running" | sed 's/^/    /' || true

echo "==> 3/3 逐版本冒烟测试"
overall=0
while IFS='|' read -r version port adapter note; do
  [[ "$version" =~ ^#.*$ || -z "$version" ]] && continue
  bash "${SCRIPT_DIR}/run-tests.sh" "$version" "$port" "$GZ_HOST" >/dev/null 2>&1 \
    && echo "    ✅ $version" || { echo "    ❌ $version （见 test/compat/results/$version.log）"; overall=1; }
done < "$MATRIX"

echo "=============================="
grep -h "^RESULT" "${SCRIPT_DIR}/../results/"*.log 2>/dev/null | sort | sed 's/^/  /'
echo "=============================="
if [ "$overall" -eq 0 ]; then
  echo "全部版本兼容 ✅"
else
  echo "存在失败版本 ❌（日志见 test/compat/results/）"
fi
exit $overall
