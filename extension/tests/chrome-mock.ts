/**
 * Chrome API Mock for ShopReply Extension — Playwright E2E Tests
 *
 * Mocks chrome.storage, chrome.runtime, chrome.tabs, chrome.alarms, chrome.notifications.
 * ShopReply-specific: handles MSG_GET_STATS, MSG_GET_LOG, MSG_GET_SETTINGS, etc.
 *
 * Usage:
 *   await page.addInitScript({ content: CHROME_MOCK_SCRIPT });  // BEFORE page.goto()
 */

const DEFAULT_STORE: Record<string, unknown> = {
  settings: {
    backendUrl: 'http://localhost:3000',
    autoReplyEnabled: true,
    facebookEnabled: true,
    zaloEnabled: false,
    autoReplyThreshold: 0.80,
    suggestThreshold: 0.50,
    tone: 'friendly',
    notificationsEnabled: true,
  },
};

// Mock stats data
const MOCK_STATS = {
  period: 'today',
  total_qa_pairs: 42,
  active_qa_pairs: 38,
  total_messages_received: 15,
  auto_replies_sent: 10,
  suggested_replies_sent: 3,
  manual_replies_sent: 2,
  auto_reply_rate: 0.67,
  auto_reply_accuracy: 0.95,
  top_questions: [
    { question: 'Gia hoodie?', count: 5 },
    { question: 'Ship bao lau?', count: 3 },
  ],
  platform_breakdown: {
    facebook: { messages: 12, auto_replies: 8 },
    zalo: { messages: 3, auto_replies: 2 },
  },
};

// Mock log entries
const MOCK_LOG_ITEMS = [
  {
    id: 1,
    customer_question: 'Gia ao hoodie bao nhieu?',
    auto_answer: 'Ao hoodie gia 350k, size S-XL a',
    similarity_score: 0.92,
    qa_pair_id: 12,
    platform: 'facebook',
    conversation_id: 'conv_1',
    sender_name: 'Khach A',
    sent_at: new Date(Date.now() - 600000).toISOString(),
    user_reviewed: false,
    user_feedback: null,
  },
  {
    id: 2,
    customer_question: 'Co ship COD khong?',
    auto_answer: 'Co COD nha ban',
    similarity_score: 0.88,
    qa_pair_id: 15,
    platform: 'facebook',
    conversation_id: 'conv_2',
    sender_name: 'Khach B',
    sent_at: new Date(Date.now() - 1200000).toISOString(),
    user_reviewed: true,
    user_feedback: 'ok',
  },
];

const MOCK_LOG = {
  items: MOCK_LOG_ITEMS,
  total: 2,
  page: 1,
  per_page: 20,
  total_pages: 1,
  summary: {
    total_auto_replies: 10,
    reviewed: 7,
    ok: 6,
    wrong: 1,
    edited: 0,
    unreviewed: 3,
  },
};

// Mock health data
const MOCK_HEALTH = {
  status: 'ok',
  version: '1.0.0',
  database: 'connected',
  ollama: 'connected',
  embedding_model: 'paraphrase-multilingual-MiniLM-L12-v2',
  qa_count: 42,
  uptime_seconds: 3600,
};

// Mock Q&A list
const MOCK_QA_LIST = {
  items: [
    {
      id: 1,
      question: 'Gia ao hoodie?',
      answer: 'Ao hoodie gia 350k, size S-XL a',
      source: 'imported',
      times_auto_sent: 15,
      is_active: true,
      created_at: '2026-03-15T10:00:00Z',
      updated_at: '2026-03-20T08:00:00Z',
    },
    {
      id: 2,
      question: 'Ship bao lau?',
      answer: 'Ship noi thanh 1-2 ngay a',
      source: 'user_replied',
      times_auto_sent: 25,
      is_active: true,
      created_at: '2026-03-15T11:00:00Z',
      updated_at: '2026-03-19T15:30:00Z',
    },
    {
      id: 3,
      question: 'Co COD khong?',
      answer: 'Co COD nha ban',
      source: 'imported',
      times_auto_sent: 8,
      is_active: true,
      created_at: '2026-03-16T09:00:00Z',
      updated_at: '2026-03-18T12:00:00Z',
    },
  ],
  total: 3,
  page: 1,
  per_page: 20,
  total_pages: 1,
};

