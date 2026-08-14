"""Restricted media download API for the crygup download page."""

from __future__ import annotations

import asyncio
import ipaddress
import mimetypes
import os
import re
import secrets
import shutil
import signal
import socket
import sys
from collections import defaultdict, deque
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass
from pathlib import Path
from time import monotonic
from typing import Literal
from urllib.parse import quote, urlsplit

import aiohttp
import uvicorn
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from pydantic import BaseModel, Field

from logging_utils import get_logger

MAX_FILE_BYTES = 500_000_000
DOWNLOAD_TIMEOUT = 10 * 60.0
DOWNLOAD_TIMEOUT_MINUTES = int(DOWNLOAD_TIMEOUT // 60)
GIF_MAX_DURATION = 30.0
JOB_TTL = 10 * 60.0
RATE_LIMIT_WINDOW = 10 * 60.0
RATE_LIMIT_JOBS = 5
MAX_RETAINED_JOBS = 12
MAX_JOBS_PER_CLIENT = 2
DOWNLOAD_ROOT = Path(os.environ.get("WEBSITE_DOWNLOAD_PATH", "/app/downloads"))
API_HOST = os.environ.get("WEBSITE_DOWNLOAD_HOST", "127.0.0.1")
API_PORT = int(os.environ.get("WEBSITE_DOWNLOAD_PORT", "8002"))

ALLOWED_HOSTS = frozenset(
    {
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "youtu.be",
        "instagram.com",
        "www.instagram.com",
        "tiktok.com",
        "www.tiktok.com",
        "m.tiktok.com",
        "vm.tiktok.com",
        "vt.tiktok.com",
        "vk.tiktok.com",
        "soundcloud.com",
        "on.soundcloud.com",
        "twitter.com",
        "www.twitter.com",
        "x.com",
        "www.x.com",
        "fxtwitter.com",
        "vxtwitter.com",
        "fixupx.com",
        "girlcockx.com",
        "clips.twitch.tv",
        "twitch.tv",
        "www.twitch.tv",
        "reddit.com",
        "www.reddit.com",
        "pin.it",
        "pinterest.com",
        "www.pinterest.com",
        "tenor.com",
        "www.tenor.com",
        "klipy.com",
        "www.klipy.com",
        "static.klipy.com",
    }
)

LIVE_STREAM_PATTERNS = (
    re.compile(
        r"https?://(?:www\.)?youtube\.com/(?:live/|(?:@[^/]+|channel/[^/]+|c/[^/]+|user/[^/]+)/live(?:[/?#]|$))",
        re.IGNORECASE,
    ),
    re.compile(
        r"https?://(?:www\.)?twitch\.tv/(?!directory(?:[/?#]|$)|videos?(?:[/?#]|$)|clips?(?:[/?#]|$)|search(?:[/?#]|$)|downloads(?:[/?#]|$)|[A-Za-z0-9_]{2,25}/clip(?:[/?#]|$))[A-Za-z0-9_]{2,25}(?:[/?#]|$)",
        re.IGNORECASE,
    ),
    re.compile(
        r"https?://(?:www\.)?kick\.com/[A-Za-z0-9][A-Za-z0-9_-]{1,24}(?:[/?#]|$)",
        re.IGNORECASE,
    ),
)

COOKIE_FILES = {
    "youtube.com": "youtube-cookies.txt",
    "www.youtube.com": "youtube-cookies.txt",
    "m.youtube.com": "youtube-cookies.txt",
    "youtu.be": "youtube-cookies.txt",
    "twitter.com": "twitter-cookies.txt",
    "www.twitter.com": "twitter-cookies.txt",
    "x.com": "twitter-cookies.txt",
    "www.x.com": "twitter-cookies.txt",
    "fxtwitter.com": "twitter-cookies.txt",
    "vxtwitter.com": "twitter-cookies.txt",
    "fixupx.com": "twitter-cookies.txt",
    "girlcockx.com": "twitter-cookies.txt",
    "instagram.com": "instagram-cookies.txt",
    "www.instagram.com": "instagram-cookies.txt",
}
COOKIE_ROOT = Path(os.environ.get("WEBSITE_DOWNLOAD_COOKIE_PATH", "/app/cookies"))
SAFE_ORIGINS = frozenset({"https://crygup.com", "https://www.crygup.com"})
logger = get_logger("download")


class DownloadFailure(Exception):
    pass


class DownloadRequest(BaseModel):
    url: str = Field(min_length=8, max_length=2048)
    format: Literal["mp4", "webm", "mp3", "gif"] = "mp4"
    filename: str | None = Field(default=None, max_length=80)


@dataclass(slots=True)
class DownloadJob:
    id: str
    owner: str
    source_url: str
    media_format: str
    requested_filename: str | None
    directory: Path
    created_at: float
    status: str = "queued"
    phase: str = "Waiting for an available download slot"
    error: str | None = None
    file_path: Path | None = None
    filename: str | None = None
    size: int | None = None


jobs: dict[str, DownloadJob] = {}
job_tasks: set[asyncio.Task[None]] = set()
rate_limits: dict[str, deque[float]] = defaultdict(deque)
jobs_lock = asyncio.Lock()
download_slots = asyncio.Semaphore(2)
shutting_down = False


def _is_public_address(address: str) -> bool:
    ip = ipaddress.ip_address(address)
    return not (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def _validate_connected_peer(response: aiohttp.ClientResponse) -> None:
    """Reject a response whose socket connected to a private address."""

    connection = response.connection
    transport = connection.transport if connection is not None else None
    peer = transport.get_extra_info("peername") if transport is not None else None
    if not peer or not _is_public_address(str(peer[0])):
        response.close()
        raise DownloadFailure(
            "The remote server did not provide a public network connection."
            if not peer
            else "Private and local network addresses are not allowed."
        )


async def _validate_url(url: str) -> str:
    try:
        parsed = urlsplit(url.strip())
        port = parsed.port
    except ValueError as exc:
        raise DownloadFailure("That URL is not valid.") from exc

    host = (parsed.hostname or "").lower().rstrip(".")
    if (
        parsed.scheme.lower() not in {"http", "https"}
        or not host
        or parsed.username is not None
        or parsed.password is not None
        or port not in {None, 80, 443}
    ):
        raise DownloadFailure("Only public HTTP or HTTPS URLs are allowed.")
    if host not in ALLOWED_HOSTS:
        raise DownloadFailure("That website is not supported yet.")
    if any(pattern.search(url) for pattern in LIVE_STREAM_PATTERNS):
        raise DownloadFailure(
            "Live streams cannot be downloaded. Please provide a recorded video or clip."
        )

    try:
        addresses = await asyncio.get_running_loop().getaddrinfo(
            host,
            port or (443 if parsed.scheme.lower() == "https" else 80),
            type=socket.SOCK_STREAM,
        )
    except socket.gaierror as exc:
        raise DownloadFailure("The URL hostname could not be resolved.") from exc

    resolved = {str(item[4][0]) for item in addresses}
    if not resolved or any(not _is_public_address(address) for address in resolved):
        raise DownloadFailure("Private and local network addresses are not allowed.")
    return url.strip()


def _client_ip(request: Request) -> str:
    # Nginx validates CF-Connecting-IP against Cloudflare's proxy ranges and
    # forwards the resulting address as X-Real-IP. Never trust the raw
    # Cloudflare header in the application.
    value = request.headers.get("X-Real-IP", "").strip()
    try:
        return str(ipaddress.ip_address(value))
    except ValueError:
        pass
    return request.client.host if request.client else "unknown"


def _log_path(request: Request) -> str:
    return re.sub(r"^/jobs/[^/]+", "/jobs/{job_id}", request.url.path)


def _safe_filename(value: str | None) -> str | None:
    if not value:
        return None
    name = value.strip().replace("\\", "/").rsplit("/", 1)[-1]
    name = re.sub(r"\.(?:mp4|webm|mp3|gif)$", "", name, flags=re.IGNORECASE)
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("._")[:80]
    return name or None


def _remaining(deadline: float) -> float:
    remaining = deadline - asyncio.get_running_loop().time()
    if remaining <= 0:
        raise DownloadFailure(
            f"This download took longer than {DOWNLOAD_TIMEOUT_MINUTES} minutes "
            "and was stopped. Try a shorter video."
        )
    return remaining


async def _run_process(args: list[str], deadline: float) -> tuple[int, bytes, bytes]:
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        start_new_session=True,
    )
    task = asyncio.create_task(proc.communicate())
    try:
        stdout, stderr = await asyncio.wait_for(
            asyncio.shield(task), timeout=_remaining(deadline)
        )
    except (asyncio.TimeoutError, asyncio.CancelledError) as exc:
        with suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGKILL)
        await task
        if isinstance(exc, asyncio.CancelledError):
            raise
        raise DownloadFailure(
            f"This download took longer than {DOWNLOAD_TIMEOUT_MINUTES} minutes "
            "and was stopped. Try a shorter video."
        ) from exc
    return proc.returncode or 0, stdout, stderr


