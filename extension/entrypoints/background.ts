// ============================================================
// Background Service Worker — message router + health check
//
// Content scripts CANNOT fetch localhost (CORS). All HTTP
// requests to the backend are proxied through this script.
// ============================================================

import { API, BACKEND_URL, HEALTH_CHECK_INTERVAL_MINUTES } from '@/utils/constants'
import type {
  ExtensionMessage,
  ExtensionResponse,
  HealthResult,
  QueuedMessage,
} from '@/types/messages'

const FETCH_TIMEOUT_MS = 30000
const STORAGE_KEY_STATUS = 'shopreply_backend_status'
const STORAGE_KEY_QUEUE = 'shopreply_pending_messages'

// ---- Fetch helper with timeout ----

async function backendFetch(
  url: string,
  options?: RequestInit,
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    })
  } finally {
    clearTimeout(timeoutId)
  }
}

async function backendJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await backendFetch(url, options)
  const text = await res.text()
  if (!res.ok) {
    // Try to extract error message from JSON response
    let errorMsg = `Backend error (HTTP ${res.status})`
    try {
      const errJson = JSON.parse(text)
      if (errJson?.error) errorMsg = errJson.error
      else if (errJson?.detail) errorMsg = typeof errJson.detail === 'string' ? errJson.detail : JSON.stringify(errJson.detail)
    } catch { /* use default error message */ }
    throw new Error(errorMsg)
  }
  try {
    const json = JSON.parse(text)
    // Backend wraps all responses in {success, data} — unwrap here
    // so message handler doesn't double-wrap
    if (json && typeof json === 'object' && 'success' in json && 'data' in json) {
      if (!json.success) {
        throw new Error(json.error || 'Backend returned an error')
      }
      return json.data as T
    }
    return json as T
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new Error('Backend returned invalid response')
    }
    throw e
  }
}

// ---- Tier enforcement helpers ----

const TIER_QA_LIMITS: Record<string, number> = { free: 30, basic: 500, pro: Infinity }

async function getCurrentTier(): Promise<string> {
  try {
    const stored = await browser.storage.local.get('shopreply_license')
    const license = stored.shopreply_license as { tier?: string } | undefined
    return license?.tier ?? 'free'
  } catch {
    return 'free'
  }
}

async function checkQALimit(incomingCount = 1): Promise<string | null> {
  const tier = await getCurrentTier()
  const limit = TIER_QA_LIMITS[tier] ?? 30
  if (limit === Infinity) return null
  try {
    const stats = await backendJson<Record<string, unknown>>(API.STATS)
    const count = (stats as { total_qa_pairs?: number }).total_qa_pairs ?? 0
    if (count >= limit) {
      return `Đã đạt giới hạn ${limit} cặp Q&A cho gói ${tier}. Nâng cấp để thêm. | LIMIT_REACHED`
    }
    if (incomingCount > 1 && count + incomingCount > limit) {
      const remaining = Math.max(0, limit - count)
      return `Gói ${tier} chỉ cho phép ${limit} cặp Q&A. Hiện có ${count}, chỉ còn chỗ cho ${remaining} cặp. Nâng cấp để thêm. | LIMIT_PARTIAL:${remaining}`
    }
  } catch {
    // Can't check — allow
  }
  return null
}

// ---- Message routing table ----
// Maps message type -> (payload) => Promise<data>

type HandlerFn = (payload: Record<string, unknown>) => Promise<unknown>

