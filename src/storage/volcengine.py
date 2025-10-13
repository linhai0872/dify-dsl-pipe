"""
火山云 TOS 存储后端实现
"""

import logging
from pathlib import Path
from typing import Optional

try:
    import tos
except ImportError:
    tos = None

from .base import StorageBackend

logger = logging.getLogger(__name__)


class VolcengineStorage(StorageBackend):
    """火山云 TOS 存储后端"""

    def __init__(self, config: dict):
        """
        初始化火山云 TOS 存储
        
        Args:
            config: 配置字典，需包含以下键：
                - endpoint: TOS Endpoint
                - access_key_id: Access Key ID
                - secret_access_key: Secret Access Key
                - bucket_name: Bucket 名称
                - region: 区域代码
                - prefix: 文件路径前缀（可选）
        """
        super().__init__(config)
        
        if tos is None:
            raise ImportError("请安装 volcengine tos: pip install volcengine")
        
        endpoint = config.get("endpoint", "")
        access_key_id = config.get("access_key_id", "")
        secret_access_key = config.get("secret_access_key", "")
        self.bucket_name = config.get("bucket_name", "")
        region = config.get("region", "cn-beijing")
        self.prefix = config.get("prefix", "").strip("/")
        
        # 创建 TOS 客户端
        self.client = tos.TosClientV2(
            ak=access_key_id,
            sk=secret_access_key,
            endpoint=endpoint,
            region=region,
        )
        
        logger.info(f"火山云 TOS 初始化成功: {self.bucket_name}")

    def _get_full_path(self, remote_path: str) -> str:
        """获取完整的对象 Key"""
        if self.prefix:
            return f"{self.prefix}/{remote_path}".strip("/")
        return remote_path.strip("/")

    def upload(self, local_path: str, remote_path: Optional[str] = None) -> str:
        """
        上传文件到火山云 TOS
        
        Args:
            local_path: 本地文件路径
            remote_path: TOS 对象 Key
            
        Returns:
            TOS 对象的 URL
        """
        if remote_path is None:
            remote_path = Path(local_path).name
        
        object_key = self._get_full_path(remote_path)
        
        try:
            logger.info(f"上传文件到火山云 TOS: {object_key}")
            with open(local_path, "rb") as f:
                self.client.put_object(
                    bucket=self.bucket_name,
                    key=object_key,
                    content=f,
                )
            
            # 生成文件 URL
            url = f"https://{self.bucket_name}.{self.client.endpoint}/{object_key}"
            logger.info(f"文件上传成功: {url}")
            return url
        except Exception as e:
            logger.error(f"上传文件失败: {e}")
            raise

    def download(self, remote_path: str, local_path: str) -> bool:
        """
        从火山云 TOS 下载文件
        
        Args:
            remote_path: TOS 对象 Key
            local_path: 本地文件路径
            
        Returns:
            是否成功
        """
        object_key = self._get_full_path(remote_path)
        
        try:
            # 确保目标目录存在
            Path(local_path).parent.mkdir(parents=True, exist_ok=True)
            
            logger.info(f"从火山云 TOS 下载文件: {object_key}")
            result = self.client.get_object(bucket=self.bucket_name, key=object_key)
            
            with open(local_path, "wb") as f:
                for chunk in result.content:
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
            remote_path: TOS 对象 Key
            
        Returns:
            对象是否存在
        """
        object_key = self._get_full_path(remote_path)
        
        try:
            self.client.head_object(bucket=self.bucket_name, key=object_key)
            return True
        except tos.exceptions.TosServerError as e:
            if e.status_code == 404:
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
            remote_path: TOS 对象 Key
            
        Returns:
            是否成功
        """
        object_key = self._get_full_path(remote_path)
        
        try:
            logger.info(f"删除火山云 TOS 对象: {object_key}")
            self.client.delete_object(bucket=self.bucket_name, key=object_key)
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
                result = self.client.list_objects(
                    bucket=self.bucket_name,
                    prefix=list_prefix,
                    marker=marker,
                    max_keys=1000,
                )
                
                if result.contents:
                    for obj in result.contents:
                        files.append(obj.key)
                
                if not result.is_truncated:
                    break
                
                marker = result.next_marker
        except Exception as e:
            logger.error(f"列出对象失败: {e}")
        
        return files

