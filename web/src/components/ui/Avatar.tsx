import { LABEL_COLORS, LABEL_COLOR_NAMES } from '@app/shared';
import { useState } from 'react';
import { cx } from '../../lib/cx';

export interface AvatarProps {
  name: string;
  photoURL?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizes = { sm: 'h-6 w-6 text-[10px]', md: 'h-8 w-8 text-xs', lg: 'h-10 w-10 text-sm' };

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** Deterministic palette colour per name so a person keeps their colour everywhere. */
export function colorForName(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const key = LABEL_COLOR_NAMES[h % LABEL_COLOR_NAMES.length] ?? 'blue';
  return LABEL_COLORS[key];
}

export function Avatar({ name, photoURL, size = 'md', className }: AvatarProps) {
  const [broken, setBroken] = useState(false);
  const base = cx(
    'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold ring-2 ring-surface',
    sizes[size],
    className,
  );
  if (photoURL && !broken) {
    return (
      <img
        src={photoURL}
        alt={name}
        title={name}
        className={base}
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
      />
    );
  }
  const c = colorForName(name);
  return (
    <span
      role="img"
      aria-label={name}
      title={name}
      className={base}
      style={{ background: c.bg, color: c.text }}
    >
      {initials(name)}
    </span>
  );
}
