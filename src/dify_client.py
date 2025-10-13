"""
Dify API 客户端
用于与 Dify Console API 交互，获取应用列表和导出 DSL
"""

import logging
import time
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

logger = logging.getLogger(__name__)


class DifyClient:
    """Dify API 客户端"""

    def __init__(
        self,
        base_url: str,
        email: Optional[str] = None,
        password: Optional[str] = None,
        access_token: Optional[str] = None,
        timeout: int = 30,
        max_retries: int = 3,
    ):
        """
        初始化 Dify 客户端
        
        Args:
            base_url: Dify Console API 基础 URL
            email: 登录邮箱（与 password 配合使用）
            password: 登录密码（与 email 配合使用）
            access_token: 访问令牌（可选，如果提供则跳过登录）
            timeout: 请求超时时间（秒）
            max_retries: 最大重试次数
        """
        self.base_url = base_url.rstrip("/")
        self.email = email
        self.password = password
        self.access_token = access_token
        self.timeout = timeout
        
        # 创建 Session 并配置重试策略
        self.session = requests.Session()
        
        # 配置重试策略
        retry_strategy = Retry(
            total=max_retries,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["GET", "POST"],
            backoff_factor=1,  # 重试间隔：1s, 2s, 4s, ...
        )
        adapter = HTTPAdapter(max_retries=retry_strategy)
        self.session.mount("http://", adapter)
        self.session.mount("https://", adapter)
        
        # 设置默认请求头
        self.session.headers.update({
            "Content-Type": "application/json",
        })
        
        # 如果提供了 access_token，直接使用
        if self.access_token:
            self.session.headers["Authorization"] = f"Bearer {self.access_token}"
            logger.info("使用提供的 access_token")
        # 否则使用邮箱密码登录
        elif self.email and self.password:
            logger.info(f"使用邮箱登录: {self.email}")
            self._login()
        else:
            raise ValueError("必须提供 access_token 或 email+password")

    def _login(self) -> None:
        """
        使用邮箱和密码登录 Dify Console
        获取 access_token 并设置到 session header 中
        """
        # 使用 self.base_url + "/login" 而不是 urljoin，因为 urljoin 会替换路径
        login_url = f"{self.base_url}/login"
        
        try:
            logger.debug(f"正在登录 Dify Console: {login_url}")
            response = self.session.post(
                login_url,
                json={
                    "email": self.email,
                    "password": self.password,
                    "remember_me": False,
                },
                timeout=self.timeout,
            )
            response.raise_for_status()
            
            data = response.json()
            if data.get("result") == "success":
                token_data = data.get("data", {})
                self.access_token = token_data.get("access_token")
                
                if not self.access_token:
                    raise ValueError("登录响应中未找到 access_token")
                
                # 设置 Authorization header
                self.session.headers["Authorization"] = f"Bearer {self.access_token}"
                logger.info("登录成功")
            else:
                error_msg = data.get("data", "登录失败")
                raise ValueError(f"登录失败: {error_msg}")
                
        except requests.exceptions.RequestException as e:
            logger.error(f"登录请求失败: {e}")
            raise ValueError(f"无法连接到 Dify Console API: {e}")
        except Exception as e:
            logger.error(f"登录失败: {e}")
            raise

    def _make_request(
        self,
        method: str,
        endpoint: str,
        params: Optional[Dict[str, Any]] = None,
        json_data: Optional[Dict[str, Any]] = None,
    ) -> requests.Response:
        """
        发起 API 请求
        
        Args:
            method: HTTP 方法（GET, POST 等）
            endpoint: API 端点
            params: URL 查询参数
            json_data: JSON 请求体
            
        Returns:
            响应对象
            
        Raises:
            requests.RequestException: 请求失败
        """
        url = urljoin(self.base_url + "/", endpoint.lstrip("/"))
        
        try:
            logger.debug(f"请求 {method} {url}")
            response = self.session.request(
                method=method,
                url=url,
                params=params,
                json=json_data,
                timeout=self.timeout,
            )
            response.raise_for_status()
            return response
        except requests.exceptions.RequestException as e:
            logger.error(f"API 请求失败: {method} {url} - {e}")
            raise

    def get_apps(self, page: int = 1, limit: int = 100) -> Dict[str, Any]:
        """
        获取应用列表
        
        Args:
            page: 页码（从 1 开始）
            limit: 每页数量
            
        Returns:
            应用列表响应
        """
        logger.info(f"获取应用列表（页码: {page}, 每页: {limit}）")
        response = self._make_request(
            "GET",
            "/apps",
            params={"page": page, "limit": limit},
        )
        return response.json()

    def get_all_apps(self) -> List[Dict[str, Any]]:
        """
        获取所有应用列表（自动处理分页）
        
        Returns:
            所有应用的列表
        """
        all_apps = []
        page = 1
        limit = 100
        
        while True:
            try:
                result = self.get_apps(page=page, limit=limit)
                apps = result.get("data", [])
                
                if not apps:
                    break
                    
                all_apps.extend(apps)
                logger.info(f"已获取 {len(all_apps)} 个应用")
                
                # 检查是否还有更多页
                total = result.get("total", 0)
                if len(all_apps) >= total:
                    break
                    
                page += 1
                time.sleep(0.5)  # 避免请求过快
                
            except Exception as e:
                logger.error(f"获取应用列表失败: {e}")
                break
        
        # 按创建时间排序（从旧到新）
        all_apps.sort(key=lambda x: x.get("created_at", ""))
        logger.info(f"共获取 {len(all_apps)} 个应用")
        
        return all_apps

    def export_app_dsl(
        self,
        app_id: str,
        include_secret: bool = False,
        workflow_id: Optional[str] = None,
    ) -> str:
        """
        导出应用 DSL
        
        Args:
            app_id: 应用 ID
            include_secret: 是否包含敏感信息
            workflow_id: 工作流版本 ID（可选）
            
        Returns:
            DSL YAML 字符串
        """
        params = {"include_secret": str(include_secret).lower()}
        if workflow_id:
            params["workflow_id"] = workflow_id
            logger.info(f"导出应用 DSL: {app_id}（版本: {workflow_id}）")
        else:
            logger.info(f"导出应用 DSL: {app_id}（当前版本）")
        
        response = self._make_request(
            "GET",
            f"/apps/{app_id}/export",
            params=params,
        )
        
        # API 返回格式: {"data": "yaml内容"}
        result = response.json()
        dsl_content = result.get("data", "")
        
        if not dsl_content:
            logger.warning(f"应用 {app_id} 的 DSL 内容为空")
        
        return dsl_content

    def get_workflow_versions(self, app_id: str) -> List[Dict[str, Any]]:
        """
        获取工作流版本历史列表（已发布的版本）
        
        Args:
            app_id: 应用 ID
            
        Returns:
            版本历史列表
        """
        try:
            logger.info(f"获取应用 {app_id} 的版本历史")
            # 正确的 API 路径是 /apps/{app_id}/workflows，带上分页参数获取所有已发布版本
            response = self._make_request(
                "GET",
                f"/apps/{app_id}/workflows",
                params={"page": 1, "limit": 100, "named_only": False},  # named_only=False 获取所有版本
            )
            result = response.json()
            versions = result.get("items", [])  # 返回的字段是 items 不是 data
            logger.info(f"应用 {app_id} 共有 {len(versions)} 个已发布版本")
            return versions
        except requests.exceptions.HTTPError as e:
            # 如果是 404 或其他错误，可能是非工作流应用
            if e.response.status_code == 404:
                logger.debug(f"应用 {app_id} 没有版本历史（可能不是工作流应用）")
                return []
            logger.error(f"获取版本历史失败: {e}")
            return []
        except Exception as e:
            logger.error(f"获取版本历史失败: {e}")
            return []

    def get_workflow_draft(self, app_id: str) -> Optional[Dict[str, Any]]:
        """
        获取工作流草稿信息
        
        Args:
            app_id: 应用 ID
            
        Returns:
            草稿信息（如果存在）
        """
        try:
            logger.debug(f"获取应用 {app_id} 的草稿信息")
            response = self._make_request(
                "GET",
                f"/apps/{app_id}/workflows/draft",
            )
            return response.json()
        except requests.exceptions.HTTPError as e:
            if e.response.status_code == 404:
                logger.debug(f"应用 {app_id} 没有草稿（可能不是工作流应用）")
                return None
            logger.error(f"获取草稿信息失败: {e}")
            return None
        except Exception as e:
            logger.error(f"获取草稿信息失败: {e}")
            return None

    def check_connection(self) -> bool:
        """
        检查与 Dify API 的连接
        
        Returns:
            连接是否正常
        """
        try:
            logger.info("检查 Dify API 连接...")
            self.get_apps(page=1, limit=1)
            logger.info("Dify API 连接正常")
            return True
        except Exception as e:
            logger.error(f"Dify API 连接失败: {e}")
            return False

    def get_app_detail(self, app_id: str) -> Optional[Dict[str, Any]]:
        """
        获取应用详细信息
        
        Args:
            app_id: 应用 ID
            
        Returns:
            应用详细信息
        """
        try:
            logger.debug(f"获取应用详细信息: {app_id}")
            response = self._make_request(
                "GET",
                f"/apps/{app_id}",
            )
            return response.json()
        except Exception as e:
            logger.error(f"获取应用详细信息失败: {e}")
            return None

    def get_app_tags(self, app_id: str) -> List[str]:
        """
        获取应用的标签列表
        
        Args:
            app_id: 应用 ID
            
        Returns:
            标签名称列表
        """
        try:
            logger.debug(f"获取应用标签: {app_id}")
            
            # 先获取所有 app 类型的标签
            response = self._make_request(
                "GET",
                "/tags",
                params={"type": "app"},
            )
            all_tags = response.json()
            
            # 获取该应用的标签绑定
            # 注意：Dify API 可能需要通过应用列表返回的 tags 字段获取
            # 如果 API 不支持直接查询，则返回空列表
            
            # 尝试从应用详情中获取标签（如果 API 返回）
            app_detail = self.get_app_detail(app_id)
            if app_detail and "tags" in app_detail:
                tags = app_detail.get("tags", [])
                if isinstance(tags, list):
                    return [tag.get("name", "") for tag in tags if isinstance(tag, dict)]
            
            logger.debug(f"应用 {app_id} 没有标签信息或 API 不支持")
            return []
            
        except Exception as e:
            logger.warning(f"获取应用标签失败: {e}，将跳过标签信息")
            return []

