import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pymongo.errors import DuplicateKeyError

from ..db import get_db, utcnow
from ..ratelimit import rate_limit
from ..schemas import GuestIn, LoginIn, RegisterIn, TokenOut, UserOut
from ..security import create_access_token, get_current_user, guest_from_payload, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


def token_response(request: Request, user: dict) -> TokenOut:
    return TokenOut(
        access_token=create_access_token(request, user["username"], user["role"]),
        user=UserOut(**user),
    )


@router.post("/register", response_model=TokenOut, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(rate_limit("register", 5, 600))])
async def register(body: RegisterIn, request: Request, db=Depends(get_db)):
    user = {
        "username": body.username.lower(),
        "password_hash": hash_password(body.password),
        "role": "user",  # admins are created only by the seed script
        "full_name": body.full_name,
        "created_at": utcnow(),
    }
    try:
        await db.users.insert_one(user)
    except DuplicateKeyError:
        raise HTTPException(status.HTTP_409_CONFLICT, "Username already taken")
    return token_response(request, user)


@router.post("/login", response_model=TokenOut, dependencies=[Depends(rate_limit("login", 10, 300))])
async def login(body: LoginIn, request: Request, db=Depends(get_db)):
    user = await db.users.find_one({"username": body.username.strip().lower()})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid username or password")
    return token_response(request, user)


@router.post("/guest", response_model=TokenOut, dependencies=[Depends(rate_limit("guest", 20, 600))])
async def guest_session(body: GuestIn, request: Request):
    """Start a no-account session for QR/walk-in customers. Nothing is stored until they order."""
    guest_id = f"guest-{secrets.token_hex(6)}"
    token = create_access_token(request, guest_id, "guest", name=body.name)
    user = guest_from_payload({"sub": guest_id, "name": body.name, "iat": utcnow().timestamp()})
    return TokenOut(access_token=token, user=UserOut(**user))


@router.get("/me", response_model=UserOut)
async def me(user: dict = Depends(get_current_user)):
    return user
