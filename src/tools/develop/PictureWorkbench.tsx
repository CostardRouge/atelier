import { useEffect, useRef } from 'react';
import {
  DevelopApplySection,
  DevelopClipboardActions,
  DevelopLookSection,
  DevelopPresetsSection,
} from '../../shared/develop/DevelopSections';
import DevelopHistogram from '../../shared/develop/DevelopHistogram';
import DevelopSliders from '../../shared/develop/DevelopSliders';
import DevelopViewport, { DevelopCaption } from '../../shared/develop/DevelopViewport';
import { isDefaultDevelop, type DevelopSettings } from '../../shared/develop/develop';
import { copyDevelop, pasteDevelop } from '../../shared/develop/develop-clipboard';
import { developPillClass } from '../../shared/develop/develop-classes';
import type { DevelopApplyVerb } from '../../shared/develop/develop-host';
import { pictureFidelity } from '../../shared/develop/picture-fidelity';
import { editorKeyAction } from '../../shared/develop/roll-editor';
import type { RollPicture } from '../../shared/develop/roll-types';
import { useDevelopDraft, useTold } from '../../shared/develop/use-develop-draft';
import { useDevelopPicture } from '../../shared/develop/use-develop-picture';
import { usePresetBookHost } from '../../shared/develop/use-preset-book';
import type { LutStack } from '../../shared/lut/use-lut-stack';
import { describeKeyTarget, targetOwnsTyping } from '../../shared/media/transport-keys';
import PanelHost from '../../shared/ui/PanelHost';
import StageZoomControl from '../../shared/ui/StageZoomControl';

/** How long the numbers rest before they are written to the roll. */
const WRITE_DELAY_MS = 200;
/** How long the picture rests before its filmstrip cell is redrawn. */
const SNAPSHOT_DELAY_MS = 700;

/**
 * ONE picture of a roll on the workbench — mounted with a `key` per picture,
 * so a draft never leaks onto the next photograph (the never-inherit rule).
 * It renders two grid cells (the stage, and the inspector — a column, or a
 * sheet on a phone) and leaves the filmstrip to its parent, so stepping along
 * the strip remounts this and never the strip.
 *
 * Unlike the modal there is no Done: the numbers are WRITTEN THROUGH to the
 * roll after a short rest, and on leaving the picture — the roll is the
 * document, and the editor saves it the way Trips saves a trip.
 */
