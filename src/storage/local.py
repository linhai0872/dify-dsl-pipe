"""
本地存储后端实现
"""

import logging
import os
import shutil
from pathlib import Path
from typing import Optional

from .base import StorageBackend

logger = logging.getLogger(__name__)


class LocalStorage(StorageBackend):
    """本地存储后端"""

    def __init__(self, config: dict):
        """
        初始化本地存储
        
        Args:
            config: 配置字典，需包含 'path' 键
        """
        super().__init__(config)
        self.base_path = Path(config.get("path", "/data/dify-backups"))
        
        # 确保存储目录存在
        self.base_path.mkdir(parents=True, exist_ok=True)
        logger.info(f"本地存储路径: {self.base_path}")

    def upload(self, local_path: str, remote_path: Optional[str] = None) -> str:
        """
        复制文件到本地存储目录
        
        Args:
            local_path: 源文件路径
            remote_path: 目标相对路径（相对于 base_path）
            
        Returns:
            目标文件的完整路径
        """
        if remote_path is None:
            remote_path = Path(local_path).name
        
        dest_path = self.base_path / remote_path
        
        # 确保目标目录存在
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        
        try:
            logger.info(f"复制文件: {local_path} -> {dest_path}")
            shutil.copy2(local_path, dest_path)
            logger.info(f"文件已保存到: {dest_path}")
            return str(dest_path)
        except Exception as e:
            logger.error(f"文件复制失败: {e}")
            raise

    def download(self, remote_path: str, local_path: str) -> bool:
        """
        从本地存储复制文件
        
        Args:
            remote_path: 源文件相对路径
            local_path: 目标文件路径
            
        Returns:
            是否成功
        """
        src_path = self.base_path / remote_path
        
        if not src_path.exists():
            logger.error(f"文件不存在: {src_path}")
            return False
        
        try:
            # 确保目标目录存在
            Path(local_path).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src_path, local_path)
            logger.info(f"文件已复制: {src_path} -> {local_path}")
            return True
        except Exception as e:
            logger.error(f"文件复制失败: {e}")
            return False

    def exists(self, remote_path: str) -> bool:
        """
        检查文件是否存在
        
        Args:
            remote_path: 文件相对路径
            
        Returns:
            文件是否存在
        """
        file_path = self.base_path / remote_path
        return file_path.exists()

    def delete(self, remote_path: str) -> bool:
        """
        删除文件
        
        Args:
            remote_path: 文件相对路径
            
        Returns:
            是否成功
        """
        file_path = self.base_path / remote_path
        
        if not file_path.exists():
            logger.warning(f"文件不存在: {file_path}")
            return False
        
        try:
            if file_path.is_file():
                file_path.unlink()
            elif file_path.is_dir():
                shutil.rmtree(file_path)
            logger.info(f"文件已删除: {file_path}")
            return True
        except Exception as e:
            logger.error(f"文件删除失败: {e}")
            return False

    def list_files(self, prefix: str = "") -> list:
        """
        列出文件
        
        Args:
            prefix: 文件路径前缀
            
        Returns:
            文件路径列表
        """
        search_path = self.base_path / prefix if prefix else self.base_path
        
        if not search_path.exists():
            return []
        
        files = []
        try:
            for item in search_path.rglob("*"):
                if item.is_file():
                    # 返回相对于 base_path 的路径
                    rel_path = item.relative_to(self.base_path)
                    files.append(str(rel_path))
        except Exception as e:
            logger.error(f"列出文件失败: {e}")
        
        return files

