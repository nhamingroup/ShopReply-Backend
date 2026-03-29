"""Semantic search engine using sentence-transformers."""

import numpy as np
from sqlalchemy.orm import Session
from database import QAPair

MODEL_NAME = "paraphrase-multilingual-MiniLM-L12-v2"

# Module-level cache — model loads lazily on first call
_model = None


def _get_model():
    """Load the sentence-transformer model lazily."""
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer
        _model = SentenceTransformer(MODEL_NAME)
    return _model


def get_embedding(text: str) -> list[float]:
    """Generate embedding vector for a text string."""
    model = _get_model()
    embedding = model.encode(text, normalize_embeddings=True)
    return embedding.tolist()


def embedding_to_bytes(embedding: list[float]) -> bytes:
    """Convert embedding list to numpy bytes for BLOB storage."""
    return np.array(embedding, dtype=np.float32).tobytes()


def bytes_to_embedding(data: bytes) -> np.ndarray:
    """Convert BLOB bytes back to numpy array."""
    return np.frombuffer(data, dtype=np.float32)


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Compute cosine similarity between two vectors."""
    dot = np.dot(a, b)
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(dot / (norm_a * norm_b))


def find_best_match(question: str, db: Session, max_qa: int = 0) -> tuple[QAPair | None, float]:
    """Find the closest Q&A pair to the given question.

    Args:
        max_qa: If > 0, only search the first N Q&A pairs by ID (tier limit).

    Returns (qa_pair, similarity_score) or (None, 0.0) if no match.
    """
    q_embedding = np.array(get_embedding(question), dtype=np.float32)

    query = db.query(QAPair).filter(
        QAPair.is_active == True,
        QAPair.embedding.isnot(None)
    ).order_by(QAPair.id.asc())
    if max_qa > 0:
        query = query.limit(max_qa)
    pairs = query.all()

    if not pairs:
        return None, 0.0

    best_pair = None
    best_score = 0.0

    for pair in pairs:
        pair_emb = bytes_to_embedding(pair.embedding)
        score = cosine_similarity(q_embedding, pair_emb)
        if score > best_score:
            best_score = score
            best_pair = pair

    return best_pair, best_score


def find_suggestions(question: str, db: Session, top_k: int = 3, max_qa: int = 0) -> list[tuple[QAPair, float]]:
    """Find top-k matching Q&A pairs for the given question.

    Args:
        max_qa: If > 0, only search the first N Q&A pairs by ID (tier limit).

    Returns list of (qa_pair, similarity_score) sorted by score descending.
    """
    q_embedding = np.array(get_embedding(question), dtype=np.float32)

    query = db.query(QAPair).filter(
        QAPair.is_active == True,
        QAPair.embedding.isnot(None)
    ).order_by(QAPair.id.asc())
    if max_qa > 0:
        query = query.limit(max_qa)
    pairs = query.all()

    if not pairs:
        return []

    scored = []
    for pair in pairs:
        pair_emb = bytes_to_embedding(pair.embedding)
        score = cosine_similarity(q_embedding, pair_emb)
        scored.append((pair, score))

    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:top_k]
