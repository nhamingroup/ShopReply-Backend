/**
 * Suggestion panel injected into the page DOM.
 * Uses Shadow DOM for style isolation.
 * Pure DOM manipulation — no React, no Tailwind.
 * Communicates with background via chrome.runtime.sendMessage.
 */

const PANEL_ID = 'shopreply-suggestion-panel'
const AUTO_HIDE_MS = 30_000

interface ShowPanelOptions {
  question: string
  dbMatch?: { answer: string; similarity: number }
  aiSuggestion?: string
  onSend: (answer: string, type: 'database' | 'ai' | 'custom') => void
  onSkip: () => void
}

const PANEL_STYLES = /* css */ `
  :host {
    all: initial;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    color: #1a1a2e;
  }

  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  .sr-panel {
    position: fixed;
    bottom: 80px;
    right: 24px;
    width: 420px;
    max-height: 480px;
    background: #ffffff;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15), 0 2px 8px rgba(0, 0, 0, 0.08);
    z-index: 2147483647;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: sr-slide-up 0.25s ease-out;
    border: 1px solid rgba(0, 0, 0, 0.08);
  }

  @keyframes sr-slide-up {
    from { opacity: 0; transform: translateY(16px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  @keyframes sr-fade-out {
    from { opacity: 1; }
    to   { opacity: 0; transform: translateY(8px); }
  }

  .sr-panel.hiding {
    animation: sr-fade-out 0.2s ease-in forwards;
  }

  .sr-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: linear-gradient(135deg, #2563eb, #1d4ed8);
    color: #ffffff;
  }

  .sr-header-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .sr-logo {
    width: 22px;
    height: 22px;
    background: rgba(255, 255, 255, 0.2);
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
  }

  .sr-header-title {
    font-size: 13px;
    font-weight: 600;
  }

  .sr-close {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.7);
    font-size: 18px;
    cursor: pointer;
    padding: 4px;
    line-height: 1;
    border-radius: 4px;
  }

  .sr-close:hover {
    color: #ffffff;
    background: rgba(255, 255, 255, 0.15);
  }

  .sr-question {
    padding: 10px 16px;
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
    font-size: 12px;
    color: #64748b;
  }

  .sr-question strong {
    color: #1e293b;
  }

  .sr-columns {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
    flex: 1;
    overflow-y: auto;
  }

  .sr-column {
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .sr-column:first-child {
    border-right: 1px solid #e2e8f0;
  }

  .sr-column-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #64748b;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .sr-similarity {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 10px;
    background: #dbeafe;
    color: #1d4ed8;
    font-weight: 600;
    text-transform: none;
    letter-spacing: 0;
  }

  .sr-answer-text {
    font-size: 13px;
    line-height: 1.5;
    color: #334155;
    flex: 1;
    word-break: break-word;
  }

  .sr-empty {
    font-size: 12px;
    color: #94a3b8;
    font-style: italic;
  }

  .sr-send-btn {
    display: block;
    width: 100%;
    padding: 8px 12px;
    font-size: 12px;
    font-weight: 600;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
    font-family: inherit;
  }

  .sr-send-btn.primary {
    background: #2563eb;
    color: #ffffff;
  }

  .sr-send-btn.primary:hover {
    background: #1d4ed8;
  }

  .sr-send-btn.secondary {
    background: #f1f5f9;
    color: #475569;
    border: 1px solid #e2e8f0;
  }

  .sr-send-btn.secondary:hover {
    background: #e2e8f0;
  }

  .sr-send-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .sr-custom {
    padding: 12px 16px;
    border-top: 1px solid #e2e8f0;
    display: flex;
    gap: 8px;
  }

  .sr-custom-input {
    flex: 1;
    padding: 8px 12px;
    font-size: 13px;
    border: 1px solid #d1d5db;
    border-radius: 8px;
    outline: none;
    font-family: inherit;
    resize: none;
    min-height: 36px;
    max-height: 80px;
  }

  .sr-custom-input:focus {
    border-color: #2563eb;
    box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15);
  }

  .sr-footer {
    padding: 8px 16px 12px;
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  .sr-skip-btn {
    padding: 6px 16px;
    font-size: 12px;
    background: none;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    cursor: pointer;
    color: #64748b;
    font-family: inherit;
    transition: all 0.15s ease;
  }

  .sr-skip-btn:hover {
    background: #f1f5f9;
    color: #334155;
  }

  .sr-toast {
    position: fixed;
    bottom: 80px;
    right: 24px;
    background: #059669;
    color: #ffffff;
    padding: 12px 24px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    z-index: 2147483647;
    box-shadow: 0 4px 12px rgba(5, 150, 105, 0.3);
    animation: sr-slide-up 0.2s ease-out;
  }
`

