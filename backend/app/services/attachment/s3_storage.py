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
    ATTACHMENT_S3_PUBLIC_ENDPOINT: Optional public endpoint used when signing
                                   browser-facing presigned URLs (must match the
                                   host clients call, e.g. http://localhost:9000).
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
from urllib.parse import urlsplit

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

    Browser-facing presigned URLs are signed with ``ATTACHMENT_S3_PUBLIC_ENDPOINT``
    so the Host header matches what clients actually call. Rewriting the host
    after signing breaks SigV4 and causes ``SignatureDoesNotMatch``.
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
        self._public_presign_client: Optional[Minio] = None
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
    def _build_client_from_endpoint(endpoint: str) -> Minio:
        """Build a MinIO client for one endpoint URL."""
        access_key = settings.ATTACHMENT_S3_ACCESS_KEY
        secret_key = settings.ATTACHMENT_S3_SECRET_KEY

        if not endpoint or not access_key or not secret_key:
            raise StorageError(
                "S3 storage backend is not configured. Set "
                "ATTACHMENT_S3_ENDPOINT, ATTACHMENT_S3_ACCESS_KEY and "
                "ATTACHMENT_S3_SECRET_KEY environment variables."
            )

        normalized = endpoint if "://" in endpoint else f"http://{endpoint}"
        parsed = urlsplit(normalized)
        secure = (parsed.scheme or "http") == "https"
        host = parsed.netloc or parsed.path.split("/")[0]
        if not host:
            host = endpoint.replace("https://", "").replace("http://", "").split("/")[0]

        return Minio(
            host,
            access_key=access_key,
            secret_key=secret_key,
            secure=secure,
            region=settings.ATTACHMENT_S3_REGION,
        )

    @classmethod
    def _build_client(cls) -> Minio:
        """Build a MinIO client for in-cluster object I/O."""
        return cls._build_client_from_endpoint(settings.ATTACHMENT_S3_ENDPOINT)

    @property
    def public_presign_client(self) -> Minio:
        """Return a MinIO client whose presigned URLs target browsers."""
        public_endpoint = (settings.ATTACHMENT_S3_PUBLIC_ENDPOINT or "").strip()
        if not public_endpoint:
            return self.client
        if self._public_presign_client is None:
            self._public_presign_client = self._build_client_from_endpoint(
                public_endpoint
            )
        return self._public_presign_client

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

    def list_objects(self, prefix: str) -> list[dict]:
        """List objects under ``prefix`` recursively.

        Returns a list of ``{"key", "size", "last_modified"}`` dicts. Folder
        placeholder entries (``is_dir``) are skipped so callers only see real
        objects.
        """
        results: list[dict] = []
        try:
            for obj in self.client.list_objects(
                self._bucket, prefix=prefix, recursive=True
            ):
                if getattr(obj, "is_dir", False):
                    continue
                results.append(
                    {
                        "key": obj.object_name,
                        "size": int(obj.size or 0),
                        "last_modified": obj.last_modified,
                    }
                )
            return results
        except S3Error as exc:
            logger.error("Failed to list objects prefix=%s: %s", prefix, exc)
            return results
        except Exception as exc:
            logger.error("Unexpected error listing objects prefix=%s: %s", prefix, exc)
            return results

    def get_size(self, key: str) -> Optional[int]:
        """Return the object size via ``stat_object`` without downloading it."""
        try:
            return self.client.stat_object(self._bucket, key).size
        except S3Error as exc:
            if exc.code in {"NoSuchKey", "NoSuchObject"}:
                return None
            logger.error("Failed to stat object size key=%s: %s", key, exc)
            return None
        except Exception as exc:
            logger.error("Unexpected error stat-ing object size key=%s: %s", key, exc)
            return None

    def get_url(
        self, key: str, expires: int = 3600, *, public: bool = False
    ) -> Optional[str]:
        """Generate a presigned GET URL.

        Args:
            key: Object key in the bucket.
            expires: URL lifetime in seconds.
            public: When True, sign the URL with ``ATTACHMENT_S3_PUBLIC_ENDPOINT``
                so browsers can reach MinIO with a valid signature. When False
                (default), sign with the in-cluster endpoint for executors and
                other Docker-network callers.
        """
        try:
            client = self.public_presign_client if public else self.client
            return client.presigned_get_object(
                self._bucket,
                key,
                expires=timedelta(seconds=expires),
            )
        except S3Error as exc:
            logger.error("Failed to presign GET url for key=%s: %s", key, exc)
            return None

    def get_upload_url(
        self, key: str, expires: int = 600, *, public: bool = True
    ) -> Optional[str]:
        """Generate a presigned PUT URL.

        Args:
            key: Object key in the bucket.
            expires: URL lifetime in seconds.
            public: When True (default), sign with ``ATTACHMENT_S3_PUBLIC_ENDPOINT``
                for direct browser uploads. When False, sign with the in-cluster
                endpoint so executors and other Docker-network callers can PUT
                with a valid signature (browser-facing hosts are unreachable
                from inside the executor network).
        """
        try:
            client = self.public_presign_client if public else self.client
            return client.presigned_put_object(
                self._bucket,
                key,
                expires=timedelta(seconds=expires),
            )
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
