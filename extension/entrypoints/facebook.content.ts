// ============================================================
// Facebook Messenger content script
//
// Injected into facebook.com/messages/*
// Delegates all logic to shared.ts — this file is just the
// WXT entry point with platform-specific match patterns.
// ============================================================

import { observeMessages } from './content/shared'

export default defineContentScript({
  matches: [
    'https://www.facebook.com/messages/*',
    'https://www.facebook.com/messages',
    'https://facebook.com/messages/*',
    'https://facebook.com/messages',
  ],
  runAt: 'document_idle',
  main() {
    console.log('[ShopReply] Facebook content script loaded')
    observeMessages('facebook')
  },
})
