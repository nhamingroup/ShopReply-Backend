// ============================================================
// Shared utilities for content scripts (Facebook + Zalo)
//
// Handles: MutationObserver, message detection, reply injection,
// suggestion panel lifecycle, and message queuing.
// ============================================================

import {
  FB_SELECTORS,
  ZALO_SELECTORS,
  MATCH_DEBOUNCE_MS,
  MAX_QUEUED_MESSAGES,
} from '@/utils/constants'
import { getSettings } from '@/utils/storage'

// Track recently sent replies to avoid re-processing our own messages
const recentlySentReplies = new Set<string>()
const SENT_REPLY_TTL_MS = 10_000 // forget after 10 seconds

// ---- Cached tier (avoid reading storage on every message) ----
let cachedTier = 'free'
let tierCacheTime = 0
const TIER_CACHE_TTL_MS = 30_000 // refresh every 30 seconds

async function getCachedTier(): Promise<string> {
  const now = Date.now()
  if (now - tierCacheTime < TIER_CACHE_TTL_MS) return cachedTier
  try {
    const stored = await browser.storage.local.get('shopreply_license')
    const license = stored.shopreply_license as { tier?: string } | undefined
    cachedTier = license?.tier ?? 'free'
  } catch { cachedTier = 'free' }
  tierCacheTime = now
  return cachedTier
}

// Invalidate cache immediately when license changes
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.shopreply_license) {
    const newLicense = changes.shopreply_license.newValue as { tier?: string } | undefined
    cachedTier = newLicense?.tier ?? 'free'
    tierCacheTime = Date.now()
  }
})
import type {
  Platform,
  ExtensionResponse,
  MatchResult,
  QASuggestion,
  AISuggestion,
  QueuedMessage,
} from '@/types/messages'

