"""Order building, stock handling and persistence helpers.

Stock rule: tracked stock is deducted when an order is marked completed, and put back if a
completed order is reopened. Placing or editing an open order only checks availability.
`stock_applied` on the order records whether its quantities are currently deducted. Orders
created before this rule existed had stock taken at placement, so a missing flag means True.
"""
from decimal import Decimal

from fastapi import HTTPException, status
from pymongo.asynchronous.database import AsyncDatabase

from ..db import next_sequence, utcnow
from ..schemas import DECIMAL_UNITS, OrderItemEdit
from .pricing import price_order

ORDER_FIELDS_FROM_ITEM = (
    "item_id", "item_name", "unit", "quantity", "unit_price", "discount_type", "discount_value", "gst_rate",
)


def bad_request(msg: str) -> HTTPException:
    return HTTPException(status.HTTP_400_BAD_REQUEST, msg)


def conflict(msg: str) -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT, msg)


def validate_quantity(qty: Decimal, unit: str, name: str) -> None:
    if unit not in DECIMAL_UNITS and qty != qty.to_integral_value():
        raise bad_request(f"Quantity for '{name}' must be a whole number ({unit})")


async def load_products(db: AsyncDatabase, product_ids: list[str]) -> dict[str, dict]:
    cursor = db.products.find({"product_id": {"$in": product_ids}, "is_deleted": {"$ne": True}})
    return {p["product_id"]: p async for p in cursor}


async def apply_stock_changes(db: AsyncDatabase, deltas: dict[str, Decimal]) -> None:
    """Consume (positive delta) or restore (negative delta) tracked stock.

    Each decrement is atomic and conditional on enough stock being available. If any item
    fails, everything already applied in this call is rolled back.
    """
    applied: list[tuple[str, Decimal]] = []
    try:
        for pid, delta in deltas.items():
            if delta > 0:
                res = await db.products.update_one(
                    {"product_id": pid, "in_stock": {"$gte": delta}},
                    {"$inc": {"in_stock": -delta}},
                )
                if res.matched_count == 0:
                    product = await db.products.find_one({"product_id": pid})
                    if product and product.get("in_stock") is not None:
                        raise conflict(
                            f"Insufficient stock for '{product['name']}' "
                            f"(available {product['in_stock'].normalize():f} {product['unit']})"
                        )
                    continue  # stock not tracked for this product
            elif delta < 0:
                await db.products.update_one(
                    {"product_id": pid, "in_stock": {"$ne": None}},
                    {"$inc": {"in_stock": -delta}},
                )
            applied.append((pid, delta))
    except HTTPException:
        await rollback_stock(db, applied)
        raise


async def rollback_stock(db: AsyncDatabase, applied: list[tuple[str, Decimal]] | dict[str, Decimal]) -> None:
    pairs = applied.items() if isinstance(applied, dict) else applied
    for pid, delta in pairs:
        if delta:
            await db.products.update_one(
                {"product_id": pid, "in_stock": {"$ne": None}}, {"$inc": {"in_stock": delta}}
            )


def stock_applied(order: dict) -> bool:
    return order.get("stock_applied", True)


async def check_availability(db: AsyncDatabase, items: list[dict]) -> None:
    """Soft check that tracked stock covers each quantity. Nothing is deducted here; the
    authoritative, atomic check happens when the order is completed."""
    ids = [it["item_id"] for it in items]
    cursor = db.products.find({"product_id": {"$in": ids}, "in_stock": {"$ne": None}})
    stock = {p["product_id"]: p async for p in cursor}
    for it in items:
        p = stock.get(it["item_id"])
        if p is not None and Decimal(it["quantity"]) > p["in_stock"]:
            raise conflict(
                f"Only {p['in_stock'].normalize():f} {p['unit']} of '{p['name']}' in stock"
            )


def stock_deltas(old_items: list[dict], new_items: list[dict]) -> dict[str, Decimal]:
    deltas: dict[str, Decimal] = {}
    for it in new_items:
        deltas[it["item_id"]] = deltas.get(it["item_id"], Decimal(0)) + Decimal(it["quantity"])
    for it in old_items:
        deltas[it["item_id"]] = deltas.get(it["item_id"], Decimal(0)) - Decimal(it["quantity"])
    return {k: v for k, v in deltas.items() if v != 0}


def tax_config_from_settings(shop: dict) -> dict:
    return {
        "mode": shop.get("tax_mode", "none"),
        "rate": Decimal(shop.get("tax_rate") or 0),
        "prices_include_tax": bool(shop.get("prices_include_tax")),
        "split_cgst_sgst": bool(shop.get("split_cgst_sgst", True)),
    }


async def generate_order_id(db: AsyncDatabase) -> str:
    # A global, never-reset counter makes the id unique across days; the date is for humans.
    seq = await next_sequence(db, "order")
    return f"ORD-{utcnow().astimezone():%Y%m%d}-{seq:06d}"


