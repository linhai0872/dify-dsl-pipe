#!/usr/bin/env bash
# compat-run.sh — 在 GZ 上一键跑全部版本的兼容性测试（并行起环境，串行测试）
# 用法: compat-run.sh [prepare|up|test|down|all]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MATRIX="${SCRIPT_DIR}/../matrix.conf"
ACTION="${1:-all}"

run_for_all() {
  local fn="$1"
  while IFS='|' read -r version port adapter note; do
    [[ "$version" =~ ^#.*$ || -z "$version" ]] && continue
    "$fn" "$version" "$port" "$adapter"
  done < "$MATRIX"
}

do_prepare() { "${SCRIPT_DIR}/prepare-env.sh" "$1" "$2"; }
do_up()      { "${SCRIPT_DIR}/up-and-init.sh" "$1" "$2"; }

do_up_all_parallel() {
  local pids=()
  while IFS='|' read -r version port adapter note; do
    [[ "$version" =~ ^#.*$ || -z "$version" ]] && continue
    do_up "$version" "$port" &
    pids+=($!)
  done < "$MATRIX"
  local fail=0
  for p in "${pids[@]}"; do wait "$p" || fail=1; done
  return $fail
}

do_test() {
  local version="$1" port="$2"
  echo ">> [${version}] 跑兼容性测试 (端口 ${port})"
  "${SCRIPT_DIR}/run-tests.sh" "$version" "$port"
}

do_down() {
  local version="$1"
  local proj="dify-compat-${version//./-}"
  local envdir="/opt/dify-compat/envs/${version}/docker"
  echo ">> [${version}] 停止环境"
  (cd "$envdir" && docker compose -p "$proj" -f docker-compose.minimal.yaml down) || true
}

case "$ACTION" in
  prepare) run_for_all do_prepare ;;
  up)      do_up_all_parallel ;;
  test)    run_for_all do_test ;;
  down)    run_for_all do_down ;;
  all)
    run_for_all do_prepare
    do_up_all_parallel
    run_for_all do_test
    ;;
  *) echo "未知动作: $ACTION (prepare|up|test|down|all)"; exit 1 ;;
esac
