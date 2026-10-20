import { useCallback, useMemo, useRef, useState } from 'react';
import { PICTURE_SECTIONS } from '../../shared/develop/picture-sections';
import { pictureStepCaption, rollStepCaption } from '../../shared/develop/picture-walk';
import type { PictureSnapshot, RollDoc, RollPicture, SectionValues } from '../../shared/develop/roll-types';
import { differsFrom, nextSnapshotName, pictureHistory, snapshotRefusal } from '../../shared/develop/snapshots';
import UndoRedo, { HALF } from '../../shared/history/UndoRedo';
import Button from '../../shared/ui/Button';
import { Icons } from '../../shared/ui/icons';
import { AnchoredPopover } from '../../shared/ui/OverflowMenu';
import Segmented from '../../shared/ui/Segmented';
import { focusOnMount } from '../../shared/ui/focus';
import type { DevelopUndo, UndoScope } from './use-develop-undo';

/** How many rows a list draws before *Show all*. */
const FIRST_ROWS = 40;

export interface HistoryControlProps {
  undo: DevelopUndo;
  roll: RollDoc;
  /** The open picture; null on an empty roll. */
  picture: RollPicture | null;
  /** The picture back to `values` in one write; `label` says what to. */
  onRestore: (values: SectionValues, label: string) => void;
  onTake: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
  /** The same snapshot on every picture of the roll (◆◆). */
  onTakeRoll: () => void;
  onRestoreRoll: (group: string, name: string) => void;
  onRenameRoll: (group: string, name: string) => void;
  onRemoveRoll: (group: string) => void;
}

/**
 * ↶ | ↷ | the history (2026-10-20, his pick of the history lab
 * https://claude.ai/artifact/1caHRkXiJFytfFCBjhUeRK, variant 4, and of the
 * undo-scope lab https://claude.ai/artifact/9DWWRJzStAeFCMJDn5jP3n).
 *
 * The History TAB is gone: its snapshots and steps open from a third segment
 * of the undo pair — a history glyph whose badge counts the steps ↶ has —
 * which saves the inspector a tab and a phone's bottom bar a cell. The menu
 * also says what ↶ ↷ step through, the roll or this photo (`picture-walk.ts`),
 * a choice the device keeps.
 */
export default function HistoryControl(props: HistoryControlProps) {
  const { undo } = props;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const anchorRect = useCallback(() => rootRef.current?.getBoundingClientRect() ?? null, []);
  const close = useCallback(() => setOpen(false), []);
  const photo = undo.scope === 'photo';
  const label = open ? 'Close the history' : `History and snapshots — ↶ ↷ step through ${photo ? 'this photo' : 'the roll'}`;

  return (
    <span ref={rootRef} className="inline-flex shrink-0">
      <UndoRedo
        canUndo={undo.canUndo}
        canRedo={undo.canRedo}
        onUndo={undo.undo}
        onRedo={undo.redo}
        what={photo ? 'edit of this photo' : 'edit'}
        more={
          <button
            type="button"
            className={`${HALF} w-[2.375rem] ${open ? 'bg-paper-2' : ''}`}
            aria-label={label}
            title={label}
            aria-expanded={open}
            aria-haspopup="dialog"
            data-history-menu=""
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
            }}
          >
            <span className="relative inline-flex">
              {Icons.clock}
              {undo.count > 0 && (
                <span
                  aria-hidden="true"
                  className={`absolute -top-1.5 -right-2.5 min-w-[0.95rem] h-[0.95rem] px-[3px] rounded-full font-mono text-3xs leading-[0.95rem] text-center tabular-nums ${
                    photo ? 'bg-ink-soft text-paper' : 'bg-accent text-paper'
                  }`}
                >
                  {undo.count > 99 ? '99+' : undo.count}
                </span>
              )}
              {/* The photo's scope says itself on the glyph too, not by colour alone. */}
              {photo && <span aria-hidden="true" className="absolute -bottom-1 -right-2 w-[7px] h-[7px] rounded-[2px] bg-ink-soft ring-[1.5px] ring-surface" />}
            </span>
          </button>
        }
      />
      {open && (
        <AnchoredPopover
          anchorRect={anchorRect}
          onClose={close}
          side="below"
          align="end"
          within={rootRef}
          role="dialog"
          label="History and snapshots"
          className="w-[22rem] max-w-[calc(100vw-1rem)] p-0"
        >
          <HistoryMenu {...props} />
        </AnchoredPopover>
      )}
    </span>
  );
}

