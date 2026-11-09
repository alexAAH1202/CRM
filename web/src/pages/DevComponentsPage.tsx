import { DEFAULT_STATUS_LABELS, LABEL_COLOR_NAMES } from '@app/shared';
import { Inbox, Settings } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeToggle';
import {
  Avatar,
  Button,
  EmptyState,
  Modal,
  Pill,
  Popover,
  SidePanel,
  Skeleton,
  Spinner,
} from '../components/ui';
import { toast } from '../stores/toast';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-3xl bg-surface p-6 shadow-sm">
      <h2 className="text-sm font-bold tracking-wide text-muted uppercase">{title}</h2>
      {children}
    </section>
  );
}

/** Design-system gallery. Visible at /dev/components for visual QA in light and dark mode. */
export default function DevComponentsPage() {
  const [modal, setModal] = useState(false);
  const [panel, setPanel] = useState(false);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <Logo />
        <ThemeToggle />
      </header>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-2">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button size="sm">Small</Button>
          <Button disabled>Disabled</Button>
        </div>
      </Section>

      <Section title="Status pills (default labels)">
        <div className="flex flex-wrap gap-2">
          {DEFAULT_STATUS_LABELS.map((l) => (
            <Pill key={l.id} color={l.color}>
              {l.name}
            </Pill>
          ))}
        </div>
        <div className="grid max-w-md grid-cols-4 overflow-hidden rounded-xl border border-border">
          {DEFAULT_STATUS_LABELS.map((l) => (
            <div key={l.id} className="h-9">
              <Pill color={l.color} variant="cell">
                {l.name}
              </Pill>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Label palette">
        <div className="flex flex-wrap gap-2">
          {LABEL_COLOR_NAMES.map((c) => (
            <Pill key={c} color={c}>
              {c}
            </Pill>
          ))}
        </div>
      </Section>

      <Section title="Avatars">
        <div className="flex items-center gap-2">
          <Avatar name="Ada Lovelace" size="sm" />
          <Avatar name="Grace Hopper" />
          <Avatar name="Katherine Johnson" size="lg" />
          <div className="flex -space-x-2">
            <Avatar name="Alan Turing" />
            <Avatar name="Margaret Hamilton" />
            <Avatar name="Radia Perlman" />
          </div>
        </div>
      </Section>

      <Section title="Overlays">
        <div className="flex flex-wrap gap-2">
          <Popover
            label="Example menu"
            trigger={(p) => (
              <Button variant="secondary" {...p}>
                Open popover
              </Button>
            )}
          >
            {(close) => (
              <div className="flex flex-col">
                {['Rename', 'Duplicate', 'Archive'].map((a) => (
                  <button
                    key={a}
                    type="button"
                    className="rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2"
                    onClick={close}
                  >
                    {a}
                  </button>
                ))}
              </div>
            )}
          </Popover>
          <Button variant="secondary" onClick={() => setModal(true)}>
            Open modal
          </Button>
          <Button variant="secondary" onClick={() => setPanel(true)}>
            Open side panel
          </Button>
          <Button variant="secondary" onClick={() => toast.success('Saved!')}>
            Success toast
          </Button>
          <Button
            variant="secondary"
            onClick={() => toast.error('Could not save. Check your connection.')}
          >
            Error toast
          </Button>
        </div>
      </Section>

      <Section title="Loading">
        <div className="flex items-center gap-4">
          <Spinner />
          <div className="w-64 space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
      </Section>

      <Section title="Empty state">
        <EmptyState
          icon={<Inbox size={28} />}
          title="No notifications yet"
          body="When someone mentions you or assigns you an item, it shows up here."
          action={<Button size="sm">Create your first list</Button>}
        />
      </Section>

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title="Invite teammates"
        footer={
          <>
            <Button variant="ghost" onClick={() => setModal(false)}>
              Cancel
            </Button>
            <Button onClick={() => setModal(false)}>Send invites</Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          Modals use the native dialog element for focus trapping.
        </p>
      </Modal>
      <SidePanel open={panel} onClose={() => setPanel(false)} title="Item: Launch landing page">
        <div className="flex items-center gap-2 text-sm text-muted">
          <Settings size={16} aria-hidden /> Item side panel content arrives in Phase 5.
        </div>
      </SidePanel>
    </div>
  );
}