// ---- Logging with timestamp ----
function ts(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}.${String(d.getMilliseconds()).padStart(3,'0')}`
}

// ---- Selector helpers ----

type SelectorMap = typeof FB_SELECTORS | typeof ZALO_SELECTORS

function getSelectors(platform: Platform): SelectorMap {
  return platform === 'facebook' ? FB_SELECTORS : ZALO_SELECTORS
}

// ---- Deduplication ----
// Track processed messages by a hash of their text content to avoid
// sending the same message to the backend multiple times.

const MAX_PROCESSED_MESSAGES = 500
/** Dedup window: same text in same conversation is only deduped within this window */
const DEDUP_WINDOW_MS = 60_000 // 60 seconds
const processedMessages = new Map<string, number>() // hash → timestamp

function pruneProcessedMessages(): void {
  if (processedMessages.size <= MAX_PROCESSED_MESSAGES) return
  // Remove oldest entries (by insertion order) until we're at half capacity
  const removeCount = processedMessages.size - Math.floor(MAX_PROCESSED_MESSAGES / 2)
  let removed = 0
  for (const key of processedMessages.keys()) {
    if (removed >= removeCount) break
    processedMessages.delete(key)
    removed++
  }
}

function messageHash(text: string, conversationId: string): string {
  return `${conversationId}::${text.trim().toLowerCase()}`
}

function isRecentlyProcessed(hash: string): boolean {
  const ts = processedMessages.get(hash)
  if (ts == null) return false
  return Date.now() - ts < DEDUP_WINDOW_MS
}

function markProcessed(hash: string): void {
  processedMessages.set(hash, Date.now())
}

// ---- DOM helpers ----

/**
 * Wait for a DOM element to appear, with timeout.
 * Resolves with the element or null if timeout is reached.
 */
export function waitForElement(
  selector: string,
  timeout = 10000,
): Promise<Element | null> {
  return new Promise((resolve) => {
    const existing = document.querySelector(selector)
    if (existing) {
      resolve(existing)
      return
    }

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector)
      if (el) {
        observer.disconnect()
        resolve(el)
      }
    })

    observer.observe(document.body, { childList: true, subtree: true })

    setTimeout(() => {
      observer.disconnect()
      resolve(null)
    }, timeout)
  })
}

/**
 * Extract conversation ID from the current URL.
 * Facebook: /messages/t/CONVERSATION_ID or /messages/t/CONVERSATION_ID/
 * Zalo: chat.zalo.me — conversation ID might be in URL hash or query
 */
export function extractConversationId(
  platform: Platform,
  url?: string,
): string {
  const href = url ?? window.location.href

  if (platform === 'facebook') {
    // URL pattern: /messages/t/ID or /messages/e2ee/t/ID
    const match = href.match(/\/messages\/(?:e2ee\/)?t\/([^/?#]+)/)
    return match?.[1] ?? 'unknown'
  }

  if (platform === 'zalo') {
    // Zalo URL doesn't change per conversation, extract from data-qid attribute
    // data-qid format: "msgId@timestamp_conversationId_senderId"
    const qidEl = document.querySelector('[data-qid]')
    if (qidEl) {
      const qid = qidEl.getAttribute('data-qid') ?? ''
      const parts = qid.split('_')
      if (parts.length >= 2) return parts[1]
    }
    // Fallback: use header title as conversation identifier
    const headerTitle = document.querySelector('.header-title')
    return headerTitle?.textContent?.trim() ?? 'unknown'
  }

  return 'unknown'
}

/**
 * Detect if the current conversation is a group chat.
 * Returns true for group chats — these should be skipped.
 */
function isGroupChat(platform: Platform): boolean {
  if (platform === 'facebook') {
    // Facebook group chats show member count or multiple participant names
    // in the header area. Look for "members" or "thành viên" text.
    const headerSubtitle = document.querySelector('div[role="main"] a[role="link"] span')
    const headerArea = document.querySelector('div[role="main"]')
    if (headerArea) {
      // Group chats have a "X people" or "X members" indicator
      const spans = headerArea.querySelectorAll('span')
      for (const span of spans) {
        const t = span.textContent?.trim().toLowerCase() ?? ''
        if (t.match(/\d+\s*(people|members|thành viên|người)/)) {
          return true
        }
      }
    }
    return false
  }

  if (platform === 'zalo') {
    // Zalo group chats show member count in header (e.g. "740 thành viên")
    // or have "Cộng đồng" label, or show group-specific elements
    const headerInfo = document.querySelector('.header-info, .conv-header')
    if (headerInfo) {
      const text = headerInfo.textContent?.toLowerCase() ?? ''
      if (text.match(/\d+\s*thành viên/) || text.includes('cộng đồng')) {
        return true
      }
    }
    // Also check for group icon/badge
    const groupBadge = document.querySelector('.group-avatar, .avatar-group, [data-type="group"]')
    if (groupBadge) return true

    return false
  }

  return false
}

/**
 * Create a debounced version of a function.
 */
export function debounce<T extends (...args: Parameters<T>) => void>(
  fn: T,
  ms: number,
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  return (...args: Parameters<T>) => {
    if (timeoutId !== null) clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn(...args), ms)
  }
}

// ---- Reply injection ----

/**
 * Type text into a contenteditable compose box.
 * Uses execCommand('insertText') which works with React-controlled inputs
 * and triggers the correct change events.
 */
export function typeIntoCompose(composeBox: Element, text: string): boolean {
  // Focus the compose box first
  ;(composeBox as HTMLElement).focus()

  // Clear existing content
  const selection = window.getSelection()
  if (selection) {
    selection.selectAllChildren(composeBox)
    selection.collapseToEnd()
  }

  // Use execCommand for React-compatible text insertion
  const inserted = document.execCommand('insertText', false, text)

  if (!inserted) {
    // Fallback: set textContent directly and dispatch input event
    composeBox.textContent = text
    composeBox.dispatchEvent(new Event('input', { bubbles: true }))
  }

  return true
}

/**
 * Simulate pressing Enter to send the message.
 * Facebook and Zalo both support Enter to send.
 */
export function pressEnterToSend(composeBox: Element): void {
  const enterEvent = new KeyboardEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true,
  })
  composeBox.dispatchEvent(enterEvent)
}

/**
 * Full reply injection: type text + press Enter to send.
 * Returns true if compose box was found and reply was injected.
 */
export async function injectAndSendReply(
  platform: Platform,
  text: string,
): Promise<boolean> {
  const selectors = getSelectors(platform)
  const composeBox = document.querySelector(selectors.composeBox)

  if (!composeBox) {
    console.warn(`[ShopReply ${ts()}] Compose box not found — cannot send reply`)
    return false
  }

  typeIntoCompose(composeBox, text)

  // Small delay before pressing Enter to let the UI catch up
  await new Promise((resolve) => setTimeout(resolve, 100))

  pressEnterToSend(composeBox)

  // Track this reply so we don't re-process it when it appears in the DOM
  const key = text.trim().toLowerCase().slice(0, 100)
  recentlySentReplies.add(key)
  setTimeout(() => recentlySentReplies.delete(key), SENT_REPLY_TTL_MS)

  return true
}

// ---- Facebook message extraction ----

/**
 * Detect if a message element is from the shop (outgoing) vs customer (incoming).
 *
 * Facebook Messenger shows outgoing messages aligned to the right
 * and incoming messages aligned to the left. Outgoing messages
 * typically have a specific visual style (e.g., blue background).
 *
 * Heuristic: check if the message row has a style/class indicating
 * right-alignment or the shop's avatar/name.
 */
function isOwnMessageFB(messageEl: Element): boolean {
  // Facebook uses flexbox with justify-content: flex-end for outgoing messages.
  // The parent container of the message bubble will be right-aligned.
  const style = window.getComputedStyle(messageEl)
  if (
    style.justifyContent === 'flex-end' ||
    style.alignSelf === 'flex-end'
  ) {
    return true
  }

  // Check parent containers (up to 8 levels — E2E chats nest deeper)
  let parent: Element | null = messageEl
  for (let i = 0; i < 8; i++) {
    parent = parent?.parentElement ?? null
    if (!parent) break
    const parentStyle = window.getComputedStyle(parent)
    if (
      parentStyle.justifyContent === 'flex-end' ||
      parentStyle.alignSelf === 'flex-end' ||
      parentStyle.flexDirection === 'row-reverse'
    ) {
      return true
    }
  }

  // Fallback: check if no avatar image is adjacent to this message.
  // Outgoing messages (from the shop) typically have no avatar next to them,
  // while incoming messages show the sender's avatar on the left.
  const row = messageEl.closest('div[role="row"]') ?? messageEl
  const hasAvatar = row.querySelector('img[src*="scontent"], img[referrerpolicy]')
  // If the row has a message but no avatar, it's likely outgoing
  if (!hasAvatar) {
    // Double-check: look for the message group's avatar (could be a few rows up)
    let groupParent: Element | null = row
    for (let i = 0; i < 3; i++) {
      groupParent = groupParent?.previousElementSibling ?? null
      if (!groupParent) break
      if (groupParent.querySelector('img[src*="scontent"], img[referrerpolicy]')) {
        return false // Found avatar nearby — it's an incoming message
      }
    }
    return true // No avatar found — outgoing message
  }

  return false
}

/**
 * Extract text content from a new message node on Facebook.
 */
function extractMessageTextFB(node: HTMLElement): string | null {
  // Look for the text content element within the message
  const textEl = node.querySelector(FB_SELECTORS.messageText)
  if (textEl) {
    return textEl.textContent?.trim() ?? null
  }
  // If the node itself matches
  if (node.matches(FB_SELECTORS.messageText)) {
    return node.textContent?.trim() ?? null
  }
  return null
}

/**
 * Extract sender name from a message group on Facebook.
 * Facebook groups consecutive messages from the same sender.
 * The sender name appears at the top of each group.
 */
function extractSenderNameFB(node: HTMLElement): string {
  // Walk up to find the message group, then look for the sender name
  let parent: HTMLElement | null = node
  for (let i = 0; i < 10; i++) {
    parent = parent.parentElement
    if (!parent) break

    // Look for a tooltip or name element above the message
    const nameEl = parent.querySelector('span[dir="auto"]')
    if (
      nameEl &&
      nameEl.textContent &&
      nameEl.textContent.length < 100 &&
      nameEl.textContent.length > 0
    ) {
      return nameEl.textContent.trim()
    }
  }
  return 'Customer'
}

// ---- Zalo message extraction ----
// Zalo DOM structure (2026-03):
//   .chat-item.me          → own message
//   .chat-item (no .me)    → received message
//   [data-id="div_SentMsg_Text"]     → own text message container
//   [data-id="div_ReceivedMsg_Text"] → received text message container
//   [data-component="message-text-content"] span.text → actual text

function isOwnMessageZalo(messageEl: Element): boolean {
  // Zalo uses .chat-item.me for own messages, and data-id="div_SentMsg_Text"
  const className = messageEl.className || ''
  if (className.includes('me')) return true
  // Check if any parent .chat-item has class "me"
  const chatItem = messageEl.closest('.chat-item')
  if (chatItem?.classList.contains('me')) return true
  // Check data-id attribute
  if (messageEl.querySelector('[data-id="div_SentMsg_Text"]')) return true
  return false
}

function extractMessageTextZalo(node: HTMLElement): string | null {
  // Primary: find span.text inside [data-component="message-text-content"]
  const textEl = node.querySelector('[data-component="message-text-content"] span.text')
  if (textEl) {
    return textEl.textContent?.trim() ?? null
  }
  // Fallback: the node itself might be a text container or chat-item
  const altTextEl = node.querySelector('.text-message__container span.text')
  if (altTextEl) {
    return altTextEl.textContent?.trim() ?? null
  }
  // If node is the span.text itself
  if (node.classList.contains('text') && node.tagName === 'SPAN') {
    return node.textContent?.trim() ?? null
  }
  return null
}

function extractSenderNameZalo(_node: HTMLElement): string {
  // Zalo shows sender name in the header for 1:1 chats
  // For group chats, sender name is in .message-quote-fragment__title
  const headerTitle = document.querySelector('.header-title')
  if (headerTitle?.textContent) {
    return headerTitle.textContent.trim()
  }
  return 'Customer'
}

// ---- Message queue (backend offline fallback) ----

async function queueMessage(
  question: string,
  platform: Platform,
  conversationId: string,
  senderName: string,
): Promise<void> {
  const result = await browser.storage.local.get('shopreply_pending_messages')
  const queue: QueuedMessage[] = (result['shopreply_pending_messages'] as QueuedMessage[] | undefined) ?? []

  // Determine skip_ai based on current tier (cached)
  const queueTier = await getCachedTier()
  const queueSkipAi = queueTier === 'free'

  const msg: QueuedMessage = {
    question,
    platform,
    conversation_id: conversationId,
    sender_name: senderName,
    timestamp: new Date().toISOString(),
    queued_at: new Date().toISOString(),
    skip_ai: queueSkipAi,
  }

  queue.push(msg)

  // Auto-cleanup: keep only the most recent messages
  const trimmed = queue.length > MAX_QUEUED_MESSAGES
    ? queue.slice(-MAX_QUEUED_MESSAGES)
    : queue

  await browser.storage.local.set({ shopreply_pending_messages: trimmed })
  console.log(
    `[ShopReply ${ts()}] Message queued (backend offline). Queue size: ${trimmed.length}`,
  )
}

// ---- Suggestion Queue + Panel (Shadow DOM) ----

/** A queued suggestion waiting for user action */
interface QueuedSuggestion {
  platform: Platform
  question: string
  senderName: string
  conversationId: string
  matchResult: MatchResult
  addedAt: number
}

/** Max time (ms) a suggestion stays in queue before auto-expiring */
const SUGGESTION_EXPIRE_MS = 5 * 60_000 // 5 minutes

const suggestionQueue: QueuedSuggestion[] = []
let currentQueueIndex = 0
let currentPanelHost: HTMLElement | null = null

/** Prune expired suggestions from the queue */
function pruneExpiredSuggestions(): void {
  const now = Date.now()
  for (let i = suggestionQueue.length - 1; i >= 0; i--) {
    if (now - suggestionQueue[i].addedAt > SUGGESTION_EXPIRE_MS) {
      suggestionQueue.splice(i, 1)
      if (currentQueueIndex > 0 && currentQueueIndex >= suggestionQueue.length) {
        currentQueueIndex = Math.max(0, suggestionQueue.length - 1)
      }
    }
  }
}

/**
 * Add a suggestion to the queue and render the panel.
 * If a panel is already visible, it updates the badge count instead of replacing.
 */
function showSuggestionPanel(
  platform: Platform,
  question: string,
  matchResult: MatchResult,
): void {
  pruneExpiredSuggestions()

  const conversationId = extractConversationId(platform)
  const senderName = matchResult._senderName ?? 'Khách'

  // Avoid duplicate: same conversation + same question text
  const isDuplicate = suggestionQueue.some(
    (s) => s.conversationId === conversationId && s.question === question,
  )
  if (!isDuplicate) {
    suggestionQueue.push({
      platform,
      question,
      senderName,
      conversationId,
      matchResult,
      addedAt: Date.now(),
    })
    console.log(
      `[ShopReply ${ts()}] Suggestion queued: "${question.slice(0, 40)}..." from "${senderName}" (queue: ${suggestionQueue.length})`,
    )
  }

  // If panel exists, just update badge count; otherwise render full panel
  if (currentPanelHost) {
    updateQueueBadge()
    // If newly added item is the only one, it's already shown
    // Play a subtle notification sound via badge pulse
    pulseQueueBadge()
  } else {
    // Show the latest item (the one just added)
    currentQueueIndex = suggestionQueue.length - 1
    renderSuggestionPanel()
  }
}

/** Pulse the queue badge to draw attention to a new item */
function pulseQueueBadge(): void {
  if (!currentPanelHost) return
  const shadow = currentPanelHost.shadowRoot
  const badge = shadow?.querySelector('.queue-badge') as HTMLElement | null
  if (badge) {
    badge.style.transform = 'scale(1.4)'
    badge.style.background = '#ef4444'
    setTimeout(() => {
      badge.style.transform = 'scale(1)'
      badge.style.background = 'rgba(255,255,255,0.25)'
    }, 600)
  }
}

/** Update just the badge count text without re-rendering the whole panel */
function updateQueueBadge(): void {
  if (!currentPanelHost) return
  const shadow = currentPanelHost.shadowRoot
  const badge = shadow?.querySelector('.queue-badge') as HTMLElement | null
  if (badge) {
    badge.textContent = `${currentQueueIndex + 1}/${suggestionQueue.length}`
  }
  // Update nav button visibility
  const prevBtn = shadow?.querySelector('.nav-prev') as HTMLElement | null
  const nextBtn = shadow?.querySelector('.nav-next') as HTMLElement | null
  if (prevBtn) prevBtn.style.display = currentQueueIndex > 0 ? 'inline-block' : 'none'
  if (nextBtn) nextBtn.style.display = currentQueueIndex < suggestionQueue.length - 1 ? 'inline-block' : 'none'
}

/** Render (or re-render) the panel for the current queue index */
function renderSuggestionPanel(): void {
  // Remove existing panel DOM
  if (currentPanelHost) {
    currentPanelHost.remove()
    currentPanelHost = null
  }

  if (suggestionQueue.length === 0) return

  // Clamp index
  if (currentQueueIndex < 0) currentQueueIndex = 0
  if (currentQueueIndex >= suggestionQueue.length) currentQueueIndex = suggestionQueue.length - 1

  const item = suggestionQueue[currentQueueIndex]
  const { platform, question, senderName, conversationId, matchResult } = item

  const host = document.createElement('div')
  host.id = 'shopreply-panel-host'
  host.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 999999;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `
  document.body.appendChild(host)
  currentPanelHost = host

  const shadow = host.attachShadow({ mode: 'open' })

  const { suggestions, ai_suggestion, match_type, message_id } = matchResult
  const isNew = match_type === 'new'
  let topSuggestion = suggestions[0] ?? null
  if (!topSuggestion && matchResult._greetingReply) {
    topSuggestion = {
      source: 'database' as const,
      qa_id: 0,
      question: question,
      answer: matchResult._greetingReply,
      similarity: 1.0,
    }
  }

  // Check if user is currently viewing this suggestion's conversation
  const activeConvId = extractConversationId(platform)
  const isActiveConversation = activeConvId === conversationId
  const queueTotal = suggestionQueue.length
  const showNav = queueTotal > 1

  shadow.innerHTML = `
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      .panel {
        background: #fff;
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        box-shadow: 0 8px 30px rgba(0,0,0,0.12);
        width: 420px;
        max-height: 520px;
        overflow-y: auto;
        font-size: 14px;
        color: #1f2937;
      }
      .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 16px;
        background: #4f46e5;
        color: #fff;
        border-radius: 12px 12px 0 0;
        font-weight: 600;
        gap: 8px;
      }
      .header-left { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
      .header .badge {
        font-size: 11px;
        background: rgba(255,255,255,0.25);
        padding: 2px 8px;
        border-radius: 10px;
        flex-shrink: 0;
      }
      .queue-badge {
        font-size: 11px;
        background: rgba(255,255,255,0.25);
        padding: 2px 8px;
        border-radius: 10px;
        flex-shrink: 0;
        transition: transform 0.3s, background 0.3s;
      }
      .close-btn {
        background: none; border: none; color: #fff; font-size: 18px;
        cursor: pointer; padding: 0 4px; line-height: 1; flex-shrink: 0;
      }
      .nav-bar {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 6px 16px;
        background: #eef2ff;
        border-bottom: 1px solid #e5e7eb;
        font-size: 12px;
        color: #4f46e5;
      }
      .nav-btn {
        background: #4f46e5; color: #fff; border: none;
        border-radius: 4px; padding: 2px 10px; font-size: 12px;
        cursor: pointer; font-weight: 600;
      }
      .nav-btn:hover { background: #4338ca; }
      .sender-info {
        padding: 8px 16px;
        background: ${isActiveConversation ? '#f0fdf4' : '#fef3c7'};
        border-bottom: 1px solid #e5e7eb;
        font-size: 12px;
        color: ${isActiveConversation ? '#166534' : '#92400e'};
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .sender-info .dot {
        width: 8px; height: 8px; border-radius: 50%;
        background: ${isActiveConversation ? '#22c55e' : '#f59e0b'};
        flex-shrink: 0;
      }
      .question {
        padding: 10px 16px;
        background: #f9fafb;
        border-bottom: 1px solid #e5e7eb;
        font-style: italic;
        color: #6b7280;
      }
      .question strong { color: #1f2937; font-style: normal; }
      .columns {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0;
      }
      .col {
        padding: 12px 16px;
        border-bottom: 1px solid #e5e7eb;
      }
      .col:first-child { border-right: 1px solid #e5e7eb; }
      .col-title {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: #9ca3af;
        margin-bottom: 8px;
      }
      .col-text {
        font-size: 13px;
        line-height: 1.5;
        color: #374151;
        min-height: 40px;
      }
      .col-empty { color: #d1d5db; font-style: italic; }
      .col-meta {
        font-size: 11px; color: #9ca3af; margin-top: 6px;
      }
      .select-btn {
        display: inline-block;
        margin-top: 8px;
        padding: 6px 14px;
        background: #4f46e5;
        color: #fff;
        border: none;
        border-radius: 6px;
        font-size: 12px;
        cursor: pointer;
        transition: background 0.15s;
      }
      .select-btn:hover { background: #4338ca; }
      .select-btn.secondary {
        background: #e5e7eb; color: #374151;
      }
      .select-btn.secondary:hover { background: #d1d5db; }
      .select-btn.warn {
        background: #f59e0b; color: #fff;
      }
      .select-btn.warn:hover { background: #d97706; }
      .actions {
        display: flex;
        gap: 8px;
        padding: 12px 16px;
        justify-content: flex-end;
      }
      .custom-input {
        width: 100%;
        padding: 8px 12px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        font-size: 13px;
        margin-bottom: 8px;
        resize: vertical;
        min-height: 60px;
        font-family: inherit;
      }
      .custom-input:focus { outline: none; border-color: #4f46e5; }
      .custom-area { padding: 0 16px 12px; display: none; }
      .custom-area.visible { display: block; }
      .conv-warn {
        padding: 6px 16px;
        background: #fef3c7;
        border-bottom: 1px solid #fde68a;
        font-size: 11px;
        color: #92400e;
        text-align: center;
      }
    </style>

    <div class="panel">
      <div class="header">
        <div class="header-left">
          <span>ShopReply ${isNew ? '— Câu hỏi mới' : '— Đề xuất'}</span>
          <span class="badge">${match_type}</span>
        </div>
        ${showNav ? `<span class="queue-badge">${currentQueueIndex + 1}/${queueTotal}</span>` : ''}
        <button class="close-btn" data-action="dismiss">&times;</button>
      </div>

      ${showNav ? `
      <div class="nav-bar">
        <button class="nav-btn nav-prev" data-action="nav-prev" style="display:${currentQueueIndex > 0 ? 'inline-block' : 'none'};">&larr;</button>
        <span>Tin nhắn ${currentQueueIndex + 1} / ${queueTotal}</span>
        <button class="nav-btn nav-next" data-action="nav-next" style="display:${currentQueueIndex < queueTotal - 1 ? 'inline-block' : 'none'};">&rarr;</button>
      </div>
      ` : ''}

      <div class="sender-info">
        <span class="dot"></span>
        <strong>${escapeHtml(senderName)}</strong>
        ${isActiveConversation
          ? '— Đang xem hội thoại này'
          : '— Hội thoại khác (cần chuyển sang để gửi)'}
      </div>

      ${!isActiveConversation ? `
      <div class="conv-warn">Bạn đang xem hội thoại khác. Chuyển sang hội thoại của <strong>${escapeHtml(senderName)}</strong> trước khi gửi.</div>
      ` : ''}

      ${matchResult._upgradeNudge ? `
      <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:6px;padding:8px 12px;margin:8px 16px 0;font-size:12px;color:#9a3412;">
        <strong>Gói Free:</strong> Bot chỉ gợi ý, không tự gửi.
        <a href="#" data-action="upgrade" style="color:#ea580c;font-weight:600;text-decoration:underline;">Nâng cấp để tự động trả lời</a>
      </div>
      ` : ''}

      <div class="question">
        <strong>Khách:</strong> ${escapeHtml(question)}
      </div>

      <div class="columns">
        <div class="col">
          <div class="col-title">CÂU TRẢ LỜI CŨ (DB)</div>
          ${topSuggestion ? `
            <div class="col-text">${escapeHtml(topSuggestion.answer)}</div>
            <div class="col-meta">
              ${Math.round(topSuggestion.similarity * 100)}% match — Q: "${escapeHtml(topSuggestion.question)}"
            </div>
            <button class="select-btn${!isActiveConversation ? ' warn' : ''}" data-action="select-db"
              data-answer="${escapeAttr(topSuggestion.answer)}"
              data-qa-id="${topSuggestion.qa_id}">
              ${isActiveConversation ? 'Chọn câu này' : 'Chuyển hội thoại trước'}
            </button>
          ` : `
            <div class="col-text col-empty">Không có câu tương tự trong database</div>
          `}
        </div>

        <div class="col">
          <div class="col-title">AI ĐỀ XUẤT</div>
          ${ai_suggestion ? `
            <div class="col-text">${escapeHtml(ai_suggestion.answer)}</div>
            <div class="col-meta">Model: ${escapeHtml(ai_suggestion.model)}</div>
            <button class="select-btn${!isActiveConversation ? ' warn' : ''}" data-action="select-ai"
              data-answer="${escapeAttr(ai_suggestion.answer)}">
              ${isActiveConversation ? 'Chọn câu này' : 'Chuyển hội thoại trước'}
            </button>
          ` : matchResult._freeTier ? `
            <div class="col-text" style="text-align:center;padding:8px 0;">
              <div style="font-size:20px;margin-bottom:4px;">🔒</div>
              <div style="font-size:12px;color:#9a3412;font-weight:600;">Gói Free không có AI đề xuất</div>
              <a href="#" data-action="upgrade" style="display:inline-block;margin-top:6px;padding:4px 12px;background:#ea580c;color:#fff;border-radius:4px;font-size:11px;font-weight:600;text-decoration:none;">Nâng cấp Basic+</a>
            </div>
          ` : `
            <div class="col-text col-empty">AI chưa kết nối — kiểm tra Ollama đang chạy tại Settings</div>
          `}
        </div>
      </div>

      <div class="custom-area" id="custom-area">
        <textarea class="custom-input" id="custom-input"
          placeholder="Tự viết câu trả lời..."></textarea>
        <button class="select-btn" data-action="send-custom">Gửi</button>
      </div>

      <div class="actions">
        <button class="select-btn secondary" data-action="show-custom">
          Custom — Tự viết
        </button>
        <button class="select-btn secondary" data-action="dismiss">
          Bỏ qua
        </button>
      </div>
    </div>
  `

  // Event delegation on shadow root
  shadow.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    const action = target.dataset.action
    if (!action) return

    switch (action) {
      case 'select-db':
      case 'select-ai': {
        // Block if not viewing the correct conversation
        const currentConvId = extractConversationId(platform)
        if (currentConvId !== conversationId) {
          console.warn(`[ShopReply ${ts()}] Cannot send — viewing ${currentConvId}, need ${conversationId}`)
          // Flash the warning banner
          const warn = shadow.querySelector('.conv-warn') as HTMLElement | null
          if (warn) {
            warn.style.background = '#fde68a'
            setTimeout(() => { warn.style.background = '#fef3c7' }, 500)
          }
          return
        }
        const answer = target.dataset.answer ?? ''
        const qaId = action === 'select-db' ? (Number(target.dataset.qaId) || null) : null
        handlePanelSelectionFromQueue(
          currentQueueIndex,
          answer,
          'suggested',
          qaId,
        )
        break
      }

      case 'show-custom': {
        const area = shadow.getElementById('custom-area')
        if (area) area.classList.toggle('visible')
        break
      }

      case 'send-custom': {
        const currentConvId = extractConversationId(platform)
        if (currentConvId !== conversationId) {
          const warn = shadow.querySelector('.conv-warn') as HTMLElement | null
          if (warn) {
            warn.style.background = '#fde68a'
            setTimeout(() => { warn.style.background = '#fef3c7' }, 500)
          }
          return
        }
        const input = shadow.getElementById(
          'custom-input',
        ) as HTMLTextAreaElement | null
        const customText = input?.value?.trim()
        if (customText) {
          handlePanelSelectionFromQueue(
            currentQueueIndex,
            customText,
            'manual',
            null,
          )
        }
        break
      }

      case 'dismiss': {
        dismissCurrentSuggestion()
        break
      }

      case 'nav-prev': {
        if (currentQueueIndex > 0) {
          currentQueueIndex--
          renderSuggestionPanel()
        }
        break
      }

      case 'nav-next': {
        if (currentQueueIndex < suggestionQueue.length - 1) {
          currentQueueIndex++
          renderSuggestionPanel()
        }
        break
      }

      case 'upgrade': {
        browser.runtime.sendMessage({ type: 'MSG_OPEN_OPTIONS', payload: { hash: 'about' } })
        break
      }
    }
  })
}