function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

function hideWithAnimation(panel: HTMLElement, container: HTMLElement): void {
  panel.classList.add('hiding')
  panel.addEventListener(
    'animationend',
    () => {
      container.remove()
    },
    { once: true },
  )
  // Fallback removal
  setTimeout(() => {
    if (container.parentNode) container.remove()
  }, 300)
}

function showToast(shadow: ShadowRoot, container: HTMLElement): void {
  const panel = shadow.querySelector('.sr-panel')
  if (panel) panel.remove()

  const toast = document.createElement('div')
  toast.className = 'sr-toast'
  toast.textContent = 'Sent \u2713'
  shadow.appendChild(toast)

  setTimeout(() => {
    container.remove()
  }, 1500)
}

function createPanelDOM(options: ShowPanelOptions): HTMLElement {
  const container = document.createElement('div')
  container.id = PANEL_ID

  const shadow = container.attachShadow({ mode: 'closed' })

  // Styles
  const styleEl = document.createElement('style')
  styleEl.textContent = PANEL_STYLES
  shadow.appendChild(styleEl)

  // Panel wrapper
  const panel = document.createElement('div')
  panel.className = 'sr-panel'

  // ---- Header ----
  const header = document.createElement('div')
  header.className = 'sr-header'

  const headerLeft = document.createElement('div')
  headerLeft.className = 'sr-header-left'
  headerLeft.innerHTML =
    '<div class="sr-logo">S</div><span class="sr-header-title">ShopReply</span>'
  header.appendChild(headerLeft)

  const closeBtn = document.createElement('button')
  closeBtn.className = 'sr-close'
  closeBtn.textContent = '\u00D7'
  closeBtn.addEventListener('click', () => {
    options.onSkip()
    hideWithAnimation(panel, container)
  })
  header.appendChild(closeBtn)
  panel.appendChild(header)

  // ---- Question ----
  const questionEl = document.createElement('div')
  questionEl.className = 'sr-question'
  questionEl.innerHTML = `<strong>Customer:</strong> ${escapeHtml(options.question)}`
  panel.appendChild(questionEl)

  // ---- Two columns ----
  const columns = document.createElement('div')
  columns.className = 'sr-columns'

  // Left: Database match
  const leftCol = document.createElement('div')
  leftCol.className = 'sr-column'

  if (options.dbMatch) {
    const title = document.createElement('div')
    title.className = 'sr-column-title'
    title.innerHTML = `Database Match <span class="sr-similarity">${Math.round(options.dbMatch.similarity * 100)}%</span>`
    leftCol.appendChild(title)

    const answer = document.createElement('div')
    answer.className = 'sr-answer-text'
    answer.textContent = options.dbMatch.answer
    leftCol.appendChild(answer)

    const sendBtn = document.createElement('button')
    sendBtn.className = 'sr-send-btn primary'
    sendBtn.textContent = 'Send DB Answer'
    sendBtn.addEventListener('click', () => {
      options.onSend(options.dbMatch!.answer, 'database')
      showToast(shadow, container)
    })
    leftCol.appendChild(sendBtn)
  } else {
    const title = document.createElement('div')
    title.className = 'sr-column-title'
    title.textContent = 'Database Match'
    leftCol.appendChild(title)

    const empty = document.createElement('div')
    empty.className = 'sr-empty'
    empty.textContent = 'No matching Q&A found'
    leftCol.appendChild(empty)
  }
  columns.appendChild(leftCol)

  // Right: AI suggestion
  const rightCol = document.createElement('div')
  rightCol.className = 'sr-column'

  if (options.aiSuggestion) {
    const title = document.createElement('div')
    title.className = 'sr-column-title'
    title.textContent = 'AI Suggestion'
    rightCol.appendChild(title)

    const answer = document.createElement('div')
    answer.className = 'sr-answer-text'
    answer.textContent = options.aiSuggestion
    rightCol.appendChild(answer)

    const sendBtn = document.createElement('button')
    sendBtn.className = 'sr-send-btn primary'
    sendBtn.textContent = 'Send AI Answer'
    sendBtn.addEventListener('click', () => {
      options.onSend(options.aiSuggestion!, 'ai')
      showToast(shadow, container)
    })
    rightCol.appendChild(sendBtn)
  } else {
    const title = document.createElement('div')
    title.className = 'sr-column-title'
    title.textContent = 'AI Suggestion'
    rightCol.appendChild(title)

    const empty = document.createElement('div')
    empty.className = 'sr-empty'
    empty.textContent = 'AI not available'
    rightCol.appendChild(empty)
  }
  columns.appendChild(rightCol)
  panel.appendChild(columns)

  // ---- Custom input ----
  const customRow = document.createElement('div')
  customRow.className = 'sr-custom'

  const customInput = document.createElement('textarea')
  customInput.className = 'sr-custom-input'
  customInput.placeholder = 'Type a custom reply...'
  customInput.rows = 1
  customInput.addEventListener('input', () => {
    customInput.style.height = 'auto'
    customInput.style.height = `${Math.min(customInput.scrollHeight, 80)}px`
  })
  customRow.appendChild(customInput)

  const customSendBtn = document.createElement('button')
  customSendBtn.className = 'sr-send-btn primary'
  customSendBtn.textContent = 'Send'
  customSendBtn.style.width = 'auto'
  customSendBtn.style.padding = '8px 16px'
  customSendBtn.style.flexShrink = '0'
  customSendBtn.addEventListener('click', () => {
    const text = customInput.value.trim()
    if (!text) return
    options.onSend(text, 'custom')
    showToast(shadow, container)
  })
  customRow.appendChild(customSendBtn)
  panel.appendChild(customRow)

  // ---- Footer ----
  const footer = document.createElement('div')
  footer.className = 'sr-footer'

  const skipBtn = document.createElement('button')
  skipBtn.className = 'sr-skip-btn'
  skipBtn.textContent = 'Skip'
  skipBtn.addEventListener('click', () => {
    options.onSkip()
    hideWithAnimation(panel, container)
  })
  footer.appendChild(skipBtn)
  panel.appendChild(footer)

  shadow.appendChild(panel)

  // Auto-hide after 30s
  const timer = setTimeout(() => {
    hideWithAnimation(panel, container)
  }, AUTO_HIDE_MS)
  container.dataset.timerId = String(timer)

  return container
}

/**
 * Show the suggestion panel on the page.
 * Removes any existing panel first.
 */
export function showSuggestionPanel(options: ShowPanelOptions): void {
  hideSuggestionPanel()
  const container = createPanelDOM(options)
  document.body.appendChild(container)
}

/**
 * Remove the suggestion panel from the page.
 */
export function hideSuggestionPanel(): void {
  const existing = document.getElementById(PANEL_ID)
  if (existing) {
    const timerId = existing.dataset.timerId
    if (timerId) clearTimeout(Number(timerId))
    existing.remove()
  }
}
