import { useState, useEffect, useCallback } from 'react';
import { useSettings } from '@/hooks/useSettings';
import { useBackend } from '@/hooks/useBackend';
import { useI18n, LangSwitcher } from '@/hooks/useI18n';
import { useLicense } from '@/hooks/useLicense';
import { StatusBadge } from '@/components/StatusBadge';
import type { StatsResult, ExtensionMessage, ExtensionResponse } from '@/types/messages';

function sendMsg<T>(msg: ExtensionMessage): Promise<ExtensionResponse<T>> {
  return new Promise((resolve) => {
    browser.runtime.sendMessage(msg).then(
      (response) => resolve(response as ExtensionResponse<T>),
      () => resolve({ success: false, error: 'Communication error' })
    );
  });
}

const CWS_REVIEW_URL = `https://chromewebstore.google.com/detail/${browser.runtime.id}/reviews`;
const REVIEW_STORAGE_KEY = 'shopreply_review';
const REVIEW_THRESHOLD = 10;

type ReviewState = { dismissed?: boolean; dismissedAt?: number; reviewed?: boolean };

function App() {
  const { license, limits } = useLicense();
  const { settings, updateSettings, loading: settingsLoading } = useSettings(limits.multiPlatform);
  const { isConnected, healthData } = useBackend();
  const { t, lang } = useI18n();
  const [stats, setStats] = useState<StatsResult | null>(null);
  const [reviewState, setReviewState] = useState<ReviewState>({});

  const fetchData = useCallback(async () => {
    const statsRes = await sendMsg<StatsResult>({ type: 'MSG_GET_STATS', payload: { period: 'today' } });
    if (statsRes.success && statsRes.data) setStats(statsRes.data);
  }, []);

  useEffect(() => {
    fetchData();
    browser.storage.local.get(REVIEW_STORAGE_KEY).then((r) => {
      if (r[REVIEW_STORAGE_KEY]) setReviewState(r[REVIEW_STORAGE_KEY] as ReviewState);
    });
  }, [fetchData]);

  const dismissExpired = reviewState.dismissed && reviewState.dismissedAt
    && (Date.now() - reviewState.dismissedAt) > 3 * 24 * 3600 * 1000;
  const showReviewBanner = !reviewState.reviewed
    && (!reviewState.dismissed || dismissExpired)
    && (stats?.auto_replies_sent ?? 0) >= REVIEW_THRESHOLD;

  const handleReview = () => {
    browser.tabs.create({ url: CWS_REVIEW_URL });
    const next: ReviewState = { reviewed: true };
    setReviewState(next);
    browser.storage.local.set({ [REVIEW_STORAGE_KEY]: next });
  };

  const handleReviewLater = () => {
    const next: ReviewState = { dismissed: true, dismissedAt: Date.now() };
    setReviewState(next);
    browser.storage.local.set({ [REVIEW_STORAGE_KEY]: next });
  };

  const handleReviewNever = () => {
    const next: ReviewState = { reviewed: true };
    setReviewState(next);
    browser.storage.local.set({ [REVIEW_STORAGE_KEY]: next });
  };

  const openOptions = (hash?: string) => {
    const url = browser.runtime.getURL('/options.html') + (hash ? `#${hash}` : '');
    browser.tabs.create({ url });
  };

  // Determine if user needs onboarding
  // isConnected is read from cached storage (instant), no need to wait for health check
  const qaCount = stats?.total_qa_pairs ?? healthData?.qa_count ?? 0;
  const needsOnboarding = !isConnected;

  if (settingsLoading) {
    return (
      <div className="w-[400px] h-[500px] flex items-center justify-center bg-gray-50">
        <div className="text-gray-400 text-sm">{t('loading')}</div>
      </div>
    );
  }

  // ===== ONBOARDING VIEW =====
  if (needsOnboarding) {
    return (
      <div className="w-[400px] h-[500px] flex flex-col bg-gray-50 overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 bg-white/20 rounded-lg flex items-center justify-center text-sm font-bold">S</div>
              <h1 className="text-base font-bold">ShopReply</h1>
            </div>
            <LangSwitcher />
          </div>
        </div>

        {/* Welcome */}
        <div className="flex-1 px-4 py-6 overflow-y-auto space-y-6">
          <div className="text-center">
            <div className="text-3xl mb-2">👋</div>
            <h2 className="text-base font-bold text-gray-900">{t('welcome_title')}</h2>
            <p className="text-xs text-gray-500 mt-1">{t('welcome_desc')}</p>
          </div>

          <div className="space-y-3">
            {/* Step 1: Backend */}
            <div className={`bg-white rounded-xl border p-4 transition-colors ${
              isConnected ? 'border-emerald-200' : 'border-blue-200'
            }`}>
              <div className="flex items-start gap-3">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                  isConnected ? 'bg-emerald-500 text-white' : 'bg-blue-600 text-white'
                }`}>
                  {isConnected ? '✓' : '1'}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-semibold text-gray-800">{t('step1_title')}</div>
                  <p className="text-xs text-gray-500 mt-1">{t('step1_desc')}</p>
                  {isConnected ? (
                    <div className="text-xs text-emerald-600 font-medium mt-2">{t('step1_done')}</div>
                  ) : (
                    <button
                      onClick={() => openOptions('about')}
                      className="mt-3 px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      {t('step1_button')}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Step 2: Import Q&A */}
            <div className={`bg-white rounded-xl border p-4 transition-colors ${
              qaCount > 0 ? 'border-emerald-200' : isConnected ? 'border-blue-200' : 'border-gray-200'
            }`}>
              <div className="flex items-start gap-3">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                  qaCount > 0 ? 'bg-emerald-500 text-white' : isConnected ? 'bg-blue-600 text-white' : 'bg-gray-300 text-gray-500'
                }`}>
                  {qaCount > 0 ? '✓' : '2'}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-semibold text-gray-800">{t('step2_title')}</div>
                  <p className="text-xs text-gray-500 mt-1">{t('step2_desc')}</p>
                  {qaCount > 0 ? (
                    <div className="text-xs text-emerald-600 font-medium mt-2">{qaCount} {t('step2_done')}</div>
                  ) : (
                    <button
                      onClick={() => openOptions('import')}
                      disabled={!isConnected}
                      className={`mt-3 px-3 py-1.5 text-xs rounded-lg transition-colors ${
                        isConnected
                          ? 'bg-blue-600 text-white hover:bg-blue-700'
                          : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      }`}
                    >
                      {t('step2_button')}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Step 3: Open FB/Zalo */}
            <div className={`bg-white rounded-xl border p-4 transition-colors ${
              isConnected && qaCount > 0 ? 'border-blue-200' : 'border-gray-200'
            }`}>
              <div className="flex items-start gap-3">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                  isConnected && qaCount > 0 ? 'bg-blue-600 text-white' : 'bg-gray-300 text-gray-500'
                }`}>3</div>
                <div className="flex-1">
                  <div className="text-sm font-semibold text-gray-800">{t('step3_title')}</div>
                  <p className="text-xs text-gray-500 mt-1">{t('step3_desc')}</p>
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => browser.tabs.create({ url: 'https://www.facebook.com/messages' })}
                      className="px-3 py-1.5 text-xs rounded-lg transition-colors bg-blue-600 text-white hover:bg-blue-700"
                    >
                      {t('step3_fb')}
                    </button>
                    <button
                      onClick={() => browser.tabs.create({ url: 'https://chat.zalo.me' })}
                      className="px-3 py-1.5 text-xs rounded-lg transition-colors bg-blue-600 text-white hover:bg-blue-700"
                    >
                      {t('step3_zalo')}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-200 bg-white flex items-center justify-between">
          <button
            onClick={() => openOptions('settings')}
            className="text-xs text-gray-500 hover:text-gray-900 font-medium transition-colors"
          >
            {t('settings')}
          </button>
          <button
            onClick={() => openOptions('qa')}
            className="text-xs text-blue-600 hover:text-blue-700 font-medium transition-colors"
          >
            {t('dashboard')} &rarr;
          </button>
        </div>
      </div>
    );
  }

  // ===== NORMAL VIEW =====
  const isPaused = settings.paused;

  return (
    <div className="w-[400px] flex flex-col bg-gray-50">

      {/* ── Header — changes color when paused ── */}
      <div className={`px-4 py-3 text-white transition-colors ${
        isPaused
          ? 'bg-gradient-to-r from-amber-500 to-amber-600'
          : 'bg-gradient-to-r from-blue-600 to-blue-700'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-white/20 rounded-lg flex items-center justify-center text-sm font-bold">S</div>
            <h1 className="text-base font-bold">ShopReply</h1>
          </div>
          <div className="flex items-center gap-2">
            {isPaused ? (
              <button
                onClick={() => updateSettings({ paused: false })}
                className="flex items-center gap-1.5 px-2.5 py-1 bg-white/20 hover:bg-white/30 rounded-full transition-colors"
              >
                <span className="text-xs">⏸</span>
                <span className="text-[11px] font-semibold">{t('paused')}</span>
              </button>
            ) : (
              <StatusBadge connected={isConnected} />
            )}
            <LangSwitcher />
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className={`px-4 py-3 space-y-3 transition-opacity ${isPaused ? 'opacity-50 pointer-events-none' : ''}`}>

        {/* Upgrade banner (non-Pro) */}
        {license.tier !== 'pro' && (
          <div className="rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 px-4 py-2.5 flex items-center justify-between">
            <span className="text-xs text-amber-700">{t('no_auto_reply_banner')}</span>
            <button
              onClick={() => openOptions('about')}
              className="px-4 py-1.5 bg-amber-500 text-white text-xs font-bold rounded-lg hover:bg-amber-600 transition-colors flex-shrink-0 ml-3"
            >
              {t('upgrade')}
            </button>
          </div>
        )}

        {/* Controls card */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <ControlRow
            label="Facebook"
            enabled={settings.facebookEnabled}
            onChange={(v) => {
              if (limits.multiPlatform) {
                updateSettings({ facebookEnabled: v });
              } else {
                if (v) updateSettings({ facebookEnabled: true, zaloEnabled: false });
                else if (settings.zaloEnabled) updateSettings({ facebookEnabled: false });
              }
            }}
          />
          <ControlRow
            label="Zalo"
            enabled={settings.zaloEnabled}
            onChange={(v) => {
              if (limits.multiPlatform) {
                updateSettings({ zaloEnabled: v });
              } else {
                if (v) updateSettings({ zaloEnabled: true, facebookEnabled: false });
                else if (settings.facebookEnabled) updateSettings({ zaloEnabled: false });
              }
            }}
          />
          <div className="h-px bg-gray-100 my-2" />
          <ControlRow
            label={t('auto_reply')}
            enabled={settings.autoReplyEnabled}
            onChange={(v) => {
              if (!limits.autoReply) { openOptions('about'); return; }
              updateSettings({ autoReplyEnabled: v });
            }}
            locked={!limits.autoReply}
            lockLabel="Pro"
          />
        </div>

        {/* AI Model status */}
        <div className={`rounded-xl border px-4 py-3 flex items-center justify-between ${
          healthData?.ollama === 'connected'
            ? 'bg-emerald-50 border-emerald-200'
            : 'bg-gray-50 border-gray-200'
        }`}>
          <div>
            <div className="text-xs font-semibold text-gray-800">{t('ai_model')}</div>
            {healthData?.ollama !== 'connected' && (
              <div className="text-[10px] text-gray-400 mt-0.5">{t('ai_setup_hint')}</div>
            )}
          </div>
          {healthData?.ollama === 'connected' ? (
            <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 text-[11px] font-semibold rounded-lg">{t('ai_connected')}</span>
          ) : (
            <button
              onClick={() => browser.tabs.create({ url: 'https://nhamingroup.github.io/shopReply/' })}
              className="px-3 py-1.5 bg-blue-600 text-white text-[11px] font-semibold rounded-lg hover:bg-blue-700 transition-colors"
            >
              {t('ai_not_connected')}
            </button>
          )}
        </div>

        {/* Review banner */}
        {showReviewBanner && (
          <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-sm">⭐</span>
              <span className="text-xs font-medium text-gray-700 flex-1">{t('review_title')}</span>
            </div>
            <div className="flex items-center gap-3 mt-2 pl-6">
              <button onClick={handleReview} className="px-3 py-1 bg-amber-500 text-white text-[11px] font-semibold rounded-lg hover:bg-amber-600 transition-colors">{t('review_button')}</button>
              <button onClick={handleReviewLater} className="text-[11px] text-gray-400 hover:text-gray-600">{t('review_later')}</button>
              <button onClick={handleReviewNever} className="text-[11px] text-gray-400 hover:text-gray-600">{t('review_never')}</button>
            </div>
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="px-4 py-3 border-t border-gray-200 bg-white flex items-center justify-between">
        {/* Settings — gear icon */}
        <button
          onClick={() => openOptions('settings')}
          className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          title={t('settings')}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>

        {/* Pause / Resume */}
        {isPaused ? (
          <button
            onClick={() => updateSettings({ paused: false })}
            className="px-4 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 transition-colors"
          >
            ▶ {t('resume')}
          </button>
        ) : (
          <button
            onClick={() => updateSettings({ paused: true })}
            className="px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors border border-transparent hover:border-amber-200"
          >
            ⏸ {t('pause')}
          </button>
        )}

        {/* Dashboard — prominent button */}
        <button
          onClick={() => openOptions('qa')}
          className="px-3 py-1.5 bg-gray-100 text-gray-700 text-xs font-semibold rounded-lg hover:bg-gray-200 transition-colors"
        >
          {t('dashboard')}
        </button>
      </div>
    </div>
  );
}

/** Control row: label left, toggle switch right */
function ControlRow({ label, enabled, onChange, locked, lockLabel }: {
  label: string;
  enabled: boolean;
  onChange: (value: boolean) => void;
  locked?: boolean;
  lockLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-gray-800">{label}</span>
        {locked && lockLabel && (
          <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[9px] font-bold rounded">
            {lockLabel}
          </span>
        )}
      </div>
      <button
        onClick={() => onChange(!enabled)}
        className={`relative w-10 h-[22px] rounded-full transition-colors flex-shrink-0 ${
          locked ? 'bg-gray-200 cursor-not-allowed' :
          enabled ? 'bg-blue-600' : 'bg-gray-300'
        }`}
      >
        <span className={`absolute top-[3px] w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${
          locked ? 'left-[3px]' : enabled ? 'left-[21px]' : 'left-[3px]'
        }`} />
      </button>
    </div>
  );
}

export default App;
