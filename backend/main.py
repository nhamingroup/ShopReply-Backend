"""ShopReply Backend — Full FastAPI application."""

import time
import math
import asyncio
import datetime
import logging
import traceback
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

logger = logging.getLogger("shopreply")
from sqlalchemy.orm import Session
from sqlalchemy import func, or_

from database import get_db, init_db, QAPair, Message, AutoReplyLog, ImportHistory, ShopSettings
from embeddings import get_embedding, embedding_to_bytes, find_best_match, find_suggestions
import ollama_client
from schemas import (
    MatchRequest, MatchResponseData, QASuggestionItem, AISuggestionItem,
    SendRequest, SendResponseData,
    QACreateRequest, QAUpdateRequest, QAItem, QAListResponseData,
    QAImportRequest, QAImportResponseData, ImportError as ImportErrorItem,
    HistoryScanRequest, HistoryScanResponseData, ExtractedPair,
    LLMSuggestRequest, LLMSuggestResponseData,
    SettingsResponse, SettingsUpdateRequest,
    StatsResponseData, TopQuestion, PlatformStats,
    LogItem, LogListResponseData, LogSummary, LogReviewRequest,
)

# ─── App startup ───

START_TIME = time.time()

app = FastAPI(title="ShopReply Backend", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    init_db()
    # Pre-load embedding model to avoid 20s+ cold start on first request
    try:
        from embeddings import get_embedding
        logger.info("[ShopReply] Warming up embedding model...")
        get_embedding("warmup")
        logger.info("[ShopReply] Embedding model ready")
    except Exception as e:
        logger.error(f"[ShopReply] Embedding warmup failed: {e}")


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Catch unhandled exceptions and return proper JSON instead of bare 500."""
    logger.error(f"Unhandled error on {request.method} {request.url.path}: {exc}\n{traceback.format_exc()}")
    return JSONResponse(
        status_code=500,
        content={"success": False, "error": f"Internal server error: {type(exc).__name__}: {exc}"},
    )


# ─── Helpers ───

def ok(data):
    """Wrap data in success response."""
    return {"success": True, "data": data}


def err(msg: str, status: int = 400):
    raise HTTPException(status_code=status, detail={"success": False, "error": msg})


def _settings_to_dict(s: ShopSettings) -> dict:
    platforms = [p.strip() for p in (s.enabled_platforms or "facebook").split(",") if p.strip()]
    return {
        "auto_reply_threshold": s.auto_reply_threshold,
        "suggest_threshold": s.suggest_threshold,
        "tone": s.tone or "friendly",
        "custom_tone_prompt": s.custom_tone_prompt or "",
        "enabled_platforms": platforms,
        "ollama_model": s.ollama_model or "gemma3:4b",
        "ollama_fallback_models": [m.strip() for m in (s.ollama_fallback_models or "").split(",") if m.strip()],
        "ollama_url": s.ollama_url or "http://localhost:11434",
        "auto_reply_enabled": s.auto_reply_enabled if s.auto_reply_enabled is not None else True,
        "notification_enabled": s.notification_enabled if s.notification_enabled is not None else True,
        "reply_delay_ms": s.reply_delay_ms or 1000,
        "auto_reply_mode": s.auto_reply_mode or "semi",
        "shop_profile_json": s.shop_profile_json or "",
    }


def _qa_to_dict(qa: QAPair) -> dict:
    return {
        "id": qa.id,
        "question": qa.question,
        "answer": qa.answer,
        "source": qa.source or "imported",
        "times_auto_sent": qa.times_auto_sent or 0,
        "is_active": qa.is_active if qa.is_active is not None else True,
        "created_at": qa.created_at.isoformat() if qa.created_at else None,
        "updated_at": qa.updated_at.isoformat() if qa.updated_at else None,
    }


def _log_to_dict(log: AutoReplyLog) -> dict:
    return {
        "id": log.id,
        "customer_question": log.customer_question,
        "auto_answer": log.auto_answer,
        "similarity_score": log.similarity_score,
        "qa_pair_id": log.qa_pair_id,
        "platform": log.platform or "facebook",
        "conversation_id": log.conversation_id,
        "sender_name": log.sender_name,
        "sent_at": log.sent_at.isoformat() if log.sent_at else None,
        "user_reviewed": log.user_reviewed or False,
        "user_feedback": log.user_feedback,
    }


# ─── 1. Health ───

@app.get("/health")
async def health(db: Session = Depends(get_db)):
    qa_count = db.query(func.count(QAPair.id)).filter(QAPair.is_active == True).scalar() or 0
    settings = db.query(ShopSettings).first()
    ollama_url = (settings.ollama_url if settings else None) or "http://localhost:11434"
    ollama_ok = await ollama_client.check_ollama_available(ollama_url)
    uptime = int(time.time() - START_TIME)

    return ok({
        "status": "ok",
        "version": "1.0.0",
        "database": "connected",
        "ollama": "connected" if ollama_ok else "disconnected",
        "embedding_model": "paraphrase-multilingual-MiniLM-L12-v2",
        "qa_count": qa_count,
        "uptime_seconds": uptime,
    })



# ─── 2. Match ───

@app.post("/api/match")
async def match_question(req: MatchRequest, db: Session = Depends(get_db)):
    settings = db.query(ShopSettings).first()
    auto_thresh = settings.auto_reply_threshold if settings else 0.80
    suggest_thresh = settings.suggest_threshold if settings else 0.50
    tone = settings.tone if settings else "friendly"
    shop_info = (settings.custom_tone_prompt if settings else None) or ""
    shop_profile_json = (settings.shop_profile_json if settings else None) or ""
    # Merge structured profile into shop_info for AI context
    if shop_profile_json:
        import json as _json
        try:
            profile = _json.loads(shop_profile_json)
            profile_parts = []
            if profile.get("shopName"):
                profile_parts.append(f"Tên shop: {profile['shopName']}")
            if profile.get("industry"):
                profile_parts.append(f"Ngành hàng: {profile['industry']}")
            if profile.get("products"):
                profile_parts.append(f"Sản phẩm chính: {profile['products']}")
            if profile.get("priceRange"):
                profile_parts.append(f"Giá: {profile['priceRange']}")
            if profile.get("shipping"):
                profile_parts.append(f"Giao hàng: {profile['shipping']}")
            if profile.get("returnPolicy"):
                profile_parts.append(f"Đổi trả: {profile['returnPolicy']}")
            if profile.get("promotions"):
                profile_parts.append(f"Khuyến mãi: {profile['promotions']}")
            if profile.get("faq"):
                profile_parts.append(f"FAQ thường gặp:\n{profile['faq']}")
            if profile.get("extra"):
                profile_parts.append(f"Thông tin thêm: {profile['extra']}")
            if profile_parts:
                structured_info = "\n".join(profile_parts)
                # Combine: structured profile takes priority, then free-form custom_tone_prompt
                shop_info = structured_info + ("\n\n" + shop_info if shop_info else "")
        except (_json.JSONDecodeError, TypeError):
            pass  # If JSON is invalid, fall back to custom_tone_prompt only
    ollama_model = (settings.ollama_model if settings else None) or "gemma3:4b"
    ollama_url = (settings.ollama_url if settings else None) or "http://localhost:11434"
    fallback_models = [m.strip() for m in (settings.ollama_fallback_models or "").split(",") if m.strip()] if settings else []
    auto_mode = (settings.auto_reply_mode if settings else None) or "semi"
    min_approvals = (settings.min_approvals_for_boost if settings else None) or 3

    # ── Tier enforcement: limit Q&A search scope ──
    tier = req.tier if req.tier in ("free", "basic", "pro") else "free"
    TIER_QA_LIMITS = {"free": 30, "basic": 500, "pro": 0}  # 0 = unlimited
    max_qa = TIER_QA_LIMITS.get(tier, 30)

    # Record inbound message (graceful — don't block matching if DB write fails)
    msg_id = 0
    try:
        msg = Message(
            platform=req.platform,
            conversation_id=req.conversation_id,
            direction="inbound",
            sender_name=req.sender_name,
            content=req.question,
        )
        db.add(msg)
        db.commit()
        db.refresh(msg)
        msg_id = msg.id
    except Exception as e:
        logger.error(f"[ShopReply] Failed to record inbound message: {e}")
        db.rollback()

    # ── Fetch recent conversation history for context ──
    conversation_history: list[dict] = []
    if req.conversation_id:
        try:
            recent_msgs = (
                db.query(Message)
                .filter(
                    Message.conversation_id == req.conversation_id,
                    Message.id != msg_id,  # exclude current message
                )
                .order_by(Message.created_at.desc())
                .limit(6)
                .all()
            )
            # Reverse to chronological order
            for m in reversed(recent_msgs):
                conversation_history.append({
                    "role": "customer" if m.direction == "inbound" else "shop",
                    "content": m.content,
                })
        except Exception as e:
            logger.error(f"[ShopReply] Failed to fetch conversation history: {e}")

    # ── Build context-enriched query for embedding search ──
    # If there's recent conversation, prepend context so follow-up questions
    # like "Có màu gì?" are understood as "Có màu gì [về dép]?"
    search_query = req.question
    if conversation_history:
        # Use last 2 messages as context prefix for better semantic search
        context_parts = []
        for h in conversation_history[-2:]:
            context_parts.append(h["content"])
        context_parts.append(req.question)
        search_query = " | ".join(context_parts)
        logger.info(f"[ShopReply] Context-enriched query: {search_query[:80]}")

    # Find matches (graceful — return "new" if embedding/search fails)
    suggestions_raw = []
    try:
        suggestions_raw = find_suggestions(search_query, db, top_k=3, max_qa=max_qa)
    except Exception as e:
        logger.error(f"[ShopReply] find_suggestions failed: {e}\n{traceback.format_exc()}")

    best_pair, best_score = (suggestions_raw[0] if suggestions_raw else (None, 0.0))

    # ── Score Boost: reward Q&A pairs with high approval history ──
    # If a Q&A pair has been confirmed by user multiple times without rejection,
    # boost its effective score — making it more likely to cross auto_thresh.
    boosted_score = best_score
    if best_pair:
        approved = best_pair.times_approved or 0
        rejected = best_pair.times_rejected or 0
        total_feedback = approved + rejected
        if total_feedback >= min_approvals and approved > rejected:
            # Approval rate: 0.0 → 1.0
            approval_rate = approved / total_feedback
            # Boost: up to +0.10 for perfect approval, scaled by feedback volume
            # Caps at +0.10 to prevent weak matches from being auto-promoted
            volume_factor = min(1.0, total_feedback / 10)  # ramp up over 10 feedbacks
            boost = 0.10 * approval_rate * volume_factor
            boosted_score = min(1.0, best_score + boost)
            if boost > 0.005:
                logger.info(
                    f"[ShopReply] Score boost: {best_score:.3f} → {boosted_score:.3f} "
                    f"(approved={approved}, rejected={rejected}, boost={boost:.3f})"
                )

    # Build suggestion items
    suggestion_items = []
    for pair, score in suggestions_raw:
        if score >= suggest_thresh:
            suggestion_items.append({
                "source": "database",
                "qa_id": pair.id,
                "question": pair.question,
                "answer": pair.answer,
                "similarity": round(score, 4),
            })

    # ── Determine match type ──
    # Use boosted score for auto threshold decision
    if best_pair and boosted_score >= auto_thresh:
        match_type = "auto"
        # Guard: don't auto-reply with very short/generic answers for follow-up questions
        if best_pair and len(best_pair.answer.strip()) < 20 and conversation_history:
            match_type = "suggest"
            logger.info(f"[ShopReply] Downgraded auto→suggest: answer too short ({len(best_pair.answer.strip())} chars) for follow-up")
        # Guard: downgrade if Q&A pair has high rejection rate
        if best_pair and (best_pair.times_rejected or 0) > (best_pair.times_approved or 0):
            match_type = "suggest"
            logger.info(f"[ShopReply] Downgraded auto→suggest: Q&A has more rejections than approvals")
    elif best_pair and best_score >= suggest_thresh:
        match_type = "suggest"
    else:
        match_type = "new"

    # ── Manual mode: always downgrade auto to suggest ──
    if auto_mode == "manual" and match_type == "auto":
        match_type = "suggest"
        logger.info(f"[ShopReply] Manual mode — downgraded auto→suggest")

    # ── Tier enforcement: only Pro can auto-reply ──
    if tier != "pro" and match_type == "auto":
        match_type = "suggest"
        logger.info(f"[ShopReply] Tier '{tier}' — downgraded auto→suggest (only Pro can auto-reply)")

    # Get AI suggestion for suggest/new (skip if free tier sent skip_ai=true)
    ai_suggestion = None
    _skip = bool(req.skip_ai)
    # In full-auto mode, also get AI for "auto" match to have backup
    need_ai = match_type in ("suggest", "new") or (auto_mode == "full" and match_type == "auto")
    logger.info(f"[ShopReply] match: skip_ai={req.skip_ai!r} (bool={_skip}), match_type={match_type}, mode={auto_mode}, q={req.question[:40]}")
    if need_ai and not _skip:
        try:
            # Build Q&A context from database matches
            qa_context = []
            for pair, score in suggestions_raw[:2]:
                qa_context.append({"question": pair.question, "answer": pair.answer})
            result = await ollama_client.suggest_answer(
                req.question,
                context=qa_context if qa_context else None,
                conversation_history=conversation_history if conversation_history else None,
                tone=tone,
                shop_info=shop_info if shop_info else None,
                model=ollama_model,
                ollama_url=ollama_url,
                fallback_models=fallback_models,
            )
            if result:
                ai_suggestion = {
                    "answer": result["answer"],
                    "model": result["model"],
                    "generation_time_ms": result.get("generation_time_ms"),
                }
        except Exception as e:
            logger.error(f"[ShopReply] AI suggestion failed: {e}")

    # ── Full-auto mode: promote AI suggestion to auto-reply (Pro only) ──
    # When no DB match is strong enough but AI generated an answer AND shop_info is set
    if tier == "pro" and auto_mode == "full" and match_type in ("suggest", "new") and ai_suggestion and shop_info:
        # AI can auto-reply when:
        # 1. Shop has provided context (shop_info is set)
        # 2. AI generated a non-empty answer
        # 3. Answer is substantial (>= 10 chars, not just a filler)
        ai_answer = ai_suggestion["answer"]
        if len(ai_answer) >= 10:
            match_type = "auto"
            # Inject AI answer as the primary suggestion so auto-reply uses it
            suggestion_items.insert(0, {
                "source": "ai",
                "qa_id": 0,
                "question": req.question,
                "answer": ai_answer,
                "similarity": 0.0,  # AI-generated, not DB match
            })
            logger.info(f"[ShopReply] Full-auto: AI answer promoted to auto-reply ({len(ai_answer)} chars)")

    return ok({
        "match_type": match_type,
        "message_id": msg_id,
        "suggestions": suggestion_items,
        "ai_suggestion": ai_suggestion,
        "auto_mode": auto_mode,
    })


# ─── 3. Send ───

@app.post("/api/send")
async def record_sent(req: SendRequest, db: Session = Depends(get_db)):
    # Record outbound message
    out_msg = Message(
        platform=req.platform,
        conversation_id=req.conversation_id,
        direction="outbound",
        sender_name="shop",
        content=req.reply_text,
        reply_type=req.reply_type,
        matched_qa_id=req.qa_id,
    )
    db.add(out_msg)
    db.commit()
    db.refresh(out_msg)

    new_qa_created = False
    qa_id = req.qa_id

    if req.reply_type == "auto" and req.qa_id:
        # Log auto-reply
        qa_pair = db.query(QAPair).filter(QAPair.id == req.qa_id).first()
        if qa_pair:
            qa_pair.times_auto_sent = (qa_pair.times_auto_sent or 0) + 1

            log_entry = AutoReplyLog(
                message_id=req.message_id,
                qa_pair_id=req.qa_id,
                customer_question=req.original_question,
                auto_answer=req.reply_text,
                similarity_score=1.0,  # Was auto-matched
                platform=req.platform,
                conversation_id=req.conversation_id,
            )
            db.add(log_entry)
            db.commit()

    elif req.reply_type in ("manual", "suggested"):
        # Create new Q&A pair if no qa_id (learning from user)
        if not req.qa_id:
            # Check for near-duplicate before creating new Q&A
            emb = get_embedding(req.original_question)
            emb_bytes = embedding_to_bytes(emb)

            # If a very similar Q&A already exists (>0.90), update it instead
            existing_match = find_best_match(req.original_question, db)
            if existing_match[0] and existing_match[1] > 0.90:
                existing_qa = existing_match[0]
                # Update existing pair's answer if AI suggestion was chosen
                # (user confirmed AI answer → this answer is better)
                if req.reply_type == "suggested":
                    existing_qa.answer = req.reply_text
                    existing_qa.times_approved = (existing_qa.times_approved or 0) + 1
                    existing_qa.updated_at = datetime.datetime.utcnow()
                    db.commit()
                    qa_id = existing_qa.id
                    logger.info(f"[ShopReply] Updated existing Q&A #{qa_id} with confirmed AI answer (sim={existing_match[1]:.3f})")
                else:
                    # Manual reply → create new pair (user intentionally wrote different answer)
                    new_qa = QAPair(
                        question=req.original_question,
                        answer=req.reply_text,
                        source="user_replied",
                        embedding=emb_bytes,
                        times_approved=1,  # User just confirmed this
                    )
                    db.add(new_qa)
                    db.commit()
                    db.refresh(new_qa)
                    new_qa_created = True
                    qa_id = new_qa.id
            else:
                source = "user_replied" if req.reply_type == "manual" else "ai_approved"
                new_qa = QAPair(
                    question=req.original_question,
                    answer=req.reply_text,
                    source=source,
                    embedding=emb_bytes,
                    times_approved=1,  # User just confirmed this
                )
                db.add(new_qa)
                db.commit()
                db.refresh(new_qa)
                new_qa_created = True
                qa_id = new_qa.id
        else:
            # User chose an existing DB suggestion — track approval
            qa_pair = db.query(QAPair).filter(QAPair.id == req.qa_id).first()
            if qa_pair:
                qa_pair.times_auto_sent = (qa_pair.times_auto_sent or 0) + 1
                qa_pair.times_approved = (qa_pair.times_approved or 0) + 1
                db.commit()
                logger.info(f"[ShopReply] Q&A #{qa_pair.id} approved (total={qa_pair.times_approved})")

    return ok({
        "message_id": req.message_id,
        "reply_type": req.reply_type,
        "new_qa_created": new_qa_created,
        "qa_id": qa_id,
    })


# ─── 4. Q&A CRUD ───

@app.get("/api/qa")
async def list_qa(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    search: str = Query(""),
    source: str = Query(""),
    is_active: Optional[bool] = Query(True),
    sort_by: str = Query("created_at"),
    sort_order: str = Query("desc"),
    db: Session = Depends(get_db),
):
    query = db.query(QAPair)

    # Filters
    if search:
        query = query.filter(
            or_(
                QAPair.question.contains(search),
                QAPair.answer.contains(search),
            )
        )
    if source:
        query = query.filter(QAPair.source == source)
    if is_active is not None:
        query = query.filter(QAPair.is_active == is_active)

    # Count total
    total = query.count()

    # Sort
    sort_col = getattr(QAPair, sort_by, QAPair.created_at)
    if sort_order == "asc":
        query = query.order_by(sort_col.asc())
    else:
        query = query.order_by(sort_col.desc())

    # Paginate
    offset = (page - 1) * per_page
    items = query.offset(offset).limit(per_page).all()
    total_pages = math.ceil(total / per_page) if per_page > 0 else 0

    return ok({
        "items": [_qa_to_dict(qa) for qa in items],
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": total_pages,
    })


@app.post("/api/qa", status_code=201)
async def create_qa(req: QACreateRequest, db: Session = Depends(get_db)):
    if not req.question.strip() or not req.answer.strip():
        err("Question and answer must not be empty")

    emb = get_embedding(req.question)
    emb_bytes = embedding_to_bytes(emb)

    qa = QAPair(
        question=req.question.strip(),
        answer=req.answer.strip(),
        source=req.source,
        embedding=emb_bytes,
    )
    db.add(qa)
    db.commit()
    db.refresh(qa)

    return ok(_qa_to_dict(qa))


@app.put("/api/qa/{qa_id}")
async def update_qa(qa_id: int, req: QAUpdateRequest, db: Session = Depends(get_db)):
    qa = db.query(QAPair).filter(QAPair.id == qa_id).first()
    if not qa:
        err("Q&A pair not found", 404)

    need_re_embed = False

    if req.question is not None:
        qa.question = req.question.strip()
        need_re_embed = True
    if req.answer is not None:
        qa.answer = req.answer.strip()
        need_re_embed = True
    if req.is_active is not None:
        qa.is_active = req.is_active

    if need_re_embed:
        emb = get_embedding(qa.question)
        qa.embedding = embedding_to_bytes(emb)

    qa.updated_at = datetime.datetime.utcnow()
    db.commit()
    db.refresh(qa)

    return ok(_qa_to_dict(qa))


@app.delete("/api/qa/{qa_id}")
async def delete_qa(qa_id: int, db: Session = Depends(get_db)):
    qa = db.query(QAPair).filter(QAPair.id == qa_id).first()
    if not qa:
        err("Q&A pair not found", 404)

    # Soft delete
    qa.is_active = False
    qa.updated_at = datetime.datetime.utcnow()
    db.commit()

    return ok({"id": qa_id, "deleted": True})


# ─── 5. Import ───

@app.post("/api/qa/import")
async def import_qa(req: QAImportRequest, db: Session = Depends(get_db)):
    added = 0
    skipped_dup = 0
    skipped_invalid = 0
    errors = []

    for i, pair in enumerate(req.pairs):
        q = pair.question.strip() if pair.question else ""
        a = pair.answer.strip() if pair.answer else ""

        if not q:
            skipped_invalid += 1
            errors.append({"row": i + 1, "error": "Empty question"})
            continue
        if not a:
            skipped_invalid += 1
            errors.append({"row": i + 1, "error": "Missing answer field"})
            continue

        # Check for near-duplicate (similarity > 0.90)
        emb = get_embedding(q)
        emb_bytes = embedding_to_bytes(emb)

        # Quick dup check against existing pairs
        import numpy as np
        from embeddings import bytes_to_embedding, cosine_similarity

        is_dup = False
        existing = db.query(QAPair).filter(QAPair.is_active == True, QAPair.embedding.isnot(None)).all()
        q_arr = np.array(emb, dtype=np.float32)
        for ex in existing:
            ex_emb = bytes_to_embedding(ex.embedding)
            if cosine_similarity(q_arr, ex_emb) > 0.90:
                is_dup = True
                break

        if is_dup:
            skipped_dup += 1
            continue

        new_qa = QAPair(
            question=q,
            answer=a,
            source=req.source,
            embedding=emb_bytes,
        )
        db.add(new_qa)
        added += 1

    db.commit()

    # Record import history
    hist = ImportHistory(
        type="file_import",
        format="json",
        total_pairs=len(req.pairs),
        approved_pairs=added,
    )
    db.add(hist)
    db.commit()
    db.refresh(hist)

    return ok({
        "import_id": hist.id,
        "total_in_file": len(req.pairs),
        "added": added,
        "skipped_duplicate": skipped_dup,
        "skipped_invalid": skipped_invalid,
        "errors": errors,
    })


# ─── 6. History Scan ───

@app.post("/api/history/scan")
async def scan_history(req: HistoryScanRequest, db: Session = Depends(get_db)):
    extracted = []
    skipped = 0
    total_analyzed = len(req.messages)

    # Simple heuristic: customer message followed by shop reply = Q&A pair
    i = 0
    while i < len(req.messages) - 1:
        current = req.messages[i]
        next_msg = req.messages[i + 1]

        if current.sender == "customer" and next_msg.sender == "shop":
            q = current.text.strip()
            a = next_msg.text.strip()

            # Skip very short or non-question messages
            if len(q) < 3 or len(a) < 3:
                skipped += 1
                i += 2
                continue

            # Try AI improvement (non-blocking, optional)
            ai_improved = None
            try:
                ai_improved = await ollama_client.improve_answer(q, a)
            except Exception:
                pass

            confidence = 0.90
            # Higher confidence for question-like messages
            if "?" in q or any(kw in q.lower() for kw in ["bao nhieu", "gia", "ship", "co ", "con ", "khi nao", "nhu the nao", "mau", "size"]):
                confidence = 0.95

            extracted.append({
                "question": q,
                "original_answer": a,
                "ai_improved_answer": ai_improved,
                "confidence": confidence,
            })

            i += 2
        else:
            skipped += 1
            i += 1

    return ok({
        "extracted_pairs": extracted,
        "skipped_messages": skipped,
        "total_messages_analyzed": total_analyzed,
    })


# ─── 7. LLM Suggest ───

@app.post("/api/llm/suggest")
async def llm_suggest(req: LLMSuggestRequest, db: Session = Depends(get_db)):
    settings = db.query(ShopSettings).first()
    tone = settings.tone if settings else "friendly"
    model = settings.ollama_model if settings else None
    url = settings.ollama_url if settings else None
    fallback_models = [m.strip() for m in (settings.ollama_fallback_models or "").split(",") if m.strip()] if settings else []

    # Build context from request
    context = None
    if req.context:
        similar_qa = req.context.get("similar_qa", [])
        if similar_qa:
            context = similar_qa
        req_tone = req.context.get("tone")
        if req_tone:
            tone = req_tone

    result = await ollama_client.suggest_answer(
        req.question,
        context=context,
        tone=tone,
        model=model,
        ollama_url=url,
        fallback_models=fallback_models,
    )

    if not result:
        raise HTTPException(
            status_code=503,
            detail={
                "success": False,
                "error": "Ollama is not running. Please start Ollama to use AI suggestions.",
            },
        )

    return ok({
        "answer": result["answer"],
        "model": result["model"],
        "generation_time_ms": result.get("generation_time_ms", 0),
    })


@app.get("/api/llm/models")
async def list_ollama_models(db: Session = Depends(get_db)):
    """List all models available in Ollama."""
    settings = db.query(ShopSettings).first()
    url = settings.ollama_url if settings else None
    models = await ollama_client.get_available_models(ollama_url=url)
    return ok({"models": models})


# ─── 8. Settings ───

@app.get("/api/settings")
async def get_settings(db: Session = Depends(get_db)):
    settings = db.query(ShopSettings).first()
    if not settings:
        settings = ShopSettings()
        db.add(settings)
        db.commit()
        db.refresh(settings)

    return ok(_settings_to_dict(settings))


@app.put("/api/settings")
async def update_settings(req: SettingsUpdateRequest, db: Session = Depends(get_db)):
    settings = db.query(ShopSettings).first()
    if not settings:
        settings = ShopSettings()
        db.add(settings)
        db.commit()
        db.refresh(settings)

    if req.auto_reply_threshold is not None:
        settings.auto_reply_threshold = max(0.0, min(1.0, req.auto_reply_threshold))
    if req.suggest_threshold is not None:
        settings.suggest_threshold = max(0.0, min(1.0, req.suggest_threshold))
    if req.tone is not None:
        settings.tone = req.tone
    if req.custom_tone_prompt is not None:
        settings.custom_tone_prompt = req.custom_tone_prompt
    if req.enabled_platforms is not None:
        settings.enabled_platforms = ",".join(req.enabled_platforms)
    if req.ollama_model is not None:
        settings.ollama_model = req.ollama_model
    if req.ollama_fallback_models is not None:
        settings.ollama_fallback_models = ",".join(req.ollama_fallback_models)
    if req.ollama_url is not None:
        settings.ollama_url = req.ollama_url
    if req.auto_reply_enabled is not None:
        settings.auto_reply_enabled = req.auto_reply_enabled
    if req.notification_enabled is not None:
        settings.notification_enabled = req.notification_enabled
    if req.reply_delay_ms is not None:
        settings.reply_delay_ms = max(500, min(5000, req.reply_delay_ms))
    if req.auto_reply_mode is not None and req.auto_reply_mode in ("manual", "semi", "full"):
        settings.auto_reply_mode = req.auto_reply_mode
    if req.shop_profile_json is not None:
        settings.shop_profile_json = req.shop_profile_json

    db.commit()
    db.refresh(settings)

    return ok(_settings_to_dict(settings))


# ─── 8b. Generate sample Q&A from shop profile ───

@app.post("/api/generate-sample-qa")
async def generate_sample_qa(db: Session = Depends(get_db)):
    """Generate common Q&A pairs based on shop profile.
    This bootstraps the Q&A database for new shops (cold start).
    Only generates if DB has < 10 Q&A pairs to avoid spamming."""
    import json as _json

    settings = db.query(ShopSettings).first()
    if not settings or not settings.shop_profile_json:
        return err("Shop profile chưa được điền. Hãy điền thông tin shop trước.", 400)

    # Only generate if DB is mostly empty
    existing_count = db.query(QAPair).filter(QAPair.is_active == True).count()
    if existing_count >= 10:
        return ok({"generated": 0, "message": f"Đã có {existing_count} Q&A, không cần tạo thêm."})

    try:
        profile = _json.loads(settings.shop_profile_json)
    except _json.JSONDecodeError:
        return err("Shop profile JSON không hợp lệ", 400)

    shop_name = profile.get("shopName", "Shop")
    industry = profile.get("industry", "")
    products = profile.get("products", "")
    price_range = profile.get("priceRange", "")
    shipping = profile.get("shipping", "")
    return_policy = profile.get("returnPolicy", "")
    promotions = profile.get("promotions", "")
    faq_text = profile.get("faq", "")

    # Build sample Q&A pairs from profile data
    samples: list[tuple[str, str]] = []

    # Always add greeting
    samples.append(("Chào shop", f"Dạ chào anh/chị! Em là {shop_name}, chuyên {industry}. Anh/chị cần tư vấn gì ạ?"))

    if products:
        samples.append(("Shop bán gì?", f"Dạ shop em chuyên {industry}. Các sản phẩm chính: {products} ạ."))
        samples.append(("Có những sản phẩm nào?", f"Dạ bên em có: {products}. Anh/chị quan tâm sản phẩm nào ạ?"))

    if price_range:
        samples.append(("Giá bao nhiêu?", f"Dạ giá bên em: {price_range}. Anh/chị muốn xem sản phẩm nào ạ?"))
        samples.append(("Có giảm giá không?", f"Dạ giá bên em: {price_range}." + (f" Hiện đang có KM: {promotions}" if promotions else " Anh/chị inbox để được tư vấn giá tốt nhất ạ.")))

    if shipping:
        samples.append(("Giao hàng như thế nào?", f"Dạ bên em giao hàng: {shipping} ạ."))
        samples.append(("Ship bao lâu nhận được?", f"Dạ bên em giao: {shipping}. Anh/chị cho em địa chỉ để em báo thời gian cụ thể ạ."))
        samples.append(("Có ship COD không?", f"Dạ {shipping} ạ."))

    if return_policy:
        samples.append(("Đổi trả được không?", f"Dạ được ạ. Chính sách đổi trả: {return_policy}."))

    if promotions:
        samples.append(("Có khuyến mãi gì không?", f"Dạ hiện tại bên em đang có: {promotions} ạ."))

    # Parse FAQ section (H: ... A: ... format)
    if faq_text:
        lines = faq_text.strip().split("\n")
        current_q, current_a = "", ""
        for line in lines:
            stripped = line.strip()
            if stripped.lower().startswith(("h:", "q:")):
                if current_q and current_a:
                    samples.append((current_q, current_a))
                current_q = stripped[2:].strip()
                current_a = ""
            elif stripped.lower().startswith("a:"):
                current_a = stripped[2:].strip()
        if current_q and current_a:
            samples.append((current_q, current_a))

    # Always add closing
    samples.append(("Cảm ơn", "Dạ không có gì ạ! Anh/chị cần gì thêm cứ nhắn em nhé."))
    samples.append(("Tạm biệt", f"Dạ cảm ơn anh/chị đã quan tâm đến {shop_name}! Hẹn gặp lại ạ."))

    # Insert into DB, skip duplicates
    created = 0
    for question, answer in samples:
        # Check duplicate by exact question match
        exists = db.query(QAPair).filter(
            QAPair.question == question,
            QAPair.is_active == True,
        ).first()
        if exists:
            continue

        emb = get_embedding(question)
        emb_bytes = embedding_to_bytes(emb)

        qa = QAPair(
            question=question,
            answer=answer,
            source="auto_generated",
            embedding=emb_bytes,
            times_approved=1,  # Pre-approved since user provided the info
        )
        db.add(qa)
        created += 1

    db.commit()
    logger.info(f"[ShopReply] Generated {created} sample Q&A pairs from shop profile")

    return ok({
        "generated": created,
        "total": existing_count + created,
        "message": f"Đã tạo {created} cặp Q&A mẫu từ thông tin shop.",
    })


# ─── 9. Stats ───

@app.get("/api/stats")
async def get_stats(
    period: str = Query("today"),
    db: Session = Depends(get_db),
):
    now = datetime.datetime.utcnow()

    # Determine date filter
    if period == "today":
        date_from = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == "week":
        date_from = now - datetime.timedelta(days=7)
    elif period == "month":
        date_from = now - datetime.timedelta(days=30)
    else:  # "all"
        date_from = datetime.datetime(2000, 1, 1)

    total_qa = db.query(func.count(QAPair.id)).scalar() or 0
    active_qa = db.query(func.count(QAPair.id)).filter(QAPair.is_active == True).scalar() or 0

    # Messages in period
    msg_query = db.query(Message).filter(Message.created_at >= date_from)
    total_msgs = msg_query.filter(Message.direction == "inbound").count()
    auto_replies = msg_query.filter(Message.direction == "outbound", Message.reply_type == "auto").count()
    suggested_replies = msg_query.filter(Message.direction == "outbound", Message.reply_type == "suggested").count()
    manual_replies = msg_query.filter(Message.direction == "outbound", Message.reply_type == "manual").count()

    total_out = auto_replies + suggested_replies + manual_replies
    auto_rate = round(auto_replies / total_out, 2) if total_out > 0 else 0.0

    # Top questions (most auto-sent QA pairs)
    top_qas = (
        db.query(QAPair)
        .filter(QAPair.is_active == True)
        .order_by(QAPair.times_auto_sent.desc())
        .limit(10)
        .all()
    )
    top_questions = [{"question": qa.question, "count": qa.times_auto_sent or 0} for qa in top_qas]

    # Platform breakdown
    platforms = {}
    for platform in ["facebook", "zalo"]:
        p_msgs = msg_query.filter(Message.platform == platform, Message.direction == "inbound").count()
        p_auto = msg_query.filter(Message.platform == platform, Message.direction == "outbound", Message.reply_type == "auto").count()
        if p_msgs > 0 or p_auto > 0:
            platforms[platform] = {"messages": p_msgs, "auto_replies": p_auto}

    return ok({
        "period": period,
        "total_qa_pairs": total_qa,
        "active_qa_pairs": active_qa,
        "total_messages_received": total_msgs,
        "auto_replies_sent": auto_replies,
        "suggested_replies_sent": suggested_replies,
        "manual_replies_sent": manual_replies,
        "auto_reply_rate": auto_rate,
        "top_questions": top_questions,
        "platform_breakdown": platforms,
    })


# ─── 10. Auto-reply Log ───

@app.get("/api/log")
async def list_logs(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    status: str = Query(""),
    platform: str = Query(""),
    date_from: str = Query(""),
    date_to: str = Query(""),
    db: Session = Depends(get_db),
):
    query = db.query(AutoReplyLog)

    # Filters
    if status == "reviewed":
        query = query.filter(AutoReplyLog.user_reviewed == True)
    elif status == "unreviewed":
        query = query.filter(AutoReplyLog.user_reviewed == False)
    elif status == "wrong":
        query = query.filter(AutoReplyLog.user_feedback == "wrong")

    if platform:
        query = query.filter(AutoReplyLog.platform == platform)

    if date_from:
        try:
            dt = datetime.datetime.fromisoformat(date_from.replace("Z", "+00:00"))
            query = query.filter(AutoReplyLog.sent_at >= dt)
        except ValueError:
            pass

    if date_to:
        try:
            dt = datetime.datetime.fromisoformat(date_to.replace("Z", "+00:00"))
            query = query.filter(AutoReplyLog.sent_at <= dt)
        except ValueError:
            pass

    total = query.count()
    offset = (page - 1) * per_page
    items = query.order_by(AutoReplyLog.sent_at.desc()).offset(offset).limit(per_page).all()
    total_pages = math.ceil(total / per_page) if per_page > 0 else 0

    # Summary
    all_logs = db.query(AutoReplyLog)
    total_auto = all_logs.count()
    reviewed_count = all_logs.filter(AutoReplyLog.user_reviewed == True).count()
    ok_count = all_logs.filter(AutoReplyLog.user_feedback == "ok").count()
    wrong_count = all_logs.filter(AutoReplyLog.user_feedback == "wrong").count()
    edited_count = all_logs.filter(AutoReplyLog.user_feedback == "edited").count()
    unreviewed_count = total_auto - reviewed_count

    return ok({
        "items": [_log_to_dict(log) for log in items],
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": total_pages,
        "summary": {
            "total_auto_replies": total_auto,
            "reviewed": reviewed_count,
            "ok": ok_count,
            "wrong": wrong_count,
            "edited": edited_count,
            "unreviewed": unreviewed_count,
        },
    })


@app.post("/api/log/{log_id}/review")
async def review_log(log_id: int, req: LogReviewRequest, db: Session = Depends(get_db)):
    log_entry = db.query(AutoReplyLog).filter(AutoReplyLog.id == log_id).first()
    if not log_entry:
        err("Log entry not found", 404)

    if req.feedback not in ("ok", "wrong", "edited"):
        err("Feedback must be 'ok', 'wrong', or 'edited'")

    log_entry.user_reviewed = True
    log_entry.user_feedback = req.feedback

    if req.feedback == "edited" and req.corrected_answer:
        # Update the Q&A pair's answer
        if log_entry.qa_pair_id:
            qa = db.query(QAPair).filter(QAPair.id == log_entry.qa_pair_id).first()
            if qa:
                qa.answer = req.corrected_answer
                emb = get_embedding(qa.question)
                qa.embedding = embedding_to_bytes(emb)
                qa.updated_at = datetime.datetime.utcnow()

    elif req.feedback == "wrong":
        # Mark Q&A pair for review — track rejection and decrease auto count
        if log_entry.qa_pair_id:
            qa = db.query(QAPair).filter(QAPair.id == log_entry.qa_pair_id).first()
            if qa:
                qa.times_rejected = (qa.times_rejected or 0) + 1
                if qa.times_auto_sent and qa.times_auto_sent > 0:
                    qa.times_auto_sent = max(0, qa.times_auto_sent - 5)
                # Auto-deactivate if rejection rate is too high
                total = (qa.times_approved or 0) + (qa.times_rejected or 0)
                if total >= 5 and (qa.times_rejected or 0) > (qa.times_approved or 0) * 2:
                    qa.is_active = False
                    logger.info(f"[ShopReply] Q&A #{qa.id} auto-deactivated: too many rejections ({qa.times_rejected}/{total})")

    db.commit()
    db.refresh(log_entry)

    return ok({
        "id": log_entry.id,
        "user_reviewed": log_entry.user_reviewed,
        "user_feedback": log_entry.user_feedback,
    })
