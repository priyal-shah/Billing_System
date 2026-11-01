import re
from datetime import datetime
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status

from ..bill_formats import BILL_FORMATS
from ..db import get_db
from ..schemas import (
    AdminOrderCreate, BillOut, CustomerOut, OrderCreate, OrderItemEdit, OrderItemPatch, OrderOut, OrderStats, OrderUpdate, Page, ShopSettings,
    StatusUpdate,
)
from ..ratelimit import rate_limit
from ..security import get_current_user, require_admin, require_customer, require_registered
from ..services import orders as svc

router = APIRouter(tags=["orders"])


async def fetch_order(db, order_id: str) -> dict:
    order = await db.orders.find_one({"order_id": order_id})
    if not order:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found")
    return order


def date_range(start: datetime | None, end: datetime | None) -> dict | None:
    rng = {}
    if start:
        rng["$gte"] = start
    if end:
        rng["$lte"] = end
    return rng or None


# ---------- user ----------

@router.post("/orders", response_model=OrderOut, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(rate_limit("place_order", 20, 600))])
async def place_order(body: OrderCreate, user=Depends(require_customer), db=Depends(get_db)):
    if user["role"] == "guest":
        # Guest orders are recorded under the name they entered; the random guest id is kept
        # only for tracing and is never used to list orders back to them.
        return await svc.create_order(db, user["full_name"], body.items, guest_id=user["username"])
    return await svc.create_order(db, user["username"], body.items)


@router.get("/orders/my", response_model=Page[OrderOut])
async def my_orders(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user=Depends(require_registered),
    db=Depends(get_db),
):
    filt = {"username": user["username"], "is_guest": {"$ne": True}}
    total = await db.orders.count_documents(filt)
    cursor = db.orders.find(filt).sort("created_at", -1).skip((page - 1) * page_size).limit(page_size)
    return {"items": [o async for o in cursor], "total": total, "page": page, "page_size": page_size}


# ---------- admin ----------

@router.get("/customers", response_model=list[CustomerOut])
async def search_customers(q: str = Query("", max_length=60), _admin=Depends(require_admin), db=Depends(get_db)):
    """Registered customers matching a name, for picking who an admin-placed order belongs to."""
    filt: dict = {"role": "user"}
    if q.strip():
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        filt["$or"] = [{"username": rx}, {"full_name": rx}]
    cursor = db.users.find(filt, {"username": 1, "full_name": 1}).sort("username", 1).limit(10)
    return [u async for u in cursor]


@router.post("/orders/admin", response_model=OrderOut, status_code=status.HTTP_201_CREATED)
async def place_order_for_customer(body: AdminOrderCreate, admin=Depends(require_admin), db=Depends(get_db)):
    if body.customer_username:
        customer = await db.users.find_one({"username": body.customer_username, "role": "user"})
        if not customer:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"No customer account '{body.customer_username}'")
        return await svc.create_order(db, customer["username"], body.items, placed_by=admin["username"])
    return await svc.create_order(db, body.customer_name, body.items, walk_in=True, placed_by=admin["username"])


@router.get("/orders", response_model=Page[OrderOut])
async def list_orders(
    order_id: str | None = None,
    username: str | None = None,
    status_: Literal["new", "completed"] | None = Query(None, alias="status"),
    customer_type: Literal["registered", "guest"] | None = None,
    created_from: datetime | None = None,
    created_to: datetime | None = None,
    updated_from: datetime | None = None,
    updated_to: datetime | None = None,
    sort_by: Literal["created_at", "updated_at", "total_price", "order_id", "username"] = "created_at",
    sort_dir: Literal["asc", "desc"] = "desc",
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    _admin=Depends(require_admin),
    db=Depends(get_db),
):
    filt: dict = {}
    if order_id and order_id.strip():
        filt["order_id"] = {"$regex": re.escape(order_id.strip()), "$options": "i"}
    if username and username.strip():
        filt["username"] = {"$regex": re.escape(username.strip()), "$options": "i"}
    if status_:
        filt["status"] = status_
    if customer_type:
        filt["is_guest"] = True if customer_type == "guest" else {"$ne": True}
    if rng := date_range(created_from, created_to):
        filt["created_at"] = rng
    if rng := date_range(updated_from, updated_to):
        filt["updated_at"] = rng

    total = await db.orders.count_documents(filt)
    cursor = (
        db.orders.find(filt)
        .sort(sort_by, 1 if sort_dir == "asc" else -1)
        .skip((page - 1) * page_size)
        .limit(page_size)
    )
    return {"items": [o async for o in cursor], "total": total, "page": page, "page_size": page_size}


