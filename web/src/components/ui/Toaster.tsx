import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import { useToastStore, type ToastTone } from '../../stores/toast';
import { cx } from '../../lib/cx';

const icons: Record<ToastTone, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  error: TriangleAlert,
};

/** Renders queued toasts in a polite live region (errors use role="alert"). */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2"
    >
      {toasts.map((t) => {
        const Icon = icons[t.tone];
        return (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className={cx(
              'pointer-events-auto flex items-center gap-3 rounded-2xl px-4 py-3 text-sm shadow-pop',
              'bg-fg text-bg',
            )}
          >
            <Icon size={18} aria-hidden className="shrink-0" />
            <span className="flex-1">{t.message}</span>
            {t.action && (
              <button
                type="button"
                className="font-bold underline underline-offset-2"
                onClick={() => {
                  t.action?.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => dismiss(t.id)}
              className="opacity-70 hover:opacity-100"
            >
              <X size={16} aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
