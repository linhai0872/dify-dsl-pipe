#!/usr/bin/env bash
# prepare-env.sh <version> <host_port>
# 在 GZ 上为指定 Dify 版本准备最小化测试环境：
#   官方 docker/ 目录 + 最小化 override（仅 api + db_postgres + redis）+ 测试 .env
# 幂等：重复执行会重置到干净状态。
set -euo pipefail

VERSION="${1:?用法: prepare-env.sh <version> <host_port>}"
HOST_PORT="${2:?用法: prepare-env.sh <version> <host_port>}"

BASE="/opt/dify-compat"
ENVDIR="${BASE}/envs/${VERSION}"
PROJ="dify-compat-${VERSION//./-}"

# 加载公共配置（含密码，见 config.sh；真实值经 .env 注入，不入库）
. "$(dirname "${BASH_SOURCE[0]}")/config.sh"

# 测试固定配置（仅测试环境使用，非生产）。SECRET_KEY 按版本派生；密码来自 config.sh。
SECRET_KEY="${COMPAT_SECRET_KEY:-compat-secret-$(echo -n "$VERSION" | md5sum | cut -c1-16)}"

mkdir -p "$ENVDIR"

# 1. 拉取官方 docker 目录（浅克隆该 tag 的 docker 子目录）
if [ ! -d "${ENVDIR}/docker" ]; then
  echo ">> 拉取 Dify ${VERSION} 官方 docker 目录"
  tmp=$(mktemp -d)
  git clone --depth 1 --branch "$VERSION" --filter=blob:none --sparse \
    https://github.com/langgenius/dify.git "$tmp/dify" >/dev/null 2>&1
  (cd "$tmp/dify" && git sparse-checkout set docker >/dev/null 2>&1)
  cp -r "$tmp/dify/docker" "${ENVDIR}/docker"
  rm -rf "$tmp"
fi

cd "${ENVDIR}/docker"

# 2. 准备 .env（从官方模板复制，注入测试配置）
if [ ! -f .env ]; then
  cp .env.example .env
fi
# 覆盖关键测试项（追加到末尾，后者生效）
cat >> .env <<EOF

# ---- compat test overrides (managed by prepare-env.sh) ----
SECRET_KEY=${SECRET_KEY}
INIT_PASSWORD=
DB_USERNAME=postgres
DB_PASSWORD=${DB_PASSWORD}
DB_HOST=db_postgres
DB_PORT=5432
DB_DATABASE=dify
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=${REDIS_PASSWORD}
REDIS_USE_SSL=false
VECTOR_STORE=
EOF

# 3. 生成自包含最小 compose（单独使用，不叠加官方 docker-compose.yaml）
# 原因：新版 api 依赖 agent_backend → plugin_daemon/local_sandbox，depends_on 硬编码，
#       override 无法删除依赖引用。故抽出 api，只保留 db_postgres + redis，依赖链自控。
cat > docker-compose.minimal.yaml <<EOF
# 由 prepare-env.sh 生成 — 自包含最小测试栈，仅 api + db_postgres + redis
# 用法: docker compose -p <proj> -f docker-compose.minimal.yaml up -d
name: ${PROJ}

services:
  api:
    image: langgenius/dify-api:${VERSION}
    restart: always
    env_file:
      - ./.env
    environment:
      MODE: api
      # 关闭向量库 / 插件 / 沙箱等最小化不需要的组件
      VECTOR_STORE: ""
      # 数据库 / Redis 指向本栈服务名
      DB_HOST: db_postgres
      DB_PORT: "5432"
      DB_USERNAME: postgres
      DB_PASSWORD: ${DB_PASSWORD}
      DB_DATABASE: dify
      REDIS_HOST: redis
      REDIS_PORT: "6379"
      REDIS_PASSWORD: ${REDIS_PASSWORD}
      REDIS_USE_SSL: "false"
      CELERY_BROKER_URL: redis://:${REDIS_PASSWORD}@redis:6379/1
      # api 连接 plugin_daemon（导出走插件依赖分析必需）
      PLUGIN_DAEMON_URL: http://plugin_daemon:5002
      PLUGIN_DAEMON_KEY: ${PLUGIN_DAEMON_KEY}
      PLUGIN_DIFY_INNER_API_KEY: ${PLUGIN_DIFY_INNER_API_KEY}
      FORCE_VERIFYING_SIGNATURE: "false"
    ports:
      - "${HOST_PORT}:5001"
    volumes:
      - ./volumes/app/storage:/app/api/storage
    depends_on:
      db_postgres:
        condition: service_healthy
      redis:
        condition: service_started
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:5001/health"]
      interval: 10s
      timeout: 5s
      retries: 30
      start_period: 40s

  db_postgres:
    image: postgres:15-alpine
    restart: always
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: dify
      PGDATA: /var/lib/postgresql/data/pgdata
    volumes:
      - ./volumes/db/data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d dify"]
      interval: 5s
      timeout: 5s
      retries: 20

  redis:
    image: redis:6-alpine
    restart: always
    command: redis-server --requirepass ${REDIS_PASSWORD}
    volumes:
      - ./volumes/redis:/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 5s
      timeout: 5s
      retries: 20

  # Dify 1.x 导出 workflow 应用时会无条件分析插件依赖 → 必须 plugin_daemon 在线
  plugin_daemon:
    image: langgenius/dify-plugin-daemon:0.6.3-local
    restart: always
    env_file:
      - ./.env
    environment:
      DB_HOST: db_postgres
      DB_PORT: "5432"
      DB_USERNAME: postgres
      DB_PASSWORD: ${DB_PASSWORD}
      DB_DATABASE: dify_plugin
      DB_SSL_MODE: disable
      SERVER_PORT: "5002"
      SERVER_KEY: ${PLUGIN_DAEMON_KEY}
      MAX_PLUGIN_PACKAGE_SIZE: "52428800"
      DIFY_INNER_API_URL: http://api:5001
      DIFY_INNER_API_KEY: ${PLUGIN_DIFY_INNER_API_KEY}
      PLUGIN_REMOTE_INSTALLING_HOST: 0.0.0.0
      PLUGIN_REMOTE_INSTALLING_PORT: "5003"
      PLUGIN_WORKING_PATH: /app/storage/cwd
      FORCE_VERIFYING_SIGNATURE: "false"
      PLUGIN_STORAGE_TYPE: local
      PLUGIN_STORAGE_LOCAL_ROOT: /app/storage
      PLUGIN_INSTALLED_PATH: plugin
      PLUGIN_PACKAGE_CACHE_PATH: plugin_packages
      PLUGIN_MEDIA_CACHE_PATH: assets
      SENTRY_ENABLED: "false"
    volumes:
      - ./volumes/plugin_daemon:/app/storage
    depends_on:
      db_postgres:
        condition: service_healthy
EOF

echo ">> 环境就绪: ${ENVDIR}/docker (项目名 ${PROJ}, 端口 ${HOST_PORT})"
echo ">> 管理员: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}"
