"""
Fishie bot API | commands, stats, OAuth, and user data history.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import hmac
import ipaddress
import json
import os
import re
import secrets
import time
from collections import deque
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import TYPE_CHECKING, Any, cast
from urllib.parse import parse_qs, urlencode, urlsplit

import aiohttp
from fastapi import (
    Body,
    Cookie,
    FastAPI,
    Header,
    HTTPException,
    Query,
    Request,
    Response,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from server.logging_utils import get_logger

if TYPE_CHECKING:
    from core import Fishie

app = FastAPI(title="Fishie API")
logger = get_logger("api")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://crygup.com", "https://www.crygup.com"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    started = time.perf_counter()
    client = request.client.host if request.client else "-"
    try:
        response = await call_next(request)
    except Exception:
        logger.exception(
            "request method=%s path=%s status=500 duration_ms=%.1f client=%s",
            request.method,
            request.url.path,
            (time.perf_counter() - started) * 1000,
            client,
        )
        raise
    logger.info(
        "request method=%s path=%s status=%s duration_ms=%.1f client=%s",
        request.method,
        request.url.path,
        response.status_code,
        (time.perf_counter() - started) * 1000,
        client,
    )
    return response


bot_ref: "Fishie | None" = None
TABLE_MAP = {
    "avatars": "avatars",
    "username_logs": "username_logs",
    "display_name_logs": "display_name_logs",
    "discrim_logs": "discrim_logs",
    "nickname_logs": "nickname_logs",
    "guild_icons": "guild_icons",
    "guild_name_logs": "guild_name_logs",
}
GUILD_TABLES = {"guild_icons", "guild_name_logs"}
LASTFM_CALLBACK_URL = "https://crygup.com/fishie"
LASTFM_API_URL = "https://ws.audioscrobbler.com/2.0/"
LASTFM_STATE_TTL = 10 * 60
LASTFM_STATE_COOKIE = "__Host-fishie_lastfm_state"
MESSAGE_CHALLENGE_COOKIE = "__Host-fishie_message_challenge"
MESSAGE_CHALLENGE_MAX_AGE = 10 * 60
WEB_ORIGINS = frozenset({"https://crygup.com", "https://www.crygup.com"})
SESSION_COOKIE = "__Host-fishie_session"
OAUTH_STATE_COOKIE = "__Host-fishie_oauth_state"
STEAM_STATE_COOKIE = "__Host-fishie_steam_state"
SPOTIFY_STATE_COOKIE = "__Host-fishie_spotify_state"
ANILIST_STATE_COOKIE = "__Host-fishie_anilist_state"
SESSION_MAX_AGE = 7 * 24 * 60 * 60
OAUTH_STATE_MAX_AGE = 10 * 60
DISCORD_ATTACHMENT_HOSTS = frozenset(
    {
        "cdn.discordapp.com",
        "media.discordapp.net",
        "images-ext-1.discordapp.net",
        "images-ext-2.discordapp.net",
    }
)
LASTFM_ACCOUNT_FIELDS = (
    "lastfm",
    "steam",
    "roblox",
    "letterboxd",
    "anilist",
)
STEAM_CALLBACK_URL = "https://crygup.com/fishie"
STEAM_OPENID_URL = "https://steamcommunity.com/openid/login"
STEAM_STATE_TTL = 10 * 60
SPOTIFY_CALLBACK_URL = "https://crygup.com/fishie"
SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"
SPOTIFY_STATE_TTL = 10 * 60
ANILIST_CALLBACK_URL = "https://crygup.com/fishie"
ANILIST_TOKEN_URL = "https://anilist.co/api/v2/oauth/token"
ANILIST_GRAPHQL_URL = "https://graphql.anilist.co"
ANILIST_STATE_TTL = 10 * 60

_legacy_lastfm_states_used: dict[str, float] = {}
_spotify_cover_cache: dict[tuple[str, str], tuple[float, str]] = {}
_spotify_cover_negative_cache: dict[tuple[str, str], float] = {}
_spotify_cover_rate: dict[str, list[float]] = {}
_spotify_cover_semaphore = asyncio.Semaphore(4)
_spotify_cover_token_lock = asyncio.Lock()
_message_global_requests: deque[float] = deque()
_message_rate_lock = asyncio.Lock()
_message_used_challenges: dict[str, float] = {}
_message_rate_limit: dict[str, float] = {}
SPOTIFY_COVER_RATE_LIMIT = 30
SPOTIFY_COVER_RATE_WINDOW = 60
MESSAGE_GLOBAL_RATE_LIMIT = 60
MESSAGE_GLOBAL_RATE_WINDOW = 60


@app.middleware("http")
async def protect_cookie_requests(request: Request, call_next):
    """Reject cross-origin state changes authenticated by the session cookie.

    CORS is not a CSRF defense: a browser still sends an HttpOnly cookie on a
    credentialed cross-origin request.  The website is the only allowed caller
    for cookie-authenticated mutations, while bearer-token API clients remain
    usable from non-browser integrations.
    """

    if request.method not in {"GET", "HEAD", "OPTIONS"} and request.cookies.get(
        SESSION_COOKIE
    ):
        if request.headers.get("origin") not in WEB_ORIGINS:
            return JSONResponse(
                status_code=403,
                content={"detail": "Invalid request origin"},
            )
    return await call_next(request)


def _validate_discord_avatar_url(value: str) -> None:
    """Reject avatar URLs that could turn the webhook into an SSRF proxy."""
    parsed = urlsplit(value)
    hostname = (parsed.hostname or "").casefold().rstrip(".")
    if parsed.scheme != "https" or hostname not in DISCORD_ATTACHMENT_HOSTS:
        raise HTTPException(400, "Avatar URLs must use the Discord CDN")
    if parsed.username is not None or parsed.password is not None:
        raise HTTPException(400, "Avatar URLs cannot include credentials")
    try:
        if parsed.port not in (None, 443):
            raise HTTPException(400, "Avatar URLs must use HTTPS")
    except ValueError as error:
        raise HTTPException(400, "Invalid avatar URL") from error


def _session_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _lastfm_state(
    user_id: int,
    source: str,
    *,
    session_id: str | None = None,
    browser_nonce: str | None = None,
) -> str:
    """Create a one-time state bound to the requesting browser session."""
    if not bot_ref:
        raise HTTPException(503, "Bot not ready")
    now = int(time.time())
    states = getattr(bot_ref, "_lastfm_oauth_states", None)
    if states is None:
        states = bot_ref._lastfm_oauth_states = {}
    for token, state_data in list(states.items()):
        if int(state_data.get("expires", 0)) < now:
            states.pop(token, None)
    token = secrets.token_urlsafe(32)
    state_data: dict[str, int | str] = {
        "user_id": int(user_id),
        "source": source,
        "expires": now + LASTFM_STATE_TTL,
    }
    if session_id:
        state_data["session_hash"] = _session_hash(session_id)
    if browser_nonce:
        state_data["browser_nonce_hash"] = _session_hash(browser_nonce)
    states[token] = state_data
    return f"lastfm_{token}"


def _lastfm_authorization_url(
    user_id: int,
    source: str,
    *,
    session_id: str | None = None,
    browser_nonce: str | None = None,
) -> str:
    if not bot_ref:
        raise HTTPException(503, "Bot not ready")
    state = _lastfm_state(
        user_id,
        source,
        session_id=session_id,
        browser_nonce=browser_nonce,
    )
    callback = f"{LASTFM_CALLBACK_URL}?{urlencode({'lastfm_state': state})}"
    return "https://www.last.fm/api/auth/?" + urlencode(
        {"api_key": bot_ref.config["keys"]["lastfm_cb"], "cb": callback}
    )


def _steam_state(
    user_id: int,
    source: str,
    channel_id: int | None = None,
    message_id: int | None = None,
    *,
    session_id: str | None = None,
    browser_nonce: str | None = None,
) -> str:
    if not bot_ref:
        raise HTTPException(503, "Bot not ready")
    now = int(time.time())
    states = getattr(bot_ref, "_steam_oauth_states", None)
    if states is None:
        states = bot_ref._steam_oauth_states = {}
    for token, state_data in list(states.items()):
        if int(state_data.get("expires", 0)) < now:
            states.pop(token, None)
    token = secrets.token_urlsafe(24)
    state_data: dict[str, int | str] = {
        "user_id": int(user_id),
        "source": source,
        "expires": now + STEAM_STATE_TTL,
    }
    if session_id:
        state_data["session_hash"] = _session_hash(session_id)
    if browser_nonce:
        state_data["browser_nonce_hash"] = _session_hash(browser_nonce)
    if channel_id is not None and message_id is not None:
        state_data["channel_id"] = int(channel_id)
        state_data["message_id"] = int(message_id)
    states[token] = state_data
    return token


def _steam_authorization_url(
    user_id: int,
    source: str,
    *,
    session_id: str | None = None,
    browser_nonce: str | None = None,
) -> str:
    state = _steam_state(
        user_id,
        source,
        session_id=session_id,
        browser_nonce=browser_nonce,
    )
    callback = f"{STEAM_CALLBACK_URL}?{urlencode({'steam_state': state})}"
    return (
        STEAM_OPENID_URL
        + "?"
        + urlencode(
            {
                "openid.ns": "http://specs.openid.net/auth/2.0",
                "openid.mode": "checkid_setup",
                "openid.return_to": callback,
                "openid.realm": "https://crygup.com/",
                "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
                "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
            }
        )
    )


def _decode_steam_state(
    state: str,
    *,
    session_id: str | None = None,
    browser_nonce: str | None = None,
) -> tuple[int, str, int | None, int | None]:
    if not bot_ref:
        raise HTTPException(503, "Bot not ready")
    states = getattr(bot_ref, "_steam_oauth_states", None) or {}
    payload = states.get(state)
    if not isinstance(payload, dict):
        raise HTTPException(400, "Invalid Steam connection state")
    try:
        user_id = int(payload["user_id"])
        source = payload["source"]
        expires = int(payload["expires"])
        expected_session = payload.get("session_hash")
        expected_nonce = payload.get("browser_nonce_hash")
        channel_id = int(payload["channel_id"]) if payload.get("channel_id") else None
        message_id = int(payload["message_id"]) if payload.get("message_id") else None
    except (KeyError, TypeError, ValueError):
        raise HTTPException(400, "Invalid Steam connection state")
    if source not in {"discord", "website"}:
        raise HTTPException(400, "Invalid Steam connection source")
    if expires < int(time.time()):
        raise HTTPException(400, "The Steam connection link has expired")
    if source == "website":
        if not expected_session or not session_id or not hmac.compare_digest(
            str(expected_session), _session_hash(session_id)
        ):
            raise HTTPException(400, "Invalid Steam browser session")
        if not expected_nonce or not browser_nonce or not hmac.compare_digest(
            str(expected_nonce), _session_hash(browser_nonce)
        ):
            raise HTTPException(400, "Invalid Steam browser state")
    if (channel_id is None) != (message_id is None):
        raise HTTPException(400, "Invalid Discord message state")
    states.pop(state, None)
    return user_id, source, channel_id, message_id


def _spotify_state(
    user_id: int,
    source: str,
    channel_id: int | None = None,
    message_id: int | None = None,
    *,
    session_id: str | None = None,
    browser_nonce: str | None = None,
) -> str:
    if not bot_ref:
        raise HTTPException(503, "Bot not ready")
    now = int(time.time())
    states = getattr(bot_ref, "_spotify_oauth_states", None)
    if states is None:
        states = bot_ref._spotify_oauth_states = {}
    for token, state_data in list(states.items()):
        if int(state_data.get("expires", 0)) < now:
            states.pop(token, None)
    token = secrets.token_urlsafe(24)
    state_data: dict[str, int | str] = {
        "user_id": int(user_id),
        "source": source,
        "expires": now + SPOTIFY_STATE_TTL,
    }
    if session_id:
        state_data["session_hash"] = _session_hash(session_id)
    if browser_nonce:
        state_data["browser_nonce_hash"] = _session_hash(browser_nonce)
    if channel_id is not None and message_id is not None:
        state_data["channel_id"] = int(channel_id)
        state_data["message_id"] = int(message_id)
    states[token] = state_data
    return token


def _spotify_authorization_url(
    user_id: int,
    source: str,
    *,
    session_id: str | None = None,
    browser_nonce: str | None = None,
) -> str:
    if not bot_ref:
        raise HTTPException(503, "Bot not ready")
    state = _spotify_state(
        user_id,
        source,
        session_id=session_id,
        browser_nonce=browser_nonce,
    )
    return "https://accounts.spotify.com/authorize?" + urlencode(
        {
            "client_id": bot_ref.config["keys"]["spotify_id"],
            "response_type": "code",
            "redirect_uri": SPOTIFY_CALLBACK_URL,
            "scope": "user-read-private",
            "state": f"spotify_{state}",
        }
    )


def _decode_spotify_state(
    state: str,
    *,
    session_id: str | None = None,
    browser_nonce: str | None = None,
) -> tuple[int, str, int | None, int | None]:
    if not bot_ref or not state.startswith("spotify_"):
        raise HTTPException(400, "Invalid Spotify connection state")
    states = getattr(bot_ref, "_spotify_oauth_states", None) or {}
    state_key = state.removeprefix("spotify_")
    payload = states.get(state_key)
    if not isinstance(payload, dict):
        raise HTTPException(400, "Invalid Spotify connection state")
    try:
        user_id = int(payload["user_id"])
        source = payload["source"]
        expires = int(payload["expires"])
        expected_session = payload.get("session_hash")
        expected_nonce = payload.get("browser_nonce_hash")
        channel_id = int(payload["channel_id"]) if payload.get("channel_id") else None
        message_id = int(payload["message_id"]) if payload.get("message_id") else None
    except (KeyError, TypeError, ValueError):
        raise HTTPException(400, "Invalid Spotify connection state")
    if source not in {"discord", "website"}:
        raise HTTPException(400, "Invalid Spotify connection source")
    if expires < int(time.time()):
        raise HTTPException(400, "The Spotify connection link has expired")
    if source == "website":
        if not expected_session or not session_id or not hmac.compare_digest(
            str(expected_session), _session_hash(session_id)
        ):
            raise HTTPException(400, "Invalid Spotify browser session")
        if not expected_nonce or not browser_nonce or not hmac.compare_digest(
            str(expected_nonce), _session_hash(browser_nonce)
        ):
            raise HTTPException(400, "Invalid Spotify browser state")
    if (channel_id is None) != (message_id is None):
        raise HTTPException(400, "Invalid Discord message state")
    states.pop(state_key, None)
    return user_id, source, channel_id, message_id


def _anilist_state(
    user_id: int,
    source: str,
    channel_id: int | None = None,
    message_id: int | None = None,
    *,
    session_id: str | None = None,
    browser_nonce: str | None = None,
) -> str:
    if not bot_ref:
        raise HTTPException(503, "Bot not ready")
    now = int(time.time())
    states = getattr(bot_ref, "_anilist_oauth_states", None)
    if states is None:
        states = bot_ref._anilist_oauth_states = {}
    for token, state_data in list(states.items()):
        if int(state_data.get("expires", 0)) < now:
            states.pop(token, None)
    token = secrets.token_urlsafe(24)
    state_data: dict[str, int | str] = {
        "user_id": int(user_id),
        "source": source,
        "expires": now + ANILIST_STATE_TTL,
    }
    if session_id:
        state_data["session_hash"] = _session_hash(session_id)
    if browser_nonce:
        state_data["browser_nonce_hash"] = _session_hash(browser_nonce)
    if channel_id is not None and message_id is not None:
        state_data["channel_id"] = int(channel_id)
        state_data["message_id"] = int(message_id)
    states[token] = state_data
    return token


def _anilist_authorization_url(
    user_id: int,
    source: str,
    *,
    session_id: str | None = None,
    browser_nonce: str | None = None,
) -> str:
    if not bot_ref:
        raise HTTPException(503, "Bot not ready")
    state = _anilist_state(
        user_id,
        source,
        session_id=session_id,
        browser_nonce=browser_nonce,
    )
    return "https://anilist.co/api/v2/oauth/authorize?" + urlencode(
        {
            "client_id": bot_ref.config["keys"]["anilist_id"],
            "redirect_uri": ANILIST_CALLBACK_URL,
            "response_type": "code",
            "state": f"anilist_{state}",
        }
    )


def _decode_anilist_state(
    state: str,
    *,
    session_id: str | None = None,
    browser_nonce: str | None = None,
) -> tuple[int, str, int | None, int | None]:
    if not bot_ref or not state.startswith("anilist_"):
        raise HTTPException(400, "Invalid AniList connection state")
    states = getattr(bot_ref, "_anilist_oauth_states", None) or {}
    state_key = state.removeprefix("anilist_")
    payload = states.get(state_key)
    if not isinstance(payload, dict):
        raise HTTPException(400, "Invalid AniList connection state")
    try:
        user_id = int(payload["user_id"])
        source = payload["source"]
        expires = int(payload["expires"])
        expected_session = payload.get("session_hash")
        expected_nonce = payload.get("browser_nonce_hash")
        channel_id = int(payload["channel_id"]) if payload.get("channel_id") else None
        message_id = int(payload["message_id"]) if payload.get("message_id") else None
    except (KeyError, TypeError, ValueError):
        raise HTTPException(400, "Invalid AniList connection state")
    if source not in {"discord", "website"}:
        raise HTTPException(400, "Invalid AniList connection source")
    if expires < int(time.time()):
        raise HTTPException(400, "The AniList connection link has expired")
    if source == "website":
        if not expected_session or not session_id or not hmac.compare_digest(
            str(expected_session), _session_hash(session_id)
        ):
            raise HTTPException(400, "Invalid AniList browser session")
        if not expected_nonce or not browser_nonce or not hmac.compare_digest(
            str(expected_nonce), _session_hash(browser_nonce)
        ):
            raise HTTPException(400, "Invalid AniList browser state")
    states.pop(state_key, None)
    if (channel_id is None) != (message_id is None):
        raise HTTPException(400, "Invalid Discord message state")
    return user_id, source, channel_id, message_id


def _decode_lastfm_state(
    state: str,
    *,
    session_id: str | None = None,
    browser_nonce: str | None = None,
) -> tuple[int, str, int | None, int | None]:
    if not bot_ref:
        raise HTTPException(503, "Bot not ready")

    if state.startswith("lastfm_"):
        states = getattr(bot_ref, "_lastfm_oauth_states", None) or {}
        state_key = state.removeprefix("lastfm_")
        # Do not consume a valid state until all browser/session checks pass.
        # Otherwise a forged callback with a stolen state but the wrong cookie
        # could invalidate the legitimate OAuth redirect (a denial of service).
        payload = states.get(state_key)
        if not isinstance(payload, dict):
            raise HTTPException(400, "Invalid Last.fm connection state")
        try:
            user_id = int(payload["user_id"])
            source = payload["source"]
            expires = int(payload["expires"])
            expected_session = payload.get("session_hash")
            expected_nonce = payload.get("browser_nonce_hash")
            channel_id = (
                int(payload["channel_id"]) if payload.get("channel_id") else None
            )
            message_id = (
                int(payload["message_id"]) if payload.get("message_id") else None
            )
        except (KeyError, TypeError, ValueError):
            raise HTTPException(400, "Invalid Last.fm connection state")
        if source not in {"discord", "website"}:
            raise HTTPException(400, "Invalid Last.fm connection source")
        if expires < int(time.time()):
            raise HTTPException(400, "The Last.fm connection link has expired")
        if expected_session and (
            not session_id
            or not hmac.compare_digest(str(expected_session), _session_hash(session_id))
        ):
            raise HTTPException(400, "Invalid Last.fm browser session")
        if expected_nonce and (
            not browser_nonce
            or not hmac.compare_digest(
                str(expected_nonce), _session_hash(browser_nonce)
            )
        ):
            raise HTTPException(400, "Invalid Last.fm browser state")
        if (channel_id is None) != (message_id is None):
            raise HTTPException(400, "Invalid Discord message state")
        states.pop(state_key, None)
        return user_id, source, channel_id, message_id

    legacy_key = hashlib.sha256(state.encode("utf-8")).hexdigest()
    now = time.time()
    for key, expires in list(_legacy_lastfm_states_used.items()):
        if expires <= now:
            _legacy_lastfm_states_used.pop(key, None)
    if legacy_key in _legacy_lastfm_states_used:
        raise HTTPException(400, "Invalid or already used Last.fm connection state")
    try:
        encoded, supplied_signature = state.split(".", 1)
        expected_signature = hmac.new(
            bot_ref.config["keys"]["lastfm_secret"].encode(),
            encoded.encode(),
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(supplied_signature, expected_signature):
            raise ValueError("invalid signature")
        padding = "=" * (-len(encoded) % 4)
        payload = json.loads(base64.urlsafe_b64decode(encoded + padding))
        user_id = int(payload["user_id"])
        source = payload["source"]
        expires = int(payload["expires"])
        channel_id = int(payload["channel_id"]) if payload.get("channel_id") else None
        message_id = int(payload["message_id"]) if payload.get("message_id") else None
    except (
        binascii.Error,
        KeyError,
        TypeError,
        ValueError,
        json.JSONDecodeError,
    ):
        raise HTTPException(400, "Invalid Last.fm connection state")
    if source not in {"discord", "website"}:
        raise HTTPException(400, "Invalid Last.fm connection source")
    if expires < int(time.time()):
        raise HTTPException(400, "The Last.fm connection link has expired")
    if (channel_id is None) != (message_id is None):
        raise HTTPException(400, "Invalid Discord message state")
    _legacy_lastfm_states_used[legacy_key] = now + LASTFM_STATE_TTL
    return user_id, source, channel_id, message_id


def _lastfm_api_signature(api_key: str, token: str, secret: str) -> str:
    signature = f"api_key{api_key}methodauth.getSessiontoken{token}{secret}"
    return hashlib.md5(signature.encode()).hexdigest()


async def _steam_display_name(steam_id: str) -> str | None:
    if not bot_ref:
        return None
    api_key = bot_ref.config["keys"].get("steam")
    if not api_key:
        return None
    try:
        async with bot_ref.session.get(
            "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/",
            params={"key": api_key, "steamids": steam_id, "format": "json"},
        ) as response:
            profile = await response.json(content_type=None)
        response_data = profile.get("response") if isinstance(profile, dict) else None
        players = (
            response_data.get("players", []) if isinstance(response_data, dict) else []
        )
        if isinstance(players, list) and players and isinstance(players[0], dict):
            name = players[0].get("personaname")
            return str(name) if name else None
    except (aiohttp.ClientError, ValueError, TypeError):
        pass
    return None


async def _refresh_discord_accounts_message(
    user_id: int, channel_id: int | None, message_id: int | None
) -> None:
    if not bot_ref or channel_id is None or message_id is None:
        return
    try:
        from extensions.settings import ManageAccountsView

        channel: Any = bot_ref.get_channel(channel_id)
        if channel is None:
            channel = await bot_ref.fetch_channel(channel_id)
        message = await channel.fetch_message(message_id)
        row = await bot_ref.pool.fetchrow(
            "SELECT lastfm, steam, roblox, letterboxd, anilist FROM accounts "
            "WHERE user_id = $1",
            user_id,
        )
        author = bot_ref.get_user(user_id) or SimpleNamespace(id=user_id)
        ctx = SimpleNamespace(bot=bot_ref, author=author)
        await message.edit(
            view=ManageAccountsView(
                cast(Any, ctx),
                row=row,
                lastfm_connected=bool(row and row["lastfm"]),
                steam_connected=bool(row and row["steam"]),
                anilist_connected=bool(row and row["anilist"]),
            ),
        )
    except Exception as error:
        bot_ref.logger.warning(
            "Could not refresh Discord accounts message after account OAuth: %s",
            error,
        )


def _schedule_discord_accounts_refresh(
    user_id: int, channel_id: int | None, message_id: int | None
) -> None:
    if not bot_ref or channel_id is None or message_id is None:
        return
    tasks = getattr(bot_ref, "_oauth_refresh_tasks", None)
    if tasks is None:
        tasks = set()
        setattr(bot_ref, "_oauth_refresh_tasks", tasks)
    task = asyncio.create_task(
        _refresh_discord_accounts_message(user_id, channel_id, message_id)
    )
    tasks.add(task)
    task.add_done_callback(tasks.discard)


def init(bot: "Fishie") -> None:
    global bot_ref
    bot_ref = bot


def _check_pool():
    if not bot_ref:
        raise HTTPException(503, "Bot not ready")
    pool = bot_ref.pool
    if not pool:
        raise HTTPException(503, "Database not connected")
    return pool


def _active_application_id() -> int:
    """Return the OAuth application ID for the running bot instance."""
    if bot_ref is None:
        raise HTTPException(503, "Bot not ready")
    application_id = getattr(bot_ref, "active_application_id", None)
    if application_id is None:
        application_id = getattr(bot_ref, "active_bot_id", None)
    if application_id is None:
        application_id = bot_ref.config.get("ids", {}).get("bot_id")
    try:
        return int(application_id)
    except (TypeError, ValueError) as error:
        raise HTTPException(503, "Bot application ID is not configured") from error


def _active_client_secret() -> str:
    """Return the OAuth client secret without exposing it to callers."""
    if bot_ref is None:
        raise HTTPException(503, "Bot not ready")
    secret = getattr(bot_ref, "oauth_client_secret", None)
    if not secret:
        secret = bot_ref.config.get("keys", {}).get("client_secret")
    if not isinstance(secret, str) or not secret:
        raise HTTPException(503, "Bot client secret is not configured")
    return secret


async def _create_web_session(
    user_id: int, discord_access_token: str, expires_in: int | None
) -> tuple[str, int]:
    """Persist an opaque browser session; the Discord token stays server-side."""
    pool = _check_pool()
    try:
        lifetime = int(expires_in or SESSION_MAX_AGE)
    except (TypeError, ValueError):
        lifetime = SESSION_MAX_AGE
    lifetime = max(60, min(lifetime, SESSION_MAX_AGE))
    session_id = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=lifetime)
    await pool.execute("DELETE FROM web_sessions WHERE expires_at <= now()")
    await pool.execute(
        """INSERT INTO web_sessions
           (session_id_hash, user_id, discord_access_token, expires_at)
           VALUES ($1, $2, $3, $4)""",
        _session_hash(session_id),
        user_id,
        discord_access_token,
        expires_at,
    )
    return session_id, lifetime


async def _check_opted_out(user_id: int) -> bool:
    pool = _check_pool()
    r = await pool.fetchval(
        "SELECT 1 FROM opted_out WHERE user_id = $1 AND cardinality(items) > 0", user_id
    )
    return r is not None


VALID_OPTOUTS = {
    "avatar",
    "username",
    "display",
    "nickname",
    "discrim",
    "joins",
    "stag",
    "xp",
    "commands",
    "status",
    "activity",
    "pokemon",
    "corn",
    "emoji",
    "downloads",
    "reactions",
    "games",
    "currency",
    "snipe",
}


@app.get("/user/{user_id}/opted-out")
async def get_opted_out(
    user_id: int,
    authorization: str | None = Header(None),
    session_id: str | None = Cookie(None, alias=SESSION_COOKIE),
):
    """Get the list of tracking methods for the authenticated user."""
    me = await _verify_token(authorization, session_id)
    if int(me["id"]) != user_id:
        raise HTTPException(403, "You can only view your own settings")
    pool = _check_pool()
    row = await pool.fetchrow("SELECT items FROM opted_out WHERE user_id = $1", user_id)
    items = list(row["items"] if row else [])
    settings = await pool.fetchrow(
        "SELECT game_tracking_enabled, currency_tracking_enabled FROM user_settings WHERE user_id = $1",
        user_id,
    )
    if settings and settings.get("game_tracking_enabled") is False:
        items.append("games")
    if settings and settings.get("currency_tracking_enabled") is False:
        items.append("currency")
    reaction = await pool.fetchval(
        "SELECT enabled FROM reaction_tracking WHERE user_id = $1", user_id
    )
    if reaction is not True:
        items.append("reactions")
    return {"items": items}


@app.post("/user/{user_id}/opted-out")
async def set_opted_out(
    user_id: int,
    payload: dict = Body(...),
    authorization: str | None = Header(None),
    session_id: str | None = Cookie(None, alias=SESSION_COOKIE),
):
    """Set the opted-out tracking methods for the authenticated user."""
    me = await _verify_token(authorization, session_id)
    if int(me["id"]) != user_id:
        raise HTTPException(403, "You can only manage your own settings")

    items = [i for i in payload.get("items", []) if i in VALID_OPTOUTS]
    ordinary = [i for i in items if i not in {"games", "currency", "reactions"}]
    pool = _check_pool()
    await pool.execute(
        "INSERT INTO opted_out (user_id, items) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET items = $2",
        user_id,
        ordinary,
    )
    await pool.execute(
        "INSERT INTO user_settings (user_id, game_tracking_enabled, currency_tracking_enabled) "
        "VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET "
        "game_tracking_enabled = EXCLUDED.game_tracking_enabled, "
        "currency_tracking_enabled = EXCLUDED.currency_tracking_enabled",
        user_id,
        "games" not in items,
        "currency" not in items,
    )
    await pool.execute(
        "INSERT INTO reaction_tracking (user_id, enabled) VALUES ($1, $2) "
        "ON CONFLICT (user_id) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()",
        user_id,
        "reactions" not in items,
    )

    if bot_ref:
        if ordinary:
            bot_ref.db_cache.opted_out[user_id] = ordinary
        else:
            bot_ref.db_cache.opted_out.pop(user_id, None)
        bot_ref.db_cache.set_game_tracking_enabled(user_id, "games" not in items)
        bot_ref.db_cache.set_currency_tracking_enabled(user_id, "currency" not in items)
        if "reactions" in items:
            bot_ref.db_cache.disable_reaction_tracking(user_id)
        else:
            bot_ref.db_cache.enable_reaction_tracking(user_id)

    return {"items": items}


@app.get("/user/{user_id}/privacy-settings")
async def get_user_privacy_settings(
    user_id: int,
    authorization: str | None = Header(None),
    session_id: str | None = Cookie(None, alias=SESSION_COOKIE),
):
    """Return global tracking/history settings for the dashboard."""
    me = await _verify_token(authorization, session_id)
    if int(me["id"]) != user_id:
        raise HTTPException(403, "You can only view your own settings")
    row = await _check_pool().fetchrow(
        "SELECT tracking_enabled, history_public, game_tracking_enabled, "
        "game_history_public, currency_tracking_enabled FROM user_settings WHERE user_id = $1",
        user_id,
    )
    return {
        "tracking_enabled": row["tracking_enabled"] if row else True,
        "history_public": row["history_public"] if row else False,
        "game_tracking_enabled": row["game_tracking_enabled"] if row else True,
        "game_history_public": row["game_history_public"] if row else True,
        "currency_tracking_enabled": row["currency_tracking_enabled"] if row else True,
    }


@app.post("/user/{user_id}/privacy-settings")
async def set_user_privacy_settings(
    user_id: int,
    payload: dict = Body(...),
    authorization: str | None = Header(None),
    session_id: str | None = Cookie(None, alias=SESSION_COOKIE),
):
    """Update global tracking and saved-history visibility."""
    me = await _verify_token(authorization, session_id)
    if int(me["id"]) != user_id:
        raise HTTPException(403, "You can only manage your own settings")
    pool = _check_pool()
    existing = await pool.fetchrow(
        "SELECT tracking_enabled, history_public FROM user_settings WHERE user_id = $1",
        user_id,
    )
    tracking = payload.get(
        "tracking_enabled", existing["tracking_enabled"] if existing else True
    )
    history = payload.get(
        "history_public", existing["history_public"] if existing else False
    )
    if not isinstance(tracking, bool) or not isinstance(history, bool):
        raise HTTPException(400, "tracking_enabled and history_public must be booleans")
    await pool.execute(
        "INSERT INTO user_settings (user_id, tracking_enabled, history_public, game_history_public, tracking_consent) "
        "VALUES ($1, $2, $3, $3, $3) ON CONFLICT (user_id) DO UPDATE SET "
        "tracking_enabled = EXCLUDED.tracking_enabled, history_public = EXCLUDED.history_public, "
        "game_history_public = EXCLUDED.game_history_public, "
        "tracking_consent = CASE WHEN EXCLUDED.history_public THEN TRUE ELSE user_settings.tracking_consent END",
        user_id,
        tracking,
        history,
    )
    if bot_ref:
        bot_ref.db_cache.set_tracking_enabled(user_id, tracking)
        bot_ref.db_cache.set_history_public(user_id, history)
        bot_ref.db_cache.set_game_history_public(user_id, history)
        if history:
            bot_ref.db_cache.set_tracking_consent(user_id)
    return {"tracking_enabled": tracking, "history_public": history}


async def _verify_token(
    authorization: str | None, session_id: str | None = None
) -> dict:
    import aiohttp

    # Prefer the opaque web session when one is present.  The session table
    # stores the Discord identity server-side, so no bearer token needs to be
    # exposed to browser JavaScript.
    if session_id:
        try:
            pool = _check_pool()
            row = await pool.fetchrow(
                "SELECT user_id FROM web_sessions "
                "WHERE session_id_hash = $1 AND expires_at > now()",
                _session_hash(session_id),
            )
        except Exception:
            row = None
        if row is not None:
            return {"id": str(row["user_id"])}

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing access token")
    token = authorization[7:]
    async with aiohttp.ClientSession() as session:
        headers = {"Authorization": f"Bearer {token}"}
        async with session.get(
            "https://discord.com/api/users/@me", headers=headers
        ) as resp:
            if resp.status != 200:
                raise HTTPException(401, "Invalid access token")
            return await resp.json()


async def _history_visible_to(
    user_id: int,
    authorization: str | None,
    session_id: str | None,
) -> None:
    """Allow history only after an explicit public opt-in or owner login."""
    pool = _check_pool()
    history_public = await pool.fetchval(
        "SELECT history_public FROM user_settings WHERE user_id = $1", user_id
    )
    # A missing setting is private by default.  This protects newly-seen users
    # until they explicitly opt in through the privacy settings dashboard.
    if history_public is True:
        return

    viewer_id: int | None = None
    if session_id or authorization:
        try:
            viewer = await _verify_token(authorization, session_id)
        except HTTPException:
            viewer = None
        if viewer is not None:
            try:
                viewer_id = int(viewer["id"])
            except (KeyError, TypeError, ValueError):
                viewer_id = None
    if viewer_id != user_id:
        raise HTTPException(403, "This user's saved history is private")


async def _require_guild_manager(
    guild_id: int,
    authorization: str | None,
    session_id: str | None,
):
    """Authenticate a dashboard request and require Manage Server access."""
    me = await _verify_token(authorization, session_id)
    if not bot_ref:
        raise HTTPException(503, "Bot not ready")
    guild = bot_ref.get_guild(guild_id)
    if not guild:
        raise HTTPException(404, "Guild not found")
    member = guild.get_member(int(me["id"]))
    if not member or not member.guild_permissions.manage_guild:
        raise HTTPException(403, "You need Manage Server permission in this guild")
    return guild


async def _guild_history_visible_to(
    guild_id: int,
    authorization: str | None,
    session_id: str | None,
) -> None:
    """Honor a guild's public-history switch while protecting private logs."""
    history_public = await _check_pool().fetchval(
        "SELECT history_public FROM guild_settings WHERE guild_id = $1", guild_id
    )
    # Guild history has historically been public by default.  Only an
    # explicit FALSE setting turns it into manager-only data.
    if history_public is not False:
        return
    await _require_guild_manager(guild_id, authorization, session_id)


