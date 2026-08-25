#!/usr/bin/env bash
# up-and-init.sh <version> <host_port>
# 启动指定版本的最小化环境，并无人值守完成管理员初始化。
# 输出: 该实例可用后，打印 base_url 与登录凭据。
set -euo pipefail

VERSION="${1:?}"
HOST_PORT="${2:?}"
BASE="/opt/dify-compat"
ENVDIR="${BASE}/envs/${VERSION}/docker"
PROJ="dify-compat-${VERSION//./-}"

. "$(dirname "${BASH_SOURCE[0]}")/config.sh"
BASE_URL="http://127.0.0.1:${HOST_PORT}/console/api"

cd "$ENVDIR"

# api 容器以 uid 1001 运行，需先把 storage 目录属主改对（替代官方 init_permissions 容器）
mkdir -p ./volumes/app/storage ./volumes/db/data ./volumes/redis
if docker run --rm -v "$PWD/volumes/app/storage:/s" busybox sh -c 'chown -R 1001:1001 /s' 2>/dev/null; then
  echo ">> [${VERSION}] storage 权限已初始化 (uid 1001)"
fi

echo ">> [${VERSION}] 启动最小化环境 (project=${PROJ})"
docker compose -p "$PROJ" -f docker-compose.minimal.yaml up -d db_postgres redis

echo ">> [${VERSION}] 等待 postgres 就绪并创建 dify_plugin 库"
for i in $(seq 1 30); do
  if docker exec "${PROJ}-db_postgres-1" pg_isready -U postgres -d dify >/dev/null 2>&1; then break; fi
  sleep 2
done
docker exec "${PROJ}-db_postgres-1" \
  psql -U postgres -tc "SELECT 1 FROM pg_database WHERE datname='dify_plugin'" | grep -q 1 \
  || docker exec "${PROJ}-db_postgres-1" psql -U postgres -c "CREATE DATABASE dify_plugin" >/dev/null

echo ">> [${VERSION}] 启动 api 与 plugin_daemon"
docker compose -p "$PROJ" -f docker-compose.minimal.yaml up -d

echo ">> [${VERSION}] 等待 API 健康 (${BASE_URL})"
for i in $(seq 1 90); do
  if curl -sf "http://127.0.0.1:${HOST_PORT}/console/api/setup" >/dev/null 2>&1; then
    break
  fi
  sleep 3
  if [ "$i" -eq 90 ]; then
    echo "!! [${VERSION}] API 等待超时"; docker compose -p "$PROJ" logs --tail=40 api; exit 1
  fi
done

# 初始化：若已 finished 则跳过
STEP=$(curl -s "http://127.0.0.1:${HOST_PORT}/console/api/setup" | grep -o '"step"[^,}]*' || true)
if ! echo "$STEP" | grep -q finished; then
  echo ">> [${VERSION}] 创建管理员账号"
  curl -s -X POST "http://127.0.0.1:${HOST_PORT}/console/api/setup" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${ADMIN_EMAIL}\",\"name\":\"${ADMIN_NAME}\",\"password\":\"${ADMIN_PASSWORD}\",\"language\":\"en-US\"}" \
    >/dev/null
fi

echo ">> [${VERSION}] 就绪 base_url=${BASE_URL} email=${ADMIN_EMAIL} password=${ADMIN_PASSWORD}"
