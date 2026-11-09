import { parseRich, type Block, type Inline, type Person } from '@app/shared';
import { Fragment, type ReactNode } from 'react';
import { cx } from '../../lib/cx';

function renderInline(nodes: Inline[], me: string | null): ReactNode {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text':
        return <Fragment key={i}>{n.v}</Fragment>;
      case 'br':
        return <br key={i} />;
      case 'b':
        return <strong key={i}>{renderInline(n.c, me)}</strong>;
      case 'i':
        return <em key={i}>{renderInline(n.c, me)}</em>;
      case 'a':
        return (
          <a
            key={i}
            href={n.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-primary underline underline-offset-2"
          >
            {renderInline(n.c, me)}
          </a>
        );
      case 'mention':
        return (
          <span
            key={i}
            className={cx(
              'rounded bg-primary-soft px-1 font-semibold text-primary',
              n.uid === me && 'ring-1 ring-primary',
            )}
          >
            {n.v}
          </span>
        );
    }
  });
}

function renderBlock(b: Block, i: number, me: string | null): ReactNode {
  if (b.t === 'p') return <p key={i}>{renderInline(b.c, me)}</p>;
  const items = b.items.map((it, j) => <li key={j}>{renderInline(it, me)}</li>);
  return b.t === 'ul' ? (
    <ul key={i} className="list-disc pl-5">
      {items}
    </ul>
  ) : (
    <ol key={i} className="list-decimal pl-5">
      {items}
    </ol>
  );
}

/** Renders comment text as real elements; there is no HTML anywhere, so nothing to inject. */
export function RichText({
  body,
  people,
  me = null,
}: {
  body: string;
  people: readonly Person[];
  me?: string | null;
}) {
  return (
    <div className="space-y-1.5 text-sm break-words">
      {parseRich(body, people).map((b, i) => renderBlock(b, i, me))}
    </div>
  );
}
