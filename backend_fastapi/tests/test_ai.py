"""AI assistant tests. Claude is replaced by a scripted fake; no real API calls are made."""
import json
from datetime import datetime, timedelta, timezone
from itertools import count
from types import SimpleNamespace

import pytest
from anthropic.types.beta import BetaTextBlock, BetaToolUseBlock
from pymongo import MongoClient

from app.security import hash_password
from tests.conftest import TEST_DB, auth_header
from tests.test_api import make_product

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
_ids = count(1)


def text(t):
    return BetaTextBlock(type="text", text=t, citations=None)


def tool(tool_name, **inp):
    return BetaToolUseBlock(type="tool_use", id=f"toolu_{next(_ids)}", name=tool_name, input=inp)


def turn(*blocks, stop=None):
    has_tool = any(b.type == "tool_use" for b in blocks)
    return SimpleNamespace(content=list(blocks), stop_reason=stop or ("tool_use" if has_tool else "end_turn"))


class FakeClaude:
    """Returns scripted responses in order and records every request."""

    def __init__(self):
        self.script, self.calls = [], []
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self._create))

    async def _create(self, **kwargs):
        self.calls.append(kwargs)
        return self.script.pop(0)

    def tool_results(self, call_index):
        """tool_result blocks sent in the given request (the last user message)."""
        return [b for b in self.calls[call_index]["messages"][-1]["content"] if b.get("type") == "tool_result"]


@pytest.fixture()
def fake(client):
    f = FakeClaude()
    client.app.state.ai_client = f
    return f


@pytest.fixture()
def db(cfg):
    sync = MongoClient(cfg.mongo_uri, tz_aware=True)
    yield sync[TEST_DB]
    sync.close()


def chat(client, headers, message="", **form):
    files = {"image": form.pop("image")} if "image" in form else None
    return client.post("/api/ai/chat", headers=headers, data={"message": message, **form}, files=files)


def get_price(client, admin, pid):
    return client.get(f"/api/products/{pid}", headers=admin).json()["price"]


def propose_price(client, admin, fake, pid, price):
    fake.script += [
        turn(tool("propose_product_update", product_id=pid, changes={"price": price}, reason="admin asked")),
        turn(text("Waiting for your approval.")),
    ]
    r = chat(client, admin, f"set price to {price}")
    assert r.status_code == 200, r.text
    return r.json()


def test_admin_only_and_disabled(client, admin, user):
    assert client.get("/api/ai/status", headers=user).status_code == 403
    assert chat(client, user, "hi").status_code == 403
    assert client.post("/api/ai/actions/ACT-000001/approve", headers=user).status_code == 403
    assert client.get("/api/ai/status", headers=admin).json()["enabled"] is False
    assert chat(client, admin, "hi").status_code == 503


def test_question_uses_real_totals(client, admin, user, fake):
    rice = make_product(client, admin)
    for qty in (1, 2):
        client.post("/api/orders", headers=user, json={"items": [{"item_id": rice["product_id"], "quantity": qty}]})

    fake.script += [turn(tool("sales_summary")), turn(text("You have 2 orders worth ₹300."))]
    r = chat(client, admin, "How many orders so far?")
    assert r.status_code == 200, r.text
    assert r.json()["reply"] == "You have 2 orders worth ₹300." and r.json()["actions"] == []

    summary = json.loads(fake.tool_results(1)[0]["content"])
    assert summary["overall"]["orders"] == 2 and summary["overall"]["sales"] == "300.00"
    # model, tools and the approval-free setup are what we expect
    first = fake.calls[0]
    assert first["model"] == "claude-opus-5-5" and first["fallbacks"] == "default"
    assert {t["name"] for t in first["tools"]} >= {"search_products", "propose_product_update"}
    assert "approve" not in " ".join(t["name"] for t in first["tools"])


