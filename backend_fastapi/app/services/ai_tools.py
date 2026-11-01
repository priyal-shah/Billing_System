"""Tools the admin AI assistant can call.

Read tools only query. The two propose_* tools store a pending action and never write to
`products`; the admin applies it from the approval card in the UI.
"""
import json
import re
from datetime import datetime
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

from pymongo.asynchronous.database import AsyncDatabase

from . import ai_actions
from .products import ACTIVE

MAX_ROWS = 50


class ToolError(Exception):
    """Returned to the model as an is_error tool result."""


def contains(text: str) -> dict:
    return {"$regex": re.escape(text.strip()), "$options": "i"}


def parse_dt(value: str | None, tz: ZoneInfo, field: str) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        raise ToolError(f"{field}: '{value}' is not an ISO date/time like 2026-10-24 or 2026-10-24T18:00:00+05:30")
    return dt if dt.tzinfo else dt.replace(tzinfo=tz)


def date_filter(start: str | None, end: str | None, tz: ZoneInfo) -> dict | None:
    rng = {}
    if s := parse_dt(start, tz, "created_from"):
        rng["$gte"] = s
    if e := parse_dt(end, tz, "created_to"):
        rng["$lt"] = e
    return rng or None


def limit_of(inp: dict, default: int) -> int:
    return max(1, min(int(inp.get("limit") or default), MAX_ROWS))


def jsonable(value: Any, tz: ZoneInfo) -> Any:
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, datetime):
        return value.astimezone(tz).isoformat(timespec="seconds")
    if isinstance(value, dict):
        return {k: jsonable(v, tz) for k, v in value.items() if k != "_id"}
    if isinstance(value, list):
        return [jsonable(v, tz) for v in value]
    return value


PRODUCT_FIELDS = {"_id": 0, "product_id": 1, "name": 1, "category": 1, "description": 1, "price": 1, "unit": 1,
                  "gst_rate": 1, "in_stock": 1, "updated_at": 1}


def order_filter(inp: dict, tz: ZoneInfo) -> dict:
    filt: dict = {}
    if v := (inp.get("order_id") or "").strip():
        filt["order_id"] = contains(v)
    if v := (inp.get("customer") or "").strip():
        filt["username"] = contains(v)
    if v := inp.get("status"):
        filt["status"] = v
    if v := inp.get("customer_type"):
        filt["is_guest"] = True if v == "guest" else {"$ne": True}
    if v := inp.get("product_id"):
        filt["items.item_id"] = v
    if rng := date_filter(inp.get("created_from"), inp.get("created_to"), tz):
        filt["created_at"] = rng
    return filt


# ---------- read tools ----------

async def search_products(db: AsyncDatabase, inp: dict, ctx: dict) -> dict:
    filt: dict = dict(ACTIVE)
    if q := (inp.get("query") or "").strip():
        # Match every word somewhere in name/category/description/id, so "toor dal 1kg" still finds things.
        filt["$and"] = [
            {"$or": [{"name": contains(w)}, {"category": contains(w)}, {"description": contains(w)},
                     {"product_id": contains(w)}]}
            for w in q.split()
        ]
    if c := (inp.get("category") or "").strip():
        filt["category"] = contains(c)
    if (m := inp.get("max_stock")) is not None:
        filt["in_stock"] = {"$ne": None, "$lte": Decimal(str(m))}
    total = await db.products.count_documents(filt)
    rows = await db.products.find(filt, PRODUCT_FIELDS).sort([("category", 1), ("name", 1)]).limit(
        limit_of(inp, 25)).to_list()
    return {"total_matches": total, "returned": len(rows), "products": rows}


async def get_product(db: AsyncDatabase, inp: dict, ctx: dict) -> dict:
    p = await db.products.find_one({"product_id": inp["product_id"], **ACTIVE}, PRODUCT_FIELDS)
    if not p:
        raise ToolError(f"No active product with id {inp['product_id']}")
    return p


