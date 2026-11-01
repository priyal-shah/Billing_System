"""Product writes shared by the Products API and AI-assistant approvals."""
from datetime import datetime

from pymongo import ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase

from ..db import next_sequence, utcnow
from ..schemas import ProductIn

ACTIVE = {"is_deleted": {"$ne": True}}


async def insert_product(db: AsyncDatabase, body: ProductIn) -> dict:
    now = utcnow()
    seq = await next_sequence(db, "product")
    doc = {
        "product_id": f"PRD-{seq:05d}",
        **body.model_dump(mode="python"),
        "unit": body.unit.value,
        "is_deleted": False,
        "created_at": now,
        "updated_at": now,
    }
    await db.products.insert_one(doc)
    return doc


async def replace_product(
    db: AsyncDatabase, product_id: str, body: ProductIn, expected_updated_at: datetime | None = None
) -> dict | None:
    """Overwrite a product's editable fields. Returns None if it doesn't exist, was deleted, or
    (when expected_updated_at is given) was changed by someone else since it was read."""
    filt = {"product_id": product_id, **ACTIVE}
    if expected_updated_at is not None:
        filt["updated_at"] = expected_updated_at
    changes = {**body.model_dump(mode="python"), "unit": body.unit.value, "updated_at": utcnow()}
    return await db.products.find_one_and_update(filt, {"$set": changes}, return_document=ReturnDocument.AFTER)
