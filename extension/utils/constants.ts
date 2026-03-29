// ============================================================
// Backend URL and API endpoints
// ============================================================

export const BACKEND_URL = 'http://localhost:3939'
export const EXTENSION_NAME = 'ShopReply'

export const API = {
  HEALTH: `${BACKEND_URL}/health`,
  MATCH: `${BACKEND_URL}/api/match`,
  SEND: `${BACKEND_URL}/api/send`,
  QA: `${BACKEND_URL}/api/qa`,
  QA_IMPORT: `${BACKEND_URL}/api/qa/import`,
  LLM_SUGGEST: `${BACKEND_URL}/api/llm/suggest`,
  LLM_MODELS: `${BACKEND_URL}/api/llm/models`,
  SETTINGS: `${BACKEND_URL}/api/settings`,
  STATS: `${BACKEND_URL}/api/stats`,
  LOG: `${BACKEND_URL}/api/log`,
  HISTORY_SCAN: `${BACKEND_URL}/api/history/scan`,
} as const

// Default thresholds
export const DEFAULT_AUTO_REPLY_THRESHOLD = 0.85
export const DEFAULT_SUGGEST_THRESHOLD = 0.50
export const DEFAULT_REPLY_DELAY_MS = 1000

// Health check interval (background alarm)
export const HEALTH_CHECK_INTERVAL_MINUTES = 1

// Match debounce to avoid hammering backend
export const MATCH_DEBOUNCE_MS = 200

// Max queued messages before auto-cleanup
export const MAX_QUEUED_MESSAGES = 100

// ============================================================
// Facebook DOM selectors — extracted for easy update when FB changes
// ============================================================
export const FB_SELECTORS = {
  /** Main content area containing the message thread */
  messageContainer: 'div[role="main"]',
  /** Individual message row — FB uses role="row" for each message */
  messageRow: 'div[role="row"]',
  /** Text content within a message (direction-aware spans) */
  messageText: 'div[dir="auto"]',
  /** Sender name shown above message groups */
  senderName: 'span[dir="auto"]',
  /** Compose box — contenteditable textbox for typing replies */
  composeBox: 'div[contenteditable="true"][role="textbox"]',
  /** Send button — sometimes aria-label varies, fallback to Enter key */
  sendButton: 'div[aria-label="Press Enter to send"]',
  /** Message groups — each group is from one sender */
  messageGroup: 'div[data-scope="messages_table"]',
} as const

// ============================================================
// Zalo DOM selectors — based on chat.zalo.me actual DOM (2026-03)
// ============================================================
export const ZALO_SELECTORS = {
  /** Use body as root observer — Zalo is SPA, chat views load dynamically */
  messageContainer: 'body',
  /** Individual message item row */
  messageBubble: '.chat-item',
  /** Text content — span.text inside data-component="message-text-content" */
  messageText: '[data-component="message-text-content"] span.text',
  /** Sender name — from header title (conversation partner name) */
  senderName: '.header-title',
  /** Compose box — contenteditable div in chat footer */
  composeBox: '#chatView div[contenteditable="true"]',
  /** Send button — fallback to Enter key */
  sendButton: 'button[class*="send"]',
  /** Own message marker — chat-item with class "me" */
  ownMessageClass: 'me',
  /** Received message data-id attribute */
  receivedMsgAttr: 'div_ReceivedMsg_Text',
  /** Sent message data-id attribute */
  sentMsgAttr: 'div_SentMsg_Text',
} as const