VALID_GUILD_OPTOUTS = {
    "avatar",
    "icon",
    "name",
    "avatars",
    "icons",
    "names",
    "joins",
    "status",
    "commands",
    "emoji",
    "downloads",
    "corn",
    "reactions",
    "tags",
    "mudae",
}


@app.get("/user/{user_id}/guilds")
async def get_user_guilds(
    user_id: int,
    authorization: str | None = Header(None),
    session_id: str | None = Cookie(None, alias=SESSION_COOKIE),
):
    """Get guilds where the user has Manage Server. Requires OAuth."""
    me = await _verify_token(authorization, session_id)
    if int(me["id"]) != user_id:
        raise HTTPException(403, "You can only view your own guilds")
    if not bot_ref:
        raise HTTPException(503, "Bot not ready")

    pool = _check_pool()
    guilds = []
    for guild in bot_ref.guilds:
        member = guild.get_member(user_id)
        if member and member.guild_permissions.manage_guild:
            row = await pool.fetchrow(
                "SELECT items FROM guild_opted_out WHERE guild_id = $1", guild.id
            )
            settings = await pool.fetchrow(
                "SELECT tracking_enabled, history_public FROM guild_settings WHERE guild_id = $1",
                guild.id,
            )
            guilds.append(
                {
                    "id": str(guild.id),
                    "name": guild.name,
                    "icon": str(guild.icon) if guild.icon else None,
                    "opted_out": row["items"] if row else [],
                    "tracking_enabled": (
                        settings["tracking_enabled"] if settings else True
                    ),
                    "history_public": settings["history_public"] if settings else True,
                }
            )

    guilds.sort(key=lambda g: g["name"].lower())
    return {"guilds": guilds}


