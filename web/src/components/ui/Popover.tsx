import {
  autoUpdate,
  flip,
  offset,
  shift,
  useFloating,
  type Placement,
} from '@floating-ui/react-dom';
import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../../lib/cx';

export interface PopoverProps {
  /** Render prop for the trigger; spread the props onto a focusable element. */
  trigger: (props: {
    ref: (el: HTMLElement | null) => void;
    onClick: () => void;
    'aria-expanded': boolean;
    'aria-controls': string;
    'aria-haspopup': 'dialog';
  }) => ReactElement;
  children: ReactNode | ((close: () => void) => ReactNode);
  placement?: Placement;
  label: string;
  className?: string;
}

/** Click-to-open floating panel. Closes on Escape or outside click and returns focus to the trigger. */
export function Popover({
  trigger,
  children,
  placement = 'bottom-start',
  label,
  className,
}: PopoverProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const triggerEl = useRef<HTMLElement | null>(null);
  const { refs, floatingStyles } = useFloating({
    open,
    placement,
    strategy: 'fixed',
    middleware: [offset(6), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  const close = () => {
    setOpen(false);
    triggerEl.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (refs.floating.current?.contains(target) || triggerEl.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    // Move focus into the panel for keyboard users.
    const first = refs.floating.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    (first ?? refs.floating.current)?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs are stable
  }, [open]);

  return (
    <>
      {trigger({
        ref: (el) => {
          triggerEl.current = el;
          refs.setReference(el);
        },
        onClick: () => setOpen((o) => !o),
        'aria-expanded': open,
        'aria-controls': id,
        'aria-haspopup': 'dialog',
      })}
      {open &&
        createPortal(
          <div
            ref={refs.setFloating}
            id={id}
            role="dialog"
            aria-label={label}
            tabIndex={-1}
            style={floatingStyles}
            className={cx(
              'z-50 min-w-48 rounded-2xl border border-border bg-surface p-2 shadow-pop',
              className,
            )}
          >
            {typeof children === 'function' ? children(close) : children}
          </div>,
          // Inside a modal <dialog> (top layer) the panel must live in the dialog,
          // otherwise it renders behind it and can't be clicked.
          (triggerEl.current?.closest('dialog') as HTMLElement | null) ?? document.body,
        )}
    </>
  );
}
