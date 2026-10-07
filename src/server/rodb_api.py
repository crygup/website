"""Authenticated JSON storage for Roblox games."""

from __future__ import annotations

import hmac
import json
import os
import re
import unicodedata
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

import asyncpg
import uvicorn
from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware

from logging_utils import get_logger

HOST = os.environ.get("WEBSITE_RODB_HOST", "127.0.0.1")
PORT = int(os.environ.get("WEBSITE_RODB_PORT", "8005"))
API_KEY = os.environ.get("WEBSITE_RODB_KEY", "")
DB_HOST = os.environ.get("WEBSITE_RODB_DB_HOST", "robase-db")
DB_PORT = int(os.environ.get("WEBSITE_RODB_DB_PORT", "5432"))
DB_NAME = os.environ.get("WEBSITE_RODB_DB_NAME", "robase")
DB_USER = os.environ.get("WEBSITE_RODB_DB_USER", "robase")
DB_PASSWORD = os.environ.get("WEBSITE_RODB_DB_PASSWORD", "")
MAX_VALUE_BYTES = 256 * 1024
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")

SCHEMA = """
CREATE TABLE IF NOT EXISTS records (
    namespace varchar(64) NOT NULL,
    record_key varchar(128) NOT NULL,
    value jsonb NOT NULL,
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (namespace, record_key)
);

CREATE TABLE IF NOT EXISTS player_display_name_history (
    user_id bigint NOT NULL CHECK (user_id > 0),
    display_name varchar(50) NOT NULL,
    saved_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, saved_at)
);

CREATE TABLE IF NOT EXISTS player_joins (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL CHECK (user_id > 0),
    game_id bigint NOT NULL CHECK (game_id > 0),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS player_joins_lookup_idx
ON player_joins (user_id, game_id, created_at DESC);

ALTER TABLE player_joins ADD COLUMN IF NOT EXISTS event_id varchar(128);
ALTER TABLE player_joins ADD COLUMN IF NOT EXISTS request_data jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS player_joins_event_idx
ON player_joins (user_id, game_id, event_id) WHERE event_id IS NOT NULL;
"""

logger = get_logger("rodb")


def _require_key(request: Request) -> None:
    if len(API_KEY) < 32:
        raise HTTPException(status_code=503, detail="RObase is not configured.")
    supplied = request.headers.get("x-rodb-key", "")
    if not supplied or not hmac.compare_digest(supplied, API_KEY):
        raise HTTPException(status_code=401, detail="Invalid API key.")


def _validate_name(value: str, label: str, maximum: int) -> str:
    if len(value) > maximum or not NAME_RE.fullmatch(value):
        raise HTTPException(status_code=400, detail=f"Invalid {label}.")
    return value


def _validate_id(value: int, label: str) -> int:
    if value < 1 or value > 9_223_372_036_854_775_807:
        raise HTTPException(status_code=400, detail=f"Invalid {label}.")
    return value


def _validate_display_name(value: Any) -> str:
    if (
        not isinstance(value, str)
        or not 1 <= len(value) <= 50
        or not value.strip()
        or any(unicodedata.category(character) == "Cc" for character in value)
    ):
        raise HTTPException(status_code=400, detail="Invalid display name.")
    return value


def _parse_saved_at(value: Any) -> datetime:
    if not isinstance(value, str):
        raise HTTPException(
            status_code=400,
            detail="saved_at must be an ISO 8601 timestamp with a timezone.",
        )
    try:
        saved_at = datetime.fromisoformat(value)
    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail="saved_at must be an ISO 8601 timestamp with a timezone.",
        ) from error
    if saved_at.tzinfo is None or saved_at.utcoffset() is None:
        raise HTTPException(
            status_code=400,
            detail="saved_at must be an ISO 8601 timestamp with a timezone.",
        )
    return saved_at.astimezone(timezone.utc)


async def _save_display_name(
    connection: asyncpg.Connection | asyncpg.pool.PoolConnectionProxy,
    user_id: int,
    display_name: str,
    saved_at: datetime,
) -> datetime | None:
    previous_name = await connection.fetchval(
        """
        SELECT display_name
        FROM player_display_name_history
        WHERE user_id = $1
        ORDER BY saved_at DESC
        LIMIT 1
        """,
        user_id,
    )
    if previous_name == display_name:
        return None
    inserted_at = await connection.fetchval(
        """
        INSERT INTO player_display_name_history (user_id, display_name, saved_at)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id, saved_at) DO NOTHING
        RETURNING saved_at
        """,
        user_id,
        display_name,
        saved_at,
    )
    if inserted_at is None:
        existing_name = await connection.fetchval(
            "SELECT display_name FROM player_display_name_history "
            "WHERE user_id = $1 AND saved_at = $2",
            user_id,
            saved_at,
        )
        if existing_name != display_name:
            raise HTTPException(
                status_code=409,
                detail="A different display name is already saved at this timestamp.",
            )
    return inserted_at


