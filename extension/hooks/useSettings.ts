import { useState, useEffect, useCallback } from 'react';
import type { Settings } from '@/types/storage';
import { getSettings, saveSettings } from '@/utils/storage';

const DEFAULT_SETTINGS: Settings = {
  paused: false,
  autoReplyEnabled: false,
  autoReplyThreshold: 0.80,
  suggestThreshold: 0.50,
  facebookEnabled: true,
  zaloEnabled: false,
  tone: 'friendly',
  customTonePrompt: '',
  replyDelayMs: 1000,
  backendUrl: 'http://localhost:3939',
  notificationsEnabled: true,
  autoReplyMode: 'semi',
};

/** Normalize platform state: non-Pro tiers can only have 1 platform enabled */
function normalizePlatforms(s: Settings, multiPlatform: boolean): Settings {
  if (multiPlatform) return s;
  // If both are ON, keep Facebook (default), turn off Zalo
  if (s.facebookEnabled && s.zaloEnabled) {
    return { ...s, zaloEnabled: false };
  }
  return s;
}

export function useSettings(multiPlatform = false) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getSettings()
      .then((s) => {
        const normalized = normalizePlatforms(s, multiPlatform);
        setSettings(normalized);
        // Persist normalized state if it changed
        if (normalized !== s) saveSettings(normalized);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [multiPlatform]);

  const updateSettings = useCallback(async (partial: Partial<Settings>) => {
    const updated = { ...settings, ...partial };
    setSettings(updated);
    await saveSettings(updated);

    // Sync backend-relevant settings to the Python backend
    const backendFields: Record<string, unknown> = {};
    if ('autoReplyThreshold' in partial) backendFields.auto_reply_threshold = partial.autoReplyThreshold;
    if ('suggestThreshold' in partial) backendFields.suggest_threshold = partial.suggestThreshold;
    if ('tone' in partial) backendFields.tone = partial.tone;
    if ('customTonePrompt' in partial) backendFields.custom_tone_prompt = partial.customTonePrompt;
    if ('autoReplyEnabled' in partial) backendFields.auto_reply_enabled = partial.autoReplyEnabled;
    if ('replyDelayMs' in partial) backendFields.reply_delay_ms = partial.replyDelayMs;
    if ('notificationsEnabled' in partial) backendFields.notification_enabled = partial.notificationsEnabled;
    if ('autoReplyMode' in partial) backendFields.auto_reply_mode = partial.autoReplyMode;

    if (Object.keys(backendFields).length > 0) {
      browser.runtime.sendMessage({
        type: 'MSG_UPDATE_SETTINGS',
        payload: backendFields,
      }).catch(() => { /* Backend sync is best-effort */ });
    }
  }, [settings]);

  return { settings, updateSettings, loading };
}
