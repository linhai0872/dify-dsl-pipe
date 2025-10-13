"""
DSL 导出核心逻辑
负责从 Dify 导出应用 DSL 并组织文件结构
"""

import logging
import os
import re
import shutil
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

from .dify_client import DifyClient

logger = logging.getLogger(__name__)


class DifyDSLExporter:
    """Dify DSL 导出器"""

    def __init__(
        self,
        client: DifyClient,
        temp_dir: str = "/tmp/dify-export",
        include_secret: bool = False,
        app_types: Optional[List[str]] = None,
        include_tags_in_filename: bool = False,
        export_version_history: bool = True,
    ):
        """
        初始化导出器
        
        Args:
            client: Dify API 客户端
            temp_dir: 临时文件目录
            include_secret: 是否包含敏感信息
            app_types: 要导出的应用类型列表（为空则导出所有）
            include_tags_in_filename: 是否将标签添加到文件名中
            export_version_history: 是否导出历史版本
        """
        self.client = client
        self.temp_dir = Path(temp_dir)
        self.include_secret = include_secret
        self.app_types = app_types or []
        self.include_tags_in_filename = include_tags_in_filename
        self.export_version_history = export_version_history
        
        # 确保临时目录存在
        self.temp_dir.mkdir(parents=True, exist_ok=True)

    def export_all_apps(self) -> str:
        """
        导出所有应用的 DSL
        
        Returns:
            导出的 ZIP 文件路径
        """
        logger.info("开始导出所有应用的 DSL")
        
        # 获取所有应用
        apps = self.client.get_all_apps()
        
        if not apps:
            logger.warning("没有找到任何应用")
            return ""
        
        # 过滤应用类型
        if self.app_types:
            apps = [app for app in apps if app.get("mode") in self.app_types]
            logger.info(f"按类型过滤后，剩余 {len(apps)} 个应用")
        
        # 创建导出目录
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        export_dir = self.temp_dir / f"dify-export-{timestamp}"
        export_dir.mkdir(parents=True, exist_ok=True)
        
        logger.info(f"导出目录: {export_dir}")
        
        # 导出每个应用
        success_count = 0
        failed_count = 0
        
        for i, app in enumerate(apps, 1):
            app_id = app.get("id", "")
            app_name = app.get("name", "Unknown")
            app_mode = app.get("mode", "unknown")
            created_at = app.get("created_at", "")
            
            logger.info(f"[{i}/{len(apps)}] 导出应用: {app_name} ({app_mode})")
            
            try:
                self._export_single_app(
                    app_id=app_id,
                    app_name=app_name,
                    app_mode=app_mode,
                    created_at=created_at,
                    export_dir=export_dir,
                )
                success_count += 1
            except Exception as e:
                logger.error(f"导出应用失败: {app_name} - {e}")
                failed_count += 1
        
        logger.info(f"导出完成: 成功 {success_count} 个，失败 {failed_count} 个")
        
        # 打包为 ZIP 文件
        zip_path = self._create_zip_archive(export_dir)
        
        # 删除临时目录
        shutil.rmtree(export_dir)
        
        return zip_path

    def _export_single_app(
        self,
        app_id: str,
        app_name: str,
        app_mode: str,
        created_at: str,
        export_dir: Path,
    ) -> None:
        """
        导出单个应用
        
        Args:
            app_id: 应用 ID
            app_name: 应用名称
            app_mode: 应用模式
            created_at: 创建时间
            export_dir: 导出目录
        """
        # 清理应用名称，移除不允许的字符
        safe_name = self._sanitize_filename(app_name)
        
        # 格式化创建时间
        created_time = self._format_timestamp(created_at)
        
        # 获取应用标签（如果启用）
        tags = []
        if self.include_tags_in_filename:
            try:
                tags = self.client.get_app_tags(app_id)
                if tags:
                    logger.info(f"  应用标签: {', '.join(tags)}")
            except Exception as e:
                logger.warning(f"  获取标签失败: {e}")
        
        # 创建应用目录：名称_创建时间_ID
        app_dir_name = f"{safe_name}_{created_time}_{app_id[:8]}"
        app_dir = export_dir / app_dir_name
        app_dir.mkdir(parents=True, exist_ok=True)
        
        # 1. 导出当前版本的 DSL
        logger.info(f"  导出当前版本 DSL...")
        try:
            dsl_content = self.client.export_app_dsl(
                app_id=app_id,
                include_secret=self.include_secret,
            )
            
            # 构建文件名（包含标签，如果启用）
            filename = self._build_filename(safe_name, "current", tags)
            dsl_file = app_dir / filename
            
            with open(dsl_file, "w", encoding="utf-8") as f:
                f.write(dsl_content)
            logger.info(f"  已保存当前版本: {dsl_file.name}")
        except Exception as e:
            logger.error(f"  导出当前版本失败: {e}")
            raise
        
        # 2. 如果是工作流应用，导出版本历史
        if app_mode in ["workflow", "advanced-chat"]:
            self._export_app_versions(
                app_id=app_id,
                app_name=safe_name,
                app_dir=app_dir,
                tags=tags,
            )

    def _export_app_versions(
        self,
        app_id: str,
        app_name: str,
        app_dir: Path,
        tags: Optional[List[str]] = None,
    ) -> None:
        """
        导出应用的版本历史
        
        Args:
            app_id: 应用 ID
            app_name: 应用名称
            app_dir: 应用目录
            tags: 应用标签列表
        """
        # 检查是否启用了版本历史导出
        if not self.export_version_history:
            logger.info(f"  跳过版本历史导出（未启用）")
            return
        
        logger.info(f"  检查版本历史...")
        
        # 获取版本历史
        versions = self.client.get_workflow_versions(app_id)
        
        if not versions:
            logger.info(f"  没有版本历史")
            return
        
        logger.info(f"  找到 {len(versions)} 个版本")
        
        # 创建 versions 子目录
        versions_dir = app_dir / "versions"
        versions_dir.mkdir(parents=True, exist_ok=True)
        
        # 创建版本信息列表
        version_info_list = []
        
        # 导出每个版本
        for version in versions:
            version_id = version.get("id", "")
            # 优先使用 marked_name（用户设置的名称），否则使用 version 字段，最后用时间戳
            version_name = version.get("marked_name") or version.get("version") or "unnamed"
            version_comment = version.get("marked_comment", "")  # 版本描述
            created_at = version.get("created_at", "")
            created_by = version.get("created_by", {})
            updated_at = version.get("updated_at", "")
            
            # 跳过 draft 版本（草稿不是已发布的历史版本）
            if version_name.lower() == "draft":
                logger.debug(f"    跳过草稿版本: {version_name}")
                continue
            
            try:
                logger.info(f"    导出版本: {version_name}")
                
                # 导出该版本的 DSL
                dsl_content = self.client.export_app_dsl(
                    app_id=app_id,
                    include_secret=self.include_secret,
                    workflow_id=version_id,
                )
                
                # 格式化版本文件名（包含时间和标签）
                created_time = self._format_timestamp(created_at)
                version_suffix = f"{version_name}_{created_time}"
                filename = self._build_filename(app_name, version_suffix, tags or [])
                version_file = versions_dir / filename
                
                with open(version_file, "w", encoding="utf-8") as f:
                    f.write(dsl_content)
                
                # 收集版本信息
                version_info_list.append({
                    "version_id": version_id,
                    "version_name": version_name,
                    "version_comment": version_comment,
                    "filename": filename,
                    "created_at": created_at,
                    "created_by": created_by,
                    "updated_at": updated_at,
                    "export_status": "success"
                })
                
                logger.info(f"    已保存版本: {version_file.name}")
            except Exception as e:
                # 简化错误信息
                error_msg = str(e)
                if "500 error" in error_msg.lower():
                    error_msg = "服务器内部错误（可能是版本数据损坏或不可用）"
                elif "404" in error_msg:
                    error_msg = "版本不存在或已被删除"
                elif "timeout" in error_msg.lower():
                    error_msg = "请求超时"
                else:
                    # 保留原始错误，但截断过长的信息
                    error_msg = error_msg[:200] + "..." if len(error_msg) > 200 else error_msg
                
                logger.warning(f"    跳过版本 {version_name}: {error_msg}")
                
                # 记录失败的版本信息
                version_info_list.append({
                    "version_id": version_id,
                    "version_name": version_name,
                    "version_comment": version_comment,
                    "created_at": created_at,
                    "export_status": "failed",
                    "error": error_msg
                })
        
        # 创建版本信息文件（Markdown 格式）
        self._create_version_info_file(versions_dir, version_info_list, app_name)

    def _create_version_info_file(
        self,
        versions_dir: Path,
        version_info_list: List[Dict],
        app_name: str,
    ) -> None:
        """
        创建版本信息文件（Markdown 格式）
        
        Args:
            versions_dir: 版本目录
            version_info_list: 版本信息列表
            app_name: 应用名称
        """
        if not version_info_list:
            return
        
        info_file = versions_dir / "README.md"
        
        try:
            # 统计成功和失败的数量
            success_count = sum(1 for v in version_info_list if v.get("export_status") == "success")
            failed_count = len(version_info_list) - success_count
            
            with open(info_file, "w", encoding="utf-8") as f:
                f.write(f"# {app_name} - 版本历史\n\n")
                f.write(f"**导出时间**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")
                f.write(f"**版本统计**: 共 {len(version_info_list)} 个版本 ")
                f.write(f"（✅ {success_count} 成功")
                if failed_count > 0:
                    f.write(f"，⚠️ {failed_count} 失败")
                f.write("）\n\n")
                f.write("---\n\n")
                
                for idx, info in enumerate(version_info_list, 1):
                    version_name = info.get("version_name", "Unknown")
                    version_comment = info.get("version_comment", "")
                    created_at = info.get("created_at", "")
                    export_status = info.get("export_status", "unknown")
                    
                    f.write(f"## {idx}. {version_name}\n\n")
                    
                    if version_comment:
                        f.write(f"**描述**: {version_comment}\n\n")
                    
                    # 格式化时间显示
                    if created_at:
                        formatted_time = self._format_timestamp(created_at)
                        # 转换为更易读的格式
                        try:
                            from datetime import datetime as dt_parser
                            dt = dt_parser.strptime(formatted_time, "%Y%m%d_%H%M%S")
                            readable_time = dt.strftime("%Y年%m月%d日 %H:%M:%S")
                            f.write(f"**创建时间**: {readable_time}\n\n")
                        except:
                            f.write(f"**创建时间**: {created_at}\n\n")
                    
                    # 创建者信息
                    created_by = info.get("created_by", {})
                    if isinstance(created_by, dict) and created_by.get("name"):
                        f.write(f"**创建者**: {created_by.get('name')}\n\n")
                    
                    # 导出状态
                    if export_status == "success":
                        filename = info.get("filename", "")
                        f.write(f"**文件**: `{filename}`\n\n")
                        f.write(f"✅ **导出成功**\n\n")
                    else:
                        error = info.get("error", "未知错误")
                        f.write(f"⚠️ **导出失败**\n\n")
                        f.write(f"> **错误原因**: {error}\n\n")
                        f.write(f"> 💡 **提示**: 此版本可能已损坏、被删除或不可访问，可以忽略此版本。\n\n")
                    
                    f.write("---\n\n")
            
            logger.info(f"  已创建版本信息文件: {info_file.name}")
        except Exception as e:
            logger.error(f"  创建版本信息文件失败: {e}")

    def _create_zip_archive(self, source_dir: Path) -> str:
        """
        将目录打包为 ZIP 文件
        
        Args:
            source_dir: 源目录
            
        Returns:
            ZIP 文件路径
        """
        logger.info(f"打包为 ZIP 文件...")
        
        zip_path = f"{source_dir}.zip"
        
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
            for root, dirs, files in os.walk(source_dir):
                for file in files:
                    file_path = Path(root) / file
                    arcname = file_path.relative_to(source_dir.parent)
                    zipf.write(file_path, arcname)
        
        logger.info(f"ZIP 文件已创建: {zip_path}")
        return zip_path

    @staticmethod
    def _sanitize_filename(filename: str) -> str:
        """
        清理文件名，移除不允许的字符
        
        Args:
            filename: 原始文件名
            
        Returns:
            清理后的文件名
        """
        # 移除不允许的字符
        filename = re.sub(r'[<>:"/\\|?*]', "_", filename)
        # 移除前后空白
        filename = filename.strip()
        # 限制长度
        if len(filename) > 50:
            filename = filename[:50]
        # 如果为空，使用默认名称
        if not filename:
            filename = "unnamed"
        return filename

    def _build_filename(self, base_name: str, suffix: str, tags: List[str]) -> str:
        """
        构建文件名（可选包含标签）
        
        Args:
            base_name: 基础名称（应用名）
            suffix: 后缀（如 "current" 或 "v1_20240110_120000"）
            tags: 标签列表
            
        Returns:
            完整的文件名
        """
        # 清理标签，移除不允许的字符
        clean_tags = [self._sanitize_filename(tag) for tag in tags if tag]
        
        # 构建文件名
        if self.include_tags_in_filename and clean_tags:
            # 格式：AppName_suffix-Tag1-Tag2.yml
            tags_str = "-".join(clean_tags)
            return f"{base_name}_{suffix}-{tags_str}.yml"
        else:
            # 格式：AppName_suffix.yml
            return f"{base_name}_{suffix}.yml"

    @staticmethod
    def _format_timestamp(timestamp: str) -> str:
        """
        格式化时间戳
        
        Args:
            timestamp: ISO 格式时间戳
            
        Returns:
            格式化的时间字符串（YYYYMMDD_HHMMSS）
        """
        if not timestamp:
            return datetime.now().strftime("%Y%m%d_%H%M%S")
        
        try:
            # 尝试解析 ISO 8601 格式
            dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
            return dt.strftime("%Y%m%d_%H%M%S")
        except Exception:
            # 如果解析失败，返回当前时间
            return datetime.now().strftime("%Y%m%d_%H%M%S")

    def cleanup(self) -> None:
        """清理临时文件"""
        if self.temp_dir.exists():
            try:
                shutil.rmtree(self.temp_dir)
                logger.info(f"已清理临时目录: {self.temp_dir}")
            except Exception as e:
                logger.error(f"清理临时目录失败: {e}")

