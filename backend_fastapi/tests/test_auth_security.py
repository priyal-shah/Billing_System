"""Cookie sessions, CSRF, refresh rotation, forced password change and two-factor sign-in."""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from pymongo import MongoClient

from app import totp
from app.config import Settings
from app.db import create_client
from app.main import create_app
from app.security import admins_with_default_password, hash_password
from tests.conftest import TEST_DB, session_headers


@pytest.fixture()
def db(cfg):
    sync = MongoClient(cfg.mongo_uri, tz_aware=True)
    yield sync[TEST_DB]
    sync.close()


def add_user(db, username, password, role="user", **extra):
    db.users.insert_one({"username": username, "password_hash": hash_password(password), "role": role,
                         "created_at": datetime.now(timezone.utc), **extra})


def csrf(client):
    return {"X-CSRF-Token": client.cookies.get("csrf_token")}


def login(client, username, password):
    return client.post("/api/auth/login", json={"username": username, "password": password})


def current_code(secret):
    return totp.code_at(secret, totp.current_step())


def test_login_uses_httponly_cookies_and_csrf(client):
    r = login(client, "admin", "test-admin-pass-9")
    assert r.status_code == 200 and "access_token" not in r.json()
    set_cookie = " ".join(r.headers.get_list("set-cookie")).lower()
    assert "access_token=" in set_cookie and "refresh_token=" in set_cookie and "httponly" in set_cookie
    assert "samesite=strict" in set_cookie  # refresh cookie

    assert client.get("/api/auth/me").json()["username"] == "admin"
    body = {"name": "Rice", "category": "Grains", "price": 10, "unit": "kg"}
    assert client.post("/api/products", json=body).status_code == 403  # no CSRF header
    assert client.post("/api/products", json=body, headers={"X-CSRF-Token": "forged"}).status_code == 403
    assert client.post("/api/products", json=body, headers=csrf(client)).status_code == 201


def test_bearer_tokens_only_work_for_guests(client):
    r = login(client, "admin", "test-admin-pass-9")
    access = r.cookies.get("access_token")
    client.cookies.clear()
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {access}"}).status_code == 401


def test_refresh_rotates_and_detects_reuse(client, db):
    login(client, "admin", "test-admin-pass-9")
    old_refresh = client.cookies.get("refresh_token", path="/api/auth")
    assert client.post("/api/auth/refresh").status_code == 403  # CSRF header required here too
    r = client.post("/api/auth/refresh", headers=csrf(client))
    assert r.status_code == 200
    new_refresh = client.cookies.get("refresh_token", path="/api/auth")
    assert new_refresh and new_refresh != old_refresh

    # The old token turning up again later means it was copied: the whole login is ended.
    db.refresh_tokens.update_many({"used_at": {"$ne": None}},
                                  {"$set": {"used_at": datetime.now(timezone.utc) - timedelta(minutes=5)}})
    token = csrf(client)
    client.cookies.clear()
    client.cookies.set("refresh_token", old_refresh, domain="testserver.local", path="/api/auth")
    assert client.post("/api/auth/refresh", headers=token).status_code == 401
    assert db.refresh_tokens.count_documents({"username": "admin"}) == 0


def test_logout_and_logout_everywhere(client, db):
    other_device = session_headers(client, login(client, "admin", "test-admin-pass-9"))
    login(client, "admin", "test-admin-pass-9")
    assert client.post("/api/auth/logout", headers=csrf(client)).status_code == 204
    assert client.post("/api/auth/refresh").status_code == 401
    assert client.get("/api/auth/me", headers=other_device).status_code == 200  # other device unaffected

    login(client, "admin", "test-admin-pass-9")
    assert client.post("/api/auth/logout-all", headers=csrf(client)).status_code == 204
    assert client.get("/api/auth/me", headers=other_device).status_code == 401  # token_version bumped


def test_disabled_account_is_locked_out(client, db):
    add_user(db, "cashier", "cashier-pass-1")
    session = session_headers(client, login(client, "cashier", "cashier-pass-1"))
    db.users.update_one({"username": "cashier"}, {"$set": {"disabled": True}})
    assert client.get("/api/auth/me", headers=session).status_code == 401
    assert login(client, "cashier", "cashier-pass-1").status_code == 401


