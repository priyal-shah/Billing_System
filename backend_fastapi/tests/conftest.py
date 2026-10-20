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
    return Settings(mongo_db=TEST_DB, jwt_secret="test-secret-key-that-is-long-enough-32b")


@pytest.fixture()
def client(cfg):
    sync = MongoClient(cfg.mongo_uri)
    sync.drop_database(TEST_DB)
    sync[TEST_DB].users.insert_one({
        "username": "admin", "password_hash": hash_password("admin123"), "role": "admin", "full_name": "Admin",
        "created_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc),
    })
    with TestClient(create_app(cfg)) as c:
        yield c
    sync.drop_database(TEST_DB)
    sync.close()


def auth_header(client: TestClient, username: str, password: str) -> dict:
    r = client.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture()
def admin(client):
    return auth_header(client, "admin", "admin123")


@pytest.fixture()
def user(client):
    r = client.post("/api/auth/register", json={"username": "shopper", "password": "secret1"})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}
