// ============================================================
// Extension message types — aligned with message-protocol.md
// ============================================================

export type Platform = 'facebook' | 'zalo'
export type MatchType = 'auto' | 'suggest' | 'new'
export type ReplyType = 'auto' | 'suggested' | 'manual'

// --- Incoming message detected by content script ---

export interface ChatMessage {
  id: string
  content: string
  senderName: string
  isCustomer: boolean
  timestamp: number
  platform: Platform
  conversationId: string
}

// --- Backend API request types ---

export interface MatchRequest {
  question: string
  platform: Platform
  conversation_id: string
  sender_name?: string
}

export interface MatchResponse {
  success: boolean
  data?: MatchResult
  error?: string
}

// --- Backend API response types ---

/** Q&A suggestion from database */
export interface QASuggestion {
  source: 'database'
  qa_id: number
  question: string
  answer: string
  similarity: number
}

/** AI-generated suggestion from Ollama */
export interface AISuggestion {
  answer: string
  model: string
  generation_time_ms?: number
}

/** Response from POST /api/match */
export interface MatchResult {
  match_type: MatchType
  message_id: number
  suggestions: QASuggestion[]
  ai_suggestion: AISuggestion | null
  _upgradeNudge?: boolean
  _freeTier?: boolean
  _greetingReply?: string
  _senderName?: string
  auto_mode?: string
}

/** Request body for POST /api/send */
export interface SendPayload {
  message_id: number
  reply_text: string
  reply_type: ReplyType
  qa_id: number | null
  original_question: string
  platform: Platform
  conversation_id: string
}

/** Response from POST /api/send */
export interface SendResult {
  message_id: number
  reply_type: ReplyType
  new_qa_created: boolean
  qa_id: number
}

/** Response from GET /health */
export interface HealthResult {
  status: 'ok'
  version: string
  database: 'connected' | 'disconnected'
  ollama: 'connected' | 'disconnected'
  qa_count: number
  uptime_seconds?: number
}

/** Response from GET /api/settings */
export interface ShopSettings {
  auto_reply_threshold: number
  suggest_threshold: number
  tone: 'friendly' | 'professional' | 'casual' | 'custom'
  custom_tone_prompt?: string
  enabled_platforms: Platform[]
  ollama_model?: string
  ollama_fallback_models?: string[]
  ollama_url?: string
  auto_reply_enabled: boolean
  notification_enabled?: boolean
  reply_delay_ms: number
}

/** Response from POST /api/llm/suggest */
export interface LLMSuggestResult {
  answer: string
  model: string
  generation_time_ms?: number
}

/** Response from GET /api/stats */
export interface StatsResult {
  period: string
  total_qa_pairs: number
  active_qa_pairs: number
  total_messages_received: number
  auto_replies_sent: number
  suggested_replies_sent: number
  manual_replies_sent: number
  auto_reply_rate: number
  auto_reply_accuracy: number
  top_questions: Array<{ question: string; count: number }>
  platform_breakdown: Record<string, { messages: number; auto_replies: number }>
}

/** Single auto-reply log entry */
export interface LogEntry {
  id: number
  customer_question: string
  auto_answer: string
  similarity_score: number
  qa_pair_id: number
  platform: Platform
  conversation_id: string
  sender_name: string
  sent_at: string
  user_reviewed: boolean
  user_feedback: 'ok' | 'wrong' | 'edited' | null
}

/** Response from GET /api/log */
export interface LogResult {
  items: LogEntry[]
  total: number
  page: number
  per_page: number
  total_pages: number
  summary: {
    total_auto_replies: number
    reviewed: number
    ok: number
    wrong: number
    edited: number
    unreviewed: number
  }
}

/** Paginated Q&A response */
export interface QAListResult {
  items: import('@/types/qa').QAPair[]
  total: number
  page: number
  per_page: number
  total_pages: number
}

/** Import result */
export interface ImportResult {
  import_id: number
  total_in_file: number
  added: number
  skipped_duplicate: number
  skipped_invalid: number
  errors: Array<{ row: number; error: string }>
}

// --- Content Script <-> Background message passing ---
// Uses chrome.runtime.sendMessage with these typed payloads

export type ExtensionMessageType =
  | 'MSG_MATCH'
  | 'MSG_SEND'
  | 'MSG_LLM_SUGGEST'
  | 'MSG_HEALTH'
  | 'MSG_HISTORY_SCAN'
  | 'MSG_GET_SETTINGS'
  | 'MSG_GET_STATS'
  | 'MSG_GET_QA'
  | 'MSG_ADD_QA'
  | 'MSG_UPDATE_QA'
  | 'MSG_DELETE_QA'
  | 'MSG_IMPORT_QA'
  | 'MSG_GET_LOG'
  | 'MSG_REVIEW_LOG'
  | 'MSG_UPDATE_SETTINGS'

export interface ExtensionMessage {
  type: ExtensionMessageType
  payload: Record<string, unknown>
}

/** Standard response wrapper from background to content script */
export interface ExtensionResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

// --- Queued message (when backend is offline) ---

export interface QueuedMessage {
  question: string
  platform: Platform
  conversation_id: string
  sender_name: string
  timestamp: string
  queued_at: string
  skip_ai: boolean
}
