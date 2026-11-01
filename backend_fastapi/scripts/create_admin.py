"""Create (or reset the password of) an admin account. No sample data is added.

Also the recovery tool for a locked-out admin: it signs the account out everywhere and turns off
its two-factor sign-in, so the admin sets up their authenticator again at next sign-in.

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
from app.security import DEFAULT_PASSWORDS, hash_password


def read_password() -> str:
    password = os.environ.get("ADMIN_PASSWORD")
    if not password:
        password = getpass.getpass("New admin password (min 10 characters): ")
        if password != getpass.getpass("Repeat password: "):
            sys.exit("Passwords do not match")
    if not 10 <= len(password) <= 72:
        sys.exit("Password must be 10-72 characters")
    if password in DEFAULT_PASSWORDS:
        sys.exit("That is a published default password; choose another")
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
            "$set": {"password_hash": hash_password(password), "role": "admin", "password_changed_at": utcnow()},
            "$inc": {"token_version": 1},
            "$unset": {"must_change_password": "", "disabled": "", "totp_secret": "", "totp_enabled": "",
                       "totp_last_step": "", "recovery_codes": "", "totp_pending_secret": ""},
            "$setOnInsert": {"username": username, "full_name": "Store Admin", "created_at": utcnow()},
        },
        upsert=True,
    )
    await db.refresh_tokens.delete_many({"username": username})
    print(f"{'Created' if res.upserted_id else 'Updated'} admin '{username}' in database '{cfg.mongo_db}'")
    await client.close()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    asyncio.run(main(sys.argv[1].strip().lower()))