/** Handle user selecting a reply from the queue-based panel */
async function handlePanelSelectionFromQueue(
  index: number,
  answer: string,
  replyType: 'suggested' | 'manual',
  qaId: number | null,
): Promise<void> {
  if (index < 0 || index >= suggestionQueue.length) return

  const item = suggestionQueue[index]
  const { platform, question, matchResult } = item
  const messageId = matchResult.message_id

  // Remove this item from queue
  suggestionQueue.splice(index, 1)

  // Show next item or close panel
  if (suggestionQueue.length > 0) {
    currentQueueIndex = Math.min(index, suggestionQueue.length - 1)
    renderSuggestionPanel()
  } else {
    removeSuggestionPanel()
  }

  // Inject and send reply
  const sent = await injectAndSendReply(platform, answer)
  if (!sent) {
    console.error(`[ShopReply ${ts()}] Failed to inject reply`)
    return
  }

  // Log the sent reply to backend
  const conversationId = extractConversationId(platform)
  try {
    await browser.runtime.sendMessage({
      type: 'MSG_SEND',
      payload: {
        message_id: messageId,
        reply_text: answer,
        reply_type: replyType,
        qa_id: qaId,
        original_question: question,
        platform,
        conversation_id: conversationId,
      },
    })
  } catch (err) {
    console.error(`[ShopReply ${ts()}] Failed to log reply:`, err)
  }
}