// Mock backend settings (from API)
const MOCK_BACKEND_SETTINGS = {
  auto_reply_threshold: 0.85,
  suggest_threshold: 0.50,
  tone: 'friendly',
  custom_tone_prompt: '',
  enabled_platforms: ['facebook'],
  ollama_model: 'qwen2.5:7b',
  ollama_fallback_models: ['gemma3:4b', 'llama3.2:3b'],
  ollama_url: 'http://localhost:11434',
  auto_reply_enabled: true,
  notification_enabled: true,
  reply_delay_ms: 1000,
};

export const CHROME_MOCK_SCRIPT = `
(function() {
  // Force English for tests
  try { localStorage.setItem('shopreply_lang', 'en'); } catch(e) {}

  // =========================================================================
  // Internal state
  // =========================================================================

  const _store = ${JSON.stringify(DEFAULT_STORE)};
  window.__openedTab = null;
  window.__notifications = [];
  window.__alarms = {};
  window.__sentMessages = [];
  const _storageListeners = [];

  // =========================================================================
  // Mock response data
  // =========================================================================

  const MOCK_STATS = ${JSON.stringify(MOCK_STATS)};
  const MOCK_LOG = ${JSON.stringify(MOCK_LOG)};
  const MOCK_HEALTH = ${JSON.stringify(MOCK_HEALTH)};
  const MOCK_QA_LIST = ${JSON.stringify(MOCK_QA_LIST)};
  const MOCK_BACKEND_SETTINGS = ${JSON.stringify(MOCK_BACKEND_SETTINGS)};

  // =========================================================================
  // Message handler — ShopReply extension messages
  // =========================================================================

  function handleMessage(msg) {
    window.__sentMessages.push(msg);

    switch (msg.type) {
      case 'MSG_GET_STATS':
        return { success: true, data: MOCK_STATS };

      case 'MSG_GET_LOG':
        return { success: true, data: MOCK_LOG };

      case 'MSG_HEALTH':
        return { success: true, data: MOCK_HEALTH };

      case 'MSG_GET_QA': {
        var activeItems = MOCK_QA_LIST.items.filter(function(i) { return i.is_active; });
        return { success: true, data: { ...MOCK_QA_LIST, items: activeItems, total: activeItems.length } };
      }

      case 'MSG_ADD_QA':
        return { success: true, data: { id: 100, ...msg.payload, source: 'imported', times_auto_sent: 0, is_active: true } };

      case 'MSG_UPDATE_QA':
        return { success: true, data: { id: msg.payload.id, ...msg.payload } };

      case 'MSG_DELETE_QA': {
        var delId = msg.payload.id;
        var item = MOCK_QA_LIST.items.find(function(i) { return i.id === delId; });
        if (item) item.is_active = false;
        return { success: true, data: { id: delId, deleted: true } };
      }

      case 'MSG_IMPORT_QA':
        return { success: true, data: { import_id: 1, total_in_file: 5, added: 4, skipped_duplicate: 1, skipped_invalid: 0, errors: [] } };

      case 'MSG_GET_SETTINGS':
        return { success: true, data: MOCK_BACKEND_SETTINGS };

      case 'MSG_UPDATE_SETTINGS':
        Object.assign(MOCK_BACKEND_SETTINGS, msg.payload);
        return { success: true, data: MOCK_BACKEND_SETTINGS };

      case 'MSG_MATCH':
        return { success: true, data: { match_type: 'suggest', message_id: 1, suggestions: [], ai_suggestion: null } };

      case 'MSG_SEND':
        return { success: true, data: { message_id: 1, reply_type: 'manual', new_qa_created: false, qa_id: null } };

      case 'MSG_REVIEW_LOG':
        return { success: true, data: { id: msg.payload.id, user_reviewed: true, user_feedback: msg.payload.feedback } };

      case 'MSG_LLM_SUGGEST':
        return { success: true, data: { answer: 'AI suggestion test', model: 'qwen2.5:7b', generation_time_ms: 500 } };

      case 'MSG_HISTORY_SCAN':
        return { success: true, data: { extracted_pairs: [], skipped_messages: 0, total_messages_analyzed: 0 } };

      default:
        console.warn('[Chrome Mock] Unhandled message type:', msg.type);
        return { success: true, data: null };
    }
  }

  // =========================================================================
  // chrome.storage.local
  // =========================================================================

  const storageMock = {
    local: {
      get: function(keys, callback) {
        const result = {};

        if (typeof keys === 'string') {
          result[keys] = _store[keys] !== undefined ? _store[keys] : null;
        } else if (Array.isArray(keys)) {
          keys.forEach(function(k) {
            result[k] = _store[k] !== undefined ? _store[k] : null;
          });
        } else if (keys === null || keys === undefined) {
          Object.assign(result, _store);
        } else if (typeof keys === 'object') {
          Object.keys(keys).forEach(function(k) {
            result[k] = _store[k] !== undefined ? _store[k] : keys[k];
          });
        }

        if (callback) {
          setTimeout(function() { callback(result); }, 0);
        }
        return Promise.resolve(result);
      },

      set: function(data, callback) {
        const changes = {};
        Object.keys(data).forEach(function(key) {
          const oldValue = _store[key];
          _store[key] = data[key];
          changes[key] = { oldValue: oldValue, newValue: data[key] };
        });

        if (Object.keys(changes).length > 0) {
          _storageListeners.forEach(function(listener) {
            try { listener(changes, 'local'); } catch(e) {}
          });
        }

        if (callback) {
          setTimeout(function() { callback(); }, 0);
        }
        return Promise.resolve();
      },

      remove: function(keys, callback) {
        const changes = {};
        const keyList = typeof keys === 'string' ? [keys] : keys;

        keyList.forEach(function(key) {
          if (_store[key] !== undefined) {
            changes[key] = { oldValue: _store[key] };
            delete _store[key];
          }
        });

        if (Object.keys(changes).length > 0) {
          _storageListeners.forEach(function(listener) {
            try { listener(changes, 'local'); } catch(e) {}
          });
        }

        if (callback) {
          setTimeout(function() { callback(); }, 0);
        }
        return Promise.resolve();
      },

      clear: function(callback) {
        const changes = {};
        Object.keys(_store).forEach(function(key) {
          changes[key] = { oldValue: _store[key] };
          delete _store[key];
        });

        _storageListeners.forEach(function(listener) {
          try { listener(changes, 'local'); } catch(e) {}
        });

        if (callback) {
          setTimeout(function() { callback(); }, 0);
        }
        return Promise.resolve();
      },
    },

    onChanged: {
      addListener: function(listener) {
        _storageListeners.push(listener);
      },
      removeListener: function(listener) {
        const idx = _storageListeners.indexOf(listener);
        if (idx > -1) _storageListeners.splice(idx, 1);
      },
      hasListener: function(listener) {
        return _storageListeners.includes(listener);
      },
    },
  };

  // =========================================================================
  // chrome.runtime
  // =========================================================================

  const runtimeMock = {
    sendMessage: function(msg, callback) {
      const resp = handleMessage(msg);
      if (callback) {
        setTimeout(function() { callback(resp); }, 0);
      }
      return Promise.resolve(resp);
    },

    lastError: null,

    openOptionsPage: function(callback) {
      window.__openedTab = 'chrome://extensions/?options';
      if (callback) setTimeout(callback, 0);
    },

    getURL: function(path) {
      return '/' + path.replace(/^\\//, '');
    },

    getManifest: function() {
      return {
        name: 'ShopReply',
        version: '1.0.0',
        manifest_version: 3,
      };
    },

    onInstalled: { addListener: function() {} },
    onMessage: { addListener: function() {} },
    onStartup: { addListener: function() {} },
  };

  // =========================================================================
  // chrome.tabs
  // =========================================================================

  const tabsMock = {
    create: function(opts) {
      window.__openedTab = opts.url || opts;
      return Promise.resolve({ id: 999, url: opts.url });
    },

    query: function(queryInfo, callback) {
      const tabs = [{ id: 1, url: 'http://localhost/', active: true, currentWindow: true }];
      if (callback) {
        setTimeout(function() { callback(tabs); }, 0);
      }
      return Promise.resolve(tabs);
    },

    sendMessage: function(tabId, msg, callback) {
      if (callback) {
        setTimeout(function() { callback({ success: true }); }, 0);
      }
      return Promise.resolve({ success: true });
    },
  };

  // =========================================================================
  // chrome.alarms
  // =========================================================================

  const alarmListeners = [];

  const alarmsMock = {
    create: function(name, alarmInfo) {
      window.__alarms[name] = {
        name: name,
        scheduledTime: Date.now() + (alarmInfo.delayInMinutes || 0) * 60000,
        periodInMinutes: alarmInfo.periodInMinutes || undefined,
      };
      return Promise.resolve();
    },

    get: function(name, callback) {
      const alarm = window.__alarms[name] || null;
      if (callback) {
        setTimeout(function() { callback(alarm); }, 0);
      }
      return Promise.resolve(alarm);
    },

    getAll: function(callback) {
      const all = Object.values(window.__alarms);
      if (callback) {
        setTimeout(function() { callback(all); }, 0);
      }
      return Promise.resolve(all);
    },

    clear: function(name, callback) {
      const existed = !!window.__alarms[name];
      delete window.__alarms[name];
      if (callback) {
        setTimeout(function() { callback(existed); }, 0);
      }
      return Promise.resolve(existed);
    },

    clearAll: function(callback) {
      window.__alarms = {};
      if (callback) {
        setTimeout(function() { callback(true); }, 0);
      }
      return Promise.resolve(true);
    },

    onAlarm: {
      addListener: function(listener) { alarmListeners.push(listener); },
      removeListener: function(listener) {
        const idx = alarmListeners.indexOf(listener);
        if (idx > -1) alarmListeners.splice(idx, 1);
      },
    },
  };

  window.__triggerAlarm = function(name) {
    const alarm = window.__alarms[name] || { name: name, scheduledTime: Date.now() };
    alarmListeners.forEach(function(listener) {
      try { listener(alarm); } catch(e) {}
    });
  };

  // =========================================================================
  // chrome.notifications
  // =========================================================================

  const notificationsMock = {
    create: function(id, options, callback) {
      const notifId = id || 'notif_' + Date.now();
      window.__notifications.push({ id: notifId, ...options });
      if (callback) {
        setTimeout(function() { callback(notifId); }, 0);
      }
      return Promise.resolve(notifId);
    },

    clear: function(id, callback) {
      window.__notifications = window.__notifications.filter(function(n) { return n.id !== id; });
      if (callback) {
        setTimeout(function() { callback(true); }, 0);
      }
      return Promise.resolve(true);
    },

    onClicked: { addListener: function() {} },
    onClosed: { addListener: function() {} },
    onButtonClicked: { addListener: function() {} },
  };

  // =========================================================================
  // Assemble window.chrome + window.browser (WXT uses browser.*)
  // =========================================================================

  window.chrome = {
    storage: storageMock,
    runtime: runtimeMock,
    tabs: tabsMock,
    alarms: alarmsMock,
    notifications: notificationsMock,
  };

  // WXT uses browser.* API — alias to chrome
  window.browser = window.chrome;

  console.log('[Chrome Mock] ShopReply mock initialized — storage keys:', Object.keys(_store));
})();
`;