export default function PictureWorkbench({
  picture: entry,
  file,
  stack,
  compact,
  sheetOpen,
  onSheetOpen,
  applyTo,
  onDevelop,
  onSnapshot,
  onStep,
}: {
  picture: RollPicture;
  /** The Library's file for it, or null when it is not there. */
  file: File | null;
  /** The roll's look; the draft rides it. */
  stack: LutStack;
  compact: boolean;
  sheetOpen: boolean;
  onSheetOpen: (open: boolean) => void;
  applyTo: readonly DevelopApplyVerb[];
  onDevelop: (develop: DevelopSettings | null) => void;
  onSnapshot: (thumb: Blob) => void;
  onStep: (step: number) => void;
}) {
  const presets = usePresetBookHost();
  const draft = useDevelopDraft(entry.develop, stack);
  const [told, tell] = useTold();
  const picture = useDevelopPicture({ file, cube: stack.composed });
  const fidelity = pictureFidelity(file);

  // --- write-through ---------------------------------------------------------
  const callbacks = useRef({ onDevelop, onSnapshot, onStep });
  callbacks.current = { onDevelop, onSnapshot, onStep };
  const pending = useRef<{ value: DevelopSettings | null } | null>(null);
  const writeTimer = useRef<number | null>(null);
  const mounted = useRef(false);
  const value = draft.draft;
  useEffect(() => {
    // The first draft IS the stored develop: nothing to write.
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    pending.current = { value: isDefaultDevelop(value) ? null : value };
    if (writeTimer.current !== null) window.clearTimeout(writeTimer.current);
    writeTimer.current = window.setTimeout(() => {
      writeTimer.current = null;
      const p = pending.current;
      pending.current = null;
      if (p) callbacks.current.onDevelop(p.value);
    }, WRITE_DELAY_MS);
    // Keyed on the numbers themselves: `draft` is a new object every render.
  }, [value]);
  // Leaving the picture writes what has not been written yet.
  useEffect(
    () => () => {
      if (writeTimer.current !== null) window.clearTimeout(writeTimer.current);
      const p = pending.current;
      pending.current = null;
      if (p) callbacks.current.onDevelop(p.value);
    },
    [],
  );

  // --- the filmstrip cell, redrawn as delivered once the picture rests -------
  const { source, cube, snapshot } = picture;
  useEffect(() => {
    if (!source) return;
    const t = window.setTimeout(() => {
      void snapshot().then((blob) => {
        if (blob) callbacks.current.onSnapshot(blob);
      });
    }, SNAPSHOT_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [source, cube, snapshot]);

  // --- keys --------------------------------------------------------------------
  const keyState = useRef({ draft, picture, tell });
  keyState.current = { draft, picture, tell };
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      // A question over the editor keeps every key.
      if (document.querySelector('[role="alertdialog"]')) return;
      const action = editorKeyAction({
        key: e.key,
        repeat: e.repeat,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        targetTypes: targetOwnsTyping(describeKeyTarget(e.target)),
        hasSelection: Boolean(window.getSelection()?.toString()),
      });
      if (!action) return;
      const { draft: d, picture: pic, tell: say } = keyState.current;
      switch (action) {
        case 'previous':
        case 'next':
          e.preventDefault();
          callbacks.current.onStep(action === 'next' ? 1 : -1);
          return;
        case 'hold':
          e.preventDefault();
          pic.setHolding(true);
          return;
        case 'zoom':
          e.preventDefault();
          if (pic.view.zoomed) pic.view.zoom.reset();
          else pic.view.zoom.zoomIn();
          return;
        case 'copy':
          if (d.asShot) return;
          e.preventDefault();
          copyDevelop(d.draft);
          say('copied');
          return;
        case 'paste': {
          const pasted = pasteDevelop();
          if (!pasted) return;
          e.preventDefault();
          d.setDraft(pasted);
          say('pasted');
          return;
        }
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === '\\') keyState.current.picture.setHolding(false);
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, []);

  return (
    <>
      <div className={compact ? 'flex-1 min-h-0 flex flex-col gap-2' : 'col-start-1 row-start-1 min-w-0 min-h-0 flex flex-col gap-2'}>
        {/* One row whatever the width: the name gives way first, the verbs never wrap. */}
        <div className="flex-none flex items-center gap-2 min-w-0">
          <span className="flex-1 min-w-0 truncate font-mono text-xs text-ink-soft" title={entry.ref.name}>
            {entry.ref.name}
            {told && <span className="text-accent-ink" role="status"> · {told}</span>}
          </span>
          {fidelity.chip && <span className={`${developPillClass} flex-none @max-[880px]:hidden`}>{fidelity.chip}</span>}
          <DevelopClipboardActions draft={draft.draft} asShot={draft.asShot} onReplace={draft.setDraft} onTold={tell} />
          {source && (
            <StageZoomControl zoom={picture.view.zoom} hint="wheel, pinch, or Z" className="flex-none max-[820px]:hidden" />
          )}
        </div>
        <DevelopViewport
          picture={picture}
          hasFile={Boolean(file)}
          emptyText="This picture is not in the Library — open its folder, or take it from its day on your Winnow. Its numbers can still be set."
          className="flex-1"
        />
        <DevelopCaption draft={draft.draft} note={fidelity.note} picture={picture} />
      </div>

      <PanelHost
        asSheet={compact}
        open={sheetOpen}
        onClose={() => onSheetOpen(false)}
        title={`Develop · ${entry.ref.name}`}
        className="col-start-2 row-start-1 row-span-2 min-h-0 overflow-y-auto overscroll-contain pr-1.5 flex flex-col gap-4"
      >
        <DevelopHistogram histogram={picture.histogram} />
        <DevelopSliders value={draft.draft} onChange={draft.set} />
        <DevelopPresetsSection
          presets={presets}
          draft={draft.draft}
          asShot={draft.asShot}
          onApply={draft.setDraft}
          onTold={tell}
        />
        <DevelopApplySection verbs={applyTo} draft={draft.draft} onTold={tell} />
        <DevelopLookSection stack={stack} />
      </PanelHost>
    </>
  );
}
