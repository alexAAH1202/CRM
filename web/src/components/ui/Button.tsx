import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cx } from '../../lib/cx';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-hover',
  secondary: 'bg-surface text-fg border border-border hover:bg-surface-2',
  ghost: 'bg-transparent text-fg hover:bg-surface-2',
  danger: 'bg-danger text-on-danger hover:opacity-90',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        'inline-flex items-center justify-center rounded-xl font-semibold transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    />
  );
});