const MESSAGE_HANDLERS: Record<string, HandlerFn> = {
  MSG_MATCH: async (payload) => {
    return backendJson(API.MATCH, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  MSG_SEND: async (payload) => {
    return backendJson(API.SEND, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  MSG_LLM_SUGGEST: async (payload) => {
    return backendJson(API.LLM_SUGGEST, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  MSG_HEALTH: async () => {
    return backendJson(API.HEALTH)
  },

  MSG_HISTORY_SCAN: async (payload) => {
    return backendJson(API.HISTORY_SCAN, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  MSG_GET_SETTINGS: async () => {
    return backendJson(API.SETTINGS)
  },

  MSG_GET_STATS: async () => {
    return backendJson(API.STATS)
  },

  MSG_GET_QA: async (payload) => {
    const params = new URLSearchParams()
    if (payload.page) params.set('page', String(payload.page))
    if (payload.per_page) params.set('per_page', String(payload.per_page))
    if (payload.search) params.set('search', String(payload.search))
    params.set('is_active', 'true')
    const qs = params.toString()
    return backendJson(`${API.QA}${qs ? `?${qs}` : ''}`)
  },

  MSG_ADD_QA: async (payload) => {
    // Check QA limit for free tier
    const qaLimitError = await checkQALimit()
    if (qaLimitError) throw new Error(qaLimitError)
    return backendJson(API.QA, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  MSG_UPDATE_QA: async (payload) => {
    const { id, ...body } = payload
    return backendJson(`${API.QA}/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    })
  },

  MSG_DELETE_QA: async (payload) => {
    return backendJson(`${API.QA}/${payload.id}`, {
      method: 'DELETE',
    })
  },

  MSG_IMPORT_QA: async (payload) => {
    const pairs = (payload.pairs as Array<unknown>) ?? []
    const qaLimitError = await checkQALimit(pairs.length)
    if (qaLimitError) throw new Error(qaLimitError)
    return backendJson(API.QA_IMPORT, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  MSG_GET_LOG: async (payload) => {
    const params = new URLSearchParams()
    if (payload.page) params.set('page', String(payload.page))
    if (payload.per_page) params.set('per_page', String(payload.per_page))
    const qs = params.toString()
    return backendJson(`${API.LOG}${qs ? `?${qs}` : ''}`)
  },

  MSG_REVIEW_LOG: async (payload) => {
    return backendJson(`${API.LOG}/${payload.id}/review`, {
      method: 'POST',
      body: JSON.stringify({ feedback: payload.feedback }),
    })
  },

  MSG_UPDATE_SETTINGS: async (payload) => {
    return backendJson(API.SETTINGS, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
  },

  MSG_OPEN_OPTIONS: async (payload) => {
    const hash = (payload.hash as string) || ''
    await browser.tabs.create({ url: browser.runtime.getURL(`/options.html#${hash}`) })
    return { opened: true }
  },

  MSG_BACKEND_REQUEST: async (payload) => {
    const { method, path, body } = payload as { method: string; path: string; body?: unknown }
    const url = `${BACKEND_URL}${path}`
    const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } }
    if (body) opts.body = JSON.stringify(body)
    return backendJson(url, opts)
  },
}

// ---- Health check and badge management ----

async function performHealthCheck(): Promise<boolean> {
  try {
    const health = await backendJson<HealthResult>(API.HEALTH)
    const isOnline = health.status === 'ok'

    // Update badge to show status
    await browser.action.setBadgeText({ text: isOnline ? 'ON' : '!' })
    await browser.action.setBadgeBackgroundColor({
      color: isOnline ? '#22c55e' : '#ef4444',
    })

    // Store connection status
    await browser.storage.local.set({
      [STORAGE_KEY_STATUS]: {
        online: isOnline,
        lastCheck: new Date().toISOString(),
        health,
      },
    })

    // If backend came back online, process queued messages
    if (isOnline) {
      await processQueuedMessages()
    }

    return isOnline
  } catch {
    await browser.action.setBadgeText({ text: '!' })
    await browser.action.setBadgeBackgroundColor({ color: '#ef4444' })
    await browser.storage.local.set({
      [STORAGE_KEY_STATUS]: {
        online: false,
        lastCheck: new Date().toISOString(),
        error: 'Backend not reachable',
      },
    })
    return false
  }
}

/** Process queued messages one by one after backend reconnects */
async function processQueuedMessages(): Promise<void> {
  const result = await browser.storage.local.get(STORAGE_KEY_QUEUE)
  const queue: QueuedMessage[] = (result[STORAGE_KEY_QUEUE] as QueuedMessage[] | undefined) ?? []

  if (queue.length === 0) return

  console.log(`[ShopReply] Processing ${queue.length} queued messages`)

  const remaining: QueuedMessage[] = []

  for (const msg of queue) {
    try {
      await backendJson(API.MATCH, {
        method: 'POST',
        body: JSON.stringify({
          question: msg.question,
          platform: msg.platform,
          conversation_id: msg.conversation_id,
          sender_name: msg.sender_name,
          timestamp: msg.timestamp,
          skip_ai: msg.skip_ai ?? true, // default skip AI for safety (free tier)
        }),
      })
      // Successfully processed — don't add to remaining
    } catch {
      // Failed — keep in queue for next attempt
      remaining.push(msg)
    }
  }

  await browser.storage.local.set({ [STORAGE_KEY_QUEUE]: remaining })

  if (remaining.length === 0) {
    console.log('[ShopReply] All queued messages processed')
  } else {
    console.log(`[ShopReply] ${remaining.length} messages still in queue`)
  }
}

// ---- Main background script ----

export default defineBackground(() => {
  console.log('[ShopReply] Background service worker started', {
    id: browser.runtime.id,
  })

  // --- Message handler ---
  browser.runtime.onMessage.addListener(
    (
      message: ExtensionMessage,
      _sender: unknown,
      sendResponse: (response: ExtensionResponse) => void,
    ) => {
      const handler = MESSAGE_HANDLERS[message.type]

      if (!handler) {
        sendResponse({
          success: false,
          error: `Unknown message type: ${message.type}`,
        })
        return false
      }

      handler(message.payload)
        .then((data) => {
          sendResponse({ success: true, data })
        })
        .catch((error: Error) => {
          const msg = error.message || ''
          console.error(`[ShopReply] Handler error for ${message.type}:`, msg)
          sendResponse({
            success: false,
            error: msg || 'Unknown error',
          })
        })

      // Return true to keep the message channel open for async response
      return true
    },
  )

  // --- Health check alarm (periodic) ---
  browser.alarms.create('health-check', {
    periodInMinutes: HEALTH_CHECK_INTERVAL_MINUTES,
  })

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'health-check') {
      performHealthCheck().catch((err) => {
        console.error('[ShopReply] Health check failed:', err)
      })
    }
  })

  // --- Initial health check on startup ---
  performHealthCheck().catch((err) => {
    console.error('[ShopReply] Initial health check failed:', err)
  })

  // --- Watch for pause state changes to update badge ---
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.shopreply_settings) {
      const newSettings = changes.shopreply_settings.newValue as { paused?: boolean } | undefined
      if (newSettings?.paused) {
        browser.action.setBadgeText({ text: '⏸' })
        browser.action.setBadgeBackgroundColor({ color: '#f59e0b' })
      } else {
        // Re-run health check to restore normal badge
        performHealthCheck().catch(() => {})
      }
    }
  })
})
