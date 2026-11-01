"""MongoDB client setup, Decimal codec and index management."""
from datetime import datetime, timezone
from decimal import Decimal

from bson.codec_options import TypeCodec, TypeRegistry
from bson.decimal128 import Decimal128
from fastapi import Request
from pymongo import ASCENDING, DESCENDING, AsyncMongoClient, ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import DuplicateKeyError


class DecimalCodec(TypeCodec):
    """Store Python Decimal as BSON Decimal128 so money never becomes a float."""

    python_type = Decimal
    bson_type = Decimal128

    def transform_python(self, value: Decimal) -> Decimal128:
        return Decimal128(value)

    def transform_bson(self, value: Decimal128) -> Decimal:
        return value.to_decimal()


TYPE_REGISTRY = TypeRegistry([DecimalCodec()])


def create_client(uri: str) -> AsyncMongoClient:
    return AsyncMongoClient(uri, tz_aware=True, type_registry=TYPE_REGISTRY)


def get_db(request: Request) -> AsyncDatabase:
    return request.app.state.db


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


async def ensure_indexes(db: AsyncDatabase) -> None:
    await db.users.create_index("username", unique=True)

    await db.products.create_index("product_id", unique=True)
    await db.products.create_index([("name", ASCENDING)])
    await db.products.create_index([("category", ASCENDING)])

    # order_id uniqueness is guaranteed by the DB, not just by the generator.
    await db.orders.create_index("order_id", unique=True)
    await db.orders.create_index([("username", ASCENDING), ("created_at", DESCENDING)])
    await db.orders.create_index([("created_at", DESCENDING)])
    await db.orders.create_index([("updated_at", DESCENDING)])
    await db.orders.create_index([("status", ASCENDING)])

    # Sign-in sessions: refresh tokens are stored hashed and deleted by MongoDB once expired.
    await db.refresh_tokens.create_index("token_hash", unique=True)
    await db.refresh_tokens.create_index("family")
    await db.refresh_tokens.create_index("username")
    await db.refresh_tokens.create_index("expires_at", expireAfterSeconds=0)

    # AI assistant
    await db.ai_conversations.create_index("conversation_id", unique=True)
    await db.ai_pending_actions.create_index("action_id", unique=True)
    await db.ai_pending_actions.create_index("conversation_id")
    await db.ai_images.create_index("image_id", unique=True)
    await db.ai_audit_log.create_index([("at", DESCENDING)])


async def next_sequence(db: AsyncDatabase, name: str) -> int:
    """Atomically increment and return a named counter (never reused)."""
    for _ in range(3):
        try:
            doc = await db.counters.find_one_and_update(
                {"_id": name},
                {"$inc": {"seq": 1}},
                upsert=True,
                return_document=ReturnDocument.AFTER,
            )
            return doc["seq"]
        except DuplicateKeyError:
            # Two concurrent upserts on a brand-new counter; retry hits the existing doc.
            continue
    raise RuntimeError(f"Could not allocate sequence for {name}")
