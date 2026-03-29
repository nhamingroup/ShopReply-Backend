from sqlalchemy import create_engine, Column, Integer, String, Float, Boolean, Text, DateTime, LargeBinary
from sqlalchemy.orm import declarative_base, sessionmaker, Session
from typing import Generator
import datetime
import os

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./shopreply.db")
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class QAPair(Base):
    __tablename__ = "qa_pairs"
    id = Column(Integer, primary_key=True, index=True)
    question = Column(Text, nullable=False)
    answer = Column(Text, nullable=False)
    source = Column(String(50), default="imported")  # imported, history_scan, user_replied, ai_approved
    times_auto_sent = Column(Integer, default=0)
    times_approved = Column(Integer, default=0)   # user confirmed this answer
    times_rejected = Column(Integer, default=0)    # user rejected/edited this answer
    is_active = Column(Boolean, default=True)
    embedding = Column(LargeBinary, nullable=True)  # numpy bytes
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class Message(Base):
    __tablename__ = "messages"
    id = Column(Integer, primary_key=True, index=True)
    platform = Column(String(20), nullable=False)
    conversation_id = Column(String(255))
    direction = Column(String(10), nullable=False)  # inbound, outbound
    sender_name = Column(String(255))
    content = Column(Text, nullable=False)
    reply_type = Column(String(20))  # auto, suggested, manual
    matched_qa_id = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class AutoReplyLog(Base):
    __tablename__ = "auto_reply_log"
    id = Column(Integer, primary_key=True, index=True)
    message_id = Column(Integer, nullable=True)
    qa_pair_id = Column(Integer, nullable=True)
    customer_question = Column(Text, nullable=False)
    auto_answer = Column(Text, nullable=False)
    similarity_score = Column(Float, nullable=False)
    platform = Column(String(20), default="facebook")
    conversation_id = Column(String(255), nullable=True)
    sender_name = Column(String(255), nullable=True)
    sent_at = Column(DateTime, default=datetime.datetime.utcnow)
    user_reviewed = Column(Boolean, default=False)
    user_feedback = Column(String(20), nullable=True)  # ok, wrong, edited


class ImportHistory(Base):
    __tablename__ = "import_history"
    id = Column(Integer, primary_key=True, index=True)
    type = Column(String(50), nullable=False)  # file_import, history_scan
    filename = Column(String(255), nullable=True)
    platform = Column(String(20), nullable=True)
    format = Column(String(20), nullable=True)  # csv, xlsx, json
    total_pairs = Column(Integer, default=0)
    approved_pairs = Column(Integer, default=0)
    imported_at = Column(DateTime, default=datetime.datetime.utcnow)


class ShopSettings(Base):
    __tablename__ = "shop_settings"
    id = Column(Integer, primary_key=True, index=True)
    auto_reply_threshold = Column(Float, default=0.80)
    suggest_threshold = Column(Float, default=0.50)
    tone = Column(String(50), default="friendly")
    custom_tone_prompt = Column(Text, default="")
    enabled_platforms = Column(String(255), default="facebook")  # comma-separated
    ollama_model = Column(String(100), default="gemma3:4b")
    ollama_fallback_models = Column(String(500), default="")  # comma-separated fallback model list
    ollama_url = Column(String(255), default="http://localhost:11434")
    auto_reply_enabled = Column(Boolean, default=True)
    notification_enabled = Column(Boolean, default=True)
    reply_delay_ms = Column(Integer, default=1000)
    # Auto-reply mode: "manual" (always confirm), "semi" (auto DB + confirm AI), "full" (auto all)
    auto_reply_mode = Column(String(20), default="semi")
    # Minimum approval count before a Q&A pair can be auto-promoted (score boost)
    min_approvals_for_boost = Column(Integer, default=3)
    # Structured shop profile (JSON) — richer context for AI cold start
    shop_profile_json = Column(Text, default="")


def _migrate_columns(engine_ref):
    """Add missing columns to existing tables (SQLite doesn't auto-add on create_all)."""
    from sqlalchemy import inspect, text
    inspector = inspect(engine_ref)

    # --- shop_settings migrations ---
    ss_cols = {col["name"] for col in inspector.get_columns("shop_settings")}
    with engine_ref.connect() as conn:
        if "ollama_fallback_models" not in ss_cols:
            conn.execute(text("ALTER TABLE shop_settings ADD COLUMN ollama_fallback_models VARCHAR(500) DEFAULT ''"))
        if "auto_reply_mode" not in ss_cols:
            conn.execute(text("ALTER TABLE shop_settings ADD COLUMN auto_reply_mode VARCHAR(20) DEFAULT 'semi'"))
        if "min_approvals_for_boost" not in ss_cols:
            conn.execute(text("ALTER TABLE shop_settings ADD COLUMN min_approvals_for_boost INTEGER DEFAULT 3"))
        if "shop_profile_json" not in ss_cols:
            conn.execute(text("ALTER TABLE shop_settings ADD COLUMN shop_profile_json TEXT DEFAULT ''"))
        conn.commit()

    # --- qa_pairs migrations ---
    qa_cols = {col["name"] for col in inspector.get_columns("qa_pairs")}
    with engine_ref.connect() as conn:
        if "times_approved" not in qa_cols:
            conn.execute(text("ALTER TABLE qa_pairs ADD COLUMN times_approved INTEGER DEFAULT 0"))
        if "times_rejected" not in qa_cols:
            conn.execute(text("ALTER TABLE qa_pairs ADD COLUMN times_rejected INTEGER DEFAULT 0"))
        conn.commit()


def init_db():
    """Create all tables and ensure default settings exist."""
    Base.metadata.create_all(bind=engine)
    _migrate_columns(engine)
    db = SessionLocal()
    try:
        settings = db.query(ShopSettings).first()
        if not settings:
            settings = ShopSettings()
            db.add(settings)
            db.commit()
        else:
            # Migrate: update crashed qwen2.5:7b to gemma3:4b
            if settings.ollama_model == "qwen2.5:7b":
                settings.ollama_model = "gemma3:4b"
                db.commit()
    finally:
        db.close()


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency for database sessions."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