/** Dismiss the current suggestion and show next in queue */
function dismissCurrentSuggestion(): void {
  if (suggestionQueue.length === 0) {
    removeSuggestionPanel()
    return
  }

  // Remove current item
  suggestionQueue.splice(currentQueueIndex, 1)

  if (suggestionQueue.length > 0) {
    currentQueueIndex = Math.min(currentQueueIndex, suggestionQueue.length - 1)
    renderSuggestionPanel()
  } else {
    removeSuggestionPanel()
  }
}

function removeSuggestionPanel(): void {
  if (currentPanelHost) {
    currentPanelHost.remove()
    currentPanelHost = null
  }
}

// HTML escape helpers for safe DOM insertion
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeAttr(str: string): string {
  return escapeHtml(str).replace(/'/g, '&#39;')
}

// ---- Auto-reply flow ----

/**
 * Handle auto-reply when match_type === 'auto'.
 * Waits the configured delay, injects reply, then logs.
 */
async function handleAutoReply(
  platform: Platform,
  question: string,
  matchResult: MatchResult,
): Promise<void> {
  const suggestion = matchResult.suggestions[0]
  if (!suggestion) return

  // Get reply delay from settings (via background)
  let delayMs = 1000
  try {
    const settingsRes: ExtensionResponse = await browser.runtime.sendMessage({
      type: 'MSG_GET_SETTINGS',
      payload: {},
    })
    if (settingsRes.success && settingsRes.data) {
      const settings = settingsRes.data as { reply_delay_ms?: number }
      delayMs = settings.reply_delay_ms ?? 1000
    }
  } catch {
    // Use default delay
  }

  // Wait before sending to avoid spam detection
  await new Promise((resolve) => setTimeout(resolve, delayMs))

  // Inject and send reply
  const sent = await injectAndSendReply(platform, suggestion.answer)
  if (!sent) {
    console.warn(`[ShopReply ${ts()}] Auto-reply failed — compose box not found`)
    return
  }

  console.log(
    `[ShopReply ${ts()}] Auto-replied: "${suggestion.answer.slice(0, 50)}..." ` +
    `(${Math.round(suggestion.similarity * 100)}% match)`,
  )

  // Log the auto-reply to backend
  const conversationId = extractConversationId(platform)
  try {
    await browser.runtime.sendMessage({
      type: 'MSG_SEND',
      payload: {
        message_id: matchResult.message_id,
        reply_text: suggestion.answer,
        reply_type: 'auto',
        qa_id: suggestion.qa_id,
        original_question: question,
        platform,
        conversation_id: conversationId,
      },
    })
  } catch (err) {
    console.error(`[ShopReply ${ts()}] Failed to log auto-reply:`, err)
  }
}

// ---- Core message handling ----

/**
 * Process a newly detected customer message.
 * Sends to backend for matching, then auto-replies or shows suggestion panel.
 */
async function handleIncomingMessage(
  platform: Platform,
  text: string,
  senderName: string,
): Promise<void> {
  const conversationId = extractConversationId(platform)

  console.log(
    `[ShopReply ${ts()}] New message from "${senderName}": "${text.slice(0, 80)}..."`,
  )

  // Check tier to decide whether to request AI suggestion (cached — no storage read per message)
  const currentTier = await getCachedTier()
  const skipAi = currentTier === 'free'
  console.log(`[ShopReply ${ts()}] Tier check: currentTier="${currentTier}", skipAi=${skipAi}`)

  // Send to background -> backend for matching
  const t0 = performance.now()
  let response: ExtensionResponse<MatchResult>
  try {
    response = await browser.runtime.sendMessage({
      type: 'MSG_MATCH',
      payload: {
        question: text,
        platform,
        conversation_id: conversationId,
        sender_name: senderName,
        timestamp: new Date().toISOString(),
        skip_ai: skipAi,
        tier: currentTier,
      },
    })
  } catch (err) {
    console.error(`[ShopReply ${ts()}] Message send to background failed (${Math.round(performance.now() - t0)}ms):`, err)
    await queueMessage(text, platform, conversationId, senderName)
    return
  }
  console.log(`[ShopReply ${ts()}] Backend responded in ${Math.round(performance.now() - t0)}ms`)

  if (!response.success || !response.data) {
    // Log actual error for debugging
    console.warn(`[ShopReply ${ts()}] Backend offline, queuing message`, {
      success: response.success,
      error: (response as unknown as Record<string, unknown>).error,
      hasData: !!response.data,
    })
    await queueMessage(text, platform, conversationId, senderName)
    return
  }

  const matchResult = response.data

  // Tag sender name for queue panel display
  matchResult._senderName = senderName

  // Tier enforcement: only Pro can auto-reply
  const canAutoReply = currentTier === 'pro'

  // Tag non-pro tier info for the panel to show upgrade nudges
  if (currentTier !== 'pro') {
    if (currentTier === 'free') {
      matchResult._freeTier = true
      // Defense-in-depth: strip AI suggestion for free tier regardless of backend response
      if (matchResult.ai_suggestion) {
        console.log(`[ShopReply ${ts()}] Free tier — stripping AI suggestion from response`)
        matchResult.ai_suggestion = null
      }
    }
    matchResult._upgradeNudge = true
  }

  // Handle based on match type
  // Backend already enforces tier (downgrades auto→suggest for non-pro),
  // but double-check here as defense-in-depth
  switch (matchResult.match_type) {
    case 'auto':
      if (canAutoReply) {
        await handleAutoReply(platform, text, matchResult)
      } else {
        // Non-pro: show suggestion panel with upgrade nudge
        console.log(`[ShopReply ${ts()}] ${currentTier} tier — showing suggestion instead of auto-reply`)
        showSuggestionPanel(platform, text, matchResult)
      }
      break

    case 'suggest':
    case 'new':
      showSuggestionPanel(platform, text, matchResult)
      break
  }
}

// Debounced version of handleIncomingMessage
const debouncedHandle = debounce(
  (platform: Platform, text: string, senderName: string) => {
    handleIncomingMessage(platform, text, senderName).catch((err) => {
      console.error(`[ShopReply ${ts()}] Error handling message:`, err)
    })
  },
  MATCH_DEBOUNCE_MS,
)

// ---- Extract all visible messages (for scan feature) ----

/**
 * Walk the DOM and extract all visible messages from the current conversation.
 * Used by the "Scan Chat History" feature to gather messages for Q&A extraction.
 */
function extractAllVisibleMessages(platform: Platform): Array<{
  sender: 'customer' | 'shop'
  name: string
  text: string
  timestamp: string
}> {
  const results: Array<{
    sender: 'customer' | 'shop'
    name: string
    text: string
    timestamp: string
  }> = []

  if (platform === 'facebook') {
    const rows = document.querySelectorAll(FB_SELECTORS.messageRow)
    rows.forEach((row) => {
      const el = row as HTMLElement
      const text = extractMessageTextFB(el)
      if (!text || text.length < 2) return
      const isOwn = isOwnMessageFB(el)
      const name = isOwn ? 'Shop' : extractSenderNameFB(el)
      results.push({
        sender: isOwn ? 'shop' : 'customer',
        name,
        text,
        timestamp: new Date().toISOString(),
      })
    })
  } else {
    const bubbles = document.querySelectorAll(ZALO_SELECTORS.messageBubble)
    bubbles.forEach((bubble) => {
      const el = bubble as HTMLElement
      const text = extractMessageTextZalo(el)
      if (!text || text.length < 2) return
      const isOwn = isOwnMessageZalo(el)
      const name = isOwn ? 'Shop' : extractSenderNameZalo(el)
      results.push({
        sender: isOwn ? 'shop' : 'customer',
        name,
        text,
        timestamp: new Date().toISOString(),
      })
    })
  }

  return results
}

// ---- Auto History Scan: reuse existing history scan when user views conversations ----

/** Track which conversations have already been auto-scanned this session */
const autoScannedConversations = new Set<string>()
const MAX_AUTO_SCANNED = 200

function pruneAutoScanned(): void {
  if (autoScannedConversations.size <= MAX_AUTO_SCANNED) return
  const entries = Array.from(autoScannedConversations)
  const removeCount = entries.length - Math.floor(MAX_AUTO_SCANNED / 2)
  for (let i = 0; i < removeCount; i++) autoScannedConversations.delete(entries[i])
}

/**
 * Auto-trigger history scan on the current conversation.
 * Reuses the existing MSG_HISTORY_SCAN endpoint — no duplicate logic.
 * Runs silently when user navigates to a conversation.
 */
async function autoScanConversation(platform: Platform): Promise<void> {
  const conversationId = extractConversationId(platform)
  if (conversationId === 'unknown') return

  // Skip if already scanned this conversation in this session
  if (autoScannedConversations.has(conversationId)) return
  autoScannedConversations.add(conversationId)
  pruneAutoScanned()

  // Only for paid tiers
  const tier = await getCachedTier()
  if (tier === 'free') return

  const messages = extractAllVisibleMessages(platform)
  if (messages.length < 4) return // Need at least 2 exchanges

  console.log(`[ShopReply ${ts()}] Auto scan: ${messages.length} messages in ${conversationId}`)

  try {
    const res: ExtensionResponse = await browser.runtime.sendMessage({
      type: 'MSG_HISTORY_SCAN',
      payload: {
        messages: messages.map((m) => ({
          sender: m.sender,
          text: m.text,
        })),
        platform,
        conversation_id: conversationId,
      },
    })

    if (!res.success || !res.data) return
    const data = res.data as { extracted_pairs?: Array<{ question: string; original_answer: string; ai_improved_answer?: string }> }
    const pairs = data.extracted_pairs ?? []
    if (pairs.length === 0) return

    // Auto-import extracted pairs (silently, no user confirmation needed)
    const importPairs = pairs.map((p) => ({
      question: p.question,
      answer: p.ai_improved_answer || p.original_answer,
    }))

    await browser.runtime.sendMessage({
      type: 'MSG_IMPORT_QA',
      payload: { pairs: importPairs, source: 'auto_scan' },
    })

    console.log(`[ShopReply ${ts()}] Auto scan: imported ${importPairs.length} Q&A pairs`)
  } catch (err) {
    // Silent fail — auto scan is best-effort
    console.debug(`[ShopReply ${ts()}] Auto scan failed:`, err)
  }
}

// ---- Platform check ----

async function isPlatformEnabled(platform: Platform): Promise<boolean> {
  const settings = await getSettings()
  return platform === 'facebook' ? settings.facebookEnabled : settings.zaloEnabled
}

// ---- Zalo: find all chat-item messages inside an added node ----
function findZaloChatItems(node: HTMLElement): HTMLElement[] {
  const items: HTMLElement[] = []
  // Case 1: node itself is a .chat-item
  if (node.classList.contains('chat-item')) {
    items.push(node)
  }
  // Case 2: node contains .chat-item children
  const children = node.querySelectorAll('.chat-item')
  children.forEach((el) => items.push(el as HTMLElement))
  // Case 3: node is inside a .chat-item (e.g., a text span was added)
  if (items.length === 0) {
    const parent = node.closest('.chat-item')
    if (parent) items.push(parent as HTMLElement)
  }
  return items
}

// ---- Process a single detected message ----
async function processMessage(
  msgPlatform: Platform,
  text: string,
  isOwn: boolean,
  senderName: string,
  skipDedup = false,
  skipDebounce = false,
): Promise<void> {
  if (!text || isOwn || text.length === 0) return

  // Skip messages from known bots (Meta AI, etc.)
  const IGNORED_SENDERS = ['meta ai', 'facebook', 'messenger']
  if (IGNORED_SENDERS.some(bot => senderName.toLowerCase().includes(bot))) {
    console.log(`[ShopReply ${ts()}] Skipping bot message from "${senderName}"`)
    return
  }

  console.log(`[ShopReply ${ts()}] processMessage: "${text.slice(0, 50)}" from "${senderName}" (skipDedup=${skipDedup})`)

  // Skip group chats — only process 1-on-1 conversations
  if (isGroupChat(msgPlatform)) {
    console.log(`[ShopReply ${ts()}] Skipping group chat message`)
    return
  }

  // Always check platform setting from storage before processing
  const enabled = await isPlatformEnabled(msgPlatform)
  if (!enabled) {
    console.log(`[ShopReply ${ts()}] ${msgPlatform} is disabled — skipping message`)
    return
  }

  // Skip if this text matches a reply we just sent
  const key = text.trim().toLowerCase().slice(0, 100)
  if (recentlySentReplies.has(key)) {
    console.log(`[ShopReply ${ts()}] Skipping own reply: "${text.slice(0, 50)}..."`)
    return
  }

  if (!skipDedup) {
    // Dedup: skip if this exact message was processed within the dedup window
    const convId = extractConversationId(msgPlatform)
    const hash = messageHash(text, convId)
    if (isRecentlyProcessed(hash)) {
      console.log(`[ShopReply ${ts()}] Skipping recently-processed: "${text.slice(0, 50)}..."`)
      return
    }
    markProcessed(hash)
    pruneProcessedMessages()
  }

  // Auto-reply greetings with friendly response
  const normalized = text.trim().toLowerCase()
  const GREETINGS_HELLO = ['hi', 'hello', 'hey', 'chào', 'chao', 'alo', 'xin chào', 'xin chao', 'hi shop', 'hello shop', 'chào shop']
  const GREETINGS_THANKS = ['tks', 'thanks', 'cảm ơn', 'cam on', 'thank you', 'cám ơn']
  const GREETINGS_BYE = ['bye', 'tạm biệt', 'tam biet', 'bye bye']
  const GREETINGS_ACK = ['ok', 'okey', 'okay', 'vâng', 'vang', 'dạ', 'da', 'ừ', 'uh', 'ờ']

  // Check tier for greeting auto-reply — free tier should not auto-send (cached)
  const greetingTier = await getCachedTier()
  const canAutoReplyGreeting = greetingTier === 'basic' || greetingTier === 'pro'

  if (GREETINGS_HELLO.includes(normalized)) {
    const reply = 'Dạ chào bạn! Shop có thể giúp gì cho bạn ạ? 😊'
    if (canAutoReplyGreeting) {
      console.log(`[ShopReply ${ts()}] Greeting detected: "${text}" → auto-reply hello`)
      void injectAndSendReply(msgPlatform, reply)
    } else {
      console.log(`[ShopReply ${ts()}] Greeting detected: "${text}" → free tier, showing suggestion`)
      showSuggestionPanel(msgPlatform, text, {
        match_type: 'auto',
        message_id: 0,
        suggestions: [],
        ai_suggestion: null,
        _freeTier: true,
        _upgradeNudge: true,
        _greetingReply: reply,
        _senderName: senderName,
      })
    }
    return
  }
  if (GREETINGS_THANKS.includes(normalized)) {
    const reply = 'Dạ không có gì ạ! Bạn cần gì thêm cứ nhắn shop nhé 😊'
    if (canAutoReplyGreeting) {
      console.log(`[ShopReply ${ts()}] Thanks detected: "${text}" → auto-reply thanks`)
      void injectAndSendReply(msgPlatform, reply)
    } else {
      console.log(`[ShopReply ${ts()}] Thanks detected: "${text}" → free tier, showing suggestion`)
      showSuggestionPanel(msgPlatform, text, {
        match_type: 'auto',
        message_id: 0,
        suggestions: [{ source: 'database' as const, qa_id: 0, question: text, answer: reply, similarity: 1.0 }],
        ai_suggestion: null,
        _freeTier: true,
        _upgradeNudge: true,
        _senderName: senderName,
      })
    }
    return
  }
  if (GREETINGS_BYE.includes(normalized)) {
    const reply = 'Dạ cảm ơn bạn! Hẹn gặp lại ạ 👋'
    if (canAutoReplyGreeting) {
      console.log(`[ShopReply ${ts()}] Bye detected: "${text}" → auto-reply bye`)
      void injectAndSendReply(msgPlatform, reply)
    } else {
      console.log(`[ShopReply ${ts()}] Bye detected: "${text}" → free tier, showing suggestion`)
      showSuggestionPanel(msgPlatform, text, {
        match_type: 'auto',
        message_id: 0,
        suggestions: [{ source: 'database' as const, qa_id: 0, question: text, answer: reply, similarity: 1.0 }],
        ai_suggestion: null,
        _freeTier: true,
        _upgradeNudge: true,
        _senderName: senderName,
      })
    }
    return
  }
  if (GREETINGS_ACK.includes(normalized) || normalized.length < 3) {
    console.log(`[ShopReply ${ts()}] Ack/short message: "${text}" → skip`)
    return
  }

  if (skipDebounce) {
    // Direct call — used by unread detector for faster response
    handleIncomingMessage(msgPlatform, text, senderName).catch((err) => {
      console.error(`[ShopReply ${ts()}] Error handling message:`, err)
    })
  } else {
    debouncedHandle(msgPlatform, text, senderName)
  }
}

// ---- MutationObserver setup ----

/**
 * Main entry point called by platform-specific content scripts.
 * Sets up a MutationObserver to watch for new messages in the chat.
 */
export async function observeMessages(platform: Platform): Promise<void> {
  // Listen for scan requests from options/popup page
  browser.runtime.onMessage.addListener(
    (
      message: { type: string },
      _sender: unknown,
      sendResponse: (response: unknown) => void,
    ) => {
      if (message.type === 'EXTRACT_CONVERSATION') {
        const messages = extractAllVisibleMessages(platform)
        const conversationId = extractConversationId(platform)
        sendResponse({
          success: true,
          data: {
            messages,
            platform,
            conversation_id: conversationId,
          },
        })
        return true
      }
      return false
    },
  )

  // Check if this platform is enabled in settings
  const initialSettings = await getSettings()
  let platformEnabled = await isPlatformEnabled(platform)
  let globalPaused = initialSettings.paused ?? false
  if (!platformEnabled) {
    console.log(`[ShopReply ${ts()}] ${platform} is disabled in settings. Observer paused.`)
  }
  if (globalPaused) {
    console.log(`[ShopReply ${ts()}] Extension is paused globally.`)
  }

  // Listen for settings changes to dynamically enable/disable
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.shopreply_settings) {
      const newSettings = changes.shopreply_settings.newValue as Record<string, boolean> | undefined
      const key = platform === 'facebook' ? 'facebookEnabled' : 'zaloEnabled'
      const wasEnabled = platformEnabled
      platformEnabled = newSettings?.[key] ?? false
      if (wasEnabled !== platformEnabled) {
        console.log(`[ShopReply ${ts()}] ${platform} ${platformEnabled ? 'enabled' : 'disabled'} via settings`)
        if (!platformEnabled) {
          removeSuggestionPanel()
        }
      }
      // Track global pause state
      const wasPaused = globalPaused
      globalPaused = (newSettings as Record<string, unknown> | undefined)?.paused === true
      if (wasPaused !== globalPaused) {
        console.log(`[ShopReply ${ts()}] Extension ${globalPaused ? 'paused' : 'resumed'}`)
        if (globalPaused) {
          removeSuggestionPanel()
        }
      }
    }
  })

  const selectors = getSelectors(platform)

  console.log(`[ShopReply ${ts()}] Waiting for message container on ${platform}...`)

  // Wait for the message container to appear in the DOM
  const container = await waitForElement(selectors.messageContainer, 30000)
  if (!container) {
    console.error(
      `[ShopReply ${ts()}] Message container not found on ${platform}. ` +
      `Selector: "${selectors.messageContainer}"`,
    )
    return
  }

  console.log(`[ShopReply ${ts()}] Message container found. Starting observer.`)

  // Pre-seed processedMessages with all existing messages so we don't re-process them
  const existingMessages = extractAllVisibleMessages(platform)
  const conversationId = extractConversationId(platform)
  for (const msg of existingMessages) {
    const hash = messageHash(msg.text ?? '', conversationId)
    markProcessed(hash)
  }
  console.log(`[ShopReply ${ts()}] Pre-seeded ${existingMessages.length} existing messages for dedup`)

  // Grace period: ignore mutations during initial DOM render
  let initialLoadDone = false
  setTimeout(() => {
    initialLoadDone = true
    console.log(`[ShopReply ${ts()}] Initial load grace period ended — now processing new messages`)
    // Passive learning: scan the initial conversation
    autoScanConversation(platform)
  }, 3000)

  // Track processed Zalo message IDs to avoid duplicates (capped)
  const MAX_ZALO_MSG_IDS = 300
  const processedZaloMsgIds = new Set<string>()
  const pruneZaloMsgIds = () => {
    if (processedZaloMsgIds.size <= MAX_ZALO_MSG_IDS) return
    const entries = Array.from(processedZaloMsgIds)
    const removeCount = entries.length - Math.floor(MAX_ZALO_MSG_IDS / 2)
    for (let i = 0; i < removeCount; i++) processedZaloMsgIds.delete(entries[i])
  }

  // MutationObserver watches for new child elements (messages) added to the thread
  const observerCallback = (mutations: MutationRecord[]) => {
    // Skip processing if paused, platform is disabled, or still in initial load
    if (globalPaused || !platformEnabled || !initialLoadDone) return

    for (const mutation of mutations) {
      // Only process childList mutations (new nodes), skip attribute/characterData changes
      if (mutation.type !== 'childList' || mutation.addedNodes.length === 0) continue

      for (const addedNode of mutation.addedNodes) {
        if (!(addedNode instanceof HTMLElement)) continue
        // Skip tiny elements that can't be messages (typing indicators, avatars, etc.)
        if (addedNode.offsetHeight < 10 && !addedNode.querySelector('div[dir="auto"]')) continue

        if (platform === 'facebook') {
          let text: string | null = null
          let senderName = 'Customer'
          let isOwn = false
          text = extractMessageTextFB(addedNode)
          isOwn = isOwnMessageFB(addedNode)
          if (text && !isOwn) {
            senderName = extractSenderNameFB(addedNode)
          }
          processMessage(platform, text ?? '', isOwn, senderName)
        } else {
          // Zalo: find all .chat-item elements in or around the added node
          const chatItems = findZaloChatItems(addedNode)

          for (const chatItem of chatItems) {
            // Deduplicate by message bubble ID
            const bubbleEl = chatItem.querySelector('[data-component="bubble-message"]')
            const msgId = bubbleEl?.id ?? chatItem.id ?? ''
            if (msgId && processedZaloMsgIds.has(msgId)) continue
            if (msgId) { processedZaloMsgIds.add(msgId); pruneZaloMsgIds() }

            const text = extractMessageTextZalo(chatItem)
            const isOwn = isOwnMessageZalo(chatItem)
            const senderName = isOwn ? 'Shop' : extractSenderNameZalo(chatItem)

            if (text) {
              processMessage(platform, text, isOwn, senderName)
            }
          }

          // Fallback: if no .chat-item found, check if addedNode itself has message text
          // (handles cases where Zalo updates text content inside existing nodes)
          if (chatItems.length === 0) {
            const textEl = addedNode.querySelector('[data-component="message-text-content"] span.text')
              ?? (addedNode.matches?.('span.text') ? addedNode : null)
            if (textEl && textEl.textContent?.trim()) {
              const chatItem = addedNode.closest('.chat-item')
              if (chatItem) {
                const msgId = chatItem.id ?? ''
                if (!msgId || !processedZaloMsgIds.has(msgId)) {
                  if (msgId) { processedZaloMsgIds.add(msgId); pruneZaloMsgIds() }
                  const text = textEl.textContent.trim()
                  const isOwn = isOwnMessageZalo(chatItem)
                  const senderName = isOwn ? 'Shop' : extractSenderNameZalo(chatItem as HTMLElement)
                  processMessage(platform, text, isOwn, senderName)
                }
              }
            }
          }
        }
      }
    }
  }

  const observer = new MutationObserver(observerCallback)
  let observedContainer: Element = container

  /** Attach (or re-attach) the observer to the current message container. */
  let lastAttachTime = 0
  function attachObserver(reason?: string): void {
    const newContainer = document.querySelector(selectors.messageContainer)
    if (!newContainer) return
    // Skip if re-attaching to the same element (avoid pointless disconnect/reconnect)
    if (newContainer === observedContainer && observedContainer.isConnected) return
    observer.disconnect()
    observedContainer = newContainer
    observer.observe(observedContainer, { childList: true, subtree: true })
    // Throttle logs — only log if >5s since last attach
    const now = Date.now()
    if (now - lastAttachTime > 5000) {
      console.log(`[ShopReply ${ts()}] Observer attached${reason ? ` (${reason})` : ''}`)
    }
    lastAttachTime = now
  }

  attachObserver('init')

  // Periodically verify the observed container is still in the DOM.
  // Facebook SPA can replace the container during navigation.
  setInterval(() => {
    if (!observedContainer.isConnected) {
      attachObserver('container replaced')
    }
  }, 3000)

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    observer.disconnect()
    removeSuggestionPanel()
    console.log(`[ShopReply ${ts()}] Observer disconnected on ${platform}`)
  })

  // Detect SPA navigation (conversation switches) via History API + popstate
  // Much more efficient than MutationObserver on document.body
  let lastUrl = window.location.href
  const checkUrlChange = () => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href
      console.log(
        `[ShopReply ${ts()}] URL changed — new conversation: ${extractConversationId(platform)}`,
      )
      // Re-render panel to update conversation status (green/yellow indicator)
      if (suggestionQueue.length > 0) {
        renderSuggestionPanel()
      }
      // Re-attach observer — SPA navigation may have replaced the container
      attachObserver()
      // Passive learning: scan conversation after DOM settles
      setTimeout(() => autoScanConversation(platform), 3000)
    }
  }

  // Intercept pushState/replaceState (Facebook SPA uses these)
  const origPushState = history.pushState.bind(history)
  const origReplaceState = history.replaceState.bind(history)
  history.pushState = (...args) => { origPushState(...args); checkUrlChange() }
  history.replaceState = (...args) => { origReplaceState(...args); checkUrlChange() }
  window.addEventListener('popstate', checkUrlChange)

  // ---- Auto-detect unread conversations in sidebar ----
  setupUnreadDetector(platform, () => platformEnabled)
}

