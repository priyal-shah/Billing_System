"""Small in-memory, per-IP rate limiter for the public endpoints (login, sign-up, guest, orders).

State lives on the app instance and per worker process, so limits are approximate across
workers. That is enough to blunt password guessing and order spam on a single-server deployment.
"""
import time

from fastapi import HTTPException, Request, status


def rate_limit(name: str, limit: int, window_seconds: int):
    async def dependency(request: Request) -> None:
        if not request.app.state.settings.rate_limit_enabled:
            return
        buckets = request.app.state.rate_buckets  # defaultdict(deque), created in create_app
        client_ip = request.client.host if request.client else "unknown"
        hits = buckets[f"{name}:{client_ip}"]
        now = time.monotonic()
        while hits and now - hits[0] > window_seconds:
            hits.popleft()
        if len(hits) >= limit:
            retry = int(window_seconds - (now - hits[0])) + 1
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                f"Too many attempts. Please wait {retry} seconds and try again.",
                headers={"Retry-After": str(retry)},
            )
        hits.append(now)

    return dependency
