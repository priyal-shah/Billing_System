"""Seed the database with an admin, sample users, products and shop settings.

Usage (from backend_fastapi/):  python -m scripts.seed [--reset]
--reset drops products, orders, users, settings and counters first.
"""
import asyncio
import sys
from decimal import Decimal

from app.config import get_settings
from app.db import create_client, ensure_indexes, next_sequence, utcnow
from app.schemas import ShopSettings
from app.security import hash_password

USERS = [
    ("admin", "admin123", "admin", "Store Admin"),
    ("user1", "user123", "user", "Asha Patel"),
    ("user2", "user123", "user", "Rahul Mehta"),
]

# name, category, description, price, unit, gst_rate, in_stock
PRODUCTS = [
    ("Basmati Rice", "Grains", "Premium long-grain basmati rice", "120.00", "kg", "5", "50"),
    ("Toor Dal", "Pulses", "Unpolished split pigeon peas", "150.00", "kg", "5", "40"),
    ("Moong Dal", "Pulses", "Yellow split moong", "130.00", "kg", "5", "30"),
    ("Wheat Atta 5kg", "Grains", "Whole wheat flour, 5 kg pack", "260.00", "pack", "5", "25"),
    ("Sugar", "Staples", "Refined white sugar", "45.00", "kg", "5", "100"),
    ("Iodised Salt 1kg", "Staples", "Iodised table salt", "25.00", "pcs", "0", None),
    ("Sunflower Oil 1L", "Oils", "Refined sunflower oil", "165.00", "pcs", "5", "60"),
    ("Mustard Oil 1L", "Oils", "Kachi ghani mustard oil", "180.00", "pcs", "5", "40"),
    ("Full Cream Milk 500ml", "Dairy", "Pasteurised full cream milk", "34.00", "pcs", "0", None),
    ("Paneer 200g", "Dairy", "Fresh cottage cheese", "90.00", "pcs", "5", "20"),
    ("Butter 100g", "Dairy", "Salted table butter", "58.00", "pcs", "12", "30"),
    ("Eggs", "Dairy", "Farm fresh eggs", "84.00", "dozen", "0", "20"),
    ("Tomato", "Vegetables", "Fresh red tomatoes", "40.00", "kg", "0", None),
    ("Onion", "Vegetables", "Red onions", "35.00", "kg", "0", None),
    ("Potato", "Vegetables", "Fresh potatoes", "30.00", "kg", "0", None),
    ("Banana", "Fruits", "Robusta bananas", "60.00", "dozen", "0", None),
    ("Apple", "Fruits", "Shimla apples", "180.00", "kg", "0", None),
    ("Tea 250g", "Beverages", "Assam CTC tea", "140.00", "pcs", "5", "35"),
    ("Instant Coffee 50g", "Beverages", "Pure instant coffee", "175.00", "pcs", "18", "25"),
    ("Glucose Biscuits", "Snacks", "Classic glucose biscuits, family pack", "30.00", "pcs", "18", "80"),
    ("Potato Chips 90g", "Snacks", "Salted potato chips", "20.00", "pcs", "12", "100"),
    ("Bath Soap 4-pack", "Personal Care", "Moisturising bath soap", "160.00", "pack", "18", "40"),
    ("Detergent Powder 1kg", "Household", "Washing powder", "110.00", "pcs", "18", "30"),
]


async def main(reset: bool) -> None:
    cfg = get_settings()
    client = create_client(cfg.mongo_uri)
    db = client[cfg.mongo_db]
    if reset:
        for name in ("products", "orders", "users", "settings", "counters", "refresh_tokens"):
            await db.drop_collection(name)
        print(f"Reset database '{cfg.mongo_db}'")
    await ensure_indexes(db)

    for username, password, role, full_name in USERS:
        res = await db.users.update_one(
            {"username": username},
            {"$setOnInsert": {
                "username": username, "password_hash": hash_password(password), "role": role,
                "full_name": full_name, "created_at": utcnow(), "token_version": 0,
                # Published sample passwords: the first sign-in must choose a new one.
                "must_change_password": True,
            }},
            upsert=True,
        )
        print(f"{'created' if res.upserted_id else 'exists '} {role:5} {username}")

    if await db.products.count_documents({}) == 0:
        now = utcnow()
        docs = []
        for name, cat, desc, price, unit, gst, stock in PRODUCTS:
            seq = await next_sequence(db, "product")
            docs.append({
                "product_id": f"PRD-{seq:05d}", "name": name, "category": cat, "description": desc,
                "price": Decimal(price), "unit": unit, "gst_rate": Decimal(gst),
                "in_stock": Decimal(stock) if stock is not None else None,
                "is_deleted": False, "created_at": now, "updated_at": now,
            })
        await db.products.insert_many(docs)
        print(f"inserted {len(docs)} products")
    else:
        print("products already present, skipped")

    shop = ShopSettings(
        shop_name="Fresh Mart Grocery",
        tagline="Daily needs, fresh every day",
        address="12, Market Road, Ahmedabad, Gujarat 380001",
        phone="+91 98765 43210",
        email="billing@freshmart.example",
        gst_number="24ABCDE1234F1Z5",
        tax_mode="product",
        tax_rate=Decimal("5"),
        prices_include_tax=True,
    )
    await db.settings.update_one({"_id": "shop"}, {"$setOnInsert": shop.model_dump(mode="python")}, upsert=True)
    print(f"settings ready in database '{cfg.mongo_db}'")
    await client.close()


if __name__ == "__main__":
    asyncio.run(main(reset="--reset" in sys.argv))
