import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from .. import totp
from ..db import get_db, utcnow
from ..ratelimit import rate_limit
from ..schemas import (
    ChangePasswordIn, CodeIn, DisableMfaIn, GuestIn, LoginIn, LoginOut, MfaSetupOut, RecoveryCodesOut, RegisterIn,
    SessionOut, TokenOut, UserOut,
)
from ..security import (
    DEFAULT_PASSWORDS, MFA_COOKIE, REFRESH_COOKIE, REFRESH_REUSE_GRACE, check_csrf, clear_session_cookies,
    create_guest_token, decode_token, get_current_user, guest_from_payload, hash_password, issue_session,
    require_registered, set_mfa_cookie, setup_requirement, sha256, unauthorized, verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])

# Short list of passwords people reach for first; the length rule catches most of the rest.
COMMON_PASSWORDS = {
    "password", "password1", "password12", "password123", "1234567890", "12345678910", "qwertyuiop",
    "admin12345", "administrator", "iloveyou12", "welcome123", "letmein123", "abcdefghij", "0987654321",
}


def user_out(request: Request, user: dict) -> UserOut:
    if user["role"] == "guest":
        return UserOut(**user)
    need = setup_requirement(user, request.app.state.settings)
    return UserOut(
        **{k: user.get(k) for k in ("username", "role", "full_name", "created_at")},
        mfa_enabled=bool(user.get("totp_enabled")),
        must_change_password=need == "password_change_required",
        mfa_setup_required=need == "mfa_setup_required",
    )


def password_problem(new: str, user: dict) -> str | None:
    lowered = new.lower()
    if lowered in COMMON_PASSWORDS or new in DEFAULT_PASSWORDS:
        return "That password is too common. Choose something harder to guess."
    if user["username"].lower() in lowered:
        return "The password must not contain your username."
    if len(set(new)) < 4:
        return "Use a mix of different characters."
    return None


async def revoke_all_sessions(db, username: str) -> dict:
    """Invalidate every access token (via token_version) and every refresh token of this user."""
    await db.refresh_tokens.delete_many({"username": username})
    return await db.users.find_one_and_update(
        {"username": username}, {"$inc": {"token_version": 1}}, return_document=ReturnDocument.AFTER
    )


# ---------- sign up / sign in ----------

@router.post("/register", response_model=SessionOut, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(rate_limit("register", 5, 600))])
async def register(body: RegisterIn, request: Request, response: Response, db=Depends(get_db)):
    user = {
        "username": body.username.lower(),
        "password_hash": hash_password(body.password),
        "role": "user",  # admins are created only by the seed / create_admin scripts
        "full_name": body.full_name,
        "token_version": 0,
        "created_at": utcnow(),
    }
    try:
        await db.users.insert_one(user)
    except DuplicateKeyError:
        raise HTTPException(status.HTTP_409_CONFLICT, "Username already taken")
    await issue_session(request, response, db, user)
    return {"user": user_out(request, user)}


@router.post("/login", response_model=LoginOut, dependencies=[Depends(rate_limit("login", 10, 300))])
async def login(body: LoginIn, request: Request, response: Response, db=Depends(get_db)):
    user = await db.users.find_one({"username": body.username.strip().lower()})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise unauthorized("Invalid username or password")
    if user.get("disabled"):
        raise unauthorized("This account has been disabled")
    if body.password in DEFAULT_PASSWORDS and not user.get("must_change_password"):
        # A published default password: make the owner pick a new one before anything else.
        user = await db.users.find_one_and_update(
            {"_id": user["_id"]}, {"$set": {"must_change_password": True}}, return_document=ReturnDocument.AFTER
        )
    if user.get("totp_enabled"):
        set_mfa_cookie(request, response, user)
        return {"mfa_required": True}
    await issue_session(request, response, db, user)
    return {"user": user_out(request, user)}


