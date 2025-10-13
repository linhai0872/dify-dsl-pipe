"""
腾讯云 COS 存储后端实现
"""

import logging
from pathlib import Path
from typing import Optional

try:
    from qcloud_cos import CosConfig, CosS3Client
    from qcloud_cos.cos_exception import CosServiceError
except ImportError:
    CosConfig = None
    CosS3Client = None
    CosServiceError = Exception

from .base import StorageBackend

logger = logging.getLogger(__name__)


class TencentCOSStorage(StorageBackend):
    """腾讯云 COS 存储后端"""

    def __init__(self, config: dict):
        """
        初始化腾讯云 COS 存储
        
        Args:
            config: 配置字典，需包含以下键：
                - region: COS 区域
                - secret_id: SecretId
                - secret_key: SecretKey
                - bucket_name: Bucket 名称（格式：BucketName-APPID）
                - prefix: 文件路径前缀（可选）
        """
        super().__init__(config)
        
        if CosConfig is None or CosS3Client is None:
            raise ImportError("请安装 qcloud-cos-sdk-python: pip install cos-python-sdk-v5")
        
        region = config.get("region", "")
        secret_id = config.get("secret_id", "")
        secret_key = config.get("secret_key", "")
        self.bucket_name = config.get("bucket_name", "")
        self.prefix = config.get("prefix", "").strip("/")
        
        # 创建 COS 配置
        cos_config = CosConfig(
            Region=region,
            SecretId=secret_id,
            SecretKey=secret_key,
        )
        
        # 创建 COS 客户端
        self.client = CosS3Client(cos_config)
        
        logger.info(f"腾讯云 COS 初始化成功: {self.bucket_name}")

    def _get_full_path(self, remote_path: str) -> str:
        """获取完整的对象 Key"""
        if self.prefix:
            return f"{self.prefix}/{remote_path}".strip("/")
        return remote_path.strip("/")

    def upload(self, local_path: str, remote_path: Optional[str] = None) -> str:
        """
        上传文件到腾讯云 COS
        
        Args:
            local_path: 本地文件路径
            remote_path: COS 对象 Key
            
        Returns:
            COS 对象的 URL
        """
        if remote_path is None:
            remote_path = Path(local_path).name
        
        object_key = self._get_full_path(remote_path)
        
        try:
            logger.info(f"上传文件到腾讯云 COS: {object_key}")
            with open(local_path, "rb") as f:
                self.client.put_object(
                    Bucket=self.bucket_name,
                    Key=object_key,
                    Body=f,
                )
            
            # 生成文件 URL
            region = self.client._conf._region
            url = f"https://{self.bucket_name}.cos.{region}.myqcloud.com/{object_key}"
            logger.info(f"文件上传成功: {url}")
            return url
        except Exception as e:
            logger.error(f"上传文件失败: {e}")
            raise

    def download(self, remote_path: str, local_path: str) -> bool:
        """
        从腾讯云 COS 下载文件
        
        Args:
            remote_path: COS 对象 Key
            local_path: 本地文件路径
            
        Returns:
            是否成功
        """
        object_key = self._get_full_path(remote_path)
        
        try:
            # 确保目标目录存在
            Path(local_path).parent.mkdir(parents=True, exist_ok=True)
            
            logger.info(f"从腾讯云 COS 下载文件: {object_key}")
            response = self.client.get_object(
                Bucket=self.bucket_name,
                Key=object_key,
            )
            
            with open(local_path, "wb") as f:
                for chunk in response["Body"].iter_content(chunk_size=1024):
                    if chunk:
                        f.write(chunk)
            
            logger.info(f"文件下载成功: {local_path}")
            return True
        except Exception as e:
            logger.error(f"下载文件失败: {e}")
            return False

    def exists(self, remote_path: str) -> bool:
        """
        检查对象是否存在
        
        Args:
            remote_path: COS 对象 Key
            
        Returns:
            对象是否存在
        """
        object_key = self._get_full_path(remote_path)
        
        try:
            self.client.head_object(
                Bucket=self.bucket_name,
                Key=object_key,
            )
            return True
        except CosServiceError as e:
            if e.get_status_code() == 404:
                return False
            logger.error(f"检查对象存在性失败: {e}")
            return False
        except Exception as e:
            logger.error(f"检查对象存在性失败: {e}")
            return False

    def delete(self, remote_path: str) -> bool:
        """
        删除对象
        
        Args:
            remote_path: COS 对象 Key
            
        Returns:
            是否成功
        """
        object_key = self._get_full_path(remote_path)
        
        try:
            logger.info(f"删除腾讯云 COS 对象: {object_key}")
            self.client.delete_object(
                Bucket=self.bucket_name,
                Key=object_key,
            )
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
            marker = ""
            while True:
                response = self.client.list_objects(
                    Bucket=self.bucket_name,
                    Prefix=list_prefix,
                    Marker=marker,
                    MaxKeys=1000,
                )
                
                if "Contents" in response:
                    for obj in response["Contents"]:
                        files.append(obj["Key"])
                
                if response.get("IsTruncated") == "false":
                    break
                
                marker = response.get("NextMarker", "")
        except Exception as e:
            logger.error(f"列出对象失败: {e}")
        
        return files