def _klipy_media(payload: object, media_format: str) -> str | None:
    if not isinstance(payload, dict):
        return None
    data = payload.get("data")
    files = data.get("file") if isinstance(data, dict) else None
    if not isinstance(files, dict):
        return None

    formats = [media_format]
    if media_format == "mp3":
        formats.append("mp4")
    formats.extend(item for item in ("mp4", "gif", "webm") if item not in formats)
    for quality in ("hd", "md", "sm", "xs"):
        variants = files.get(quality)
        if not isinstance(variants, dict):
            continue
        for format_name in formats:
            item = variants.get(format_name)
            media_url = item.get("url") if isinstance(item, dict) else None
            if not isinstance(media_url, str):
                continue
            parsed = urlsplit(media_url)
            if parsed.scheme == "https" and parsed.hostname == "static.klipy.com":
                return media_url
    return None


async def _resolve_klipy(url: str, media_format: str) -> str:
    parsed = urlsplit(url)
    if (parsed.hostname or "").lower().removeprefix("www.") != "klipy.com":
        return url
    parts = parsed.path.strip("/").split("/")
    if (
        len(parts) != 2
        or parts[0].lower() != "gifs"
        or not re.fullmatch(r"[A-Za-z0-9_-]+", parts[1])
    ):
        raise DownloadFailure("That Klipy URL is not valid.")

    api_url = f"https://api.klipy.com/api/v1/gifs/{quote(parts[1], safe='')}"
    timeout = aiohttp.ClientTimeout(total=15)
    headers = {"User-Agent": "Mozilla/5.0 crygup-download/1.0"}
    try:
        async with aiohttp.ClientSession(timeout=timeout, headers=headers) as session:
            async with session.get(api_url, allow_redirects=False) as response:
                _validate_connected_peer(response)
                if response.status != 200:
                    raise DownloadFailure("Klipy could not provide that GIF.")
                direct_url = _klipy_media(
                    await response.json(content_type=None), media_format
                )
    except (aiohttp.ClientError, asyncio.TimeoutError, ValueError) as exc:
        raise DownloadFailure("Klipy could not provide that GIF.") from exc

    if not direct_url:
        raise DownloadFailure("Klipy did not provide a supported media file.")
    return await _validate_url(direct_url)


