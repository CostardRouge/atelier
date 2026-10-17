import { useMemo, useState } from 'react';
import { PICTURE_SECTIONS } from '../../shared/develop/picture-sections';
import type { RollPicture, SectionValues } from '../../shared/develop/roll-types';
import { differsFrom, nextSnapshotName, pictureHistory, snapshotRefusal, type HistoryEntry } from '../../shared/develop/snapshots';
import Button from '../../shared/ui/Button';
import { Icons } from '../../shared/ui/icons';
import { InspectorSection } from '../../shared/ui/Inspector';
import OverflowMenu from '../../shared/ui/OverflowMenu';
import { focusOnMount } from '../../shared/ui/focus';

/** How many steps are drawn before *Show all*. */
const FIRST_STEPS = 40;

/**
 * The History tab (item 31 of `docs/lightroom-gaps.md`): Lightroom's
 * Snapshots and History panels over what the roll keeps on the picture
 * (`snapshots.ts`). A click on a row puts the picture back to that state in
 * ONE write — ⌘Z brings it back, and the list itself never loses a step: going
 * back is a step of its own, on top. The picture on the stage is the preview.
 */
export default function HistoryPanel({
  picture,
  onRestore,
  onTake,
  onRename,
  onRemove,
}: {
  picture: RollPicture;
  /** The picture back to `values`; `label` says what to, for the stage's line. */
  onRestore: (values: SectionValues, label: string) => void;
  onTake: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
}) {
  const steps = useMemo(() => pictureHistory(picture), [picture]);
  const snapshots = picture.snapshots ?? [];
  const refusal = snapshotRefusal(picture);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [all, setAll] = useState(false);
  const shown = all ? steps : steps.slice(0, FIRST_STEPS);
  const now = Date.now();
  const commitRename = () => {
    if (renaming) onRename(renaming.id, renaming.name);
    setRenaming(null);
  };

  return (
    <>
      <InspectorSection
        id="develop.snapshots"
        title="Snapshots"
        remember="session"
        badge={snapshots.length > 0 ? String(snapshots.length) : undefined}
        info={
          <p>
            A snapshot keeps every section of this picture as it stands — the develop, the crop, the look, the
            layers, the repair — under a name, to come back to after trying something else. It stays with the
            picture in the roll; a variant made as edited takes them along. A click on one puts the picture back
            to it; ⌘Z undoes that.
          </p>
        }
        actions={
          <Button
            size="sm"
            icon={Icons.plus}
            disabled={Boolean(refusal)}
            title={refusal ?? `Keep this state as “${nextSnapshotName(picture)}”`}
            onClick={() => onTake('')}
          >
            Take
          </Button>
        }
      >
        {snapshots.length === 0 ? (
          <p className="m-0 py-2 text-xs leading-snug text-muted">None yet — <em>Take</em> keeps this state under a name.</p>
        ) : (
          <ul className="m-0 p-0 list-none flex flex-col border-t border-line">
            {[...snapshots].reverse().map((s) => {
              const differs = differsFrom(picture, s.values);
              const here = differs.length === 0;
              return (
                <li key={s.id} className="flex items-center gap-1 min-w-0 border-b border-line" data-snapshot={s.id}>
                  {renaming?.id === s.id ? (
                    <input
                      // The name is being typed: Enter keeps it, Escape leaves it.
                      ref={focusOnMount}
                      value={renaming.name}
                      aria-label="Snapshot name"
                      maxLength={80}
                      onChange={(e) => setRenaming({ id: s.id, name: e.target.value })}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename();
                        if (e.key === 'Escape') {
                          e.stopPropagation();
                          setRenaming(null);
                        }
                      }}
                      className="flex-1 min-w-0 my-1.5 h-8 px-2 rounded-control border border-line-strong bg-surface text-sm"
                    />
                  ) : (
                    <button
                      type="button"
                      disabled={here}
                      onClick={() => onRestore(s.values, `snapshot “${s.name}”`)}
                      title={here ? 'The picture is this snapshot now' : `Back to “${s.name}” — ${sectionWords(differs)} change (⌘Z undoes it)`}
                      className="touch-row flex-1 min-w-0 flex items-center gap-2 min-h-10 px-1 border-0 bg-transparent text-left cursor-pointer hover:bg-paper disabled:cursor-default disabled:hover:bg-transparent"
                    >
                      <span className="flex-1 min-w-0 truncate text-sm text-ink">{s.name}</span>
                      <span className="flex-none font-mono text-3xs text-faint tabular-nums">{when(s.at, now)}</span>
                      {here && <span className="flex-none font-mono text-3xs text-accent-ink">now</span>}
                    </button>
                  )}
                  <OverflowMenu
                    label={`Actions for “${s.name}”`}
                    items={[
                      { id: 'rename', label: 'Rename…', onSelect: () => setRenaming({ id: s.id, name: s.name }) },
                      { id: 'remove', label: 'Remove the snapshot', danger: true, title: 'The picture stays as it is', onSelect: () => onRemove(s.id) },
                    ]}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </InspectorSection>

      <InspectorSection
        id="develop.history"
        title="History"
        remember="session"
        badge={String(steps.length - 1)}
        info={
          <>
            <p>
              Every step this picture was edited by, newest first, kept in the roll — so it is still here after a
              reload, where ⌘Z is not. A click puts the picture back to how it stood after that step, as one step
              of its own on top: nothing below is lost, and ⌘Z undoes the click.
            </p>
            <p>A picture edited before the history existed lists its sections in a standard order, not the one they were made in.</p>
          </>
        }
      >
        <ol className="m-0 p-0 list-none flex flex-col border-t border-line">
          {shown.map((step) => (
            <StepRow key={step.key} step={step} now={now} onRestore={onRestore} />
          ))}
        </ol>
        {!all && steps.length > FIRST_STEPS && (
          <Button size="sm" variant="ghost" className="self-start mt-2" onClick={() => setAll(true)}>
            Show all {steps.length} steps
          </Button>
        )}
      </InspectorSection>
    </>
  );
}

function StepRow({ step, now, onRestore }: { step: HistoryEntry; now: number; onRestore: (values: SectionValues, label: string) => void }) {
  return (
    <li className="border-b border-line" data-step={step.key}>
      <button
        type="button"
        disabled={step.current}
        onClick={() => onRestore(step.values, step.key === 'shot' ? 'as shot' : 'an earlier step')}
        title={step.current ? 'The picture as it stands' : 'Back to how the picture stood after this step (⌘Z undoes it)'}
        className="touch-row w-full flex items-start gap-2 min-h-10 px-1 py-1.5 border-0 bg-transparent text-left cursor-pointer hover:bg-paper disabled:cursor-default disabled:hover:bg-transparent"
      >
        <span className={`flex-1 min-w-0 text-xs leading-snug line-clamp-2 ${step.current ? 'text-ink' : 'text-ink-soft'}`}>
          {step.caption}
          {step.reconstructed && <span className="text-faint"> · standard order</span>}
        </span>
        <span className="flex-none font-mono text-3xs tabular-nums pt-0.5 text-faint">
          {step.current ? <span className="text-accent-ink">now</span> : step.at !== null ? when(step.at, now) : ''}
        </span>
      </button>
    </li>
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
