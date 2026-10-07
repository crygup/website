"""Private, read-only proxy for public Roblox API endpoints."""

from __future__ import annotations

import asyncio
import hmac
import os
import re
import time
from contextlib import asynccontextmanager
from urllib.parse import urljoin, urlsplit

import aiohttp
import uvicorn
from fastapi import FastAPI, HTTPException, Request, Response
from starlette.middleware.trustedhost import TrustedHostMiddleware

from logging_utils import get_logger

HOST = os.environ.get("WEBSITE_RAPI_HOST", "127.0.0.1")
PORT = int(os.environ.get("WEBSITE_RAPI_PORT", "8004"))
API_KEY = os.environ.get("WEBSITE_RAPI_KEY", "")
MAX_RESPONSE_BYTES = 10 * 1024 * 1024
SUBDOMAIN_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
REQUEST_HEADERS = {
    "accept",
    "accept-language",
    "if-modified-since",
    "if-none-match",
    "range",
}
RESPONSE_HEADERS = {
    "accept-ranges",
    "cache-control",
    "content-range",
    "content-type",
    "etag",
    "expires",
    "last-modified",
    "retry-after",
}

logger = get_logger("rapi")
request_slots = asyncio.Semaphore(20)


def _require_key(request: Request) -> None:
    if len(API_KEY) < 32:
        raise HTTPException(status_code=503, detail="The proxy is not configured.")
    supplied = request.headers.get("x-rapi-key", "")
    if not supplied or not hmac.compare_digest(supplied, API_KEY):
        raise HTTPException(status_code=401, detail="Invalid API key.")


def _target_url(request: Request) -> tuple[str, str]:
    raw_path = request.scope.get("raw_path", b"").decode("ascii", "strict")
    prefix = "/rapi/"
    if not raw_path.startswith(prefix):
        raise HTTPException(
            status_code=400, detail="A Roblox API subdomain is required."
        )

    remainder = raw_path[len(prefix) :]
    subdomain, separator, upstream_path = remainder.partition("/")
    subdomain = subdomain.lower()
    if not SUBDOMAIN_RE.fullmatch(subdomain):
        raise HTTPException(status_code=400, detail="Invalid Roblox API subdomain.")

    path = f"/{upstream_path}" if separator else "/"
    target = f"https://{subdomain}.roblox.com{path}"
    if request.scope.get("query_string"):
        target += "?" + request.scope["query_string"].decode("ascii", "strict")
    return target, subdomain


def _rewrite_redirect(location: str, target: str) -> str:
    redirect = urlsplit(urljoin(target, location))
    host = (redirect.hostname or "").lower()
    if redirect.scheme != "https" or not host.endswith(".roblox.com"):
        raise HTTPException(
            status_code=502, detail="Roblox returned an unsafe redirect."
        )

    subdomain = host.removesuffix(".roblox.com")
    if not SUBDOMAIN_RE.fullmatch(subdomain):
        raise HTTPException(
            status_code=502, detail="Roblox returned an unsafe redirect."
        )

    path = redirect.path or "/"
    rewritten = f"/rapi/{subdomain}{path}"
    if redirect.query:
        rewritten += f"?{redirect.query}"
    return rewritten


async def _response_body(upstream: aiohttp.ClientResponse) -> bytes:
    length = upstream.content_length
    if length is not None and length > MAX_RESPONSE_BYTES:
        raise HTTPException(status_code=502, detail="Roblox response is too large.")

    body = bytearray()
    async for chunk in upstream.content.iter_chunked(64 * 1024):
        body.extend(chunk)
        if len(body) > MAX_RESPONSE_BYTES:
            raise HTTPException(status_code=502, detail="Roblox response is too large.")
    return bytes(body)


@asynccontextmanager
async def lifespan(app: FastAPI):
    timeout = aiohttp.ClientTimeout(total=20, connect=5, sock_read=15)
    connector = aiohttp.TCPConnector(limit=20, ttl_dns_cache=300)
    async with aiohttp.ClientSession(
        timeout=timeout,
        connector=connector,
        headers={"User-Agent": "crygup-rapi/1.0"},
    ) as session:
        app.state.session = session
        yield


app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["crygup.com", "www.crygup.com", "127.0.0.1", "localhost"],
)


@app.get("/health/live", status_code=204)
async def live() -> Response:
    return Response(status_code=204)


@app.get("/health/ready")
async def ready() -> Response:
    return Response(status_code=204 if len(API_KEY) >= 32 else 503)


@app.api_route("/rapi", methods=["GET", "HEAD"])
async def missing_target(request: Request) -> Response:
    _require_key(request)
    raise HTTPException(
        status_code=400,
        detail="Use /rapi/<subdomain>/<Roblox API path>.",
    )


@app.api_route("/rapi/{target_path:path}", methods=["GET", "HEAD"])
async def proxy(request: Request, target_path: str) -> Response:
    del target_path  # The raw ASGI path is used so encoded paths stay intact.
    _require_key(request)
    try:
        target, subdomain = _target_url(request)
    except UnicodeDecodeError as error:
        raise HTTPException(status_code=400, detail="Invalid request path.") from error

    request_headers = {
        name: value
        for name, value in request.headers.items()
        if name.lower() in REQUEST_HEADERS
    }
    started = time.monotonic()
    try:
        async with request_slots:
            session: aiohttp.ClientSession = request.app.state.session
            async with session.request(
                request.method,
                target,
                headers=request_headers,
                allow_redirects=False,
            ) as upstream:
                response_headers = {
                    name: value
                    for name, value in upstream.headers.items()
                    if name.lower() in RESPONSE_HEADERS
                    or name.lower().startswith("x-ratelimit-")
                }
                if "Location" in upstream.headers:
                    response_headers["Location"] = _rewrite_redirect(
                        upstream.headers["Location"], target
                    )
                # Prevent an intermediary cache from serving a response without
                # checking this service's private request key.
                response_headers["Cache-Control"] = "private, no-store"
                body = (
                    b"" if request.method == "HEAD" else await _response_body(upstream)
                )
                status = upstream.status
    except HTTPException:
        raise
    except asyncio.TimeoutError as error:
        raise HTTPException(
            status_code=504, detail="Roblox did not respond in time."
        ) from error
    except aiohttp.ClientError as error:
        logger.warning(
            "Roblox request failed service=%s error_type=%s",
            subdomain,
            type(error).__name__,
        )
        raise HTTPException(status_code=502, detail="Roblox request failed.") from error

    logger.info(
        "Roblox request service=%s status=%d duration_ms=%d",
        subdomain,
        status,
        round((time.monotonic() - started) * 1000),
    )
    return Response(content=body, status_code=status, headers=response_headers)


if __name__ == "__main__":
    uvicorn.run(
        app,
        host=HOST,
        port=PORT,
        proxy_headers=False,
        server_header=False,
        access_log=False,
    )
