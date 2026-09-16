import { useEffect, useRef, useState } from 'react';
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
import { WORKBENCH_TABS, editorKeyAction, pictureAspectRatio, type WorkbenchTab } from '../../shared/develop/roll-editor';
import { framedThumbnail } from '../../shared/develop/roll-thumb';
import type { RollPicture } from '../../shared/develop/roll-types';
import { useDevelopDraft, useTold } from '../../shared/develop/use-develop-draft';
import { useDevelopPicture } from '../../shared/develop/use-develop-picture';
import { usePresetBookHost } from '../../shared/develop/use-preset-book';
import type { LutStack } from '../../shared/lut/use-lut-stack';
import { DEFAULT_FRAMING, isDefaultFraming, type Framing } from '../../shared/media/framing';
import { describeKeyTarget, targetOwnsTyping } from '../../shared/media/transport-keys';
import PanelHost from '../../shared/ui/PanelHost';
import Segmented from '../../shared/ui/Segmented';
import StageZoomControl from '../../shared/ui/StageZoomControl';
import CropPanel from './CropPanel';
import FramingStage from './FramingStage';

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
 * document, and the editor saves it the way Trips saves a trip. The crop is
 * written the same way, on its own timer: a drag fires far more often than a
 * slider ever does.
 *
 * Two tabs over one stage: Develop shows the picture with the wipe and the
 * zoom; Crop frames the SAME delivered picture into its aspect box, where a
 * drag moves it instead of comparing. The viewport stays mounted under the
 * crop stage (hidden), because its paint is keyed on the picture, not on the
 * canvas element — a remounted canvas would come back blank.
 */
export default function PictureWorkbench({
  picture: entry,
  file,
  stack,
  compact,
  sheetOpen,
  onSheetOpen,
  tab,
  onTabChange,
  applyTo,
  onDevelop,
  onFraming,
  onAspect,
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
  /** Which inspector tab is open — lifted to the editor so it survives stepping to another picture. */
  tab: WorkbenchTab;
  onTabChange: (tab: WorkbenchTab) => void;
  applyTo: readonly DevelopApplyVerb[];
  onDevelop: (develop: DevelopSettings | null) => void;
  onFraming: (framing: Framing | null) => void;
  onAspect: (aspect: string) => void;
  onSnapshot: (thumb: Blob) => void;
  onStep: (step: number) => void;
}) {
  const presets = usePresetBookHost();
  const draft = useDevelopDraft(entry.develop, stack);
  const [told, tell] = useTold();
  const picture = useDevelopPicture({ file, cube: stack.composed });
  const fidelity = pictureFidelity(file);
  // Read once, like the develop: the workbench is keyed per picture.
  const [framingDraft, setFramingDraft] = useState<Framing>(entry.framing ?? { ...DEFAULT_FRAMING });

  // --- write-through ---------------------------------------------------------
  const callbacks = useRef({ onDevelop, onFraming, onAspect, onSnapshot, onStep, onTabChange });
  callbacks.current = { onDevelop, onFraming, onAspect, onSnapshot, onStep, onTabChange };
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

  // --- the crop, written through the same way, on its own timer ------------
  const framingPending = useRef<{ value: Framing | null } | null>(null);
  const framingTimer = useRef<number | null>(null);
  const framingMounted = useRef(false);
  useEffect(() => {
    if (!framingMounted.current) {
      framingMounted.current = true;
      return;
    }
    framingPending.current = { value: isDefaultFraming(framingDraft) ? null : framingDraft };
    if (framingTimer.current !== null) window.clearTimeout(framingTimer.current);
    framingTimer.current = window.setTimeout(() => {
      framingTimer.current = null;
      const p = framingPending.current;
      framingPending.current = null;
      if (p) callbacks.current.onFraming(p.value);
    }, WRITE_DELAY_MS);
  }, [framingDraft]);
  useEffect(
    () => () => {
      if (framingTimer.current !== null) window.clearTimeout(framingTimer.current);
      const p = framingPending.current;
      framingPending.current = null;
      if (p) callbacks.current.onFraming(p.value);
    },
    [],
  );

  // --- the filmstrip cell, redrawn as delivered once the picture rests -------
  // Delivered means graded AND framed: the strip shows the crop as well as
  // the light. Keyed on the crop too, so a drag that rests redraws the cell.
  const { source, cube, delivered } = picture;
  const aspectRatio = pictureAspectRatio(entry.aspect, source?.width ?? 0, source?.height ?? 0);
  useEffect(() => {
    if (!source) return;
    const t = window.setTimeout(() => {
      const image = delivered();
      if (!image) return;
      void framedThumbnail(image, source.width, source.height, aspectRatio, framingDraft).then((blob) => {
        if (blob) callbacks.current.onSnapshot(blob);
      });
    }, SNAPSHOT_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [source, cube, delivered, aspectRatio, framingDraft]);

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
        case 'crop':
          e.preventDefault();
          callbacks.current.onTabChange('crop');
          return;
        case 'develop':
          e.preventDefault();
          callbacks.current.onTabChange('develop');
          return;
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

  const cropping = tab === 'crop';
  const tabLabel = WORKBENCH_TABS.find((t) => t.id === tab)?.label ?? 'Develop';
  const emptyText =
    'This picture is not in the Library — open its folder, or take it from its day on your Winnow. Its numbers can still be set.';

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
          {!cropping && (
            <>
              <DevelopClipboardActions draft={draft.draft} asShot={draft.asShot} onReplace={draft.setDraft} onTold={tell} />
              {source && (
                <StageZoomControl zoom={picture.view.zoom} hint="wheel, pinch, or Z" className="flex-none max-[820px]:hidden" />
              )}
            </>
          )}
        </div>
        <DevelopViewport
          picture={picture}
          hasFile={Boolean(file)}
          emptyText={emptyText}
          className={cropping ? 'hidden' : 'flex-1'}
        />
        {cropping && (
          <FramingStage
            picture={picture}
            aspectRatio={aspectRatio}
            framing={framingDraft}
            onFraming={setFramingDraft}
            emptyText={emptyText}
            className="flex-1"
          />
        )}
        {cropping ? (
          <p className="m-0 flex-none font-mono text-2xs text-faint leading-relaxed">
            {source
              ? `drag to move the picture, wheel or pinch to zoom · ${framingDraft.fit === 'contain' ? 'whole picture, bars where it falls short' : 'filling the frame'}`
              : 'the crop needs the picture'}
          </p>
        ) : (
          <DevelopCaption draft={draft.draft} note={fidelity.note} picture={picture} />
        )}
      </div>

      <PanelHost
        asSheet={compact}
        open={sheetOpen}
        onClose={() => onSheetOpen(false)}
        title={`${tabLabel} · ${entry.ref.name}`}
        // The docked inspector wears the frame both editors' inspectors wear
        // (`frontend.md`): the tab strip pinned, the sections scrolling under it.
        className="col-start-2 row-start-1 row-span-2 min-h-0 flex flex-col gap-3 border border-line rounded-paper bg-surface p-3"
      >
        {!compact && (
          <Segmented fill size="sm" label="Inspector" value={tab} onChange={onTabChange} options={WORKBENCH_TABS} className="flex-none" />
        )}
        <div className={compact ? 'flex flex-col gap-4' : 'flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain flex flex-col gap-4 -mr-3 pr-3'}>
          {tab === 'develop' ? (
            <>
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
            </>
          ) : (
            <CropPanel framing={framingDraft} aspect={entry.aspect} onFraming={setFramingDraft} onAspect={onAspect} />
          )}
        </div>
      </PanelHost>
    </>
  );
}