async def list_categories(db: AsyncDatabase, inp: dict, ctx: dict) -> dict:
    rows = await (await db.products.aggregate([
        {"$match": ACTIVE}, {"$group": {"_id": "$category", "products": {"$sum": 1}}}, {"$sort": {"_id": 1}},
    ])).to_list()
    return {"categories": [{"category": r["_id"], "products": r["products"]} for r in rows]}


async def search_orders(db: AsyncDatabase, inp: dict, ctx: dict) -> dict:
    filt = order_filter(inp, ctx["tz"])
    sort_by = inp.get("sort_by") or "created_at"
    total = await db.orders.count_documents(filt)
    rows = await db.orders.find(filt, {
        "_id": 0, "order_id": 1, "username": 1, "is_guest": 1, "status": 1, "item_count": 1, "total_price": 1,
        "created_at": 1, "updated_at": 1,
    }).sort(sort_by, 1 if inp.get("sort_dir") == "asc" else -1).limit(limit_of(inp, 20)).to_list()
    return {"total_matches": total, "returned": len(rows), "orders": rows}


async def get_order(db: AsyncDatabase, inp: dict, ctx: dict) -> dict:
    o = await db.orders.find_one({"order_id": inp["order_id"].strip().upper()})
    if not o:
        raise ToolError(f"No order with id {inp['order_id']}")
    return {
        "order_id": o["order_id"], "customer": o["username"], "is_guest": o.get("is_guest", False),
        "status": o["status"], "created_at": o["created_at"], "updated_at": o["updated_at"],
        "items": [
            {k: i.get(k) for k in ("item_id", "item_name", "quantity", "unit", "unit_price", "discount_type",
                                    "discount_value", "discount_amount", "tax_rate", "tax_amount", "line_total")}
            for i in o["items"]
        ],
        "subtotal": o["subtotal"], "total_discount": o["total_discount"], "taxable_amount": o["taxable_amount"],
        "tax_amount": o["tax_amount"], "tax_breakup": o.get("tax_breakup", []), "total_price": o["total_price"],
        "bill_page": f"/admin/orders/{o['order_id']}/print",
    }


async def sales_summary(db: AsyncDatabase, inp: dict, ctx: dict) -> dict:
    match = order_filter(inp, ctx["tz"])
    totals = {"orders": {"$sum": 1}, "sales": {"$sum": "$total_price"}, "discounts": {"$sum": "$total_discount"},
              "tax": {"$sum": "$tax_amount"}}
    by_status = await (await db.orders.aggregate([
        {"$match": match}, {"$group": {"_id": "$status", **totals}},
    ])).to_list()
    overall = {k: sum((r[k] for r in by_status), Decimal(0) if k != "orders" else 0) for k in totals}
    if overall["orders"]:
        overall["average_order_value"] = (Decimal(overall["sales"]) / overall["orders"]).quantize(Decimal("0.01"))
    result: dict = {"overall": overall, "by_status": {r["_id"]: {k: r[k] for k in totals} for r in by_status}}

    if period := inp.get("group_by"):
        series = await (await db.orders.aggregate([
            {"$match": match},
            {"$group": {"_id": {"$dateTrunc": {"date": "$created_at", "unit": period, "timezone": ctx["tz"].key,
                                               **({"startOfWeek": "monday"} if period == "week" else {})}},
                        **totals}},
            {"$sort": {"_id": 1}}, {"$limit": 400},
        ])).to_list()
        result["series"] = [{"period_start": r["_id"], **{k: r[k] for k in totals}} for r in series]
    return result


async def top_products(db: AsyncDatabase, inp: dict, ctx: dict) -> dict:
    by = "quantity" if inp.get("rank_by") == "quantity" else "revenue"
    rows = await (await db.orders.aggregate([
        {"$match": order_filter(inp, ctx["tz"])},
        {"$unwind": "$items"},
        {"$group": {"_id": "$items.item_id", "name": {"$last": "$items.item_name"}, "unit": {"$last": "$items.unit"},
                    "quantity": {"$sum": "$items.quantity"}, "revenue": {"$sum": "$items.line_total"},
                    "orders": {"$sum": 1}}},
        {"$sort": {by: -1}}, {"$limit": limit_of(inp, 10)},
    ])).to_list()
    return {"ranked_by": by, "products": [{"product_id": r.pop("_id"), **r} for r in rows],
            "note": "revenue = sum of line totals after item discounts, before bill-level tax"}


