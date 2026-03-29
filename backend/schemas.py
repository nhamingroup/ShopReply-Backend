"""Pydantic models for request/response validation."""

from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


# ─── Common response wrapper ───

class ApiResponse(BaseModel):
    success: bool = True
    data: Optional[dict | list] = None
    error: Optional[str] = None


# ─── Match ───

class MatchRequest(BaseModel):
    model_config = {"extra": "ignore"}  # Explicitly ignore extra fields like 'timestamp'

    question: str
    platform: str = "facebook"
    conversation_id: str = ""
    sender_name: str = ""
    skip_ai: bool = False
    tier: str = "free"  # free, basic, pro — sent by extension for tier enforcement
    timestamp: str = ""  # Accept timestamp field explicitly to avoid any parsing issues


class QASuggestionItem(BaseModel):
    source: str = "database"
    qa_id: int
    question: str
    answer: str
    similarity: float


class AISuggestionItem(BaseModel):
    answer: str
    model: str
    generation_time_ms: Optional[int] = None


class MatchResponseData(BaseModel):
    match_type: str  # auto, suggest, new
    message_id: int
    suggestions: list[QASuggestionItem]
    ai_suggestion: Optional[AISuggestionItem] = None


# ─── Send ───

class SendRequest(BaseModel):
    message_id: int
    reply_text: str
    reply_type: str  # auto, suggested, manual
    qa_id: Optional[int] = None
    original_question: str
    platform: str = "facebook"
    conversation_id: str = ""


class SendResponseData(BaseModel):
    message_id: int
    reply_type: str
    new_qa_created: bool
    qa_id: Optional[int] = None


# ─── Q&A CRUD ───

class QACreateRequest(BaseModel):
    question: str
    answer: str
    source: str = "imported"


class QAUpdateRequest(BaseModel):
    question: Optional[str] = None
    answer: Optional[str] = None
    is_active: Optional[bool] = None


class QAItem(BaseModel):
    id: int
    question: str
    answer: str
    source: str
    times_auto_sent: int
    is_active: bool
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class QAListResponseData(BaseModel):
    items: list[QAItem]
    total: int
    page: int
    per_page: int
    total_pages: int


# ─── Import ───

class QAImportPair(BaseModel):
    question: str
    answer: str


class QAImportRequest(BaseModel):
    pairs: list[QAImportPair]
    source: str = "imported"


class ImportError(BaseModel):
    row: int
    error: str


class QAImportResponseData(BaseModel):
    import_id: int
    total_in_file: int
    added: int
    skipped_duplicate: int
    skipped_invalid: int
    errors: list[ImportError]


# ─── History Scan ───

class HistoryMessage(BaseModel):
    sender: str  # customer, shop
    name: Optional[str] = ""
    text: str
    timestamp: Optional[str] = None


class HistoryScanRequest(BaseModel):
    messages: list[HistoryMessage]
    platform: str = "facebook"
    conversation_id: str = ""


class ExtractedPair(BaseModel):
    question: str
    original_answer: str
    ai_improved_answer: Optional[str] = None
    confidence: float = 0.9


class HistoryScanResponseData(BaseModel):
    extracted_pairs: list[ExtractedPair]
    skipped_messages: int
    total_messages_analyzed: int


# ─── LLM Suggest ───

class LLMSuggestRequest(BaseModel):
    question: str
    context: Optional[dict] = None


class LLMSuggestResponseData(BaseModel):
    answer: str
    model: str
    generation_time_ms: int


# ─── Settings ───

class SettingsResponse(BaseModel):
    auto_reply_threshold: float
    suggest_threshold: float
    tone: str
    custom_tone_prompt: str
    enabled_platforms: list[str]
    ollama_model: str
    ollama_fallback_models: list[str]
    ollama_url: str
    auto_reply_enabled: bool
    notification_enabled: bool
    reply_delay_ms: int
    auto_reply_mode: str
    shop_profile_json: str


class SettingsUpdateRequest(BaseModel):
    auto_reply_threshold: Optional[float] = None
    suggest_threshold: Optional[float] = None
    tone: Optional[str] = None
    custom_tone_prompt: Optional[str] = None
    enabled_platforms: Optional[list[str]] = None
    ollama_model: Optional[str] = None
    ollama_fallback_models: Optional[list[str]] = None
    ollama_url: Optional[str] = None
    auto_reply_enabled: Optional[bool] = None
    notification_enabled: Optional[bool] = None
    reply_delay_ms: Optional[int] = None
    auto_reply_mode: Optional[str] = None  # manual, semi, full
    shop_profile_json: Optional[str] = None  # JSON string of structured shop profile


# ─── Stats ───

class TopQuestion(BaseModel):
    question: str
    count: int


class PlatformStats(BaseModel):
    messages: int
    auto_replies: int


class StatsResponseData(BaseModel):
    period: str
    total_qa_pairs: int
    active_qa_pairs: int
    total_messages_received: int
    auto_replies_sent: int
    suggested_replies_sent: int
    manual_replies_sent: int
    auto_reply_rate: float
    top_questions: list[TopQuestion]
    platform_breakdown: dict[str, PlatformStats]


# ─── Auto-reply Log ───

class LogItem(BaseModel):
    id: int
    customer_question: str
    auto_answer: str
    similarity_score: float
    qa_pair_id: Optional[int] = None
    platform: str
    conversation_id: Optional[str] = None
    sender_name: Optional[str] = None
    sent_at: Optional[datetime] = None
    user_reviewed: bool
    user_feedback: Optional[str] = None

    class Config:
        from_attributes = True


class LogSummary(BaseModel):
    total_auto_replies: int
    reviewed: int
    ok: int
    wrong: int
    edited: int
    unreviewed: int


class LogListResponseData(BaseModel):
    items: list[LogItem]
    total: int
    page: int
    per_page: int
    total_pages: int
    summary: LogSummary


class LogReviewRequest(BaseModel):
    feedback: str  # ok, wrong, edited
    corrected_answer: Optional[str] = None