@app.get("/guild/{guild_id}/opted-out")
async def get_guild_opted_out(
    guild_id: int,
    authorization: str | None = Header(None),
    session_id: str | None = Cookie(None, alias=SESSION_COOKIE),
):
    """Get opted-out tracking items for a guild manager."""
    await _require_guild_manager(guild_id, authorization, session_id)
    pool = _check_pool()
    row = await pool.fetchrow(
        "SELECT items FROM guild_opted_out WHERE guild_id = $1", guild_id
    )
    settings = await pool.fetchrow(
        "SELECT tracking_enabled, history_public FROM guild_settings WHERE guild_id = $1",
        guild_id,
    )
    return {
        "items": row["items"] if row else [],
        "tracking_enabled": settings["tracking_enabled"] if settings else True,
        "history_public": settings["history_public"] if settings else True,
    }


@app.post("/guild/{guild_id}/opted-out")
async def set_guild_opted_out(
    guild_id: int,
    payload: dict = Body(...),
    authorization: str | None = Header(None),
    session_id: str | None = Cookie(None, alias=SESSION_COOKIE),
):
    """Set opted-out tracking for a guild. Requires OAuth + Manage Server."""
    me = await _verify_token(authorization, session_id)
    if not bot_ref:
        raise HTTPException(503, "Bot not ready")

    guild = bot_ref.get_guild(guild_id)
    if not guild:
        raise HTTPException(404, "Guild not found")
    member = guild.get_member(int(me["id"]))
    if not member or not member.guild_permissions.manage_guild:
        raise HTTPException(403, "You need Manage Server permission in this guild")

    items = [i for i in payload.get("items", []) if i in VALID_GUILD_OPTOUTS]
    tracking_enabled = payload.get("tracking_enabled", True)
    history_public = payload.get("history_public", True)
    if not isinstance(tracking_enabled, bool) or not isinstance(history_public, bool):
        raise HTTPException(400, "tracking_enabled and history_public must be booleans")
    pool = _check_pool()
    await pool.execute(
        "INSERT INTO guild_opted_out (guild_id, items) VALUES ($1, $2) ON CONFLICT (guild_id) DO UPDATE SET items = $2",
        guild_id,
        items,
    )
    await pool.execute(
        "INSERT INTO guild_settings (guild_id, tracking_enabled, history_public) VALUES ($1, $2, $3) "
        "ON CONFLICT (guild_id) DO UPDATE SET tracking_enabled = EXCLUDED.tracking_enabled, "
        "history_public = EXCLUDED.history_public",
        guild_id,
        tracking_enabled,
        history_public,
    )

    if bot_ref:
        if items:
            bot_ref.db_cache.opted_out[guild_id] = items
        else:
            bot_ref.db_cache.opted_out.pop(guild_id, None)
        bot_ref.db_cache.set_guild_tracking_enabled(guild_id, tracking_enabled)
        bot_ref.db_cache.set_guild_history_public(guild_id, history_public)

    return {
        "items": items,
        "tracking_enabled": tracking_enabled,
        "history_public": history_public,
    }


async def _refresh_urls(urls: list[str]) -> list[str]:
    """Call Discord's refresh-urls endpoint to get fresh CDN links."""
    if not urls or not bot_ref:
        return urls
    clean = list({u.split("?")[0] for u in urls if u})
    if not clean:
        return urls
    mapping: dict[str, str] = {}
    BATCH_SIZE = 50
    for i in range(0, len(clean), BATCH_SIZE):
        batch = clean[i : i + BATCH_SIZE]
        try:
            req = await bot_ref.http.request(
                __import__("discord").http.Route("POST", "/attachments/refresh-urls"),
                json={"attachment_urls": batch},
            )
            for item in req.get("refreshed_urls", []):
                orig = item.get("original", "")
                refreshed = item.get("refreshed", "")
                if orig and refreshed:
                    mapping[orig] = refreshed
        except Exception:
            continue
    return [mapping.get(u.split("?")[0], u) for u in urls]