def test_top_products_and_order_lookup(client, admin, user, fake):
    rice = make_product(client, admin)
    tea = make_product(client, admin, name="Tea", unit="pcs", price=50, in_stock=None)
    oid = client.post("/api/orders", headers=user, json={"items": [
        {"item_id": rice["product_id"], "quantity": 1}, {"item_id": tea["product_id"], "quantity": 4}]}).json()["order_id"]

    fake.script += [turn(tool("top_products", rank_by="quantity"), tool("get_order", order_id=oid.lower())),
                    turn(text("ok"))]
    chat(client, admin, "best sellers?")
    top, order = (json.loads(r["content"]) for r in fake.tool_results(1))
    assert [p["name"] for p in top["products"]] == ["Tea", "Rice"]
    assert order["order_id"] == oid and order["total_price"] == "300.00"


def test_proposal_waits_for_approval(client, admin, fake, db):
    rice = make_product(client, admin)
    out = propose_price(client, admin, fake, rice["product_id"], 165)
    [action] = out["actions"]
    assert action["status"] == "pending" and action["changes"] == [
        {"field": "price", "label": "Price", "current": 100.0, "proposed": 165.0}]
    assert get_price(client, admin, rice["product_id"]) == 100  # nothing written yet

    r = client.post(f"/api/ai/actions/{action['action_id']}/approve", headers=admin)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "approved"
    assert get_price(client, admin, rice["product_id"]) == 165
    # single use
    assert client.post(f"/api/ai/actions/{action['action_id']}/approve", headers=admin).status_code == 409
    assert db.ai_audit_log.count_documents({"action_id": action["action_id"], "approved_by": "admin"}) == 1

    # the model is told about the decision on the next turn
    fake.script.append(turn(text("Noted.")))
    chat(client, admin, "thanks", conversation_id=out["conversation_id"])
    last_user = fake.calls[-1]["messages"][-1]["content"][-1]["text"]
    assert f"{action['action_id']}" in last_user and "approved" in last_user


def test_admin_can_edit_before_approving(client, admin, fake):
    rice = make_product(client, admin)
    action = propose_price(client, admin, fake, rice["product_id"], 165)["actions"][0]
    bad = client.post(f"/api/ai/actions/{action['action_id']}/approve", headers=admin, json={"changes": {"price": 0}})
    assert bad.status_code == 400
    r = client.post(f"/api/ai/actions/{action['action_id']}/approve", headers=admin, json={"changes": {"price": "160.50"}})
    assert r.status_code == 200 and r.json()["edited"] is True
    assert get_price(client, admin, rice["product_id"]) == 160.5


def test_stale_rejected_expired(client, admin, fake, db):
    rice = make_product(client, admin)
    pid = rice["product_id"]

    stale = propose_price(client, admin, fake, pid, 165)["actions"][0]["action_id"]
    client.put(f"/api/products/{pid}", headers=admin,
               json={**{k: rice[k] for k in ("name", "category", "description", "unit")}, "price": 120})
    assert client.post(f"/api/ai/actions/{stale}/approve", headers=admin).status_code == 409
    assert get_price(client, admin, pid) == 120
    assert client.get(f"/api/ai/actions/{stale}", headers=admin).json()["status"] == "stale"

    rejected = propose_price(client, admin, fake, pid, 130)["actions"][0]["action_id"]
    assert client.post(f"/api/ai/actions/{rejected}/reject", headers=admin).json()["status"] == "rejected"
    assert client.post(f"/api/ai/actions/{rejected}/approve", headers=admin).status_code == 409

    expired = propose_price(client, admin, fake, pid, 140)["actions"][0]["action_id"]
    db.ai_pending_actions.update_one({"action_id": expired},
                                     {"$set": {"expires_at": datetime.now(timezone.utc) - timedelta(seconds=1)}})
    assert client.post(f"/api/ai/actions/{expired}/approve", headers=admin).status_code == 409
    assert client.get(f"/api/ai/actions/{expired}", headers=admin).json()["status"] == "expired"
    assert get_price(client, admin, pid) == 120


def test_only_requesting_admin_can_approve(client, admin, fake, db):
    rice = make_product(client, admin)
    action = propose_price(client, admin, fake, rice["product_id"], 165)["actions"][0]["action_id"]
    db.users.insert_one({"username": "admin2", "password_hash": hash_password("admin234"), "role": "admin",
                         "created_at": datetime.now(timezone.utc)})
    other = auth_header(client, "admin2", "admin234")
    assert client.post(f"/api/ai/actions/{action}/approve", headers=other).status_code == 404
    assert get_price(client, admin, rice["product_id"]) == 100


