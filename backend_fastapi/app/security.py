from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .db import get_db, utcnow

bearer = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:
        return False


def create_access_token(request: Request, username: str, role: str, **claims) -> str:
    cfg = request.app.state.settings
    minutes = cfg.guest_expire_minutes if role == "guest" else cfg.jwt_expire_minutes
    now = utcnow()
    payload = {"sub": username, "role": role, "iat": now, "exp": now + timedelta(minutes=minutes), **claims}
    return jwt.encode(payload, cfg.jwt_secret, algorithm=cfg.jwt_algorithm)


def guest_from_payload(payload: dict) -> dict:
    """Guests have no DB record; their identity lives entirely in the signed token."""
    return {
        "username": payload["sub"],
        "full_name": payload.get("name") or "Guest",
        "role": "guest",
        "created_at": datetime.fromtimestamp(payload.get("iat", 0), timezone.utc),
    }


async def get_current_user(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db=Depends(get_db),
) -> dict:
    unauthorized = HTTPException(
        status.HTTP_401_UNAUTHORIZED, "Not authenticated", headers={"WWW-Authenticate": "Bearer"}
    )
    if creds is None:
        raise unauthorized
    cfg = request.app.state.settings
    try:
        payload = jwt.decode(creds.credentials, cfg.jwt_secret, algorithms=[cfg.jwt_algorithm])
    except jwt.PyJWTError:
        raise unauthorized
    if payload.get("role") == "guest":
        return guest_from_payload(payload)
    user = await db.users.find_one({"username": payload.get("sub")}, {"password_hash": 0})
    if not user:
        raise unauthorized
    return user


async def require_registered(user: dict = Depends(get_current_user)) -> dict:
    if user["role"] == "guest":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Order history is only available with an account")
    return user


async def require_customer(user: dict = Depends(get_current_user)) -> dict:
    if user["role"] not in ("user", "guest"):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Orders can only be placed by customers. You are signed in as an admin in this browser; "
            "use a separate tab for guest ordering.",
        )
    return user


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user["role"] != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin access required")
    return user