@app.get("/guild/{guild_id}/icons")
async def get_guild_icons(
    guild_id: int,
    page: int = Query(1, ge=1),
    per_page: int = Query(80, ge=1, le=100),
    authorization: str | None = Header(None),
    session_id: str | None = Cookie(None, alias=SESSION_COOKIE),
):
    """Get guild icon history."""
    await _guild_history_visible_to(guild_id, authorization, session_id)
    pool = _check_pool()
    count = await pool.fetchval(
        "SELECT COUNT(*) FROM guild_icons WHERE guild_id = $1", guild_id
    )
    pages = max((count + per_page - 1) // per_page, 1)
    offset = (page - 1) * per_page
    rows = await pool.fetch(
        "SELECT icon_key, icon, created_at FROM guild_icons WHERE guild_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
        guild_id,
        per_page,
        offset,
    )
    urls = [r["icon"] for r in rows if r["icon"]]
    refreshed = await _refresh_urls(urls)
    url_map = dict(zip(urls, refreshed))
    icons = [
        {
            "icon_key": r["icon_key"],
            "url": url_map.get(r["icon"], r["icon"]),
            "created_at": r["created_at"].isoformat(),
        }
        for r in rows
    ]
    return {"items": icons, "total": count, "page": page, "pages": pages}


@app.get("/guild/{guild_id}/names")
async def get_guild_names(
    guild_id: int,
    page: int = Query(1, ge=1),
    per_page: int = Query(80, ge=1, le=100),
    authorization: str | None = Header(None),
    session_id: str | None = Cookie(None, alias=SESSION_COOKIE),
):
    """Get guild name history."""
    await _guild_history_visible_to(guild_id, authorization, session_id)
    pool = _check_pool()
    count = await pool.fetchval(
        "SELECT COUNT(*) FROM guild_name_logs WHERE guild_id = $1", guild_id
    )
    pages = max((count + per_page - 1) // per_page, 1)
    offset = (page - 1) * per_page
    rows = await pool.fetch(
        "SELECT id, name, created_at FROM guild_name_logs WHERE guild_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
        guild_id,
        per_page,
        offset,
    )
    names = [
        {"id": r["id"], "value": r["name"], "created_at": r["created_at"].isoformat()}
        for r in rows
    ]
    return {"items": names, "total": count, "page": page, "pages": pages}


@app.get("/commands")
async def list_commands():
    if not bot_ref:
        raise HTTPException(503, "Bot not ready")
    cmds = []

    def is_effect_app_subcommand(command: Any) -> bool:
        """Keep the split effect groups, but hide their child commands on the site."""
        qualified_name = str(getattr(command, "qualified_name", "")).casefold()
        return bool(re.match(r"^effect(?:-\d+)?\s+", qualified_name))

    def add_cmd(c):
        if (
            c.hidden
            or c.cog_name in ("Owner", "Jishaku")
            or is_effect_app_subcommand(c)
        ):
            return
        aliases = ", ".join(c.aliases) if c.aliases else ""
        params = []
        for name, param in c.clean_params.items():
            req = "required" if param.default is param.empty else "optional"
            params.append({"name": name, "required": req})
        cmds.append(
            {
                "name": c.qualified_name,
                "description": c.description or c.short_doc or "",
                "category": c.cog_name or "Uncategorized",
                "usage": c.usage or "",
                "aliases": aliases,
                "params": params,
            }
        )

    for cmd in bot_ref.commands:
        add_cmd(cmd)
        if hasattr(cmd, "walk_commands"):
            for sub in cast(Any, cmd).walk_commands():
                add_cmd(sub)
    return {"commands": sorted(cmds, key=lambda c: (c["category"], c["name"]))}


@app.get("/stats")
async def bot_stats():
    if not bot_ref:
        raise HTTPException(503, "Bot not ready")
    import datetime

    pool = _check_pool()
    async with pool.acquire() as conn:
        start = datetime.datetime.now(datetime.timezone.utc).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        avatars_total = await conn.fetchval("SELECT COUNT(*) FROM avatars")
        avatars_today = await conn.fetchval(
            "SELECT COUNT(*) FROM avatars WHERE created_at >= $1", start
        )
        commands_total = await conn.fetchval("SELECT COUNT(*) FROM command_logs")
        commands_today = await conn.fetchval(
            "SELECT COUNT(*) FROM command_logs WHERE created_at >= $1", start
        )
        usernames_total = await conn.fetchval("SELECT COUNT(*) FROM username_logs")
        usernames_today = await conn.fetchval(
            "SELECT COUNT(*) FROM username_logs WHERE created_at >= $1", start
        )
        discrims_total = await conn.fetchval("SELECT COUNT(*) FROM discrim_logs")
        discrims_today = await conn.fetchval(
            "SELECT COUNT(*) FROM discrim_logs WHERE created_at >= $1", start
        )
        nicknames_total = await conn.fetchval("SELECT COUNT(*) FROM nickname_logs")
        nicknames_today = await conn.fetchval(
            "SELECT COUNT(*) FROM nickname_logs WHERE created_at >= $1", start
        )
        guild_names_total = await conn.fetchval("SELECT COUNT(*) FROM guild_name_logs")
        guild_names_today = await conn.fetchval(
            "SELECT COUNT(*) FROM guild_name_logs WHERE created_at >= $1", start
        )
        member_joins_total = await conn.fetchval(
            "SELECT COUNT(*) FROM member_join_logs"
        )
        member_joins_today = await conn.fetchval(
            "SELECT COUNT(*) FROM member_join_logs WHERE time >= $1", start
        )
        guild_icons_total = await conn.fetchval("SELECT COUNT(*) FROM guild_icons")
        guild_icons_today = await conn.fetchval(
            "SELECT COUNT(*) FROM guild_icons WHERE created_at >= $1", start
        )
        guild_avatars_total = await conn.fetchval("SELECT COUNT(*) FROM guild_avatars")
        guild_avatars_today = await conn.fetchval(
            "SELECT COUNT(*) FROM guild_avatars WHERE created_at >= $1", start
        )
    return {
        "guilds": len(bot_ref.guilds),
        "users": sum(g.member_count or 0 for g in bot_ref.guilds),
        "commands": len(bot_ref.commands),
        "uptime_seconds": (
            (datetime.datetime.now().astimezone() - bot_ref.start_time).total_seconds()
            if hasattr(bot_ref, "start_time")
            else 0
        ),
        "today": {
            "avatars": avatars_today,
            "commands": commands_today,
            "usernames": usernames_today,
            "discrims": discrims_today,
            "nicknames": nicknames_today,
            "guild_names": guild_names_today,
            "member_joins": member_joins_today,
            "guild_icons": guild_icons_today,
            "guild_avatars": guild_avatars_today,
        },
        "totals": {
            "avatars": avatars_total,
            "commands": commands_total,
            "usernames": usernames_total,
            "discrims": discrims_total,
            "nicknames": nicknames_total,
            "guild_names": guild_names_total,
            "member_joins": member_joins_total,
            "guild_icons": guild_icons_total,
            "guild_avatars": guild_avatars_total,
        },
    }


class OAuthExchangePayload(BaseModel):
    """JSON body accepted by the browser OAuth callback."""

    model_config = ConfigDict(extra="forbid")

    code: str = Field(min_length=1, max_length=2048)
    state: str = Field(min_length=32, max_length=256)
    redirect_uri: str = "https://crygup.com/dashboard"


def _oauth_redirect_uri(value: str) -> str:
    # Redirects are deliberately an exact allow-list.  In particular, do not
    # accept arbitrary subdomains or query strings supplied by the browser.
    if value not in {"https://crygup.com", "https://crygup.com/dashboard"}:
        raise HTTPException(400, "Invalid OAuth redirect URI")
    return value


@app.get("/oauth/start")
async def oauth_start(
    response: Response,
    redirect_uri: str = Query("https://crygup.com/dashboard"),
):
    """Create a one-time OAuth state and PKCE verifier for Discord."""
    if not bot_ref:
        raise HTTPException(503, "Bot not ready")
    redirect_uri = _oauth_redirect_uri(redirect_uri)
    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode("ascii")).digest()
    ).decode("ascii").rstrip("=")
    pool = _check_pool()
    await pool.execute("DELETE FROM oauth_states WHERE expires_at <= now()")
    await pool.execute(
        "INSERT INTO oauth_states (state_hash, code_verifier, redirect_uri, expires_at) "
        "VALUES ($1, $2, $3, now() + interval '10 minutes')",
        _session_hash(state),
        verifier,
        redirect_uri,
    )
    response.set_cookie(
        key=OAUTH_STATE_COOKIE,
        value=state,
        max_age=OAUTH_STATE_MAX_AGE,
        secure=True,
        httponly=True,
        samesite="lax",
        path="/",
    )
    response.headers["Cache-Control"] = "no-store"
    query = urlencode(
        {
            "client_id": str(_active_application_id()),
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "identify",
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
    )
    return {"url": f"https://discord.com/oauth2/authorize?{query}"}


@app.post("/oauth/exchange")
async def oauth_exchange(
    response: Response,
    payload: OAuthExchangePayload,
    oauth_state: str | None = Cookie(None, alias=OAUTH_STATE_COOKIE),
):
    """Consume a browser OAuth state and issue an HttpOnly web session."""
    if not bot_ref:
        raise HTTPException(503, "Bot not ready")
    redirect_uri = _oauth_redirect_uri(payload.redirect_uri)
    if not oauth_state or not hmac.compare_digest(oauth_state, payload.state):
        raise HTTPException(400, "Invalid OAuth state")

    # DELETE ... RETURNING atomically consumes the state, preventing replay.
    row = await _check_pool().fetchrow(
        "DELETE FROM oauth_states WHERE state_hash = $1 AND expires_at > now() "
        "RETURNING code_verifier, redirect_uri",
        _session_hash(payload.state),
    )
    if row is None or row["redirect_uri"] != redirect_uri:
        raise HTTPException(400, "Invalid or expired OAuth state")

    token_data: dict[str, Any]
    http_session = getattr(bot_ref, "session", None)
    owns_session = http_session is None
    if owns_session:
        http_session = aiohttp.ClientSession()
    try:
        data = {
            "client_id": str(_active_application_id()),
            "client_secret": _active_client_secret(),
            "code": payload.code,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
            "code_verifier": row["code_verifier"],
        }
        async with http_session.post(
            "https://discord.com/api/oauth2/token", data=data
        ) as token_response:
            if token_response.status != 200:
                raise HTTPException(400, "OAuth exchange failed")
            try:
                token_data = await token_response.json(content_type=None)
            except (ValueError, aiohttp.ContentTypeError) as error:
                raise HTTPException(400, "OAuth exchange failed") from error
            if not isinstance(token_data, dict):
                raise HTTPException(400, "OAuth exchange failed")
        access_token = token_data.get("access_token")
        if not isinstance(access_token, str) or not access_token:
            raise HTTPException(400, "OAuth exchange failed")
        async with http_session.get(
            "https://discord.com/api/users/@me",
            headers={"Authorization": f"Bearer {access_token}"},
        ) as user_response:
            if user_response.status != 200:
                raise HTTPException(400, "Discord user lookup failed")
            try:
                user_data = await user_response.json(content_type=None)
            except (ValueError, aiohttp.ContentTypeError) as error:
                raise HTTPException(400, "Discord user lookup failed") from error
    finally:
        if owns_session:
            await http_session.close()

    try:
        user_id = int(user_data["id"])
    except (KeyError, TypeError, ValueError) as error:
        raise HTTPException(400, "Discord user lookup failed") from error
    session_id, max_age = await _create_web_session(
        user_id, access_token, token_data.get("expires_in")
    )
    response.set_cookie(
        key=SESSION_COOKIE,
        value=session_id,
        max_age=max_age,
        secure=True,
        httponly=True,
        samesite="lax",
        path="/",
    )
    response.delete_cookie(key=OAUTH_STATE_COOKIE, path="/")
    response.headers["Cache-Control"] = "no-store"
    # Never return Discord's access token to browser JavaScript.
    return {"user": user_data}


@app.post("/oauth/logout")
async def oauth_logout(
    response: Response,
    session_id: str | None = Cookie(None, alias=SESSION_COOKIE),
):
    if session_id:
        await _check_pool().execute(
            "DELETE FROM web_sessions WHERE session_id_hash = $1",
            _session_hash(session_id),
        )
    response.delete_cookie(key=SESSION_COOKIE, path="/")
    response.headers["Cache-Control"] = "no-store"
    return {"ok": True}


@app.get("/oauth/me")
async def oauth_me(
    response: Response,
    authorization: str | None = Header(None),
    session_id: str | None = Cookie(None, alias=SESSION_COOKIE),
):
    """Return the authenticated Discord identity without exposing credentials."""
    response.headers["Cache-Control"] = "private, no-store"
    if not session_id and not (authorization and authorization.startswith("Bearer ")):
        return {"authenticated": False, "user": None}
    try:
        user = await _verify_token(authorization, session_id)
    except HTTPException as error:
        if error.status_code == 401:
            if session_id:
                response.delete_cookie(key=SESSION_COOKIE, path="/")
            return {"authenticated": False, "user": None}
        raise
    return {"authenticated": True, "user": user}


@app.get("/lastfm/connect")
async def lastfm_connect(
    response: Response,
    authorization: str | None = Header(None),
    session_id: str | None = Cookie(None, alias=SESSION_COOKIE),
):
    """Create a Last.fm authorization URL for the authenticated Discord user."""
    me = await _verify_token(authorization, session_id)
    browser_nonce = secrets.token_urlsafe(32)
    response.set_cookie(
        key=LASTFM_STATE_COOKIE,
        value=browser_nonce,
        max_age=LASTFM_STATE_TTL,
        secure=True,
        httponly=True,
        samesite="lax",
        path="/",
    )
    return {
        "url": _lastfm_authorization_url(
            int(me["id"]),
            "website",
            session_id=session_id,
            browser_nonce=browser_nonce,
        )
    }


@app.get("/lastfm/callback")
async def lastfm_callback(
    response: Response,
    token: str = Query(...),
    state: str = Query(...),
    session_id: str | None = Cookie(None, alias=SESSION_COOKIE),
    browser_nonce: str | None = Cookie(None, alias=LASTFM_STATE_COOKIE),
):
    """Exchange a Last.fm callback token and persist the verified account."""
    if not bot_ref:
        raise HTTPException(503, "Bot not ready")
    if not re.fullmatch(r"[A-Za-z0-9_-]{32}", token):
        raise HTTPException(400, "Invalid Last.fm authentication token")

    user_id, source, channel_id, message_id = _decode_lastfm_state(
        state,
        session_id=session_id,
        browser_nonce=browser_nonce,
    )
    api_key = bot_ref.config["keys"]["lastfm_cb"]
    api_secret = bot_ref.config["keys"]["lastfm_cb_secret"]
    payload = {
        "method": "auth.getSession",
        "api_key": api_key,
        "token": token,
        "api_sig": _lastfm_api_signature(api_key, token, api_secret),
        "format": "json",
    }
    async with bot_ref.session.post(LASTFM_API_URL, data=payload) as resp:
        try:
            result = await resp.json(content_type=None)
        except (ValueError, aiohttp.ContentTypeError):
            raise HTTPException(502, "Last.fm returned an invalid response")

    session = result.get("session") if isinstance(result, dict) else None
    if resp.status != 200 or not isinstance(session, dict):
        message = (
            result.get("message", "Last.fm authorization failed")
            if isinstance(result, dict)
            else "Last.fm authorization failed"
        )
        raise HTTPException(400, str(message))
    username = session.get("name")
    session_key = session.get("key")
    if not username or not session_key:
        raise HTTPException(502, "Last.fm did not return account credentials")

    pool = _check_pool()
    await pool.execute(
        """INSERT INTO accounts (user_id, lastfm, lastfm_session_key)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id) DO UPDATE
           SET lastfm = EXCLUDED.lastfm,
               lastfm_session_key = EXCLUDED.lastfm_session_key;
        """,
        user_id,
        username,
        session_key,
    )
    bot_ref.db_cache.add_account(user_id, username)
    await _refresh_discord_accounts_message(user_id, channel_id, message_id)
    response.delete_cookie(key=LASTFM_STATE_COOKIE, path="/")
    return {"username": username, "source": source}


@app.get("/steam/connect")
async def steam_connect(
    response: Response,
    authorization: str | None = Header(None),
    session_id: str | None = Cookie(None, alias=SESSION_COOKIE),
):
    """Create a Steam OpenID URL for the authenticated Discord user."""
    me = await _verify_token(authorization, session_id)
    if not session_id:
        raise HTTPException(401, "A browser session is required to connect Steam")
    browser_nonce = secrets.token_urlsafe(32)
    response.set_cookie(
        key=STEAM_STATE_COOKIE,
        value=browser_nonce,
        max_age=STEAM_STATE_TTL,
        secure=True,
        httponly=True,
        samesite="lax",
        path="/",
    )
    response.headers["Cache-Control"] = "private, no-store"
    return {
        "url": _steam_authorization_url(
            int(me["id"]),
            "website",
            session_id=session_id,
            browser_nonce=browser_nonce,
        )
    }


@app.get("/steam/callback")
async def steam_callback(
    request: Request,
    response: Response,
    steam_state: str = Query(...),
    session_id: str | None = Cookie(None, alias=SESSION_COOKIE),
    browser_nonce: str | None = Cookie(None, alias=STEAM_STATE_COOKIE),
):
    """Verify a Steam OpenID response and persist the user's SteamID64."""
    if not bot_ref:
        raise HTTPException(503, "Bot not ready")
    user_id, source, channel_id, message_id = _decode_steam_state(
        steam_state, session_id=session_id, browser_nonce=browser_nonce
    )
    openid = {
        key: value
        for key, value in request.query_params.items()
        if key.startswith("openid.")
    }
    if openid.get("openid.mode") != "id_res":
        raise HTTPException(400, "Steam authorization was cancelled")
    return_to = openid.get("openid.return_to")
    if not return_to:
        raise HTTPException(400, "Steam did not return a callback URL")
    parsed_return_to = urlsplit(return_to)
    if (
        parsed_return_to.scheme != "https"
        or parsed_return_to.netloc != "crygup.com"
        or parsed_return_to.path != "/fishie"
        or parse_qs(parsed_return_to.query).get("steam_state") != [steam_state]
    ):
        raise HTTPException(400, "Invalid Steam callback URL")
    claimed_id = openid.get("openid.claimed_id", "")
    identity = openid.get("openid.identity", "")
    match = re.fullmatch(r"https://steamcommunity\.com/openid/id/(\d{17})", claimed_id)
    if not match or identity != claimed_id:
        raise HTTPException(400, "Steam returned an invalid account identifier")

    verify_payload = dict(openid)
    verify_payload["openid.mode"] = "check_authentication"
    async with bot_ref.session.post(STEAM_OPENID_URL, data=verify_payload) as resp:
        verification = await resp.text()
    if resp.status != 200 or not re.search(
        r"(?:^|\n)is_valid:true(?:\r?\n|$)", verification
    ):
        raise HTTPException(400, "Steam authorization could not be verified")

    steam_id = match.group(1)
    persona_name = None
    api_key = bot_ref.config["keys"].get("steam")
    if api_key:
        try:
            async with bot_ref.session.get(
                "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/",
                params={"key": api_key, "steamids": steam_id, "format": "json"},
            ) as profile_resp:
                profile = await profile_resp.json(content_type=None)
            response_data = (
                profile.get("response") if isinstance(profile, dict) else None
            )
            players = (
                response_data.get("players", [])
                if isinstance(response_data, dict)
                else []
            )
            if isinstance(players, list) and players and isinstance(players[0], dict):
                persona_name = players[0].get("personaname")
        except (aiohttp.ClientError, ValueError, TypeError):
            logger.warning("Steam profile lookup failed for linked account")

    pool = _check_pool()
    await pool.execute(
        """INSERT INTO accounts (user_id, steam)
           VALUES ($1, $2)
           ON CONFLICT (user_id) DO UPDATE
           SET steam = EXCLUDED.steam;""",
        user_id,
        steam_id,
    )
    await _refresh_discord_accounts_message(user_id, channel_id, message_id)
    response.delete_cookie(key=STEAM_STATE_COOKIE, path="/")
    return {"steamid": steam_id, "personaname": persona_name, "source": source}


@app.get("/spotify/callback")
async def spotify_callback(code: str = Query(...), state: str = Query(...)):
    """Reject the retired, unauthenticated Spotify callback.

    Spotify account linking is served by the active Fishie API, whose callback
    binds a one-time state to the authenticated browser session.  This legacy
    website route had no way to establish that binding, so it must not accept
    authorization codes or mutate the shared accounts table.
    """
    raise HTTPException(410, "Spotify connections are handled by Fishie's API")

    # Kept below only as historical context for deployments that still carry
    # this source file; the unconditional response above makes the old flow
    # unreachable and prevents token exchange/account mutation.
    if not bot_ref:
        raise HTTPException(503, "Bot not ready")
    user_id, source, channel_id, message_id = _decode_spotify_state(state)
    logger.info("Spotify OAuth callback accepted source=%s user_id=%s", source, user_id)
    auth = aiohttp.BasicAuth(
        bot_ref.config["keys"]["spotify_id"],
        bot_ref.config["keys"]["spotify_secret"],
    )
    try:
        async with bot_ref.session.post(
            SPOTIFY_TOKEN_URL,
            auth=auth,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": SPOTIFY_CALLBACK_URL,
            },
        ) as response:
            try:
                token_data = await response.json(content_type=None)
            except (ValueError, aiohttp.ContentTypeError):
                raise HTTPException(400, "Spotify returned an invalid token response")
    except (aiohttp.ClientError, asyncio.TimeoutError) as error:
        logger.warning("Spotify token exchange unavailable: %s", error)
        raise HTTPException(400, "Spotify authorization service unavailable") from error
    logger.info(
        "Spotify OAuth token exchange completed status=%s user_id=%s",
        response.status,
        user_id,
    )
    if response.status != 200 or not isinstance(token_data, dict):
        error_code = token_data.get("error") if isinstance(token_data, dict) else None
        logger.warning(
            "Spotify OAuth token exchange rejected status=%s error=%s user_id=%s",
            response.status,
            error_code or "unknown",
            user_id,
        )
        raise HTTPException(400, "Spotify authorization failed")
    access_token = token_data.get("access_token")
    issued_refresh_token = token_data.get("refresh_token")
    logger.info(
        "Spotify OAuth credentials received access=%s refresh=%s user_id=%s",
        bool(access_token),
        bool(issued_refresh_token),
        user_id,
    )
    if not access_token:
        raise HTTPException(400, "Spotify did not return an access token")

    # Spotify may omit refresh_token when an account authorizes the app again.
    # Keep the token already stored for that user instead of rejecting a valid
    # access-token exchange.
    pool = _check_pool()
    refresh_token = issued_refresh_token
    if not refresh_token:
        try:
            refresh_token = await asyncio.wait_for(
                pool.fetchval(
                    "SELECT spotify_refresh_token FROM accounts WHERE user_id = $1",
                    user_id,
                ),
                timeout=5,
            )
        except asyncio.TimeoutError:
            logger.warning(
                "Spotify stored refresh-token lookup timed out user_id=%s", user_id
            )
            raise HTTPException(400, "Spotify connection temporarily unavailable")
    if not refresh_token:
        logger.warning(
            "Spotify OAuth returned no refresh token and none is stored user_id=%s",
            user_id,
        )
        raise HTTPException(
            400,
            "Spotify did not issue a new refresh token. Remove Fishie from your "
            "Spotify account's Apps page, then connect it again.",
        )

    # Persist the durable credential before any optional profile or Discord
    # work. If a later step fails, the next authorization can reuse this token.
    try:
        await asyncio.wait_for(
            pool.execute(
                """INSERT INTO accounts (user_id, spotify_refresh_token)
                   VALUES ($1, $2)
                   ON CONFLICT (user_id) DO UPDATE
                   SET spotify_refresh_token = EXCLUDED.spotify_refresh_token;""",
                user_id,
                refresh_token,
            ),
            timeout=5,
        )
    except asyncio.TimeoutError:
        logger.warning(
            "Spotify refresh-token persistence timed out user_id=%s", user_id
        )
        raise HTTPException(400, "Spotify connection temporarily unavailable")
    logger.info("Spotify refresh token persisted user_id=%s", user_id)

    try:
        logger.info("Spotify OAuth profile lookup started user_id=%s", user_id)
        async with bot_ref.session.get(
            "https://api.spotify.com/v1/me",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=aiohttp.ClientTimeout(total=10),
        ) as profile_response:
            profile_status = profile_response.status
            profile_content_type = profile_response.headers.get("Content-Type", "")
            profile_body = await profile_response.text()
    except (aiohttp.ClientError, asyncio.TimeoutError) as error:
        logger.warning("Spotify profile lookup unavailable: %s", error)
        raise HTTPException(400, "Spotify profile service unavailable") from error
    logger.info(
        "Spotify OAuth profile response status=%s content_type=%s bytes=%s user_id=%s",
        profile_status,
        profile_content_type.split(";", 1)[0] or "unknown",
        len(profile_body),
        user_id,
    )
    try:
        profile = json.loads(profile_body)
    except (TypeError, ValueError):
        logger.warning(
            "Spotify profile response was not JSON status=%s user_id=%s",
            profile_status,
            user_id,
        )
        raise HTTPException(400, "Spotify returned an invalid profile response")
    if profile_status != 200 or not isinstance(profile, dict):
        raise HTTPException(400, "Spotify profile lookup failed")
    display_name = profile.get("display_name") or profile.get("id")
    if not display_name:
        raise HTTPException(400, "Spotify did not return a display name")

    try:
        await asyncio.wait_for(
            pool.execute(
                """UPDATE accounts
                   SET spotify = $2, spotify_refresh_token = $3
                   WHERE user_id = $1;""",
                user_id,
                display_name,
                refresh_token,
            ),
            timeout=5,
        )
    except asyncio.TimeoutError:
        logger.warning("Spotify profile persistence timed out user_id=%s", user_id)
        raise HTTPException(400, "Spotify connection temporarily unavailable")
    _schedule_discord_accounts_refresh(user_id, channel_id, message_id)
    logger.info("Spotify account linked user_id=%s", user_id)
    return {"display_name": display_name, "source": source}


