// ============================================================
// Backend API client — wraps fetch calls to localhost:3000
// All calls go through background script (content scripts
// cannot fetch localhost due to CORS). This module is used
// by the background script and popup/options pages.
// ============================================================

import { API } from './constants'
import type {
  MatchResult,
  SendPayload,
  SendResult,
  HealthResult,
  LLMSuggestResult,
  ShopSettings,
  Platform,
} from '@/types/messages'

/** Default fetch timeout (5 seconds) */
const FETCH_TIMEOUT_MS = 5000

/**
 * Wrapper around fetch with timeout and error handling.
 * Returns parsed JSON or throws with a descriptive error.
 */
async function apiFetch<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}: ${text || res.statusText}`)
    }

    return (await res.json()) as T
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Backend request timed out')
    }
    if (err instanceof TypeError && err.message.includes('fetch')) {
      throw new Error('Backend not reachable')
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}

// ---- Public API functions ----

/** Check backend health status */
export async function checkHealth(): Promise<HealthResult> {
  return apiFetch<HealthResult>(API.HEALTH)
}

/** Match a customer question against the Q&A database */
export async function matchQuestion(payload: {
  question: string
  platform: Platform
  conversation_id: string
  sender_name: string
  timestamp?: string
}): Promise<MatchResult> {
  return apiFetch<MatchResult>(API.MATCH, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/** Record a sent reply (auto, suggested, or manual) */
export async function sendReply(payload: SendPayload): Promise<SendResult> {
  return apiFetch<SendResult>(API.SEND, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/** Request LLM to generate a suggested answer */
export async function llmSuggest(payload: {
  question: string
  context?: {
    similar_qa?: Array<{ question: string; answer: string }>
  }
}): Promise<LLMSuggestResult> {
  return apiFetch<LLMSuggestResult>(API.LLM_SUGGEST, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/** Get current shop settings from backend */
export async function getBackendSettings(): Promise<ShopSettings> {
  return apiFetch<ShopSettings>(API.SETTINGS)
}

/** Get stats (for popup/dashboard) */
export async function getStats(): Promise<Record<string, unknown>> {
  return apiFetch<Record<string, unknown>>(API.STATS)
}

/** Send chat history for scanning and Q&A extraction */
export async function scanHistory(payload: {
  messages: Array<{
    sender: 'customer' | 'shop'
    name: string
    text: string
    timestamp: string
  }>
  platform: Platform
  conversation_id: string
}): Promise<{
  extracted_pairs: Array<{
    question: string
    original_answer: string
    ai_improved_answer: string | null
    confidence: number
  }>
  skipped_messages: number
  total_messages_analyzed: number
}> {
  return apiFetch(API.HISTORY_SCAN, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
