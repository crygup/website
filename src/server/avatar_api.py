"""
Avatar lookup API FastAPI + discord.py in one process.

GET  /avatars?q=<discord_id>&page=1&per_page=100
     → { avatars: [{ url, avatar_key, created_at }], total, page, pages }

The Discord bot is used to:
  1. Resolve username → user_id (via guild member search)
  2. Refresh stale CDN URLs via POST /attachments/refresh-urls
"""

import asyncio
import hashlib
import os
import sys
from contextlib import asynccontextmanager, suppress

import asyncpg
import uvicorn
from fastapi import Cookie, FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from discord.ext import commands
from discord.http import Route
from discord import gateway, CustomActivity, Intents
import dotenv
from logging_utils import get_logger

CONFIG_FILE = os.environ.get(
    "WEBSITE_CONFIG_FILE",
    os.path.join(os.path.dirname(__file__), "config", ".env"),
)
dotenv.load_dotenv(CONFIG_FILE)


def required_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


TOKEN = required_env("DISCORD_BOT_TOKEN")
GUILD_ID = int(os.getenv("DISCORD_GUILD_ID", "0") or "0")
DB_URL = required_env("DATABASE_URL")
logger = get_logger("avatar")
SESSION_COOKIE = "__Host-fishie_session"


async def identify_mobile(self) -> None:
    """Sends the IDENTIFY packet."""
    payload = {
        "op": self.IDENTIFY,
        "d": {
            "token": self.token,
            "properties": {
                "os": sys.platform,
                "browser": "Discord iOS",
                "device": "Discord iOS",
            },
            "compress": True,
            "large_threshold": 250,
        },
    }

    if self.shard_id is not None and self.shard_count is not None:
        payload["d"]["shard"] = [self.shard_id, self.shard_count]

    state = self._connection
    if state._activity is not None or state._status is not None:
        payload["d"]["presence"] = {
            "status": state._status,
            "game": state._activity,
            "since": 0,
            "afk": False,
        }

    if state._intents is not None:
        payload["d"]["intents"] = state._intents.value

    await self.call_hooks(
        "before_identify", self.shard_id, initial=self._initial_identify
    )
    await self.send_as_json(payload)


gateway.DiscordWebSocket.identify = identify_mobile
jsk_envs = [
    "JISHAKU_RETAIN",
    "JISHAKU_HIDE",
    "JISHAKU_NO_DM_TRACEBACK",
    "JISHAKU_NO_UNDERSCORE",
    "JISHAKU_FORCE_PAGINATOR",
]

for env in jsk_envs:
    os.environ[env] = "True"

bot = commands.Bot(
    command_prefix=commands.when_mentioned_or("evi "), intents=Intents.all()
)
db_pool: asyncpg.Pool | None = None
bot_task: asyncio.Task[None] | None = None
bot.help_command = None
bot.activity = CustomActivity(name="dr pepper is so good")


def get_db_pool() -> asyncpg.Pool:
    if db_pool is None:
        raise RuntimeError("Database pool is not initialized")
    return db_pool


@asynccontextmanager
async def lifespan(app: FastAPI):
    global bot_task, db_pool
    db_pool = await asyncpg.create_pool(DB_URL, min_size=1, max_size=4)
    await bot.load_extension("jishaku")
    bot_task = asyncio.create_task(bot.start(TOKEN), name="avatar-discord-bot")
    try:
        yield
    finally:
        await bot.close()
        if bot_task is not None:
            with suppress(asyncio.CancelledError):
                await bot_task
        pool = get_db_pool()
        await pool.close()
        bot_task = None
        db_pool = None


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://crygup.com", "https://www.crygup.com"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    allow_credentials=True,
)


@app.middleware("http")
async def log_requests(request, call_next):
    started = asyncio.get_running_loop().time()
    client = request.client.host if request.client else "-"
    try:
        response = await call_next(request)
    except Exception:
        logger.exception(
            "request method=%s path=%s status=500 duration_ms=%.1f client=%s",
            request.method,
            request.url.path,
            (asyncio.get_running_loop().time() - started) * 1000,
            client,
        )
        raise
    logger.info(
        "request method=%s path=%s status=%s duration_ms=%.1f client=%s",
        request.method,
        request.url.path,
        response.status_code,
        (asyncio.get_running_loop().time() - started) * 1000,
        client,
    )
    return response


@app.get("/health/live", include_in_schema=False)
async def health_live() -> Response:
    return Response(status_code=204)


