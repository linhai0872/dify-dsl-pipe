"""
MinIO 存储后端实现
"""

import logging
from pathlib import Path
from typing import Optional

try:
    from minio import Minio
    from minio.error import S3Error
except ImportError:
    Minio = None
    S3Error = Exception

from .base import StorageBackend

logger = logging.getLogger(__name__)


class MinIOStorage(StorageBackend):
    """MinIO 存储后端"""

    def __init__(self, config: dict):
        """
        初始化 MinIO 存储
        
        Args:
            config: 配置字典，需包含以下键：
                - endpoint: MinIO 服务地址
                - access_key: Access Key
                - secret_key: Secret Key
                - bucket_name: Bucket 名称
                - prefix: 文件路径前缀（可选）
                - secure: 是否使用 HTTPS（可选，默认 True）
        """
        super().__init__(config)
        
        if Minio is None:
            raise ImportError("请安装 minio: pip install minio")
        
        endpoint = config.get("endpoint", "")
        access_key = config.get("access_key", "")
        secret_key = config.get("secret_key", "")
        self.bucket_name = config.get("bucket_name", "")
        self.prefix = config.get("prefix", "").strip("/")
        secure = config.get("secure", True)
        
        # 创建 MinIO 客户端
        self.client = Minio(
            endpoint,
            access_key=access_key,
            secret_key=secret_key,
            secure=secure,
        )
        
        # 确保 Bucket 存在
        try:
            if not self.client.bucket_exists(self.bucket_name):
                logger.info(f"Bucket {self.bucket_name} 不存在，尝试创建...")
                self.client.make_bucket(self.bucket_name)
        except Exception as e:
            logger.warning(f"检查/创建 Bucket 失败: {e}")
        
        logger.info(f"MinIO 初始化成功: {self.bucket_name}")

    def _get_full_path(self, remote_path: str) -> str:
        """获取完整的对象名称"""
        if self.prefix:
            return f"{self.prefix}/{remote_path}".strip("/")
        return remote_path.strip("/")

    def upload(self, local_path: str, remote_path: Optional[str] = None) -> str:
        """
        上传文件到 MinIO
        
        Args:
            local_path: 本地文件路径
            remote_path: MinIO 对象名称
            
        Returns:
            MinIO 对象的 URL
        """
        if remote_path is None:
            remote_path = Path(local_path).name
        
        object_name = self._get_full_path(remote_path)
        
        try:
            logger.info(f"上传文件到 MinIO: {object_name}")
            self.client.fput_object(self.bucket_name, object_name, local_path)
            
            # 生成文件 URL
            url = f"{'https' if self.client._base_url.is_ssl else 'http'}://{self.client._base_url.netloc}/{self.bucket_name}/{object_name}"
            logger.info(f"文件上传成功: {url}")
            return url
        except Exception as e:
            logger.error(f"上传文件失败: {e}")
            raise

    def download(self, remote_path: str, local_path: str) -> bool:
        """
        从 MinIO 下载文件
        
        Args:
            remote_path: MinIO 对象名称
            local_path: 本地文件路径
            
        Returns:
            是否成功
        """
        object_name = self._get_full_path(remote_path)
        
        try:
            # 确保目标目录存在
            Path(local_path).parent.mkdir(parents=True, exist_ok=True)
            
            logger.info(f"从 MinIO 下载文件: {object_name}")
            self.client.fget_object(self.bucket_name, object_name, local_path)
            logger.info(f"文件下载成功: {local_path}")
            return True
        except Exception as e:
            logger.error(f"下载文件失败: {e}")
            return False

    def exists(self, remote_path: str) -> bool:
        """
        检查对象是否存在
        
        Args:
            remote_path: MinIO 对象名称
            
        Returns:
            对象是否存在
        """
        object_name = self._get_full_path(remote_path)
        
        try:
            self.client.stat_object(self.bucket_name, object_name)
            return True
        except S3Error:
            return False
        except Exception as e:
            logger.error(f"检查对象存在性失败: {e}")
            return False

    def delete(self, remote_path: str) -> bool:
        """
        删除对象
        
        Args:
            remote_path: MinIO 对象名称
            
        Returns:
            是否成功
        """
        object_name = self._get_full_path(remote_path)
        
        try:
            logger.info(f"删除 MinIO 对象: {object_name}")
            self.client.remove_object(self.bucket_name, object_name)
            return True
        except Exception as e:
            logger.error(f"删除对象失败: {e}")
            return False

    def list_files(self, prefix: str = "") -> list:
        """
        列出对象
        
        Args:
            prefix: 对象路径前缀
            
        Returns:
            对象名称列表
        """
        list_prefix = self._get_full_path(prefix) if prefix else self.prefix
        
        files = []
        try:
            objects = self.client.list_objects(
                self.bucket_name, prefix=list_prefix, recursive=True
            )
            for obj in objects:
                files.append(obj.object_name)
        except Exception as e:
            logger.error(f"列出对象失败: {e}")
        
        return files

