from __future__ import annotations

import logging
import os
from collections.abc import AsyncGenerator

from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from .config import settings

logger = logging.getLogger("graph_viz")

# Make sure ./data exists for the default sqlite file target.
if settings.DATABASE_URL.startswith("sqlite"):
    os.makedirs("data", exist_ok=True)

engine = create_async_engine(settings.DATABASE_URL, echo=False, future=True)
async_session_factory = async_sessionmaker(
    engine, expire_on_commit=False, class_=AsyncSession
)


class Base(DeclarativeBase):
    pass


def _add_missing_columns(sync_conn) -> None:
    inspector = inspect(sync_conn)
    existing_tables = set(inspector.get_table_names())

    for table in Base.metadata.sorted_tables:
        if table.name not in existing_tables:
            continue
        existing_cols = {c["name"] for c in inspector.get_columns(table.name)}
        for column in table.columns:
            if column.name in existing_cols:
                continue
            col_type = column.type.compile(dialect=sync_conn.dialect)
            nullable = "" if column.nullable else " NOT NULL"
            default = f" DEFAULT {column.server_default.arg}" if column.server_default is not None else ""
            ddl = f"ALTER TABLE {table.name} ADD COLUMN {column.name} {col_type}{default}{nullable}"
            logger.info("migrating: %s", ddl)
            sync_conn.execute(text(ddl))


async def init_db() -> None:
    from . import models  # noqa: F401 - ensure models are registered

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_add_missing_columns)
    logger.info("database ready")


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_factory() as session:
        yield session
