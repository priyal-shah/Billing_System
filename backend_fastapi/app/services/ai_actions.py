"""Product changes proposed by the AI assistant, held until an admin approves them.

The assistant can only *propose*: a proposal is stored in `ai_pending_actions` and nothing touches
`products` until the admin who asked calls the approve endpoint. Approval is single-use (atomic
pending -> applying claim), expires, and is refused if the product changed after the proposal.
"""
import re
from datetime import timedelta
from decimal import Decimal
from typing import Any

from fastapi import HTTPException, status
from pydantic import ValidationError
from pymongo import ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase

from ..db import next_sequence, utcnow
from ..schemas import ProductIn
from .products import ACTIVE, insert_product, replace_product

ACTION_TTL = timedelta(minutes=15)
EDITABLE_FIELDS = ("name", "category", "description", "price", "unit", "gst_rate", "in_stock")
FIELD_LABELS = {
    "name": "Name", "category": "Category", "description": "Description", "price": "Price",
    "unit": "Unit", "gst_rate": "GST rate (%)", "in_stock": "Stock",
}


class ProposalError(ValueError):
    """A proposal the assistant should fix and retry (message is shown to the model)."""


def validation_message(err: ValidationError) -> str:
    parts = []
    for e in err.errors():
        field = ".".join(str(p) for p in e["loc"])
        parts.append(f"{field}: {e['msg']}" if field else e["msg"])
    return "; ".join(parts)


def validate_product(fields: dict) -> dict:
    """Validate with the same schema the Products page uses; return storable values."""
    try:
        body = ProductIn(**fields)
    except ValidationError as e:
        raise ProposalError(validation_message(e)) from None
    return {**body.model_dump(mode="python"), "unit": body.unit.value}


def editable_values(product: dict) -> dict:
    return {f: product.get(f) for f in EDITABLE_FIELDS}


def same(a: Any, b: Any) -> bool:
    if isinstance(a, (int, float, Decimal)) and isinstance(b, (int, float, Decimal)):
        return Decimal(str(a)) == Decimal(str(b))
    return a == b


def diff(before: dict, after: dict) -> list[str]:
    return [f for f in EDITABLE_FIELDS if not same(before.get(f), after.get(f))]


def clean_changes(changes: dict) -> dict:
    unknown = set(changes) - set(EDITABLE_FIELDS)
    if unknown:
        raise ProposalError(f"Unknown field(s): {', '.join(sorted(unknown))}. Editable: {', '.join(EDITABLE_FIELDS)}")
    return {k: (str(v) if isinstance(v, float) else v) for k, v in changes.items()}


async def _new_action(db: AsyncDatabase, ctx: dict, **fields) -> dict:
    now = utcnow()
    seq = await next_sequence(db, "ai_action")
    action = {
        "action_id": f"ACT-{seq:06d}",
        "status": "pending",
        "requested_by": ctx["username"],
        "conversation_id": ctx["conversation_id"],
        "source": ctx["source"],
        "created_at": now,
        "expires_at": now + ACTION_TTL,
        **fields,
    }
    await db.ai_pending_actions.insert_one(action)
    return action


async def propose_update(db: AsyncDatabase, ctx: dict, product_id: str, changes: dict, reason: str) -> dict:
    product = await db.products.find_one({"product_id": product_id, **ACTIVE})
    if not product:
        raise ProposalError(f"No active product with id {product_id}. Use search_products to find the right id.")
    if not changes:
        raise ProposalError("No changes given.")
    before = editable_values(product)
    after = validate_product({**before, **clean_changes(changes)})
    changed = diff(before, after)
    if not changed:
        raise ProposalError("These values are the same as the current ones; nothing to change.")
    return await _new_action(
        db, ctx, kind="update", product_id=product_id, product_name=product["name"],
        before=before, after=after, changed_fields=changed, reason=reason,
        base_updated_at=product["updated_at"],
    )


async def propose_create(db: AsyncDatabase, ctx: dict, fields: dict, reason: str) -> dict:
    after = validate_product(clean_changes(fields))
    twin = await db.products.find_one(
        {"name": {"$regex": f"^{re.escape(after['name'])}$", "$options": "i"}, **ACTIVE}
    )
    warning = f"A product named '{twin['name']}' already exists ({twin['product_id']})." if twin else None
    return await _new_action(
        db, ctx, kind="create", product_id=None, product_name=after["name"],
        before={f: None for f in EDITABLE_FIELDS}, after=after, changed_fields=diff({}, after),
        reason=reason, warning=warning,
    )


def _plain(v: Any) -> Any:
    return float(v) if isinstance(v, Decimal) else v