@app.get("/anilist/connect")
async def anilist_connect(
    response: Response,
    authorization: str | None = Header(None),
    session_id: str | None = Cookie(None, alias=SESSION_COOKIE),
):
    """Create an AniList authorization URL for the authenticated Discord user."""
    me = await _verify_token(authorization, session_id)
    if not session_id:
        raise HTTPException(401, "A browser session is required to connect AniList")
    browser_nonce = secrets.token_urlsafe(32)
    response.set_cookie(
        key=ANILIST_STATE_COOKIE,
        value=browser_nonce,
        max_age=ANILIST_STATE_TTL,
        secure=True,
        httponly=True,
        samesite="lax",
        path="/",
    )
    response.headers["Cache-Control"] = "private, no-store"
    return {
        "url": _anilist_authorization_url(
            int(me["id"]),
            "website",
            session_id=session_id,
            browser_nonce=browser_nonce,
        )
    }


@app.get("/anilist/callback")
async def anilist_callback(
    response: Response,
    code: str = Query(...),
    state: str = Query(...),
    session_id: str | None = Cookie(None, alias=SESSION_COOKIE),
    browser_nonce: str | None = Cookie(None, alias=ANILIST_STATE_COOKIE),
):
    """Exchange an AniList code and persist the verified profile credentials."""
    if not bot_ref:
        raise HTTPException(503, "Bot not ready")
    user_id, source, channel_id, message_id = _decode_anilist_state(
        state, session_id=session_id, browser_nonce=browser_nonce
    )
    payload = {
        "grant_type": "authorization_code",
        "client_id": bot_ref.config["keys"]["anilist_id"],
        "client_secret": bot_ref.config["keys"]["anilist_secret"],
        "redirect_uri": ANILIST_CALLBACK_URL,
        "code": code,
    }
    async with bot_ref.session.post(ANILIST_TOKEN_URL, json=payload) as response:
        try:
            token_data = await response.json(content_type=None)
        except (ValueError, aiohttp.ContentTypeError):
            raise HTTPException(502, "AniList returned an invalid token response")
    access_token = (
        token_data.get("access_token") if isinstance(token_data, dict) else None
    )
    if response.status != 200 or not access_token:
        raise HTTPException(400, "AniList authorization failed")

    async with bot_ref.session.post(
        ANILIST_GRAPHQL_URL,
        json={"query": "query { Viewer { id name } }"},
        headers={"Authorization": f"Bearer {access_token}"},
    ) as profile_response:
        try:
            profile_data = await profile_response.json(content_type=None)
        except (ValueError, aiohttp.ContentTypeError):
            raise HTTPException(502, "AniList returned an invalid profile response")
    profile_payload = (
        profile_data.get("data") if isinstance(profile_data, dict) else None
    )
    viewer = (
        profile_payload.get("Viewer") if isinstance(profile_payload, dict) else None
    )
    username = viewer.get("name") if isinstance(viewer, dict) else None
    if profile_response.status != 200 or not username:
        raise HTTPException(400, "AniList profile lookup failed")

    pool = _check_pool()
    await pool.execute(
        """INSERT INTO accounts (user_id, anilist, anilist_access_token)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id) DO UPDATE SET
               anilist = EXCLUDED.anilist,
               anilist_access_token = EXCLUDED.anilist_access_token;""",
        user_id,
        username,
        access_token,
    )
    await _refresh_discord_accounts_message(user_id, channel_id, message_id)
    response.delete_cookie(key=ANILIST_STATE_COOKIE, path="/")
    return {"username": username, "source": source}


