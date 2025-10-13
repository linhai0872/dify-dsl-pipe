"""
存储后端抽象基类
定义存储后端的统一接口
"""

import logging
from abc import ABC, abstractmethod
from typing import Optional

logger = logging.getLogger(__name__)


class StorageBackend(ABC):
    """存储后端抽象基类"""

    def __init__(self, config: dict):
        """
        初始化存储后端
        
        Args:
            config: 存储后端配置
        """
        self.config = config

    @abstractmethod
    def upload(self, local_path: str, remote_path: Optional[str] = None) -> str:
        """
        上传文件到存储后端
        
        Args:
            local_path: 本地文件路径
            remote_path: 远程存储路径（可选，如果不提供则自动生成）
            
        Returns:
            文件在存储后端的路径或 URL
            
        Raises:
            Exception: 上传失败时抛出异常
        """
        pass

    @abstractmethod
    def download(self, remote_path: str, local_path: str) -> bool:
        """
        从存储后端下载文件
        
        Args:
            remote_path: 远程存储路径
            local_path: 本地文件路径
            
        Returns:
            下载是否成功
        """
        pass

    @abstractmethod
    def exists(self, remote_path: str) -> bool:
        """
        检查文件是否存在
        
        Args:
            remote_path: 远程存储路径
            
        Returns:
            文件是否存在
        """
        pass

    @abstractmethod
    def delete(self, remote_path: str) -> bool:
        """
        删除文件
        
        Args:
            remote_path: 远程存储路径
            
        Returns:
            删除是否成功
        """
        pass

    @abstractmethod
    def list_files(self, prefix: str = "") -> list:
        """
        列出文件
        
        Args:
            prefix: 文件路径前缀
            
        Returns:
            文件列表
        """
        pass

    def test_connection(self) -> bool:
        """
        测试存储连接
        
        Returns:
            连接是否正常
        """
        try:
            # 默认实现：尝试列出文件
            self.list_files()
            logger.info(f"{self.__class__.__name__} 连接测试成功")
            return True
        except Exception as e:
            logger.error(f"{self.__class__.__name__} 连接测试失败: {e}")
            return False

