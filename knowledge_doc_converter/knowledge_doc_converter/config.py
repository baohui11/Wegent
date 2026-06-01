"""Converter service settings using pydantic-settings.

Configuration is loaded from environment variables or .env file.
All conversion-related settings that were previously in backend config.py
now live here.
"""

from urllib.parse import urlparse, urlunparse

from pydantic_settings import BaseSettings

from knowledge_engine.conversion.s3_uploader import S3Config


def _inject_redis_password(url: str, password: str) -> str:
    """Inject password into a Redis URL if not already present.

    Supports standard Redis URL format: redis://[:password@]host:port/db
    If password is empty or the URL already contains credentials, returns unchanged.
    """
    if not password:
        return url
    parsed = urlparse(url)
    # Already has credentials in URL, keep as-is
    if parsed.password:
        return url
    # Inject password: redis://host -> redis://:password@host
    netloc = f":{password}@{parsed.hostname}"
    if parsed.port:
        netloc += f":{parsed.port}"
    return urlunparse(parsed._replace(netloc=netloc))


class ConverterSettings(BaseSettings):
    """Knowledge document converter service settings.

    REDIS_PASSWORD is applied to all Redis URLs (CELERY_BROKER_URL,
    CELERY_RESULT_BACKEND, REDIS_URL) when set. If empty or not configured,
    no password authentication is used.
    """

    # ---- Backend Callback ----
    BACKEND_BASE_URL: str = "http://backend:8000"
    BACKEND_INTERNAL_TOKEN: str = ""

    # ---- Redis Password ----
    # Applied to all Redis URLs when set; empty = no password authentication
    REDIS_PASSWORD: str = ""

    # ---- Celery ----
    CELERY_BROKER_URL: str = "redis://redis:6379/0"
    CELERY_RESULT_BACKEND: str = "redis://redis:6379/1"
    KNOWLEDGE_CONVERSION_QUEUE: str = "knowledge_conversion"

    # ---- Distributed Lock (Redis) ----
    # Constraint: lock_timeout > CONVERSION_TASK_TIME_LIMIT
    REDIS_URL: str = "redis://redis:6379/0"
    KNOWLEDGE_CONVERSION_LOCK_TIMEOUT_SECONDS: int = 12000
    KNOWLEDGE_CONVERSION_LOCK_EXTEND_INTERVAL_SECONDS: int = 60
    KNOWLEDGE_CONVERSION_LOCK_MAX_RETRIES: int = 2
    KNOWLEDGE_CONVERSION_LOCK_RETRY_DELAY_SECONDS: int = 30

    # ---- Conversion Provider ----
    # Supported values: mineru, paddleocr
    CONVERSION_PROVIDER: str = "mineru"

    # ---- MinerU ----
    MINERU_API_BASE_URL: str = ""
    MINERU_BACKEND: str = "pipeline"
    MINERU_PARSE_METHOD: str = "ocr"
    MINERU_LANG_LIST: str = "ch"
    MINERU_FORMULA_ENABLE: bool = True
    MINERU_TABLE_ENABLE: bool = True
    MINERU_POLL_INTERVAL_SECONDS: int = 3
    MINERU_MAX_WAIT_SECONDS: int = 600

    # ---- PaddleOCR (Baidu AI Studio cloud API) ----
    PADDLEOCR_JOB_URL: str = "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs"
    PADDLEOCR_TOKEN: str = ""
    PADDLEOCR_MODEL: str = "PaddleOCR-VL-1.6"
    PADDLEOCR_USE_DOC_ORIENTATION_CLASSIFY: bool = False
    PADDLEOCR_USE_DOC_UNWARPING: bool = False
    PADDLEOCR_USE_CHART_RECOGNITION: bool = False
    PADDLEOCR_POLL_INTERVAL_SECONDS: int = 5
    PADDLEOCR_MAX_WAIT_SECONDS: int = 1800

    # ---- S3 (image upload) ----
    # WORKER_CONVERSION_S3_* takes precedence; falls back to backend ATTACHMENT_S3_*.
    WORKER_CONVERSION_S3_ENABLED: bool = False
    WORKER_CONVERSION_S3_ENDPOINT: str = ""
    WORKER_CONVERSION_S3_ACCESS_KEY: str = ""
    WORKER_CONVERSION_S3_SECRET_KEY: str = ""
    WORKER_CONVERSION_S3_BUCKET_NAME: str = ""
    WORKER_CONVERSION_S3_REGION_NAME: str = "us-east-1"

    # Backend attachment S3 (shared MinIO settings — no duplicate .env needed)
    ATTACHMENT_S3_ENDPOINT: str = ""
    ATTACHMENT_S3_PUBLIC_ENDPOINT: str = ""
    ATTACHMENT_S3_ACCESS_KEY: str = ""
    ATTACHMENT_S3_SECRET_KEY: str = ""
    ATTACHMENT_S3_BUCKET: str = ""
    ATTACHMENT_S3_REGION: str = "us-east-1"

    # ---- Task Timeout ----
    # Constraint chain (cross-service):
    #   soft_time_limit < time_limit < lock_timeout <= stale_threshold (backend)
    #   9000s            10000s        12000s          12000s
    CONVERSION_TASK_SOFT_TIME_LIMIT: int = 9000  # 150 min, soft limit (catchable)
    CONVERSION_TASK_TIME_LIMIT: int = 10000  # ~167 min, hard limit (SIGKILL)

    # ---- Logging ----
    LOG_FILE_ENABLED: bool = True  # Enable file logging
    LOG_DIR: str = "./logs"  # Directory for log files
    LOG_LEVEL: str = "INFO"  # Log level (DEBUG, INFO, WARNING, ERROR, CRITICAL)

    # ---- Prometheus Metrics ----
    PROMETHEUS_ENABLED: bool = False  # Enable Prometheus metrics server
    PROMETHEUS_PORT: int = 9090  # Port for Prometheus metrics endpoint
    PROMETHEUS_PATH: str = "/metrics"  # URL path for Prometheus metrics endpoint

    model_config = {"env_file": ".env", "extra": "ignore"}

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        # Apply REDIS_PASSWORD to all Redis URLs
        pwd = self.REDIS_PASSWORD
        if pwd:
            self.CELERY_BROKER_URL = _inject_redis_password(self.CELERY_BROKER_URL, pwd)
            self.CELERY_RESULT_BACKEND = _inject_redis_password(
                self.CELERY_RESULT_BACKEND, pwd
            )
            self.REDIS_URL = _inject_redis_password(self.REDIS_URL, pwd)

    def build_internal_auth_headers(self) -> dict[str, str]:
        """Build Authorization header only when an internal token is configured."""
        token = self.BACKEND_INTERNAL_TOKEN.strip()
        if not token:
            return {}
        return {"Authorization": f"Bearer {token}"}

    def build_s3_config(self) -> S3Config:
        """Resolve S3 settings, reusing backend attachment MinIO config when unset."""
        endpoint = self.WORKER_CONVERSION_S3_ENDPOINT or self.ATTACHMENT_S3_ENDPOINT
        access_key = self.WORKER_CONVERSION_S3_ACCESS_KEY or self.ATTACHMENT_S3_ACCESS_KEY
        secret_key = self.WORKER_CONVERSION_S3_SECRET_KEY or self.ATTACHMENT_S3_SECRET_KEY
        bucket_name = self.WORKER_CONVERSION_S3_BUCKET_NAME or self.ATTACHMENT_S3_BUCKET
        region_name = self.WORKER_CONVERSION_S3_REGION_NAME or self.ATTACHMENT_S3_REGION
        public_endpoint = self.ATTACHMENT_S3_PUBLIC_ENDPOINT or endpoint

        enabled = self.WORKER_CONVERSION_S3_ENABLED
        if not enabled and self.CONVERSION_PROVIDER.strip().lower() == "paddleocr":
            enabled = bool(endpoint and bucket_name and access_key and secret_key)

        return S3Config(
            enabled=enabled,
            endpoint=endpoint,
            access_key=access_key,
            secret_key=secret_key,
            bucket_name=bucket_name,
            region_name=region_name,
            public_endpoint=public_endpoint,
        )


settings = ConverterSettings()
