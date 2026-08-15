"""
Application configuration.

Values are read from environment variables so the same image can be
reused across dev / docker-compose / prod with different settings.
"""
from __future__ import annotations

import os


class Settings:
    # SQLite by default (zero external deps for local dev). Point this at a
    # postgres+asyncpg:// DSN in production and nothing else in the app needs
    # to change - all queries go through SQLAlchemy's async engine.
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL", "sqlite+aiosqlite:///./data/executions.db"
    )

    # Comma separated list of origins allowed to hit the API / open a socket.
    CORS_ORIGINS: list[str] = os.getenv(
        "CORS_ORIGINS", "http://localhost:5173,http://localhost:3000"
    ).split(",")

    # 8001, not 8000 - CodeReviewer's own `app` service already owns 8000
    # in the project's existing docker-compose.yml.
    PORT: int = int(os.getenv("PORT", "8001"))


settings = Settings()
