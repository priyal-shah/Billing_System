import asyncio
import re

from app.db import create_client, ensure_indexes, next_sequence
from app.services.orders import generate_order_id


def make_product(client, admin, **overrides):
    body = {"name": "Rice", "category": "Grains", "description": "Basmati", "price": 100, "unit": "kg",
            "gst_rate": 5, "in_stock": 10, **overrides}
    r = client.post("/api/products", json=body, headers=admin)
    assert r.status_code == 201, r.text
    return r.json()


def test_roles_are_enforced(client, admin, user):
    assert client.get("/api/products").status_code == 401
    assert client.post("/api/products", json={}, headers=user).status_code == 403
    assert client.get("/api/orders", headers=user).status_code == 403
    assert client.put("/api/settings", json={}, headers=user).status_code == 403
    assert client.get("/api/orders", headers=admin).status_code == 200


def test_product_crud_and_search(client, admin, user):
    p = make_product(client, admin)
    make_product(client, admin, name="Green Tea", category="Beverages", description="Organic leaves", unit="pcs")
    assert re.fullmatch(r"PRD-\d{5}", p["product_id"])

    def search(**params):
        r = client.get("/api/products", params=params, headers=user)
        return [x["name"] for x in r.json()["items"]]

    assert search(name="rice") == ["Rice"]
    assert search(category="bev") == ["Green Tea"]
    assert search(description="organic") == ["Green Tea"]
    assert search(q="basmati") == ["Rice"]

    r = client.put(f"/api/products/{p['product_id']}", headers=admin,
                   json={**{k: p[k] for k in ("name", "category", "description", "unit")}, "price": 110})
    assert r.json()["price"] == 110 and r.json()["in_stock"] is None

    assert client.delete(f"/api/products/{p['product_id']}", headers=admin).status_code == 204
    assert search(name="rice") == []


def test_place_order_and_stock(client, admin, user):
    rice = make_product(client, admin)
    soap = make_product(client, admin, name="Soap", unit="pcs", price=40, in_stock=None, gst_rate=18)

    r = client.post("/api/orders", headers=user, json={"items": [
        {"item_id": rice["product_id"], "quantity": 1.5}, {"item_id": soap["product_id"], "quantity": 2}]})
    assert r.status_code == 201, r.text
    order = r.json()
    assert re.fullmatch(r"ORD-\d{8}-\d{6}", order["order_id"])
    assert order["status"] == "new" and order["total_price"] == 230  # no tax configured by default
    # placing an order does not touch stock; completing it does
    assert client.get(f"/api/products/{rice['product_id']}", headers=user).json()["in_stock"] == 10

    # fractional quantity rejected for a pcs item; over-stock rejected
    bad = client.post("/api/orders", headers=user, json={"items": [{"item_id": soap["product_id"], "quantity": 1.5}]})
    assert bad.status_code == 400
    bad = client.post("/api/orders", headers=user, json={"items": [{"item_id": rice["product_id"], "quantity": 20}]})
    assert bad.status_code == 409

    mine = client.get("/api/orders/my", headers=user).json()
    assert mine["total"] == 1 and mine["items"][0]["order_id"] == order["order_id"]


def test_admin_edits_order(client, admin, user):
    rice = make_product(client, admin)
    tea = make_product(client, admin, name="Tea", unit="pcs", price=50, in_stock=None)
    oid = client.post("/api/orders", headers=user,
                      json={"items": [{"item_id": rice["product_id"], "quantity": 2}]}).json()["order_id"]

    r = client.post(f"/api/orders/{oid}/items", headers=admin, json={"item_id": tea["product_id"], "quantity": 3})
    assert r.json()["total_price"] == 350
    r = client.patch(f"/api/orders/{oid}/items/{rice['product_id']}", headers=admin,
                     json={"unit_price": 90, "discount_type": "percent", "discount_value": 10})
    assert r.json()["items"][0]["line_total"] == 162  # 2 * 90 - 10%
    r = client.patch(f"/api/orders/{oid}/items/{rice['product_id']}", headers=admin, json={"quantity": 5})
    assert r.status_code == 200
    # editing an open order checks availability but doesn't deduct
    assert client.patch(f"/api/orders/{oid}/items/{rice['product_id']}", headers=admin,
                        json={"quantity": 11}).status_code == 409
    assert client.get(f"/api/products/{rice['product_id']}", headers=admin).json()["in_stock"] == 10
    r = client.delete(f"/api/orders/{oid}/items/{rice['product_id']}", headers=admin)
    assert r.json()["item_count"] == 1

    # stale version is rejected
    stale = client.put(f"/api/orders/{oid}", headers=admin,
                       json={"version": 1, "items": [{"item_id": tea["product_id"], "quantity": 1}]})
    assert stale.status_code == 409

    client.patch(f"/api/orders/{oid}/status", headers=admin, json={"status": "completed"})
    locked = client.patch(f"/api/orders/{oid}/items/{tea['product_id']}", headers=admin, json={"quantity": 1})
    assert locked.status_code == 409


