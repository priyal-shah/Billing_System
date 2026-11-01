"""Time-based one-time codes (RFC 6238, as used by Google Authenticator, Microsoft Authenticator, Authy)
and single-use recovery codes. Standard library only."""
import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote

DIGITS = 6
PERIOD = 30
ISSUER = "Grocery Billing"


def new_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def code_at(secret: str, step: int) -> str:
    key = base64.b32decode(secret + "=" * (-len(secret) % 8))
    digest = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    number = int.from_bytes(digest[offset:offset + 4], "big") & 0x7FFFFFFF
    return f"{number % 10 ** DIGITS:0{DIGITS}d}"


def current_step(now: float | None = None) -> int:
    return int((time.time() if now is None else now) // PERIOD)


def verify(secret: str, code: str, last_step: int = -1) -> int | None:
    """Return the matched time step, or None. Accepts one step of clock drift either way and
    rejects any step at or before last_step, so a code can't be replayed."""
    code = "".join(code.split())
    if len(code) != DIGITS or not code.isdigit():
        return None
    now = current_step()
    for step in (now - 1, now, now + 1):
        if step > last_step and hmac.compare_digest(code_at(secret, step), code):
            return step
    return None


def provisioning_uri(secret: str, account: str) -> str:
    label = quote(f"{ISSUER}:{account}")
    return f"otpauth://totp/{label}?secret={secret}&issuer={quote(ISSUER)}&digits={DIGITS}&period={PERIOD}"


def new_recovery_codes(n: int = 10) -> list[str]:
    return [f"{secrets.token_hex(3)}-{secrets.token_hex(3)}" for _ in range(n)]


def hash_recovery_code(code: str) -> str:
    return hashlib.sha256(code.strip().lower().replace(" ", "").encode()).hexdigest()