def _record(row: asyncpg.Record) -> dict[str, Any]:
    return {
        "namespace": row["namespace"],
        "key": row["record_key"],
        "value": json.loads(row["value"]),
        "version": row["version"],
        "created_at": row["created_at"].isoformat(),
        "updated_at": row["updated_at"].isoformat(),
    }


def _etag(version: int) -> dict[str, str]:
    return {"ETag": f'"{version}"', "Cache-Control": "private, no-store"}


async def _read_json(request: Request) -> tuple[Any, str]:
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > MAX_VALUE_BYTES:
                raise HTTPException(status_code=413, detail="JSON value is too large.")
        except ValueError as error:
            raise HTTPException(
                status_code=400, detail="Invalid Content-Length."
            ) from error
    body = await request.body()
    if len(body) > MAX_VALUE_BYTES:
        raise HTTPException(status_code=413, detail="JSON value is too large.")
    try:
        value = json.loads(body)
        encoded = json.dumps(
            value,
            separators=(",", ":"),
            ensure_ascii=False,
            allow_nan=False,
        )
        return value, encoded
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
        raise HTTPException(
            status_code=400, detail="Request body must be valid JSON."
        ) from error


@asynccontextmanager
async def lifespan(app: FastAPI):
    if len(API_KEY) < 32 or len(DB_PASSWORD) < 16:
        raise RuntimeError("RObase secrets are not configured")
    pool = await asyncpg.create_pool(
        host=DB_HOST,
        port=DB_PORT,
        database=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
        min_size=1,
        max_size=10,
        command_timeout=10,
    )
    try:
        async with pool.acquire() as connection:
            await connection.execute(SCHEMA)
        app.state.pool = pool
        yield
    finally:
        await pool.close()


app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["crygup.com", "www.crygup.com", "127.0.0.1", "localhost"],
)


@app.get("/health/live", status_code=204)
async def live() -> Response:
    return Response(status_code=204)


@app.get("/health/ready", status_code=204)
async def ready(request: Request) -> Response:
    pool: asyncpg.Pool = request.app.state.pool
    async with pool.acquire() as connection:
        await connection.fetchval("SELECT 1")
    return Response(status_code=204)


@app.get("/rodb")
@app.get("/rodb/")
async def root(request: Request) -> Response:
    _require_key(request)
    raise HTTPException(status_code=400, detail="Use /rodb/v1/<namespace>/<key>.")


@app.get("/rodb/v1/{namespace}")
async def list_records(
    request: Request,
    namespace: str,
    prefix: str = "",
    after: str = "",
    limit: int = Query(default=50, ge=1, le=100),
) -> JSONResponse:
    _require_key(request)
    _validate_name(namespace, "namespace", 64)
    if prefix and (len(prefix) > 128 or not NAME_RE.fullmatch(prefix)):
        raise HTTPException(status_code=400, detail="Invalid key prefix.")
    if after:
        _validate_name(after, "pagination key", 128)

    pool: asyncpg.Pool = request.app.state.pool
    rows = await pool.fetch(
        """
        SELECT record_key, version, updated_at
        FROM records
        WHERE namespace = $1
          AND starts_with(record_key, $2)
          AND ($3 = '' OR record_key > $3)
        ORDER BY record_key
        LIMIT $4
        """,
        namespace,
        prefix,
        after,
        limit + 1,
    )
    page = rows[:limit]
    return JSONResponse(
        {
            "namespace": namespace,
            "records": [
                {
                    "key": row["record_key"],
                    "version": row["version"],
                    "updated_at": row["updated_at"].isoformat(),
                }
                for row in page
            ],
            "next_after": page[-1]["record_key"] if len(rows) > limit else None,
        },
        headers={"Cache-Control": "private, no-store"},
    )


