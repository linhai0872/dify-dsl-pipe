#!/usr/bin/env bash
# config.sh — 兼容性测试的公共配置（被各脚本 source）。
# 密码优先级：环境变量 > GZ 上 /opt/dify-compat/.env > 下方占位符默认值。
# 不要在本文件提交真实密码；真实值放 GZ 的 /opt/dify-compat/.env（不入库）。

# 加载 .env：优先本地 test/compat/.env（gitignore 保护），其次 GZ /opt/dify-compat/.env。
# 真实密码只放这两处（均不入库），勿提交。
_CONFIG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_LOCAL_ENV="${_CONFIG_DIR}/../.env"
_GZ_ENV="${COMPAT_ENV_FILE:-/opt/dify-compat/.env}"
# shellcheck disable=SC1090
if [ -f "$_LOCAL_ENV" ]; then
  . "$_LOCAL_ENV"
elif [ -f "$_GZ_ENV" ]; then
  . "$_GZ_ENV"
fi

: "${COMPAT_ADMIN_EMAIL:=admin@compat.test}"
: "${COMPAT_ADMIN_NAME:=Compat Admin}"
: "${COMPAT_ADMIN_PASSWORD:=changeme-admin-password}"
: "${COMPAT_DB_PASSWORD:=changeme-db-password}"
: "${COMPAT_REDIS_PASSWORD:=changeme-redis-password}"
: "${COMPAT_PLUGIN_DAEMON_KEY:=changeme-plugin-daemon-key}"
: "${COMPAT_PLUGIN_INNER_API_KEY:=changeme-inner-api-key}"

ADMIN_EMAIL="$COMPAT_ADMIN_EMAIL"
ADMIN_NAME="$COMPAT_ADMIN_NAME"
ADMIN_PASSWORD="$COMPAT_ADMIN_PASSWORD"
DB_PASSWORD="$COMPAT_DB_PASSWORD"
REDIS_PASSWORD="$COMPAT_REDIS_PASSWORD"
PLUGIN_DAEMON_KEY="$COMPAT_PLUGIN_DAEMON_KEY"
PLUGIN_DIFY_INNER_API_KEY="$COMPAT_PLUGIN_INNER_API_KEY"
