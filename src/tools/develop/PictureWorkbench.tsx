import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DevelopApplySection,
  DevelopClipboardActions,
  DevelopLookSection,
  DevelopPresetsSection,
} from '../../shared/develop/DevelopSections';
import DevelopCurve from '../../shared/develop/DevelopCurve';
import { DevelopAutoSection, DevelopLevelsSection } from '../../shared/develop/DevelopAuto';
import { whiteBalanceFor } from '../../shared/develop/auto-develop';
import DevelopHistogram from '../../shared/develop/DevelopHistogram';
import DevelopSliders from '../../shared/develop/DevelopSliders';
import DevelopViewport, { DevelopCaption } from '../../shared/develop/DevelopViewport';
import { DEFAULT_DEVELOP, isDefaultDevelop, type DevelopSettings } from '../../shared/develop/develop';
import { copyDevelop, pasteDevelop } from '../../shared/develop/develop-clipboard';
import { developPillClass } from '../../shared/develop/develop-classes';
import type { DevelopApplyVerb } from '../../shared/develop/develop-host';
import { pictureFidelity } from '../../shared/develop/picture-fidelity';
import { pictureAspectRatio } from '../../shared/develop/crop-aspect';
import { WORKBENCH_TABS, editorKeyAction, sameDevelop, type WorkbenchTab } from '../../shared/develop/roll-editor';
import { framedThumbnail } from '../../shared/develop/roll-thumb';
import type { RollPicture } from '../../shared/develop/roll-types';
import { useDevelopDraft, useTold } from '../../shared/develop/use-develop-draft';
import { useWriteThrough } from '../../shared/develop/use-write-through';
import { useDevelopPicture, type DevelopFrame } from '../../shared/develop/use-develop-picture';
import { sameKeystone, type Keystone } from '../../shared/render/geometry';
import { sameLens, type LensCorrection } from '../../shared/render/lens';
import {
  DEFAULT_BRUSH_HARDNESS,
  DEFAULT_BRUSH_RADIUS,
  MAX_STROKES,
  type BrushStroke,
  type MaskKind,
} from '../../shared/render/mask';
import {
  addLayer,
  createLayer,
  drawingLayers,
  moveLayer,
  patchLayer,
  removeLayer,
  sameLayers,
  type AdjustLayer,
} from '../../shared/develop/layer';
import { usePresetBookHost } from '../../shared/develop/use-preset-book';
import type { LutStack } from '../../shared/lut/use-lut-stack';
import { DEFAULT_FRAMING, isDefaultFraming, sameFraming, type Framing } from '../../shared/media/framing';
import { describeKeyTarget, targetOwnsTyping } from '../../shared/media/transport-keys';
import PanelHost from '../../shared/ui/PanelHost';
import Segmented from '../../shared/ui/Segmented';
import StageZoomControl from '../../shared/ui/StageZoomControl';
import { STAGE_ZOOM_STEP, zoomLabel, type ZoomControls } from '../../shared/ui/stage-zoom';
import type { RollExport } from '../../shared/develop/roll-types';
import CropPanel, { type CropApplyVerb } from './CropPanel';
import KeystonePanel from './KeystonePanel';
import LensPanel from './LensPanel';
import LayersPanel from './LayersPanel';
import MaskPanel from './MaskPanel';
import type { BorderApplyVerb } from './BorderSection';
import type { RollBorder } from '../../shared/develop/border-layout';
import ExportPanel, { type ExportVerb } from './ExportPanel';
import CropStage from './CropStage';
import { CROP_VIEW_FIT, CROP_VIEW_MAX, useCropZone } from './use-crop-zone';
import type { RollExports } from './use-roll-export';

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
  borderApplyTo,
  onBorder,
  onDevelop,
  onFraming,
  onKeystone,
  onLens,
  onLayers,
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
  /** The border's own batch verbs — never the crop (the maintainer's two verbs). */
  borderApplyTo: readonly BorderApplyVerb[];
  onBorder: (border: RollBorder | null) => void;
  onDevelop: (develop: DevelopSettings | null) => void;
  onFraming: (framing: Framing | null) => void;
  onKeystone: (keystone: Keystone | null) => void;
  onLens: (lens: LensCorrection | null) => void;
  onLayers: (layers: AdjustLayer[]) => void;
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
  const border = entry.border;
  const frame = useMemo<DevelopFrame | null>(
    () => (ratio > 0 ? { aspectRatio: ratio, framing: framingDraft, border } : null),
    [ratio, framingDraft, border],
  );
  // Read once, like the develop and the crop: the workbench is keyed per picture.
  const [keystoneDraft, setKeystoneDraft] = useState<Keystone | null>(entry.keystone ?? null);
  const [lensDraft, setLensDraft] = useState<LensCorrection | null>(entry.lens ?? null);
  // The stack is a draft like the rest, so a slider drag is one write-through
  // rather than one document write per step.
  const [layersDraft, setLayersDraft] = useState<AdjustLayer[]>(entry.layers ?? []);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [showMask, setShowMask] = useState(false);
  // What the NEXT stroke is painted with. Kept beside the layer rather than on
  // it: a brush is a tool, and each stroke keeps the settings it was made with
  // so a soft edge and a hard one can live in the same mask.
  const [brush, setBrush] = useState({
    radius: DEFAULT_BRUSH_RADIUS,
    hardness: DEFAULT_BRUSH_HARDNESS,
    erase: false,
  });
  const [painting, setPainting] = useState(false);
  const selectedLayer = layersDraft.find((l) => l.id === selectedLayerId) ?? null;
  const drawingCount = drawingLayers(layersDraft).length;

  // --- painting ------------------------------------------------------------
  // The live stroke rides a REF and the draft alike: the ref is what the next
  // point is appended to, because a state read inside a pointermove closure is
  // one frame behind and would drop points (the same trap the curve editor's
  // drag wore). Each move rewrites the LAST stroke rather than adding one.
  const strokeRef = useRef<BrushStroke | null>(null);
  const paintTarget = painting && selectedLayer?.mask?.kind === 'brush' ? selectedLayer : null;
  const paintId = paintTarget?.id ?? null;
  const brushRef = useRef(brush);
  brushRef.current = brush;
  const paint = useMemo(
    () =>
      paintId
        ? {
            onStart: (point: [number, number]) => {
              const made: BrushStroke = { points: [point], ...brushRef.current };
              strokeRef.current = made;
              setLayersDraft((list) =>
                list.map((l) => {
                  if (l.id !== paintId || l.mask?.kind !== 'brush') return l;
                  if (l.mask.strokes.length >= MAX_STROKES) return l;
                  return { ...l, mask: { kind: 'brush', strokes: [...l.mask.strokes, made] } };
                }),
              );
            },
            onMove: (point: [number, number]) => {
              const live = strokeRef.current;
              if (!live) return;
              const last = live.points[live.points.length - 1];
              // Points closer than this add nothing the radius does not already
              // cover, and every one of them is rasterised again.
              const step = Math.max(0.004, live.radius * 0.12);
              if (Math.hypot(point[0] - last[0], point[1] - last[1]) < step) return;
              const grown: BrushStroke = { ...live, points: [...live.points, point] };
              strokeRef.current = grown;
              setLayersDraft((list) =>
                list.map((l) => {
                  if (l.id !== paintId || l.mask?.kind !== 'brush' || l.mask.strokes.length === 0) return l;
                  const strokes = [...l.mask.strokes];
                  strokes[strokes.length - 1] = grown;
                  return { ...l, mask: { kind: 'brush', strokes } };
                }),
              );
            },
            onEnd: () => {
              strokeRef.current = null;
            },
          }
        : null,
    [paintId],
  );
  const picture = useDevelopPicture({
    file,
    cube: stack.composed,
    frame,
    keystone: keystoneDraft,
    lens: lensDraft,
    layers: layersDraft,
    paint,
    // Only while the layer is open AND the box is ticked: a red wash left on
    // by accident would be mistaken for the picture.
    showMaskOf: showMask && selectedLayer ? selectedLayer.id : null,
  });
  const fidelity = pictureFidelity(file);

  // --- write-through ---------------------------------------------------------
  // Both drafts ride `use-write-through.ts`, which also takes the roll BACK
  // when it moves under them: an undo, a redo, a batch verb or an instance's
  // copy changes the stored value without this editor's doing, and a draft that
  // ignored it would keep showing numbers the roll no longer holds — and write
  // them back over the step at the next nudge.
  const callbacks = useRef({ onDevelop, onFraming, onKeystone, onLens, onLayers, onAspect, onSnapshot, onStep, onTabChange });
  callbacks.current = { onDevelop, onFraming, onKeystone, onLens, onLayers, onAspect, onSnapshot, onStep, onTabChange };
  const { setDraft } = draft;
  useWriteThrough<DevelopSettings>({
    stored: entry.develop,
    // Keyed on the numbers themselves: `draft` is a new object every render.
    draft: isDefaultDevelop(draft.draft) ? null : draft.draft,
    same: sameDevelop,
    onWrite: (value) => callbacks.current.onDevelop(value),
    onReseed: (value) => setDraft(value ?? DEFAULT_DEVELOP),
  });
  // The crop, written through the same way, on its own timer: a drag fires far
  // more often than a slider ever does.
  // The warp, on its own timer like the crop: a slider fires far more often
  // than a document should be written.
  useWriteThrough<Keystone>({
    stored: entry.keystone ?? null,
    draft: keystoneDraft,
    same: sameKeystone,
    onWrite: (value) => callbacks.current.onKeystone(value),
    onReseed: (value) => setKeystoneDraft(value),
  });
  useWriteThrough<LensCorrection>({
    stored: entry.lens ?? null,
    draft: lensDraft,
    same: sameLens,
    onWrite: (value) => callbacks.current.onLens(value),
    onReseed: (value) => setLensDraft(value),
  });
  useWriteThrough<AdjustLayer[]>({
    stored: entry.layers?.length ? entry.layers : null,
    draft: layersDraft.length ? layersDraft : null,
    same: (a, b) => sameLayers(a, b),
    onWrite: (value) => callbacks.current.onLayers(value ?? []),
    onReseed: (value) => setLayersDraft(value ?? []),
  });
  useWriteThrough<Framing>({
    stored: entry.framing,
    draft: isDefaultFraming(framingDraft) ? null : framingDraft,
    same: sameFraming,
    onWrite: (value) => callbacks.current.onFraming(value),
    onReseed: (value) => setFramingDraft(value ?? { ...DEFAULT_FRAMING }),
  });

  // --- the filmstrip cell, redrawn as delivered once the picture rests -------
  // Delivered means graded AND framed: the strip shows the crop as well as
  // the light. Keyed on the crop too, so a drag that rests redraws the cell.
  const { source, cube, delivered } = picture;
  const aspectRatio = pictureAspectRatio(entry.aspect, source?.width ?? 0, source?.height ?? 0);
  useEffect(() => setRatio(source ? aspectRatio : 0), [source, aspectRatio]);
  // The Crop tab's zone, measured on the decoded picture and written back as
  // the aspect (to the roll, at once) and the framing (through its draft).
  const crop = useCropZone({
    src: source ? { width: source.width, height: source.height } : null,
    aspect: entry.aspect,
    framing: framingDraft,
    onAspect: (aspect) => callbacks.current.onAspect(aspect),
    onFraming: setFramingDraft,
  });
  useEffect(() => {
    if (!source) return;
    const t = window.setTimeout(() => {
      const image = delivered();
      if (!image) return;
      void framedThumbnail(image, source.width, source.height, aspectRatio, framingDraft, border).then((blob) => {
        if (blob) callbacks.current.onSnapshot(blob);
      });
    }, SNAPSHOT_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [source, cube, delivered, aspectRatio, framingDraft, border]);

  // --- keys --------------------------------------------------------------------
  const keyState = useRef({ draft, picture, tell, crop, tab });
  keyState.current = { draft, picture, tell, crop, tab };
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
      const { draft: d, picture: pic, tell: say, crop: c, tab: open } = keyState.current;
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
          if (open === 'crop') {
            c.setView((v) => (v.zoom > 1 ? CROP_VIEW_FIT : { zoom: STAGE_ZOOM_STEP * STAGE_ZOOM_STEP, x: v.x, y: v.y }));
            return;
          }
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
        case 'swap':
          if (open !== 'crop') return;
          e.preventDefault();
          c.swap();
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
  // The crop stage's pill: the VIEW's zoom (inspection), never the crop's —
  // the zone's size is the crop. Drawn at every width, the pinch's twin
  // (`frontend.md`: a pinch the browser can take away needs a way in that
  // always answers). Steps zoom about the middle of the view.
  const { view: cropView, setView: setCropView } = crop;
  const cropZoom = useMemo<ZoomControls>(() => {
    const by = (f: number) =>
      setCropView((v) => {
        const zoom = Math.max(1, Math.min(CROP_VIEW_MAX, v.zoom * f));
        return zoom === 1 ? CROP_VIEW_FIT : { zoom, x: (v.x * zoom) / v.zoom, y: (v.y * zoom) / v.zoom };
      });
    return {
      scale: cropView.zoom,
      label: zoomLabel(cropView.zoom),
      canZoomIn: cropView.zoom < CROP_VIEW_MAX - 1e-6,
      canZoomOut: cropView.zoom > 1,
      zoomIn: () => by(STAGE_ZOOM_STEP),
      zoomOut: () => by(1 / STAGE_ZOOM_STEP),
      reset: () => setCropView(CROP_VIEW_FIT),
    };
  }, [cropView, setCropView]);
  const tabLabel = WORKBENCH_TABS.find((t) => t.id === tab)?.label ?? 'Develop';

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
              <StageZoomControl zoom={cropZoom} hint="look closer: pinch or the wheel — the crop stays" className="flex-none" />
            ) : (
              <StageZoomControl zoom={picture.view.zoom} hint="wheel, pinch, or Z" className="flex-none" />
            ))}
        </div>
        <DevelopViewport
          picture={picture}
          hasFile={Boolean(file)}
          emptyText={emptyText}
          className={cropping ? 'hidden' : 'flex-1'}
          onPick={(linear) => {
            const { temperature, tint, clamped } = whiteBalanceFor(linear);
            draft.patch({ temperature, tint });
            tell(
              `picked grey · temperature ${temperature}, tint ${tint}` +
                (clamped ? ' · as far as the sliders reach' : ''),
            );
          }}
        />
        {cropping && (
          <CropStage
            picture={picture}
            crop={crop}
            sourceSize={exports.openSize}
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
              ? 'drag inside to move · on the picture to draw · a handle to resize · double-click for the largest'
              : 'the crop needs the picture'}
          </p>
        ) : (
          <DevelopCaption
            draft={draft.draft}
            note={fidelity.note}
            picture={picture}
            also={drawingCount ? `${drawingCount} layer${drawingCount === 1 ? '' : 's'}` : null}
          />
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
              <DevelopAutoSection
                stats={picture.stats}
                onPatch={draft.patch}
                onTold={tell}
                picking={picture.picking}
                onPicking={picture.setPicking}
              />
              <DevelopSliders value={draft.draft} onChange={draft.set} />
              <DevelopLevelsSection value={draft.draft.levels} onChange={(levels) => draft.patch({ levels })} />
              <DevelopCurve
                value={draft.draft.curves}
                histogram={picture.histogram}
                onChange={(curves) => draft.patch({ curves })}
              />
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
          ) : tab === 'layers' ? (
            <>
              <LayersPanel
                layers={layersDraft}
                selectedId={selectedLayerId}
                showMask={showMask}
                onSelect={setSelectedLayerId}
                onAdd={(kind: MaskKind | null) => {
                  const made = createLayer(kind);
                  setLayersDraft((list) => addLayer(list, made));
                  setSelectedLayerId(made.id);
                }}
                onRemove={(id) => {
                  setLayersDraft((list) => removeLayer(list, id));
                  if (id === selectedLayerId) setSelectedLayerId(null);
                }}
                onMove={(id, delta) => setLayersDraft((list) => moveLayer(list, id, delta))}
                onPatch={(id, patch) => setLayersDraft((list) => patchLayer(list, id, patch))}
                onShowMask={setShowMask}
              />
              {selectedLayer && (
                <>
                  <MaskPanel
                    layer={selectedLayer}
                    onPatch={(patch) =>
                      setLayersDraft((list) => patchLayer(list, selectedLayer.id, patch))
                    }
                    brush={brush}
                    onBrush={(patch) => setBrush((b) => ({ ...b, ...patch }))}
                    painting={painting}
                    onPainting={setPainting}
                    onUndoStroke={() =>
                      setLayersDraft((list) =>
                        list.map((l) =>
                          l.id === selectedLayer.id && l.mask?.kind === 'brush'
                            ? { ...l, mask: { kind: 'brush', strokes: l.mask.strokes.slice(0, -1) } }
                            : l,
                        ),
                      )
                    }
                    onClearStrokes={() =>
                      setLayersDraft((list) =>
                        list.map((l) =>
                          l.id === selectedLayer.id && l.mask?.kind === 'brush'
                            ? { ...l, mask: { kind: 'brush', strokes: [] } }
                            : l,
                        ),
                      )
                    }
                  />
                  {/* The SAME sliders the global develop uses, because a
                      layer's adjustment IS a DevelopSettings — one maths, one
                      panel, and a local exposure behaves like a global one. */}
                  <DevelopSliders
                    value={selectedLayer.develop}
                    onChange={(key, v) =>
                      setLayersDraft((list) =>
                        patchLayer(list, selectedLayer.id, {
                          develop: { ...selectedLayer.develop, [key]: v },
                        }),
                      )
                    }
                  />
                  <DevelopCurve
                    value={selectedLayer.develop.curves}
                    histogram={picture.histogram}
                    onChange={(curves) =>
                      setLayersDraft((list) =>
                        patchLayer(list, selectedLayer.id, {
                          develop: { ...selectedLayer.develop, curves },
                        }),
                      )
                    }
                  />
                </>
              )}
            </>
          ) : tab === 'crop' ? (
            <CropPanel
              picture={picture}
              crop={crop}
              aspect={entry.aspect}
              border={entry.border}
              onBorder={onBorder}
              deliveredSize={exports.openDelivery?.out ?? null}
              verbs={cropApplyTo}
              borderVerbs={borderApplyTo}
              onTold={tell}
            />
          ) : null}
          {tab === 'crop' ? (
            <>
              <KeystonePanel value={keystoneDraft} onChange={setKeystoneDraft} />
              <LensPanel value={lensDraft} onChange={setLensDraft} />
            </>
          ) : tab === 'export' ? (
            <ExportPanel
              settings={exportSettings}
              onSettings={onExportSettings}
              delivery={exports.openDelivery}
              verbs={exportVerbs}
              exporting={exports.exporting}
              note={exports.note}
              lastRun={exports.lastRun}
            />
          ) : null}
        </div>
      </PanelHost>
    </>
  );
}
