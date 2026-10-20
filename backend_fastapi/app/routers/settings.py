from fastapi import APIRouter, Depends, HTTPException, status

from ..bill_formats import BILL_FORMATS
from ..db import get_db, utcnow
from ..schemas import BillFormat, ShopSettings
from ..security import get_current_user, require_admin

router = APIRouter(tags=["settings"])


@router.get("/settings", response_model=ShopSettings)
async def get_settings(_user=Depends(get_current_user), db=Depends(get_db)):
    # Readable by every signed-in user: the cart needs currency and tax rules.
    return await db.settings.find_one({"_id": "shop"}) or ShopSettings()


@router.put("/settings", response_model=ShopSettings)
async def update_settings(body: ShopSettings, _admin=Depends(require_admin), db=Depends(get_db)):
    if body.default_bill_format not in BILL_FORMATS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown bill format")
    data = body.model_dump(mode="python")
    await db.settings.update_one({"_id": "shop"}, {"$set": {**data, "updated_at": utcnow()}}, upsert=True)
    return data


@router.get("/bill-formats", response_model=list[BillFormat])
async def list_bill_formats(_admin=Depends(require_admin)):
    return list(BILL_FORMATS.values())