# ---------- propose tools (never write products) ----------

async def propose_product_update(db: AsyncDatabase, inp: dict, ctx: dict) -> dict:
    try:
        action = await ai_actions.propose_update(db, ctx, inp["product_id"], inp.get("changes") or {},
                                                 inp.get("reason") or "")
    except ai_actions.ProposalError as e:
        raise ToolError(str(e))
    ctx["new_actions"].append(action["action_id"])
    return {"action_id": action["action_id"], "status": "awaiting_admin_approval",
            "changes": {f: {"from": action["before"][f], "to": action["after"][f]} for f in action["changed_fields"]},
            "note": "Nothing has been saved. The admin will approve or reject this on the card shown in the chat."}


async def propose_product_create(db: AsyncDatabase, inp: dict, ctx: dict) -> dict:
    fields = {k: v for k, v in inp.items() if k in ai_actions.EDITABLE_FIELDS}
    try:
        action = await ai_actions.propose_create(db, ctx, fields, inp.get("reason") or "")
    except ai_actions.ProposalError as e:
        raise ToolError(str(e))
    ctx["new_actions"].append(action["action_id"])
    return {"action_id": action["action_id"], "status": "awaiting_admin_approval", "warning": action.get("warning"),
            "note": "Nothing has been saved. The admin will approve or reject this on the card shown in the chat."}


HANDLERS = {
    "search_products": search_products,
    "get_product": get_product,
    "list_categories": list_categories,
    "search_orders": search_orders,
    "get_order": get_order,
    "sales_summary": sales_summary,
    "top_products": top_products,
    "propose_product_update": propose_product_update,
    "propose_product_create": propose_product_create,
}


async def run_tool(db: AsyncDatabase, name: str, inp: dict, ctx: dict) -> tuple[str, bool]:
    """Run one tool call. Returns (JSON text, is_error)."""
    handler = HANDLERS.get(name)
    if handler is None:
        return f"Unknown tool {name}", True
    try:
        result = await handler(db, inp if isinstance(inp, dict) else {}, ctx)
    except ToolError as e:
        return str(e), True
    except (KeyError, TypeError, ValueError, ArithmeticError) as e:
        return f"Invalid input for {name}: {e}", True
    return json.dumps(jsonable(result, ctx["tz"]), ensure_ascii=False), False


# ---------- tool definitions sent to Claude ----------

_DATE = {"type": "string", "description": "ISO date or date-time. A date alone means local midnight (shop timezone)."}
_ORDER_FILTERS = {
    "created_from": {**_DATE, "description": "Orders created at or after this (inclusive). " + _DATE["description"]},
    "created_to": {**_DATE, "description": "Orders created before this (exclusive). For 'today' use tomorrow's date. "
                                           + _DATE["description"]},
    "status": {"type": "string", "enum": ["new", "completed"],
               "description": "new = open/not yet completed; completed = finalised (stock deducted)."},
    "customer_type": {"type": "string", "enum": ["registered", "guest"]},
    "customer": {"type": "string", "description": "Part of the customer's username, or a guest's name."},
    "product_id": {"type": "string", "description": "Only orders that contain this product."},
}
_PRODUCT_FIELDS = {
    "name": {"type": "string", "maxLength": 120},
    "category": {"type": "string", "maxLength": 60},
    "description": {"type": "string", "maxLength": 1000},
    "price": {"type": "number", "exclusiveMinimum": 0, "description": "Price per unit, in the shop currency."},
    "unit": {"type": "string", "enum": ["pcs", "kg", "g", "l", "ml", "dozen", "pack"]},
    "gst_rate": {"type": ["number", "null"], "minimum": 0, "maximum": 100,
                 "description": "Per-product GST % (used when tax mode is per product). null = no product rate."},
    "in_stock": {"type": ["number", "null"], "minimum": 0,
                 "description": "Stock quantity in the product's unit. null = stock not tracked."},
}