async def create_order(db: AsyncDatabase, username: str, cart: list, guest_id: str | None = None) -> dict:
    merged: dict[str, Decimal] = {}
    for line in cart:
        merged[line.item_id] = merged.get(line.item_id, Decimal(0)) + line.quantity

    products = await load_products(db, list(merged))
    missing = [pid for pid in merged if pid not in products]
    if missing:
        raise bad_request(f"Products not available: {', '.join(missing)}")

    items = []
    for pid, qty in merged.items():
        p = products[pid]
        validate_quantity(qty, p["unit"], p["name"])
        items.append({
            "item_id": pid,
            "item_name": p["name"],
            "unit": p["unit"],
            "quantity": qty,
            "unit_price": p["price"],
            "discount_type": None,
            "discount_value": Decimal(0),
            "gst_rate": p.get("gst_rate"),
        })

    shop = await db.settings.find_one({"_id": "shop"}) or {}
    tax_config = tax_config_from_settings(shop)

    await check_availability(db, items)
    now = utcnow()
    doc = {
        "order_id": await generate_order_id(db),
        "username": username,
        "is_guest": guest_id is not None,
        **({"guest_id": guest_id} if guest_id else {}),
        **price_order(items, tax_config),
        "tax_config": tax_config,
        "status": "new",
        "stock_applied": False,  # deducted when the admin completes the order
        "version": 1,
        "created_at": now,
        "updated_at": now,
    }
    await db.orders.insert_one(doc)
    return doc


async def build_edited_items(db: AsyncDatabase, order: dict, edits: list[OrderItemEdit]) -> list[dict]:
    ids = [e.item_id for e in edits]
    if len(ids) != len(set(ids)):
        raise bad_request("Each product may appear only once in an order")

    existing = {it["item_id"]: it for it in order["items"]}
    new_ids = [i for i in ids if i not in existing]
    products = await load_products(db, new_ids) if new_ids else {}
    missing = [i for i in new_ids if i not in products]
    if missing:
        raise bad_request(f"Products not available: {', '.join(missing)}")

    items = []
    for e in edits:
        if e.item_id in existing:
            base = {k: existing[e.item_id].get(k) for k in ORDER_FIELDS_FROM_ITEM}
        else:
            p = products[e.item_id]
            base = {
                "item_id": p["product_id"], "item_name": p["name"], "unit": p["unit"],
                "unit_price": p["price"], "gst_rate": p.get("gst_rate"),
            }
        validate_quantity(e.quantity, base["unit"], base["item_name"])
        if e.discount_type == "percent" and e.discount_value > 100:
            raise bad_request(f"Discount for '{base['item_name']}' cannot exceed 100%")
        base.update(
            quantity=e.quantity,
            unit_price=e.unit_price if e.unit_price is not None else base["unit_price"],
            discount_type=e.discount_type.value if e.discount_type else None,
            discount_value=e.discount_value if e.discount_type else Decimal(0),
        )
        items.append(base)
    return items


async def update_order_items(db: AsyncDatabase, order: dict, edits: list[OrderItemEdit], version: int | None) -> dict:
    if order["status"] == "completed":
        raise conflict("Order is completed. Reopen it before editing.")
    if version is not None and version != order["version"]:
        raise conflict("Order was changed by someone else. Reload and try again.")

    items = await build_edited_items(db, order, edits)
    if stock_applied(order):
        # Legacy open order whose stock was taken at placement: keep stock in step with edits.
        deltas = stock_deltas(order["items"], items)
        await apply_stock_changes(db, deltas)
    else:
        deltas = {}
        await check_availability(db, items)

    priced = price_order(items, order.get("tax_config") or {})
    res = await db.orders.find_one_and_update(
        {"order_id": order["order_id"], "version": order["version"], "status": "new"},
        {"$set": {**priced, "updated_at": utcnow()}, "$inc": {"version": 1}},
        return_document=True,
    )
    if res is None:
        await rollback_stock(db, deltas)
        raise conflict("Order was changed by someone else. Reload and try again.")
    return res


async def set_order_status(db: AsyncDatabase, order: dict, new_status: str) -> dict:
    """Complete (deducting stock) or reopen (restoring stock) an order, atomically per product."""
    if order["status"] == new_status:
        return order
    applied = stock_applied(order)
    deltas: dict[str, Decimal] = {}
    if new_status == "completed" and not applied:
        deltas = stock_deltas([], order["items"])        # consume
        applied = True
    elif new_status == "new" and applied:
        deltas = stock_deltas(order["items"], [])        # give back
        applied = False
    await apply_stock_changes(db, deltas)

    res = await db.orders.find_one_and_update(
        {"order_id": order["order_id"], "version": order["version"]},
        {"$set": {"status": new_status, "stock_applied": applied, "updated_at": utcnow()}, "$inc": {"version": 1}},
        return_document=True,
    )
    if res is None:
        await rollback_stock(db, deltas)
        raise conflict("Order was changed by someone else. Reload and try again.")
    return res


def edits_from_items(items: list[dict]) -> list[OrderItemEdit]:
    return [
        OrderItemEdit(
            item_id=it["item_id"],
            quantity=it["quantity"],
            unit_price=it["unit_price"],
            discount_type=it.get("discount_type"),
            discount_value=it.get("discount_value") or 0,
        )
        for it in items
    ]
