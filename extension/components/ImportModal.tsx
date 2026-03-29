import { useState, useRef, useCallback } from 'react';
import { useI18n } from '@/hooks/useI18n';
import type { ExtensionMessage, ExtensionResponse, ImportResult } from '@/types/messages';

function sendMsg<T>(msg: ExtensionMessage): Promise<ExtensionResponse<T>> {
  return new Promise((resolve) => {
    browser.runtime.sendMessage(msg).then(
      (response) => resolve(response as ExtensionResponse<T>),
      () => resolve({ success: false, error: 'Communication error' })
    );
  });
}

interface ParsedPair {
  question: string;
  answer: string;
}

interface ImportModalProps {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

export function ImportModal({ open, onClose, onImported }: ImportModalProps) {
  const { t, lang } = useI18n();
  const [mode, setMode] = useState<'file' | 'paste'>('file');
  const [pasteText, setPasteText] = useState('');
  const [parsedPairs, setParsedPairs] = useState<ParsedPair[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetState = useCallback(() => {
    setParsedPairs([]);
    setShowPreview(false);
    setResult(null);
    setError('');
    setPasteText('');
    setImporting(false);
  }, []);

  const handleClose = () => {
    resetState();
    onClose();
  };

  const parseCSV = (text: string): ParsedPair[] => {
    const lines = text.trim().split('\n');
    const pairs: ParsedPair[] = [];
    const startIdx = lines[0]?.toLowerCase().includes('question') ? 1 : 0;
    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const match = line.match(/^"([^"]*?)"\s*,\s*"([^"]*?)"$/);
      if (match) {
        pairs.push({ question: match[1], answer: match[2] });
        continue;
      }
      const parts = line.split(',');
      if (parts.length >= 2) {
        const question = parts[0].replace(/^"|"$/g, '').trim();
        const answer = parts.slice(1).join(',').replace(/^"|"$/g, '').trim();
        if (question && answer) {
          pairs.push({ question, answer });
        }
      }
    }
    return pairs;
  };

  const parseJSON = (text: string): ParsedPair[] => {
    const data = JSON.parse(text) as Array<Record<string, string>>;
    if (!Array.isArray(data)) return [];
    return data
      .map((item) => ({
        question: (item.question || item.q || '').trim(),
        answer: (item.answer || item.a || '').trim(),
      }))
      .filter((p) => p.question && p.answer);
  };

  const parsePipeText = (text: string): ParsedPair[] => {
    return text
      .trim()
      .split('\n')
      .map((line) => {
        const parts = line.split('|');
        if (parts.length >= 2) {
          return {
            question: parts[0].trim(),
            answer: parts.slice(1).join('|').trim(),
          };
        }
        return null;
      })
      .filter((p): p is ParsedPair => p !== null && p.question !== '' && p.answer !== '');
  };

  const handleFileSelect = (file: File) => {
    setError('');
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      try {
        let pairs: ParsedPair[];
        if (file.name.endsWith('.json')) {
          pairs = parseJSON(text);
        } else {
          pairs = parseCSV(text);
        }
        if (pairs.length === 0) {
          setError(t('no_pairs_in_file'));
          return;
        }
        setParsedPairs(pairs);
        setShowPreview(true);
      } catch {
        setError(t('parse_file_failed'));
      }
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  const handleParsePaste = () => {
    setError('');
    const text = pasteText.trim();
    if (!text) {
      setError(t('paste_first'));
      return;
    }
    try {
      let pairs: ParsedPair[];
      if (text.startsWith('[')) {
        pairs = parseJSON(text);
      } else {
        pairs = parsePipeText(text);
      }
      if (pairs.length === 0) {
        setError(t('no_pairs_found'));
        return;
      }
      setParsedPairs(pairs);
      setShowPreview(true);
    } catch {
      setError(t('parse_failed'));
    }
  };

  const handleImport = async () => {
    setImporting(true);
    setError('');
    const response = await sendMsg<ImportResult>({
      type: 'MSG_IMPORT_QA',
      payload: { pairs: parsedPairs },
    });
    setImporting(false);
    if (response.success && response.data) {
      setResult(response.data);
      onImported();
    } else {
      const err = response.error ?? 'Import failed';
      if (err.includes('LIMIT_REACHED') || err.includes('LIMIT_PARTIAL')) {
        setError('LIMIT_REACHED');
      } else if (err.includes('giới hạn') || err.includes('limit')) {
        setError('LIMIT_REACHED');
      } else {
        setError(err);
      }
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">{t('import_qa_pairs')}</h2>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">
            &times;
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {result ? (
            /* Result view */
            <div className="text-center py-6">
              <div className="text-4xl mb-3">&#10003;</div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">{t('import_complete')}</h3>
              <div className="text-sm text-gray-600 space-y-1">
                <p>{t('total_in_file')} {result.total_in_file}</p>
                <p className="text-green-600 font-medium">{t('added')} {result.added}</p>
                {result.skipped_duplicate > 0 && (
                  <p className="text-yellow-600">{t('skipped_dup')} {result.skipped_duplicate}</p>
                )}
                {result.skipped_invalid > 0 && (
                  <p className="text-red-600">{t('skipped_invalid')} {result.skipped_invalid}</p>
                )}
              </div>
              <button
                onClick={handleClose}
                className="mt-6 px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
              >
                {t('done')}
              </button>
            </div>
          ) : showPreview ? (
            /* Preview view */
            <div>
              <div className="text-sm text-gray-600 mb-3">
                {t('found_pairs')} {parsedPairs.length} {t('review_before')}
              </div>
              <div className="border border-gray-200 rounded-lg overflow-hidden max-h-[300px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="py-2 px-3 text-left font-medium text-gray-500 w-10">#</th>
                      <th className="py-2 px-3 text-left font-medium text-gray-500">{t('question')}</th>
                      <th className="py-2 px-3 text-left font-medium text-gray-500">{t('answer')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedPairs.map((pair, idx) => (
                      <tr key={idx} className="border-t border-gray-100">
                        <td className="py-2 px-3 text-gray-400">{idx + 1}</td>
                        <td className="py-2 px-3 text-gray-800">{pair.question}</td>
                        <td className="py-2 px-3 text-gray-600">{pair.answer}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {error && (
                error === 'LIMIT_REACHED' ? (
                  <div className="mt-3 px-4 py-3 bg-orange-50 border border-orange-200 rounded-lg">
                    <p className="text-orange-800 font-semibold text-sm mb-1">
                      {lang === 'vi' ? 'Đã đạt giới hạn Q&A cho gói Free (30 cặp)' : 'Free plan Q&A limit reached (30 pairs)'}
                    </p>
                    <p className="text-orange-700 text-xs mb-2">
                      {lang === 'vi' ? 'Nâng cấp lên Basic (500 cặp) hoặc Pro (không giới hạn) để thêm câu hỏi.' : 'Upgrade to Basic (500 pairs) or Pro (unlimited) to add more.'}
                    </p>
                    <button
                      onClick={() => browser.tabs.create({ url: browser.runtime.getURL('/options.html#about') })}
                      className="px-3 py-1.5 bg-orange-600 text-white text-xs font-medium rounded-lg hover:bg-orange-700 transition-colors"
                    >
                      {lang === 'vi' ? 'Xem gói nâng cấp' : 'View upgrade plans'}
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 px-3 py-2 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>
                )
              )}
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => { setShowPreview(false); setParsedPairs([]); }}
                  className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  {t('back')}
                </button>
                <button
                  onClick={handleImport}
                  disabled={importing}
                  className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {importing ? t('importing') : `${t('import_n_pairs')} ${parsedPairs.length} ${t('qa_pairs_count')}`}
                </button>
              </div>
            </div>
          ) : (
            /* Input view */
            <div>
              {/* Mode tabs */}
              <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => setMode('file')}
                  className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                    mode === 'file' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {t('file_upload')}
                </button>
                <button
                  onClick={() => setMode('paste')}
                  className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                    mode === 'paste' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {t('paste_text')}
                </button>
              </div>

              {mode === 'file' ? (
                <div>
                  {/* Drag & drop zone */}
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                      dragOver
                        ? 'border-blue-400 bg-blue-50'
                        : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
                    }`}
                  >
                    <div className="text-3xl mb-2 text-gray-400">&#128195;</div>
                    <p className="text-sm font-medium text-gray-700">{t('drop_file')}</p>
                    <p className="text-xs text-gray-500 mt-1">{t('supports_csv_json')}</p>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.json,.txt"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileSelect(file);
                    }}
                  />
                  <div className="mt-3 text-xs text-gray-500 space-y-1">
                    <p><strong>CSV:</strong> question,answer (first row can be header)</p>
                    <p><strong>JSON:</strong> [&#123;"question": "...", "answer": "..."&#125;, ...]</p>
                  </div>
                </div>
              ) : (
                <div>
                  <textarea
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    placeholder={t('paste_placeholder')}
                    rows={8}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none font-mono"
                  />
                  <div className="mt-2 text-xs text-gray-500">{t('paste_format')}</div>
                  <button
                    onClick={handleParsePaste}
                    className="mt-3 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    {t('parse_preview')}
                  </button>
                </div>
              )}

              {error && (
                error === 'LIMIT_REACHED' ? (
                  <div className="mt-3 px-4 py-3 bg-orange-50 border border-orange-200 rounded-lg">
                    <p className="text-orange-800 font-semibold text-sm mb-1">
                      {lang === 'vi' ? 'Đã đạt giới hạn Q&A cho gói Free (30 cặp)' : 'Free plan Q&A limit reached (30 pairs)'}
                    </p>
                    <p className="text-orange-700 text-xs mb-2">
                      {lang === 'vi' ? 'Nâng cấp lên Basic (500 cặp) hoặc Pro (không giới hạn) để thêm câu hỏi.' : 'Upgrade to Basic (500 pairs) or Pro (unlimited) to add more.'}
                    </p>
                    <button
                      onClick={() => browser.tabs.create({ url: browser.runtime.getURL('/options.html#about') })}
                      className="px-3 py-1.5 bg-orange-600 text-white text-xs font-medium rounded-lg hover:bg-orange-700 transition-colors"
                    >
                      {lang === 'vi' ? 'Xem gói nâng cấp' : 'View upgrade plans'}
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 px-3 py-2 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>
                )
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