def _prepare_cookie_file(host: str, directory: Path) -> Path | None:
    filename = COOKIE_FILES.get(host)
    source = COOKIE_ROOT / filename if filename else None
    if source is None or not source.is_file():
        return None

    cookie_file = directory / ".yt-dlp-cookies.txt"
    try:
        shutil.copyfile(source, cookie_file)
        cookie_file.chmod(0o600)
    except OSError as exc:
        raise DownloadFailure(
            "Site cookies could not be prepared for this download."
        ) from exc
    return cookie_file


async def _download_media(job: DownloadJob) -> Path:
    deadline = asyncio.get_running_loop().time() + DOWNLOAD_TIMEOUT
    source_url = await _resolve_klipy(job.source_url, job.media_format)
    parsed = urlsplit(source_url)
    host = (parsed.hostname or "").lower()
    output_base = _safe_filename(job.requested_filename) or "%(title).80B"
    output_template = str(job.directory / f"{output_base}.%(ext)s")
    cookie_file = _prepare_cookie_file(host, job.directory)

    if job.media_format == "mp3":
        selector = "bestaudio/best"
    else:
        selector = "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best"

    # yt-dlp performs its own requests, including requests to redirected
    # media hosts.  Run it through a tiny resolver guard so every DNS lookup
    # rejects private, loopback, link-local, multicast, and reserved peers.
    # This closes the DNS-rebinding gap between the initial URL validation and
    # the extractor's later redirects without relying on a shell or a proxy.
    safe_runner = """
import ipaddress
import socket

def _public(value):
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return False
    return not (address.is_private or address.is_loopback or
                address.is_link_local or address.is_multicast or
                address.is_reserved or address.is_unspecified)

_getaddrinfo = socket.getaddrinfo
def _safe_getaddrinfo(*args, **kwargs):
    results = _getaddrinfo(*args, **kwargs)
    addresses = {str(item[4][0]) for item in results if item[4]}
    if not addresses or any(not _public(address) for address in addresses):
        raise socket.gaierror("private network address rejected")
    return results

socket.getaddrinfo = _safe_getaddrinfo
_gethostbyname = socket.gethostbyname
def _safe_gethostbyname(host):
    address = _gethostbyname(host)
    if not _public(address):
        raise socket.gaierror("private network address rejected")
    return address

socket.gethostbyname = _safe_gethostbyname
_gethostbyname_ex = socket.gethostbyname_ex
def _safe_gethostbyname_ex(host):
    result = _gethostbyname_ex(host)
    addresses = {str(address) for address in result[2]}
    if not addresses or any(not _public(address) for address in addresses):
        raise socket.gaierror("private network address rejected")
    return result

socket.gethostbyname_ex = _safe_gethostbyname_ex
from yt_dlp import main
main()
"""
    args = [
        sys.executable,
        "-c",
        safe_runner,
        "--format",
        selector,
        "--output",
        output_template,
        "--no-playlist",
        "--no-progress",
        "--no-warnings",
        "--restrict-filenames",
        "--max-filesize",
        str(MAX_FILE_BYTES),
        "--break-match-filters",
        "!is_live",
        "--socket-timeout",
        "20",
        "--retries",
        "2",
        "--fragment-retries",
        "2",
        "--concurrent-fragments",
        "2",
        "--print",
        "after_move:filepath",
        *(["--cookies", str(cookie_file)] if cookie_file is not None else []),
    ]

    if host not in {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"}:
        args.extend(
            [
                "--add-header",
                "User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
                "--add-header",
                "Accept-Language:en-US,en;q=0.9",
            ]
        )
    if host == "static.klipy.com":
        args.extend(["--extractor-args", "generic:impersonate"])

    if job.media_format == "mp3":
        args.extend(["--extract-audio", "--audio-format", "mp3"])
    elif job.media_format in {"mp4", "webm"}:
        args.extend(
            [
                "--merge-output-format",
                job.media_format,
                "--recode-video",
                job.media_format,
            ]
        )

    args.append(source_url)
    returncode, stdout, stderr = await _run_process(args, deadline)
    stderr_text = stderr.decode(errors="replace")
    if returncode != 0:
        logger.warning(
            "download_failed job=%s host=%s format=%s exit=%s",
            job.id[:8],
            host,
            job.media_format,
            returncode,
        )
        if "is_live" in stderr_text and "filter" in stderr_text:
            raise DownloadFailure(
                "Live streams cannot be downloaded. Please provide a recorded video or clip."
            )
        if "larger than max-filesize" in stderr_text.lower():
            raise DownloadFailure("That file exceeds the 500 MB download limit.")
        raise DownloadFailure(
            "The media could not be downloaded. It may be unavailable or the site may be blocking the request."
        )

    output_lines = [
        line.strip() for line in stdout.decode().splitlines() if line.strip()
    ]
    output = Path(output_lines[-1]) if output_lines else None
    if output is None or not output.is_file():
        candidates = [
            path
            for path in job.directory.iterdir()
            if path.is_file()
            and not path.name.startswith(".")
            and not path.name.endswith((".part", ".ytdl"))
        ]
        output = candidates[0] if len(candidates) == 1 else None
    if output is None or not output.is_file():
        raise DownloadFailure("The download finished without producing a media file.")
    if not output.resolve().is_relative_to(job.directory.resolve()):
        raise DownloadFailure("The downloader returned an unsafe output path.")

    if job.media_format == "gif" and output.suffix.lower() != ".gif":
        job.phase = "Converting video to GIF"
        duration = await _media_duration(output, deadline)
        if duration > GIF_MAX_DURATION:
            raise DownloadFailure(
                f"GIF conversion is limited to 30 seconds. This video is {duration:.0f} seconds."
            )
        converted = output.with_suffix(".gif")
        gif_filter = (
            "fps=10,scale=480:-1:flags=lanczos,split[s0][s1];"
            "[s0]palettegen=max_colors=128:stats_mode=diff[p];"
            "[s1][p]paletteuse=dither=bayer:bayer_scale=5"
        )
        returncode, _, _ = await _run_process(
            ["ffmpeg", "-i", str(output), "-vf", gif_filter, "-y", str(converted)],
            deadline,
        )
        if returncode != 0 or not converted.is_file():
            raise DownloadFailure("The video could not be converted to a GIF.")
        output.unlink(missing_ok=True)
        output = converted

    size = output.stat().st_size
    if size <= 0:
        raise DownloadFailure("The downloaded file was empty.")
    if size > MAX_FILE_BYTES:
        raise DownloadFailure("The finished file exceeds the 500 MB download limit.")
    return output


async def _media_duration(path: Path, deadline: float) -> float:
    returncode, stdout, _ = await _run_process(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        deadline,
    )
    if returncode == 0:
        with suppress(ValueError):
            return float(stdout.decode().strip())
    return 0.0


async def _expire_job(job_id: str) -> None:
    await asyncio.sleep(JOB_TTL)
    async with jobs_lock:
        job = jobs.pop(job_id, None)
    if job is not None:
        shutil.rmtree(job.directory, ignore_errors=True)


def _track_task(task: asyncio.Task[None]) -> None:
    job_tasks.add(task)
    task.add_done_callback(job_tasks.discard)


async def _run_job(job: DownloadJob) -> None:
    try:
        async with download_slots:
            job.status = "running"
            job.phase = "Downloading media"
            output = await _download_media(job)
            job.file_path = output
            job.filename = output.name
            job.size = output.stat().st_size
            job.phase = "Ready to download"
            job.status = "ready"
            logger.info(
                "download_ready job=%s host=%s format=%s bytes=%s",
                job.id[:8],
                urlsplit(job.source_url).hostname,
                job.media_format,
                job.size,
            )
    except DownloadFailure as exc:
        job.status = "failed"
        job.phase = "Download failed"
        job.error = str(exc)
        shutil.rmtree(job.directory, ignore_errors=True)
    except asyncio.CancelledError:
        shutil.rmtree(job.directory, ignore_errors=True)
        raise
    except Exception:
        logger.exception("download_unexpected_failure job=%s", job.id[:8])
        job.status = "failed"
        job.phase = "Download failed"
        job.error = "An unexpected error stopped the download. Please try again."
        shutil.rmtree(job.directory, ignore_errors=True)
    finally:
        if not shutting_down:
            _track_task(asyncio.create_task(_expire_job(job.id)))


@asynccontextmanager
async def lifespan(app: FastAPI):
    global shutting_down
    shutting_down = False
    DOWNLOAD_ROOT.mkdir(parents=True, exist_ok=True)
    for path in DOWNLOAD_ROOT.iterdir():
        if path.is_dir() and not path.is_symlink():
            shutil.rmtree(path, ignore_errors=True)
        else:
            path.unlink(missing_ok=True)
    yield
    shutting_down = True
    tasks = list(job_tasks)
    for task in tasks:
        task.cancel()
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
    for job in jobs.values():
        shutil.rmtree(job.directory, ignore_errors=True)
    jobs.clear()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["crygup.com", "www.crygup.com", "127.0.0.1", "localhost"],
)


