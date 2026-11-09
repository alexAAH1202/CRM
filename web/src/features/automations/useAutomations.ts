import { boardPaths, parseAutomation, type Automation } from '@app/shared';
import { collection } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from '../../lib/firebase';
import { listenQuery } from '../../lib/firestore';
import type { Board, BoardItem, WorkspaceMember } from '../boards/types';
import { setBoardRuntime } from './runtime';

/** The board's automations (a handful of small docs; one listener while the board is open). */
export function useAutomations(
  wid: string,
  bid: string,
): { automations: Automation[]; ready: boolean } {
  const [state, setState] = useState<{ automations: Automation[]; ready: boolean }>({
    automations: [],
    ready: false,
  });
  useEffect(() => {
    setState({ automations: [], ready: false });
    return listenQuery(
      'automations',
      collection(db, boardPaths.automations(wid, bid)),
      (snap) =>
        setState({
          ready: true,
          automations: snap.docs
            .map((d) => parseAutomation(d.id, d.data()))
            .filter((a): a is Automation => a !== null)
            .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
        }),
      () => setState({ automations: [], ready: true }),
    );
  }, [wid, bid]);
  return state;
}

/** Keeps the engine's view of the open board current (cleared when the board closes). */
export function useBoardAutomationsRegistration(input: {
  wid: string;
  board: Board;
  automations: Automation[];
  items: ReadonlyMap<string, BoardItem> | null;
  members: WorkspaceMember[] | null;
  memberName: (uid: string) => string;
  tz: string;
}) {
  const { wid, board, automations, items, members, memberName, tz } = input;
  useEffect(() => {
    if (!items || !members) return;
    setBoardRuntime({
      wid,
      board,
      automations,
      items,
      memberUids: new Set(members.map((m) => m.uid)),
      memberName,
      tz,
    });
  }, [wid, board, automations, items, members, memberName, tz]);
  useEffect(() => () => setBoardRuntime(null), []);
}
