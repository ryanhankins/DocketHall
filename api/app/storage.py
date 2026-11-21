# Copyright 2026 Ryan Hankins
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as
# published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.

"""Object storage client: SeaweedFS/S3 via boto3 (default) or local filesystem (STORAGE_BACKEND=local)."""
from datetime import datetime, timezone
import os
import shutil
from types import SimpleNamespace


class LocalObjectResponse:
    """File-like wrapper matching the S3 streaming response interface (.read/.stream/.close/.release_conn)."""

    def __init__(self, file_obj):
        self._f = file_obj

    def read(self, amt: int = -1) -> bytes:
        return self._f.read(amt)

    def stream(self, amt: int = 32 * 1024):
        while True:
            chunk = self._f.read(amt)
            if not chunk:
                break
            yield chunk

    def close(self) -> None:
        self._f.close()

    def release_conn(self) -> None:
        pass


class S3ObjectResponse:
    """File-like wrapper around boto3's StreamingBody."""

    def __init__(self, body):
        self._body = body

    def read(self, amt: int = -1) -> bytes:
        return self._body.read() if amt is None or amt < 0 else self._body.read(amt)

    def stream(self, amt: int = 32 * 1024):
        for chunk in self._body.iter_chunks(chunk_size=amt):
            yield chunk

    def close(self) -> None:
        self._body.close()

    def release_conn(self) -> None:
        pass


