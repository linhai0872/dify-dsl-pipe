# ===== Dify DSL 导出工具 Docker 镜像 =====
# 基于 Python 3.11 slim 镜像构建，轻量化设计
# 使用国内镜像源加速构建

FROM python:3.11-slim

# ===== 设置工作目录 =====
WORKDIR /app

# ===== 安装系统依赖 =====
# 使用阿里云镜像源加速
RUN sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list.d/debian.sources && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# ===== 配置 pip 使用国内镜像源 =====
RUN pip config set global.index-url https://mirrors.aliyun.com/pypi/simple/ && \
    pip config set install.trusted-host mirrors.aliyun.com

# ===== 复制依赖文件 =====
COPY requirements.txt .

# ===== 安装 Python 依赖 =====
RUN pip install --no-cache-dir -r requirements.txt

# ===== 复制应用代码 =====
COPY src/ /app/src/
COPY config.yaml.example /app/config.yaml.example

# ===== 创建数据目录 =====
RUN mkdir -p /data/dify-backups /tmp/dify-export

# ===== 设置环境变量 =====
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

# ===== 设置时区（可选） =====
ENV TZ=Asia/Shanghai

# ===== 入口点 =====
# 使用 python -m 方式运行模块
ENTRYPOINT ["python", "-m", "src.main"]

# ===== 默认参数 =====
# 可以在 docker run 时覆盖
CMD ["--config", "/app/config.yaml"]

# ===== 健康检查（可选） =====
# HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
#   CMD python -c "import sys; sys.exit(0)"

# ===== 标签 =====
LABEL maintainer="Dify DSL Exporter Team"
LABEL description="Dify DSL 批量导出工具"
LABEL version="1.0.0"

