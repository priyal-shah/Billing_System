import os

import pytest
from fastapi.testclient import TestClient
from pymongo import MongoClient

from app.config import Settings
from app.main import create_app
from app.security import hash_password

TEST_DB = os.getenv("TEST_MONGO_DB", "grocery_billing_test")


@pytest.fixture()
def cfg() -> Settings:
    # No API key: tests never call the real AI service (AI tests inject a fake client).
    # Admin 2FA is switched off here so most tests can sign in with a password; test_auth_security
    # turns it back on.
    return Settings(mongo_db=TEST_DB, jwt_secret="test-secret-key-that-is-long-enough-32b", anthropic_api_key="",
                    require_admin_2fa=False)


@pytest.fixture()
def client(cfg):
    sync = MongoClient(cfg.mongo_uri)
    sync.drop_database(TEST_DB)
    sync[TEST_DB].users.insert_one({
        "username": "admin", "password_hash": hash_password("test-admin-pass-9"), "role": "admin", "full_name": "Admin",
        "created_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc),
    })
    with TestClient(create_app(cfg)) as c:
        yield c
    sync.drop_database(TEST_DB)
    sync.close()


def session_headers(client: TestClient, response) -> dict:
    """Headers that carry one signed-in session (its cookies + CSRF header).

    Several users are signed in at once in a test, so each keeps its own cookies in a header
    instead of the client's shared cookie jar, which is then emptied.
    """
    access, csrf = response.cookies.get("access_token"), response.cookies.get("csrf_token")
    assert access and csrf, response.text
    client.cookies.clear()
    return {"Cookie": f"access_token={access}; csrf_token={csrf}", "X-CSRF-Token": csrf}


def auth_header(client: TestClient, username: str, password: str) -> dict:
    r = client.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return session_headers(client, r)


@pytest.fixture()
def admin(client):
    return auth_header(client, "admin", "test-admin-pass-9")


@pytest.fixture()
def user(client):
    r = client.post("/api/auth/register", json={"username": "shopper", "password": "secret1"})
    assert r.status_code == 201, r.text
    return session_headers(client, r)
