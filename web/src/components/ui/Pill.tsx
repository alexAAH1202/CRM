import { LABEL_COLORS, type LabelColor } from '@app/shared';
import type { HTMLAttributes } from 'react';
import { cx } from '../../lib/cx';

export interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  color: LabelColor;
  /** "cell" fills its table cell edge to edge, monday-style. */
  variant?: 'pill' | 'cell';
}

/** Status / label pill. Text colour comes from the AA-checked palette. */
export function Pill({ color, variant = 'pill', className, style, children, ...rest }: PillProps) {
  const c = LABEL_COLORS[color];
  return (
    <span
      className={cx(
        'inline-flex items-center justify-center truncate text-sm font-semibold',
        variant === 'pill' ? 'h-7 rounded-full px-3' : 'h-full w-full px-2',
        className,
      )}
      style={{ backgroundColor: c.bg, color: c.text, ...style }}
      {...rest}
    >
      {children}
    </span>
  );
}
