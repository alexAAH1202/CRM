import { Compass } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState } from '../components/ui';

export default function NotFoundPage() {
  return (
    <EmptyState
      icon={<Compass size={28} />}
      title="Page not found"
      body="That link doesn't point anywhere."
      action={
        <Link to="/" className="font-semibold text-primary underline underline-offset-2">
          Go home
        </Link>
      }
    />
  );
}
