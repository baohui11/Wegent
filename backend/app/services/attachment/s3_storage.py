# SPDX-FileCopyrightText: 2026 Weibo, Inc.
#
# SPDX-License-Identifier: Apache-2.0

"""
S3/MinIO storage backend implementation.

Stores attachment binary data in an S3-compatible object store (MinIO, AWS S3,
Alibaba Cloud OSS, etc.). This backend allows MySQL to keep small metadata only
while large blobs live in object storage.

IMPORTANT: Encryption is handled at the context_service layer, not here.
This backend only stores raw bytes as provided.

Configuration (see app/core/config.py):
    ATTACHMENT_STORAGE_BACKEND  : "s3" or "minio"
    ATTACHMENT_S3_ENDPOINT      : Internal S3 endpoint (e.g. http://minio:9000)
    ATTACHMENT_S3_PUBLIC_ENDPOINT: Optional public endpoint used to rewrite
                                   presigned URLs so browsers/executors that
                                   live outside the cluster can reach the
                                   object store (e.g. http://localhost:9000).
    ATTACHMENT_S3_ACCESS_KEY    : Access key
    ATTACHMENT_S3_SECRET_KEY    : Secret key
    ATTACHMENT_S3_BUCKET        : Bucket name for attachments
    ATTACHMENT_S3_REGION        : S3 region (default: us-east-1)
    ATTACHMENT_S3_USE_SSL       : Whether the endpoint uses HTTPS
"""

import io
import logging
from datetime import timedelta
from typing import Dict, Optional
from urllib.parse import urlsplit, urlunsplit

from minio import Minio
from minio.error import S3Error
from sqlalchemy.orm import Session

from app.core.config import settings
from app.services.attachment.storage_backend import StorageBackend, StorageError

logger = logging.getLogger(__name__)


