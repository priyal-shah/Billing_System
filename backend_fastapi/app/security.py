"""Passwords, sessions and access control.

Signed-in users (admins and customers) use cookies the page's JavaScript cannot read:
- `access_token`: short-lived JWT (httpOnly). Carries the user's token_version and a CSRF value.
- `refresh_token`: random, single-use (httpOnly, only sent to /api/auth). Stored hashed in
  `refresh_tokens`; each use swaps it for a new one, and reusing an old one revokes that login.
- `csrf_token`: readable by the page, which echoes it in the X-CSRF-Token header on every
  change (POST/PUT/PATCH/DELETE). Another site can make the browser send cookies, but can't read
  this value, so it can't forge that header.

Guest (QR) sessions keep a bearer token held by one browser tab, by design: a guest ordering in
one tab must never pick up an admin's login from another tab. Bearer tokens are accepted only
for guests.
"""
import hashlib
import hmac
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pymongo.asynchronous.database import AsyncDatabase

from .db import get_db, utcnow

bearer = HTTPBearer(auto_error=False)

ACCESS_COOKIE = "access_token"
REFRESH_COOKIE = "refresh_token"
CSRF_COOKIE = "csrf_token"
MFA_COOKIE = "mfa_pending"
CSRF_HEADER = "X-CSRF-Token"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
MFA_MINUTES = 5
# Seen briefly after a refresh token is used: another tab of the same browser refreshing at the
# same moment, not a stolen token. Within this window a second use is answered without revoking.
REFRESH_REUSE_GRACE = timedelta(seconds=30)

# Passwords shipped in the seed script / docs. Signing in with one forces a password change,
# and production refuses to start while an admin still has one.
DEFAULT_PASSWORDS = ("admin123", "user123")

# Endpoints an account may use while it still has to change its password or set up 2FA.
SETUP_PATHS = {
    "/api/auth/me", "/api/auth/logout", "/api/auth/logout-all", "/api/auth/change-password",
    "/api/auth/2fa/setup", "/api/auth/2fa/enable", "/api/settings",
}


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:
        return False


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def encode_token(cfg, payload: dict, minutes: float) -> str:
    now = utcnow()
    return jwt.encode({**payload, "iat": now, "exp": now + timedelta(minutes=minutes)},
                      cfg.jwt_secret, algorithm=cfg.jwt_algorithm)


def decode_token(cfg, token: str | None, typ: str) -> dict | None:
    if not token:
        return None
    try:
        payload = jwt.decode(token, cfg.jwt_secret, algorithms=[cfg.jwt_algorithm])
    except jwt.PyJWTError:
        return None
    return payload if payload.get("typ") == typ else None


# ---------- guests (bearer token, one tab) ----------

def create_guest_token(request: Request, guest_id: str, name: str) -> str:
    cfg = request.app.state.settings
    return encode_token(cfg, {"sub": guest_id, "role": "guest", "name": name, "typ": "guest"},
                        cfg.guest_expire_minutes)


def guest_from_payload(payload: dict) -> dict:
    """Guests have no DB record; their identity lives entirely in the signed token."""
    iat = payload.get("iat", 0)
    return {
        "username": payload["sub"],
        "full_name": payload.get("name") or "Guest",
        "role": "guest",
        "created_at": iat if isinstance(iat, datetime) else datetime.fromtimestamp(iat, timezone.utc),
    }


# ---------- signed-in sessions (cookies) ----------

def _cookie(response: Response, cfg, name: str, value: str, max_age: int, path: str, httponly: bool,
            samesite: str = "lax") -> None:
    response.set_cookie(name, value, max_age=max_age, path=path, httponly=httponly,
                        secure=cfg.secure_cookies, samesite=samesite)