const SCOPES = [
  { id: 'roll' as const, label: 'The roll', title: '↶ takes the roll’s newest step off, whatever picture it touched' },
  { id: 'photo' as const, label: 'This photo', title: '↶ puts the open photo alone back one step, the others untouched' },
];

function HistoryMenu({
  undo,
  roll,
  picture,
  onRestore,
  onTake,
  onRename,
  onRemove,
  onTakeRoll,
  onRestoreRoll,
  onRenameRoll,
  onRemoveRoll,
}: HistoryControlProps) {
  const photo = undo.scope === 'photo';
  return (
    <div className="flex flex-col min-h-0">
      <div className="flex flex-col gap-1.5 px-3 pt-3 pb-2.5 border-b border-line">
        <span className="font-mono text-3xs tracking-[0.1em] uppercase text-muted">↶ ↷ step through</span>
        <Segmented<UndoScope> options={SCOPES} value={undo.scope} onChange={undo.setScope} size="sm" fill label="What undo steps through" />
      </div>
      {picture && (
        <Snapshots
          picture={picture}
          roll={roll}
          onRestore={onRestore}
          onTake={onTake}
          onRename={onRename}
          onRemove={onRemove}
          onTakeRoll={onTakeRoll}
          onRestoreRoll={onRestoreRoll}
          onRenameRoll={onRenameRoll}
          onRemoveRoll={onRemoveRoll}
        />
      )}
      {photo ? (picture ? <PhotoSteps undo={undo} picture={picture} onRestore={onRestore} /> : null) : <RollSteps undo={undo} />}
      <p className="m-0 px-3 py-2 border-t border-line text-3xs leading-snug text-muted pointer-coarse:hidden">
        ⌥⌘Z steps the open photo back, whichever is chosen.
      </p>
    </div>
  );
}

