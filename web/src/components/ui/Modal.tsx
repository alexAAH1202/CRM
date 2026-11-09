import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cx } from '../../lib/cx';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** "side" renders as a right-hand slide-in panel (item pages). */
  variant?: 'center' | 'side';
  className?: string;
}

/**
 * Built on the native <dialog> element: showModal() gives us focus trapping,
 * inert background, Escape-to-close and top-layer stacking for free.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  variant = 'center',
  className,
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // Click on the backdrop (the dialog element itself) closes.
        if (e.target === ref.current) onClose();
      }}
      className={cx(
        'bg-surface p-0 text-fg shadow-pop',
        variant === 'center'
          ? 'm-auto w-[min(32rem,calc(100vw-2rem))] rounded-3xl'
          : 'ml-auto mr-0 h-dvh max-h-dvh w-[min(40rem,100vw)] max-w-none rounded-l-3xl',
        className,
      )}
    >
      {open && (
        <div className="flex h-full flex-col">
          <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
            <h2 id={titleId} className="text-lg font-bold">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-fg"
            >
              <X size={18} aria-hidden />
            </button>
          </header>
          <div className="flex-1 overflow-auto px-6 py-5">{children}</div>
          {footer && (
            <footer className="flex justify-end gap-2 border-t border-border px-6 py-4">
              {footer}
            </footer>
          )}
        </div>
      )}
    </dialog>
  );
}

/** Right-hand panel used for item pages. */
export function SidePanel(props: Omit<ModalProps, 'variant'>) {
  return <Modal {...props} variant="side" />;
}
