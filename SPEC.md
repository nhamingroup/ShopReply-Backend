# ShopReply — Project Specification v1.0

> AI Auto-Reply chatbot for Vietnamese online shops (Facebook Messenger & Zalo).
> Local-first architecture: Chrome Extension + Python Backend, no cloud dependency.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Backend (Python FastAPI)](#2-backend-python-fastapi)
3. [Extension (WXT + React)](#3-extension-wxt--react)
4. [Data Flow](#4-data-flow)
5. [Database Schema](#5-database-schema)
6. [API Endpoints](#6-api-endpoints)
7. [AI/ML Pipeline](#7-aiml-pipeline)
8. [Feature Matrix & Tier System](#8-feature-matrix--tier-system)
9. [Settings & Configuration](#9-settings--configuration)
10. [File Structure](#10-file-structure)

---

## 1. Architecture Overview

```
┌─────────────────────────────┐     ┌──────────────────────────┐
│   Chrome Extension (WXT)    │     │   Python Backend (3939)  │
│                             │     │                          │
│  ┌────────────────────┐     │ HTTP│  ┌────────────────────┐  │
│  │ Content Scripts     │     │────→│  │ FastAPI (main.py)  │  │
│  │ (facebook/zalo)     │     │     │  └────────┬───────────┘  │
│  └────────┬───────────┘     │     │           │              │
│           │ browser.runtime │     │  ┌────────┴───────────┐  │
│  ┌────────┴───────────┐     │     │  │ SQLite + SQLAlchemy│  │
│  │ Background Script   │────│────→│  │ (database.py)      │  │
│  └────────────────────┘     │     │  └────────────────────┘  │
│                             │     │                          │
│  ┌────────────────────┐     │     │  ┌────────────────────┐  │
│  │ Popup / Options UI  │     │     │  │ Embeddings         │  │
│  │ (React pages)       │     │     │  │ (embeddings.py)    │  │
│  └────────────────────┘     │     │  └────────────────────┘  │
└─────────────────────────────┘     │                          │
                                    │  ┌────────────────────┐  │
                                    │  │ Ollama LLM Client  │  │
                                    │  │ (ollama_client.py)  │  │
                                    │  └────────┬───────────┘  │
                                    └───────────┼──────────────┘
                                                │
                                    ┌───────────┴──────────────┐
                                    │  Ollama (localhost:11434) │
                                    │  Model: gemma3:4b         │
                                    └──────────────────────────┘
```

**Key design decisions:**
- All processing runs locally — no data leaves the machine
- Backend on `localhost:3939`, Ollama on `localhost:11434`
- Extension communicates with backend only through background script
- SQLite database stores Q&A pairs, messages, logs, settings
- Sentence-transformers for semantic matching, Ollama for generative AI

---

## 2. Backend (Python FastAPI)

**Port:** 3939 | **DB:** SQLite (`shopreply.db`) | **Entry:** `run.py`

### Files

| File | Purpose |
|------|---------|
| `main.py` | FastAPI app — all API endpoints and business logic |
| `database.py` | SQLAlchemy ORM models, migrations, DB init |
| `schemas.py` | Pydantic request/response models |
| `embeddings.py` | Sentence-transformers embedding engine |
| `ollama_client.py` | Ollama LLM client with fallback models |
| `run.py` | Startup: init DB + uvicorn on port 3939 |
| `build_exe.py` | PyInstaller build script for Windows .exe |
| `install.py` | One-click dependency installer |
| `test_api.py` | API smoke tests |
| `tray_app.py` | Windows system tray wrapper |

### Core Business Logic (main.py)

**Match flow** (`POST /api/match`):
1. Record inbound message in DB
2. Fetch last 6 messages for conversation context
3. Generate embedding, find top-3 Q&A matches
4. Apply **score boost** if Q&A has high approval rate (≥3 approvals, >50% rate → up to +0.10)
5. Apply **rejection guard** — downgrade auto→suggest if rejection rate high
6. Determine `match_type`: auto (≥0.80), suggest (≥0.50), new (<0.50)
7. In `manual` mode: always downgrade auto→suggest
8. Generate AI suggestion via Ollama (unless `skip_ai=true`)
9. In `full` auto mode with shop info: promote AI answer to auto if ≥10 chars

**Send flow** (`POST /api/send`):
1. Record outbound message
2. Track approval (`times_approved++`) on confirmed replies
3. Near-duplicate check (>0.90 similarity) before creating new Q&A
4. Create new Q&A pair with embedding if truly new

**Review flow** (`POST /api/log/{id}/review`):
- `ok` → mark reviewed
- `wrong` → `times_rejected++`, decrease `times_auto_sent` by 5, auto-deactivate if rejection rate too high
- `edited` → update Q&A answer, track approval

---

## 3. Extension (WXT + React)

**Framework:** WXT 0.20 + React 19 + TypeScript + Tailwind CSS
**Manifest:** v3 | **Permissions:** storage, tabs, notifications, alarms

### Entrypoints

| Entrypoint | File | Purpose |
|------------|------|---------|
| Background | `entrypoints/background.ts` | Message router, health check, queue management, tier enforcement |
| Facebook CS | `entrypoints/facebook.content.ts` | Content script for `facebook.com/messages/*` |
| Zalo CS | `entrypoints/zalo.content.ts` | Content script for `chat.zalo.me/*` |
| Shared Logic | `entrypoints/content/shared.ts` | Core: message detection, suggestion queue, reply injection |
| Panel | `entrypoints/content/panel.tsx` | Shadow DOM suggestion panel UI |
| Popup | `entrypoints/popup/App.tsx` | Extension popup (onboarding + controls) |
| Options | `entrypoints/options/App.tsx` | Full dashboard (Q&A, logs, settings, import, about) |

### Background Script — Message Handlers

| Message Type | Backend Route | Purpose |
|-------------|---------------|---------|
| `MSG_MATCH` | POST `/api/match` | Question matching |
| `MSG_SEND` | POST `/api/send` | Record sent reply |
| `MSG_LLM_SUGGEST` | POST `/api/llm/suggest` | AI suggestion |
| `MSG_HEALTH` | GET `/health` | Health check |
| `MSG_GET_QA` | GET `/api/qa` | List Q&A pairs |
| `MSG_ADD_QA` | POST `/api/qa` | Create Q&A |
| `MSG_UPDATE_QA` | PUT `/api/qa/{id}` | Update Q&A |
| `MSG_DELETE_QA` | DELETE `/api/qa/{id}` | Delete Q&A |
| `MSG_IMPORT_QA` | POST `/api/qa/import` | Bulk import |
| `MSG_GET_SETTINGS` | GET `/api/settings` | Read settings |
| `MSG_UPDATE_SETTINGS` | PUT `/api/settings` | Update settings |
| `MSG_GET_STATS` | GET `/api/stats` | Statistics |
| `MSG_GET_LOG` | GET `/api/log` | Auto-reply logs |
| `MSG_REVIEW_LOG` | POST `/api/log/{id}/review` | Review feedback |
| `MSG_HISTORY_SCAN` | POST `/api/history/scan` | Extract Q&A from chat |
| `MSG_OPEN_OPTIONS` | — | Open options page |
| `MSG_BACKEND_REQUEST` | (dynamic) | Generic backend API call |

### Content Script — Key Mechanisms

**Message Detection:**
- MutationObserver on document root watches for new DOM nodes
- Platform-specific selectors extract message text, sender name, conversation ID
- Deduplication via hash (text + conversationId), 60-second window, max 500 entries
- Group chats detected and skipped

**Suggestion Queue:**
- `QueuedSuggestion[]` array holds pending suggestions for multiple conversations
- Navigation: `← 1/3 →` buttons to cycle through queue
- Conversation status: green dot = active conversation, yellow = mismatch (blocks send)
- Auto-dismiss after 30 seconds
- `handlePanelSelectionFromQueue()` removes current item, shows next

**Reply Injection:**
- `typeIntoCompose()` uses `execCommand('insertText')` for React-compatible DOM insertion
- `pressEnterToSend()` simulates Enter keypress
- `recentlySentReplies` Set prevents self-echo detection (5-second TTL)

**Auto History Scan:**
- `autoScanConversation()` extracts all visible messages → sends to `MSG_HISTORY_SCAN` → `MSG_IMPORT_QA`
- Triggered on page load (3s delay) and URL change (3s delay)
- `autoScannedConversations` Set tracks already-scanned conversations per session

**Platform-Specific Selectors:**

| | Facebook | Zalo |
|---|---------|------|
| Own message | flexbox `justify-content: flex-end` | `.chat-item.me` class |
| Message text | `div[dir="auto"]` | `[data-component="message-text-content"] span.text` |
| Sender name | `span[dir="auto"]` (walk up DOM) | `.header-title` |
| Compose box | `div[contenteditable="true"][role="textbox"]` | `#chatView div[contenteditable="true"]` |
| Conversation ID | URL `/messages/t/{ID}` | URL hash or DOM attribute |

### React Hooks

| Hook | Purpose |
|------|---------|
| `useBackend` | Backend connection state, health polling (30s), API wrappers |
| `useSettings` | Settings CRUD with backend sync, platform normalization |
| `useLicense` | Tier system (free/basic/pro), feature gating, key validation |
| `useI18n` | Vietnamese/English translations (280+ keys), Context provider |

### React Components

| Component | Purpose |
|-----------|---------|
| `StatusBadge` | Green/red connection indicator |
| `QATable` | Paginated, searchable Q&A table with edit/delete |
| `ImportModal` | File upload + text paste import with preview |

### Options Page Tabs

1. **Q&A Database** — CRUD table with search, pagination, add/edit/delete
2. **Auto-Reply Log** — Review history with ok/wrong/edited feedback
3. **Settings** — Auto-reply mode, thresholds, tone, platforms, delay, notifications
4. **Import & Train** — CSV/JSON upload, text paste, history scanning
5. **About** — License activation, pricing, donation, version info

---

## 4. Data Flow

### Auto-Reply (Happy Path)

```
Customer sends message on Facebook/Zalo
    ↓
Content Script detects new message (MutationObserver)
    ↓
Extract: question, senderName, conversationId
    ↓
Check: not own message, not group chat, not duplicate
    ↓
Send MSG_MATCH → Background → POST /api/match
    ↓
Backend: embed question → find top-3 matches → score boost → determine match_type
    ↓
Response: { match_type: "auto", suggestions: [...], ai_suggestion: {...} }
    ↓
Content Script: match_type="auto" → injectAndSendReply() → type + Enter
    ↓
Send MSG_SEND → Background → POST /api/send (record reply, track approval)
```

### Suggestion Flow (Semi-Auto)

```
... same detection ...
    ↓
Response: { match_type: "suggest", suggestions: [...], ai_suggestion: {...} }
    ↓
Content Script: add to suggestionQueue → showSuggestionPanel()
    ↓
User sees panel with DB match (left) + AI suggestion (right) + custom textarea
    ↓
User clicks one → handlePanelSelectionFromQueue() → injectAndSendReply()
    ↓
Queue item removed → next item shown (or panel closes)
```

### History Scan Flow

```
User navigates to conversation (or auto-triggered)
    ↓
autoScanConversation() → extractAllVisibleMessages()
    ↓
Send MSG_HISTORY_SCAN → Background → POST /api/history/scan
    ↓
Backend: pair customer→shop messages, optionally improve via LLM
    ↓
Response: { extracted_pairs: [...] }
    ↓
Send MSG_IMPORT_QA → Background → POST /api/qa/import
    ↓
New Q&A pairs added to database with embeddings
```

### Offline Queue

```
Backend unreachable → message queued in chrome.storage.local
    ↓
Health check alarm fires (every 1 min) → detects backend online
    ↓
processQueuedMessages() → retry all queued messages
```

---

## 5. Database Schema

### qa_pairs
| Column | Type | Default | Description |
|--------|------|---------|-------------|
| id | INTEGER PK | auto | |
| question | TEXT | required | Customer question |
| answer | TEXT | required | Shop answer |
| source | VARCHAR(50) | "imported" | imported, history_scan, user_replied, ai_approved, auto_generated |
| times_auto_sent | INTEGER | 0 | Auto-reply count |
| times_approved | INTEGER | 0 | User confirmations (boosts score) |
| times_rejected | INTEGER | 0 | User rejections |
| is_active | BOOLEAN | true | Soft-delete flag |
| embedding | BLOB | null | numpy float32 (384-dim) |
| created_at | DATETIME | now | |
| updated_at | DATETIME | now | |

### messages
| Column | Type | Default | Description |
|--------|------|---------|-------------|
| id | INTEGER PK | auto | |
| platform | VARCHAR(20) | required | facebook, zalo |
| conversation_id | VARCHAR(255) | | External conversation ID |
| direction | VARCHAR(10) | required | inbound, outbound |
| sender_name | VARCHAR(255) | | Customer or shop name |
| content | TEXT | required | Message text |
| reply_type | VARCHAR(20) | | auto, suggested, manual (outbound only) |
| matched_qa_id | INTEGER | null | Linked Q&A pair |
| created_at | DATETIME | now | |

### auto_reply_log
| Column | Type | Default | Description |
|--------|------|---------|-------------|
| id | INTEGER PK | auto | |
| message_id | INTEGER | | Inbound message ref |
| qa_pair_id | INTEGER | | Q&A pair used |
| customer_question | TEXT | required | |
| auto_answer | TEXT | required | |
| similarity_score | FLOAT | required | 0.0–1.0 |
| platform | VARCHAR(20) | "facebook" | |
| conversation_id | VARCHAR(255) | | |
| sender_name | VARCHAR(255) | | |
| sent_at | DATETIME | now | |
| user_reviewed | BOOLEAN | false | |
| user_feedback | VARCHAR(20) | null | ok, wrong, edited |

### import_history
| Column | Type | Default | Description |
|--------|------|---------|-------------|
| id | INTEGER PK | auto | |
| type | VARCHAR(50) | required | file_import, history_scan |
| filename | VARCHAR(255) | | |
| platform | VARCHAR(20) | | |
| format | VARCHAR(20) | | csv, xlsx, json |
| total_pairs | INTEGER | 0 | |
| approved_pairs | INTEGER | 0 | |
| imported_at | DATETIME | now | |

### shop_settings
| Column | Type | Default | Description |
|--------|------|---------|-------------|
| id | INTEGER PK | 1 | Single-row config |
| auto_reply_threshold | FLOAT | 0.80 | Score for auto-reply |
| suggest_threshold | FLOAT | 0.50 | Score for suggestion |
| tone | VARCHAR(50) | "friendly" | friendly, professional, casual |
| custom_tone_prompt | TEXT | "" | Free-text AI instructions |
| enabled_platforms | VARCHAR(255) | "facebook" | Comma-separated |
| ollama_model | VARCHAR(100) | "gemma3:4b" | Primary LLM model |
| ollama_fallback_models | VARCHAR(500) | "" | Comma-separated fallbacks |
| ollama_url | VARCHAR(255) | "http://localhost:11434" | |
| auto_reply_enabled | BOOLEAN | true | Master toggle |
| notification_enabled | BOOLEAN | true | |
| reply_delay_ms | INTEGER | 1000 | 500–5000ms |
| auto_reply_mode | VARCHAR(20) | "semi" | manual, semi, full |
| min_approvals_for_boost | INTEGER | 3 | Min feedback for score boost |
| shop_profile_json | TEXT | "" | Structured shop info (JSON) |

---

## 6. API Endpoints

### Health
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | System status (DB, Ollama, Q&A count, uptime) |

### Matching
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/match` | Match customer question → auto/suggest/new |
| POST | `/api/send` | Record sent reply, create Q&A if new |

### Q&A CRUD
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/qa` | List with pagination, search, filter |
| POST | `/api/qa` | Create single Q&A pair |
| PUT | `/api/qa/{id}` | Update question/answer/active |
| DELETE | `/api/qa/{id}` | Soft-delete (mark inactive) |
| POST | `/api/qa/import` | Bulk import with duplicate detection |

### History & Learning
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/history/scan` | Extract Q&A from conversation messages |
| POST | `/api/generate-sample-qa` | Generate sample Q&A from shop profile |

### LLM
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/llm/suggest` | Generate AI answer |
| GET | `/api/llm/models` | List available Ollama models |

### Settings
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/settings` | Read all settings |
| PUT | `/api/settings` | Update settings (partial) |

### Analytics
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/stats` | Statistics by period (today/week/month/all) |
| GET | `/api/log` | Auto-reply log with pagination |
| POST | `/api/log/{id}/review` | Submit feedback (ok/wrong/edited) |

---

## 7. AI/ML Pipeline

### Semantic Search (embeddings.py)

**Model:** `paraphrase-multilingual-MiniLM-L12-v2` (384-dim vectors)

- `get_embedding(text)` → normalized float32 vector
- `find_suggestions(question, db, top_k=3)` → top-k matches by cosine similarity
- Embeddings stored as binary BLOB in `qa_pairs.embedding`
- Lazy model loading on first call

**Score Boost Algorithm:**
```python
approval_rate = times_approved / (times_approved + times_rejected)  # >50%
volume_factor = min(1.0, times_approved / 10)                       # scales to 10
boosted_score = min(1.0, best_score + 0.10 * approval_rate * volume_factor)
```
Only applies when `times_approved >= min_approvals_for_boost` (default 3).

### Generative AI (ollama_client.py)

**Model:** gemma3:4b (default) | **Server:** localhost:11434

**Prompt Structure:**
```
SYSTEM: Vietnamese sales consultant prompt (tone-adjusted)
  + "=== THÔNG TIN SHOP ===" (if shop_info provided)

USER:
  "=== LỊCH SỬ HỘI THOẠI ===" (last N messages)
  "=== CÂU TRẢ LỜI MẪU TỪ DATABASE ===" (similar Q&A for style)
  "=== CÂU HỎI HIỆN TẠI ==="
  Khách: {question}
```

**Fallback:** Tries primary model → each fallback model in order.
**Caching:** Ollama availability cached 30 seconds to avoid blocking.

### Sample Q&A Generation (`/api/generate-sample-qa`)

Generates 10-15 common Q&A pairs from structured shop profile:
- Greeting, product inquiry, pricing, shipping, return policy, promotions, closing
- Parses FAQ field (H:/A: format)
- Only runs if DB has < 10 active pairs
- Duplicate check by exact question match

---

## 8. Feature Matrix & Tier System

| Feature | Free | Basic | Pro |
|---------|------|-------|-----|
| Q&A Searchable | First 30 by index | First 500 by index | Unlimited |
| Auto-Reply | No | No | Yes |
| AI Suggest | No | Yes | Yes |
| Multi-Platform | No | No | Yes |
| Custom Tone | No | No | Yes |
| Scan History | No | Yes | Yes |
| File Import | Yes | Yes | Yes |

**Q&A Index Limit**: Free/Basic tiers can accumulate unlimited Q&A data, but only the first N pairs (by creation order/ID) are searchable during matching. This ensures users need Pro for full database access.

**Auto-Reply**: Only Pro tier can auto-send replies. Free and Basic must always manually confirm every suggestion. This is enforced both in backend (`/api/match` downgrades `auto→suggest`) and extension (defense-in-depth).

**License Key Format:** `SHOP-TTTT-XXXX-CCCC`
- TTTT = tier (BSC1/PRO1)
- XXXX = random
- CCCC = checksum
- Expires 1 year after activation

**Enforcement:** Background script `checkQALimit()`, content script caches tier for 30s, UI disables locked features.

---

## 9. Settings & Configuration

### Extension Settings (chrome.storage.local)

```typescript
interface Settings {
  paused: boolean               // Master pause
  autoReplyEnabled: boolean     // Auto-reply toggle
  autoReplyThreshold: number    // 0.0–1.0 (default 0.80)
  suggestThreshold: number      // 0.0–1.0 (default 0.50)
  facebookEnabled: boolean      // Facebook platform toggle
  zaloEnabled: boolean          // Zalo platform toggle
  tone: 'friendly' | 'professional' | 'casual' | 'custom'
  customTonePrompt: string      // Free-text AI instructions
  replyDelayMs: number          // Delay before auto-reply (500–5000)
  backendUrl: string            // Default: http://localhost:3939
  notificationsEnabled: boolean
  autoReplyMode: 'manual' | 'semi' | 'full'
}
```

### Auto-Reply Modes

| Mode | DB Match (≥threshold) | AI Suggestion | Description |
|------|-----------------------|---------------|-------------|
| `manual` | Show suggestion | Show suggestion | Always need human confirm |
| `semi` | Auto-send (Pro only) | Show suggestion | Auto for DB matches, confirm AI |
| `full` | Auto-send (Pro only) | Auto-send (Pro only) | Fully automatic (requires shop info) |

**Note**: Auto-reply modes (`semi`, `full`) only take effect for Pro tier. Free and Basic always behave like `manual` regardless of setting.

### Shop Profile (structured JSON)

9 fields stored in `shop_settings.shop_profile_json`:
- **Required** (for progress): shopName, industry, products, priceRange, shipping
- **Optional**: returnPolicy, promotions, faq, extra

Profile completion shown as progress bar in Options page.
"Generate sample Q&A" button available when profile ≥ 60% complete.

---

## 10. File Structure

```
chatbotLocal/
├── backend/
│   ├── main.py                 # FastAPI app — all endpoints & business logic
│   ├── database.py             # SQLAlchemy models, migrations, DB init
│   ├── schemas.py              # Pydantic request/response models
│   ├── embeddings.py           # Sentence-transformers embedding engine
│   ├── ollama_client.py        # Ollama LLM client with fallback
│   ├── run.py                  # Startup script (init DB + uvicorn)
│   ├── build_exe.py            # PyInstaller build for Windows .exe
│   ├── install.py              # One-click dependency installer
│   ├── test_api.py             # API smoke tests
│   ├── tray_app.py             # Windows system tray wrapper
│   ├── requirements.txt        # Python dependencies
│   ├── .env.example            # Environment template
│   └── shopreply.db            # SQLite database
│
├── extension/
│   ├── entrypoints/
│   │   ├── background.ts       # Service worker — message router, health, queue
│   │   ├── facebook.content.ts # Facebook Messenger content script entry
│   │   ├── zalo.content.ts     # Zalo content script entry
│   │   ├── content/
│   │   │   ├── shared.ts       # Core: detection, matching, injection, queue
│   │   │   └── panel.tsx       # Shadow DOM suggestion panel
│   │   ├── popup/
│   │   │   ├── App.tsx         # Popup UI (onboarding + controls)
│   │   │   └── main.tsx        # React entry
│   │   └── options/
│   │       ├── App.tsx         # Full dashboard (5 tabs)
│   │       └── main.tsx        # React entry
│   │
│   ├── components/
│   │   ├── StatusBadge.tsx     # Connection status indicator
│   │   ├── QATable.tsx         # Paginated Q&A table
│   │   └── ImportModal.tsx     # Bulk import modal
│   │
│   ├── hooks/
│   │   ├── useBackend.ts       # Backend connection & API
│   │   ├── useSettings.ts      # Settings with backend sync
│   │   ├── useLicense.ts       # Tier system & feature gating
│   │   └── useI18n.tsx         # Vietnamese/English translations
│   │
│   ├── types/
│   │   ├── messages.ts         # Backend API types, ExtensionMessage
│   │   ├── qa.ts               # QAPair, QAImportPayload
│   │   └── storage.ts          # Settings, BackendStatus, StorageData
│   │
│   ├── utils/
│   │   ├── constants.ts        # URLs, thresholds, DOM selectors
│   │   ├── api.ts              # Backend fetch wrappers
│   │   └── storage.ts          # chrome.storage.local helpers
│   │
│   ├── wxt.config.ts           # WXT/Vite/Tailwind config
│   ├── package.json            # Node dependencies
│   └── tsconfig.json           # TypeScript config
│
├── assets/
│   ├── guide/                  # User guide HTML + screenshots
│   ├── pricing/                # Pricing page
│   ├── privacy/                # Privacy policy
│   ├── templates/              # CSV templates for Q&A import
│   └── sample-qa.csv           # Sample Q&A data
│
├── SPEC.md                     # This file — full project specification
└── README.md                   # Quick start guide
```

---

## Appendix: Key Constants

| Constant | Value | Location |
|----------|-------|----------|
| Backend URL | `http://localhost:3939` | extension/utils/constants.ts |
| Ollama URL | `http://localhost:11434` | backend/ollama_client.py |
| Default model | `gemma3:4b` | backend/ollama_client.py |
| Embedding model | `paraphrase-multilingual-MiniLM-L12-v2` | backend/embeddings.py |
| Embedding dim | 384 | backend/embeddings.py |
| Auto-reply threshold | 0.80 | both |
| Suggest threshold | 0.50 | both |
| Reply delay | 1000ms | both |
| Health check interval | 1 minute | extension/utils/constants.ts |
| Match debounce | 200ms | extension/utils/constants.ts |
| Max queued messages | 100 | extension/utils/constants.ts |
| Ollama cache TTL | 30 seconds | backend/ollama_client.py |
| Score boost max | +0.10 | backend/main.py |
| Near-duplicate threshold | 0.90 | backend/main.py |
| Dedup window | 60 seconds | extension/entrypoints/content/shared.ts |
| Max dedup entries | 500 | extension/entrypoints/content/shared.ts |
| Panel auto-dismiss | 30 seconds | extension/entrypoints/content/panel.tsx |
