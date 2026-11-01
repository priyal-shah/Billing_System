import re

from fastapi import APIRouter, Depends, HTTPException, Query, status

from ..db import get_db, utcnow
from ..schemas import Page, ProductIn, ProductOut
from ..security import get_current_user, require_admin
from ..services.products import ACTIVE, insert_product, replace_product

router = APIRouter(tags=["products"])


def contains(text: str) -> dict:
    return {"$regex": re.escape(text.strip()), "$options": "i"}


@router.get("/products", response_model=Page[ProductOut])
async def list_products(
    q: str | None = Query(None, description="Matches name, category or description"),
    name: str | None = None,
    category: str | None = None,
    description: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    _user=Depends(get_current_user),
    db=Depends(get_db),
):
    filt: dict = dict(ACTIVE)
    if q and q.strip():
        rx = contains(q)
        filt["$or"] = [{"name": rx}, {"category": rx}, {"description": rx}, {"product_id": rx}]
    if name:
        filt["name"] = contains(name)
    if category:
        filt["category"] = contains(category)
    if description:
        filt["description"] = contains(description)

    total = await db.products.count_documents(filt)
    cursor = db.products.find(filt).sort([("category", 1), ("name", 1)]).skip((page - 1) * page_size).limit(page_size)
    return {"items": [p async for p in cursor], "total": total, "page": page, "page_size": page_size}


@router.get("/categories", response_model=list[str])
async def list_categories(_user=Depends(get_current_user), db=Depends(get_db)):
    return sorted(await db.products.distinct("category", ACTIVE))


@router.get("/products/{product_id}", response_model=ProductOut)
async def get_product(product_id: str, _user=Depends(get_current_user), db=Depends(get_db)):
    product = await db.products.find_one({"product_id": product_id, **ACTIVE})
    if not product:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Product not found")
    return product


@router.post("/products", response_model=ProductOut, status_code=status.HTTP_201_CREATED)
async def create_product(body: ProductIn, _admin=Depends(require_admin), db=Depends(get_db)):
    return await insert_product(db, body)


@router.put("/products/{product_id}", response_model=ProductOut)
async def update_product(product_id: str, body: ProductIn, _admin=Depends(require_admin), db=Depends(get_db)):
    product = await replace_product(db, product_id, body)
    if not product:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Product not found")
    return product


@router.delete("/products/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_product(product_id: str, _admin=Depends(require_admin), db=Depends(get_db)):
    # Soft delete: existing orders keep a valid reference to the product.
    now = utcnow()
    res = await db.products.update_one(
        {"product_id": product_id, **ACTIVE}, {"$set": {"is_deleted": True, "deleted_at": now, "updated_at": now}}
    )
    if res.matched_count == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Product not found")