@router.get("/orders/stats", response_model=OrderStats)
async def order_stats(
    since: datetime | None = Query(None, description="Count sales from this moment (e.g. local midnight)"),
    _admin=Depends(require_admin),
    db=Depends(get_db),
):
    counts = {s: await db.orders.count_documents({"status": s}) for s in ("new", "completed")}
    match = {"created_at": {"$gte": since}} if since else {}
    agg = await (await db.orders.aggregate([
        {"$match": match},
        {"$group": {"_id": None, "n": {"$sum": 1}, "sales": {"$sum": "$total_price"}}},
    ])).to_list()
    row = agg[0] if agg else {"n": 0, "sales": Decimal(0)}
    return {
        "new_count": counts["new"],
        "completed_count": counts["completed"],
        "total_count": counts["new"] + counts["completed"],
        "orders_since": row["n"],
        "sales_since": row["sales"],
    }


@router.get("/orders/{order_id}", response_model=OrderOut)
async def get_order(order_id: str, user=Depends(require_registered), db=Depends(get_db)):
    order = await fetch_order(db, order_id)
    if user["role"] != "admin" and (order["username"] != user["username"] or order.get("is_guest")):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found")
    return order


@router.put("/orders/{order_id}", response_model=OrderOut)
async def replace_order_items(order_id: str, body: OrderUpdate, _admin=Depends(require_admin), db=Depends(get_db)):
    order = await fetch_order(db, order_id)
    return await svc.update_order_items(db, order, body.items, body.version)


@router.post("/orders/{order_id}/items", response_model=OrderOut)
async def add_order_item(order_id: str, body: OrderItemEdit, _admin=Depends(require_admin), db=Depends(get_db)):
    order = await fetch_order(db, order_id)
    edits = svc.edits_from_items(order["items"])
    for e in edits:
        if e.item_id == body.item_id:  # already in the order: add to its quantity
            e.quantity += body.quantity
            if body.unit_price is not None:
                e.unit_price = body.unit_price
            if body.discount_type is not None:
                e.discount_type, e.discount_value = body.discount_type, body.discount_value
            break
    else:
        edits.append(body)
    return await svc.update_order_items(db, order, edits, None)


@router.patch("/orders/{order_id}/items/{item_id}", response_model=OrderOut)
async def patch_order_item(
    order_id: str, item_id: str, body: OrderItemPatch, _admin=Depends(require_admin), db=Depends(get_db)
):
    order = await fetch_order(db, order_id)
    edits = svc.edits_from_items(order["items"])
    target = next((e for e in edits if e.item_id == item_id), None)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not in order")
    for field in body.model_fields_set:
        setattr(target, field, getattr(body, field))
    if target.discount_type is None:
        target.discount_value = Decimal(0)
    return await svc.update_order_items(db, order, edits, None)


@router.delete("/orders/{order_id}/items/{item_id}", response_model=OrderOut)
async def delete_order_item(order_id: str, item_id: str, _admin=Depends(require_admin), db=Depends(get_db)):
    order = await fetch_order(db, order_id)
    edits = [e for e in svc.edits_from_items(order["items"]) if e.item_id != item_id]
    if len(edits) == len(order["items"]):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not in order")
    if not edits:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "An order must keep at least one item")
    return await svc.update_order_items(db, order, edits, None)


@router.patch("/orders/{order_id}/status", response_model=OrderOut)
async def set_status(order_id: str, body: StatusUpdate, _admin=Depends(require_admin), db=Depends(get_db)):
    order = await fetch_order(db, order_id)
    return await svc.set_order_status(db, order, body.status.value)


@router.get("/orders/{order_id}/bill", response_model=BillOut)
async def get_bill(
    order_id: str,
    format: str | None = Query(None, description="Bill format id; defaults to the shop setting"),
    _admin=Depends(require_admin),
    db=Depends(get_db),
):
    order = await fetch_order(db, order_id)
    shop = ShopSettings(**(await db.settings.find_one({"_id": "shop"}) or {}))
    fmt_id = format or shop.default_bill_format
    if fmt_id not in BILL_FORMATS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown bill format '{fmt_id}'")
    return {"format": BILL_FORMATS[fmt_id], "order": order, "shop": shop}
