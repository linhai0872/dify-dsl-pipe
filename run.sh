#!/bin/bash
# ===== Dify DSL 导出工具启动脚本 =====

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 脚本目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 打印带颜色的消息
print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查配置文件
check_config() {
    if [ ! -f "config.yaml" ]; then
        print_warn "配置文件 config.yaml 不存在"
        if [ -f "config.yaml.example" ]; then
            print_info "正在从示例创建配置文件..."
            cp config.yaml.example config.yaml
            print_warn "请编辑 config.yaml 填写您的配置"
            exit 1
        else
            print_error "未找到配置文件示例"
            exit 1
        fi
    fi
}

# Docker 部署
docker_run() {
    print_info "使用 Docker 运行导出工具..."
    
    # 检查 Docker 是否安装
    if ! command -v docker &> /dev/null; then
        print_error "Docker 未安装，请先安装 Docker"
        exit 1
    fi
    
    # 检查配置文件
    check_config
    
    # 构建镜像（如果需要）
    if [ "$1" = "--build" ]; then
        print_info "构建 Docker 镜像..."
        docker-compose build
    fi
    
    # 运行容器
    print_info "启动导出任务..."
    docker-compose run --rm dify-exporter "${@:2}"
}

# Python 本地运行
python_run() {
    print_info "使用 Python 本地运行导出工具..."
    
    # 检查 Python 是否安装
    if ! command -v python3 &> /dev/null; then
        print_error "Python3 未安装，请先安装 Python 3.11+"
        exit 1
    fi
    
    # 检查配置文件
    check_config
    
    # 检查依赖是否安装
    if [ ! -d "venv" ]; then
        print_info "创建虚拟环境..."
        python3 -m venv venv
        source venv/bin/activate
        print_info "安装依赖..."
        pip install -r requirements.txt
    else
        source venv/bin/activate
    fi
    
    # 运行程序
    print_info "启动导出任务..."
    python -m src.main --config config.yaml "$@"
}

# 显示帮助信息
show_help() {
    cat << EOF
Dify DSL 导出工具启动脚本

用法:
  $0 [命令] [选项]

命令:
  docker              使用 Docker 运行（推荐）
  python              使用本地 Python 运行
  help                显示此帮助信息

Docker 选项:
  --build             构建 Docker 镜像
  --dry-run           测试模式（不上传）

Python 选项:
  --dry-run           测试模式（不上传）

示例:
  # Docker 方式（首次运行需要构建）
  $0 docker --build
  
  # Docker 方式（直接运行）
  $0 docker
  
  # Docker 测试模式
  $0 docker --dry-run
  
  # Python 本地运行
  $0 python
  
  # Python 测试模式
  $0 python --dry-run

EOF
}

# 主逻辑
main() {
    case "$1" in
        docker)
            shift
            docker_run "$@"
            ;;
        python)
            shift
            python_run "$@"
            ;;
        help|--help|-h)
            show_help
            ;;
        *)
            if [ -z "$1" ]; then
                show_help
            else
                print_error "未知命令: $1"
                show_help
                exit 1
            fi
            ;;
    esac
}

main "$@"

