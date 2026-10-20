"""Import products from a CSV file.

Usage (from backend_fastapi/, or inside the container):
    python -m scripts.import_products products.csv [--dry-run]

Columns (header row required; see scripts/products_template.csv):
    name, category, description, price, unit, gst_rate, in_stock
- unit: pcs, kg, g, l, ml, dozen or pack (default pcs)
- gst_rate: percent, e.g. 5 (optional)
- in_stock: leave empty to not track stock for that product

A product whose name and category match an existing product is updated; anything else is added.
Every row is validated first; nothing is written if any row has an error.
"""
import asyncio
import csv
import sys
from pathlib import Path

from pydantic import ValidationError

from app.config import get_settings
from app.db import create_client, ensure_indexes, next_sequence, utcnow
from app.schemas import ProductIn

COLUMNS = ["name", "category", "description", "price", "unit", "gst_rate", "in_stock"]


def parse(path: Path) -> list[ProductIn]:
    products, errors = [], []
    with path.open(newline="", encoding="utf-8-sig") as f:  # utf-8-sig handles Excel's BOM
        reader = csv.DictReader(f)
        missing = {"name", "category", "price"} - {c.strip().lower() for c in reader.fieldnames or []}
        if missing:
            sys.exit(f"CSV is missing required column(s): {', '.join(sorted(missing))}")
        for line_no, row in enumerate(reader, start=2):
            row = {(k or "").strip().lower(): (v or "").strip() for k, v in row.items()}
            if not any(row.values()):
                continue
            data = {c: row.get(c, "") for c in COLUMNS}
            data["unit"] = (data["unit"] or "pcs").lower()
            for optional in ("gst_rate", "in_stock", "description"):
                if data[optional] == "":
                    data[optional] = None if optional != "description" else ""
            try:
                products.append(ProductIn(**data))
            except ValidationError as e:
                problems = "; ".join(f"{'.'.join(map(str, err['loc']))}: {err['msg']}" for err in e.errors())
                errors.append(f"  line {line_no} ({data['name'] or 'no name'}): {problems}")
    if errors:
        sys.exit("Fix these rows and run again (nothing was imported):\n" + "\n".join(errors))
    return products


async def main(path: Path, dry_run: bool) -> None:
    products = parse(path)
    print(f"{len(products)} valid product rows in {path.name}")
    if dry_run:
        for p in products:
            print(f"  {p.category:15} {p.name:30} {p.price:>8} / {p.unit.value}")
        print("Dry run: nothing written.")
        return

    cfg = get_settings()
    client = create_client(cfg.mongo_uri)
    db = client[cfg.mongo_db]
    await ensure_indexes(db)
    added = updated = 0
    for p in products:
        now = utcnow()
        fields = {**p.model_dump(mode="python"), "unit": p.unit.value, "updated_at": now}
        res = await db.products.update_one(
            {"name": p.name, "category": p.category, "is_deleted": {"$ne": True}}, {"$set": fields}
        )
        if res.matched_count:
            updated += 1
            continue
        seq = await next_sequence(db, "product")
        await db.products.insert_one(
            {"product_id": f"PRD-{seq:05d}", **fields, "is_deleted": False, "created_at": now}
        )
        added += 1
    print(f"Done: {added} added, {updated} updated in database '{cfg.mongo_db}'")
    await client.close()


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 1:
        sys.exit(__doc__)
    asyncio.run(main(Path(args[0]), dry_run="--dry-run" in sys.argv))