def action_out(action: dict) -> dict:
    """Shape sent to the frontend for an approval card."""
    return {
        "action_id": action["action_id"],
        "kind": action["kind"],
        "status": action["status"],
        "product_id": action.get("product_id"),
        "product_name": action.get("product_name"),
        "changes": [
            {"field": f, "label": FIELD_LABELS[f], "current": _plain(action["before"].get(f)),
             "proposed": _plain(action["after"].get(f))}
            for f in action["changed_fields"]
        ],
        "after": {f: _plain(action["after"].get(f)) for f in EDITABLE_FIELDS},
        "reason": action.get("reason") or "",
        "warning": action.get("warning"),
        "source": action.get("source"),
        "edited": action.get("edited", False),
        "error": action.get("error"),
        "created_at": action["created_at"],
        "expires_at": action["expires_at"],
    }


async def get_owned_action(db: AsyncDatabase, action_id: str, username: str) -> dict:
    action = await db.ai_pending_actions.find_one({"action_id": action_id})
    if not action or action["requested_by"] != username:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Proposed change not found")
    if action["status"] == "pending" and action["expires_at"] <= utcnow():
        action = await db.ai_pending_actions.find_one_and_update(
            {"action_id": action_id, "status": "pending"}, {"$set": {"status": "expired"}},
            return_document=ReturnDocument.AFTER,
        ) or await db.ai_pending_actions.find_one({"action_id": action_id})
    return action


def _not_pending(action: dict) -> HTTPException:
    msg = {
        "approved": "This change was already approved.",
        "rejected": "This change was rejected.",
        "expired": "This proposal expired. Ask the assistant again to get a fresh one.",
        "stale": "The product changed after this was proposed. Ask the assistant again.",
        "applying": "This change is being applied.",
    }.get(action["status"], f"This change is {action['status']}.")
    return HTTPException(status.HTTP_409_CONFLICT, msg)


async def approve_action(db: AsyncDatabase, action_id: str, username: str, overrides: dict | None) -> dict:
    action = await get_owned_action(db, action_id, username)
    if action["status"] != "pending":
        raise _not_pending(action)

    after, changed = action["after"], action["changed_fields"]
    if overrides:
        try:
            after = validate_product({**after, **clean_changes(overrides)})
        except ProposalError as e:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from None
        changed = diff(action["before"], after) if action["kind"] == "update" else diff({}, after)
        if not changed:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "The edited values are the same as the current ones.")

    now = utcnow()
    claimed = await db.ai_pending_actions.find_one_and_update(
        {"action_id": action_id, "status": "pending", "expires_at": {"$gt": now}},
        {"$set": {"status": "applying", "decided_by": username, "decided_at": now}},
    )
    if not claimed:
        raise _not_pending(await get_owned_action(db, action_id, username))

    body = ProductIn(**after)
    try:
        if action["kind"] == "update":
            product = await replace_product(db, action["product_id"], body, action["base_updated_at"])
            if product is None:
                await db.ai_pending_actions.update_one(
                    {"action_id": action_id},
                    {"$set": {"status": "stale", "error": "Product was edited or deleted after the proposal."}},
                )
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    "The product was edited or deleted after this was proposed, so nothing was changed. "
                    "Ask the assistant again to get a proposal based on the current values.",
                )
        else:
            product = await insert_product(db, body)
    except HTTPException:
        raise
    except Exception:
        await db.ai_pending_actions.update_one(
            {"action_id": action_id, "status": "applying"}, {"$set": {"status": "pending"}}
        )
        raise

    edited = bool(overrides)
    result = await db.ai_pending_actions.find_one_and_update(
        {"action_id": action_id},
        {"$set": {"status": "approved", "applied_at": utcnow(), "product_id": product["product_id"],
                  "product_name": product["name"], "after": after, "changed_fields": changed, "edited": edited}},
        return_document=ReturnDocument.AFTER,
    )
    await db.ai_audit_log.insert_one({
        "action_id": action_id, "kind": action["kind"], "product_id": product["product_id"],
        "before": action["before"], "after": after, "changed_fields": changed, "edited_by_admin": edited,
        "approved_by": username, "source": action.get("source"), "conversation_id": action["conversation_id"],
        "at": utcnow(),
    })
    return result


async def reject_action(db: AsyncDatabase, action_id: str, username: str) -> dict:
    action = await get_owned_action(db, action_id, username)
    if action["status"] != "pending":
        raise _not_pending(action)
    result = await db.ai_pending_actions.find_one_and_update(
        {"action_id": action_id, "status": "pending"},
        {"$set": {"status": "rejected", "decided_by": username, "decided_at": utcnow()}},
        return_document=ReturnDocument.AFTER,
    )
    if not result:
        raise _not_pending(await get_owned_action(db, action_id, username))
    return result
