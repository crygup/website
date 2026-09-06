"""Short-lived media hosting for Fishie's oversized Discord results.

The bot uses this service only when Discord's upload limit is smaller than the
finished media. Uploads are authenticated, stored outside the static website,
and removed automatically after a short retention period.
"""

from __future__ import annotations

import asyncio
import hmac
import json
import mimetypes
import os
import re
import secrets
import time
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from urllib.parse import quote

import uvicorn
from fastapi import FastAPI, Header, HTTPException, Request, Response
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from logging_utils import get_logger

MAX_MEDIA_BYTES = 500 * 1024 * 1024
# Normal uploads stay capped at 500 MiB.  Fishie's owner-only download
# override may use this bounded ceiling through the authenticated API.
OWNER_MAX_MEDIA_BYTES = 2 * 1024 * 1024 * 1024
MEDIA_TTL = 30 * 60
CLEANUP_INTERVAL = 60
MAX_ACTIVE_UPLOADS = 2
TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{32,64}$")
FILENAME_RE = re.compile(r"[^A-Za-z0-9._-]+")

MEDIA_HOST = os.getenv("WEBSITE_MEDIA_HOST", "127.0.0.1")
MEDIA_PORT = int(os.getenv("WEBSITE_MEDIA_PORT", "8003"))
MEDIA_ROOT = Path(os.getenv("WEBSITE_MEDIA_PATH", "/app/media"))
UPLOAD_TOKEN = os.getenv("WEBSITE_MEDIA_UPLOAD_TOKEN", "").strip()
OWNER_UPLOAD_TOKEN = os.getenv("WEBSITE_MEDIA_OWNER_UPLOAD_TOKEN", "").strip()
PUBLIC_BASE_URL = os.getenv(
    "WEBSITE_MEDIA_PUBLIC_BASE", "https://api.crygup.com/media"
).rstrip("/")
logger = get_logger("media")
upload_slots = asyncio.Semaphore(MAX_ACTIVE_UPLOADS)
cleanup_task: asyncio.Task[None] | None = None


def _safe_filename(value: str | None, content_type: str) -> str:
    raw = Path(str(value or "")).name
    raw = FILENAME_RE.sub("_", raw).strip("._")[:120]
    if not raw:
        raw = "media"
    if "." not in raw:
        extension = mimetypes.guess_extension(content_type) or ""
        raw += extension
    return raw


def _metadata_path(token: str) -> Path:
    return MEDIA_ROOT / f"{token}.json"


def _media_path(token: str, filename: str) -> Path:
    # The filename is stored in metadata, but never allow it to influence the
    # directory. The random token is the only filesystem identifier.
    extension = Path(filename).suffix[:16]
    return MEDIA_ROOT / f"{token}{extension}"


def _authorized(api_key: str | None, *, owner_override: bool = False) -> None:
    expected = OWNER_UPLOAD_TOKEN if owner_override else UPLOAD_TOKEN
    if not expected or not api_key or not hmac.compare_digest(api_key, expected):
        raise HTTPException(401, "Invalid media upload key")


def _content_type(request: Request) -> str:
    value = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if value == "image/svg+xml":
        raise HTTPException(415, "SVG uploads are not supported")
    if not (
        value.startswith(("image/", "video/", "audio/"))
        or value == "application/octet-stream"
    ):
        raise HTTPException(415, "Upload an image, GIF, video, or audio file")
    return value


def _remove_entry(metadata: Path) -> None:
    try:
        payload = json.loads(metadata.read_text(encoding="utf-8"))
        token = str(payload.get("token", ""))
        filename = str(payload.get("filename", ""))
        if TOKEN_RE.fullmatch(token):
            _media_path(token, filename).unlink(missing_ok=True)
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        pass
    metadata.unlink(missing_ok=True)


def _cleanup_expired() -> int:
    now = time.time()
    removed = 0
    MEDIA_ROOT.mkdir(mode=0o750, parents=True, exist_ok=True)
    for metadata in MEDIA_ROOT.glob("*.json"):
        try:
            payload = json.loads(metadata.read_text(encoding="utf-8"))
            expires_at = float(payload.get("expires_at", 0))
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            expires_at = 0
        if expires_at <= now:
            _remove_entry(metadata)
            removed += 1
    # Interrupted uploads never receive metadata. Remove old partial files so
    # a client disconnect cannot consume the whole temporary filesystem.
    for partial in MEDIA_ROOT.glob("*.part"):
        with suppress(OSError):
            if partial.stat().st_mtime <= now - MEDIA_TTL:
                partial.unlink()
    # A process can stop after exposing the media file but before its metadata
    # is committed. Reap those orphaned files after a short grace period so a
    # normal upload cannot be mistaken for an interrupted one.
    orphan_before = now - max(CLEANUP_INTERVAL * 2, 120)
    for media in MEDIA_ROOT.iterdir():
        if not media.is_file() or media.name.startswith("."):
            continue
        if media.suffix in {".json", ".part"}:
            continue
        token = media.stem
        if not TOKEN_RE.fullmatch(token) or _metadata_path(token).exists():
            continue
        with suppress(OSError):
            if media.stat().st_mtime <= orphan_before:
                media.unlink()
    return removed


def _ensure_media_root() -> None:
    """Create the media directory and fail startup if it is not writable."""
    MEDIA_ROOT.mkdir(mode=0o750, parents=True, exist_ok=True)
    probe = MEDIA_ROOT / ".write-check"
    try:
        probe.touch(exist_ok=False)
    except FileExistsError:
        probe.unlink(missing_ok=True)
    except OSError as error:
        raise RuntimeError(
            f"Temporary media directory is not writable: {MEDIA_ROOT}"
        ) from error
    else:
        probe.unlink(missing_ok=True)


