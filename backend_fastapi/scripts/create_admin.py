"""Create (or reset the password of) an admin account. No sample data is added.

Usage (from backend_fastapi/, or inside the container):
    python -m scripts.create_admin <username>
The password is read from the ADMIN_PASSWORD environment variable, or asked for interactively.
"""
import asyncio
import getpass
import os
import sys

from app.config import get_settings
from app.db import create_client, ensure_indexes, utcnow
from app.schemas import ShopSettings
from app.security import hash_password


def read_password() -> str:
    password = os.environ.get("ADMIN_PASSWORD")
    if not password:
        password = getpass.getpass("New admin password (min 8 characters): ")
        if password != getpass.getpass("Repeat password: "):
            sys.exit("Passwords do not match")
    if not 8 <= len(password) <= 72:
        sys.exit("Password must be 8-72 characters")
    return password


async def main(username: str) -> None:
    password = read_password()
    cfg = get_settings()
    client = create_client(cfg.mongo_uri)
    db = client[cfg.mongo_db]
    await ensure_indexes(db)
    await db.settings.update_one(
        {"_id": "shop"}, {"$setOnInsert": ShopSettings().model_dump(mode="python")}, upsert=True
    )
    res = await db.users.update_one(
        {"username": username},
        {
            "$set": {"password_hash": hash_password(password), "role": "admin"},
            "$setOnInsert": {"username": username, "full_name": "Store Admin", "created_at": utcnow()},
        },
        upsert=True,
    )
    print(f"{'Created' if res.upserted_id else 'Updated'} admin '{username}' in database '{cfg.mongo_db}'")
    await client.close()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    asyncio.run(main(sys.argv[1].strip().lower()))