@router.post("/login/2fa", response_model=LoginOut, dependencies=[Depends(rate_limit("login_2fa", 10, 300))])
async def login_second_step(body: CodeIn, request: Request, response: Response, db=Depends(get_db)):
    cfg = request.app.state.settings
    pending = decode_token(cfg, request.cookies.get(MFA_COOKIE), "mfa")
    if pending is None:
        raise unauthorized("Sign-in expired. Enter your username and password again.")
    user = await db.users.find_one({"username": pending["sub"]})
    if (not user or user.get("disabled") or not user.get("totp_enabled")
            or user.get("token_version", 0) != pending.get("tv")):
        raise unauthorized("Sign-in expired. Enter your username and password again.")
    if not await use_second_factor(db, user, body.code):
        raise unauthorized("That code is not right. Check your authenticator app and try again.")
    response.delete_cookie(MFA_COOKIE, path="/api/auth")
    await issue_session(request, response, db, user)
    return {"user": user_out(request, user)}


async def use_second_factor(db, user: dict, code: str) -> bool:
    """Accept a current authenticator code (once) or an unused recovery code (once)."""
    step = totp.verify(user["totp_secret"], code, user.get("totp_last_step", -1))
    if step is not None:
        res = await db.users.update_one(
            {"_id": user["_id"], "$or": [{"totp_last_step": {"$lt": step}}, {"totp_last_step": {"$exists": False}}]},
            {"$set": {"totp_last_step": step}},
        )
        return res.modified_count == 1  # lost a race with the same code = replay
    res = await db.users.update_one(
        {"_id": user["_id"], "recovery_codes": totp.hash_recovery_code(code)},
        {"$pull": {"recovery_codes": totp.hash_recovery_code(code)}},
    )
    return res.modified_count == 1


@router.post("/guest", response_model=TokenOut, dependencies=[Depends(rate_limit("guest", 20, 600))])
async def guest_session(body: GuestIn, request: Request):
    """Start a no-account session for QR/walk-in customers. Nothing is stored until they order."""
    guest_id = f"guest-{secrets.token_hex(6)}"
    token = create_guest_token(request, guest_id, body.name)
    user = guest_from_payload({"sub": guest_id, "name": body.name, "iat": utcnow().timestamp()})
    return TokenOut(access_token=token, user=UserOut(**user))


@router.get("/me", response_model=UserOut)
async def me(request: Request, user: dict = Depends(get_current_user)):
    return user_out(request, user)


# ---------- session lifecycle ----------

@router.post("/refresh", response_model=SessionOut, dependencies=[Depends(rate_limit("refresh", 60, 300))])
async def refresh(request: Request, response: Response, db=Depends(get_db)):
    raw = request.cookies.get(REFRESH_COOKIE)
    if not raw:
        raise unauthorized()
    now = utcnow()
    token_hash = sha256(raw)
    found = await db.refresh_tokens.find_one({"token_hash": token_hash})
    if found:
        check_csrf(request, found["csrf"])  # before anything is changed, so a forged call can't burn the token
    doc = found and await db.refresh_tokens.find_one_and_update(
        {"token_hash": token_hash, "used_at": None, "expires_at": {"$gt": now}},
        {"$set": {"used_at": now}},
    )
    if not doc:
        old = await db.refresh_tokens.find_one({"token_hash": token_hash})
        if old and old.get("used_at") and now - old["used_at"] < REFRESH_REUSE_GRACE:
            # Another tab refreshed a moment ago; the browser already holds its new cookies.
            user = await db.users.find_one({"username": old["username"]})
            if user and not user.get("disabled") and user.get("token_version", 0) == old["tv"]:
                return {"user": user_out(request, user)}
        elif old and old.get("used_at"):
            # An old refresh token came back: assume it was stolen and end that whole login.
            await db.refresh_tokens.delete_many({"family": old["family"]})
        clear_session_cookies(request, response)
        raise unauthorized("Your session has ended. Please sign in again.")

    user = await db.users.find_one({"username": doc["username"]})
    if not user or user.get("disabled") or user.get("token_version", 0) != doc["tv"]:
        clear_session_cookies(request, response)
        raise unauthorized("Your session has ended. Please sign in again.")
    await issue_session(request, response, db, user, family=doc["family"], csrf=doc["csrf"])
    return {"user": user_out(request, user)}


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(request: Request, response: Response, db=Depends(get_db)):
    if raw := request.cookies.get(REFRESH_COOKIE):
        doc = await db.refresh_tokens.find_one({"token_hash": sha256(raw)})
        if doc:
            await db.refresh_tokens.delete_many({"family": doc["family"]})
    clear_session_cookies(request, response)


