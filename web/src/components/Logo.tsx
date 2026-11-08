import { APP_NAME } from '../config';

export function Logo({ withName = true }: { withName?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 font-extrabold tracking-tight">
      <img src="/logo.svg" alt="" width={28} height={28} />
      {withName && <span>{APP_NAME}</span>}
    </span>
  );
}