async def _cleanup_loop() -> None:
    while True:
        await asyncio.sleep(CLEANUP_INTERVAL)
        try:
            removed = await asyncio.to_thread(_cleanup_expired)
            if removed:
                logger.info("expired_media_removed count=%s", removed)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("media_cleanup_failed")


@asynccontextmanager
async def lifespan(app: FastAPI):
    global cleanup_task
    _ensure_media_root()
    await asyncio.to_thread(_cleanup_expired)
    cleanup_task = asyncio.create_task(_cleanup_loop(), name="media-cleanup")
    yield
    if cleanup_task is not None:
        cleanup_task.cancel()
        with suppress(asyncio.CancelledError):
            await cleanup_task
        cleanup_task = None


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["api.crygup.com", "127.0.0.1", "localhost"],
)


@app.get("/health/live", include_in_schema=False)
@app.get("/health/ready", include_in_schema=False)
async def health() -> Response:
    return Response(status_code=204)


@app.post("/uploads", status_code=201)
async def upload_media(
    request: Request,
    x_api_key: str | None = Header(None, alias="X-API-Key"),
    x_filename: str | None = Header(None, alias="X-Filename"),
    x_ignore_size_limit: str | None = Header(None, alias="X-Ignore-Size-Limit"),
):
    owner_override = x_ignore_size_limit in {"1", "true", "yes"}
    _authorized(x_api_key, owner_override=owner_override)
    max_media_bytes = OWNER_MAX_MEDIA_BYTES if owner_override else MAX_MEDIA_BYTES
    limit_mb = max_media_bytes // (1024 * 1024)
    content_type = _content_type(request)
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > max_media_bytes:
                raise HTTPException(413, f"Media is limited to {limit_mb} MB")
        except ValueError as error:
            raise HTTPException(400, "Invalid content length") from error

    async with upload_slots:
        token = secrets.token_urlsafe(32)
        filename = _safe_filename(x_filename, content_type)
        partial = MEDIA_ROOT / f"{token}.part"
        target = _media_path(token, filename)
        metadata_path = _metadata_path(token)
        metadata_partial = MEDIA_ROOT / f"{token}.json.part"
        size = 0
        try:
            with partial.open("wb") as output:
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > max_media_bytes:
                        raise HTTPException(413, f"Media is limited to {limit_mb} MB")
                    await asyncio.to_thread(output.write, chunk)
            if size == 0:
                raise HTTPException(400, "The uploaded media is empty")
            metadata = {
                "token": token,
                "filename": filename,
                "content_type": content_type,
                "size": size,
                "expires_at": time.time() + MEDIA_TTL,
            }
            metadata_partial.write_text(
                json.dumps(metadata, separators=(",", ":")), encoding="utf-8"
            )
            metadata_partial.replace(metadata_path)
            partial.replace(target)
        except Exception:
            partial.unlink(missing_ok=True)
            metadata_partial.unlink(missing_ok=True)
            metadata_path.unlink(missing_ok=True)
            target.unlink(missing_ok=True)
            raise

    logger.info("media_uploaded token=%s bytes=%s", token[:8], size)
    return {
        # Keep the original extension in the public path.  Discord's media
        # gallery uses the URL suffix when deciding how to render a remote
        # attachment, while the token remains the only filesystem identifier.
        "url": f"{PUBLIC_BASE_URL}/files/{token}/{quote(filename, safe='')}",
        "filename": filename,
        "size": size,
        "expires_in": MEDIA_TTL,
    }


@app.api_route("/files/{token}", methods=["GET", "HEAD"])
@app.api_route("/files/{token}/{requested_filename}", methods=["GET", "HEAD"])
async def get_media(token: str, requested_filename: str | None = None):
    if not TOKEN_RE.fullmatch(token):
        raise HTTPException(404, "Media not found")
    metadata_path = _metadata_path(token)
    if not metadata_path.is_file():
        raise HTTPException(404, "Media not found")
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        if float(metadata.get("expires_at", 0)) <= time.time():
            _remove_entry(metadata_path)
            raise HTTPException(404, "Media expired")
        filename = str(metadata["filename"])
        content_type = str(metadata["content_type"])
    except HTTPException:
        raise
    except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError) as error:
        raise HTTPException(404, "Media not found") from error
    path = _media_path(token, filename)
    if not path.is_file():
        _remove_entry(metadata_path)
        raise HTTPException(404, "Media not found")
    canonical_filename = quote(filename, safe="")
    # Keep previously issued extensionless links working while redirecting
    # them to the filename-bearing URL Discord can recognize as media.  Also
    # canonicalize a mismatched suffix so it cannot be used to mislabel the
    # response.
    if requested_filename != filename:
        return RedirectResponse(
            f"{PUBLIC_BASE_URL}/files/{token}/{canonical_filename}",
            status_code=307,
        )
    disposition = "attachment" if content_type == "image/svg+xml" else "inline"
    return FileResponse(
        path,
        media_type=content_type,
        headers={
            "Cache-Control": f"public, max-age={MEDIA_TTL}, immutable",
            "Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(filename)}",
            "Content-Security-Policy": "default-src 'none'; sandbox",
            "X-Content-Type-Options": "nosniff",
            "X-Download-Options": "noopen",
        },
    )


if __name__ == "__main__":
    uvicorn.run(app, host=MEDIA_HOST, port=MEDIA_PORT)
