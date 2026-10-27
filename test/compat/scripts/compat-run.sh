#!/usr/bin/env bash
# compat-run.sh — 在 GZ 上一键跑全部版本的兼容性测试（并行起环境，串行测试）
# 用法: compat-run.sh [prepare|up|test|down|all]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MATRIX="${SCRIPT_DIR}/../matrix.conf"
ACTION="${1:-all}"

# migrate 检查用：取矩阵里“下一个”非 legacy 版本的端口作为迁移目标。
# 顺序即 matrix.conf 顺序；找不到（如最后一个版本）就回环到第一个非 legacy。
# 不用 nameref/数组索引，保持 bash 3.2 兼容。
migrate_target_port_for() {
  local cur_version="$1"
  local found=0 target="" first_nonlegacy_port=""
  local v p a n
  while IFS='|' read -r v p a n; do
    [[ "$v" =~ ^#.*$ || -z "$v" ]] && continue
    if [ -z "$first_nonlegacy_port" ] && [ "$a" != "legacy" ]; then
      first_nonlegacy_port="$p"
    fi
    if [ "$found" -eq 1 ] && [ "$a" != "legacy" ]; then
      target="$p"; break
    fi
    [ "$v" = "$cur_version" ] && found=1
  done < "$MATRIX"
  [ -z "$target" ] && target="$first_nonlegacy_port"
  echo "$target"
}

run_for_all() {
  local fn="$1"
  local version port adapter note
  while IFS='|' read -r version port adapter note; do
    [[ "$version" =~ ^#.*$ || -z "$version" ]] && continue
    "$fn" "$version" "$port" "$adapter"
  done < "$MATRIX"
}

do_prepare() { "${SCRIPT_DIR}/prepare-env.sh" "$1" "$2"; }
do_up()      { "${SCRIPT_DIR}/up-and-init.sh" "$1" "$2"; }

do_up_all_parallel() {
  local pids=()
  local version port adapter note
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
  local target_port
  target_port="$(migrate_target_port_for "$version")"
  echo ">> [${version}] 跑兼容性测试 (端口 ${port}${target_port:+, migrate 目标 ${target_port}})"
  if [ -n "$target_port" ]; then
    "${SCRIPT_DIR}/run-tests.sh" "$version" "$port" "127.0.0.1" "$target_port"
  else
    "${SCRIPT_DIR}/run-tests.sh" "$version" "$port" "127.0.0.1"
  fi
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
