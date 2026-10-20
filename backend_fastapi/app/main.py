from collections import defaultdict, deque
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import Settings, get_settings
from .db import create_client, ensure_indexes
from .routers import auth, orders, products, settings as shop_settings
from .schemas import ShopSettings


def create_app(cfg: Settings | None = None) -> FastAPI:
    cfg = cfg or get_settings()
    if cfg.is_production:
        cfg.check_production_ready()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        client = create_client(cfg.mongo_uri)
        db = client[cfg.mongo_db]
        await ensure_indexes(db)
        await db.settings.update_one(
            {"_id": "shop"}, {"$setOnInsert": ShopSettings().model_dump(mode="python")}, upsert=True
        )
        app.state.db = db
        app.state.settings = cfg
        yield
        await client.close()

    # API docs stay available in development only; the public site doesn't advertise its API.
    docs = {} if not cfg.is_production else {"docs_url": None, "redoc_url": None, "openapi_url": None}
    app = FastAPI(title="Grocery Billing API", version="1.0.0", lifespan=lifespan, **docs)
    app.state.rate_buckets = defaultdict(deque)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cfg.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    for r in (auth.router, products.router, orders.router, shop_settings.router):
        app.include_router(r, prefix="/api")

    @app.get("/api/health", tags=["health"])
    async def health():
        return {"status": "ok"}

    return app


app = create_app()