@app.middleware("http")
async def protect_and_log(request: Request, call_next):
    if request.method == "POST":
        origin = request.headers.get("Origin")
        if origin and origin not in SAFE_ORIGINS:
            return Response(status_code=403)

    started = monotonic()
    try:
        response = await call_next(request)
    except Exception:
        logger.exception(
            "request method=%s path=%s status=500 duration_ms=%.1f client=%s",
            request.method,
            _log_path(request),
            (monotonic() - started) * 1000,
            _client_ip(request),
        )
        raise
    log_path = _log_path(request)
    if request.url.path.startswith("/jobs/"):
        response.headers["Cache-Control"] = "private, no-store"
    if request.url.path not in {"/health/live", "/health/ready"} and not (
        request.method == "GET" and log_path == "/jobs/{job_id}"
    ):
        logger.info(
            "request method=%s path=%s status=%s duration_ms=%.1f client=%s",
            request.method,
            log_path,
            response.status_code,
            (monotonic() - started) * 1000,
            _client_ip(request),
        )
    return response


@app.get("/health/live", include_in_schema=False)
@app.get("/health/ready", include_in_schema=False)
async def health() -> Response:
    return Response(status_code=204)


async def _owned_job(request: Request, job_id: str) -> DownloadJob:
    async with jobs_lock:
        job = jobs.get(job_id)
    if job is None or not secrets.compare_digest(job.owner, _client_ip(request)):
        raise HTTPException(404, "Download job not found")
    return job


