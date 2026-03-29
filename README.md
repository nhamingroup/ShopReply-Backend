# ShopReply — AI Auto-Reply for Facebook & Zalo

Chrome Extension + Local Backend. Auto-reply customer messages using local Q&A database + Ollama LLM.

## Quick Start

### Backend
```bash
cd backend
pip install -r requirements.txt
python run.py
```

### Extension
```bash
cd extension
npm install
npm run dev
```

## Architecture
- Extension: WXT + React + TypeScript (injects into FB/Zalo)
- Backend: Python FastAPI + SQLite + vector search (localhost:3000)
- LLM: Ollama (fallback for new questions)