@app.get("/user/{user_id}")
async def get_user_data(
    user_id: int,
    authorization: str | None = Header(None),
    session_id: str | None = Cookie(None, alias=SESSION_COOKIE),
):
    await _history_visible_to(user_id, authorization, session_id)
    pool = _check_pool()
    async with pool.acquire() as conn:
        return {
            "user_id": user_id,
            "counts": {
                "avatars": await conn.fetchval(
                    "SELECT COUNT(*) FROM avatars WHERE user_id = $1", user_id
                ),
                "usernames": await conn.fetchval(
                    "SELECT COUNT(*) FROM username_logs WHERE user_id = $1", user_id
                ),
                "display_names": await conn.fetchval(
                    "SELECT COUNT(*) FROM display_name_logs WHERE user_id = $1", user_id
                ),
                "discrims": await conn.fetchval(
                    "SELECT COUNT(*) FROM discrim_logs WHERE user_id = $1", user_id
                ),
            },
        }


@app.get("/user/{user_id}/xp")
async def get_user_xp(
    user_id: int,
    authorization: str | None = Header(None),
    session_id: str | None = Cookie(None, alias=SESSION_COOKIE),
):
    """Get XP and message count for a user. Requires OAuth."""
    me = await _verify_token(authorization, session_id)
    if int(me["id"]) != user_id:
        raise HTTPException(403, "You can only view your own XP")
    pool = _check_pool()
    row = await pool.fetchrow(
        "SELECT messages, xp FROM message_xp WHERE user_id = $1", user_id
    )
    if not row:
        return {"messages": 0, "xp": 0}
    return {"messages": row["messages"], "xp": row["xp"]}