@router.post("/logout-all", status_code=status.HTTP_204_NO_CONTENT)
async def logout_everywhere(request: Request, response: Response, user=Depends(require_registered),
                            db=Depends(get_db)):
    """Sign this account out on every device, including this one."""
    await revoke_all_sessions(db, user["username"])
    clear_session_cookies(request, response)


@router.post("/change-password", response_model=SessionOut,
             dependencies=[Depends(rate_limit("change_password", 10, 600))])
async def change_password(body: ChangePasswordIn, request: Request, response: Response,
                          user=Depends(require_registered), db=Depends(get_db)):
    if not verify_password(body.current_password, user["password_hash"]):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is not correct")
    if body.new_password == body.current_password:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose a password different from the current one")
    if problem := password_problem(body.new_password, user):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, problem)
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {"password_hash": hash_password(body.new_password), "password_changed_at": utcnow()},
         "$unset": {"must_change_password": ""}},
    )
    # Other devices are signed out; this one gets a fresh session.
    user = await revoke_all_sessions(db, user["username"])
    await issue_session(request, response, db, user)
    return {"user": user_out(request, user)}


# ---------- two-factor sign-in ----------

@router.post("/2fa/setup", response_model=MfaSetupOut)
async def mfa_setup(user=Depends(require_registered), db=Depends(get_db)):
    """Start enrolling an authenticator app. Nothing changes until /2fa/enable confirms a code."""
    if user.get("totp_enabled"):
        raise HTTPException(status.HTTP_409_CONFLICT, "Two-factor sign-in is already on")
    secret = totp.new_secret()
    await db.users.update_one({"_id": user["_id"]}, {"$set": {"totp_pending_secret": secret}})
    return {"secret": secret, "otpauth_uri": totp.provisioning_uri(secret, user["username"])}


@router.post("/2fa/enable", response_model=RecoveryCodesOut,
             dependencies=[Depends(rate_limit("mfa_enable", 10, 300))])
async def mfa_enable(body: CodeIn, user=Depends(require_registered), db=Depends(get_db)):
    secret = user.get("totp_pending_secret")
    if not secret:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Start the setup first")
    step = totp.verify(secret, body.code)
    if step is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "That code is not right. Check the app and the time on your phone, then try again.")
    codes = totp.new_recovery_codes()
    await db.users.update_one({"_id": user["_id"]}, {
        "$set": {"totp_secret": secret, "totp_enabled": True, "totp_last_step": step,
                 "recovery_codes": [totp.hash_recovery_code(c) for c in codes], "totp_enabled_at": utcnow()},
        "$unset": {"totp_pending_secret": ""},
    })
    return {"recovery_codes": codes}


@router.post("/2fa/recovery-codes", response_model=RecoveryCodesOut,
             dependencies=[Depends(rate_limit("mfa_codes", 10, 300))])
async def mfa_new_recovery_codes(body: CodeIn, user=Depends(require_registered), db=Depends(get_db)):
    """Replace all recovery codes. Needs a current authenticator code."""
    if not user.get("totp_enabled"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Two-factor sign-in is off")
    step = totp.verify(user["totp_secret"], body.code, user.get("totp_last_step", -1))
    if step is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That code is not right")
    codes = totp.new_recovery_codes()
    await db.users.update_one({"_id": user["_id"]}, {
        "$set": {"recovery_codes": [totp.hash_recovery_code(c) for c in codes], "totp_last_step": step}})
    return {"recovery_codes": codes}


@router.post("/2fa/disable", status_code=status.HTTP_204_NO_CONTENT,
             dependencies=[Depends(rate_limit("mfa_disable", 10, 300))])
async def mfa_disable(body: DisableMfaIn, request: Request, user=Depends(require_registered), db=Depends(get_db)):
    if user["role"] == "admin" and request.app.state.settings.require_admin_2fa:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Two-factor sign-in is required for admin accounts")
    if not user.get("totp_enabled"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Two-factor sign-in is already off")
    if not verify_password(body.password, user["password_hash"]) or not await use_second_factor(db, user, body.code):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Password or code is not correct")
    await db.users.update_one({"_id": user["_id"]}, {"$unset": {
        "totp_secret": "", "totp_enabled": "", "totp_last_step": "", "recovery_codes": "", "totp_enabled_at": ""}})