def test_order_search_and_bill(client, admin, user):
    rice = make_product(client, admin)
    oid = client.post("/api/orders", headers=user,
                      json={"items": [{"item_id": rice["product_id"], "quantity": 1}]}).json()["order_id"]

    def search(**params):
        return [o["order_id"] for o in client.get("/api/orders", params=params, headers=admin).json()["items"]]

    assert search(username="shop") == [oid]
    assert search(order_id=oid[-6:]) == [oid]
    assert search(created_from="2000-01-01T00:00:00Z") == [oid]
    assert search(updated_to="2000-01-01T00:00:00Z") == []
    assert search(status="completed") == []

    bill = client.get(f"/api/orders/{oid}/bill", params={"format": "format_b"}, headers=admin).json()
    assert bill["format"]["id"] == "format_b" and bill["order"]["order_id"] == oid
    assert client.get(f"/api/orders/{oid}/bill", params={"format": "nope"}, headers=admin).status_code == 400


def test_settings_tax_applies_to_new_orders_only(client, admin, user):
    rice = make_product(client, admin, in_stock=None)
    cart = {"items": [{"item_id": rice["product_id"], "quantity": 1}]}
    before = client.post("/api/orders", headers=user, json=cart).json()

    s = client.get("/api/settings", headers=admin).json()
    r = client.put("/api/settings", headers=admin, json={**s, "tax_mode": "bill", "tax_rate": 18,
                                                         "gst_number": "24ABCDE1234F1Z5"})
    assert r.status_code == 200, r.text
    assert client.put("/api/settings", headers=admin, json={**s, "gst_number": "BAD"}).status_code == 422

    after = client.post("/api/orders", headers=user, json=cart).json()
    assert after["total_price"] == 118
    assert client.get(f"/api/orders/{before['order_id']}", headers=admin).json()["total_price"] == 100


def test_order_ids_unique_under_concurrency(cfg):
    async def run():
        client = create_client(cfg.mongo_uri)
        db = client[cfg.mongo_db]
        await db.drop_collection("counters")
        await ensure_indexes(db)
        ids = await asyncio.gather(*(generate_order_id(db) for _ in range(200)))
        seqs = await asyncio.gather(*(next_sequence(db, "fresh") for _ in range(50)))
        await client.drop_database(cfg.mongo_db)
        await client.close()
        return ids, seqs

    ids, seqs = asyncio.run(run())
    assert len(set(ids)) == 200
    assert sorted(seqs) == list(range(1, 51))


def test_guest_checkout(client, admin, user):
    rice = make_product(client, admin, in_stock=None)
    assert client.post("/api/auth/guest", json={"name": " "}).status_code == 422

    r = client.post("/api/auth/guest", json={"name": "  Walk-in   Asha "})
    assert r.status_code == 200, r.text
    guest = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert r.json()["user"]["role"] == "guest" and r.json()["user"]["full_name"] == "Walk-in Asha"
    assert client.get("/api/auth/me", headers=guest).json()["role"] == "guest"

    # guests can browse and order like a user...
    assert client.get("/api/products", headers=guest).status_code == 200
    order = client.post("/api/orders", headers=guest,
                        json={"items": [{"item_id": rice["product_id"], "quantity": 2}]}).json()
    assert order["is_guest"] is True and order["username"] == "Walk-in Asha"

    # ...but get no history, and nothing admin-only
    assert client.get("/api/orders/my", headers=guest).status_code == 403
    assert client.get(f"/api/orders/{order['order_id']}", headers=guest).status_code == 403
    assert client.get("/api/orders", headers=guest).status_code == 403
    assert client.post("/api/products", json={}, headers=guest).status_code == 403

    # a registered user can't see the guest order even if names collide
    assert client.get("/api/orders/my", headers=user).json()["total"] == 0

    # admin sees it, flagged, and can filter by customer type
    ids = lambda **p: [o["order_id"] for o in client.get("/api/orders", params=p, headers=admin).json()["items"]]
    assert ids(customer_type="guest") == [order["order_id"]]
    assert ids(customer_type="registered") == []
    assert ids(username="asha") == [order["order_id"]]
    assert client.get(f"/api/orders/{order['order_id']}", headers=admin).json()["is_guest"] is True


