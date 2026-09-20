import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import DevelopViewport from '../../shared/develop/DevelopViewport';
import { DEFAULT_DEVELOP, developLines, isDefaultDevelop, signed, type DevelopSettings } from '../../shared/develop/develop';
import { copyDevelop, pasteDevelop } from '../../shared/develop/develop-clipboard';
import { developPillClass } from '../../shared/develop/develop-classes';
import type { DevelopApplyVerb } from '../../shared/develop/develop-host';
import { pictureFidelity } from '../../shared/develop/picture-fidelity';
import { DevelopBaseSection, type RawOffer } from '../../shared/develop/DevelopBase';
import { canDecodeRaw } from '../../shared/raw/raw-decoder';
import { isRawImage } from '../../shared/library/assets';
import { knownIdentity, mediaOrigin } from '../../shared/projects/media-identity';
import { heldOriginal, holdOriginal } from '../../shared/sources/original-cache';
import { formatBytes } from '../../shared/lib/format';
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
import { useSubjectMasks } from '../../shared/develop/use-subject-masks';
import type { BrushRaster } from '../../shared/render/brush-raster';

type SubjectRasters = ReadonlyMap<string, BrushRaster>;
const EMPTY_RASTERS: SubjectRasters = new Map();

/**
 * How near a tap must land to count as a tap ON an existing point rather than
 * beside it, in [0,1] frame coordinates. Generous, because the markers are
 * small and un-picking by accident is cheaper to undo than failing to un-pick.
 */
