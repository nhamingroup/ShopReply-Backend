import type { QueuedMessage } from './messages'

/** Local settings cached in chrome.storage.local */
export interface Settings {
  paused: boolean
  autoReplyEnabled: boolean
  autoReplyThreshold: number
  suggestThreshold: number
  facebookEnabled: boolean
  zaloEnabled: boolean
  tone: 'friendly' | 'professional' | 'casual' | 'custom'
  customTonePrompt: string
  replyDelayMs: number
  backendUrl: string
  notificationsEnabled: boolean
  autoReplyMode: 'manual' | 'semi' | 'full'
}

/** Backend connection status stored in chrome.storage.local */
export interface BackendStatus {
  online: boolean
  lastCheck: string
  error?: string
  health?: {
    status: string
    version?: string
    database?: string
    ollama?: string
    qa_count?: number
  }
}

/** Shape of chrome.storage.local data */
export interface StorageData {
  shopreply_settings: Settings
  shopreply_backend_status: BackendStatus
  shopreply_pending_messages: QueuedMessage[]
}