async def issue_session(request: Request, response: Response, db: AsyncDatabase, user: dict,
                        family: str | None = None, csrf: str | None = None) -> None:
    """Set fresh access, refresh and CSRF cookies for this browser."""
    cfg = request.app.state.settings
    csrf = csrf or secrets.token_urlsafe(32)
    tv = user.get("token_version", 0)
    access = encode_token(cfg, {"sub": user["username"], "tv": tv, "csrf": csrf, "typ": "access"},
                          cfg.access_token_minutes)
    refresh = secrets.token_urlsafe(48)
    now = utcnow()
    await db.refresh_tokens.insert_one({
        "token_hash": sha256(refresh), "username": user["username"], "family": family or uuid.uuid4().hex,
        "csrf": csrf, "tv": tv, "created_at": now, "expires_at": now + timedelta(days=cfg.refresh_token_days),
        "used_at": None,
    })
    refresh_age = cfg.refresh_token_days * 86400
    _cookie(response, cfg, ACCESS_COOKIE, access, cfg.access_token_minutes * 60, "/api", True)
    _cookie(response, cfg, REFRESH_COOKIE, refresh, refresh_age, "/api/auth", True, "strict")
    _cookie(response, cfg, CSRF_COOKIE, csrf, refresh_age, "/", False)


def clear_session_cookies(request: Request, response: Response) -> None:
    cfg = request.app.state.settings
    for name, path in ((ACCESS_COOKIE, "/api"), (REFRESH_COOKIE, "/api/auth"), (CSRF_COOKIE, "/"),
                       (MFA_COOKIE, "/api/auth")):
        response.delete_cookie(name, path=path, secure=cfg.secure_cookies, httponly=name != CSRF_COOKIE)


def set_mfa_cookie(request: Request, response: Response, user: dict) -> None:
    """Password was right; the 2FA code is still needed. Valid for a few minutes."""
    cfg = request.app.state.settings
    token = encode_token(cfg, {"sub": user["username"], "tv": user.get("token_version", 0), "typ": "mfa"},
                         MFA_MINUTES)
    _cookie(response, cfg, MFA_COOKIE, token, MFA_MINUTES * 60, "/api/auth", True, "strict")


def check_csrf(request: Request, expected: str) -> None:
    sent = request.headers.get(CSRF_HEADER, "")
    if not sent or not hmac.compare_digest(sent, expected):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Security check failed. Reload the page and try again.")


def setup_requirement(user: dict, cfg) -> str | None:
    """What the account must finish before using the app, if anything."""
    if user.get("must_change_password"):
        return "password_change_required"
    if user["role"] == "admin" and cfg.require_admin_2fa and not user.get("totp_enabled"):
        return "mfa_setup_required"
    return None


def unauthorized(msg: str = "Not authenticated") -> HTTPException:
    return HTTPException(status.HTTP_401_UNAUTHORIZED, msg)


async def get_current_user(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db=Depends(get_db),
) -> dict:
    cfg = request.app.state.settings
    if creds is not None:  # bearer tokens are only issued to guests
        payload = decode_token(cfg, creds.credentials, "guest")
        if payload is None:
            raise unauthorized()
        return guest_from_payload(payload)

    payload = decode_token(cfg, request.cookies.get(ACCESS_COOKIE), "access")
    if payload is None:
        raise unauthorized()
    if request.method not in SAFE_METHODS:
        check_csrf(request, payload.get("csrf", ""))
    user = await db.users.find_one({"username": payload.get("sub")})
    if not user or user.get("disabled") or user.get("token_version", 0) != payload.get("tv"):
        raise unauthorized("Your session has ended. Please sign in again.")
    if (need := setup_requirement(user, cfg)) and request.url.path not in SETUP_PATHS:
        msg = ("Change your password before continuing." if need == "password_change_required"
               else "Set up two-factor sign-in before continuing.")
        raise HTTPException(status.HTTP_403_FORBIDDEN, msg, headers={"X-Account-Action": need})
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


async def admins_with_default_password(db: AsyncDatabase) -> list[str]:
    found = []
    async for u in db.users.find({"role": "admin"}, {"username": 1, "password_hash": 1}):
        if any(verify_password(p, u["password_hash"]) for p in DEFAULT_PASSWORDS):
            found.append(u["username"])
    return found
