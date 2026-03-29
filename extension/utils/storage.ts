import type { Settings } from '@/types/storage'
import { BACKEND_URL } from './constants'

const STORAGE_KEY = 'shopreply_settings'

const DEFAULT_SETTINGS: Settings = {
  paused: false,
  autoReplyEnabled: true,
  autoReplyThreshold: 0.80,
  suggestThreshold: 0.50,
  facebookEnabled: true,
  zaloEnabled: false,
  tone: 'friendly',
  customTonePrompt: '',
  replyDelayMs: 1000,
  backendUrl: BACKEND_URL,
  notificationsEnabled: true,
  autoReplyMode: 'semi',
}

export async function getSettings(): Promise<Settings> {
  const result = await browser.storage.local.get(STORAGE_KEY)
  return { ...DEFAULT_SETTINGS, ...(result[STORAGE_KEY] as Partial<Settings>) }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: settings })
}
