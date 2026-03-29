"""Startup script for ShopReply Backend."""

import uvicorn
from database import init_db

BANNER = """
====================================================
          ShopReply Backend v1.0.0
----------------------------------------------------
  API:        http://127.0.0.1:3939
  Health:     http://127.0.0.1:3939/health
  Docs:       http://127.0.0.1:3939/docs
----------------------------------------------------
  Database:   SQLite (shopreply.db)
  Embedding:  paraphrase-multilingual-MiniLM-L12
  LLM:        Ollama (optional fallback)
====================================================
"""

if __name__ == "__main__":
    print(BANNER)
    print("Initializing database...")
    init_db()
    print("Database ready. Starting server...\n")

    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=3939,
        reload=True,
        log_level="info",
    )
