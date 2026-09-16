import { useEffect, useMemo, useRef, useState } from 'react';
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
import { useDevelopPicture, type DevelopFrame } from '../../shared/develop/use-develop-picture';
import { usePresetBookHost } from '../../shared/develop/use-preset-book';
import type { LutStack } from '../../shared/lut/use-lut-stack';
import {
  DEFAULT_FRAMING,
  MAX_FRAMING_SCALE,
  isDefaultFraming,
  scaleFramingBy,
  type Framing,
} from '../../shared/media/framing';
import { describeKeyTarget, targetOwnsTyping } from '../../shared/media/transport-keys';
import PanelHost from '../../shared/ui/PanelHost';
import Segmented from '../../shared/ui/Segmented';
import StageZoomControl from '../../shared/ui/StageZoomControl';
import { STAGE_ZOOM_STEP, type ZoomControls } from '../../shared/ui/stage-zoom';
import type { RollExport } from '../../shared/develop/roll-types';
import CropPanel, { type CropApplyVerb } from './CropPanel';
import ExportPanel, { type ExportVerb } from './ExportPanel';
import FramingStage from './FramingStage';
import type { RollExports } from './use-roll-export';

/** How long the numbers rest before they are written to the roll. */
const WRITE_DELAY_MS = 200;
/** How long the picture rests before its filmstrip cell is redrawn. */
const SNAPSHOT_DELAY_MS = 700;

/**
 * ONE picture of a roll on the workbench — mounted with a `key` per picture,
 * so a draft never leaks onto the next photograph (the never-inherit rule).
 * It renders two grid cells (the stage, and the inspector — a column beside
 * the picture, or a DRAWER under it on a phone) and leaves the filmstrip to
 * its parent, so stepping along the strip remounts this and never the strip.
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
  cropApplyTo,
  onDevelop,
  onFraming,
  onAspect,
  exportSettings,
  onExportSettings,
  exports,
  exportVerbs,
  onSnapshot,
  onStep,
  emptyText = 'This picture is not in the Library — open its folder, or take it from its day on your Winnow. Its numbers can still be set.',
}: {
  picture: RollPicture;
  /** Its bytes — the Library's or the roll's own — or null while they are not in hand. */
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
  /** The crop's batch verbs — this picture's aspect and framing written onto others. */
  cropApplyTo: readonly CropApplyVerb[];
  onDevelop: (develop: DevelopSettings | null) => void;
  onFraming: (framing: Framing | null) => void;
  onAspect: (aspect: string) => void;
  /** The roll's delivery settings, edited on the Export tab. */
  exportSettings: RollExport;
  onExportSettings: (patch: Partial<RollExport>) => void;
  /** The roll's still export — its state and what the open picture delivers. */
  exports: RollExports;
  exportVerbs: readonly ExportVerb[];
  onSnapshot: (thumb: Blob) => void;
  onStep: (step: number) => void;
  /** What the stage says while the picture's bytes are not in hand. */
  emptyText?: string;
}) {
  const presets = usePresetBookHost();
  const draft = useDevelopDraft(entry.develop, stack);
  const [told, tell] = useTold();
  // Read once, like the develop: the workbench is keyed per picture.
  const [framingDraft, setFramingDraft] = useState<Framing>(entry.framing ?? { ...DEFAULT_FRAMING });
  // The crop stays visible on every tab: the Develop viewport shows the
  // picture as it will leave, framed, while the Crop tab edits the frame.
  const [ratio, setRatio] = useState(0);
  const frame = useMemo<DevelopFrame | null>(
    () => (ratio > 0 ? { aspectRatio: ratio, framing: framingDraft } : null),
    [ratio, framingDraft],
  );
  const picture = useDevelopPicture({ file, cube: stack.composed, frame });
  const fidelity = pictureFidelity(file);

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
  useEffect(() => setRatio(source ? aspectRatio : 0), [source, aspectRatio]);
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

  // The crop's zoom as the pill's own interface, so one control serves both
  // stages: on the Develop tab it moves the VIEW (how closely the picture is
  // being looked at, which never leaves), on the Crop tab the FRAMING (what is
  // kept, which does). The step is the stages' own 1.25.
  const framingZoom = useMemo<ZoomControls>(
    () => ({
      scale: framingDraft.scale,
      label: `${framingDraft.scale.toFixed(2)}×`,
      canZoomIn: framingDraft.scale < MAX_FRAMING_SCALE - 1e-6,
      canZoomOut: framingDraft.scale > 1,
      zoomIn: () => setFramingDraft((f) => ({ ...f, scale: scaleFramingBy(f.scale, STAGE_ZOOM_STEP) })),
      zoomOut: () => setFramingDraft((f) => ({ ...f, scale: scaleFramingBy(f.scale, 1 / STAGE_ZOOM_STEP) })),
      reset: () => setFramingDraft((f) => ({ ...f, scale: 1 })),
    }),
    [framingDraft.scale],
  );

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
            <DevelopClipboardActions draft={draft.draft} asShot={draft.asShot} onReplace={draft.setDraft} onTold={tell} />
          )}
          {/* The pill is drawn at EVERY width, phone included — the lightbox
              hides it under 820px on the argument that the pinch is the gesture
              there, and a stage that answers a pinch best-effort (the browser
              can still take the fingers) needs the way in that always answers
              (`frontend.md`, «what it costs»). On the crop it drives the
              FRAMING's own zoom, which is what the picture is cropped by. */}
          {source &&
            (cropping ? (
              <StageZoomControl zoom={framingZoom} hint="drag, pinch, or the wheel" className="flex-none" />
            ) : (
              <StageZoomControl zoom={picture.view.zoom} hint="wheel, pinch, or Z" className="flex-none" />
            ))}
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
        {/* The line under the picture is PROSE — what the numbers say, which
            gesture applies. It wraps to three lines at 390px, and on a phone
            with the drawer up those are three lines taken off the photograph
            for a sentence nobody is reading while they drag a slider. It comes
            back the moment the drawer is down and the stage owns the screen. */}
        {compact && sheetOpen ? null : cropping ? (
          <p className="m-0 flex-none font-mono text-2xs text-faint leading-relaxed">
            {source
              ? `drag to move the picture, pinch or the wheel to zoom · ${framingDraft.fit === 'contain' ? 'whole picture, bars where it falls short' : 'filling the frame'}`
              : 'the crop needs the picture'}
          </p>
        ) : (
          <DevelopCaption draft={draft.draft} note={fidelity.note} picture={picture} />
        )}
      </div>

      <PanelHost
        asSheet={compact}
        // On a phone the inspector is a DRAWER, never the sheet: a sheet's wash
        // sits over the photograph and tints it, so the one thing the tool
        // exists to judge — the colour that will leave — cannot be seen while
        // it is being set (`frontend.md`).
        compactAs="drawer"
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
          ) : tab === 'crop' ? (
            <CropPanel
              framing={framingDraft}
              aspect={entry.aspect}
              onFraming={setFramingDraft}
              onAspect={onAspect}
              verbs={cropApplyTo}
              onTold={tell}
            />
          ) : (
            <ExportPanel
              settings={exportSettings}
              onSettings={onExportSettings}
              delivery={exports.openDelivery}
              verbs={exportVerbs}
              exporting={exports.exporting}
              note={exports.note}
              lastRun={exports.lastRun}
            />
          )}
        </div>
      </PanelHost>
    </>
  );
}