class LocalStorageClient:
    """Drop-in local filesystem replacement for S3 when external object storage is disabled."""

    def __init__(self, base_dir: str):
        self.base_dir = os.path.realpath(base_dir)
        os.makedirs(self.base_dir, exist_ok=True)

    def _resolve(self, bucket: str, object_name: str) -> str:
        clean_bucket = (bucket or "records").strip().strip("/")
        clean_key = (object_name or "").lstrip("/")
        if not clean_bucket or not clean_key:
            raise ValueError("Bucket and object_name are required")
        target = os.path.realpath(os.path.join(self.base_dir, clean_bucket, clean_key))
        root_prefix = self.base_dir.rstrip(os.sep) + os.sep
        if not target.startswith(root_prefix):
            raise ValueError(f"Unsafe storage path: {object_name!r}")
        return target

    def bucket_exists(self, bucket_name: str) -> bool:
        clean = (bucket_name or "records").strip().strip("/")
        return os.path.isdir(os.path.join(self.base_dir, clean))

    def make_bucket(self, bucket_name: str) -> None:
        clean = (bucket_name or "records").strip().strip("/")
        os.makedirs(os.path.join(self.base_dir, clean), exist_ok=True)

    def list_objects(self, bucket_name: str, prefix: str = "", recursive: bool = True):
        clean = (bucket_name or "records").strip().strip("/")
        root = os.path.join(self.base_dir, clean)
        if not os.path.isdir(root):
            return []
        norm_prefix = (prefix or "").lstrip("/")
        out = []
        for dirpath, _, filenames in os.walk(root):
            for fname in filenames:
                full = os.path.join(dirpath, fname)
                rel = os.path.relpath(full, root).replace(os.sep, "/")
                if norm_prefix and not rel.startswith(norm_prefix):
                    continue
                st = os.stat(full)
                out.append(SimpleNamespace(
                    object_name=rel,
                    size=st.st_size,
                    last_modified=datetime.fromtimestamp(st.st_mtime, tz=timezone.utc),
                ))
            if not recursive:
                break
        return out

    def put_object(self, bucket_name: str, object_name: str, data, length: int = -1, content_type: str = "application/octet-stream"):
        path = self._resolve(bucket_name, object_name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as out:
            shutil.copyfileobj(data, out)

    def get_object(self, bucket_name: str, object_name: str) -> LocalObjectResponse:
        path = self._resolve(bucket_name, object_name)
        return LocalObjectResponse(open(path, "rb"))

    def remove_object(self, bucket_name: str, object_name: str) -> None:
        path = self._resolve(bucket_name, object_name)
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass

    def copy_object(self, bucket_name: str, object_name: str, source) -> None:
        src_bucket = getattr(source, "bucket_name", bucket_name)
        src_key = getattr(source, "object_name", "")
        src_path = self._resolve(src_bucket, src_key)
        dst_path = self._resolve(bucket_name, object_name)
        os.makedirs(os.path.dirname(dst_path), exist_ok=True)
        shutil.copyfile(src_path, dst_path)


class BotoS3StorageClient:
    """S3-compatible storage client backed by boto3 (SeaweedFS, AWS S3, R2, B2, etc.)."""

    def __init__(self, endpoint: str, *, access_key: str = "", secret_key: str = "", secure: bool = False):
        import boto3
        from botocore.client import Config
        from botocore.exceptions import ClientError

        self._ClientError = ClientError
        ep = endpoint.strip()
        if not ep.startswith(("http://", "https://")):
            ep = f"{'https' if secure else 'http'}://{ep}"
        self._client = boto3.client(
            "s3",
            endpoint_url=ep,
            aws_access_key_id=access_key or "dockethall",
            aws_secret_access_key=secret_key or "dockethall",
            region_name=os.environ.get("S3_REGION", "us-east-1"),
            config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
        )
        self._ensured_buckets: set[str] = set()

    def bucket_exists(self, bucket_name: str) -> bool:
        try:
            self._client.head_bucket(Bucket=bucket_name)
            return True
        except self._ClientError:
            return False

    def make_bucket(self, bucket_name: str) -> None:
        try:
            self._client.create_bucket(Bucket=bucket_name)
        except self._ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            if code not in ("BucketAlreadyOwnedByYou", "BucketAlreadyExists"):
                raise
        self._ensured_buckets.add(bucket_name)

    def _ensure_bucket(self, bucket_name: str) -> None:
        if bucket_name not in self._ensured_buckets:
            if not self.bucket_exists(bucket_name):
                self.make_bucket(bucket_name)
            self._ensured_buckets.add(bucket_name)

    def list_objects(self, bucket_name: str, prefix: str = "", recursive: bool = True):
        paginator = self._client.get_paginator("list_objects_v2")
        kwargs = {"Bucket": bucket_name, "Prefix": prefix or ""}
        if not recursive:
            kwargs["Delimiter"] = "/"
        out = []
        for page in paginator.paginate(**kwargs):
            for obj in page.get("Contents", []) or []:
                out.append(SimpleNamespace(
                    object_name=obj["Key"],
                    size=obj.get("Size", 0),
                    last_modified=obj.get("LastModified"),
                ))
        return out

    def put_object(self, bucket_name: str, object_name: str, data, length: int = -1, content_type: str = "application/octet-stream"):
        self._ensure_bucket(bucket_name)
        if hasattr(data, "seek"):
            try:
                data.seek(0)
            except Exception:
                pass
        self._client.put_object(
            Bucket=bucket_name,
            Key=object_name,
            Body=data,
            ContentType=content_type or "application/octet-stream",
        )

    def get_object(self, bucket_name: str, object_name: str) -> S3ObjectResponse:
        resp = self._client.get_object(Bucket=bucket_name, Key=object_name)
        return S3ObjectResponse(resp["Body"])

    def remove_object(self, bucket_name: str, object_name: str) -> None:
        self._client.delete_object(Bucket=bucket_name, Key=object_name)

    def copy_object(self, bucket_name: str, object_name: str, source) -> None:
        self._ensure_bucket(bucket_name)
        src_bucket = getattr(source, "bucket_name", bucket_name)
        src_key = getattr(source, "object_name", "")
        self._client.copy_object(
            Bucket=bucket_name,
            Key=object_name,
            CopySource={"Bucket": src_bucket, "Key": src_key},
        )


_storage_client = None


def get_storage_client():
    global _storage_client
    if _storage_client is None:
        backend = os.environ.get("STORAGE_BACKEND", "s3").strip().lower()
        endpoint = (os.environ.get("S3_ENDPOINT") or os.environ.get("MINIO_ENDPOINT") or "seaweedfs:8333").strip()
        if backend == "local" or not endpoint:
            _storage_client = LocalStorageClient(os.environ.get("LOCAL_RECORDS_DIR", "/data/records"))
        else:
            from .db import _read_secret

            secure = (os.environ.get("S3_SECURE") or os.environ.get("MINIO_SECURE") or "false").lower() == "true"
            access_key = _read_secret("S3_ACCESS_KEY_FILE", "S3_ACCESS_KEY") or _read_secret("MINIO_ACCESS_KEY_FILE", "MINIO_ACCESS_KEY")
            secret_key = _read_secret("S3_SECRET_KEY_FILE", "S3_SECRET_KEY") or _read_secret("MINIO_SECRET_KEY_FILE", "MINIO_SECRET_KEY")
            _storage_client = BotoS3StorageClient(
                endpoint,
                access_key=access_key,
                secret_key=secret_key,
                secure=secure,
            )
    return _storage_client