@app.get("/rodb/v1/players/{user_id}/display-names")
async def display_name_history(
    request: Request,
    user_id: int,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> JSONResponse:
    _require_key(request)
    _validate_id(user_id, "user ID")
    pool: asyncpg.Pool = request.app.state.pool
    rows = await pool.fetch(
        """
        SELECT display_name, saved_at
        FROM player_display_name_history
        WHERE user_id = $1
        ORDER BY saved_at DESC
        LIMIT $2 OFFSET $3
        """,
        user_id,
        limit + 1,
        offset,
    )
    page = rows[:limit]
    return JSONResponse(
        {
            "user_id": user_id,
            "display_names": [
                {
                    "display_name": row["display_name"],
                    "saved_at": row["saved_at"].isoformat(),
                }
                for row in page
            ],
            "next_offset": offset + limit if len(rows) > limit else None,
        },
        headers={"Cache-Control": "private, no-store"},
    )


@app.post("/rodb/v1/players/display-names")
async def record_display_names(request: Request) -> JSONResponse:
    _require_key(request)
    payload, _ = await _read_json(request)
    submitted = payload.get("players") if isinstance(payload, dict) else None
    if not isinstance(submitted, list) or not 1 <= len(submitted) <= 100:
        raise HTTPException(
            status_code=400,
            detail="players must contain between 1 and 100 entries.",
        )

    players: dict[int, tuple[str, datetime]] = {}
    for entry in submitted:
        if not isinstance(entry, dict):
            raise HTTPException(status_code=400, detail="Invalid player entry.")
        user_id = entry.get("user_id")
        if not isinstance(user_id, int) or isinstance(user_id, bool):
            raise HTTPException(status_code=400, detail="Invalid user ID.")
        _validate_id(user_id, "user ID")
        display_name = _validate_display_name(entry.get("display_name"))
        saved_at = _parse_saved_at(entry.get("saved_at"))
        if user_id in players:
            del players[user_id]
        players[user_id] = (display_name, saved_at)

    pool: asyncpg.Pool = request.app.state.pool
    results = []
    async with pool.acquire() as connection, connection.transaction():
        for user_id in sorted(players):
            await connection.execute("SELECT pg_advisory_xact_lock($1)", user_id)
        for user_id, (display_name, saved_at) in players.items():
            inserted_at = await _save_display_name(
                connection,
                user_id,
                display_name,
                saved_at,
            )
            results.append(
                {
                    "user_id": user_id,
                    "display_name": display_name,
                    "display_name_saved": inserted_at is not None,
                    "saved_at": inserted_at.isoformat() if inserted_at else None,
                }
            )

    saved_count = sum(result["display_name_saved"] for result in results)
    logger.info(
        "Display-name batch processed players=%d saved=%d",
        len(results),
        saved_count,
    )
    return JSONResponse(
        {"players": results, "saved_count": saved_count},
        headers={"Cache-Control": "private, no-store"},
    )


@app.get("/rodb/v1/players/{user_id}/joins/{game_id}")
async def join_history(
    request: Request,
    user_id: int,
    game_id: int,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> JSONResponse:
    _require_key(request)
    _validate_id(user_id, "user ID")
    _validate_id(game_id, "game ID")
    pool: asyncpg.Pool = request.app.state.pool
    async with pool.acquire() as connection:
        count = await connection.fetchval(
            "SELECT count(*) FROM player_joins WHERE user_id = $1 AND game_id = $2",
            user_id,
            game_id,
        )
        rows = await connection.fetch(
            """
            SELECT created_at
            FROM player_joins
            WHERE user_id = $1 AND game_id = $2
            ORDER BY created_at DESC
            LIMIT $3 OFFSET $4
            """,
            user_id,
            game_id,
            limit,
            offset,
        )
    return JSONResponse(
        {
            "user_id": user_id,
            "game_id": game_id,
            "join_count": count,
            "joins": [row["created_at"].isoformat() for row in rows],
            "next_offset": offset + limit if offset + len(rows) < count else None,
        },
        headers={"Cache-Control": "private, no-store"},
    )


@app.post("/rodb/v1/players/{user_id}/joins/{game_id}")
async def record_join(
    request: Request,
    user_id: int,
    game_id: int,
) -> JSONResponse:
    _require_key(request)
    _validate_id(user_id, "user ID")
    _validate_id(game_id, "game ID")
    payload, _ = await _read_json(request)
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid join request.")
    display_name = _validate_display_name(payload.get("display_name"))
    saved_at = _parse_saved_at(payload.get("saved_at"))
    event_id = payload.get("event_id")
    if event_id is not None:
        if not isinstance(event_id, str):
            raise HTTPException(status_code=400, detail="Invalid event ID.")
        _validate_name(event_id, "event ID", 128)
    request_data = {"display_name": display_name, "saved_at": saved_at.isoformat()}

    pool: asyncpg.Pool = request.app.state.pool
    async with pool.acquire() as connection, connection.transaction():
        await connection.execute("SELECT pg_advisory_xact_lock($1)", user_id)
        previous = None
        if event_id is not None:
            previous = await connection.fetchrow(
                "SELECT created_at, request_data::text FROM player_joins "
                "WHERE user_id = $1 AND game_id = $2 AND event_id = $3",
                user_id,
                game_id,
                event_id,
            )
        display_name_saved_at = None
        if previous is not None:
            if json.loads(previous["request_data"]) != request_data:
                raise HTTPException(
                    status_code=409,
                    detail="This event ID was already used with a different join request.",
                )
            created_at = previous["created_at"]
        else:
            display_name_saved_at = await _save_display_name(
                connection, user_id, display_name, saved_at
            )
            created_at = await connection.fetchval(
                """
                INSERT INTO player_joins (user_id, game_id, event_id, request_data)
                VALUES ($1, $2, $3, $4::jsonb)
                RETURNING created_at
                """,
                user_id,
                game_id,
                event_id,
                json.dumps(request_data) if event_id is not None else None,
            )
        count = await connection.fetchval(
            "SELECT count(*) FROM player_joins WHERE user_id = $1 AND game_id = $2",
            user_id,
            game_id,
        )
    logger.info("Player join saved game_id=%d join_count=%d", game_id, count)
    return JSONResponse(
        {
            "user_id": user_id,
            "game_id": game_id,
            "display_name": display_name,
            "display_name_saved": display_name_saved_at is not None,
            "join_count": count,
            "created_at": created_at.isoformat(),
        },
        headers={"Cache-Control": "private, no-store"},
    )


@app.get("/rodb/v1/{namespace}/{key}")
async def get_record(request: Request, namespace: str, key: str) -> JSONResponse:
    _require_key(request)
    _validate_name(namespace, "namespace", 64)
    _validate_name(key, "key", 128)
    pool: asyncpg.Pool = request.app.state.pool
    row = await pool.fetchrow(
        "SELECT namespace, record_key, value::text, version, created_at, updated_at "
        "FROM records WHERE namespace = $1 AND record_key = $2",
        namespace,
        key,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Record not found.")
    return JSONResponse(_record(row), headers=_etag(row["version"]))


@app.put("/rodb/v1/{namespace}/{key}")
async def put_record(
    request: Request,
    namespace: str,
    key: str,
    expected_version: int | None = Query(default=None, ge=0),
) -> JSONResponse:
    _require_key(request)
    _validate_name(namespace, "namespace", 64)
    _validate_name(key, "key", 128)
    _, value = await _read_json(request)
    pool: asyncpg.Pool = request.app.state.pool
    if expected_version is None:
        row = await pool.fetchrow(
            """
            INSERT INTO records AS current (namespace, record_key, value)
            VALUES ($1, $2, $3::jsonb)
            ON CONFLICT (namespace, record_key) DO UPDATE
            SET value = EXCLUDED.value,
                version = current.version + 1,
                updated_at = now()
            RETURNING namespace, record_key, value::text, version, created_at, updated_at
            """,
            namespace,
            key,
            value,
        )
    elif expected_version == 0:
        row = await pool.fetchrow(
            """
            INSERT INTO records (namespace, record_key, value)
            VALUES ($1, $2, $3::jsonb)
            ON CONFLICT (namespace, record_key) DO NOTHING
            RETURNING namespace, record_key, value::text, version, created_at, updated_at
            """,
            namespace,
            key,
            value,
        )
    else:
        row = await pool.fetchrow(
            """
            UPDATE records
            SET value = $3::jsonb, version = version + 1, updated_at = now()
            WHERE namespace = $1 AND record_key = $2 AND version = $4
            RETURNING namespace, record_key, value::text, version, created_at, updated_at
            """,
            namespace,
            key,
            value,
            expected_version,
        )
    if row is None:
        raise HTTPException(status_code=409, detail="Record version does not match.")
    logger.info("Record saved namespace=%s version=%d", namespace, row["version"])
    return JSONResponse(_record(row), headers=_etag(row["version"]))


@app.delete("/rodb/v1/{namespace}/{key}", status_code=204)
async def delete_record(
    request: Request,
    namespace: str,
    key: str,
    expected_version: int | None = Query(default=None, ge=1),
) -> Response:
    _require_key(request)
    _validate_name(namespace, "namespace", 64)
    _validate_name(key, "key", 128)
    pool: asyncpg.Pool = request.app.state.pool
    deleted = await pool.fetchval(
        """
        DELETE FROM records
        WHERE namespace = $1 AND record_key = $2
          AND ($3::bigint IS NULL OR version = $3)
        RETURNING true
        """,
        namespace,
        key,
        expected_version,
    )
    if not deleted:
        exists = await pool.fetchval(
            "SELECT EXISTS(SELECT 1 FROM records WHERE namespace = $1 AND record_key = $2)",
            namespace,
            key,
        )
        raise HTTPException(
            status_code=409 if exists else 404,
            detail="Record version does not match." if exists else "Record not found.",
        )
    logger.info("Record deleted namespace=%s", namespace)
    return Response(status_code=204, headers={"Cache-Control": "private, no-store"})


if __name__ == "__main__":
    uvicorn.run(
        app,
        host=HOST,
        port=PORT,
        proxy_headers=False,
        server_header=False,
        access_log=False,
    )