class S3StorageBackend(StorageBackend):
    """
    S3-compatible object storage backend.

    Lazily initialises a MinIO client from ``ATTACHMENT_S3_*`` settings and
    talks to any S3-API compatible server (MinIO, AWS S3, Aliyun OSS, ...).

    The optional ``ATTACHMENT_S3_PUBLIC_ENDPOINT`` rewrites the host of
    presigned URLs so that browsers or off-cluster executors can reach the
    object store even when the in-cluster endpoint points to an internal
    service name (e.g. ``http://minio:9000``).
    """

    BACKEND_TYPE = "s3"

    # 8 MiB read chunk for streaming downloads; tuned to keep memory bounded
    # when retrieving large attachments.
    _GET_CHUNK_SIZE = 8 * 1024 * 1024

    def __init__(self, db: Session, bucket: Optional[str] = None) -> None:
        """
        Initialize the backend.

        Args:
            db: SQLAlchemy session. Not used directly today, but kept in the
                signature so the registry can call all backends uniformly.
            bucket: Optional bucket override. When None (default), uses
                ``settings.ATTACHMENT_S3_BUCKET``. Callers that store other
                resource families (skills, archives, ...) in their own
                buckets can pass a custom bucket here without having to
                duplicate the MinIO client logic.
        """
        self._db = db
        self._client: Optional[Minio] = None
        self._bucket: str = bucket or settings.ATTACHMENT_S3_BUCKET

    @property
    def backend_type(self) -> str:
        return self.BACKEND_TYPE

    @property
    def client(self) -> Minio:
        """Lazily build a MinIO client from ATTACHMENT_S3_* settings."""
        if self._client is None:
            self._client = self._build_client()
            self._ensure_bucket(self._client, self._bucket)
        return self._client

    @staticmethod
    def _build_client() -> Minio:
        """Build a MinIO client from configuration, raising if incomplete."""
        endpoint = settings.ATTACHMENT_S3_ENDPOINT
        access_key = settings.ATTACHMENT_S3_ACCESS_KEY
        secret_key = settings.ATTACHMENT_S3_SECRET_KEY

        if not endpoint or not access_key or not secret_key:
            raise StorageError(
                "S3 storage backend is not configured. Set "
                "ATTACHMENT_S3_ENDPOINT, ATTACHMENT_S3_ACCESS_KEY and "
                "ATTACHMENT_S3_SECRET_KEY environment variables."
            )

        host = endpoint.replace("https://", "").replace("http://", "")
        return Minio(
            host,
            access_key=access_key,
            secret_key=secret_key,
            secure=settings.ATTACHMENT_S3_USE_SSL,
            region=settings.ATTACHMENT_S3_REGION,
        )

    @staticmethod
    def _ensure_bucket(client: Minio, bucket: str) -> None:
        """Create the bucket if it does not exist yet."""
        try:
            if not client.bucket_exists(bucket):
                client.make_bucket(bucket)
                logger.info("Created S3 bucket: %s", bucket)
        except S3Error as exc:
            logger.error("Failed to ensure bucket %s exists: %s", bucket, exc)
            raise StorageError(f"Failed to ensure bucket {bucket}: {exc}")

    def save(self, key: str, data: bytes, metadata: Dict) -> str:
        """Upload bytes to S3 using ``put_object``."""
        try:
            length = len(data)
            content_type = (metadata or {}).get(
                "mime_type"
            ) or "application/octet-stream"
            put_metadata = self._build_object_metadata(metadata)
            self.client.put_object(
                self._bucket,
                key,
                io.BytesIO(data),
                length,
                content_type=content_type,
                metadata=put_metadata or None,
            )
            logger.debug(
                "Saved %d bytes to S3 bucket=%s key=%s", length, self._bucket, key
            )
            return key
        except S3Error as exc:
            logger.error("Failed to save object key=%s: %s", key, exc)
            raise StorageError(f"Failed to save data to S3: {exc}", key)
        except Exception as exc:
            logger.error("Unexpected error saving object key=%s: %s", key, exc)
            raise StorageError(f"Failed to save data to S3: {exc}", key)

    def get(self, key: str) -> Optional[bytes]:
        """Stream the object from S3 and return its content as bytes."""
        response = None
        try:
            response = self.client.get_object(self._bucket, key)
            buf = io.BytesIO()
            for chunk in response.stream(self._GET_CHUNK_SIZE):
                buf.write(chunk)
            return buf.getvalue()
        except S3Error as exc:
            if exc.code in {"NoSuchKey", "NoSuchObject"}:
                return None
            logger.error("Failed to get object key=%s: %s", key, exc)
            return None
        except Exception as exc:
            logger.error("Unexpected error getting object key=%s: %s", key, exc)
            return None
        finally:
            if response is not None:
                try:
                    response.close()
                    response.release_conn()
                except Exception:
                    logger.debug(
                        "Suppressed error releasing S3 response", exc_info=True
                    )

    def delete(self, key: str) -> bool:
        """Remove the object from S3. Returns True if the call did not fail."""
        try:
            self.client.remove_object(self._bucket, key)
            logger.debug("Deleted S3 object key=%s", key)
            return True
        except S3Error as exc:
            logger.error("Failed to delete object key=%s: %s", key, exc)
            return False
        except Exception as exc:
            logger.error("Unexpected error deleting object key=%s: %s", key, exc)
            return False

    def exists(self, key: str) -> bool:
        """Use ``stat_object`` to determine whether the object exists."""
        try:
            self.client.stat_object(self._bucket, key)
            return True
        except S3Error as exc:
            if exc.code in {"NoSuchKey", "NoSuchObject"}:
                return False
            logger.error("Failed to stat object key=%s: %s", key, exc)
            return False
        except Exception as exc:
            logger.error("Unexpected error stat-ing object key=%s: %s", key, exc)
            return False

    def get_url(
        self, key: str, expires: int = 3600, *, public: bool = False
    ) -> Optional[str]:
        """Generate a presigned GET URL.

        Args:
            key: Object key in the bucket.
            expires: URL lifetime in seconds.
            public: When True and ``ATTACHMENT_S3_PUBLIC_ENDPOINT`` is set,
                rewrite the host for browsers / off-cluster executors
                (e.g. ``http://localhost:9000``). When False (default),
                keep the in-cluster endpoint (e.g. ``http://minio:9000``) so
                Docker-network callers (executor, chat_shell) can follow the
                redirect without hitting ``localhost``.
        """
        try:
            url = self.client.presigned_get_object(
                self._bucket,
                key,
                expires=timedelta(seconds=expires),
            )
            if public:
                return self._rewrite_public_url(url)
            return url
        except S3Error as exc:
            logger.error("Failed to presign GET url for key=%s: %s", key, exc)
            return None

    def get_upload_url(self, key: str, expires: int = 600) -> Optional[str]:
        """Generate a presigned PUT URL for direct browser uploads."""
        try:
            url = self.client.presigned_put_object(
                self._bucket,
                key,
                expires=timedelta(seconds=expires),
            )
            return self._rewrite_public_url(url)
        except S3Error as exc:
            logger.error("Failed to presign PUT url for key=%s: %s", key, exc)
            return None

    @staticmethod
    def _build_object_metadata(metadata: Optional[Dict]) -> Dict[str, str]:
        """Convert metadata to MinIO-compatible (string-only) form.

        MinIO requires header values to be strings. We also drop ``None``s.
        """
        if not metadata:
            return {}
        return {str(k): str(v) for k, v in metadata.items() if v is not None}

    @staticmethod
    def _rewrite_public_url(url: str) -> str:
        """Rewrite the host/scheme of a presigned URL to the public endpoint.

        This is required when the backend talks to MinIO via an internal
        hostname (``http://minio:9000``) but presigned URLs must be usable
        by clients outside the cluster (``http://localhost:9000``).
        Returns the URL unchanged when no public endpoint is configured.
        """
        public_endpoint = getattr(settings, "ATTACHMENT_S3_PUBLIC_ENDPOINT", "")
        if not public_endpoint:
            return url

        try:
            public = urlsplit(public_endpoint)
            original = urlsplit(url)
            return urlunsplit(
                (
                    public.scheme or original.scheme,
                    public.netloc or original.netloc,
                    original.path,
                    original.query,
                    original.fragment,
                )
            )
        except Exception:
            logger.warning(
                "Failed to rewrite presigned URL with public endpoint, "
                "returning original URL",
                exc_info=True,
            )
            return url
