import { useState, useEffect, useCallback } from 'react';
import { useSettings } from '@/hooks/useSettings';
import { useBackend } from '@/hooks/useBackend';
import { useI18n, LangSwitcher } from '@/hooks/useI18n';
import { useLicense } from '@/hooks/useLicense';
import { StatusBadge } from '@/components/StatusBadge';
import { QATable } from '@/components/QATable';
import { ImportModal } from '@/components/ImportModal';
import type {
  ExtensionMessage,
  ExtensionResponse,
  LogResult,
  LogEntry,
  FlowResponse,
  FlowStep,
} from '@/types/messages';
import type { QAPair } from '@/types/qa';

function sendMsg<T>(msg: ExtensionMessage): Promise<ExtensionResponse<T>> {
  return new Promise((resolve) => {
    browser.runtime.sendMessage(msg).then(
      (response) => resolve((response ?? { success: false, error: 'No response' }) as ExtensionResponse<T>),
      () => resolve({ success: false, error: 'Communication error' })
    );
  });
}

type TabId = 'qa' | 'flows' | 'log' | 'settings' | 'import' | 'about';

function App() {
  const { t } = useI18n();

  const tabs: Array<{ id: TabId; labelKey: Parameters<typeof t>[0] }> = [
    { id: 'qa', labelKey: 'tab_qa' },
    { id: 'flows', labelKey: 'tab_flows' },
    { id: 'log', labelKey: 'tab_log' },
    { id: 'settings', labelKey: 'tab_settings' },
    { id: 'import', labelKey: 'tab_import' },
    { id: 'about', labelKey: 'tab_about' },
  ];

  const [activeTab, setActiveTab] = useState<TabId>(() => {
    const hash = window.location.hash.replace('#', '') as TabId;
    return tabs.some((t) => t.id === hash) ? hash : 'qa';
  });
  const licenseHook = useLicense();
  const { settings, updateSettings } = useSettings(licenseHook.limits.multiPlatform, !licenseHook.loading);
  const { isConnected, healthData, checkHealth } = useBackend();

  useEffect(() => {
    window.location.hash = activeTab;
  }, [activeTab]);

  // Listen for hash changes (e.g. from upgrade buttons)
  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash.replace('#', '') as TabId;
      if (tabs.some((t) => t.id === hash) && hash !== activeTab) {
        setActiveTab(hash);
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [activeTab, tabs]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header: h-16 (64px), brand left, tabs center, status+lang right */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex items-center h-16">
            {/* Left: Brand */}
            <div className="flex items-center gap-3 w-56 flex-shrink-0">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center shadow-sm" style={{ background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)' }}>
                <svg viewBox="0 0 32 32" width="22" height="22" xmlns="http://www.w3.org/2000/svg">
                  <path d="M4 7a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3h-2l-3 3v-3H7a3 3 0 0 1-3-3V7z" fill="#fff" fillOpacity="0.4"/>
                  <path d="M11 14a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-4l-4 4v-4h-3a3 3 0 0 1-3-3v-6z" fill="#fff"/>
                  <path d="M20 14.5l-3 4.5h2.5l-1 3.5 3.5-5h-2.5l0.5-3z" fill="#2563eb"/>
                </svg>
              </div>
              <h1 className="text-lg font-bold text-gray-900">ShopReply</h1>
            </div>

            {/* Center: Tab navigation */}
            <div className="flex-1 flex justify-center">
              <div className="flex gap-1">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                      activeTab === tab.id
                        ? 'bg-blue-50 text-blue-600'
                        : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {t(tab.labelKey)}
                  </button>
                ))}
              </div>
            </div>

            {/* Right: StatusBadge (prominent) + LangSwitcher (secondary) */}
            <div className="flex items-center gap-3 w-56 flex-shrink-0 justify-end">
              <StatusBadge connected={isConnected} />
              <LangSwitcher />
            </div>
          </div>
        </div>
      </div>

      {/* Tab content — 32px top padding between header and content */}
      <div className="max-w-6xl mx-auto px-6 py-8">
        {activeTab === 'qa' && <QADatabaseTab />}
        {activeTab === 'flows' && <FlowsTab />}
        {activeTab === 'log' && <AutoReplyLogTab />}
        {activeTab === 'settings' && (
          <SettingsTab settings={settings} updateSettings={updateSettings} licenseHook={licenseHook} healthData={healthData} onRefreshHealth={checkHealth} />
        )}
        {activeTab === 'import' && <ImportTrainTab licenseHook={licenseHook} />}
        {activeTab === 'about' && <AboutTab licenseHook={licenseHook} />}
      </div>
    </div>
  );
}

// ============================================================
// Tab 1: Q&A Database
// ============================================================

