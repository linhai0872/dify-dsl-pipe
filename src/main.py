#!/usr/bin/env python3
"""
Dify DSL 导出工具主程序
用于批量导出 Dify 应用的 DSL 配置
"""

import argparse
import logging
import sys
from pathlib import Path
from typing import Optional

from .config import Config, setup_logging
from .dify_client import DifyClient
from .exporter import DifyDSLExporter
from .storage import StorageBackend
from .storage.aliyun_oss import AliyunOSSStorage
from .storage.aws_s3 import AWSS3Storage
from .storage.local import LocalStorage
from .storage.minio import MinIOStorage
from .storage.tencent_cos import TencentCOSStorage
from .storage.volcengine import VolcengineStorage

logger = logging.getLogger(__name__)


def create_storage_backend(config: Config) -> StorageBackend:
    """
    根据配置创建存储后端
    
    Args:
        config: 配置对象
        
    Returns:
        存储后端实例
        
    Raises:
        ValueError: 不支持的存储后端类型
    """
    storage_config = config.get_storage_config()
    backend_type = storage_config.get("backend", "local")
    backend_config = storage_config.get(backend_type, {})
    
    # 根据类型创建对应的存储后端
    storage_map = {
        "local": LocalStorage,
        "aliyun_oss": AliyunOSSStorage,
        "aws_s3": AWSS3Storage,
        "minio": MinIOStorage,
        "volcengine": VolcengineStorage,
        "tencent_cos": TencentCOSStorage,
    }
    
    storage_class = storage_map.get(backend_type)
    if storage_class is None:
        raise ValueError(f"不支持的存储后端类型: {backend_type}")
    
    logger.info(f"初始化存储后端: {backend_type}")
    return storage_class(backend_config)


def run_export(
    config: Config,
    dry_run: bool = False,
) -> bool:
    """
    执行导出任务
    
    Args:
        config: 配置对象
        dry_run: 是否为测试模式（不实际上传）
        
    Returns:
        是否成功
    """
    try:
        # ===== 1. 初始化 Dify 客户端 =====
        logger.info("=" * 60)
        logger.info("开始 Dify DSL 导出任务")
        logger.info("=" * 60)
        
        dify_config = config.get_dify_config()
        client = DifyClient(
            base_url=dify_config.get("base_url", ""),
            email=dify_config.get("email"),
            password=dify_config.get("password"),
            access_token=dify_config.get("access_token"),
            timeout=dify_config.get("timeout", 30),
            max_retries=dify_config.get("max_retries", 3),
        )
        
        # 检查连接
        if not client.check_connection():
            logger.error("Dify API 连接失败，请检查配置")
            return False
        
        # ===== 2. 初始化导出器 =====
        export_config = config.get_export_config()
        exporter = DifyDSLExporter(
            client=client,
            temp_dir=export_config.get("temp_dir", "/tmp/dify-export"),
            include_secret=dify_config.get("include_secret", False),
            app_types=export_config.get("app_types", []),
            include_tags_in_filename=export_config.get("include_tags_in_filename", False),
            export_version_history=export_config.get("export_version_history", True),
        )
        
        # ===== 3. 执行导出 =====
        logger.info("开始导出应用 DSL...")
        zip_path = exporter.export_all_apps()
        
        if not zip_path or not Path(zip_path).exists():
            logger.error("导出失败：未生成 ZIP 文件")
            return False
        
        logger.info(f"导出完成，文件: {zip_path}")
        logger.info(f"文件大小: {Path(zip_path).stat().st_size / 1024 / 1024:.2f} MB")
        
        # ===== 4. 上传到存储后端 =====
        if dry_run:
            logger.info("测试模式：跳过上传")
        else:
            storage = create_storage_backend(config)
            
            # 测试存储连接
            if not storage.test_connection():
                logger.error("存储后端连接失败，请检查配置")
                return False
            
            # 上传文件
            logger.info("上传文件到存储后端...")
            remote_path = Path(zip_path).name
            result = storage.upload(zip_path, remote_path)
            logger.info(f"文件已上传: {result}")
        
        # ===== 5. 清理临时文件 =====
        cleanup_after_upload = export_config.get("cleanup_after_upload", True)
        if cleanup_after_upload and not dry_run:
            logger.info("清理临时文件...")
            Path(zip_path).unlink(missing_ok=True)
            exporter.cleanup()
            logger.info("临时文件已清理")
        else:
            logger.info(f"临时文件保留在: {zip_path}")
        
        logger.info("=" * 60)
        logger.info("导出任务完成")
        logger.info("=" * 60)
        
        return True
        
    except KeyboardInterrupt:
        logger.warning("用户中断操作")
        return False
    except Exception as e:
        logger.exception(f"导出失败: {e}")
        return False


def main() -> int:
    """
    主函数
    
    Returns:
        退出码（0 表示成功，1 表示失败）
    """
    # ===== 解析命令行参数 =====
    parser = argparse.ArgumentParser(
        description="Dify DSL 批量导出工具",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 使用默认配置文件
  python -m src.main
  
  # 指定配置文件
  python -m src.main --config /path/to/config.yaml
  
  # 测试模式（不上传）
  python -m src.main --dry-run
  
  # 显示版本信息
  python -m src.main --version
        """,
    )
    
    parser.add_argument(
        "-c",
        "--config",
        type=str,
        help="配置文件路径（默认: config.yaml）",
    )
    
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="测试模式，只导出不上传",
    )
    
    parser.add_argument(
        "--version",
        action="version",
        version="Dify DSL Exporter 1.0.0",
    )
    
    args = parser.parse_args()
    
    try:
        # ===== 加载配置 =====
        config = Config(config_path=args.config)
        
        # ===== 设置日志 =====
        setup_logging(config)
        
        # ===== 验证配置 =====
        if not config.validate():
            logger.error("配置验证失败，请检查配置文件")
            return 1
        
        # ===== 执行导出 =====
        success = run_export(config, dry_run=args.dry_run)
        
        return 0 if success else 1
        
    except Exception as e:
        print(f"错误: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