@app.get("/usernames/{user_id}")
async def get_usernames(
    user_id: int,
    page: int = Query(1, ge=1),
    per_page: int = Query(100, ge=1, le=100),
    authorization: str | None = Header(None),
    session_id: str | None = Cookie(None, alias=SESSION_COOKIE),
):
    await _history_visible_to(user_id, authorization, session_id)
    pool = _check_pool()
    async with pool.acquire() as conn:
        count = await conn.fetchval(
            "SELECT COUNT(*) FROM username_logs WHERE user_id = $1", user_id
        )
        pages = max(1, (count + per_page - 1) // per_page)
        rows = await conn.fetch(
            "SELECT id, username, created_at FROM username_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
            user_id,
            per_page,
            (page - 1) * per_page,
        )
    return {
        "items": [
            {
                "id": r["id"],
                "value": r["username"],
                "created_at": r["created_at"].isoformat(),
            }
            for r in rows
        ],
        "total": count,
        "page": page,
        "pages": pages,
    }


@app.get("/display-names/{user_id}")
async def get_display_names(
    user_id: int,
    page: int = Query(1, ge=1),
    per_page: int = Query(100, ge=1, le=100),
    authorization: str | None = Header(None),
    session_id: str | None = Cookie(None, alias=SESSION_COOKIE),
):
    await _history_visible_to(user_id, authorization, session_id)
    pool = _check_pool()
    async with pool.acquire() as conn:
        count = await conn.fetchval(
            "SELECT COUNT(*) FROM display_name_logs WHERE user_id = $1", user_id
        )
        pages = max(1, (count + per_page - 1) // per_page)
        rows = await conn.fetch(
            "SELECT id, display_name, created_at FROM display_name_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
            user_id,
            per_page,
            (page - 1) * per_page,
        )
    return {
        "items": [
            {
                "id": r["id"],
                "value": r["display_name"],
                "created_at": r["created_at"].isoformat(),
            }
            for r in rows
        ],
        "total": count,
        "page": page,
        "pages": pages,
    }


@app.get("/discrims/{user_id}")
async def get_discrims(
    user_id: int,
    page: int = Query(1, ge=1),
    per_page: int = Query(100, ge=1, le=100),
    authorization: str | None = Header(None),
    session_id: str | None = Cookie(None, alias=SESSION_COOKIE),
):
    await _history_visible_to(user_id, authorization, session_id)
    pool = _check_pool()
    async with pool.acquire() as conn:
        count = await conn.fetchval(
            "SELECT COUNT(*) FROM discrim_logs WHERE user_id = $1", user_id
        )
        pages = max(1, (count + per_page - 1) // per_page)
        rows = await conn.fetch(
            "SELECT id, discrim, created_at FROM discrim_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
            user_id,
            per_page,
            (page - 1) * per_page,
        )
    return {
        "items": [
            {
                "id": r["id"],
                "value": r["discrim"],
                "created_at": r["created_at"].isoformat(),
            }
            for r in rows
        ],
        "total": count,
        "page": page,
        "pages": pages,
    }


@app.delete("/user/{user_id}")
async def delete_user_data(
    user_id: int,
    table: str | None = Query(None),
    authorization: str | None = Header(None),
    session_id: str | None = Cookie(None, alias=SESSION_COOKIE),
):
    me = await _verify_token(authorization, session_id)

    tables = [table] if table else list(TABLE_MAP.keys())
    deleted = 0
    pool = _check_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            for t in tables:
                db_table = TABLE_MAP.get(t)
                if not db_table:
                    raise HTTPException(400, f"Invalid table: {t}")
                if t in GUILD_TABLES:
                    if not bot_ref:
                        raise HTTPException(503, "Bot not ready")
                    guild = bot_ref.get_guild(user_id)
                    if not guild:
                        raise HTTPException(404, "Guild not found")
                    member = guild.get_member(int(me["id"]))
                    if not member or not member.guild_permissions.manage_guild:
                        raise HTTPException(403, "You need Manage Server in this guild")
                    r = await conn.execute(
                        f"DELETE FROM {db_table} WHERE guild_id = $1", user_id
                    )
                else:
                    if int(me["id"]) != user_id:
                        raise HTTPException(403, "You can only delete your own data")
                    r = await conn.execute(
                        f"DELETE FROM {db_table} WHERE user_id = $1", user_id
                    )
                deleted += int(r.split()[-1])
    return {"user_id": user_id, "deleted_rows": deleted}


@app.get("/resolve")
async def resolve_user(q: str = Query(...)):
    """Resolve a Discord username or ID to a user ID."""
    q = q.strip()
    if q.isdigit():
        return {"user_id": str(q)}
    if not bot_ref:
        raise HTTPException(503, "Bot not ready")
    guild_id = int(bot_ref.config.get("ids", {}).get("guild_id", "0") or "0")
    if not guild_id:
        raise HTTPException(400, "Username lookup not available, use a Discord ID")
    guild = bot_ref.get_guild(guild_id)
    if not guild:
        raise HTTPException(502, "Bot is not in the configured guild")
    members = await guild.query_members(q, limit=5)
    for m in members:
        if m.name.lower() == q.lower() or (
            m.global_name and m.global_name.lower() == q.lower()
        ):
            return {"user_id": str(m.id)}
    if members:
        return {"user_id": str(members[0].id)}
    raise HTTPException(
        404, f'No guild member matched "{q}". Try a Discord ID instead.'
    )


@app.delete("/item/{table}/{user_id}")
async def delete_item(
    table: str,
    user_id: int,
    key: str = Query(...),
    authorization: str | None = Header(None),
    session_id: str | None = Cookie(None, alias=SESSION_COOKIE),
):
    """Delete a specific logged item for the authenticated owner/manager."""
    me = await _verify_token(authorization, session_id)

    pool = _check_pool()
    async with pool.acquire() as conn:
        db_table = TABLE_MAP.get(table)
        if not db_table:
            raise HTTPException(400, f"Invalid table: {table}")
        if table in GUILD_TABLES:
            if not bot_ref:
                raise HTTPException(503, "Bot not ready")
            guild = bot_ref.get_guild(user_id)
            if not guild:
                raise HTTPException(404, "Guild not found")
            member = guild.get_member(int(me["id"]))
            if not member or not member.guild_permissions.manage_guild:
                raise HTTPException(403, "You need Manage Server in this guild")
            if table == "guild_icons":
                await conn.execute(
                    f"DELETE FROM {db_table} WHERE guild_id = $1 AND icon_key = $2",
                    user_id,
                    key,
                )
            else:
                await conn.execute(
                    f"DELETE FROM {db_table} WHERE guild_id = $1 AND id = $2",
                    user_id,
                    int(key),
                )
        elif table == "avatars":
            if int(me["id"]) != user_id:
                raise HTTPException(403, "You can only delete your own data")
            await conn.execute(
                f"DELETE FROM {db_table} WHERE user_id = $1 AND avatar_key = $2",
                user_id,
                key,
            )
        else:
            if int(me["id"]) != user_id:
                raise HTTPException(403, "You can only delete your own data")
            await conn.execute(
                f"DELETE FROM {db_table} WHERE user_id = $1 AND id = $2",
                user_id,
                int(key),
            )
    return {"deleted": True}


def _require_website_origin(request: Request) -> None:
    if request.headers.get("origin") not in WEB_ORIGINS:
        raise HTTPException(403, "This endpoint is available from the Fishie website")


def _client_ip(request: Request) -> str:
    remote = request.client.host if request.client else ""
    configured = os.environ.get("FISHIE_TRUSTED_PROXIES", "127.0.0.1,::1").split(",")
    networks: list[ipaddress._BaseNetwork] = []
    for value in configured:
        try:
            network = ipaddress.ip_network(value.strip(), strict=False)
        except ValueError:
            continue
        if network.prefixlen:
            networks.append(network)
    try:
        remote_ip = ipaddress.ip_address(remote)
        trusted = any(remote_ip in network for network in networks)
    except ValueError:
        trusted = False
    candidate = remote
    if trusted:
        candidate = (
            (
                request.headers.get("CF-Connecting-IP")
                or request.headers.get("X-Real-IP")
                or remote
            )
            .split(",", 1)[0]
            .strip()
        )
    try:
        return str(ipaddress.ip_address(candidate))
    except ValueError as error:
        raise HTTPException(400, "Invalid client address") from error


def _normalise_spotify_query(value: str) -> str:
    return " ".join(value.casefold().split())


def _check_spotify_cover_rate(ip: str) -> None:
    now = time.monotonic()
    timestamps = [
        timestamp
        for timestamp in _spotify_cover_rate.get(ip, [])
        if now - timestamp < SPOTIFY_COVER_RATE_WINDOW
    ]
    if len(timestamps) >= SPOTIFY_COVER_RATE_LIMIT:
        retry_after = max(
            1,
            int(SPOTIFY_COVER_RATE_WINDOW - (now - timestamps[0])) + 1,
        )
        raise HTTPException(
            429,
            "Too many cover lookups; please try again later",
            headers={"Retry-After": str(retry_after)},
        )
    timestamps.append(now)
    _spotify_cover_rate[ip] = timestamps


def _spotify_cache_get(
    cache: dict[tuple[str, str], tuple[float, str]],
    key: tuple[str, str],
) -> str | None:
    entry = cache.get(key)
    if entry is None:
        return None
    expires, value = entry
    if expires <= time.monotonic():
        cache.pop(key, None)
        return None
    return value


@app.get("/spotify-cover")
async def spotify_cover(
    request: Request,
    artist: str = Query(..., min_length=1, max_length=200),
    track: str = Query(..., min_length=1, max_length=200),
):
    """Search Spotify for a track cover image with bounded public access."""
    if not bot_ref:
        raise HTTPException(503, "Bot not ready")
    _require_website_origin(request)
    ip = _client_ip(request)
    _check_spotify_cover_rate(ip)
    cache_key = (_normalise_spotify_query(artist), _normalise_spotify_query(track))
    cached = _spotify_cache_get(_spotify_cover_cache, cache_key)
    if cached:
        return {"url": cached}
    negative_until = _spotify_cover_negative_cache.get(cache_key)
    if negative_until and negative_until > time.monotonic():
        raise HTTPException(404, "No cover found")
    if negative_until:
        _spotify_cover_negative_cache.pop(cache_key, None)

    sid = bot_ref.config["keys"]["spotify_id"]
    ss = bot_ref.config["keys"]["spotify_secret"]
    encoded = base64.b64encode(f"{sid}:{ss}".encode("ascii")).decode("ascii")
    async with _spotify_cover_semaphore:
        session = getattr(bot_ref, "session", None)
        owns_session = session is None
        if owns_session:
            session = aiohttp.ClientSession()
        try:
            token = getattr(bot_ref, "spotify_key", None)
            if token is None:
                async with _spotify_cover_token_lock:
                    token = getattr(bot_ref, "spotify_key", None)
                    if token is None:
                        async with session.post(
                            "https://accounts.spotify.com/api/token",
                            data={"grant_type": "client_credentials"},
                            headers={
                                "Authorization": f"Basic {encoded}",
                                "Content-Type": "application/x-www-form-urlencoded",
                            },
                            timeout=aiohttp.ClientTimeout(total=10),
                        ) as resp:
                            if resp.status != 200:
                                raise HTTPException(502, "Spotify auth failed")
                            token_data = await resp.json()
                        token = token_data.get("access_token")
                        if not isinstance(token, str) or not token:
                            raise HTTPException(502, "Spotify auth returned no token")
                        bot_ref.spotify_key = token
            async with session.get(
                "https://api.spotify.com/v1/search",
                params={
                    "q": f"track:{track} artist:{artist}",
                    "type": "track",
                    "limit": 1,
                },
                headers={"Authorization": f"Bearer {token}"},
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                if resp.status != 200:
                    raise HTTPException(502, "Spotify search failed")
                data = await resp.json()
        finally:
            if owns_session:
                await session.close()
    items = data.get("tracks", {}).get("items", [])
    images = items[0].get("album", {}).get("images", []) if items else []
    cover_url = images[0].get("url") if images and isinstance(images[0], dict) else None
    if not isinstance(cover_url, str) or not cover_url:
        _spotify_cover_negative_cache[cache_key] = time.monotonic() + 300
        raise HTTPException(404, "No cover found")
    _spotify_cover_cache[cache_key] = (time.monotonic() + 600, cover_url)
    return {"url": cover_url}


class MessagePayload(BaseModel):
    name: str = Field(..., min_length=1, max_length=50)
    content: str = Field(..., min_length=1, max_length=2000)
    avatar_url: str | None = Field(None, max_length=2048)
    discord_id: str | None = Field(None, pattern=r"^[0-9]{1,20}$")


_msg_rate_limit: dict[str, float] = {}


def _message_challenge_secret() -> bytes:
    if bot_ref is None:
        raise HTTPException(503, "Bot not ready")
    keys = bot_ref.config.get("keys", {})
    secret = (
        keys.get("message_challenge")
        or keys.get("message_challenge_secret")
        or keys.get("client_secret")
    )
    if not isinstance(secret, str) or not secret:
        raise HTTPException(503, "Message challenge is not configured")
    return secret.encode()


def _message_challenge(ip: str) -> str:
    issued = int(time.time())
    secret = _message_challenge_secret()
    payload = json.dumps(
        {
            "issued": issued,
            "nonce": secrets.token_urlsafe(24),
            "ip": hmac.new(secret, ip.encode(), hashlib.sha256).hexdigest(),
        },
        separators=(",", ":"),
        sort_keys=True,
    ).encode()
    encoded = base64.urlsafe_b64encode(payload).decode().rstrip("=")
    signature = hmac.new(secret, encoded.encode(), hashlib.sha256).hexdigest()
    return f"{encoded}.{signature}"


def _verify_message_challenge(
    supplied: str | None,
    cookie: str | None,
    ip: str,
) -> str:
    if not supplied or not cookie or not hmac.compare_digest(supplied, cookie):
        raise HTTPException(403, "Missing or invalid message challenge")
    try:
        encoded, signature = supplied.split(".", 1)
        secret = _message_challenge_secret()
        expected = hmac.new(secret, encoded.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected):
            raise ValueError("invalid signature")
        padding = "=" * (-len(encoded) % 4)
        payload = json.loads(base64.urlsafe_b64decode(encoded + padding))
        issued = int(payload["issued"])
        ip_digest = str(payload["ip"])
    except (
        binascii.Error,
        KeyError,
        TypeError,
        ValueError,
        json.JSONDecodeError,
    ):
        raise HTTPException(403, "Missing or invalid message challenge")
    if abs(time.time() - issued) > MESSAGE_CHALLENGE_MAX_AGE:
        raise HTTPException(403, "Message challenge expired")
    expected_ip = hmac.new(secret, ip.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(ip_digest, expected_ip):
        raise HTTPException(403, "Message challenge does not match this client")
    token_hash = hashlib.sha256(supplied.encode()).hexdigest()
    now = time.time()
    for key, expires in list(_message_used_challenges.items()):
        if expires <= now:
            _message_used_challenges.pop(key, None)
    if token_hash in _message_used_challenges:
        raise HTTPException(403, "Message challenge has already been used")
    return token_hash


async def _consume_message_challenge(token_hash: str, ip: str) -> None:
    now = time.monotonic()
    async with _message_rate_lock:
        if token_hash in _message_used_challenges:
            raise HTTPException(403, "Message challenge has already been used")
        last = _msg_rate_limit.get(ip, 0)
        if now - last < 60:
            retry_after = max(1, int(60 - (now - last)) + 1)
            raise HTTPException(
                429,
                "Please wait before sending another message",
                headers={"Retry-After": str(retry_after)},
            )
        while (
            _message_global_requests
            and now - _message_global_requests[0] >= MESSAGE_GLOBAL_RATE_WINDOW
        ):
            _message_global_requests.popleft()
        if len(_message_global_requests) >= MESSAGE_GLOBAL_RATE_LIMIT:
            retry_after = max(
                1,
                int(MESSAGE_GLOBAL_RATE_WINDOW - (now - _message_global_requests[0]))
                + 1,
            )
            raise HTTPException(
                429,
                "Message service is busy; please try again later",
                headers={"Retry-After": str(retry_after)},
            )
        _message_global_requests.append(now)
        _msg_rate_limit[ip] = now
        _message_used_challenges[token_hash] = time.time() + MESSAGE_CHALLENGE_MAX_AGE


def _sanitize_message_text(value: str) -> str:
    return re.sub(
        r"@(everyone|here|&\d+|!?\d+)",
        lambda match: "@\u200b" + match.group(1),
        value,
        flags=re.IGNORECASE,
    )


@app.get("/send-message/challenge")
async def send_message_challenge(response: Response, request: Request):
    _require_website_origin(request)
    ip = _client_ip(request)
    token = _message_challenge(ip)
    response.set_cookie(
        key=MESSAGE_CHALLENGE_COOKIE,
        value=token,
        max_age=MESSAGE_CHALLENGE_MAX_AGE,
        secure=True,
        httponly=True,
        samesite="strict",
        path="/",
    )
    response.headers["Cache-Control"] = "no-store"
    return {"token": token, "expires_in": MESSAGE_CHALLENGE_MAX_AGE}


@app.post("/send-message")
async def send_message(
    payload: MessagePayload,
    request: Request,
    authorization: str | None = Header(None),
    session_id: str | None = Cookie(None, alias=SESSION_COOKIE),
    challenge: str | None = Header(None, alias="X-Fishie-Message-Challenge"),
    challenge_cookie: str | None = Cookie(None, alias=MESSAGE_CHALLENGE_COOKIE),
):
    if not bot_ref:
        raise HTTPException(503, "Bot not ready")

    _require_website_origin(request)

    webhook_url = bot_ref.config["webhooks"].get("messages", "")
    if not webhook_url:
        raise HTTPException(500, "Webhook not configured")

    ip = _client_ip(request)

    if ip in bot_ref.cached_banned_ips:
        raise HTTPException(403, "You are banned from sending messages")

    challenge_hash = _verify_message_challenge(challenge, challenge_cookie, ip)
    await _consume_message_challenge(challenge_hash, ip)

    if payload.avatar_url:
        _validate_discord_avatar_url(payload.avatar_url)

    # A Discord ID is an identity claim, so it must always be tied to an
    # authenticated Fishie session (or bearer token). Anonymous submissions
    # remain available when no ID is supplied.
    if payload.discord_id:
        user = await _verify_token(authorization, session_id)
        if not hmac.compare_digest(str(user.get("id", "")), payload.discord_id):
            raise HTTPException(403, "The Discord identity does not match your session")

    # sanitize
    name = _sanitize_message_text(
        payload.name.replace("discord.com/api/webhooks", "[redacted]")
    )
    content = _sanitize_message_text(
        payload.content.replace("discord.com/api/webhooks", "[redacted]")
    )

    embed = {
        "author": (
            {"name": name, "icon_url": payload.avatar_url}
            if payload.avatar_url
            else {"name": name}
        ),
        "description": content,
        "footer": {"text": f"IP: {ip}"},
        "color": 0xFAA0C1,
    }
    if payload.discord_id:
        embed["footer"]["text"] += f" · ID: {payload.discord_id}"

    async with aiohttp.ClientSession() as session:
        async with session.post(
            webhook_url,
            json={
                "embeds": [embed],
                "allowed_mentions": {"parse": []},
            },
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            if resp.status not in (200, 204):
                raise HTTPException(500, f"Webhook returned {resp.status}")

    return {"ok": True}


@app.get("/ror2-items")
async def get_ror2_items():
    """Return all RoR2 items from the database."""
    if not bot_ref:
        raise HTTPException(503, "Bot not ready")
    pool = bot_ref.pool
    if not pool:
        raise HTTPException(503, "Database not connected")
    rows = await pool.fetch("SELECT * FROM ror2_items ORDER BY name")
    items = []
    for r in rows:
        items.append(
            {
                "internal_name": r["internal_name"],
                "name": r["name"],
                "desc_short": r.get("desc_short", ""),
                "desc_full": r.get("desc_full", ""),
                "rarity": r.get("rarity", ""),
                "categories": r.get("categories", []),
                "achievement_locked": r.get("achievement_locked", ""),
                "stats": r.get("stats") or {},
                "lore": r.get("lore", ""),
                "corrupted_iname": r.get("corrupted_iname", ""),
                "extra": r.get("extra") or {},
            }
        )
    return {"items": items, "count": len(items)}


@app.get("/user/{user_id}/reminders")
async def get_user_reminders(
    user_id: int,
    authorization: str | None = Header(None),
    session_id: str | None = Cookie(None, alias=SESSION_COOKIE),
):
    """Get reminders for a user. Requires OAuth."""
    me = await _verify_token(authorization, session_id)
    if int(me["id"]) != user_id:
        raise HTTPException(403, "You can only view your own reminders")
    pool = _check_pool()
    rows = await pool.fetch(
        "SELECT id, expires, created, event, timezone, extra #>> '{args,2}' AS content "
        "FROM reminders WHERE event = 'reminder' AND extra #>> '{args,0}' = $1 ORDER BY expires",
        str(user_id),
    )
    return {
        "reminders": [
            {
                "id": r["id"],
                "expires": str(r["expires"]),
                "content": r["content"],
                "timezone": r["timezone"],
            }
            for r in rows
        ]
    }


@app.get("/user/{user_id}/first-command")
async def get_user_first_command(
    user_id: int,
    authorization: str | None = Header(None),
    session_id: str | None = Cookie(None, alias=SESSION_COOKIE),
):
    """Get the date of a user's first command use."""
    await _history_visible_to(user_id, authorization, session_id)
    pool = _check_pool()
    row = await pool.fetchrow(
        "SELECT created_at FROM command_logs WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1",
        user_id,
    )
    return {"first_command": str(row["created_at"]) if row else None}


@app.get("/user/{user_id}/accounts")
async def get_user_accounts(
    user_id: int,
    authorization: str | None = Header(None),
    session_id: str | None = Cookie(None, alias=SESSION_COOKIE),
):
    """Get connected accounts for a user. Requires OAuth."""
    me = await _verify_token(authorization, session_id)
    if int(me["id"]) != user_id:
        raise HTTPException(403, "You can only view your own accounts")
    pool = _check_pool()
    row = await pool.fetchrow("SELECT * FROM accounts WHERE user_id = $1", user_id)
    if not row:
        return {"accounts": {}}
    accounts = {field: row[field] for field in LASTFM_ACCOUNT_FIELDS if row[field]}
    if row["steam"]:
        display_name = await _steam_display_name(row["steam"])
        if display_name:
            accounts["steam_display_name"] = display_name
    return {"accounts": accounts}


@app.post("/user/{user_id}/accounts")
async def set_user_accounts(
    user_id: int,
    payload: dict = Body(...),
    authorization: str | None = Header(None),
    session_id: str | None = Cookie(None, alias=SESSION_COOKIE),
):
    """Set connected accounts. Requires OAuth."""
    me = await _verify_token(authorization, session_id)
    if int(me["id"]) != user_id:
        raise HTTPException(403, "Not your account")
    # Last.fm and Steam can only be changed through their authorization flows.
    allowed = {"roblox", "letterboxd"}
    accounts = {k: v for k, v in payload.get("accounts", {}).items() if k in allowed}
    pool = _check_pool()
    if accounts:
        keys = ", ".join(accounts.keys())
        vals = ", ".join(f"${i+2}" for i in range(len(accounts)))
        placeholders = list(accounts.values())
        await pool.execute(
            f"INSERT INTO accounts (user_id, {keys}) VALUES ($1, {vals}) ON CONFLICT (user_id) DO UPDATE SET {', '.join(f'{k}=EXCLUDED.{k}' for k in accounts)}",
            user_id,
            *placeholders,
        )
    return {"accounts": accounts}


@app.delete("/user/{user_id}/lastfm")
async def disconnect_lastfm(
    user_id: int,
    authorization: str | None = Header(None),
    session_id: str | None = Cookie(None, alias=SESSION_COOKIE),
):
    """Disconnect Last.fm for the authenticated Discord user."""
    me = await _verify_token(authorization, session_id)
    if int(me["id"]) != user_id:
        raise HTTPException(403, "Not your account")
    pool = _check_pool()
    await pool.execute(
        "UPDATE accounts SET lastfm = NULL, lastfm_session_key = NULL WHERE user_id = $1",
        user_id,
    )
    if bot_ref:
        bot_ref.db_cache.lastfm.pop(user_id, None)
    return {"disconnected": True}


@app.delete("/user/{user_id}/steam")
async def disconnect_steam(
    user_id: int,
    authorization: str | None = Header(None),
    session_id: str | None = Cookie(None, alias=SESSION_COOKIE),
):
    """Disconnect Steam for the authenticated Discord user."""
    me = await _verify_token(authorization, session_id)
    if int(me["id"]) != user_id:
        raise HTTPException(403, "Not your account")
    pool = _check_pool()
    await pool.execute("UPDATE accounts SET steam = NULL WHERE user_id = $1", user_id)
    return {"disconnected": True}


@app.delete("/user/{user_id}/anilist")
async def disconnect_anilist(
    user_id: int,
    authorization: str | None = Header(None),
    session_id: str | None = Cookie(None, alias=SESSION_COOKIE),
):
    """Disconnect AniList for the authenticated Discord user."""
    me = await _verify_token(authorization, session_id)
    if int(me["id"]) != user_id:
        raise HTTPException(403, "Not your account")
    pool = _check_pool()
    await pool.execute(
        "UPDATE accounts SET anilist = NULL, anilist_access_token = NULL "
        "WHERE user_id = $1",
        user_id,
    )
    return {"disconnected": True}


@app.get("/guild/{guild_id}/settings")
async def get_guild_settings(
    guild_id: int,
    authorization: str | None = Header(None),
    session_id: str | None = Cookie(None, alias=SESSION_COOKIE),
):
    """Get guild settings. Requires OAuth."""
    me = await _verify_token(authorization, session_id)
    if not bot_ref:
        raise HTTPException(503, "Bot not ready")
    guild = bot_ref.get_guild(guild_id)
    if not guild:
        raise HTTPException(404, "Guild not found")
    member = guild.get_member(int(me["id"]))
    if not member or not member.guild_permissions.manage_guild:
        raise HTTPException(403, "Need Manage Server permission")
    pool = _check_pool()
    row = await pool.fetchrow(
        "SELECT * FROM guild_settings WHERE guild_id = $1", guild_id
    )
    hp = await pool.fetchrow(
        "SELECT channel_id FROM honeypot_channels WHERE guild_id = $1", guild_id
    )
    settings = {
        "auto_download": None,
        "poketwo": False,
        "auto_reactions": False,
        "pinboard": None,
        "honeypot": None,
    }
    if row:
        for k in ("auto_download", "poketwo", "auto_reactions", "pinboard"):
            settings[k] = row[k]
    if hp:
        settings["honeypot"] = hp["channel_id"]
    return settings


@app.post("/guild/{guild_id}/settings")
async def set_guild_settings(
    guild_id: int,
    payload: dict = Body(...),
    authorization: str | None = Header(None),
    session_id: str | None = Cookie(None, alias=SESSION_COOKIE),
):
    me = await _verify_token(authorization, session_id)
    if not bot_ref:
        raise HTTPException(503, "Bot not ready")
    guild = bot_ref.get_guild(guild_id)
    if not guild:
        raise HTTPException(404, "Guild not found")
    member = guild.get_member(int(me["id"]))
    if not member or not member.guild_permissions.manage_guild:
        raise HTTPException(403, "Need Manage Server permission")
    allowed = {"auto_download", "poketwo", "auto_reactions", "pinboard", "honeypot"}
    updates = {}
    pool = _check_pool()

    current = await pool.fetchrow(
        "SELECT auto_download, poketwo, auto_reactions, pinboard "
        "FROM guild_settings WHERE guild_id = $1",
        guild_id,
    )
    current_honeypot = await pool.fetchval(
        "SELECT channel_id FROM honeypot_channels WHERE guild_id = $1", guild_id
    )

    if "honeypot" in payload:
        hp_val = payload["honeypot"]
        if hp_val:
            try:
                hp_val = int(hp_val)
            except (TypeError, ValueError):
                raise HTTPException(400, "honeypot must be a channel ID")
            await pool.execute(
                "INSERT INTO honeypot_channels (guild_id, channel_id) VALUES ($1, $2) "
                "ON CONFLICT (guild_id) DO UPDATE SET channel_id = $2",
                guild_id,
                hp_val,
            )
        else:
            await pool.execute(
                "DELETE FROM honeypot_channels WHERE guild_id = $1", guild_id
            )
        updates["honeypot"] = hp_val

    gs_updates = {}
    for key, value in payload.items():
        if key not in allowed or key == "honeypot":
            continue
        if key in {"auto_download", "pinboard"}:
            if value in (None, ""):
                value = None
            else:
                try:
                    value = int(value)
                except (TypeError, ValueError):
                    raise HTTPException(400, f"{key} must be a channel ID")
        elif key in {"poketwo", "auto_reactions"}:
            if isinstance(value, str):
                value = value.strip().lower() in {"1", "true", "yes", "on"}
            else:
                value = bool(value)
        gs_updates[key] = value

    if gs_updates:
        keys = ", ".join(gs_updates.keys())
        placeholders = ", ".join(f"${i+2}" for i in range(len(gs_updates)))
        set_clause = ", ".join(f"{k} = EXCLUDED.{k}" for k in gs_updates)
        await pool.execute(
            f"INSERT INTO guild_settings (guild_id, {keys}) VALUES ($1, {placeholders}) ON CONFLICT (guild_id) DO UPDATE SET {set_clause}",
            guild_id,
            *list(gs_updates.values()),
        )
        for k, v in gs_updates.items():
            updates[k] = v

    # Keep the running bot in sync with dashboard changes.  These values are
    # read from db_cache by the event cogs and are otherwise stale until restart.
    cache = bot_ref.db_cache
    if "auto_download" in gs_updates:
        old = current["auto_download"] if current else None
        if old:
            cache.remove_adl(old)
        if gs_updates["auto_download"]:
            cache.add_adl(gs_updates["auto_download"])
    if "poketwo" in gs_updates:
        if gs_updates["poketwo"]:
            if guild_id not in cache.poketwo_guilds:
                cache.add_poketwo(guild_id)
        else:
            cache.remove_poketwo(guild_id)
    if "auto_reactions" in gs_updates:
        if gs_updates["auto_reactions"]:
            if guild_id not in cache.auto_reaction_guilds:
                cache.add_reaction_guilds(guild_id)
        else:
            cache.remove_reaction_guilds(guild_id)
    if "pinboard" in gs_updates:
        cache.pinboard.pop(guild_id, None)
        if gs_updates["pinboard"]:
            cache.add_pinboard(guild_id, gs_updates["pinboard"])
    if "honeypot" in updates:
        if current_honeypot:
            bot_ref.cached_honeypots.discard(current_honeypot)
        if updates["honeypot"]:
            bot_ref.cached_honeypots.add(updates["honeypot"])

    return {"settings": updates}


def _dashboard_command_list():
    if not bot_ref:
        return []
    bot = bot_ref
    commands_by_name = {}

    def add_command(command):
        if (
            command.hidden
            or command.cog_name in ("Owner", "Jishaku")
            or bot._command_disable_excluded(command)
        ):
            return
        name = command.qualified_name.casefold()
        commands_by_name[name] = {
            "name": command.qualified_name,
            "description": command.description or command.short_doc or "",
        }

    for command in bot_ref.commands:
        add_command(command)
    return sorted(commands_by_name.values(), key=lambda item: item["name"].casefold())


async def _managed_guild(
    guild_id: int,
    authorization: str | None,
    session_id: str | None = None,
):
    return await _require_guild_manager(guild_id, authorization, session_id)


@app.get("/guild/{guild_id}/command-disables")
async def get_command_disables(
    guild_id: int,
    authorization: str | None = Header(None),
    session_id: str | None = Cookie(None, alias=SESSION_COOKIE),
):
    """Return command controls for a server managed by the authenticated user."""
    guild = await _managed_guild(guild_id, authorization, session_id)
    pool = _check_pool()
    rows = await pool.fetch(
        "SELECT command, channel_id FROM command_disables WHERE guild_id = $1",
        guild_id,
    )
    return {
        "commands": _dashboard_command_list(),
        "channels": [
            {"id": str(channel.id), "name": channel.name}
            for channel in guild.text_channels
        ],
        "disabled": [
            {"command": row["command"], "channel_id": int(row["channel_id"])}
            for row in rows
        ],
    }


@app.post("/guild/{guild_id}/command-disables")
async def set_command_disable(
    guild_id: int,
    payload: dict = Body(...),
    authorization: str | None = Header(None),
    session_id: str | None = Cookie(None, alias=SESSION_COOKIE),
):
    """Enable or disable one command server-wide or in a text channel."""
    guild = await _managed_guild(guild_id, authorization, session_id)
    if not bot_ref:
        raise HTTPException(503, "Bot not ready")

    requested = str(payload.get("command", "")).strip()
    command = bot_ref.get_command(requested.casefold())
    if command is None or command.qualified_name.casefold() != requested.casefold():
        raise HTTPException(400, "Unknown command")
    if bot_ref._command_disable_excluded(command):
        raise HTTPException(400, "This command cannot be disabled")

    raw_channel_id = payload.get("channel_id", 0)
    try:
        channel_id = int(raw_channel_id or 0)
    except (TypeError, ValueError):
        raise HTTPException(400, "channel_id must be a text channel ID or 0")
    if channel_id:
        channel = guild.get_channel(channel_id)
        if channel is None or channel not in guild.text_channels:
            raise HTTPException(
                400, "channel_id must belong to a text channel in this server"
            )

    pool = _check_pool()
    command_name = command.qualified_name.casefold()
    if bool(payload.get("disabled")):
        await pool.execute(
            """
            INSERT INTO command_disables (guild_id, command, channel_id)
            VALUES ($1, $2, $3)
            ON CONFLICT (guild_id, command, channel_id) DO NOTHING
            """,
            guild_id,
            command_name,
            channel_id,
        )
        bot_ref.db_cache.add_disabled_command(guild_id, command_name, channel_id)
        disabled = True
    else:
        await pool.execute(
            "DELETE FROM command_disables WHERE guild_id = $1 AND command = $2 AND channel_id = $3",
            guild_id,
            command_name,
            channel_id,
        )
        bot_ref.db_cache.remove_disabled_command(guild_id, command_name, channel_id)
        disabled = False
    return {"command": command_name, "channel_id": channel_id, "disabled": disabled}


@app.get("/guild/{guild_id}/prefixes")
async def get_guild_prefixes(
    guild_id: int,
    authorization: str | None = Header(None),
    session_id: str | None = Cookie(None, alias=SESSION_COOKIE),
):
    """Get custom prefixes for a guild managed by the authenticated user."""
    await _managed_guild(guild_id, authorization, session_id)
    pool = _check_pool()
    rows = await pool.fetch(
        "SELECT prefix, author_id, time FROM guild_prefixes WHERE guild_id = $1 ORDER BY time",
        guild_id,
    )
    return {
        "prefixes": [
            {"prefix": r["prefix"], "author_id": r["author_id"], "time": str(r["time"])}
            for r in rows
        ]
    }


@app.post("/guild/{guild_id}/prefixes")
async def add_guild_prefix(
    guild_id: int,
    payload: dict = Body(...),
    authorization: str | None = Header(None),
    session_id: str | None = Cookie(None, alias=SESSION_COOKIE),
):
    """Add a custom prefix. Requires OAuth + Manage Server."""
    try:
        me = await _verify_token(authorization, session_id)
        if not bot_ref:
            raise HTTPException(503, "Bot not ready")
        guild = bot_ref.get_guild(guild_id)
        if not guild:
            raise HTTPException(404, "Guild not found")
        member = guild.get_member(int(me["id"]))
        if not member or not member.guild_permissions.manage_guild:
            raise HTTPException(403, "Need Manage Server permission")
        prefix = payload.get("prefix", "").strip()
        if not prefix or len(prefix) > 10:
            raise HTTPException(400, "Prefix must be 1-10 characters")
        pool = _check_pool()
        await pool.execute(
            "INSERT INTO guild_prefixes (guild_id, prefix, author_id, time) VALUES ($1, $2, $3, NOW()) ON CONFLICT (guild_id, prefix) DO UPDATE SET author_id = EXCLUDED.author_id, time = NOW()",
            guild_id,
            prefix,
            int(payload.get("author_id", me["id"])),
        )
        if bot_ref:
            bot_ref.db_cache.add_prefix(guild_id, prefix)
        return {"prefix": prefix}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("add_guild_prefix failed")
        raise HTTPException(500, "Internal server error") from e


@app.delete("/guild/{guild_id}/prefixes")
async def remove_guild_prefix(
    guild_id: int,
    payload: dict = Body(...),
    authorization: str | None = Header(None),
    session_id: str | None = Cookie(None, alias=SESSION_COOKIE),
):
    """Remove a custom prefix. Requires OAuth + Manage Server."""
    me = await _verify_token(authorization, session_id)
    if not bot_ref:
        raise HTTPException(503, "Bot not ready")
    guild = bot_ref.get_guild(guild_id)
    if not guild:
        raise HTTPException(404, "Guild not found")
    member = guild.get_member(int(me["id"]))
    if not member or not member.guild_permissions.manage_guild:
        raise HTTPException(403, "Need Manage Server permission")
    prefix = payload.get("prefix", "").strip()
    pool = _check_pool()
    await pool.execute(
        "DELETE FROM guild_prefixes WHERE guild_id = $1 AND prefix = $2",
        guild_id,
        prefix,
    )
    if bot_ref:
        bot_ref.db_cache.remove_prefix(guild_id, prefix)
    return {"prefix": prefix}


@app.delete("/guild/{guild_id}/data")
async def delete_guild_data(
    guild_id: int,
    authorization: str | None = Header(None),
    session_id: str | None = Cookie(None, alias=SESSION_COOKIE),
):
    """Delete all tracking data for a guild. Requires OAuth + Manage Server."""
    me = await _verify_token(authorization, session_id)
    if not bot_ref:
        raise HTTPException(503, "Bot not ready")
    guild = bot_ref.get_guild(guild_id)
    if not guild:
        raise HTTPException(404, "Guild not found")
    member = guild.get_member(int(me["id"]))
    if not member or not member.guild_permissions.manage_guild:
        raise HTTPException(403, "Need Manage Server permission")
    pool = _check_pool()
    for table in ("guild_icons", "guild_name_logs", "guild_avatars"):
        await pool.execute(f"DELETE FROM {table} WHERE guild_id = $1", guild_id)
    for table in (
        "guild_settings",
        "honeypot_channels",
        "guild_prefixes",
        "guild_opted_out",
    ):
        await pool.execute(f"DELETE FROM {table} WHERE guild_id = $1", guild_id)
    return {"deleted": True}
