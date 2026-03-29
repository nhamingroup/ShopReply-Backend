import { useI18n } from '@/hooks/useI18n';

interface StatusBadgeProps {
  connected: boolean;
}

export function StatusBadge({ connected }: StatusBadgeProps) {
  const { t } = useI18n();

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
        connected
          ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20'
          : 'bg-red-50 text-red-700 ring-1 ring-red-600/20'
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          connected ? 'bg-emerald-500' : 'bg-red-500'
        }`}
      />
      {connected ? t('connected') : t('disconnected')}
    </span>
  );
}
