"""
Avatar lookup API — FastAPI + discord.py in one process.

GET  /avatars?q=<discord_id>&page=1&per_page=100
     → { avatars: [{ url, avatar_key, created_at }], total, page, pages }

The Discord bot is used to:
  1. Resolve username → user_id (via guild member search)
  2. Refresh stale CDN URLs via POST /attachments/refresh-urls
"""

import asyncio
import os
import asyncpg
import uvicorn
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from discord.ext import commands
from discord.http import Route
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "config", ".env"))

TOKEN = os.getenv("DISCORD_BOT_TOKEN")
GUILD_ID = int(os.getenv("DISCORD_GUILD_ID", "0") or "0")
DB_URL = os.getenv("DATABASE_URL")

bot = commands.Bot(command_prefix=commands.when_mentioned, intents=None)
db_pool: asyncpg.Pool | None = None
bot.help_command = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global db_pool
    db_pool = await asyncpg.create_pool(DB_URL, min_size=1, max_size=4)
    await bot.load_extension("jishaku")
    asyncio.create_task(bot.start(TOKEN))
    yield
    await db_pool.close()
    await bot.close()


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

async def resolve_user_id(query: str) -> int:
    """Accept a raw Discord ID or a username (requires guild)."""
    q = query.strip()
    if q.isdigit():
        return int(q)

    if not GUILD_ID:
        raise HTTPException(400, "Username lookup requires DISCORD_GUILD_ID to be set. Use your Discord ID instead.")

    guild = bot.get_guild(GUILD_ID)
    if not guild:
        raise HTTPException(502, "Bot is not in the configured guild.")

    # Search members by name
    members = await guild.query_members(q, limit=5)
    for m in members:
        if m.name.lower() == q.lower() or (m.global_name and m.global_name.lower() == q.lower()):
            return m.id
    if members:
        return members[0].id

    raise HTTPException(404, f'No guild member matched "{q}". Try your Discord ID instead.')


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
            continue

    return [mapping.get(u.split("?")[0], u) for u in urls]


@app.get("/avatars")
async def get_avatars(
    q: str = Query(..., description="Discord user ID or username"),
    page: int = Query(1, ge=1),
    per_page: int = Query(100, ge=1, le=100),
):
    user_id = await resolve_user_id(q)

    async with db_pool.acquire() as conn:
        count_row = await conn.fetchrow(
            "SELECT COUNT(*) FROM avatars WHERE user_id = $1", user_id
        )
        total = count_row[0]
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
    uvicorn.run(app, host="0.0.0.0", port=8000)