function Snapshots({
  picture,
  roll,
  onRestore,
  onTake,
  onRename,
  onRemove,
  onTakeRoll,
  onRestoreRoll,
  onRenameRoll,
  onRemoveRoll,
}: Omit<HistoryControlProps, 'undo' | 'picture'> & { picture: RollPicture }) {
  const snapshots = picture.snapshots ?? [];
  const refusal = snapshotRefusal(picture);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const now = Date.now();
  const many = roll.pictures.length > 1;
  const commitRename = (s: PictureSnapshot) => {
    if (renaming) {
      if (s.group) onRenameRoll(s.group, renaming.name);
      else onRename(s.id, renaming.name);
    }
    setRenaming(null);
  };

  return (
    <section aria-label="Snapshots" className="flex flex-col px-3 py-2.5 border-b border-line gap-1.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-sm font-medium text-ink mr-auto">Snapshots</span>
        <Button size="sm" icon={Icons.plus} disabled={Boolean(refusal)} title={refusal ?? `Keep this photo as “${nextSnapshotName(picture)}”`} onClick={() => onTake('')}>
          Photo
        </Button>
        {many && (
          <Button size="sm" icon={Icons.plus} title={`Keep every picture of the roll as it stands, under one name — ${roll.pictures.length} pictures`} onClick={onTakeRoll}>
            All {roll.pictures.length}
          </Button>
        )}
      </div>
      {snapshots.length === 0 ? (
        <p className="m-0 text-xs leading-snug text-muted">None yet — a snapshot keeps a state under a name, to come back to.</p>
      ) : (
        <ul className="m-0 p-0 list-none flex flex-col">
          {[...snapshots].reverse().map((s) => {
            const here = differsFrom(picture, s.values).length === 0;
            const whole = Boolean(s.group);
            return (
              <li key={s.id} className="flex flex-col border-t border-line first:border-t-0" data-snapshot={s.id}>
                <div className="flex items-center gap-1 min-w-0">
                  {renaming?.id === s.id ? (
                    <input
                      ref={focusOnMount}
                      value={renaming.name}
                      aria-label="Snapshot name"
                      maxLength={80}
                      onChange={(e) => setRenaming({ id: s.id, name: e.target.value })}
                      onBlur={() => commitRename(s)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(s);
                        if (e.key === 'Escape') {
                          e.stopPropagation();
                          setRenaming(null);
                        }
                      }}
                      className="flex-1 min-w-0 my-1 h-8 px-2 rounded-control border border-line-strong bg-surface text-sm"
                    />
                  ) : (
                    <button
                      type="button"
                      aria-disabled={here && !whole ? true : undefined}
                      onClick={() => {
                        if (whole && s.group) onRestoreRoll(s.group, s.name);
                        else if (!here) onRestore(s.values, `snapshot “${s.name}”`);
                      }}
                      title={
                        whole
                          ? `Every picture back to “${s.name}” in one step (⌘Z undoes it)`
                          : here
                            ? 'The photo is this snapshot now'
                            : `Back to “${s.name}” — ${sectionWords(differsFrom(picture, s.values))} change (⌘Z undoes it)`
                      }
                      className="touch-row flex-1 min-w-0 flex items-center gap-2 min-h-9 px-1 border-0 bg-transparent text-left cursor-pointer hover:bg-paper aria-disabled:cursor-default aria-disabled:hover:bg-transparent"
                    >
                      <span aria-hidden="true" className="flex-none w-5 text-center text-2xs text-accent-ink">
                        {whole ? '◆◆' : '◆'}
                      </span>
                      <span className="flex-1 min-w-0 truncate text-sm text-ink">{s.name}</span>
                      <span className="flex-none font-mono text-3xs text-faint tabular-nums">{when(s.at, now)}</span>
                      {here && <span className="flex-none font-mono text-3xs text-accent-ink">now</span>}
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={`Actions for “${s.name}”`}
                    title={`Actions for “${s.name}”`}
                    aria-expanded={acting === s.id}
                    onClick={() => setActing((a) => (a === s.id ? null : s.id))}
                    className="touch-halo flex-none grid place-items-center w-7 h-7 border-0 rounded-control bg-transparent text-ink-soft cursor-pointer hover:bg-paper-2 [&>svg]:w-4 [&>svg]:h-4"
                  >
                    {Icons.more}
                  </button>
                </div>
                {/* Inline, not a second popover: a menu portalled out of this
                    one would close it on its own press. */}
                {acting === s.id && (
                  <div className="flex gap-1.5 pb-1.5 pl-6">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setActing(null);
                        setRenaming({ id: s.id, name: s.name });
                      }}
                    >
                      Rename
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      title={whole ? 'Taken off every picture; the pictures stay as they are' : 'The photo stays as it is'}
                      onClick={() => {
                        setActing(null);
                        if (whole && s.group) onRemoveRoll(s.group);
                        else onRemove(s.id);
                      }}
                    >
                      {whole ? 'Remove from every picture' : 'Remove'}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

interface Row {
  key: string;
  caption: string;
  tag: string;
  /** Undone: drawn faint and slanted, a redo away. */
  ahead?: boolean;
  current?: boolean;
  note?: string;
  title: string;
  go: (() => void) | null;
}

/**
 * The open photo's steps: its journal, kept with the roll so it outlives a
 * reload, under what its walk back has undone this session (a redo away).
 */
function PhotoSteps({ undo, picture, onRestore }: { undo: DevelopUndo; picture: RollPicture; onRestore: HistoryControlProps['onRestore'] }) {
  const rows = useMemo<Row[]>(() => {
    const { walk, goTo } = undo.photo;
    const ahead: Row[] = [];
    if (walk) {
      for (let k = walk.seq.length - 1; k > walk.i; k--) {
        ahead.push({
          key: `ahead-${k}`,
          caption: pictureStepCaption(walk.seq[k - 1] ?? null, walk.seq[k]),
          tag: 'redo',
          ahead: true,
          title: 'Redo the photo up to this step',
          go: () => goTo(k),
        });
      }
    }
    const steps = pictureHistory(picture).map<Row>((step) => ({
      key: step.key,
      caption: step.caption,
      note: step.reconstructed ? ' · standard order' : undefined,
      tag: step.current ? 'now' : step.at !== null ? when(step.at, Date.now()) : '',
      current: step.current,
      title: step.current ? 'The photo as it stands' : 'Back to how the photo stood after this step — a step of its own (⌘Z undoes it)',
      go: step.current ? null : () => onRestore(step.values, step.key === 'shot' ? 'as shot' : 'an earlier step'),
    }));
    return [...ahead, ...steps];
  }, [undo.photo.walk, undo.photo.goTo, picture, onRestore]);
  return <StepList heading="This photo — newest first, kept with the roll" rows={rows} />;
}

/** The roll's record this session: what ↶ ↷ walk in the roll's scope, a row a jump of that many. */
function RollSteps({ undo }: { undo: DevelopUndo }) {
  const { read, jump, depth, ahead } = undo.roll;
  const rows = useMemo<Row[]>(() => {
    const h = read();
    const out: Row[] = [];
    // The future, nearest first in the record: drawn farthest at the top.
    for (let k = h.future.length - 1; k >= 0; k--) {
      const before = k === 0 ? h.present : h.future[k - 1];
      out.push({
        key: `f${k}`,
        caption: rollStepCaption(before, h.future[k]),
        tag: 'redo',
        ahead: true,
        title: k === 0 ? 'Redo this step' : `Redo ${k + 1} steps, up to this one`,
        go: () => jump(k + 1),
      });
    }
    out.push({
      key: 'now',
      caption: h.past.length > 0 ? rollStepCaption(h.past[h.past.length - 1], h.present) : 'The roll as this session opened it',
      tag: 'now',
      current: true,
      title: 'The roll as it stands',
      go: null,
    });
    for (let j = h.past.length - 1; j >= 0; j--) {
      const n = h.past.length - j;
      out.push({
        key: `p${j}`,
        caption: j > 0 ? rollStepCaption(h.past[j - 1], h.past[j]) : 'The roll as this session opened it',
        tag: `↶ ×${n}`,
        title: `Undo ${n} step${n === 1 ? '' : 's'}, back to here (↷ brings ${n === 1 ? 'it' : 'them'} back)`,
        go: () => jump(-n),
      });
    }
    return out;
    // `read` is stable; the record's lengths say when it moved.
  }, [read, jump, depth, ahead]);
  return <StepList heading="The roll, this session — newest first" rows={rows} />;
}

function StepList({ heading, rows }: { heading: string; rows: readonly Row[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, FIRST_ROWS);
  return (
    <section aria-label={heading} className="flex flex-col py-1.5">
      <span className="px-3 pt-1 pb-1.5 text-3xs text-muted">{heading}</span>
      <ol className="m-0 p-0 list-none flex flex-col">
        {shown.map((r) => (
          <li key={r.key} className="border-t border-line">
            <button
              type="button"
              aria-disabled={r.go ? undefined : true}
              onClick={() => r.go?.()}
              title={r.title}
              className={`touch-row w-full flex items-start gap-2 min-h-10 px-3 py-1.5 border-0 text-left cursor-pointer hover:bg-paper aria-disabled:cursor-default aria-disabled:hover:bg-transparent ${
                r.current ? 'bg-paper' : 'bg-transparent'
              }`}
            >
              <span className={`flex-1 min-w-0 text-xs leading-snug line-clamp-2 ${r.ahead ? 'italic text-muted' : r.current ? 'text-ink' : 'text-ink-soft'}`}>
                {r.caption}
                {r.note && <span className="text-faint">{r.note}</span>}
              </span>
              <span className={`flex-none font-mono text-3xs tabular-nums pt-0.5 ${r.current ? 'text-accent-ink' : 'text-faint'}`}>{r.tag}</span>
            </button>
          </li>
        ))}
      </ol>
      {!all && rows.length > FIRST_ROWS && (
        <Button size="sm" variant="ghost" className="self-start mx-3 mt-1.5" onClick={() => setAll(true)}>
          Show all {rows.length}
        </Button>
      )}
    </section>
  );
}

/** `21:40` today, `17 Oct 21:40` another day. */
function when(at: number, now: number): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return new Date(now).toDateString() === d.toDateString() ? time : `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${time}`;
}

/** `the develop and the crop` — the sections a restore would change, in words. */
function sectionWords(sections: readonly string[]): string {
  const names = sections.map((id) => (PICTURE_SECTIONS.find((s) => s.id === id)?.label ?? id).toLowerCase());
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
