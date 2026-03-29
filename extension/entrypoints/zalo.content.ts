// ============================================================
// Zalo content script
//
// Injected into chat.zalo.me/*
// Delegates all logic to shared.ts — this file is just the
// WXT entry point with platform-specific match patterns.
// ============================================================

import { observeMessages } from './content/shared'

export default defineContentScript({
  matches: ['https://chat.zalo.me/*'],
  runAt: 'document_idle',
  main() {
    console.log('[ShopReply] Zalo content script loaded')
    observeMessages('zalo')
  },
})