function QADatabaseTab() {
  const { t, lang } = useI18n();
  const licenseHook = useLicense();
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingPair, setEditingPair] = useState<QAPair | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [qaCount, setQaCount] = useState(0);

  // Fetch QA count for limit display
  useEffect(() => {
    sendMsg<{ total_qa_pairs?: number }>({ type: 'MSG_GET_STATS', payload: {} }).then((res) => {
      if (res.success && res.data) {
        setQaCount((res.data as { total_qa_pairs?: number }).total_qa_pairs ?? 0);
      }
    });
  }, [refreshKey]);

  const handleEdit = (pair: QAPair) => {
    setEditingPair(pair);
    setShowAddModal(true);
  };

  const maxQA = licenseHook.limits.maxQA;
  const isAtLimit = maxQA !== Infinity && qaCount >= maxQA;
  const isNearLimit = maxQA !== Infinity && qaCount >= maxQA * 0.8 && !isAtLimit;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold text-gray-900">{t('qa_database')}</h2>
        </div>
        <button
          onClick={() => { setEditingPair(null); setShowAddModal(true); }}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          {t('add_qa')}
        </button>
      </div>

      {isAtLimit && (
        <div className="mb-6 px-4 py-3 bg-orange-50 border border-orange-200 rounded-xl flex items-center justify-between">
          <div>
            <p className="text-orange-800 font-semibold text-sm">
              {lang === 'vi' ? `Đã đạt giới hạn ${maxQA} cặp Q&A` : `Q&A limit reached (${maxQA} pairs)`}
            </p>
            <p className="text-orange-700 text-xs mt-1">
              {lang === 'vi' ? 'Nâng cấp để thêm câu hỏi và mở khóa tính năng.' : 'Upgrade to add more and unlock features.'}
            </p>
          </div>
          <button
            onClick={() => { window.location.hash = 'about'; }}
            className="px-3 py-1.5 bg-orange-600 text-white text-xs font-medium rounded-lg hover:bg-orange-700 transition-colors flex-shrink-0"
          >
            {lang === 'vi' ? 'Nâng cấp' : 'Upgrade'}
          </button>
        </div>
      )}

      {isNearLimit && (
        <div className="mb-6 px-4 py-3 bg-yellow-50 border border-yellow-200 rounded-xl flex items-center justify-between">
          <p className="text-yellow-800 text-sm">
            {lang === 'vi' ? `Sắp đạt giới hạn: ${qaCount}/${maxQA} cặp Q&A` : `Approaching limit: ${qaCount}/${maxQA} Q&A pairs`}
          </p>
          <button
            onClick={() => { window.location.hash = 'about'; }}
            className="px-2.5 py-1 bg-yellow-600 text-white text-[10px] font-bold rounded transition-colors flex-shrink-0"
          >
            {lang === 'vi' ? 'Nâng cấp' : 'Upgrade'}
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <QATable key={refreshKey} onEdit={handleEdit} />
      </div>

      {showAddModal && (
        <AddEditQAModal
          pair={editingPair}
          onClose={() => { setShowAddModal(false); setEditingPair(null); }}
          onSaved={() => {
            setShowAddModal(false);
            setEditingPair(null);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

function AddEditQAModal({ pair, onClose, onSaved }: {
  pair: QAPair | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, lang } = useI18n();
  const [question, setQuestion] = useState(pair?.question ?? '');
  const [answer, setAnswer] = useState(pair?.answer ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [limitReached, setLimitReached] = useState(false);

  const handleSave = async () => {
    if (!question.trim() || !answer.trim()) {
      setError(t('both_required'));
      return;
    }
    setSaving(true);
    setError('');
    setLimitReached(false);

    let result: ExtensionResponse<unknown>;
    if (pair) {
      result = await sendMsg({ type: 'MSG_UPDATE_QA', payload: { id: pair.id, question, answer } });
    } else {
      result = await sendMsg({ type: 'MSG_ADD_QA', payload: { question, answer } });
    }

    setSaving(false);
    if (result.success) {
      onSaved();
    } else {
      const errMsg = result.error ?? t('save_failed');
      if (errMsg.includes('giới hạn') || errMsg.includes('limit') || errMsg.includes('LIMIT_REACHED')) {
        setLimitReached(true);
      } else {
        setError(errMsg);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            {pair ? t('edit_qa_pair') : t('add_qa_pair')}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">
            &times;
          </button>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('question')}</label>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={3}
              placeholder="e.g., Gia ao hoodie bao nhieu?"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('answer')}</label>
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              rows={3}
              placeholder="e.g., Áo hoodie giá 350k, size S-XL ạ"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            />
          </div>
          {limitReached && (
            <div className="px-4 py-3 bg-orange-50 border border-orange-200 rounded-lg">
              <p className="text-orange-800 font-semibold text-sm mb-1">
                {lang === 'vi' ? 'Đã đạt giới hạn Q&A cho gói Free (30 cặp)' : 'Free plan Q&A limit reached (30 pairs)'}
              </p>
              <p className="text-orange-700 text-xs mb-2">
                {lang === 'vi' ? 'Nâng cấp lên Basic (500 cặp) hoặc Pro (không giới hạn) để thêm câu hỏi.' : 'Upgrade to Basic (500 pairs) or Pro (unlimited) to add more.'}
              </p>
              <button
                onClick={() => { onClose(); window.location.hash = 'about'; }}
                className="px-3 py-1.5 bg-orange-600 text-white text-xs font-medium rounded-lg hover:bg-orange-700 transition-colors"
              >
                {lang === 'vi' ? 'Xem gói nâng cấp' : 'View upgrade plans'}
              </button>
            </div>
          )}
          {error && !limitReached && (
            <div className="px-3 py-2 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            {t('cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || limitReached}
            className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? t('saving') : pair ? t('update') : t('add')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Tab: Flows (Kịch bản thu thập thông tin)
// ============================================================

function FlowsTab() {
  const { t, lang } = useI18n();
  const [flows, setFlows] = useState<FlowResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingFlow, setEditingFlow] = useState<FlowResponse | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  const fetchFlows = useCallback(async () => {
    setLoading(true);
    const res = await sendMsg<{ data: FlowResponse[] }>({ type: 'MSG_GET_FLOWS', payload: {} });
    if (res.success && res.data) {
      const data = res.data as unknown;
      // Backend wraps in { success: true, data: [...] }
      const list = Array.isArray(data) ? data : (data as { data?: FlowResponse[] }).data ?? [];
      setFlows(list);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchFlows(); }, [fetchFlows]);

  const handleToggle = async (flow: FlowResponse) => {
    await sendMsg({ type: 'MSG_TOGGLE_FLOW', payload: { id: flow.id } });
    fetchFlows();
  };

  const handleDelete = async (flow: FlowResponse) => {
    const msg = lang === 'vi' ? `Xóa kịch bản "${flow.name}"?` : `Delete flow "${flow.name}"?`;
    if (!confirm(msg)) return;
    await sendMsg({ type: 'MSG_DELETE_FLOW', payload: { id: flow.id } });
    fetchFlows();
  };

  const handleEdit = (flow: FlowResponse) => {
    setEditingFlow(flow);
    setShowEditor(true);
  };

  const handleAdd = () => {
    setEditingFlow(null);
    setShowEditor(true);
  };

  const handleSaved = () => {
    setShowEditor(false);
    setEditingFlow(null);
    fetchFlows();
  };

  const triggerLabel = (mode: string) => {
    if (mode === 'keyword') return t('trigger_keyword');
    if (mode === 'first_message') return t('trigger_first_message');
    return t('trigger_manual');
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{t('flows_title')}</h2>
          <p className="text-sm text-gray-500 mt-1">{t('flows_desc')}</p>
        </div>
        <button
          onClick={handleAdd}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          {t('add_flow')}
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">{t('loading')}</div>
      ) : flows.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <div className="text-4xl mb-3 text-gray-300">&#128196;</div>
          <h3 className="text-lg font-semibold text-gray-700 mb-1">{t('no_flows_yet')}</h3>
          <p className="text-sm text-gray-500 mb-4">{t('no_flows_desc')}</p>
          <button
            onClick={handleAdd}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            {t('add_flow')}
          </button>
        </div>
      ) : (
        <div className="space-y-3 mt-4">
          {flows.map((flow) => (
            <div key={flow.id} className="bg-white rounded-xl border border-gray-200 p-5 flex items-center gap-4">
              {/* Toggle */}
              <button
                onClick={() => handleToggle(flow)}
                className={`w-11 h-6 rounded-full relative transition-colors flex-shrink-0 ${
                  flow.is_active ? 'bg-green-500' : 'bg-gray-300'
                }`}
              >
                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  flow.is_active ? 'left-[22px]' : 'left-0.5'
                }`} />
              </button>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-gray-900 truncate">{flow.name}</h3>
                  <span className={`px-2 py-0.5 text-xs rounded-full ${
                    flow.is_active
                      ? 'bg-green-50 text-green-700'
                      : 'bg-gray-100 text-gray-500'
                  }`}>
                    {flow.is_active ? t('flow_active') : t('flow_inactive')}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                  <span>{triggerLabel(flow.trigger_mode)}</span>
                  {flow.trigger_mode === 'keyword' && flow.trigger_keywords && (
                    <span className="text-gray-400">
                      {flow.trigger_keywords.split(',').slice(0, 3).map(k => k.trim()).join(', ')}
                      {flow.trigger_keywords.split(',').length > 3 && '...'}
                    </span>
                  )}
                  <span>{flow.steps.length} {t('flow_steps_count')}</span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => handleEdit(flow)}
                  className="px-3 py-1.5 text-xs text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                >
                  {t('edit')}
                </button>
                <button
                  onClick={() => handleDelete(flow)}
                  className="px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                >
                  {t('delete')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showEditor && (
        <FlowEditorModal
          flow={editingFlow}
          onClose={() => { setShowEditor(false); setEditingFlow(null); }}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

// ---- Flow Editor Modal ----

function FlowEditorModal({ flow, onClose, onSaved }: {
  flow: FlowResponse | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, lang } = useI18n();
  const isNew = !flow;

  const [name, setName] = useState(flow?.name ?? '');
  const [triggerMode, setTriggerMode] = useState(flow?.trigger_mode ?? 'keyword');
  const [triggerKeywords, setTriggerKeywords] = useState(flow?.trigger_keywords ?? '');
  const [greetingMessage, setGreetingMessage] = useState(flow?.greeting_message ?? '');
  const [completionMessage, setCompletionMessage] = useState(flow?.completion_message ?? '');
  const [steps, setSteps] = useState<FlowStep[]>(
    flow?.steps ?? [{ id: '', label: '', prompt: '', type: 'text', required: true }]
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const updateStep = (index: number, field: keyof FlowStep, value: unknown) => {
    setSteps(prev => prev.map((s, i) => i === index ? { ...s, [field]: value } : s));
  };

  const removeStep = (index: number) => {
    if (steps.length <= 1) return;
    setSteps(prev => prev.filter((_, i) => i !== index));
  };

  const addStep = () => {
    setSteps(prev => [...prev, { id: '', label: '', prompt: '', type: 'text', required: true }]);
  };

  const handleSave = async () => {
    if (!name.trim()) { setError(t('flow_need_name')); return; }
    const validSteps = steps.filter(s => s.id.trim() && s.prompt.trim());
    if (validSteps.length === 0) { setError(t('flow_need_steps')); return; }

    setSaving(true);
    setError('');

    const payload = {
      name: name.trim(),
      trigger_mode: triggerMode,
      trigger_keywords: triggerKeywords.trim(),
      greeting_message: greetingMessage.trim(),
      steps: validSteps.map(s => ({
        ...s,
        id: s.id.trim(),
        label: s.label.trim() || s.id.trim(),
        prompt: s.prompt.trim(),
        options: s.type === 'choice' && s.options ? s.options : undefined,
      })),
      completion_message: completionMessage.trim(),
    };

    let result;
    if (isNew) {
      result = await sendMsg({ type: 'MSG_CREATE_FLOW', payload });
    } else {
      result = await sendMsg({ type: 'MSG_UPDATE_FLOW', payload: { id: flow.id, ...payload } });
    }

    setSaving(false);
    if (result.success) {
      onSaved();
    } else {
      setError(result.error ?? t('flow_save_failed'));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">
            {isNew
              ? (lang === 'vi' ? 'Tạo kịch bản mới' : 'Create New Flow')
              : (lang === 'vi' ? 'Sửa kịch bản' : 'Edit Flow')}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-5 overflow-y-auto flex-1">
          {/* Flow name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('flow_name')}</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('flow_name_placeholder')}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Trigger mode */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('trigger_mode')}</label>
            <select
              value={triggerMode}
              onChange={(e) => setTriggerMode(e.target.value as 'keyword' | 'first_message' | 'manual')}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="keyword">{t('trigger_keyword')}</option>
              <option value="first_message">{t('trigger_first_message')}</option>
              <option value="manual">{t('trigger_manual')}</option>
            </select>
          </div>

          {/* Trigger keywords (only for keyword mode) */}
          {triggerMode === 'keyword' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('trigger_keywords')}</label>
              <input
                value={triggerKeywords}
                onChange={(e) => setTriggerKeywords(e.target.value)}
                placeholder={t('trigger_keywords_placeholder')}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {/* Greeting message */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('greeting_message')}</label>
            <textarea
              value={greetingMessage}
              onChange={(e) => setGreetingMessage(e.target.value)}
              placeholder={t('greeting_placeholder')}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          {/* Steps */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700">{t('flow_steps')}</label>
              <button
                onClick={addStep}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium"
              >
                {t('add_step')}
              </button>
            </div>
            <div className="space-y-3">
              {steps.map((step, idx) => (
                <div key={idx} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-gray-500">
                      {lang === 'vi' ? `Bước ${idx + 1}` : `Step ${idx + 1}`}
                    </span>
                    {steps.length > 1 && (
                      <button
                        onClick={() => removeStep(idx)}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        {t('delete')}
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <input
                      value={step.id}
                      onChange={(e) => updateStep(idx, 'id', e.target.value.replace(/\s+/g, '_').toLowerCase())}
                      placeholder={t('step_id')}
                      className="px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <input
                      value={step.label}
                      onChange={(e) => updateStep(idx, 'label', e.target.value)}
                      placeholder={t('step_label')}
                      className="px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <input
                    value={step.prompt}
                    onChange={(e) => updateStep(idx, 'prompt', e.target.value)}
                    placeholder={t('step_prompt')}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs mb-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <div className="flex items-center gap-3">
                    <select
                      value={step.type}
                      onChange={(e) => updateStep(idx, 'type', e.target.value)}
                      className="px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="text">{t('step_type_text')}</option>
                      <option value="choice">{t('step_type_choice')}</option>
                      <option value="number">{t('step_type_number')}</option>
                    </select>
                    <label className="flex items-center gap-1 text-xs text-gray-600">
                      <input
                        type="checkbox"
                        checked={step.required}
                        onChange={(e) => updateStep(idx, 'required', e.target.checked)}
                        className="rounded"
                      />
                      {t('step_required')}
                    </label>
                  </div>
                  {step.type === 'choice' && (
                    <input
                      value={(step.options ?? []).join(', ')}
                      onChange={(e) => updateStep(idx, 'options', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                      placeholder={t('step_options_placeholder')}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs mt-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Completion message */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('completion_message')}</label>
            <textarea
              value={completionMessage}
              onChange={(e) => setCompletionMessage(e.target.value)}
              placeholder={t('completion_placeholder')}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
            <p className="text-xs text-gray-400 mt-1">{t('completion_hint')}</p>
          </div>

          {error && (
            <div className="px-3 py-2 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-200 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            {t('cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? t('saving') : t('save')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Tab 2: Auto-Reply Log
// ============================================================

function AutoReplyLogTab() {
  const { t } = useI18n();
  const [items, setItems] = useState<LogEntry[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'today' | 'week'>('today');
  const [summary, setSummary] = useState<LogResult['summary'] | null>(null);

  const fetchLog = useCallback(async () => {
    setLoading(true);
    const now = new Date();
    let dateFrom: string | undefined;
    if (filter === 'today') {
      dateFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    } else if (filter === 'week') {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      dateFrom = weekAgo.toISOString();
    }

    const result = await sendMsg<LogResult>({
      type: 'MSG_GET_LOG',
      payload: { page, per_page: 20, date_from: dateFrom },
    });
    if (result?.success && result.data) {
      setItems(result.data.items ?? []);
      setTotalPages(result.data.total_pages ?? 1);
      setTotal(result.data.total ?? 0);
      setSummary(result.data.summary ?? null);
    } else {
      setItems([]);
    }
    setLoading(false);
  }, [page, filter]);

  useEffect(() => {
    fetchLog();
  }, [fetchLog]);

  const handleReview = async (id: number, feedback: 'ok' | 'wrong' | 'edited', correctedAnswer?: string) => {
    await sendMsg({
      type: 'MSG_REVIEW_LOG',
      payload: { id, feedback, corrected_answer: correctedAnswer },
    });
    fetchLog();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">{t('auto_reply_log')}</h2>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {(['today', 'week', 'all'] as const).map((f) => (
            <button
              key={f}
              onClick={() => { setFilter(f); setPage(1); }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                filter === f ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {f === 'today' ? t('today') : f === 'week' ? t('this_week') : t('all')}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-5 gap-4 mb-6">
          <SummaryCard label={t('total')} value={summary.total_auto_replies} />
          <SummaryCard label={t('reviewed')} value={summary.reviewed} color="blue" />
          <SummaryCard label={t('ok')} value={summary.ok} color="green" />
          <SummaryCard label={t('wrong')} value={summary.wrong} color="red" />
          <SummaryCard label={t('unreviewed')} value={summary.unreviewed} color="yellow" />
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="text-center py-8 text-gray-400">{t('loading')}</div>
        ) : items.length === 0 ? (
          <div className="text-center py-8 text-gray-400">{t('no_log_entries')}</div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="py-3 px-4 text-left font-medium text-gray-500 text-xs">{t('time')}</th>
                  <th className="py-3 px-4 text-left font-medium text-gray-500 text-xs">{t('customer_question')}</th>
                  <th className="py-3 px-4 text-left font-medium text-gray-500 text-xs">{t('auto_answer')}</th>
                  <th className="py-3 px-4 text-center font-medium text-gray-500 text-xs w-24">{t('similarity')}</th>
                  <th className="py-3 px-4 text-center font-medium text-gray-500 text-xs w-20">{t('status')}</th>
                  <th className="py-3 px-4 text-right font-medium text-gray-500 text-xs w-36">{t('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((entry) => (
                  <LogRow key={entry.id} entry={entry} onReview={handleReview} />
                ))}
              </tbody>
            </table>

            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
                <div className="text-xs text-gray-500">
                  {t('page_of')} {page} {t('of')} {totalPages} ({total} {t('total')})
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {t('previous')}
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {t('next')}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, color }: {
  label: string;
  value: number;
  color?: 'blue' | 'green' | 'red' | 'yellow';
}) {
  const colorMap = {
    blue: 'text-blue-600',
    green: 'text-emerald-600',
    red: 'text-red-600',
    yellow: 'text-yellow-600',
  };
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 text-center">
      <div className={`text-2xl font-bold ${color ? colorMap[color] : 'text-gray-900'}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
}

function LogRow({ entry, onReview }: {
  entry: LogEntry;
  onReview: (id: number, feedback: 'ok' | 'wrong' | 'edited', corrected?: string) => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [corrected, setCorrected] = useState(entry.auto_answer);

  const handleEditSave = () => {
    onReview(entry.id, 'edited', corrected);
    setEditing(false);
  };

  return (
    <tr className="border-t border-gray-100 hover:bg-gray-50">
      <td className="py-2.5 px-4 text-gray-500 text-xs whitespace-nowrap">
        {new Date(entry.sent_at).toLocaleString('vi-VN', {
          hour: '2-digit',
          minute: '2-digit',
          day: '2-digit',
          month: '2-digit',
        })}
      </td>
      <td className="py-2.5 px-4 text-gray-800 max-w-[200px] truncate">{entry.customer_question}</td>
      <td className="py-2.5 px-4 text-gray-600 max-w-[250px]">
        {editing ? (
          <div className="flex gap-1">
            <input
              value={corrected}
              onChange={(e) => setCorrected(e.target.value)}
              className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              onClick={handleEditSave}
              className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              {t('save')}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50"
            >
              X
            </button>
          </div>
        ) : (
          <span className="truncate block">{entry.auto_answer}</span>
        )}
      </td>
      <td className="py-2.5 px-4 text-center">
        <span className={`text-xs font-medium ${
          entry.similarity_score >= 0.9 ? 'text-emerald-600' :
          entry.similarity_score >= 0.8 ? 'text-blue-600' : 'text-yellow-600'
        }`}>
          {Math.round(entry.similarity_score * 100)}%
        </span>
      </td>
      <td className="py-2.5 px-4 text-center">
        {entry.user_feedback ? (
          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
            entry.user_feedback === 'ok' ? 'bg-green-50 text-green-700' :
            entry.user_feedback === 'wrong' ? 'bg-red-50 text-red-700' :
            'bg-yellow-50 text-yellow-700'
          }`}>
            {entry.user_feedback}
          </span>
        ) : (
          <span className="text-xs text-gray-400">--</span>
        )}
      </td>
      <td className="py-2.5 px-4 text-right">
        {!entry.user_reviewed && (
          <div className="flex items-center justify-end gap-1">
            <button
              onClick={() => onReview(entry.id, 'ok')}
              className="px-2 py-1 text-xs text-green-700 bg-green-50 rounded hover:bg-green-100 transition-colors"
            >
              {t('ok')}
            </button>
            <button
              onClick={() => onReview(entry.id, 'wrong')}
              className="px-2 py-1 text-xs text-red-700 bg-red-50 rounded hover:bg-red-100 transition-colors"
            >
              {t('wrong')}
            </button>
            <button
              onClick={() => setEditing(true)}
              className="px-2 py-1 text-xs text-blue-700 bg-blue-50 rounded hover:bg-blue-100 transition-colors"
            >
              {t('edit')}
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

// ============================================================
// Tab 3: Settings
// ============================================================

interface SettingsTabProps {
  settings: import('@/types/storage').Settings;
  updateSettings: (partial: Partial<import('@/types/storage').Settings>) => Promise<void>;
  licenseHook: ReturnType<typeof useLicense>;
  healthData: import('@/types/messages').HealthResult | null;
  onRefreshHealth: () => Promise<unknown>;
}

function SettingsTab({ settings, updateSettings, licenseHook, healthData, onRefreshHealth }: SettingsTabProps) {
  const { t } = useI18n();
  const [backendUrl, setBackendUrl] = useState(settings.backendUrl);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [aiTesting, setAiTesting] = useState(false);
  const [backendSettings, setBackendSettings] = useState<{ ollama_model?: string; ollama_fallback_models?: string[]; ollama_url?: string } | null>(null);

  // Structured shop profile fields
  interface ShopProfile {
    shopName: string;
    industry: string;
    products: string;
    priceRange: string;
    shipping: string;
    returnPolicy: string;
    promotions: string;
    faq: string;
    extra: string;
  }
  const emptyProfile: ShopProfile = { shopName: '', industry: '', products: '', priceRange: '', shipping: '', returnPolicy: '', promotions: '', faq: '', extra: '' };
  const [shopProfile, setShopProfile] = useState<ShopProfile>(emptyProfile);
  const [profileLoaded, setProfileLoaded] = useState(false);

  const updateShopProfile = (field: keyof ShopProfile, value: string) => {
    const updated = { ...shopProfile, [field]: value };
    setShopProfile(updated);
    // Sync to backend as JSON
    const json = JSON.stringify(updated);
    browser.runtime.sendMessage({
      type: 'MSG_UPDATE_SETTINGS',
      payload: { shop_profile_json: json },
    }).catch(() => {});
  };

  // Compute profile completion percentage
  const profileFields = ['shopName', 'industry', 'products', 'priceRange', 'shipping'] as const;
  const profileCompletion = Math.round(
    (profileFields.filter((f) => shopProfile[f]?.trim()).length / profileFields.length) * 100
  );

  // Fetch backend settings (ollama model/url + shop profile) on mount
  useEffect(() => {
    browser.runtime.sendMessage({ type: 'MSG_GET_SETTINGS', payload: {} }).then((res: { success: boolean; data?: Record<string, unknown> }) => {
      if (res.success && res.data) {
        const d = res.data as { ollama_model?: string; ollama_fallback_models?: string[]; ollama_url?: string; shop_profile_json?: string };
        setBackendSettings({
          ollama_model: d.ollama_model,
          ollama_fallback_models: d.ollama_fallback_models,
          ollama_url: d.ollama_url,
        });
        // Parse shop profile JSON
        if (d.shop_profile_json) {
          try {
            const parsed = JSON.parse(d.shop_profile_json);
            setShopProfile({ ...emptyProfile, ...parsed });
          } catch { /* ignore invalid JSON */ }
        }
        setProfileLoaded(true);
      }
    }).catch(() => { setProfileLoaded(true); });
  }, []);

  const handleSaveUrl = async () => {
    setSaving(true);
    await updateSettings({ backendUrl });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleTestAI = async () => {
    setAiTesting(true);
    await onRefreshHealth();
    setAiTesting(false);
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold text-gray-900 mb-8">{t('settings')}</h2>

      {/* AI setup nudge for Basic/Pro users with empty shop info */}
      {licenseHook.license.tier !== 'free' && !settings.customTonePrompt?.trim() && (
        <div className="mb-6 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-5">
          <div className="flex items-start gap-3">
            <span className="text-2xl">🤖</span>
            <div>
              <div className="text-sm font-bold text-blue-900 mb-1">AI chưa biết gì về shop của bạn!</div>
              <p className="text-xs text-blue-700 mb-2">
                Gói {licenseHook.license.tier === 'pro' ? 'Pro' : 'Basic'} có AI tư vấn tự động. Nhưng AI cần biết shop bạn bán gì để trả lời đúng.
                Hãy điền <strong>Thông tin Shop</strong> bên dưới (mục AI) — mô tả sản phẩm, giá, size, màu sắc, chính sách giao hàng...
              </p>
              <p className="text-xs text-blue-600 italic">Càng chi tiết, AI càng tư vấn giống nhân viên thật.</p>
            </div>
          </div>
        </div>
      )}

      {/* Primary settings — what users configure most */}
      <div className="space-y-6 mb-8">
        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{t('platforms')} & {t('auto_reply')}</div>

        {/* Platform toggles */}
        <SettingsSection title={t('platforms')}>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-gray-900">Facebook Messenger</div>
                <div className="text-xs text-gray-500 mt-0.5">facebook.com/messages</div>
              </div>
              <ToggleSwitch
                enabled={settings.facebookEnabled}
                onChange={(v) => {
                  if (licenseHook.limits.multiPlatform) {
                    updateSettings({ facebookEnabled: v });
                  } else {
                    if (v) {
                      updateSettings({ facebookEnabled: true, zaloEnabled: false });
                    } else if (settings.zaloEnabled) {
                      updateSettings({ facebookEnabled: false });
                    }
                  }
                }}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-gray-900">Zalo</div>
                <div className="text-xs text-gray-500 mt-0.5">chat.zalo.me</div>
              </div>
              <ToggleSwitch
                enabled={settings.zaloEnabled}
                onChange={(v) => {
                  if (licenseHook.limits.multiPlatform) {
                    updateSettings({ zaloEnabled: v });
                  } else {
                    if (v) {
                      updateSettings({ zaloEnabled: true, facebookEnabled: false });
                    } else if (settings.facebookEnabled) {
                      updateSettings({ zaloEnabled: false });
                    }
                  }
                }}
              />
            </div>
            {!licenseHook.limits.multiPlatform && settings.facebookEnabled && settings.zaloEnabled && (
              <TierBadge tier="pro" label="FB + Zalo" desc={t('multi_platform_pro')} />
            )}
          </div>
        </SettingsSection>

        {/* Auto-reply toggle */}
        <SettingsSection title={t('auto_reply')}>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-gray-900">{t('enable_auto_reply')}</div>
              <div className="text-xs text-gray-500 mt-0.5">{t('auto_reply_desc')}</div>
            </div>
            {licenseHook.limits.autoReply ? (
              <ToggleSwitch
                enabled={settings.autoReplyEnabled}
                onChange={(v) => updateSettings({ autoReplyEnabled: v })}
              />
            ) : (
              <ToggleSwitch enabled={false} onChange={() => {}} />
            )}
          </div>
          {!licenseHook.limits.autoReply && (
            <TierBadge tier="pro" label={t('auto_reply')} desc={t('auto_reply_pro')} />
          )}
        </SettingsSection>
      </div>

      {/* Auto-Reply Mode (Pro only) */}
      <div className="space-y-6 mb-8">
        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Chế độ tự động</div>

        <SettingsSection title="Chế độ trả lời tự động">
          {licenseHook.license.tier !== 'pro' ? (
            <div className="space-y-3">
              <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg text-center">
                <div className="text-sm text-gray-500 mb-2">Chế độ tự động chỉ khả dụng cho gói Pro</div>
                <div className="text-xs text-gray-400 mb-3">Gói {licenseHook.license.tier === 'free' ? 'Free' : 'Basic'} chỉ hiển thị gợi ý — cần xác nhận thủ công tất cả câu trả lời.</div>
                <button
                  onClick={() => {
                    window.location.hash = 'about';
                    setTimeout(() => window.dispatchEvent(new CustomEvent('buy-plan', { detail: 'pro' })), 150);
                  }}
                  className="px-4 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Nâng cấp lên Pro
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {([
                  { value: 'manual', label: 'Thủ công', desc: 'Luôn hiển gợi ý, chờ xác nhận tất cả. Phù hợp khi mới bắt đầu.' },
                  { value: 'semi', label: 'Bán tự động', desc: 'Tự động gửi khi DB match >= ngưỡng. AI chỉ gợi ý, chờ xác nhận. Cân bằng tốt nhất.' },
                  { value: 'full', label: 'Tự động hoàn toàn', desc: 'Tự động gửi cả DB match và AI. Yêu cầu đã điền thông tin shop đầy đủ.' },
                ] as const).map((mode) => (
                  <label
                    key={mode.value}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                      settings.autoReplyMode === mode.value
                        ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-200'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="autoReplyMode"
                      value={mode.value}
                      checked={settings.autoReplyMode === mode.value}
                      onChange={() => updateSettings({ autoReplyMode: mode.value })}
                      className="mt-0.5 accent-blue-600"
                    />
                    <div>
                      <div className="text-sm font-medium text-gray-900">{mode.label}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{mode.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
              {settings.autoReplyMode === 'full' && !settings.customTonePrompt && (
                <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                  <strong>Lưu ý:</strong> Chế độ tự động hoàn toàn cần bạn điền thông tin shop ở mục "Thông tin Shop" bên dưới để AI trả lời chính xác.
                </div>
              )}
            </>
          )}
        </SettingsSection>
      </div>

      {/* Fine-tuning settings */}
      <div className="space-y-6 mb-8">
        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{t('reply_thresholds')} & {t('reply_tone')}</div>

        {/* Thresholds */}
        <SettingsSection title={t('reply_thresholds')}>
          <div className="space-y-6">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-gray-700">{t('auto_reply_threshold')}</label>
                <span className="text-sm font-mono font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">{settings.autoReplyThreshold.toFixed(2)}</span>
              </div>
              <div className="max-w-md">
                <input
                  type="range"
                  min="0.50"
                  max="0.95"
                  step="0.05"
                  value={settings.autoReplyThreshold}
                  onChange={(e) => updateSettings({ autoReplyThreshold: parseFloat(e.target.value) })}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
                <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                  <span>0.50 ({t('more_auto')})</span>
                  <span>0.95 ({t('stricter')})</span>
                </div>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-gray-700">{t('suggest_threshold')}</label>
                <span className="text-sm font-mono font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">{settings.suggestThreshold.toFixed(2)}</span>
              </div>
              <div className="max-w-md">
                <input
                  type="range"
                  min="0.30"
                  max="0.80"
                  step="0.05"
                  value={settings.suggestThreshold}
                  onChange={(e) => updateSettings({ suggestThreshold: parseFloat(e.target.value) })}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
                <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                  <span>0.30 ({t('more_suggestions')})</span>
                  <span>0.80 ({t('fewer')})</span>
                </div>
              </div>
            </div>
          </div>
        </SettingsSection>

        {/* Tone */}
        <SettingsSection title={t('reply_tone')}>
          <div className="max-w-md">
            <select
              value={settings.tone}
              onChange={(e) => updateSettings({ tone: e.target.value as 'friendly' | 'professional' | 'casual' | 'custom' })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="friendly">{t('friendly')}</option>
              <option value="professional">{t('professional')}</option>
              <option value="casual">{t('casual')}</option>
              {licenseHook.limits.customTone && <option value="custom">{t('custom_tone_label')}</option>}
            </select>
          </div>
          {!licenseHook.limits.customTone && (
            <TierBadge tier="pro" label={t('custom_tone_label')} desc={t('upgrade_to_unlock')} />
          )}
          {settings.tone === 'custom' && licenseHook.limits.customTone && (
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('custom_tone_label')}</label>
              <textarea
                value={settings.customTonePrompt ?? ''}
                onChange={(e) => updateSettings({ customTonePrompt: e.target.value })}
                rows={3}
                placeholder={t('custom_tone_placeholder')}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              />
              <p className="text-xs text-gray-500 mt-1">{t('custom_tone_desc')}</p>
            </div>
          )}
        </SettingsSection>
      </div>

      {/* AI / Ollama settings */}
      <div className="space-y-6 mb-8">
        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">AI (Ollama)</div>

        <SettingsSection title="AI Status">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-gray-900">Ollama</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {backendSettings?.ollama_url || 'http://localhost:11434'}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${
                  healthData?.ollama === 'connected'
                    ? 'bg-green-50 text-green-700'
                    : 'bg-red-50 text-red-700'
                }`}>
                  <span className={`w-2 h-2 rounded-full ${
                    healthData?.ollama === 'connected' ? 'bg-green-500' : 'bg-red-500'
                  }`} />
                  {healthData?.ollama === 'connected' ? 'Connected' : 'Disconnected'}
                </span>
                <button
                  onClick={handleTestAI}
                  disabled={aiTesting}
                  className="text-xs px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 disabled:opacity-50 font-medium"
                >
                  {aiTesting ? 'Testing...' : 'Test'}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-gray-900">Model</div>
                <div className="text-xs text-gray-500 mt-0.5">Model AI dùng để gợi ý trả lời</div>
              </div>
              <span className="text-sm font-mono font-semibold text-purple-600 bg-purple-50 px-2.5 py-1 rounded">
                {backendSettings?.ollama_model || 'gemma3:4b'}
              </span>
            </div>

            {backendSettings?.ollama_fallback_models && backendSettings.ollama_fallback_models.length > 0 && (
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-gray-900">Fallback Models</div>
                  <div className="text-xs text-gray-500 mt-0.5">Model dự phòng khi model chính lỗi</div>
                </div>
                <div className="flex gap-1.5 flex-wrap justify-end">
                  {backendSettings.ollama_fallback_models.map((m) => (
                    <span key={m} className="text-xs font-mono text-orange-600 bg-orange-50 px-2 py-0.5 rounded">
                      {m}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {healthData?.ollama !== 'connected' && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <div className="text-xs text-amber-800">
                  <strong>Ollama chưa kết nối.</strong> Đảm bảo Ollama đang chạy:
                  <ol className="list-decimal ml-4 mt-1 space-y-0.5">
                    <li>Tải Ollama tại <span className="font-mono">ollama.com</span></li>
                    <li>Mở terminal, chạy: <code className="bg-amber-100 px-1 rounded">ollama pull gemma3:4b</code></li>
                    <li>Ollama tự chạy nền — bấm <strong>Test</strong> để kiểm tra</li>
                  </ol>
                </div>
              </div>
            )}
          </div>
        </SettingsSection>

        <SettingsSection title="Thông tin Shop (AI Context)">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500">
                AI đọc thông tin này mỗi khi trả lời khách. Càng chi tiết, AI càng tư vấn chính xác từ ngày đầu.
              </p>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
                profileCompletion >= 80 ? 'bg-green-100 text-green-700' :
                profileCompletion >= 40 ? 'bg-yellow-100 text-yellow-700' :
                'bg-red-100 text-red-700'
              }`}>
                {profileCompletion}% hoàn thành
              </span>
            </div>

            {/* Progress bar */}
            <div className="w-full bg-gray-200 rounded-full h-1.5">
              <div
                className={`h-1.5 rounded-full transition-all ${
                  profileCompletion >= 80 ? 'bg-green-500' :
                  profileCompletion >= 40 ? 'bg-yellow-500' :
                  'bg-red-400'
                }`}
                style={{ width: `${profileCompletion}%` }}
              />
            </div>

            {/* Structured fields */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Tên shop *</label>
                <input
                  type="text"
                  value={shopProfile.shopName}
                  onChange={(e) => updateShopProfile('shopName', e.target.value)}
                  placeholder="VD: Minh Shoes"
                  className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Ngành hàng *</label>
                <input
                  type="text"
                  value={shopProfile.industry}
                  onChange={(e) => updateShopProfile('industry', e.target.value)}
                  placeholder="VD: Giày dép nam nữ"
                  className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Sản phẩm chính * <span className="text-gray-400 font-normal">(liệt kê tên, màu, size, chất liệu)</span></label>
              <textarea
                value={shopProfile.products}
                onChange={(e) => updateShopProfile('products', e.target.value)}
                rows={3}
                placeholder={"VD:\n- Sneaker: đen/trắng/xám, size 36-44, đế cao su\n- Sandal: nâu/đen, size 36-42, quai da\n- Dép quai ngang: nhiều màu, size 35-43"}
                className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Giá * <span className="text-gray-400 font-normal">(theo từng loại)</span></label>
              <textarea
                value={shopProfile.priceRange}
                onChange={(e) => updateShopProfile('priceRange', e.target.value)}
                rows={2}
                placeholder={"VD: Sneaker 300k-600k, sandal 150k-300k, giày da 400k-800k"}
                className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Giao hàng *</label>
              <input
                type="text"
                value={shopProfile.shipping}
                onChange={(e) => updateShopProfile('shipping', e.target.value)}
                placeholder="VD: Toàn quốc, COD, freeship đơn từ 500k"
                className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Đổi trả / Bảo hành</label>
              <input
                type="text"
                value={shopProfile.returnPolicy}
                onChange={(e) => updateShopProfile('returnPolicy', e.target.value)}
                placeholder="VD: Đổi trả trong 7 ngày nếu lỗi sản phẩm"
                className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Khuyến mãi hiện tại</label>
              <input
                type="text"
                value={shopProfile.promotions}
                onChange={(e) => updateShopProfile('promotions', e.target.value)}
                placeholder="VD: Giảm 20% sneaker đến hết 30/3"
                className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">FAQ thường gặp <span className="text-gray-400 font-normal">(câu hỏi khách hay hỏi + câu trả lời)</span></label>
              <textarea
                value={shopProfile.faq}
                onChange={(e) => updateShopProfile('faq', e.target.value)}
                rows={4}
                placeholder={"VD:\nH: Có bán sỉ không?\nA: Dạ có ạ. Từ 10 đôi trở lên được giá sỉ nha anh/chị.\n\nH: Bao lâu nhận được hàng?\nA: Nội thành 1-2 ngày, tỉnh 3-5 ngày ạ."}
                className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Ghi chú thêm</label>
              <textarea
                value={shopProfile.extra}
                onChange={(e) => updateShopProfile('extra', e.target.value)}
                rows={2}
                placeholder="Bất kỳ thông tin nào khác AI cần biết..."
                className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
              />
            </div>

            {/* Generate sample Q&A button */}
            {profileCompletion >= 60 && (
              <button
                onClick={async () => {
                  try {
                    const res = await browser.runtime.sendMessage({
                      type: 'MSG_BACKEND_REQUEST',
                      payload: { method: 'POST', path: '/api/generate-sample-qa' },
                    }) as { success: boolean; data?: { generated: number; total: number; message: string }; error?: string };
                    if (res.success && res.data) {
                      alert(res.data.message);
                    } else {
                      alert(res.error || 'Lỗi tạo Q&A mẫu');
                    }
                  } catch (e) {
                    alert('Không thể kết nối backend');
                  }
                }}
                className="w-full py-2 px-4 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg text-sm font-medium hover:bg-blue-100 transition-colors"
              >
                Tạo Q&A mẫu từ thông tin shop
                <span className="block text-[10px] font-normal text-blue-500 mt-0.5">
                  Tự động tạo câu hỏi-trả lời phổ biến để AI trả lời chính xác ngay từ đầu
                </span>
              </button>
            )}

            {/* Keep legacy textarea for backward compat */}
            <details className="text-xs">
              <summary className="text-gray-400 cursor-pointer hover:text-gray-600">Mô tả tự do (nâng cao)</summary>
              <textarea
                value={settings.customTonePrompt ?? ''}
                onChange={(e) => updateSettings({ customTonePrompt: e.target.value })}
                rows={4}
                placeholder="Thông tin bổ sung dạng văn bản tự do..."
                className="w-full mt-2 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
              />
            </details>
          </div>
        </SettingsSection>
      </div>

      {/* Other settings */}
      <div className="space-y-6">
        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{t('notifications')}</div>

        {/* Notifications */}
        <SettingsSection title={t('notifications')}>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-gray-900">{t('browser_notifications')}</div>
              <div className="text-xs text-gray-500 mt-0.5">{t('notify_desc')}</div>
            </div>
            <ToggleSwitch
              enabled={settings.notificationsEnabled}
              onChange={(v) => updateSettings({ notificationsEnabled: v })}
            />
          </div>
        </SettingsSection>
      </div>
    </div>
  );
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h3 className="text-sm font-semibold text-gray-900 mb-4">{title}</h3>
      {children}
    </div>
  );
}

function TierBadge({ tier, label, desc }: { tier: 'basic' | 'pro'; label: string; desc: string }) {
  const { lang } = useI18n();
  return (
    <div className={`mt-3 flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-xs ${
      tier === 'pro' ? 'bg-purple-50 text-purple-700 border border-purple-200' :
      'bg-blue-50 text-blue-700 border border-blue-200'
    }`}>
      <div className="flex items-center gap-2">
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
          tier === 'pro' ? 'bg-purple-200' : 'bg-blue-200'
        }`}>
          {tier.toUpperCase()}
        </span>
        <span>{desc}</span>
      </div>
      <button
        onClick={() => { window.location.hash = 'about'; }}
        className={`px-2.5 py-1 rounded text-[10px] font-bold text-white transition-colors ${
          tier === 'pro' ? 'bg-purple-600 hover:bg-purple-700' : 'bg-blue-600 hover:bg-blue-700'
        }`}
      >
        {lang === 'vi' ? 'Nâng cấp' : 'Upgrade'}
      </button>
    </div>
  );
}

function ToggleSwitch({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
        enabled ? 'bg-blue-600' : 'bg-gray-300'
      }`}
    >
      <span
        className={`absolute top-[3px] w-[18px] h-[18px] bg-white rounded-full shadow-sm transition-transform ${
          enabled ? 'left-[23px]' : 'left-[3px]'
        }`}
      />
    </button>
  );
}

// ============================================================
// Template Import
// ============================================================

const TEMPLATES = [
  {
    id: 'chao-hoi',
    icon: '👋',
    vi: 'Chào hỏi & Giới thiệu',
    en: 'Greetings & Info',
    descVi: '10 cặp Q&A: lời chào, giới thiệu shop, giờ làm việc, liên hệ...',
    descEn: '10 Q&A pairs: greetings, shop info, hours, contact...',
    data: [
      { question: 'Xin chào', answer: 'Chào bạn! Cảm ơn bạn đã nhắn tin cho shop. Em có thể giúp gì cho bạn ạ?' },
      { question: 'Hi', answer: 'Hi bạn! Shop có thể giúp gì cho bạn ạ?' },
      { question: 'Alo', answer: 'Dạ em đây, bạn cần tư vấn gì ạ?' },
      { question: 'Có ai không?', answer: 'Dạ có ạ! Em đang online, bạn cần hỏi gì cứ nhắn nhé' },
      { question: 'Shop ở đâu?', answer: 'Dạ bạn có thể xem địa chỉ shop trên trang cá nhân ạ. Bạn mua online shop ship toàn quốc nhé' },
      { question: 'Giờ làm việc?', answer: 'Shop hoạt động từ 8h-22h hàng ngày ạ. Ngoài giờ bạn cứ nhắn, em sẽ trả lời sớm nhất' },
      { question: 'Liên hệ thế nào?', answer: 'Bạn nhắn trực tiếp qua đây hoặc gọi hotline trên trang shop ạ' },
      { question: 'Shop bán gì?', answer: 'Dạ bạn xem sản phẩm trên trang shop nhé, hoặc cho em biết bạn cần gì để em tư vấn ạ' },
      { question: 'Cảm ơn', answer: 'Dạ không có gì ạ! Bạn cần gì cứ nhắn cho shop nhé 😊' },
      { question: 'Tạm biệt', answer: 'Cảm ơn bạn đã ghé shop! Hẹn gặp lại bạn nhé 😊' },
    ],
  },
  {
    id: 'mua-hang',
    icon: '🛒',
    vi: 'Mua hàng & Thanh toán',
    en: 'Orders & Payment',
    descVi: '12 cặp Q&A: đặt hàng, giá, ship, COD, freeship, giảm giá...',
    descEn: '12 Q&A pairs: ordering, price, shipping, COD, freeship, discount...',
    data: [
      { question: 'Giá bao nhiêu?', answer: 'Dạ bạn cho em biết sản phẩm nào để em báo giá chính xác ạ' },
      { question: 'Đặt hàng thế nào?', answer: 'Bạn gửi em: Tên + SĐT + Địa chỉ + Sản phẩm là em đặt luôn ạ' },
      { question: 'Ship bao lâu?', answer: 'Ship nội thành 1-2 ngày, ngoại thành 3-5 ngày ạ' },
      { question: 'Phí ship bao nhiêu?', answer: 'Dạ tùy khoảng cách ạ. Bạn gửi địa chỉ để em tính chính xác nhé' },
      { question: 'Có freeship không?', answer: 'Dạ freeship cho đơn từ 300k nhé bạn' },
      { question: 'Có COD không?', answer: 'Có COD nhé bạn, nhận hàng rồi trả tiền ạ' },
      { question: 'Thanh toán bằng gì?', answer: 'Shop nhận chuyển khoản ngân hàng và COD ạ' },
      { question: 'Còn hàng không?', answer: 'Dạ bạn cho em biết sản phẩm nào để em kiểm tra ạ' },
      { question: 'Có giảm giá không?', answer: 'Dạ hiện tại shop đang có chương trình khuyến mãi. Bạn xem chi tiết trên trang shop nhé' },
      { question: 'Mua nhiều có giảm không?', answer: 'Dạ mua số lượng lớn shop có giá tốt ạ. Bạn cho em biết số lượng để em báo giá nhé' },
      { question: 'Đơn hàng tới đâu rồi?', answer: 'Dạ bạn cho em mã đơn hoặc SĐT để em kiểm tra trạng thái đơn hàng ạ' },
      { question: 'Hủy đơn được không?', answer: 'Dạ nếu đơn chưa gửi thì hủy được ạ. Bạn cho em mã đơn để em kiểm tra nhé' },
    ],
  },
  {
    id: 'khieu-nai',
    icon: '🛡️',
    vi: 'Khiếu nại & Hỗ trợ',
    en: 'Complaints & Support',
    descVi: '10 cặp Q&A: đổi trả, lỗi sản phẩm, giao sai, hoàn tiền...',
    descEn: '10 Q&A pairs: returns, defects, wrong item, refund...',
    data: [
      { question: 'Đổi trả thế nào?', answer: 'Shop hỗ trợ đổi trả trong 7 ngày nếu sản phẩm lỗi hoặc không đúng mô tả ạ' },
      { question: 'Hàng bị lỗi', answer: 'Dạ bạn chụp ảnh sản phẩm lỗi gửi em nhé, shop sẽ đổi mới hoặc hoàn tiền cho bạn ạ' },
      { question: 'Giao sai hàng', answer: 'Dạ xin lỗi bạn! Bạn chụp ảnh sản phẩm nhận được gửi em, shop sẽ gửi lại đúng hàng ngay ạ' },
      { question: 'Hàng bị vỡ/hỏng', answer: 'Dạ bạn chụp ảnh tình trạng hàng và kiện hàng gửi em nhé, shop sẽ xử lý ngay ạ' },
      { question: 'Hoàn tiền thế nào?', answer: 'Dạ sau khi xác nhận, shop sẽ hoàn tiền qua chuyển khoản trong 1-3 ngày làm việc ạ' },
      { question: 'Chưa nhận được hàng', answer: 'Dạ bạn cho em mã đơn hoặc SĐT để em kiểm tra với bên vận chuyển nhé' },
      { question: 'Giao chậm quá', answer: 'Dạ xin lỗi bạn! Em kiểm tra ngay trạng thái đơn hàng. Bạn cho em mã đơn nhé' },
      { question: 'Muốn khiếu nại', answer: 'Dạ bạn mô tả vấn đề gặp phải, em sẽ chuyển lên bộ phận xử lý ngay ạ' },
      { question: 'Không liên lạc được', answer: 'Dạ xin lỗi bạn vì bất tiện! Em đang hỗ trợ bạn ngay đây ạ. Bạn cần giúp gì nhé?' },
      { question: 'Hàng không giống ảnh', answer: 'Dạ bạn chụp ảnh thực tế gửi em nhé, shop sẽ kiểm tra và hỗ trợ đổi trả nếu đúng ạ' },
    ],
  },
];

function TemplateImportSection() {
  const { t, lang } = useI18n();
  const [importing, setImporting] = useState<string | null>(null);
  const [imported, setImported] = useState<Set<string>>(new Set());
  const [limitError, setLimitError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const handleImport = useCallback(async (template: typeof TEMPLATES[0]) => {
    setImporting(template.id);
    setLimitError(null);
    try {
      const result = await sendMsg<{ imported: number }>({
        type: 'MSG_IMPORT_QA',
        payload: { pairs: template.data },
      });
      if (result.success) {
        setImported(prev => new Set(prev).add(template.id));
        setExpanded(template.id);
      } else {
        const err = result.error ?? '';
        if (err.includes('giới hạn') || err.includes('limit') || err.includes('LIMIT')) {
          setLimitError(err);
        }
      }
    } finally {
      setImporting(null);
    }
  }, []);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h3 className="text-sm font-semibold text-gray-900 mb-1">
        {lang === 'vi' ? '📦 Bộ mẫu theo chủ đề — Import 1 click' : '📦 Topic Templates — 1 click import'}
      </h3>
      <p className="text-sm text-gray-500 mb-4">
        {lang === 'vi'
          ? 'Chọn chủ đề, import bộ câu hỏi-trả lời mẫu. Sau đó chỉnh sửa cho phù hợp với shop.'
          : 'Select a topic, import sample Q&A pairs. Then customize to fit your shop.'}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {TEMPLATES.map((tpl) => {
          const isDone = imported.has(tpl.id);
          const isLoading = importing === tpl.id;
          const isExpanded = expanded === tpl.id;
          return (
            <div key={tpl.id} className={`border rounded-xl p-4 transition-colors ${isDone ? 'border-green-300 bg-green-50' : 'border-gray-200 hover:border-blue-300'}`}>
              <div className="text-2xl mb-2">{tpl.icon}</div>
              <h4 className="font-semibold text-gray-900 text-sm">{lang === 'vi' ? tpl.vi : tpl.en}</h4>
              <p className="text-xs text-gray-500 mt-1 mb-3">{lang === 'vi' ? tpl.descVi : tpl.descEn}</p>
              {isDone && (
                <div className="mb-3 px-2 py-1.5 bg-green-100 border border-green-200 rounded-lg text-center">
                  <span className="text-green-700 text-xs font-semibold">
                    ✓ {lang === 'vi' ? `Đã import ${tpl.data.length} cặp Q&A` : `Imported ${tpl.data.length} Q&A pairs`}
                  </span>
                </div>
              )}
              <button
                onClick={() => isDone ? setExpanded(isExpanded ? null : tpl.id) : handleImport(tpl)}
                disabled={isLoading || !!limitError}
                className={`w-full py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  isDone
                    ? 'bg-green-600 text-white hover:bg-green-700 cursor-pointer'
                    : isLoading
                    ? 'bg-gray-100 text-gray-400 cursor-wait'
                    : limitError
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {isDone
                  ? (isExpanded
                    ? (lang === 'vi' ? '▲ Ẩn danh sách' : '▲ Hide list')
                    : (lang === 'vi' ? '▼ Xem danh sách Q&A' : '▼ View Q&A list'))
                  : isLoading ? (lang === 'vi' ? 'Đang import...' : 'Importing...') : (lang === 'vi' ? 'Import bộ mẫu' : 'Import template')}
              </button>
              {isExpanded && (
                <div className="mt-3 max-h-48 overflow-y-auto border border-green-200 rounded-lg divide-y divide-green-100">
                  {tpl.data.map((pair, i) => (
                    <div key={i} className="px-3 py-2 text-xs">
                      <div className="font-medium text-gray-800">Q: {pair.question}</div>
                      <div className="text-gray-500 mt-0.5">A: {pair.answer}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {limitError && (
        <div className="mt-4 px-4 py-3 bg-orange-50 border border-orange-200 rounded-lg">
          <p className="text-orange-800 font-semibold text-sm mb-1">
            {lang === 'vi' ? 'Đã đạt giới hạn Q&A cho gói Free (30 cặp)' : 'Free plan Q&A limit reached (30 pairs)'}
          </p>
          <p className="text-orange-700 text-xs mb-2">
            {lang === 'vi' ? 'Nâng cấp lên Basic (500 cặp) hoặc Pro (không giới hạn) để import thêm.' : 'Upgrade to Basic (500 pairs) or Pro (unlimited) to import more.'}
          </p>
          <button
            onClick={() => { window.location.hash = 'about'; }}
            className="px-3 py-1.5 bg-orange-600 text-white text-xs font-medium rounded-lg hover:bg-orange-700 transition-colors"
          >
            {lang === 'vi' ? 'Xem gói nâng cấp' : 'View upgrade plans'}
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Tab 4: Import & Train
// ============================================================

function ImportTrainTab({ licenseHook }: { licenseHook: ReturnType<typeof useLicense> }) {
  const { t } = useI18n();
  const [showImportModal, setShowImportModal] = useState(false);

  return (
    <div className="max-w-3xl mx-auto">
      <h2 className="text-2xl font-bold text-gray-900 mb-8">{t('import_train')}</h2>

      <div className="space-y-6">
        {/* Template section */}
        <TemplateImportSection />

        {/* Import from file / paste */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">{t('import_from_file')}</h3>
          <p className="text-sm text-gray-500 mb-4">{t('import_file_desc')}</p>
          <button
            onClick={() => setShowImportModal(true)}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            {t('import_qa')}
          </button>
        </div>

        {/* Format guide */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">{t('supported_formats')}</h3>
          <div className="space-y-4 text-sm">
            <div>
              <span className="font-medium text-gray-700">CSV:</span>
              <pre className="mt-1 bg-gray-50 rounded-lg p-3 text-xs text-gray-600 overflow-x-auto">
{`question,answer
"Giá áo hoodie?","Áo hoodie giá 350k, size S-XL ạ"
"Ship bao lâu?","Ship nội thành 1-2 ngày ạ"`}
              </pre>
            </div>
            <div>
              <span className="font-medium text-gray-700">JSON:</span>
              <pre className="mt-1 bg-gray-50 rounded-lg p-3 text-xs text-gray-600 overflow-x-auto">
{`[
  {"question": "Giá hoodie?", "answer": "350k ạ"},
  {"question": "Ship bao lâu?", "answer": "1-2 ngày ạ"}
]`}
              </pre>
            </div>
            <div>
              <span className="font-medium text-gray-700">{t('pipe_separated')}</span>
              <pre className="mt-1 bg-gray-50 rounded-lg p-3 text-xs text-gray-600 overflow-x-auto">
{`Giá hoodie? | Áo hoodie giá 350k ạ
Ship bao lâu? | Ship nội thành 1-2 ngày ạ`}
              </pre>
            </div>
          </div>
        </div>
      </div>

      <ImportModal
        open={showImportModal}
        onClose={() => setShowImportModal(false)}
        onImported={() => {}}
      />
    </div>
  );
}

// ============================================================
// Tab 5: About + Pricing
// ============================================================

function AboutTab({ licenseHook }: { licenseHook: ReturnType<typeof useLicense> }) {
  const { t } = useI18n();
  const { license, activate, deactivate } = licenseHook;
  const [keyInput, setKeyInput] = useState('');
  const [activating, setActivating] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [buyTarget, setBuyTarget] = useState<'basic' | 'pro' | null>(null);
  const [showDonate, setShowDonate] = useState(false);

  // Listen for buy-plan events from other tabs (e.g. Settings "Nâng cấp lên Pro")
  useEffect(() => {
    const handler = (e: Event) => {
      const plan = (e as CustomEvent).detail;
      if (plan === 'basic' || plan === 'pro') setBuyTarget(plan);
    };
    window.addEventListener('buy-plan', handler);
    return () => window.removeEventListener('buy-plan', handler);
  }, []);

  const handleActivate = async () => {
    if (!keyInput.trim()) return;
    setActivating(true);
    setMessage(null);
    const result = await activate(keyInput);
    setActivating(false);
    if (result.success) {
      setMessage({ type: 'success', text: t('license_activated') });
      setKeyInput('');
    } else {
      setMessage({ type: 'error', text: t(result.error as Parameters<typeof t>[0]) });
    }
  };

  const handleDeactivate = async () => {
    await deactivate();
    setMessage(null);
  };

  const handleReportIssue = () => {
    const subject = encodeURIComponent('ShopReply - Bug Report');
    const body = encodeURIComponent(
      `ShopReply version: 1.1.0\n` +
      `Browser: ${navigator.userAgent}\n` +
      `Date: ${new Date().toISOString()}\n\n` +
      `Describe the issue:\n\n`
    );
    window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=nhamingroup@gmail.com&su=${subject}&body=${body}`, '_blank');
  };

  const tierColors = { free: 'gray', basic: 'blue', pro: 'purple' } as const;
  const tierColor = tierColors[license.tier];

  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold text-gray-900 mb-8">{t('about_shopreply')}</h2>

      <div className="space-y-8">
        {/* Current plan banner + CTA */}
        <div className={`rounded-xl border-2 p-6 ${
          license.tier === 'pro' ? 'bg-purple-50 border-purple-300' :
          license.tier === 'basic' ? 'bg-blue-50 border-blue-300' :
          'bg-gray-50 border-gray-200'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white text-xl font-bold ${
                license.tier === 'pro' ? 'bg-purple-600' :
                license.tier === 'basic' ? 'bg-blue-600' : 'bg-gray-500'
              }`}>
                {license.tier === 'pro' ? 'P' : license.tier === 'basic' ? 'B' : 'F'}
              </div>
              <div>
                <div className="text-xs text-gray-500 uppercase tracking-wider">{t('current_plan')}</div>
                <div className="text-xl font-bold text-gray-900">
                  {license.tier === 'pro' ? t('pro_plan') :
                   license.tier === 'basic' ? t('basic_plan') : t('free_plan')}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {license.expiresAt && (
                <div className="text-sm text-gray-500">
                  {t('active_until')} {new Date(license.expiresAt).toLocaleDateString('vi-VN')}
                </div>
              )}
              {license.tier !== 'pro' && (
                <button
                  onClick={() => {
                    document.getElementById('pricing-table')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className={`px-5 py-2.5 text-sm font-bold text-white rounded-lg transition-colors ${
                    license.tier === 'free' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-purple-600 hover:bg-purple-700'
                  }`}
                >
                  {t('buy_license')}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* License key input — moved up for prominence */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">{t('license_key')}</h3>
          <p className="text-sm text-gray-500 mb-4">{t('license_desc')}</p>

          {license.activated ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 px-3 py-2.5 bg-green-50 border border-green-200 rounded-lg">
                <span className="text-green-600 text-lg">✓</span>
                <span className="text-sm font-mono text-green-800">{license.key}</span>
                <span className={`ml-auto px-2 py-0.5 rounded-full text-xs font-bold ${
                  license.tier === 'pro' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                }`}>
                  {license.tier.toUpperCase()}
                </span>
              </div>
              <button
                onClick={handleDeactivate}
                className="px-4 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
              >
                {t('deactivate')}
              </button>
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value.toUpperCase())}
                  placeholder="SHOP-XXXX-XXXX-XXXX"
                  className="flex-1 px-3 py-2.5 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <button
                  onClick={handleActivate}
                  disabled={activating || !keyInput.trim()}
                  className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {activating ? t('loading') : t('activate')}
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-2">{t('free_tier')}</p>
            </>
          )}

          {message && (
            <div className={`mt-3 px-3 py-2 rounded-lg text-sm ${
              message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
            }`}>
              {message.text}
            </div>
          )}

          {message?.type === 'success' && license.tier !== 'free' && (
            <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="text-sm font-semibold text-blue-900 mb-2">Bước tiếp theo: Thiết lập AI cho shop</div>
              <p className="text-xs text-blue-700 mb-3">
                Gói {license.tier === 'pro' ? 'Pro' : 'Basic'} bao gồm AI tư vấn tự động.
                Để AI trả lời chính xác, hãy mô tả shop của bạn trong mục <strong>Thông tin Shop</strong> tại trang Settings.
              </p>
              <p className="text-xs text-blue-600 mb-3">
                Càng nhiều thông tin (sản phẩm, giá cả, chính sách, size, màu sắc...) thì AI càng tư vấn tốt hơn.
              </p>
              <button
                onClick={() => { window.location.hash = 'settings'; }}
                className="px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 transition-colors"
              >
                Mở Settings &rarr; Điền thông tin Shop
              </button>
            </div>
          )}
        </div>

        {/* Pricing comparison table */}
        <div id="pricing-table" className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-sm font-semibold text-gray-900">{t('pricing_plans')}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50">
                  <th className="py-3 px-4 text-left font-medium text-gray-500 w-48"></th>
                  <th className={`py-3 px-4 text-center font-semibold ${license.tier === 'free' ? 'text-gray-900 bg-gray-100' : 'text-gray-700'}`}>
                    {t('free_plan')}<br/>
                    <span className="text-lg font-bold">{t('free_price')}</span>
                  </th>
                  <th className={`py-3 px-4 text-center font-semibold ${license.tier === 'basic' ? 'text-blue-900 bg-blue-50 ring-2 ring-blue-300 ring-inset' : 'text-gray-700'}`}>
                    {t('basic_plan')}<br/>
                    <span className="text-lg font-bold text-blue-600">{t('basic_price_monthly')}</span>
                    <br/><span className="text-xs text-gray-400">{t('basic_price_yearly')} ({t('save_yearly')})</span>
                  </th>
                  <th className={`py-3 px-4 text-center font-semibold relative ${license.tier === 'pro' ? 'text-purple-900 bg-purple-50 ring-2 ring-purple-300 ring-inset' : 'text-gray-700 bg-purple-50/30'}`}>
                    <span className="inline-block px-2 py-0.5 bg-amber-500 text-white text-[10px] font-bold rounded-full mb-1">{t('most_popular')}</span><br/>
                    {t('pro_plan')}<br/>
                    <span className="text-lg font-bold text-purple-600">{t('pro_price_monthly')}</span>
                    <br/><span className="text-xs text-gray-400">{t('pro_price_yearly')} ({t('save_yearly_pro')})</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <PricingRow label={t('feature_platforms')} free={t('one_platform')} basic={t('one_platform_basic')} pro={t('both_platforms')} currentTier={license.tier} />
                <PricingRow label={t('feature_qa_limit')} free={t('qa_30_indexed')} basic={t('qa_500_indexed')} pro={t('qa_unlimited')} currentTier={license.tier} />
                <PricingRow label={t('feature_auto_reply')} free={t('suggest_only_short')} basic={t('suggest_only_short')} pro={t('full_auto')} currentTier={license.tier} />
                <PricingRow label={t('feature_import')} free="✓" basic="✓" pro="✓" currentTier={license.tier} />
                <PricingRow label={t('feature_ai_suggest')} free="✗" basic="✓" pro="✓" currentTier={license.tier} />
                <PricingRow label={t('feature_custom_tone')} free="✗" basic="✗" pro="✓" currentTier={license.tier} />
                <PricingRow label={t('feature_priority_support')} free="✗" basic="✗" pro="✓" currentTier={license.tier} />
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 border-t border-gray-200">
                  <td className="py-4 px-4"></td>
                  <td className="py-4 px-4 text-center">
                    {license.tier === 'free' && (
                      <span className="text-xs text-gray-400">{t('current_plan')}</span>
                    )}
                  </td>
                  <td className="py-4 px-4 text-center">
                    {license.tier === 'basic' ? (
                      <span className="text-xs text-blue-600 font-medium">{t('current_plan')}</span>
                    ) : license.tier === 'free' ? (
                      <button
                        onClick={() => setBuyTarget('basic')}
                        className="px-5 py-2 bg-blue-600 text-white text-xs font-bold rounded-lg hover:bg-blue-700 transition-colors"
                      >
                        {t('buy_license')}
                      </button>
                    ) : null}
                  </td>
                  <td className="py-4 px-4 text-center">
                    {license.tier === 'pro' ? (
                      <span className="text-xs text-purple-600 font-medium">{t('current_plan')}</span>
                    ) : (
                      <button
                        onClick={() => setBuyTarget('pro')}
                        className="px-5 py-2 bg-purple-600 text-white text-xs font-bold rounded-lg hover:bg-purple-700 transition-colors"
                      >
                        {t('buy_license')}
                      </button>
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Version + Report — side by side */}
        <div className="grid grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center shadow-sm" style={{ background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)' }}>
                <svg viewBox="0 0 32 32" width="26" height="26" xmlns="http://www.w3.org/2000/svg">
                  <path d="M4 7a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3h-2l-3 3v-3H7a3 3 0 0 1-3-3V7z" fill="#fff" fillOpacity="0.4"/>
                  <path d="M11 14a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-4l-4 4v-4h-3a3 3 0 0 1-3-3v-6z" fill="#fff"/>
                  <path d="M20 14.5l-3 4.5h2.5l-1 3.5 3.5-5h-2.5l0.5-3z" fill="#2563eb"/>
                </svg>
              </div>
              <div>
                <div className="font-bold text-gray-900">ShopReply</div>
                <div className="text-xs text-gray-500">{t('ai_auto_reply_fb_zalo')}</div>
              </div>
            </div>
            <div className="text-sm text-gray-600">
              {t('version')} <span className="font-medium">1.1.0</span> · {t('local_first')}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">{t('need_help')}</h3>
            <p className="text-xs text-gray-500 mb-4">{t('report_desc')}</p>
            <button
              onClick={handleReportIssue}
              className="px-3 py-1.5 border border-gray-300 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-50 transition-colors"
            >
              {t('report_issue')}
            </button>
          </div>
        </div>

        {/* Guide + Referral + Donate — secondary */}
        <div className="flex items-center gap-3">
          <a
            href="https://nhamingroup.github.io/shopReply/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors no-underline"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
            {t('user_guide')}
          </a>
          <a
            href="https://nhamingroup.github.io/shopReply/affiliate.html"
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 border border-green-300 text-green-700 text-sm font-medium rounded-xl hover:bg-green-50 transition-colors no-underline"
          >
            <span>🎁</span>
            {t('referral_program')}
          </a>
          <button
            onClick={() => setShowDonate(true)}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 border border-amber-300 text-amber-700 text-sm font-medium rounded-xl hover:bg-amber-50 transition-colors"
          >
            <span>☕</span>
            {t('donate_coffee')}
          </button>
        </div>
      </div>

      {/* Donate Modal */}
      {showDonate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowDonate(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-[480px] max-w-[95vw] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 bg-amber-500 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-lg">☕ {t('donate_coffee')}</h3>
                  <p className="text-sm opacity-80">{t('donate_desc')}</p>
                </div>
                <button onClick={() => setShowDonate(false)} className="text-white/70 hover:text-white text-2xl leading-none">&times;</button>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <button
                onClick={() => {
                  browser.tabs.create({ url: 'https://nhamingroup.github.io/shopReply/index.html#ung-ho' });
                  setShowDonate(false);
                }}
                className="w-full flex items-center gap-4 p-4 border-2 border-gray-200 rounded-xl hover:border-blue-400 hover:bg-blue-50 transition-all group"
              >
                <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center text-2xl flex-shrink-0">🏦</div>
                <div className="text-left flex-1">
                  <div className="font-semibold text-gray-900 group-hover:text-blue-700">{t('donate_qr')}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{t('donate_qr_desc')}</div>
                </div>
              </button>
              {/* LemonSqueezy donate option — hidden (store application rejected 2026-04-16) */}
              {false && (
              <button
                onClick={() => {
                  browser.tabs.create({ url: 'https://shopreply.lemonsqueezy.com/checkout/buy/8884c423-8132-487d-b2ac-6c133747540f' });
                  setShowDonate(false);
                }}
                className="w-full flex items-center gap-4 p-4 border-2 border-gray-200 rounded-xl hover:border-purple-400 hover:bg-purple-50 transition-all group"
              >
                <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center text-2xl flex-shrink-0">💳</div>
                <div className="text-left flex-1">
                  <div className="font-semibold text-gray-900 group-hover:text-purple-700">{t('donate_card')}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{t('donate_card_desc')}</div>
                </div>
              </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Payment Method Modal */}
      {buyTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setBuyTarget(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-[480px] max-w-[95vw] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div className={`px-6 py-4 text-white ${buyTarget === 'pro' ? 'bg-purple-600' : 'bg-blue-600'}`}>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-lg">
                    {buyTarget === 'pro' ? t('pro_plan') : t('basic_plan')}
                  </h3>
                  <p className="text-sm opacity-80">
                    {buyTarget === 'pro' ? t('pro_price_monthly') : t('basic_price_monthly')}
                  </p>
                </div>
                <button onClick={() => setBuyTarget(null)} className="text-white/70 hover:text-white text-2xl leading-none">&times;</button>
              </div>
            </div>

            {/* Payment Options */}
            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-600 text-center mb-4">
                {t('choose_payment_method')}
              </p>

              {/* Option 1: QR Banking (VN) */}
              <button
                onClick={() => {
                  const planName = buyTarget === 'pro' ? 'Pro' : 'Basic';
                  const price = buyTarget === 'pro' ? '499000' : '299000';
                  browser.tabs.create({
                    url: `https://nhamingroup.github.io/shopReply/pay.html?plan=${planName}&amount=${price}`
                  });
                  setBuyTarget(null);
                }}
                className="w-full flex items-center gap-4 p-4 border-2 border-gray-200 rounded-xl hover:border-blue-400 hover:bg-blue-50 transition-all group"
              >
                <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center text-2xl flex-shrink-0">
                  🏦
                </div>
                <div className="text-left flex-1">
                  <div className="font-semibold text-gray-900 group-hover:text-blue-700">{t('pay_qr_banking')}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{t('pay_qr_desc')}</div>
                </div>
                <div className="text-xs text-blue-600 font-medium px-2 py-1 bg-blue-50 rounded-full flex-shrink-0">
                  0% {t('pay_fee')}
                </div>
              </button>

              {/* Option 2: LemonSqueezy (International) — hidden (store application rejected 2026-04-16) */}
              {false && (
              <button
                onClick={() => {
                  const lsUrl = buyTarget === 'pro'
                    ? 'https://shopreply.lemonsqueezy.com/checkout/buy/f900b81d-9380-439b-81be-c3570a3b1bb6'
                    : 'https://shopreply.lemonsqueezy.com/checkout/buy/eaf2f03a-45b7-464c-9028-e588393e3983';
                  browser.tabs.create({ url: lsUrl });
                  setBuyTarget(null);
                }}
                className="w-full flex items-center gap-4 p-4 border-2 border-gray-200 rounded-xl hover:border-purple-400 hover:bg-purple-50 transition-all group"
              >
                <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center text-2xl flex-shrink-0">
                  💳
                </div>
                <div className="text-left flex-1">
                  <div className="font-semibold text-gray-900 group-hover:text-purple-700">{t('pay_international')}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{t('pay_international_desc')}</div>
                </div>
              </button>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-3 bg-gray-50 border-t border-gray-100">
              <p className="text-[11px] text-gray-400 text-center">{t('pay_license_note')}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PricingRow({ label, free, basic, pro, currentTier }: {
  label: string; free: string; basic: string; pro: string; currentTier: string;
}) {
  const cellClass = (tier: string) =>
    `py-3 px-4 text-center text-sm ${currentTier === tier ? 'font-semibold' : ''}`;
  const checkMark = (val: string) =>
    val === '✓' ? <span className="text-emerald-600 font-bold">✓</span> :
    val === '✗' ? <span className="text-gray-300">—</span> :
    <span>{val}</span>;
  return (
    <tr className="border-t border-gray-100">
      <td className="py-3 px-4 text-sm font-medium text-gray-700">{label}</td>
      <td className={cellClass('free')}>{checkMark(free)}</td>
      <td className={cellClass('basic')}>{checkMark(basic)}</td>
      <td className={`${cellClass('pro')} bg-purple-50/20`}>{checkMark(pro)}</td>
    </tr>
  );
}

export default App;