const SUBJECT_HIT_RADIUS = 0.04;
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
import { usePixelView } from '../../shared/ui/use-pixel-view';
import { useLocalFlag } from '../../shared/ui/use-local-flag';
import DevelopShortcuts from '../../shared/develop/DevelopShortcuts';
import { STAGE_ZOOM_STEP, zoomLabel, type ZoomControls } from '../../shared/ui/stage-zoom';
import type { RollExport } from '../../shared/develop/roll-types';
import CropPanel, { type CropApplyVerb } from './CropPanel';
import KeystonePanel from './KeystonePanel';
import LensPanel from './LensPanel';
import DetailPanel from './DetailPanel';
import { describeDetail, sameDetail, type DetailSettings } from '../../shared/render/detail';
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
  onDetail,
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
  onDetail: (detail: DetailSettings | null) => void;
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
  const [detailDraft, setDetailDraft] = useState<DetailSettings | null>(entry.detail ?? null);
  // The FILE's own width, for the kernels: a RAW's sensor once decoded, else
  // the measured file; the stage's width follows the decode one render later.
  const [rawSize, setRawSize] = useState<{ w: number; h: number } | null>(null);
  const [stageWidth, setStageWidth] = useState(0);
  // The stack is a draft like the rest, so a slider drag is one write-through
  // rather than one document write per step.
  const [layersDraft, setLayersDraft] = useState<AdjustLayer[]>(entry.layers ?? []);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [showMask, setShowMask] = useState(false);
  const [pixelView, setPixelView] = usePixelView();
  // What the picture SAYS about itself, and where. Off by default — the
  // maintainer does not want the numbers in front of him while he works, and
  // when he does they belong over the photograph, not under it.
  const [factsOn, setFactsOn] = useLocalFlag('atelier.develop.facts', false);
  // The before/after split, as a switch. On by default — it is what the editor
  // has always done — but a divider is a second thing on the picture, and the
  // hours spent on a mask are exactly the hours it is in the way.
  const [compareOn, setCompareOn] = useLocalFlag('atelier.develop.compare', true);
  const [helpOpen, setHelpOpen] = useState(false);
  // The subject rasters come BACK through state, because the two hooks need
  // each other: the stage decodes the picture the model segments, and the model
  // produces the map the stage draws. One extra commit per answer, which is
  // once per tap rather than once per frame.
  const [subjectRasters, setSubjectRasters] = useState<SubjectRasters>(EMPTY_RASTERS);
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
  const paintKind = painting ? selectedLayer?.mask?.kind : undefined;
  const paintId = paintKind === 'brush' || paintKind === 'subject' ? (selectedLayer?.id ?? null) : null;
  const brushRef = useRef(brush);
  brushRef.current = brush;
  const paint = useMemo(
    () =>
      paintId
        ? {
            onStart: (point: [number, number]) => {
              if (paintKind === 'subject') {
                // A tap ADDS a point, and a tap on one REMOVES it — the
                // click-a-marker-to-unpick gesture, which is how a subject is
                // narrowed after the model took in too much.
                setLayersDraft((list) =>
                  list.map((l) => {
                    if (l.id !== paintId || l.mask?.kind !== 'subject') return l;
                    const hit = l.mask.points.findIndex(
                      ([x, y]) => Math.hypot(x - point[0], y - point[1]) < SUBJECT_HIT_RADIUS,
                    );
                    const points =
                      hit >= 0
                        ? l.mask.points.filter((_, i) => i !== hit)
                        : [...l.mask.points, point];
                    return { ...l, mask: { ...l.mask, points } };
                  }),
                );
                return;
              }
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
              // A subject is TAPPED, never dragged: the model answers a point.
              if (paintKind === 'subject') return;
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
            gesture: paintKind === 'subject' ? ('tap' as const) : ('drag' as const),
          }
        : null,
    [paintId, paintKind],
  );
  // --- the RAW base ----------------------------------------------------------
  // Where the sensor's data would come from: the file itself when it is a
  // RAW, else a proxy's RAW original, fetched once and held for the session
  // (`original-cache.ts`, decision 3). Nothing is fetched or decoded until the
  // base says `raw`; back on the render the decode is dropped with the
  // source, and the held original costs no second fetch.
  const origin = useMemo(() => (file ? mediaOrigin(file) : null), [file]);
  const rawOffer: RawOffer | null =
    file && canDecodeRaw(file) ? 'file' : origin?.name && isRawImage(origin.name) && origin.fetchOriginal ? 'original' : null;
  const wantsRaw = draft.draft.base === 'raw' && rawOffer !== null;
  const [rawFile, setRawFile] = useState<File | null>(null);
  const [rawStatus, setRawStatus] = useState<string | null>(null);
  const { patch: patchDraft } = draft;
  useEffect(() => {
    if (!wantsRaw || rawFile || !file || !rawOffer) return;
    if (rawOffer === 'file') {
      setRawFile(file);
      return;
    }
    const key = knownIdentity(file)?.assetId ?? null;
    const held = key ? heldOriginal(key) : null;
    if (held) {
      setRawFile(held);
      return;
    }
    let alive = true;
    setRawStatus(`fetching the RAW${origin?.bytes ? ` · ${formatBytes(origin.bytes)}` : ''}…`);
    origin!.fetchOriginal!()
      .then((fetched) => {
        if (!alive) return;
        if (key) holdOriginal(key, fetched);
        setRawFile(fetched);
        setRawStatus(null);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setRawStatus(null);
        tell(`the RAW could not be fetched: ${err instanceof Error ? err.message : String(err)}`);
        patchDraft({ base: null, rawGain: null });
      });
    return () => {
      alive = false;
    };
  }, [wantsRaw, rawFile, file, rawOffer, origin, tell, patchDraft]);
  const rawGain = draft.draft.rawGain ?? null;
  const fullWidth = (wantsRaw ? rawSize?.w : null) ?? exports.openSize?.width ?? null;
  const picture = useDevelopPicture({
    file,
    cube: stack.composed,
    frame,
    keystone: keystoneDraft,
    lens: lensDraft,
    layers: layersDraft,
    subjectMasks: subjectRasters,
    paint,
    compare: compareOn,
    // Only while the layer is open AND the box is ticked: a red wash left on
    // by accident would be mistaken for the picture.
    showMaskOf: showMask && selectedLayer ? selectedLayer.id : null,
    raw: wantsRaw && rawFile ? { file: rawFile, gain: rawGain } : null,
    detail: detailDraft,
    pixelScale: stageWidth && fullWidth ? Math.min(1, stageWidth / fullWidth) : 1,
    loupe: true,
    pixelView,
    // The measured exposure is STORED the moment it is known, so the export's
    // decode applies the same number (`raw.md`). Once: a stored gain is never
    // overwritten by a later decode's measurement.
    onRawDecoded: (info) => {
      setRawSize({ w: info.sourceWidth, h: info.sourceHeight });
      if (rawGain === null) {
        patchDraft({ base: 'raw', rawGain: info.gain });
        const ev = Math.log2(info.gain);
        tell(`RAW · ${info.width}×${info.height}${info.halved ? ' (half size)' : ''} · metered ${ev ? `${signed(ev, 1)} EV` : 'at its white'}`);
      }
    },
  });
  const fidelity = pictureFidelity(file, draft.draft.base);
  const subject = useSubjectMasks({
    layers: layersDraft,
    // `BadgeSource.image` is typed as `CanvasImageSource`, which admits an
    // SVGImageElement nothing here ever produces and no GPU can upload —
    // narrowed rather than widening the model's own contract.
    source: (picture.source?.image as TexImageSource | undefined) ?? null,
    // Per PICTURE: one picture's subject must never be shown on another.
    pictureKey: entry.id,
  });
  const { rasters: resolvedSubjects } = subject;
  useEffect(() => setSubjectRasters(resolvedSubjects), [resolvedSubjects]);

  // --- write-through ---------------------------------------------------------
  // Both drafts ride `use-write-through.ts`, which also takes the roll BACK
  // when it moves under them: an undo, a redo, a batch verb or an instance's
  // copy changes the stored value without this editor's doing, and a draft that
  // ignored it would keep showing numbers the roll no longer holds — and write
  // them back over the step at the next nudge.
  const callbacks = useRef({ onDevelop, onFraming, onKeystone, onLens, onDetail, onLayers, onAspect, onSnapshot, onStep, onTabChange });
  callbacks.current = { onDevelop, onFraming, onKeystone, onLens, onDetail, onLayers, onAspect, onSnapshot, onStep, onTabChange };
  const { replace } = draft;
  useWriteThrough<DevelopSettings>({
    stored: entry.develop,
    // Keyed on the numbers themselves: `draft` is a new object every render.
    draft: isDefaultDevelop(draft.draft) ? null : draft.draft,
    same: sameDevelop,
    onWrite: (value) => callbacks.current.onDevelop(value),
    // The WHOLE record, material included: an undo that takes a picture back
    // off its RAW must put the base back with the numbers.
    onReseed: (value) => replace(value ?? DEFAULT_DEVELOP),
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
  useWriteThrough<DetailSettings>({
    stored: entry.detail ?? null,
    draft: detailDraft,
    same: sameDetail,
    onWrite: (value) => callbacks.current.onDetail(value),
    onReseed: (value) => setDetailDraft(value),
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
  useEffect(() => setStageWidth(source?.width ?? 0), [source]);
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
  const keyState = useRef({ draft, picture, tell, crop, tab, factsOn, setFactsOn });
  keyState.current = { draft, picture, tell, crop, tab, factsOn, setFactsOn };
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
        case 'help':
          e.preventDefault();
          // The same key closes it: a sheet opened by a letter that then does
          // nothing is a sheet you have to reach for the mouse to be rid of.
          setHelpOpen((was) => !was);
          return;
        case 'facts':
          e.preventDefault();
          keyState.current.setFactsOn(!keyState.current.factsOn);
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

  /**
   * The points the author picked for the OPEN subject layer, drawn on the
   * picture. They were invisible until now, which made the documented
   * tap-a-marker-to-remove gesture unaimable — the maintainer's *"i can not
   * see"*.
   */
  const subjectMarks = useMemo<readonly (readonly [number, number])[] | null>(
    () => (selectedLayer?.mask?.kind === 'subject' ? selectedLayer.mask.points : null),
    [selectedLayer],
  );
  const unmarkSubject = useCallback(
    (index: number) => {
      setLayersDraft((list) =>
        list.map((l) =>
          l.id === paintId && l.mask?.kind === 'subject'
            ? { ...l, mask: { ...l.mask, points: l.mask.points.filter((_, i) => i !== index) } }
            : l,
        ),
      );
    },
    [paintId],
  );

  /**
   * The facts drawn down the picture's corner, one per line: what the numbers
   * say, what else is on it, what the picture IS. The gesture hints that used
   * to ride the same sentence are gone from here — they live in the shortcuts
   * sheet now, where a hint can be read once rather than stared at all day.
   */
  const facts = useMemo<string[] | null>(() => {
    if (!factsOn) return null;
    const lines = developLines(draft.draft);
    if (drawingCount) lines.push(`${drawingCount} layer${drawingCount === 1 ? '' : 's'}`);
    if (detailDraft) lines.push(describeDetail(detailDraft));
    if (fidelity.note) lines.push(fidelity.note);
    return lines;
  }, [factsOn, draft.draft, drawingCount, detailDraft, fidelity.note]);

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
              <>
                <StageZoomControl zoom={picture.view.zoom} hint="wheel, pinch, or Z" className="flex-none" />
                {/* Only where it means anything: below 1:1 the browser is
                    downscaling and `pixelated` is simply worse. */}
                {picture.view.magnifying && (
                  <button
                    type="button"
                    className={`${developPillClass} flex-none cursor-pointer hover:border-accent`}
                    onClick={() => setPixelView(pixelView === 'pixels' ? 'smooth' : 'pixels')}
                    title={
                      pixelView === 'pixels'
                        ? 'Pixels as pixels — past 100 % nothing is invented between them'
                        : 'Smoothed — past 100 % the gradients between pixels are the browser\u2019s, not the picture\u2019s'
                    }
                  >
                    {pixelView === 'pixels' ? 'pixels' : 'smooth'}
                  </button>
                )}
              </>
            ))}
          {/* The split, as a switch. It says what it IS rather than what
              pressing it does, like every other pill in this bar; while a mask
              tool holds the pointer the hook has suspended it anyway, and the
              pill says that too rather than lying about a divider nobody can
              see. */}
          {source && !cropping && (
            <button
              type="button"
              className={`${developPillClass} flex-none cursor-pointer hover:border-accent ${
                compareOn ? '' : 'text-faint'
              }`}
              onClick={() => setCompareOn(!compareOn)}
              aria-pressed={compareOn}
              title={
                compareOn
                  ? 'The before/after divider is on — a drag across the picture places it'
                  : 'The before/after divider is off — the whole picture is shown corrected'
              }
            >
              {!compareOn
                ? 'compare off'
                : picture.painting || picture.picking
                  ? // Said out loud rather than drawn as a live divider that a
                    // tap would move: this is the state the maintainer reported.
                    'compare · held'
                  : 'compare'}
            </button>
          )}
          {/* The legend that used to run along the bottom of the editor, as a
              verb. Drawn at every width: on a phone there are no keys, but the
              GESTURES it lists are exactly the ones a finger has to discover. */}
          <button
            type="button"
            className={`${developPillClass} flex-none cursor-pointer hover:border-accent`}
            onClick={() => setHelpOpen(true)}
            title="Keys and gestures (H)"
            aria-label="Keys and gestures"
          >
            ?
          </button>
        </div>
        <DevelopViewport
          picture={picture}
          hasFile={Boolean(file)}
          emptyText={emptyText}
          pixelView={pixelView}
          facts={facts}
          marks={subjectMarks}
          // Shown whenever the subject layer is open — a picked point is a fact
          // about the layer, not about the tool — but removable only while Pick
          // is on, so a settled mask cannot be edited by a stray click.
          onUnmark={paintKind === 'subject' ? unmarkSubject : undefined}
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
        {/* The crop's own line stays UNDER the stage: the framing handles
            reach into every corner of that picture, so a box over it would
            cover a grip. On the Develop tab the same facts are drawn IN the
            corner instead (`facts`), where the room is. */}
        {cropping && !(compact && sheetOpen) && (
          <p className="m-0 flex-none font-mono text-2xs text-faint leading-relaxed">
            {source
              ? 'drag inside to move · on the picture to draw · a handle to resize · double-click for the largest'
              : 'the crop needs the picture'}
          </p>
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
              <DevelopBaseSection
                offer={rawOffer}
                base={draft.draft.base === 'raw' ? 'raw' : 'render'}
                onBase={(base) => {
                  if (base === 'raw') {
                    patchDraft({ base: 'raw' });
                    if (!draft.asShot) tell('your numbers now act on the RAW — another starting point');
                  } else {
                    patchDraft({ base: null, rawGain: null });
                  }
                }}
                status={wantsRaw && (rawStatus || !picture.source) ? (rawStatus ?? 'decoding the sensor’s data…') : null}
                gain={draft.draft.base === 'raw' ? rawGain : null}
                originalName={origin?.name ?? null}
                originalBytes={origin?.bytes ?? null}
                numbersSet={!draft.asShot}
              />
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
          ) : tab === 'detail' ? (
            <DetailPanel value={detailDraft} onChange={setDetailDraft} />
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
                    subject={
                      selectedLayer.mask?.kind === 'subject'
                        ? {
                            working: subject.working === selectedLayer.id,
                            state: subject.state,
                            resolved: subjectRasters.has(selectedLayer.id),
                          }
                        : null
                    }
                    onClearSubject={() =>
                      setLayersDraft((list) =>
                        list.map((l) =>
                          l.id === selectedLayer.id && l.mask?.kind === 'subject'
                            ? { ...l, mask: { ...l.mask, points: [] } }
                            : l,
                        ),
                      )
                    }
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

      {helpOpen && <DevelopShortcuts onClose={() => setHelpOpen(false)} />}
    </>
  );
}
