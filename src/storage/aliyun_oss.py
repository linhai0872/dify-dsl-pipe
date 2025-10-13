"""
阿里云 OSS 存储后端实现
"""

import logging
from pathlib import Path
from typing import Optional

try:
    import oss2
except ImportError:
    oss2 = None

from .base import StorageBackend

logger = logging.getLogger(__name__)


class AliyunOSSStorage(StorageBackend):
    """阿里云 OSS 存储后端"""

    def __init__(self, config: dict):
        """
        初始化阿里云 OSS 存储
        
        Args:
            config: 配置字典，需包含以下键：
                - endpoint: OSS Endpoint
                - access_key_id: AccessKey ID
                - access_key_secret: AccessKey Secret
                - bucket_name: Bucket 名称
                - prefix: 文件路径前缀（可选）
                - use_internal_endpoint: 是否使用内网 Endpoint（可选）
        """
        super().__init__(config)
        
        if oss2 is None:
            raise ImportError("请安装 oss2: pip install oss2")
        
        endpoint = config.get("endpoint", "")
        access_key_id = config.get("access_key_id", "")
        access_key_secret = config.get("access_key_secret", "")
        bucket_name = config.get("bucket_name", "")
        self.prefix = config.get("prefix", "").strip("/")
        use_internal = config.get("use_internal_endpoint", False)
        
        # 如果启用内网 Endpoint，替换域名
        if use_internal and "aliyuncs.com" in endpoint:
            endpoint = endpoint.replace(".aliyuncs.com", "-internal.aliyuncs.com")
        
        # 创建认证对象
        auth = oss2.Auth(access_key_id, access_key_secret)
        
        # 创建 Bucket 对象
        self.bucket = oss2.Bucket(auth, endpoint, bucket_name)
        
        logger.info(f"阿里云 OSS 初始化成功: {bucket_name}")

    def _get_full_path(self, remote_path: str) -> str:
        """获取完整的对象路径"""
        if self.prefix:
            return f"{self.prefix}/{remote_path}".strip("/")
        return remote_path.strip("/")

    def upload(self, local_path: str, remote_path: Optional[str] = None) -> str:
        """
        上传文件到阿里云 OSS
        
        Args:
            local_path: 本地文件路径
            remote_path: OSS 对象路径
            
        Returns:
            OSS 对象的 URL
        """
        if remote_path is None:
            remote_path = Path(local_path).name
        
        object_key = self._get_full_path(remote_path)
        
        try:
            logger.info(f"上传文件到阿里云 OSS: {object_key}")
            with open(local_path, "rb") as f:
                self.bucket.put_object(object_key, f)
            
            # 生成文件 URL（不包含签名）
            url = f"https://{self.bucket.bucket_name}.{self.bucket.endpoint.replace('http://', '').replace('https://', '')}/{object_key}"
            logger.info(f"文件上传成功: {url}")
            return url
        except Exception as e:
            logger.error(f"上传文件失败: {e}")
            raise

    def download(self, remote_path: str, local_path: str) -> bool:
        """
        从阿里云 OSS 下载文件
        
        Args:
            remote_path: OSS 对象路径
            local_path: 本地文件路径
            
        Returns:
            是否成功
        """
        object_key = self._get_full_path(remote_path)
        
        try:
            # 确保目标目录存在
            Path(local_path).parent.mkdir(parents=True, exist_ok=True)
            
            logger.info(f"从阿里云 OSS 下载文件: {object_key}")
            self.bucket.get_object_to_file(object_key, local_path)
            logger.info(f"文件下载成功: {local_path}")
            return True
        except Exception as e:
            logger.error(f"下载文件失败: {e}")
            return False

    def exists(self, remote_path: str) -> bool:
        """
        检查对象是否存在
        
        Args:
            remote_path: OSS 对象路径
            
        Returns:
            对象是否存在
        """
        object_key = self._get_full_path(remote_path)
        
        try:
            return self.bucket.object_exists(object_key)
        except Exception as e:
            logger.error(f"检查对象存在性失败: {e}")
            return False

    def delete(self, remote_path: str) -> bool:
        """
        删除对象
        
        Args:
            remote_path: OSS 对象路径
            
        Returns:
            是否成功
        """
        object_key = self._get_full_path(remote_path)
        
        try:
            logger.info(f"删除阿里云 OSS 对象: {object_key}")
            self.bucket.delete_object(object_key)
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
            对象路径列表
        """
        list_prefix = self._get_full_path(prefix) if prefix else self.prefix
        
        files = []
        try:
            for obj in oss2.ObjectIterator(self.bucket, prefix=list_prefix):
                files.append(obj.key)
        except Exception as e:
            logger.error(f"列出对象失败: {e}")
        
        return files

