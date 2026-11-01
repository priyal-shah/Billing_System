"""Admin AI assistant endpoints. Everything here requires an admin."""
from typing import Any, Literal

import anthropic
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from pydantic import BaseModel

from ..db import get_db
from ..ratelimit import rate_limit
from ..security import require_admin
from ..services import ai_actions, ai_agent

router = APIRouter(prefix="/ai", tags=["ai"])

MAX_IMAGE_BYTES = 3_700_000  # stays under the API's 5 MB per-image limit once base64-encoded
IMAGE_SIGNATURES = {
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/webp": (b"RIFF",),
}


class ApproveIn(BaseModel):
    # Optional admin edits to the proposed values, applied (and re-validated) on approval.
    changes: dict[str, Any] | None = None


def ai_client(request: Request):
    client = getattr(request.app.state, "ai_client", None)
    if client is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "The AI assistant is not configured (set ANTHROPIC_API_KEY on the server).")
    return client


def sniff_image(data: bytes) -> str | None:
    for media_type, sigs in IMAGE_SIGNATURES.items():
        if any(data.startswith(s) for s in sigs):
            if media_type == "image/webp" and data[8:12] != b"WEBP":
                continue
            return media_type
    return None


async def actions_by_id(db, ids: list[str]) -> dict[str, dict]:
    if not ids:
        return {}
    return {a["action_id"]: ai_actions.action_out(a)
            async for a in db.ai_pending_actions.find({"action_id": {"$in": ids}})}


@router.get("/status")
async def ai_status(request: Request, _admin=Depends(require_admin)):
    enabled = getattr(request.app.state, "ai_client", None) is not None
    return {"enabled": enabled, "model": request.app.state.settings.ai_model if enabled else None}


@router.post("/chat", dependencies=[Depends(rate_limit("ai_chat", 30, 300))])
async def chat(
    request: Request,
    message: str = Form("", max_length=4000),
    source: Literal["text", "voice"] = Form("text"),
    conversation_id: str | None = Form(None),
    image: UploadFile | None = File(None),
    admin=Depends(require_admin),
    db=Depends(get_db),
):
    client = ai_client(request)
    img = None
    if image is not None and image.filename:
        data = await image.read(MAX_IMAGE_BYTES + 1)
        if len(data) > MAX_IMAGE_BYTES:
            raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "Photo is too large (max about 3.5 MB).")
        media_type = sniff_image(data)
        if media_type is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only JPEG, PNG or WebP photos are supported.")
        img = (data, media_type)
    if not message.strip() and img is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Type a message, speak, or attach a photo.")

    try:
        result = await ai_agent.chat(
            db, client, request.app.state.settings, admin["username"], conversation_id or None,
            message.strip(), "image" if img else source, img,
        )
    except anthropic.AuthenticationError:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "The server's Anthropic API key is invalid.")
    except anthropic.RateLimitError:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "The AI service is busy. Try again in a minute.")
    except anthropic.BadRequestError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"The AI service rejected the request: {e.message}")
    except (anthropic.APIStatusError, anthropic.APIConnectionError):
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Could not reach the AI service. Try again.")

    actions = await actions_by_id(db, result["action_ids"])
    return {"conversation_id": result["conversation_id"], "reply": result["reply"],
            "actions": [actions[i] for i in result["action_ids"] if i in actions]}


@router.get("/conversations/{conversation_id}")
async def get_conversation(conversation_id: str, admin=Depends(require_admin), db=Depends(get_db)):
    conv = await ai_agent.load_conversation(db, conversation_id, admin["username"])
    ids = [i for d in conv["display"] for i in d.get("action_ids", [])]
    for i in ids:  # refresh expiry before showing
        await ai_actions.get_owned_action(db, i, admin["username"])
    actions = await actions_by_id(db, ids)
    return {
        "conversation_id": conversation_id,
        "messages": [
            {"role": d["role"], "text": d["text"], "source": d.get("source"), "has_image": bool(d.get("image_id")),
             "actions": [actions[i] for i in d.get("action_ids", []) if i in actions]}
            for d in conv["display"]
        ],
    }


@router.get("/actions/{action_id}")
async def get_action(action_id: str, admin=Depends(require_admin), db=Depends(get_db)):
    return ai_actions.action_out(await ai_actions.get_owned_action(db, action_id, admin["username"]))


@router.post("/actions/{action_id}/approve")
async def approve(action_id: str, body: ApproveIn | None = None, admin=Depends(require_admin), db=Depends(get_db)):
    changes = body.changes if body else None
    return ai_actions.action_out(await ai_actions.approve_action(db, action_id, admin["username"], changes))


@router.post("/actions/{action_id}/reject")
async def reject(action_id: str, admin=Depends(require_admin), db=Depends(get_db)):
    return ai_actions.action_out(await ai_actions.reject_action(db, action_id, admin["username"]))