// ============================================================
// Unread detector
// - Polls sidebar for conversations with unread messages
// - Dedup by convKey + messageText (only process each message once)
// - Navigate → wait for load → process via processMessage()
// - No snapshot, no cooldown, no grace period
// ============================================================

/** Key = "convKey::messagePreview" — tracks which messages have been handled */
const MAX_HANDLED_MESSAGES = 300
const handledMessages = new Set<string>()

function pruneHandledMessages(): void {
  if (handledMessages.size <= MAX_HANDLED_MESSAGES) return
  const entries = Array.from(handledMessages)
  const removeCount = entries.length - Math.floor(MAX_HANDLED_MESSAGES / 2)
  for (let i = 0; i < removeCount; i++) {
    handledMessages.delete(entries[i])
  }
}

function setupUnreadDetector(platform: Platform, isPlatformOn: () => boolean): void {
  let busy = false

  // ---- Extract unread conversations from sidebar HTML ----
  function getUnreads(): Array<{
    convKey: string
    name: string
    preview: string
    clickEl: HTMLElement
  }> {
    const results: Array<{
      convKey: string
      name: string
      preview: string
      clickEl: HTMLElement
    }> = []

    if (platform === 'facebook') {
      const links = document.querySelectorAll(
        'a[href*="/messages/t/"], a[href*="/messages/e2ee/t/"]',
      )
      for (const link of links) {
        const el = link as HTMLElement
        const nameSpan = el.querySelector('span[dir="auto"]') as HTMLElement | null
        if (!nameSpan) continue

        // Unread check: bold font or notification badge
        const fw = parseInt(window.getComputedStyle(nameSpan).fontWeight)
        const hasBadge = !!el.querySelector('[data-visualcompletion="ignore"]')
        if (fw < 600 && !hasBadge) continue

        const href = link.getAttribute('href') ?? ''
        const convId = href.match(/\/messages\/(?:e2ee\/)?t\/([^/?#]+)/)?.[1]
        if (!convId) continue

        // Preview: extract message text from sidebar item
        // FB sidebar shows: [Name] [preview text] [time]
        // We need the preview text, avoiding name, time, and UI labels
        const nameText = nameSpan.textContent?.trim() ?? ''
        let preview = ''

        // Strategy: get all text spans, find one that looks like a message
        let isOwnPreview = false
        const allSpans = el.querySelectorAll('span')
        for (const s of allSpans) {
          let t = (s.textContent?.trim() ?? '')
          // Skip name, empty, short, time indicators
          if (!t || t === nameText || t.length < 2) continue
          if (t.match(/^\d+[smhd]$/) || t.match(/^·/)) continue
          // Detect if this is the shop's own message (prefixed with "You:" or "Bạn:")
          if (/^(You|Bạn)\s*[:：]\s*/i.test(t)) {
            isOwnPreview = true
          }
          // Strip common prefixes (e.g. "Unread message:", "You:", "Bạn:")
          t = t.replace(/^(Unread message|Tin nhắn chưa đọc|You|Bạn)\s*[:：]\s*/i, '').trim()
          // Strip trailing time indicators
          t = t.replace(/\s*·\s*\d+[smhd].*$/, '').trim()
          if (t && t !== nameText && t.length > 1) {
            preview = t
            break
          }
        }

        // Skip if last message in this conversation was from the shop itself
        if (isOwnPreview) continue

        // Skip group conversations — check for group icon (multiple avatars)
        const avatarContainer = el.querySelector('img')?.closest('div')
        const avatarImages = el.querySelectorAll('img')
        if (avatarImages.length > 1) continue // Group chats have multiple avatar images

        results.push({ convKey: convId, name: nameText, preview, clickEl: el })
      }
    } else {
      // Zalo
      const unreads = document.querySelectorAll('.conv-message.unread')
      for (const unread of unreads) {
        const convItem = unread.closest('.conv-item') as HTMLElement | null
        if (!convItem) continue

        // Skip group conversations
        const isGroup = convItem.querySelector('.group-avatar, .avatar-group, [data-type="group"]')
          || convItem.querySelector('.conv-item-title__member-count')
          || (convItem.textContent?.match(/\d+\s*thành viên/) ?? false)
        if (isGroup) continue

        const nameEl =
          convItem.querySelector('.conv-item-title__name .truncate') ??
          convItem.querySelector('div-b16 .truncate')
        const name = nameEl?.textContent?.trim() ?? ''
        if (!name) continue

        const previewEl = unread.querySelector('span')
        const preview = previewEl?.textContent?.trim() ?? ''

        results.push({
          convKey: name,
          name,
          preview,
          clickEl: (convItem.querySelector('.conv-item-body') as HTMLElement) ?? convItem,
        })
      }
    }
    return results
  }

  // ---- Main poll loop ----
  setInterval(async () => {
    if (!isPlatformOn() || busy) return

    const unreads = getUnreads()

    // Find first unread whose message hasn't been handled yet
    const next = unreads.find(
      (u) => u.preview && !handledMessages.has(`${u.convKey}::${u.preview}`),
    )
    if (!next) return // All handled or no unreads — idle

    // Mark as handled
    handledMessages.add(`${next.convKey}::${next.preview}`)
    pruneHandledMessages()
    busy = true

    console.log(`[ShopReply ${ts()}] ${platform}: Unread from "${next.name}" — "${next.preview}"`)

    // Navigate to conversation
    next.clickEl.click()

    // Wait for conversation to load
    await new Promise((r) => setTimeout(r, 1000))

    // Process via processMessage (keeps greeting/ack filters) but skip debounce
    try {
      await processMessage(platform, next.preview, false, next.name, true, true)
    } catch (err) {
      console.error(`[ShopReply ${ts()}] ${platform}: Error:`, err)
    }

    busy = false
  }, 2000) // Check every 2 seconds

  console.log(`[ShopReply ${ts()}] ${platform} unread detector started`)
}

// Re-export types used by content scripts
export type { Platform }