def test_default_password_must_be_changed(client, db):
    add_user(db, "owner", "admin123", role="admin")
    r = login(client, "owner", "admin123")
    assert r.json()["user"]["must_change_password"] is True
    h = csrf(client)
    assert client.get("/api/orders").status_code == 403  # everything else is blocked...
    assert client.get("/api/orders").headers["X-Account-Action"] == "password_change_required"
    assert client.get("/api/auth/me").status_code == 200  # ...except finishing the setup

    def change(new, current="admin123"):
        return client.post("/api/auth/change-password", headers=h,
                           json={"current_password": current, "new_password": new})

    assert change("short").status_code == 422
    assert change("password123").status_code == 400
    assert change("owner-is-me-123").status_code == 400  # contains username
    assert change("Valid-new-pass-7", current="wrong").status_code == 400
    r = change("Valid-new-pass-7")
    assert r.status_code == 200 and r.json()["user"]["must_change_password"] is False
    assert client.get("/api/orders").status_code == 200
    assert login(client, "owner", "admin123").status_code == 401


def test_production_refuses_default_admin_password(db):
    add_user(db, "owner", "admin123", role="admin")

    async def check():
        client = create_client(Settings().mongo_uri)
        try:
            return await admins_with_default_password(client[TEST_DB])
        finally:
            await client.close()

    assert "owner" in asyncio.run(check())


@pytest.fixture()
def strict_client(cfg):
    """App with admin 2FA required (the production default)."""
    with TestClient(create_app(cfg.model_copy(update={"require_admin_2fa": True}))) as c:
        yield c


def test_admin_must_enroll_and_then_use_two_factor(client, strict_client, db):
    c = strict_client
    r = login(c, "admin", "test-admin-pass-9")
    assert r.json()["user"]["mfa_setup_required"] is True
    assert c.get("/api/orders").headers.get("X-Account-Action") == "mfa_setup_required"

    setup = c.post("/api/auth/2fa/setup", headers=csrf(c)).json()
    assert setup["otpauth_uri"].startswith("otpauth://totp/")
    assert c.post("/api/auth/2fa/enable", headers=csrf(c), json={"code": "000000"}).status_code == 400
    # Let the enrolment code be the previous step so the sign-in below can use the current one.
    enroll = totp.code_at(setup["secret"], totp.current_step() - 1)
    codes = c.post("/api/auth/2fa/enable", headers=csrf(c), json={"code": enroll}).json()["recovery_codes"]
    assert len(codes) == 10
    assert c.get("/api/orders").status_code == 200
    assert c.post("/api/auth/2fa/disable", headers=csrf(c),
                  json={"password": "test-admin-pass-9", "code": codes[0]}).status_code == 400  # required

    # Signing in now takes two steps.
    c.cookies.clear()
    r = login(c, "admin", "test-admin-pass-9")
    assert r.json() == {"mfa_required": True, "user": None} and "access_token" not in r.cookies
    assert c.get("/api/auth/me").status_code == 401
    assert c.post("/api/auth/login/2fa", json={"code": "123456"}).status_code == 401
    code = current_code(setup["secret"])
    assert c.post("/api/auth/login/2fa", json={"code": code}).status_code == 200
    assert c.get("/api/orders").status_code == 200

    # The same code can't be used twice; a recovery code works once.
    c.cookies.clear()
    login(c, "admin", "test-admin-pass-9")
    assert c.post("/api/auth/login/2fa", json={"code": code}).status_code == 401
    assert c.post("/api/auth/login/2fa", json={"code": codes[1]}).status_code == 200
    c.cookies.clear()
    login(c, "admin", "test-admin-pass-9")
    assert c.post("/api/auth/login/2fa", json={"code": codes[1]}).status_code == 401


def test_second_step_needs_the_first(strict_client):
    assert strict_client.post("/api/auth/login/2fa", json={"code": "123456"}).status_code == 401
