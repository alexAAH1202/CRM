import { Spinner } from './ui';

export function FullPageSpinner({ label }: { label?: string }) {
  return (
    <div className="flex h-full min-h-[50vh] items-center justify-center">
      <Spinner {...(label ? { label } : {})} />
    </div>
  );
}
