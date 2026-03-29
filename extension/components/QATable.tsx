import { useState, useEffect, useCallback } from 'react';
import { useI18n } from '@/hooks/useI18n';
import type { QAPair } from '@/types/qa';
import type { ExtensionMessage, ExtensionResponse, QAListResult } from '@/types/messages';

function sendMsg<T>(msg: ExtensionMessage): Promise<ExtensionResponse<T>> {
  return new Promise((resolve) => {
    browser.runtime.sendMessage(msg).then(
      (response) => resolve((response ?? { success: false, error: 'No response' }) as ExtensionResponse<T>),
      () => resolve({ success: false, error: 'Communication error' })
    );
  });
}

interface QATableProps {
  compact?: boolean;
  pageSize?: number;
  onEdit?: (pair: QAPair) => void;
}

export function QATable({ compact = false, pageSize = 20, onEdit }: QATableProps) {
  const { t } = useI18n();
  const [items, setItems] = useState<QAPair[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    const result = await sendMsg<QAListResult>({
      type: 'MSG_GET_QA',
      payload: { page, per_page: pageSize, search: search || undefined },
    });
    if (result?.success && result.data) {
      const qa = result.data;
      setItems(qa.items ?? []);
      setTotal(qa.total ?? 0);
      setTotalPages(qa.total_pages ?? 1);
    } else {
      const errMsg = result?.error ?? ''
      // Show friendly message when backend is not running
      if (errMsg.includes('Failed to fetch') || errMsg.includes('fetch')) {
        setError(t('backend_not_running'))
      } else {
        setError(errMsg || t('backend_not_running'))
      }
      setItems([]);
    }
    setLoading(false);
  }, [page, pageSize, search]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleDelete = async (id: number) => {
    if (!confirm(t('delete_confirm'))) return;
    const result = await sendMsg<{ id: number; deleted: boolean }>({
      type: 'MSG_DELETE_QA',
      payload: { id },
    });
    if (result.success) {
      fetchData();
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchData();
  };

  if (compact) {
    return (
      <div>
        <div className="text-sm font-medium text-gray-500 mb-2">
          {t('qa_database')} ({total} {t('qa_pairs_count')})
        </div>
        {items.slice(0, 5).map((pair) => (
          <div key={pair.id} className="border-b border-gray-100 py-2 last:border-0">
            <div className="text-xs font-medium text-gray-800 truncate">{pair.question}</div>
            <div className="text-xs text-gray-500 truncate">{pair.answer}</div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      {/* Search bar */}
      <form onSubmit={handleSearchSubmit} className="flex gap-2 mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('search_placeholder')}
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <button
          type="submit"
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          {t('search')}
        </button>
      </form>

      {error && (
        <div className="mb-4 px-4 py-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl flex items-start gap-3">
          <span className="text-lg flex-shrink-0">⚠️</span>
          <p className="font-medium">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="text-center py-8 text-gray-500">{t('loading')}</div>
      ) : items.length === 0 ? (
        <div className="text-center py-8 text-gray-400">
          {search ? t('no_results') : t('no_qa_yet')}
        </div>
      ) : (
        <>
          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="py-2 px-3 text-left font-medium text-gray-500 w-10">#</th>
                  <th className="py-2 px-3 text-left font-medium text-gray-500">{t('question')}</th>
                  <th className="py-2 px-3 text-left font-medium text-gray-500">{t('answer')}</th>
                  <th className="py-2 px-3 text-left font-medium text-gray-500 w-24">{t('source')}</th>
                  <th className="py-2 px-3 text-center font-medium text-gray-500 w-20">{t('sent')}</th>
                  <th className="py-2 px-3 text-right font-medium text-gray-500 w-28">{t('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((pair, idx) => (
                  <tr key={pair.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2.5 px-3 text-gray-400">
                      {(page - 1) * pageSize + idx + 1}
                    </td>
                    <td className="py-2.5 px-3 text-gray-800 max-w-[200px] truncate">
                      {pair.question}
                    </td>
                    <td className="py-2.5 px-3 text-gray-600 max-w-[250px] truncate">
                      {pair.answer}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                        pair.source === 'imported' ? 'bg-blue-50 text-blue-700' :
                        pair.source === 'user_replied' ? 'bg-green-50 text-green-700' :
                        pair.source === 'ai_approved' ? 'bg-purple-50 text-purple-700' :
                        'bg-gray-50 text-gray-700'
                      }`}>
                        {pair.source}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-center text-gray-500">
                      {pair.times_auto_sent}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {onEdit && (
                          <button
                            onClick={() => onEdit(pair)}
                            className="px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded transition-colors"
                          >
                            {t('edit')}
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(pair.id)}
                          className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded transition-colors"
                        >
                          {t('delete')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <div className="text-sm text-gray-500">
                {t('page_of')} {page} {t('of')} {totalPages} ({total} {t('total')})
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {t('previous')}
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {t('next')}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
