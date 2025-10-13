"""
配置管理模块
支持从 YAML 文件和环境变量加载配置
"""

import logging
import os
from pathlib import Path
from typing import Any, Dict, Optional

import yaml

logger = logging.getLogger(__name__)


class Config:
    """配置管理类"""

    def __init__(self, config_path: Optional[str] = None):
        """
        初始化配置
        
        Args:
            config_path: 配置文件路径，如果为 None 则尝试从默认位置加载
        """
        self._config: Dict[str, Any] = {}
        self._load_config(config_path)
        self._override_from_env()

    def _load_config(self, config_path: Optional[str] = None) -> None:
        """
        从 YAML 文件加载配置
        
        Args:
            config_path: 配置文件路径
        """
        if config_path is None:
            # 尝试从默认位置加载配置文件
            default_paths = [
                "config.yaml",
                "config.yml",
                "/etc/dify-exporter/config.yaml",
                os.path.expanduser("~/.dify-exporter/config.yaml"),
            ]
            for path in default_paths:
                if os.path.exists(path):
                    config_path = path
                    break

        if config_path and os.path.exists(config_path):
            try:
                with open(config_path, "r", encoding="utf-8") as f:
                    self._config = yaml.safe_load(f) or {}
                logger.info(f"配置文件加载成功: {config_path}")
            except Exception as e:
                logger.error(f"配置文件加载失败: {e}")
                raise
        else:
            logger.warning("未找到配置文件，将使用环境变量和默认值")
            self._config = self._get_default_config()

    def _get_default_config(self) -> Dict[str, Any]:
        """获取默认配置"""
        return {
            "dify": {
                "base_url": "http://localhost/console/api",
                "api_token": "",
                "include_secret": False,
                "timeout": 30,
                "max_retries": 3,
            },
            "export": {
                "temp_dir": "/tmp/dify-export",
                "archive_format": "zip",
                "cleanup_after_upload": True,
                "app_types": [],
            },
            "storage": {
                "backend": "local",
                "local": {"path": "/data/dify-backups"},
            },
            "logging": {
                "level": "INFO",
                "file": "",
                "format": "detailed",
            },
        }

    def _override_from_env(self) -> None:
        """
        从环境变量覆盖配置
        环境变量命名规则：DIFY_EXPORTER_<SECTION>_<KEY>
        例如：DIFY_EXPORTER_DIFY_BASE_URL
        """
        # ===== Dify 配置 =====
        if os.getenv("DIFY_EXPORTER_DIFY_BASE_URL"):
            self._config.setdefault("dify", {})["base_url"] = os.getenv(
                "DIFY_EXPORTER_DIFY_BASE_URL"
            )

        if os.getenv("DIFY_EXPORTER_DIFY_EMAIL"):
            self._config.setdefault("dify", {})["email"] = os.getenv(
                "DIFY_EXPORTER_DIFY_EMAIL"
            )

        if os.getenv("DIFY_EXPORTER_DIFY_PASSWORD"):
            self._config.setdefault("dify", {})["password"] = os.getenv(
                "DIFY_EXPORTER_DIFY_PASSWORD"
            )

        if os.getenv("DIFY_EXPORTER_DIFY_ACCESS_TOKEN"):
            self._config.setdefault("dify", {})["access_token"] = os.getenv(
                "DIFY_EXPORTER_DIFY_ACCESS_TOKEN"
            )

        if os.getenv("DIFY_EXPORTER_DIFY_INCLUDE_SECRET"):
            self._config.setdefault("dify", {})["include_secret"] = (
                os.getenv("DIFY_EXPORTER_DIFY_INCLUDE_SECRET", "false").lower() == "true"
            )

        # ===== 导出配置 =====
        if os.getenv("DIFY_EXPORTER_EXPORT_TEMP_DIR"):
            self._config.setdefault("export", {})["temp_dir"] = os.getenv(
                "DIFY_EXPORTER_EXPORT_TEMP_DIR"
            )

        # ===== 存储配置 =====
        if os.getenv("DIFY_EXPORTER_STORAGE_BACKEND"):
            self._config.setdefault("storage", {})["backend"] = os.getenv(
                "DIFY_EXPORTER_STORAGE_BACKEND"
            )

        # 本地存储
        if os.getenv("DIFY_EXPORTER_STORAGE_LOCAL_PATH"):
            self._config.setdefault("storage", {}).setdefault("local", {})[
                "path"
            ] = os.getenv("DIFY_EXPORTER_STORAGE_LOCAL_PATH")

        # 阿里云 OSS
        if os.getenv("DIFY_EXPORTER_STORAGE_ALIYUN_ENDPOINT"):
            self._config.setdefault("storage", {}).setdefault("aliyun_oss", {})[
                "endpoint"
            ] = os.getenv("DIFY_EXPORTER_STORAGE_ALIYUN_ENDPOINT")
        if os.getenv("DIFY_EXPORTER_STORAGE_ALIYUN_ACCESS_KEY_ID"):
            self._config.setdefault("storage", {}).setdefault("aliyun_oss", {})[
                "access_key_id"
            ] = os.getenv("DIFY_EXPORTER_STORAGE_ALIYUN_ACCESS_KEY_ID")
        if os.getenv("DIFY_EXPORTER_STORAGE_ALIYUN_ACCESS_KEY_SECRET"):
            self._config.setdefault("storage", {}).setdefault("aliyun_oss", {})[
                "access_key_secret"
            ] = os.getenv("DIFY_EXPORTER_STORAGE_ALIYUN_ACCESS_KEY_SECRET")
        if os.getenv("DIFY_EXPORTER_STORAGE_ALIYUN_BUCKET_NAME"):
            self._config.setdefault("storage", {}).setdefault("aliyun_oss", {})[
                "bucket_name"
            ] = os.getenv("DIFY_EXPORTER_STORAGE_ALIYUN_BUCKET_NAME")

        # AWS S3
        if os.getenv("DIFY_EXPORTER_STORAGE_AWS_REGION"):
            self._config.setdefault("storage", {}).setdefault("aws_s3", {})[
                "region"
            ] = os.getenv("DIFY_EXPORTER_STORAGE_AWS_REGION")
        if os.getenv("DIFY_EXPORTER_STORAGE_AWS_ACCESS_KEY_ID"):
            self._config.setdefault("storage", {}).setdefault("aws_s3", {})[
                "access_key_id"
            ] = os.getenv("DIFY_EXPORTER_STORAGE_AWS_ACCESS_KEY_ID")
        if os.getenv("DIFY_EXPORTER_STORAGE_AWS_SECRET_ACCESS_KEY"):
            self._config.setdefault("storage", {}).setdefault("aws_s3", {})[
                "secret_access_key"
            ] = os.getenv("DIFY_EXPORTER_STORAGE_AWS_SECRET_ACCESS_KEY")
        if os.getenv("DIFY_EXPORTER_STORAGE_AWS_BUCKET_NAME"):
            self._config.setdefault("storage", {}).setdefault("aws_s3", {})[
                "bucket_name"
            ] = os.getenv("DIFY_EXPORTER_STORAGE_AWS_BUCKET_NAME")

        # ===== 日志配置 =====
        if os.getenv("DIFY_EXPORTER_LOGGING_LEVEL"):
            self._config.setdefault("logging", {})["level"] = os.getenv(
                "DIFY_EXPORTER_LOGGING_LEVEL"
            )

    def get(self, key: str, default: Any = None) -> Any:
        """
        获取配置值（支持点号分隔的嵌套键）
        
        Args:
            key: 配置键，支持 "section.key" 格式
            default: 默认值
            
        Returns:
            配置值
        """
        keys = key.split(".")
        value = self._config
        for k in keys:
            if isinstance(value, dict):
                value = value.get(k)
                if value is None:
                    return default
            else:
                return default
        return value

    def get_dify_config(self) -> Dict[str, Any]:
        """获取 Dify 配置"""
        return self._config.get("dify", {})

    def get_export_config(self) -> Dict[str, Any]:
        """获取导出配置"""
        return self._config.get("export", {})

    def get_storage_config(self) -> Dict[str, Any]:
        """获取存储配置"""
        return self._config.get("storage", {})

    def get_logging_config(self) -> Dict[str, Any]:
        """获取日志配置"""
        return self._config.get("logging", {})

    def validate(self) -> bool:
        """
        验证配置是否有效
        
        Returns:
            配置是否有效
        """
        # ===== 验证 Dify 配置 =====
        dify_config = self.get_dify_config()
        if not dify_config.get("base_url"):
            logger.error("Dify base_url 未配置")
            return False
        
        # 验证认证配置：必须提供 access_token 或 (email + password)
        has_access_token = bool(dify_config.get("access_token"))
        has_email_password = bool(dify_config.get("email") and dify_config.get("password"))
        
        if not has_access_token and not has_email_password:
            logger.error("Dify 认证未配置：必须提供 access_token 或 (email + password)")
            return False

        # ===== 验证存储配置 =====
        storage_config = self.get_storage_config()
        backend = storage_config.get("backend")
        if not backend:
            logger.error("存储后端未配置")
            return False

        if backend not in [
            "local",
            "aliyun_oss",
            "aws_s3",
            "minio",
            "volcengine",
            "tencent_cos",
        ]:
            logger.error(f"不支持的存储后端: {backend}")
            return False

        # 验证对应后端的配置
        backend_config = storage_config.get(backend, {})
        if backend == "local":
            if not backend_config.get("path"):
                logger.error("本地存储路径未配置")
                return False
        elif backend == "aliyun_oss":
            required_keys = ["endpoint", "access_key_id", "access_key_secret", "bucket_name"]
            if not all(backend_config.get(k) for k in required_keys):
                logger.error(f"阿里云 OSS 配置不完整，需要: {required_keys}")
                return False
        elif backend == "aws_s3":
            required_keys = ["region", "access_key_id", "secret_access_key", "bucket_name"]
            if not all(backend_config.get(k) for k in required_keys):
                logger.error(f"AWS S3 配置不完整，需要: {required_keys}")
                return False
        elif backend == "minio":
            required_keys = ["endpoint", "access_key", "secret_key", "bucket_name"]
            if not all(backend_config.get(k) for k in required_keys):
                logger.error(f"MinIO 配置不完整，需要: {required_keys}")
                return False
        elif backend == "volcengine":
            required_keys = ["endpoint", "access_key_id", "secret_access_key", "bucket_name", "region"]
            if not all(backend_config.get(k) for k in required_keys):
                logger.error(f"火山云 TOS 配置不完整，需要: {required_keys}")
                return False
        elif backend == "tencent_cos":
            required_keys = ["region", "secret_id", "secret_key", "bucket_name"]
            if not all(backend_config.get(k) for k in required_keys):
                logger.error(f"腾讯云 COS 配置不完整，需要: {required_keys}")
                return False

        return True


def setup_logging(config: Config) -> None:
    """
    设置日志配置
    
    Args:
        config: 配置对象
    """
    logging_config = config.get_logging_config()
    level = logging_config.get("level", "INFO")
    log_file = logging_config.get("file", "")
    log_format = logging_config.get("format", "detailed")

    # 设置日志格式
    if log_format == "simple":
        fmt = "%(levelname)s: %(message)s"
    else:  # detailed
        fmt = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"

    # 配置日志处理器
    handlers = [logging.StreamHandler()]
    if log_file:
        # 确保日志目录存在
        log_dir = os.path.dirname(log_file)
        if log_dir:
            os.makedirs(log_dir, exist_ok=True)
        handlers.append(logging.FileHandler(log_file, encoding="utf-8"))

    # 应用日志配置
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format=fmt,
        handlers=handlers,
    )