def test_invalid_proposals_go_back_to_model(client, admin, fake, db):
    rice = make_product(client, admin)
    pid = rice["product_id"]
    fake.script += [
        turn(tool("propose_product_update", product_id=pid, changes={"price": 0}, reason="x"),
             tool("propose_product_update", product_id=pid, changes={"gst_rate": 150}, reason="x"),
             tool("propose_product_update", product_id=pid, changes={"is_deleted": True}, reason="x"),
             tool("propose_product_update", product_id=pid, changes={"price": 100}, reason="x"),
             tool("propose_product_update", product_id="PRD-99999", changes={"price": 5}, reason="x"),
             tool("propose_product_create", name="Rice", category="Grains", price=-1, unit="kg", reason="x")),
        turn(text("Some values were invalid.")),
    ]
    r = chat(client, admin, "change stuff")
    assert r.json()["actions"] == []
    results = fake.tool_results(1)
    assert len(results) == 6 and all(x.get("is_error") for x in results)
    assert db.ai_pending_actions.count_documents({}) == 0


def test_create_proposal(client, admin, fake):
    make_product(client, admin)
    fake.script += [turn(tool("propose_product_create", name="rice", category="Grains", price=80, unit="kg",
                              reason="photo")), turn(text("ok"))]
    action = chat(client, admin, "add rice").json()["actions"][0]
    assert action["kind"] == "create" and "already exists" in action["warning"]
    r = client.post(f"/api/ai/actions/{action['action_id']}/approve", headers=admin)
    assert r.status_code == 200
    assert client.get(f"/api/products/{r.json()['product_id']}", headers=admin).json()["price"] == 80


def test_image_upload_checks(client, admin, fake):
    assert chat(client, admin, image=("x.gif", b"GIF89a....", "image/gif")).status_code == 400
    big = PNG + b"\x00" * 3_800_000
    assert chat(client, admin, image=("big.png", big, "image/png")).status_code == 413
    assert chat(client, admin, "").status_code == 400

    fake.script.append(turn(text("I see a price list.")))
    r = chat(client, admin, "update from this", image=("list.png", PNG, "image/png"))
    assert r.status_code == 200, r.text
    first_block = fake.calls[0]["messages"][-1]["content"][0]
    assert first_block["type"] == "image" and first_block["source"]["media_type"] == "image/png"

    # history keeps the image and replays it unchanged on the next turn
    fake.script.append(turn(text("ok")))
    chat(client, admin, "and?", conversation_id=r.json()["conversation_id"])
    assert fake.calls[1]["messages"][0]["content"][0]["type"] == "image"
    hist = client.get(f"/api/ai/conversations/{r.json()['conversation_id']}", headers=admin).json()
    assert [m["role"] for m in hist["messages"]] == ["user", "assistant", "user", "assistant"]
    assert hist["messages"][0]["has_image"] is True


def test_refused_turn_is_not_stored(client, admin, fake, db):
    fake.script.append(turn(text("hello"), stop="end_turn"))
    cid = chat(client, admin, "hi").json()["conversation_id"]
    fake.script.append(turn(stop="refusal"))
    r = chat(client, admin, "something odd", conversation_id=cid)
    assert r.status_code == 200 and "can't help" in r.json()["reply"]
    conv = db.ai_conversations.find_one({"conversation_id": cid})
    assert len(conv["messages"]) == 2  # first user turn + reply only


def test_conversation_belongs_to_its_admin(client, admin, fake, db):
    fake.script.append(turn(text("hello")))
    cid = chat(client, admin, "hi").json()["conversation_id"]
    db.users.insert_one({"username": "admin2", "password_hash": hash_password("admin234"), "role": "admin",
                         "created_at": datetime.now(timezone.utc)})
    other = auth_header(client, "admin2", "admin234")
    assert client.get(f"/api/ai/conversations/{cid}", headers=other).status_code == 404
    assert chat(client, other, "hi", conversation_id=cid).status_code == 404