def test_admin_cannot_place_orders(client, admin):
    # Guards against a stale admin token being used from a guest/customer screen.
    rice = make_product(client, admin, in_stock=None)
    r = client.post("/api/orders", headers=admin, json={"items": [{"item_id": rice["product_id"], "quantity": 1}]})
    assert r.status_code == 403
    assert client.get("/api/orders", headers=admin).json()["total"] == 0


def stock_of(client, admin, product):
    return client.get(f"/api/products/{product['product_id']}", headers=admin).json()["in_stock"]


def test_stock_deducted_on_completion(client, admin, user):
    rice = make_product(client, admin)                      # 10 kg tracked
    soap = make_product(client, admin, name="Soap", unit="pcs", price=40, in_stock=None)
    order = client.post("/api/orders", headers=user, json={"items": [
        {"item_id": rice["product_id"], "quantity": 2.5}, {"item_id": soap["product_id"], "quantity": 3}]}).json()
    oid = order["order_id"]
    assert stock_of(client, admin, rice) == 10

    # complete -> stock goes down by exactly the ordered quantity; untracked items are ignored
    r = client.patch(f"/api/orders/{oid}/status", headers=admin, json={"status": "completed"})
    assert r.status_code == 200 and r.json()["status"] == "completed"
    assert stock_of(client, admin, rice) == 7.5
    assert stock_of(client, admin, soap) is None

    # completing twice doesn't deduct twice
    client.patch(f"/api/orders/{oid}/status", headers=admin, json={"status": "completed"})
    assert stock_of(client, admin, rice) == 7.5

    # reopen -> stock comes back; edit; complete again -> new quantity deducted
    client.patch(f"/api/orders/{oid}/status", headers=admin, json={"status": "new"})
    assert stock_of(client, admin, rice) == 10
    client.patch(f"/api/orders/{oid}/items/{rice['product_id']}", headers=admin, json={"quantity": 4})
    client.patch(f"/api/orders/{oid}/status", headers=admin, json={"status": "completed"})
    assert stock_of(client, admin, rice) == 6


def test_completion_blocked_when_stock_ran_out(client, admin, user):
    rice = make_product(client, admin, in_stock=5)
    first = client.post("/api/orders", headers=user, json={"items": [{"item_id": rice["product_id"], "quantity": 4}]}).json()
    second = client.post("/api/orders", headers=user, json={"items": [{"item_id": rice["product_id"], "quantity": 3}]}).json()

    assert client.patch(f"/api/orders/{first['order_id']}/status", headers=admin,
                        json={"status": "completed"}).status_code == 200
    r = client.patch(f"/api/orders/{second['order_id']}/status", headers=admin, json={"status": "completed"})
    assert r.status_code == 409 and "Insufficient stock" in r.json()["detail"]
    assert client.get(f"/api/orders/{second['order_id']}", headers=admin).json()["status"] == "new"
    assert stock_of(client, admin, rice) == 1


def test_legacy_orders_are_not_deducted_twice(client, admin, user, cfg):
    """Orders placed before this change already had stock taken at placement (no stock_applied flag)."""
    from pymongo import MongoClient

    rice = make_product(client, admin)
    oid = client.post("/api/orders", headers=user, json={"items": [{"item_id": rice["product_id"], "quantity": 2}]}).json()["order_id"]
    sync = MongoClient(cfg.mongo_uri)
    sync[cfg.mongo_db].orders.update_one({"order_id": oid}, {"$unset": {"stock_applied": ""}})
    sync[cfg.mongo_db].products.update_one({"product_id": rice["product_id"]}, {"$inc": {"in_stock": -2}})
    sync.close()
    assert stock_of(client, admin, rice) == 8

    client.patch(f"/api/orders/{oid}/status", headers=admin, json={"status": "completed"})
    assert stock_of(client, admin, rice) == 8
    client.patch(f"/api/orders/{oid}/status", headers=admin, json={"status": "new"})
    assert stock_of(client, admin, rice) == 10


def test_login_is_rate_limited(client):
    for _ in range(10):
        assert client.post("/api/auth/login", json={"username": "admin", "password": "wrong"}).status_code == 401
    r = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 429 and "Retry-After" in r.headers


def test_production_refuses_unsafe_config():
    import pytest
    from app.config import Settings
    from app.main import create_app

    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        create_app(Settings(app_env="production", jwt_secret="change-me-in-production", mongo_uri="mongodb+srv://x.example.net"))
    with pytest.raises(RuntimeError, match="localhost"):
        create_app(Settings(app_env="production", jwt_secret="x" * 40, mongo_uri="mongodb://localhost:27017"))
    app = create_app(Settings(app_env="production", jwt_secret="x" * 40, mongo_uri="mongodb+srv://x.example.net"))
    assert app.docs_url is None
