import {
  customSections,
  LIST_TYPES,
  TEMPLATES,
  type ListTypeId,
  type TemplateId,
} from '@app/shared';
import { Globe, Lock } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar, Button, Modal, TextField } from '../../components/ui';
import { cx } from '../../lib/cx';
import { friendlyError } from '../../lib/firestore/errors';
import { toast } from '../../stores/toast';
import { useCurrentUser } from '../auth/AuthProvider';
import { useWorkspace } from '../workspaces/WorkspaceProvider';
import { createBoard } from './api';
import { useBoards } from './BoardsProvider';

export function CreateBoardDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const { workspace } = useWorkspace();
  const { boards, members } = useBoards();
  const [template, setTemplate] = useState<TemplateId>('chores');
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<'main' | 'private'>('main');
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [listType, setListType] = useState<ListTypeId>('template');
  const [custom, setCustom] = useState('');
  const sections =
    listType === 'custom'
      ? customSections(custom)
      : (LIST_TYPES.find((t) => t.id === listType)?.sections ?? []);
  const chosen = TEMPLATES.find((t) => t.id === template);
  const finalName = name.trim() || chosen?.name || 'New list';

  async function submit() {
    setBusy(true);
    try {
      const bid = await createBoard({
        wid: workspace.id,
        uid: user.uid,
        name: finalName,
        template,
        sections,
        visibility,
        memberIds,
        lastOrder: boards?.at(-1)?.order ?? null,
      });
      onClose();
      setName('');
      navigate(`/w/${workspace.id}/b/${bid}`);
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  const others = (members ?? []).filter((m) => m.uid !== user.uid);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New list"
      className="sm:w-[min(44rem,calc(100vw-2rem))]"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={busy || (listType === 'custom' && sections.length === 0)}
          >
            Create list
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Start from</legend>
          <div role="radiogroup" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={template === t.id}
                onClick={() => setTemplate(t.id)}
                className={cx(
                  'flex items-start gap-3 rounded-2xl border p-3 text-left transition-colors',
                  template === t.id
                    ? 'border-primary bg-primary-soft'
                    : 'border-border hover:bg-surface-2',
                )}
              >
                <span className="text-2xl" aria-hidden>
                  {t.emoji}
                </span>
                <span>
                  <span className="block text-sm font-bold">{t.name}</span>
                  <span className="block text-xs text-muted">{t.description}</span>
                </span>
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-1 text-sm font-semibold">Groups (sections)</legend>
          <p className="mb-2 text-xs text-muted">
            Items sit in one of these. Change an item’s Group column to move it.
          </p>
          <div role="radiogroup" aria-label="List type" className="flex flex-wrap gap-2">
            {LIST_TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={listType === t.id}
                onClick={() => setListType(t.id)}
                className={cx(
                  'rounded-xl border px-3 py-1.5 text-sm',
                  listType === t.id
                    ? 'border-primary bg-primary-soft font-semibold'
                    : 'border-border hover:bg-surface-2',
                )}
              >
                {t.name}
                {t.sections.length > 0 && (
                  <span className="block text-xs text-muted">
                    {t.sections.map((s) => s.name).join(' · ')}
                  </span>
                )}
              </button>
            ))}
          </div>
          {listType === 'custom' && (
            <TextField
              label="Your groups, separated by commas"
              placeholder="e.g. This week, Next week, Someday"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              className="mt-2"
            />
          )}
        </fieldset>
        <TextField
          label="List name"
          placeholder={chosen?.name}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Who can see it</legend>
          <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ['main', Globe, 'Everyone in the household', 'All members can find and open it.'],
                ['private', Lock, 'Private', 'Only people you choose (and admins).'],
              ] as const
            ).map(([v, Icon, title, desc]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={visibility === v}
                onClick={() => setVisibility(v)}
                className={cx(
                  'flex items-start gap-3 rounded-2xl border p-3 text-left',
                  visibility === v
                    ? 'border-primary bg-primary-soft'
                    : 'border-border hover:bg-surface-2',
                )}
              >
                <Icon size={18} aria-hidden className="mt-0.5 shrink-0" />
                <span>
                  <span className="block text-sm font-bold">{title}</span>
                  <span className="block text-xs text-muted">{desc}</span>
                </span>
              </button>
            ))}
          </div>
        </fieldset>
        {visibility === 'private' && others.length > 0 && (
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">Share with</legend>
            <div className="flex flex-col gap-1">
              {others.map((m) => (
                <label
                  key={m.uid}
                  className="flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-surface-2"
                >
                  <input
                    type="checkbox"
                    checked={memberIds.includes(m.uid)}
                    onChange={(e) =>
                      setMemberIds((ids) =>
                        e.target.checked ? [...ids, m.uid] : ids.filter((x) => x !== m.uid),
                      )
                    }
                  />
                  <Avatar name={m.name} photoURL={m.photoURL} size="sm" />
                  <span className="text-sm">{m.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
      </div>
    </Modal>
  );
}