TOOLS = [
    {
        "name": "search_products",
        "description": "Find products in the catalog. Every word of `query` must match the name, category, "
                       "description or product id (case-insensitive). Use max_stock to find low or out-of-stock "
                       "products (only products with stock tracking). Returns current price, unit, GST rate, stock.",
        "input_schema": {"type": "object", "properties": {
            "query": {"type": "string"},
            "category": {"type": "string"},
            "max_stock": {"type": "number", "description": "Only tracked products with stock <= this. 0 = out of stock."},
            "limit": {"type": "integer", "minimum": 1, "maximum": MAX_ROWS},
        }},
    },
    {
        "name": "get_product",
        "description": "Get one product by product_id (e.g. PRD-00012).",
        "input_schema": {"type": "object", "properties": {"product_id": {"type": "string"}},
                         "required": ["product_id"]},
    },
    {
        "name": "list_categories",
        "description": "List product categories with how many products each has.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "search_orders",
        "description": "List orders matching filters, newest first by default. Returns total_matches plus up to "
                       "`limit` rows (order id, customer, status, item count, total, dates). For totals and "
                       "counts over many orders use sales_summary instead of adding rows up.",
        "input_schema": {"type": "object", "properties": {
            "order_id": {"type": "string", "description": "Full or partial order id, e.g. ORD-20261024-000123."},
            **_ORDER_FILTERS,
            "sort_by": {"type": "string", "enum": ["created_at", "updated_at", "total_price"]},
            "sort_dir": {"type": "string", "enum": ["asc", "desc"]},
            "limit": {"type": "integer", "minimum": 1, "maximum": MAX_ROWS},
        }},
    },
    {
        "name": "get_order",
        "description": "Full details of one order / bill: line items with quantities, prices, discounts and tax, "
                       "and the bill totals. Prices are as they were when the order was placed or last edited.",
        "input_schema": {"type": "object", "properties": {"order_id": {"type": "string"}}, "required": ["order_id"]},
    },
    {
        "name": "sales_summary",
        "description": "Exact totals over orders matching the filters: order count, sales (sum of bill totals), "
                       "discounts, tax, average order value, split by status. Set group_by for a day/week/month "
                       "time series. Includes both new and completed orders unless status is set.",
        "input_schema": {"type": "object", "properties": {
            **_ORDER_FILTERS,
            "group_by": {"type": "string", "enum": ["day", "week", "month"]},
        }},
    },
    {
        "name": "top_products",
        "description": "Best-selling products over orders matching the filters, ranked by revenue or quantity.",
        "input_schema": {"type": "object", "properties": {
            **_ORDER_FILTERS,
            "rank_by": {"type": "string", "enum": ["revenue", "quantity"]},
            "limit": {"type": "integer", "minimum": 1, "maximum": MAX_ROWS},
        }},
    },
    {
        "name": "propose_product_update",
        "description": "Propose changing an existing product. This does NOT save anything: it creates a pending "
                       "change that the admin approves or rejects on a card in the chat. Include only the fields "
                       "that should change. Call it once per product; for several products, call it several times.",
        "input_schema": {"type": "object", "properties": {
            "product_id": {"type": "string"},
            "changes": {"type": "object", "properties": _PRODUCT_FIELDS, "additionalProperties": False,
                        "minProperties": 1},
            "reason": {"type": "string", "description": "Short note of where this came from, e.g. "
                                                        "'price list photo, row 3' or 'admin asked by voice'."},
        }, "required": ["product_id", "changes", "reason"]},
    },
    {
        "name": "propose_product_create",
        "description": "Propose adding a new product. This does NOT save anything: the admin approves or rejects "
                       "it on a card. Search first to make sure the product doesn't already exist.",
        "input_schema": {"type": "object", "properties": {
            **_PRODUCT_FIELDS, "reason": {"type": "string"},
        }, "required": ["name", "category", "price", "unit", "reason"]},
    },
]