@app.post("/jobs", status_code=202)
async def create_job(payload: DownloadRequest, request: Request):
    client = _client_ip(request)
    now = monotonic()
    try:
        source_url = await _validate_url(payload.url)
    except DownloadFailure as exc:
        raise HTTPException(400, str(exc)) from exc

    async with jobs_lock:
        history = rate_limits[client]
        while history and history[0] <= now - RATE_LIMIT_WINDOW:
            history.popleft()
        if len(history) >= RATE_LIMIT_JOBS:
            raise HTTPException(429, "Please wait before starting another download.")
        active_for_client = sum(
            job.owner == client and job.status in {"queued", "running"}
            for job in jobs.values()
        )
        if active_for_client >= MAX_JOBS_PER_CLIENT:
            raise HTTPException(429, "You already have two downloads in progress.")
        retained = sum(
            job.status in {"queued", "running", "ready"} for job in jobs.values()
        )
        if retained >= MAX_RETAINED_JOBS:
            raise HTTPException(
                503, "The downloader is at capacity. Please try again shortly."
            )

        history.append(now)
        job_id = secrets.token_urlsafe(24)
        job_dir = DOWNLOAD_ROOT / job_id
        job_dir.mkdir(mode=0o700)
        job = DownloadJob(
            id=job_id,
            owner=client,
            source_url=source_url,
            media_format=payload.format,
            requested_filename=_safe_filename(payload.filename),
            directory=job_dir,
            created_at=now,
        )
        jobs[job_id] = job

    _track_task(asyncio.create_task(_run_job(job), name=f"download-{job.id[:8]}"))
    logger.info(
        "download_created job=%s host=%s format=%s client=%s",
        job.id[:8],
        urlsplit(source_url).hostname,
        payload.format,
        client,
    )
    return {"id": job.id, "status": job.status, "phase": job.phase}


@app.get("/jobs/{job_id}")
async def get_job(job_id: str, request: Request):
    job = await _owned_job(request, job_id)
    response: dict[str, object] = {
        "id": job.id,
        "status": job.status,
        "phase": job.phase,
    }
    if job.error:
        response["error"] = job.error
    if job.status == "ready":
        response.update(
            {
                "filename": job.filename,
                "size": job.size,
                "download_url": f"/download-api/jobs/{job.id}/file",
            }
        )
    return response


@app.get("/jobs/{job_id}/file")
async def download_file(job_id: str, request: Request):
    job = await _owned_job(request, job_id)
    if job.status != "ready" or job.file_path is None or not job.file_path.is_file():
        raise HTTPException(409, "The download is not ready")
    media_type = (
        mimetypes.guess_type(job.filename or "")[0] or "application/octet-stream"
    )
    return FileResponse(
        job.file_path,
        filename=job.filename,
        media_type=media_type,
        headers={
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


if __name__ == "__main__":
    uvicorn.run(app, host=API_HOST, port=API_PORT)
