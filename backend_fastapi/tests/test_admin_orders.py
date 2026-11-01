from tests.test_api import make_product


def test_admin_places_walk_in_order(client, admin, user):
    rice = make_product(client, admin)
    body = {"customer_name": "  Ramesh   Kumar ", "items": [{"item_id": rice["product_id"], "quantity": 2}]}

    assert client.post("/api/orders/admin", json=body, headers=user).status_code == 403
    r = client.post("/api/orders/admin", json=body, headers=admin)
    assert r.status_code == 201, r.text
    order = r.json()
    assert order["username"] == "Ramesh Kumar" and order["is_guest"] is True
    assert order["placed_by"] == "admin" and order["status"] == "new" and order["total_price"] == 200
    # stock is only checked now, deducted on completion like every other order
    assert client.get(f"/api/products/{rice['product_id']}", headers=admin).json()["in_stock"] == 10
    # the bill is available straight away for printing
    assert client.get(f"/api/orders/{order['order_id']}/bill", headers=admin).status_code == 200


def test_admin_places_order_for_registered_customer(client, admin, user):
    rice = make_product(client, admin)
    found = client.get("/api/customers", params={"q": "shop"}, headers=admin).json()
    assert found == [{"username": "shopper", "full_name": None}]
    assert client.get("/api/customers", headers=user).status_code == 403

    r = client.post("/api/orders/admin", headers=admin, json={
        "customer_name": "shopper", "customer_username": "shopper",
        "items": [{"item_id": rice["product_id"], "quantity": 1}]})
    assert r.status_code == 201, r.text
    assert r.json()["is_guest"] is False
    mine = client.get("/api/orders/my", headers=user).json()
    assert [o["order_id"] for o in mine["items"]] == [r.json()["order_id"]]


def test_admin_order_validation(client, admin):
    rice = make_product(client, admin)
    line = [{"item_id": rice["product_id"], "quantity": 1}]
    bad = [
        {"customer_name": "", "items": line},
        {"customer_name": "Ravi", "items": []},
        {"customer_name": "Ravi", "customer_username": "admin", "items": line},  # not a customer account
        {"customer_name": "Ravi", "customer_username": "nobody", "items": line},
        {"customer_name": "Ravi", "items": [{"item_id": rice["product_id"], "quantity": 50}]},  # over stock
    ]
    codes = [client.post("/api/orders/admin", json=b, headers=admin).status_code for b in bad]
    assert codes == [422, 422, 400, 400, 409]