@app.get("/health/ready", include_in_schema=False)
async def health_ready() -> Response:
    task = bot_task
    if task is None or task.done() or not bot.is_ready():
        raise HTTPException(503, "Discord client is not ready")

    try:
        async with get_db_pool().acquire() as conn:
            await conn.fetchval("SELECT 1")
    except Exception as exc:
        raise HTTPException(503, "Database is not ready") from exc

    return Response(status_code=204)


async def resolve_user_id(query: str) -> int:
    """Accept a raw Discord ID or a username (requires guild)."""
    q = query.strip()
    if q.isdigit():
        return int(q)

    if not GUILD_ID:
        raise HTTPException(
            400,
            "Username lookup requires DISCORD_GUILD_ID to be set. Use your Discord ID instead.",
        )

    guild = bot.get_guild(GUILD_ID)
    if not guild:
        raise HTTPException(502, "Bot is not in the configured guild.")

    # Search members by name
    members = await guild.query_members(q, limit=5)
    for m in members:
        if m.name.lower() == q.lower() or (
            m.global_name and m.global_name.lower() == q.lower()
        ):
            return m.id
    if members:
        return members[0].id

    raise HTTPException(
        404, f'No guild member matched "{q}". Try your Discord ID instead.'
    )


async def refresh_urls(urls: list[str]) -> list[str]:
    """Call Discord's refresh-urls endpoint to get fresh CDN links."""
    if not urls:
        return []
    clean = list({u.split("?")[0] for u in urls if u})
    if not clean:
        return []

    BATCH_SIZE = 50
    mapping: dict[str, str] = {}
    for i in range(0, len(clean), BATCH_SIZE):
        batch = clean[i : i + BATCH_SIZE]
        try:
            req: dict = await bot.http.request(
                Route("POST", "/attachments/refresh-urls"),
                json={"attachment_urls": batch},
            )
            refreshed = req.get("refreshed_urls", [])
            for item in refreshed:
                orig = item.get("original", "")
                refreshed_url = item.get("refreshed", "")
                mapping[orig] = refreshed_url or orig
        except Exception:
            logger.warning(
                "Discord attachment URL refresh failed for batch_size=%s",
                len(batch),
                exc_info=True,
            )
            continue

    return [mapping.get(u.split("?")[0], u) for u in urls]


@app.get("/avatars")
async def get_avatars(
    q: str = Query(..., description="Discord user ID or username"),
    page: int = Query(1, ge=1),
    per_page: int = Query(100, ge=1, le=100),
    session_id: str | None = Cookie(None, alias=SESSION_COOKIE),
):
    user_id = await resolve_user_id(q)

    pool = get_db_pool()
    async with pool.acquire() as conn:
        history_public = await conn.fetchval(
            "SELECT history_public FROM user_settings WHERE user_id = $1",
            user_id,
        )
        if history_public is False:
            viewer_id = None
            if session_id:
                viewer_id = await conn.fetchval(
                    """
                    SELECT user_id
                    FROM web_sessions
                    WHERE session_id_hash = $1 AND expires_at > now()
                    """,
                    hashlib.sha256(session_id.encode("utf-8")).hexdigest(),
                )
            if viewer_id != user_id:
                raise HTTPException(
                    403,
                    "This user has made their saved history private",
                )

        count_row = await conn.fetchrow(
            "SELECT COUNT(*) FROM avatars WHERE user_id = $1", user_id
        )
        if count_row is None:
            raise HTTPException(503, "Could not count stored avatars")
        total = int(count_row[0])
        pages = max(1, (total + per_page - 1) // per_page)

        if page > pages:
            return {"avatars": [], "total": total, "page": page, "pages": pages}

        rows = await conn.fetch(
            "SELECT avatar_key, created_at, avatar FROM avatars WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
            user_id,
            per_page,
            (page - 1) * per_page,
        )

    urls = [r["avatar"] for r in rows]
    try:
        fresh_urls = await refresh_urls(urls)
    except Exception:
        logger.warning(
            "Discord attachment URL refresh failed; returning cached URLs",
            exc_info=True,
        )
        fresh_urls = urls

    avatars = [
        {
            "url": fresh_urls[i],
            "avatar_key": rows[i]["avatar_key"],
            "created_at": rows[i]["created_at"].isoformat(),
        }
        for i in range(len(rows))
    ]

    return {"avatars": avatars, "total": total, "page": page, "pages": pages}


if __name__ == "__main__":
    uvicorn.run(
        app,
        host=os.environ.get("WEBSITE_API_HOST", "127.0.0.1"),
        port=int(os.environ.get("WEBSITE_API_PORT", "8000")),
    )
