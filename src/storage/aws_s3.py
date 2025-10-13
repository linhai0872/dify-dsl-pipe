"""
AWS S3 存储后端实现
"""

import logging
from pathlib import Path
from typing import Optional

try:
    import boto3
    from botocore.exceptions import ClientError
except ImportError:
    boto3 = None
    ClientError = Exception

from .base import StorageBackend

logger = logging.getLogger(__name__)


class AWSS3Storage(StorageBackend):
    """AWS S3 存储后端"""

    def __init__(self, config: dict):
        """
        初始化 AWS S3 存储
        
        Args:
            config: 配置字典，需包含以下键：
                - region: AWS 区域
                - access_key_id: Access Key ID
                - secret_access_key: Secret Access Key
                - bucket_name: Bucket 名称
                - prefix: 文件路径前缀（可选）
                - endpoint_url: 自定义 Endpoint（可选，用于 S3 兼容存储）
        """
        super().__init__(config)
        
        if boto3 is None:
            raise ImportError("请安装 boto3: pip install boto3")
        
        region = config.get("region", "us-east-1")
        access_key_id = config.get("access_key_id", "")
        secret_access_key = config.get("secret_access_key", "")
        self.bucket_name = config.get("bucket_name", "")
        self.prefix = config.get("prefix", "").strip("/")
        endpoint_url = config.get("endpoint_url")
        
        # 创建 S3 客户端
        self.s3_client = boto3.client(
            "s3",
            region_name=region,
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
            endpoint_url=endpoint_url,
        )
        
        logger.info(f"AWS S3 初始化成功: {self.bucket_name}")

    def _get_full_path(self, remote_path: str) -> str:
        """获取完整的对象 Key"""
        if self.prefix:
            return f"{self.prefix}/{remote_path}".strip("/")
        return remote_path.strip("/")

    def upload(self, local_path: str, remote_path: Optional[str] = None) -> str:
        """
        上传文件到 AWS S3
        
        Args:
            local_path: 本地文件路径
            remote_path: S3 对象 Key
            
        Returns:
            S3 对象的 URL
        """
        if remote_path is None:
            remote_path = Path(local_path).name
        
        object_key = self._get_full_path(remote_path)
        
        try:
            logger.info(f"上传文件到 AWS S3: {object_key}")
            self.s3_client.upload_file(local_path, self.bucket_name, object_key)
            
            # 生成文件 URL
            region = self.s3_client.meta.region_name
            url = f"https://{self.bucket_name}.s3.{region}.amazonaws.com/{object_key}"
            logger.info(f"文件上传成功: {url}")
            return url
        except Exception as e:
            logger.error(f"上传文件失败: {e}")
            raise

    def download(self, remote_path: str, local_path: str) -> bool:
        """
        从 AWS S3 下载文件
        
        Args:
            remote_path: S3 对象 Key
            local_path: 本地文件路径
            
        Returns:
            是否成功
        """
        object_key = self._get_full_path(remote_path)
        
        try:
            # 确保目标目录存在
            Path(local_path).parent.mkdir(parents=True, exist_ok=True)
            
            logger.info(f"从 AWS S3 下载文件: {object_key}")
            self.s3_client.download_file(self.bucket_name, object_key, local_path)
            logger.info(f"文件下载成功: {local_path}")
            return True
        except Exception as e:
            logger.error(f"下载文件失败: {e}")
            return False

    def exists(self, remote_path: str) -> bool:
        """
        检查对象是否存在
        
        Args:
            remote_path: S3 对象 Key
            
        Returns:
            对象是否存在
        """
        object_key = self._get_full_path(remote_path)
        
        try:
            self.s3_client.head_object(Bucket=self.bucket_name, Key=object_key)
            return True
        except ClientError:
            return False
        except Exception as e:
            logger.error(f"检查对象存在性失败: {e}")
            return False

    def delete(self, remote_path: str) -> bool:
        """
        删除对象
        
        Args:
            remote_path: S3 对象 Key
            
        Returns:
            是否成功
        """
        object_key = self._get_full_path(remote_path)
        
        try:
            logger.info(f"删除 AWS S3 对象: {object_key}")
            self.s3_client.delete_object(Bucket=self.bucket_name, Key=object_key)
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
            对象 Key 列表
        """
        list_prefix = self._get_full_path(prefix) if prefix else self.prefix
        
        files = []
        try:
            paginator = self.s3_client.get_paginator("list_objects_v2")
            pages = paginator.paginate(Bucket=self.bucket_name, Prefix=list_prefix)
            
            for page in pages:
                if "Contents" in page:
                    for obj in page["Contents"]:
                        files.append(obj["Key"])
        except Exception as e:
            logger.error(f"列出对象失败: {e}")
        
        return files

