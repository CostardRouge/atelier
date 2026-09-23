import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  DevelopActionsGroup,
  DevelopApplySection,
  DevelopLookSection,
  DevelopPresetsSection,
} from '../../shared/develop/DevelopSections';
import DevelopCurve from '../../shared/develop/DevelopCurve';
import { developButtonClass } from '../../shared/develop/develop-classes';
import { DevelopAutoSection, DevelopLevelsSection } from '../../shared/develop/DevelopAuto';
import { whiteBalanceFor } from '../../shared/develop/auto-develop';
import DevelopHistogram from '../../shared/develop/DevelopHistogram';
import DevelopSliders from '../../shared/develop/DevelopSliders';
import DevelopViewport from '../../shared/develop/DevelopViewport';
import {
  DEFAULT_DEVELOP,
  baseRung,
  developBase,
  developLines,
  isDefaultDevelop,
  signed,
  type DevelopSettings,
} from '../../shared/develop/develop';
import {
  calibrationAt,
  readRawCalibration,
  rungsFor,
  type RawCalibration,
} from '../../shared/raw/calibration';
import { copyDevelop, pasteDevelop } from '../../shared/develop/develop-clipboard';
import type { DevelopApplyVerb } from '../../shared/develop/develop-host';
import { pictureFidelity } from '../../shared/develop/picture-fidelity';
import { DevelopBaseMenu } from '../../shared/develop/DevelopBase';
import { captureInput } from '../../shared/develop/capture-files';
import { useSiblingFacts } from '../../shared/develop/use-sibling-facts';
import { isProxyOverRaw, rawRenderFrom, rawRenderOf } from '../../shared/develop/delivery-source';
import { measurePicture, type MeasuredPicture } from '../../shared/develop/roll-render';
import { fetchSourceFile, sensorSourceFor } from '../../shared/develop/sensor-source';
import { trackedFetch } from '../../shared/tasks/tracked';
import { openingRendition, renditionById, renditionsOf, type PixelSize, type Rendition } from '../../shared/media/renditions';
import { fileIdentity, isRawImage } from '../../shared/library/assets';
import { rawSizes } from '../../shared/exif/raw-probe';
import { captureLine } from '../../shared/exif/exif-summary';
import { useEffectiveExif } from '../../shared/exif/use-effective-exif';
import { knownIdentity, mediaOrigin } from '../../shared/projects/media-identity';
import { heldOriginal, holdOriginal } from '../../shared/sources/original-cache';
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
import type { OverflowItem } from '../../shared/ui/OverflowMenu';
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
import RepairPanel, { DEFAULT_DUST, type DustState, type RepairTool } from './RepairPanel';
import { describeDetail, sameDetail, type DetailImage, type DetailSettings } from '../../shared/render/detail';
import {
  DUST_SCAN_EDGE,
  MAX_PATCHES,
  adjustPatch,
  defaultSource,
  describePatches,
  dustField,
  dustPatch,
  dustSpots,
  dustThreshold,
  dustVeil,
  movePatch,
  newPatchId,
  patchCoverageAt,
  patchExtent,
  patchSource,
  placeSource,
  radiusExtent,
  samePatches,
  type DustField,
  type Patch,
} from '../../shared/render/repair';
import type { RepairRing, RingGesture, RingPart, SpotRing } from '../../shared/develop/DevelopViewport';
import LayersPanel from './LayersPanel';
import MaskPanel from './MaskPanel';
import type { BorderApplyVerb } from './BorderSection';
import { borderLayout, type RollBorder } from '../../shared/develop/border-layout';
import { zoneFromView } from '../../shared/develop/crop-rect';
import { visibleWindow } from '../../shared/ui/pan-zoom';
import ExportPanel, { type ExportVerb } from './ExportPanel';
import CropStage from './CropStage';
import { useCropZone } from './use-crop-zone';
import { CROP_VIEW_FIT, CROP_VIEW_MAX } from './crop-view';
import type { RollExports } from './use-roll-export';

/** How long the picture rests before its filmstrip cell is redrawn. */
const SNAPSHOT_DELAY_MS = 700;

const NO_FILES: readonly File[] = [];

/**
 * What the NEXT stroke is painted with. Kept beside the layer rather than on
 * it: a brush is a tool, and each stroke keeps the settings it was made with
 * so a soft edge and a hard one can live in the same mask. Held by the EDITOR,
 * like the open tab: a size set on one picture is the size on the next.
 */
export interface BrushTool {
  radius: number;
  hardness: number;
  erase: boolean;
}

export const DEFAULT_BRUSH_TOOL: Readonly<BrushTool> = Object.freeze({
  radius: DEFAULT_BRUSH_RADIUS,
  hardness: DEFAULT_BRUSH_HARDNESS,
  erase: false,
});

/** What a delivery key asks for — `RollEditor` turns it into a state. */
export type DeliverAction = 'toggle' | 'auto' | 'ignore';

/** A look batch verb, naming its count ("Apply look to 3 selected"): the host copies the open picture's stored look. */
export interface LookApplyVerb {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

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
  brush,
  onBrush,
  repairTool,
  onRepairTool,
  applyTo,
  lookApplyTo,
  cropApplyTo,
  borderApplyTo,
  onBorder,
  onDevelop,
  onFraming,
  onKeystone,
  onLens,
  onDetail,
  onRepair,
  onLayers,
  onAspect,
  onRendition,
  siblings = NO_FILES,
  exportSettings,
  onExportSettings,
  proxiesOnly,
  onProxiesOnly,
  exports,
  exportVerbs,
  onSnapshot,
  onStep,
  onDeliver,
  deliveryTable = null,
  emptyText = 'This picture is not in the Library — open its folder, or take it from its day on your Winnow. Its numbers can still be set.',
}: {
  picture: RollPicture;
  /** Its bytes — the Library's or the roll's own — or null while they are not in hand. */
  file: File | null;
  /** Which file of the capture the picture is developed from (`RollPicture.rendition`); null for where it opens. */
  onRendition: (rendition: string | null) => void;
  /** The capture's other files a folder listed beside `file` (`AssetParts.siblings`) — a local picture's only. */
  siblings?: readonly File[];
  /** THIS picture's look (roll v5) — the stack follows the open picture; the draft rides it. */
  stack: LutStack;
  compact: boolean;
  sheetOpen: boolean;
  onSheetOpen: (open: boolean) => void;
  /** Which inspector tab is open — lifted to the editor so it survives stepping to another picture. */
  tab: WorkbenchTab;
  onTabChange: (tab: WorkbenchTab) => void;
  /** What the next stroke is painted with — the editor's, so it survives stepping to another picture. */
  brush: BrushTool;
  onBrush: (patch: Partial<BrushTool>) => void;
  /** The heal/clone disc — the editor's, like the brush. */
  repairTool: RepairTool;
  onRepairTool: (patch: Partial<RepairTool>) => void;
  applyTo: readonly DevelopApplyVerb[];
  /** The look's batch verbs — this picture's look written onto others, never its develop. */
  lookApplyTo: readonly LookApplyVerb[];
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
  onRepair: (repair: Patch[]) => void;
  onLayers: (layers: AdjustLayer[]) => void;
  onAspect: (aspect: string) => void;
  /** The roll's delivery settings, edited on the Export tab. */
  exportSettings: RollExport;
  onExportSettings: (patch: Partial<RollExport>) => void;
  /** *Proxies only, for this run* — the editor's, never the roll's. */
  proxiesOnly: boolean;
  onProxiesOnly: (on: boolean) => void;
  /** The roll's still export — its state and what the open picture delivers. */
  exports: RollExports;
  exportVerbs: readonly ExportVerb[];
  onSnapshot: (thumb: Blob) => void;
  onStep: (step: number) => void;
  /**
   * The delivery keys (`P` send ↔ hold, `U` back to the rule, `M` ignore ↔
   * un-ignore): the editor answers from the roll as it stands, since the
   * state depends on whether the picture is edited.
   */
  onDeliver: (action: DeliverAction) => void;
  /** The Export tab's Pictures table — built by the editor, which holds the roll. */
  deliveryTable?: ReactNode;
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
  // The patch list, a draft like the rest: a drag setting a source fires per
  // pointermove, and each move must not be a document write.
  const [repairDraft, setRepairDraft] = useState<Patch[]>(entry.repair ?? []);
  const [repairing, setRepairing] = useState(false);
  // The patch whose ring was last taken hold of: the panel's sliders edit it,
  // ⌫ removes it. Derived from the list each render, so a patch that went
  // (Undo last, Clear, an undo) cannot stay selected.
  const [selectedPatchId, setSelectedPatchId] = useState<string | null>(null);
  const selectedPatch = selectedPatchId ? (repairDraft.find((p) => p.id === selectedPatchId) ?? null) : null;
  // The dust scan's controls — session state, never the roll's.
  const [dust, setDust] = useState<DustState>({ ...DEFAULT_DUST });
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
  const layerPaint = useMemo(
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
  // --- repairing -------------------------------------------------------------
  // The same seam, and the same rule as a stroke: the patch being placed rides
  // a ref, because the pointermove closure reads state one frame behind. A
  // press places the patch and gives it a default source — beside it, to the
  // right, mirrored when that would leave the frame; a drag that clears the
  // patch's own disc then moves the source to where the pointer ends, so a tap
  // heals a spot and a drag says where to borrow from. Only on the Detail tab:
  // the verb lives there, and a tool armed on a tab that does not show it is
  // a gesture nobody can see the reason for.
  const repairActive = repairing && tab === 'detail';
  const liveRepairRef = useRef<Patch | null>(null);
  const repairToolRef = useRef(repairTool);
  repairToolRef.current = repairTool;
  const [pictureAspect, setPictureAspect] = useState(1);
  const repairPaint = useMemo(
    () =>
      repairActive
        ? {
            onStart: (point: [number, number]) => {
              const tool = repairToolRef.current;
              const seed: Patch = {
                id: newPatchId(),
                kind: tool.kind,
                x: point[0],
                y: point[1],
                radius: tool.radius,
                feather: tool.feather,
                dx: 0,
                dy: 0,
              };
              const made = { ...seed, ...defaultSource(seed, pictureAspect) };
              liveRepairRef.current = made;
              setRepairDraft((list) => (list.length >= MAX_PATCHES ? list : [...list, made]));
              // The patch just placed is the one the sliders edit: tap, then
              // size it, is the gesture every darkroom teaches.
              setSelectedPatchId(made.id);
            },
            onMove: (point: [number, number]) => {
              const live = liveRepairRef.current;
              if (!live) return;
              // The source turns round the spot as the hand does, at any
              // distance — inside the disc too — and never nearer than the
              // discs touching (`placeSource`). The first version waited for
              // the hand to clear the disc, which read as a drag that did not
              // follow.
              const placed = placeSource(live, point, pictureAspect);
              if (!placed) return;
              const moved = { ...live, ...placed };
              liveRepairRef.current = moved;
              setRepairDraft((list) => list.map((p) => (p.id === moved.id ? moved : p)));
            },
            onEnd: () => {
              liveRepairRef.current = null;
            },
            gesture: 'drag' as const,
          }
        : null,
    [repairActive, pictureAspect],
  );
  // --- the rings: a patch already placed is moved, never re-made ---------------
  // A drag on a solid ring moves the patch (its source with it); a drag on
  // the dashed one moves where it borrows from; a tap on either selects it.
  // The viewport hands back source points UNBOUNDED, so a hand past the edge
  // still moves the patch to the edge. Read through a ref: the pointermove
  // closure would see the list a frame behind.
  const repairDraftRef = useRef(repairDraft);
  repairDraftRef.current = repairDraft;
  const ringDragRef = useRef<{ id: string; part: RingPart; start: [number, number]; patch: Patch } | null>(null);
  const ringGesture = useMemo<RingGesture>(
    () => ({
      onStart: (id, part, point) => {
        const held = repairDraftRef.current.find((p) => p.id === id);
        if (!held) return;
        ringDragRef.current = { id, part, start: point, patch: held };
        setSelectedPatchId(id);
      },
      onMove: (point) => {
        const d = ringDragRef.current;
        if (!d) return;
        const dx = point[0] - d.start[0];
        const dy = point[1] - d.start[1];
        let moved: Patch;
        if (d.part === 'patch') {
          moved = movePatch(d.patch, d.patch.x + dx, d.patch.y + dy);
        } else {
          // The source's new centre, held to the same rule as a placed one:
          // never on the patch, never off the picture.
          const placed = placeSource(d.patch, [d.patch.x + d.patch.dx + dx, d.patch.y + d.patch.dy + dy], pictureAspect, 0);
          if (!placed) return;
          moved = { ...d.patch, ...placed };
        }
        setRepairDraft((list) => list.map((p) => (p.id === moved.id ? moved : p)));
      },
      onEnd: (travelled) => {
        const d = ringDragRef.current;
        ringDragRef.current = null;
        // A tap on the solid ring takes the patch off (his call: a click,
        // never only a key); a tap on the dashed one has selected it.
        if (!travelled && d?.part === 'patch') {
          setRepairDraft((list) => list.filter((p) => p.id !== d.id));
          setSelectedPatchId(null);
        }
      },
    }),
    [pictureAspect],
  );
  // Only on the Detail tab, where the panel that explains them is: a ring on
  // another tab is a fact about the picture, not a handle.
  const ringsLive = tab === 'detail';
  useEffect(() => {
    if (!ringsLive) setSelectedPatchId(null);
  }, [ringsLive]);
  const paint = repairPaint ?? layerPaint;
  // --- the RAW base ----------------------------------------------------------
  // Where the sensor's data would come from — the file itself, a RAW beside
  // it in its folder, a proxy's own original, or the capture's COMPANION on
  // its instance — is `sensor-source.ts`'s one answer, shared with the
  // export. Nothing is fetched or decoded until the base climbs above the
  // proxy; back on the render the decode is dropped with the source, and a
  // fetched RAW is held for the session (`original-cache.ts`, decision 3).
  // Computed per render, since `held` reads that cache: a fetch that lands
  // sets state, and the next render sees it in hand.
  const origin = useMemo(() => (file ? mediaOrigin(file) : null), [file]);
  const assetKey = file ? (knownIdentity(file)?.assetId ?? null) : null;
  // What this stage's tasks are scoped to (`TaskEdge`): the capture's asset
  // id where a source vouched for one — the same key every fetch of its
  // files uses — else the file's own identity.
  const taskScope = file ? (assetKey ?? fileIdentity(file)) : null;
  const taskScopeRef = useRef(taskScope);
  taskScopeRef.current = taskScope;
  const sensor = file ? sensorSourceFor(file, origin, siblings, assetKey) : null;
  const sensorHeld = sensor?.held ?? null;
  const sensorName = sensor?.name ?? null;
  const wantsRaw = baseRung(draft.draft.base) > 0 && sensor !== null;
  const [rawFile, setRawFile] = useState<File | null>(null);
  const { patch: patchDraft } = draft;
  const sensorRef = useRef(sensor);
  sensorRef.current = sensor;
  useEffect(() => {
    const source = sensorRef.current;
    if (!wantsRaw || rawFile || !source) return;
    if (source.held) {
      setRawFile(source.held);
      return;
    }
    let alive = true;
    // The fetch is a task: the pill and the stage's edge say it (T2), so no
    // prose of its own here — only what went wrong, below.
    fetchSourceFile(source, taskScopeRef.current)
      .then((fetched) => {
        if (!alive) return;
        setRawFile(fetched);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        tell(`${source.name} could not be fetched: ${err instanceof Error ? err.message : String(err)}`);
        patchDraft({ base: null, rawGain: null });
      });
    return () => {
      alive = false;
    };
  }, [wantsRaw, rawFile, sensorHeld, sensorName, tell, patchDraft]);
  const rawGain = draft.draft.rawGain ?? null;
  // The calibration the RAW carries, read from a megabyte of its head as soon
  // as it is in hand — it is what decides whether the two top rungs are
  // offered at all, and what the passes apply at them.
  const [calibration, setCalibration] = useState<RawCalibration | null>(null);
  useEffect(() => {
    setCalibration(null);
    const source = rawFile ?? sensorHeld;
    if (!source) return;
    let alive = true;
    void readRawCalibration(source).then((cal) => {
      if (alive) setCalibration(cal);
    });
    return () => {
      alive = false;
    };
  }, [rawFile, sensorHeld]);
  const rungs = rungsFor(calibration);
  // A rung the file cannot reach is never left standing: a picture developed
  // on `gainMapWarp` and then opened from a file whose opcodes are gone falls
  // back to what IS there, rather than claiming a correction it cannot apply.
  const rung = rungs.includes(developBase(draft.draft)) ? developBase(draft.draft) : rungs[rungs.length - 1];
  // Memoised: `calibrationAt` builds a fresh record per call, and the hook
  // below took the record's identity as a dep of an effect that sets state —
  // a RAW on the gain-map rung re-rendered, re-graded and read the GPU back
  // at frame rate for as long as it was open.
  const applied = useMemo(() => calibrationAt(rung, calibration), [rung, calibration]);
  // The sensor's own pixels, read from the RAW's head alone (a megabyte, no
  // decoder): what the render on screen is measured against. A proxy's
  // original needs no read at all — its source already said.
  const [sensorSize, setSensorSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    setSensorSize(null);
    if (!file || !isRawImage(file.name)) return;
    let alive = true;
    void rawSizes(file).then((sizes) => {
      if (alive) setSensorSize(sizes.sensor);
    });
    return () => {
      alive = false;
    };
  }, [file]);
  const proxyOriginalSize =
    origin?.fidelity === 'proxy' && origin.width && origin.height
      ? { width: origin.width, height: origin.height }
      : null;

  // --- the capture's files ---------------------------------------------------
  // Which FILE of the capture is on screen below the sensor
  // (`docs/capture-renditions.md` §9.1): its proxy, or what the camera
  // delivered — a drawable original fetched once and held, the render inside
  // a RAW, a sibling a folder listed beside it. The list is built from what is
  // in hand and what the source said; nothing is fetched until a row is chosen.
  //
  // A sibling is listed only once its head is read: whether it is an export
  // of ours (`software-mark.ts`, never offered as the camera's file), and the
  // sizes a RAW states.
  const siblingFacts = useSiblingFacts(siblings);
  // What the session knows of the proxy's original and of the capture's
  // companion: whether each is held, and — for a RAW — how big the render
  // inside it is, read from its head once (`original-cache.ts`). `undefined`
  // is "not read yet". Held-ness is read per render: a fetch that lands sets
  // state, so the rows say `here` on the next one.
  const originalHeld = assetKey ? heldOriginal(assetKey) !== null : false;
  const companion = origin?.companion ?? null;
  const companionHeld = companion ? heldOriginal(companion.assetId) !== null : false;
  const [originalRender, setOriginalRender] = useState<PixelSize | null | undefined>(undefined);
  useEffect(() => {
    setOriginalRender(undefined);
    if (!origin || !isProxyOverRaw(origin)) return;
    let alive = true;
    void rawRenderOf(origin, assetKey).then(({ render }) => {
      if (alive) setOriginalRender(render);
    });
    return () => {
      alive = false;
    };
  }, [origin, assetKey]);
  const [companionRender, setCompanionRender] = useState<PixelSize | null | undefined>(undefined);
  useEffect(() => {
    setCompanionRender(undefined);
    if (!companion || !isRawImage(companion.name)) return;
    let alive = true;
    void rawRenderFrom(companion.fetchHead, companion.assetId).then(({ render }) => {
      if (alive) setCompanionRender(render);
    });
    return () => {
      alive = false;
    };
  }, [companion]);
  const rows = useMemo<Rendition[]>(() => {
    if (!file) return [];
    return renditionsOf(
      captureInput({
        file,
        origin,
        measured: exports.openSize,
        sensor: sensorSize,
        original: { assetId: assetKey, held: originalHeld, render: originalRender },
        companion: companion ? { held: companionHeld, render: companionRender } : undefined,
        siblings: siblings.flatMap((s) => {
          const facts = siblingFacts.get(fileIdentity(s));
          return facts ? [{ file: s, facts }] : [];
        }),
      }),
    );
  }, [
    file,
    origin,
    exports.openSize,
    sensorSize,
    assetKey,
    originalHeld,
    originalRender,
    companion,
    companionHeld,
    companionRender,
    siblings,
    siblingFacts,
  ]);
  const opening = openingRendition(rows);
  const chosen = renditionById(rows, entry.rendition);
  // The row on screen below the sensor: the stored choice where the capture
  // still offers it, else where the picture opens — never a blocked row.
  const current = (chosen && chosen.role !== 'sensor' && !chosen.blocked ? chosen : opening)?.id ?? null;
  const wanted = !wantsRaw && chosen && chosen.role === 'delivered' && !chosen.blocked && chosen.id !== opening?.id ? chosen : null;
  const wantedId = wanted?.id ?? null;
  // The delivered file for the stage: in hand already (a sibling, a held
  // original), else fetched once and held for the session. Keyed on the id
  // alone, so a list rebuilt around it never restarts a fetch in flight.
  const [deliveredFile, setDeliveredFile] = useState<{ id: string; file: File } | null>(null);
  const deliver = useRef({ wanted, siblings, origin, tell, onRendition });
  deliver.current = { wanted, siblings, origin, tell, onRendition };
  useEffect(() => {
    const { wanted: row, siblings: beside, origin: from } = deliver.current;
    if (!row || row.id !== wantedId || !file) return;
    const isNamed = (name: string) => name.toLowerCase() === row.name.toLowerCase();
    const named = (f: File | null): f is File => !!f && isNamed(f.name);
    const inHand = beside.find(named) ?? (row.assetId ? heldOriginal(row.assetId) : null);
    if (named(inHand)) {
      setDeliveredFile({ id: row.id, file: inHand });
      return;
    }
    // The row's own fetch: the capture's companion by its name, else the
    // proxy's original — each held under the row's own asset id.
    const fetch = from?.companion && isNamed(from.companion.name) ? from.companion.fetchFile : (from?.fetchOriginal ?? null);
    if (!fetch) return;
    let alive = true;
    // A task of its own — the pill and the edge say it — and only a failure
    // is said here.
    trackedFetch({ label: `Fetching ${row.name}`, scope: taskScopeRef.current, bytes: row.bytes }, (opts) => fetch(opts))
      .then((fetched) => {
        if (!alive) return;
        if (row.assetId) holdOriginal(row.assetId, fetched);
        setDeliveredFile({ id: row.id, file: fetched });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        deliver.current.tell(`${row.name} could not be fetched: ${err instanceof Error ? err.message : String(err)}`);
        deliver.current.onRendition(null);
      });
    return () => {
      alive = false;
    };
  }, [wantedId, file]);
  const shownFile = wanted && deliveredFile?.id === wanted.id ? deliveredFile.file : file;
  // The open file is measured by the export hook; a delivered file on the
  // stage is measured here, once, for the chip and the kernels.
  const [shownSize, setShownSize] = useState<{ file: File; size: MeasuredPicture } | null>(null);
  useEffect(() => {
    if (!shownFile || shownFile === file) return;
    let alive = true;
    void measurePicture(shownFile).then((size) => {
      if (alive && size) setShownSize({ file: shownFile, size });
    });
    return () => {
      alive = false;
    };
  }, [shownFile, file]);
  const measured = shownFile === file ? exports.openSize : shownSize?.file === shownFile ? shownSize.size : null;

  const fullWidth = (wantsRaw ? rawSize?.w : null) ?? measured?.width ?? null;
  // The dust scan's FIELD (measured below, once the picture is decoded) and
  // the veil drawn from it — declared ahead of the stage, which takes the
  // veil as an input and hands back the picture the field is measured on.
  const [field, setField] = useState<DustField | null>(null);
  const threshold = dustThreshold(dust.sensitivity);
  /** The map: what falls below its surroundings, white on black, at the scan's size. */
  const veil = useMemo(() => {
    if (!field || !dust.map) return null;
    const { width: w, height: h } = field;
    const values = dustVeil(field, threshold);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const pixels = ctx.createImageData(w, h);
    const out = pixels.data;
    for (let i = 0, j = 0; i < values.length; i += 1, j += 4) {
      const v = Math.round(values[i] * 255);
      out[j] = v;
      out[j + 1] = v;
      out[j + 2] = v;
      out[j + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    return { image: canvas as CanvasImageSource, width: w, height: h };
  }, [field, dust.map, threshold]);
  const picture = useDevelopPicture({
    file: shownFile,
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
    repair: repairDraft,
    // The dust map, when the scan shows it: drawn through the stage's own
    // crop so a proposed ring lands on the mark it names.
    veil,
    // The roll's texture, drawn by the node after everything: the stage is
    // where grain is DIALLED and the loupe is where it is judged, since a
    // cell finer than the stage can resolve fades out rather than aliasing.
    film: stack.film,
    pixelScale: stageWidth && fullWidth ? Math.min(1, stageWidth / fullWidth) : 1,
    loupe: true,
    pixelView,
    // The camera's own calibration at the rung this picture stands on — the
    // shading grid first on the sensor's data, the warp before the lens. The
    // PREVIEW carries it from `gain map` up, so export-at-max is a no-op for
    // shading and preview = export holds by construction (`raw.md`).
    calibration: wantsRaw ? applied : null,
    // The measured exposure is STORED the moment it is known, so the export's
    // decode applies the same number (`raw.md`). Once: a stored gain is never
    // overwritten by a later decode's measurement.
    taskScope,
    // Cancelled from the pill: back on the render, and said — a base whose
    // data never arrived is not a base.
    onRawAborted: () => {
      patchDraft({ base: null, rawGain: null });
      tell('Opening the RAW was cancelled — back on the render');
    },
    onRawDecoded: (info) => {
      setRawSize({ w: info.sourceWidth, h: info.sourceHeight });
      if (rawGain === null) {
        patchDraft({ base: developBase(draft.draft) === 'proxy' ? 'gain' : draft.draft.base, rawGain: info.gain });
        const ev = Math.log2(info.gain);
        tell(`RAW · ${info.width}×${info.height}${info.halved ? ' (half size)' : ''} · metered ${ev ? `${signed(ev, 1)} EV` : 'at its white'}`);
      }
    },
  });
  // What the picture IS, with the pixels it really has: the file's own,
  // measured for the *Delivers* row, or the sensor's once the RAW is decoded —
  // and, beside them, what the file holds and the screen is not showing (the
  // sensor plane of a RAW, the original behind a proxy). A 960 × 540 render
  // inside a 36-megapixel DNG says so here rather than merely looking soft.
  const fidelityPixels = useMemo(() => {
    if (wantsRaw && rawSize) return { width: rawSize.w, height: rawSize.h };
    if (!measured) return null;
    return {
      width: measured.width,
      height: measured.height,
      viaRawPreview: measured.viaRawPreview,
      // A delivered file on the stage IS the capture's pixels: nothing to fall short of.
      full: shownFile === file ? (sensorSize ?? proxyOriginalSize) : null,
    };
  }, [wantsRaw, rawSize, measured, sensorSize, proxyOriginalSize, shownFile, file]);
  const fidelity = pictureFidelity(shownFile, draft.draft.base, fidelityPixels);
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
  const callbacks = useRef({ onDevelop, onFraming, onKeystone, onLens, onDetail, onRepair, onLayers, onAspect, onSnapshot, onStep, onTabChange, onDeliver });
  callbacks.current = { onDevelop, onFraming, onKeystone, onLens, onDetail, onRepair, onLayers, onAspect, onSnapshot, onStep, onTabChange, onDeliver };
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
  useWriteThrough<Patch[]>({
    stored: entry.repair?.length ? entry.repair : null,
    draft: repairDraft.length ? repairDraft : null,
    same: (a, b) => samePatches(a, b),
    onWrite: (value) => callbacks.current.onRepair(value ?? []),
    onReseed: (value) => setRepairDraft(value ?? []),
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
  useEffect(() => setPictureAspect(source && source.height > 0 ? source.width / source.height : 1), [source]);

  // --- finding dust ------------------------------------------------------------
  // The stage's own decode, read back ONCE at the scan's edge into a field
  // (`dustField`) the moment the scan is turned on; the sensitivity slider
  // then reads the field and never the picture. The spots are PROPOSED —
  // dotted rings the author accepts one by one or all at once — and the map
  // is a veil over the picture, drawn through the stage's own crop. Nothing
  // of it is stored but the patches that are taken.
  useEffect(() => {
    if (!dust.on || !source) {
      setField(null);
      return;
    }
    const k = Math.min(1, DUST_SCAN_EDGE / Math.max(source.width, source.height));
    const w = Math.max(8, Math.round(source.width * k));
    const h = Math.max(8, Math.round(source.height * k));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    let bytes: Uint8ClampedArray;
    try {
      ctx.drawImage(source.image, 0, 0, source.width, source.height, 0, 0, w, h);
      bytes = ctx.getImageData(0, 0, w, h).data;
    } catch {
      setField(null);
      return;
    }
    const data = new Float32Array(w * h * 3);
    for (let i = 0, j = 0; i < bytes.length; i += 4, j += 3) {
      data[j] = bytes[i] / 255;
      data[j + 1] = bytes[i + 1] / 255;
      data[j + 2] = bytes[i + 2] / 255;
    }
    const img: DetailImage = { width: w, height: h, data };
    setField(dustField(img));
  }, [dust.on, source]);
  /** The spots the scan proposes at this sensitivity, less those already under a patch. */
  const spots = useMemo(() => {
    if (!field) return null;
    return dustSpots(field, { threshold }).filter((spot) => !repairDraft.some((have) => patchCoverageAt(have, spot.x, spot.y, pictureAspect) > 0));
  }, [field, threshold, repairDraft, pictureAspect]);
  const spotRings = useMemo<readonly SpotRing[] | null>(
    () => (spots ? spots.map((spot) => ({ x: spot.x, y: spot.y, ru: radiusExtent(spot.radius, pictureAspect).ru })) : null),
    [spots, pictureAspect],
  );
  const healSpot = useCallback(
    (index: number) => {
      const spot = spots?.[index];
      if (!spot || !field) return;
      const made = dustPatch(field, spot, newPatchId, repairToolRef.current.feather);
      if (!made) {
        tell('that spot sits where no neighbour can be borrowed from — place a patch by hand');
        return;
      }
      setRepairDraft((list) => (list.length >= MAX_PATCHES ? list : [...list, made]));
    },
    [spots, field, tell],
  );
  const healAllSpots = useCallback(() => {
    if (!spots || !field) return;
    const made = spots.map((spot) => dustPatch(field, spot, newPatchId, repairToolRef.current.feather)).filter((p): p is Patch => p !== null);
    setRepairDraft((list) => {
      const room = Math.max(0, MAX_PATCHES - list.length);
      const added = made.slice(0, room);
      tell(
        added.length === 0
          ? room === 0
            ? `${made.length} found, no room left`
            : 'no spot could be healed from a neighbour'
          : `${added.length} spot${added.length === 1 ? '' : 's'} healed${added.length < made.length ? ` · ${made.length - added.length} left, no room` : ''}`,
      );
      return added.length ? [...list, ...added] : list;
    });
  }, [spots, field, tell]);
  /** The patches as rings on the picture: the destination solid, its source dashed, the selected one in the accent. */
  const rings = useMemo<readonly RepairRing[] | null>(() => {
    if (!repairDraft.length) return null;
    return repairDraft.map((p) => {
      const from = patchSource(p);
      const { ru, rv } = patchExtent(p, pictureAspect);
      return { id: p.id, x: p.x, y: p.y, sx: from.x, sy: from.y, ru, rv, kind: p.kind, selected: p.id === selectedPatchId };
    });
  }, [repairDraft, pictureAspect, selectedPatchId]);
  const changeSelectedPatch = useCallback(
    (change: Partial<Pick<Patch, 'kind' | 'radius' | 'feather'>>) => {
      if (!selectedPatchId) return;
      setRepairDraft((list) => list.map((p) => (p.id === selectedPatchId ? adjustPatch(p, change) : p)));
    },
    [selectedPatchId],
  );
  const removeSelectedPatch = useCallback(() => {
    if (!selectedPatchId) return;
    setRepairDraft((list) => list.filter((p) => p.id !== selectedPatchId));
    setSelectedPatchId(null);
  }, [selectedPatchId]);
  // The Crop tab's zone, measured on the decoded picture and written back as
  // the aspect (to the roll, at once) and the framing (through its draft).
  // Memoised on the source: a fresh `{ width, height }` per render recomputed
  // the zone and the view, and both canvases under them repainted — a
  // rotated, high-quality draw at device pixels — on every render.
  const cropSrc = useMemo(() => (source ? { width: source.width, height: source.height } : null), [source]);
  const crop = useCropZone({
    src: cropSrc,
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
  const keyState = useRef({ draft, picture, tell, crop, tab, factsOn, setFactsOn, selectedPatchId, removeSelectedPatch, repairing });
  keyState.current = { draft, picture, tell, crop, tab, factsOn, setFactsOn, selectedPatchId, removeSelectedPatch, repairing };
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
      if (typeof action === 'object') {
        e.preventDefault();
        callbacks.current.onTabChange(action.tab);
        return;
      }
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
        case 'help':
          e.preventDefault();
          // The same key closes it: a sheet opened by a letter that then does
          // nothing is a sheet you have to reach for the mouse to be rid of.
          setHelpOpen((was) => !was);
          return;
        case 'deliver':
        case 'deliver-auto':
        case 'ignore':
          e.preventDefault();
          callbacks.current.onDeliver(action === 'deliver' ? 'toggle' : action === 'deliver-auto' ? 'auto' : 'ignore');
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
        case 'crop-view':
          // Only where the stage offers it — zoomed, off the Crop tab.
          if (!cropToViewRef.current) return;
          e.preventDefault();
          cropToViewRef.current();
          return;
        case 'remove':
          // What is selected on the picture — a repair patch. Nothing
          // selected, the key is somebody else's.
          if (!keyState.current.selectedPatchId) return;
          e.preventDefault();
          keyState.current.removeSelectedPatch();
          return;
        case 'escape':
          // Let go of the selected patch first; then put the Repair tool
          // down. An Escape with nothing to release is left to the page.
          if (keyState.current.selectedPatchId) {
            e.preventDefault();
            setSelectedPatchId(null);
            return;
          }
          if (keyState.current.repairing) {
            e.preventDefault();
            setRepairing(false);
          }
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

  // --- crop to the view --------------------------------------------------------
  // Zoomed in on the Adjust stage, what is on screen is often the crop being
  // looked for — and finding it again on the Crop tab took several trips (the
  // maintainer, 2026-09-23, after iOS Photos' own Crop button). So a zoomed
  // stage offers it: the visible part of the delivered canvas read back into
  // the crop's zone (`zoneFromView`), written like a drawn zone, the view back
  // at the fit where the new picture is exactly what was on screen. Never on a
  // legacy Whole framing, whose canvas is not its zone.
  const viewCrop =
    source && !cropping && picture.view.zoomed && crop.src && crop.zone && framingDraft.fit !== 'contain'
      ? zoneFromView(
          crop.zone,
          borderLayout(crop.zone.w, crop.zone.h, border),
          visibleWindow(picture.view.rect, picture.view.viewport),
          framingDraft.rotation,
          crop.src,
        )
      : null;
  const cropToView = viewCrop
    ? () => {
        crop.cropTo(viewCrop.zone);
        picture.view.fit();
        tell(viewCrop.clamped ? 'cropped to the view · as close as a crop may go' : 'cropped to the view · C to adjust');
      }
    : null;
  const cropToViewRef = useRef(cropToView);
  cropToViewRef.current = cropToView;
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
  const tabLabel = WORKBENCH_TABS.find((t) => t.id === tab)?.label ?? 'Adjust';

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
    if (repairDraft.length) lines.push(describePatches(repairDraft));
    if (fidelity.note) lines.push(fidelity.note);
    return lines;
  }, [factsOn, draft.draft, drawingCount, detailDraft, repairDraft, fidelity.note]);

  /**
   * What the CAMERA did, drawn above those facts under the same key — the
   * aperture, the shutter, the ISO and the compensation, from the head of the
   * file ON SCREEN. The rendition is what makes that read honest: switch the
   * picture to its DNG and these are the DNG's own numbers; leave it on a
   * Winnow proxy, whose re-encode carries no metadata at all, and the line is
   * the instance's vouched record (`exif/read-exif.ts` merges the two).
   *
   * Absent for a picture that says nothing, and the stack then starts where
   * it always did.
   */
  const shotExif = useEffectiveExif(shownFile);
  const shotLine = useMemo(() => (factsOn ? captureLine(shotExif) || null : null), [factsOn, shotExif]);

  /**
   * The two verbs the HOST puts in the well beside the clipboard glyphs: their
   * SHAPE here, their colour at the call site.
   *
   * Written out rather than composed from `IconButton`: both carry a state the
   * button has no variant for (the A/B's on / off / suspended) and a glyph that
   * is TEXT, and a `Button` recipe plus an override is not the same thing — two
   * utilities of one property are resolved by Tailwind's order, not by the class
   * list's (`frontend.md`). The height is `IconButton`'s to the pixel, so the
   * well reads as one family, and the colours are the Studio's A/B.
   */
  const verbHeight = compact ? 'h-[2.125rem]' : 'h-7';
  const abPill =
    `${verbHeight} px-2 flex-none inline-flex items-center justify-center rounded-control border ` +
    'font-mono text-2xs tracking-[0.06em] whitespace-nowrap cursor-pointer transition-colors';
  /** The `?`, square like the glyphs it sits beside rather than a pill of its own. */
  const helpVerb =
    `${verbHeight} ${compact ? 'w-[2.125rem]' : 'w-7'} flex-none inline-flex items-center justify-center ` +
    'rounded-control border font-mono text-xs cursor-pointer transition-colors';
  /** The wipe is suspended, and the pill says so rather than claiming to be on. */
  const abHeld = compareOn && (picture.painting || picture.picking);

  /**
   * What hangs off the zoom's percentage: the two rungs a menu can name, then
   * how a magnified pixel is DRAWN. Both readings are true at every scale, but
   * the mode only changes the picture past 1:1 — so each says where it applies
   * instead of the control vanishing below it, which is what used to move the
   * bar under the pointer.
   */
  const zoomRow = (marked: boolean, title: string, hint: string) => (
    <span className="flex flex-col items-start gap-0.5 text-left">
      <span className="font-mono text-xs">
        {marked ? '· ' : '  '}
        {title}
      </span>
      <span className="font-mono text-3xs text-faint leading-relaxed max-w-[18rem] whitespace-normal">{hint}</span>
    </span>
  );
  const atOnePixel = Math.abs(picture.view.zoom.scale - picture.view.onePixel) < 0.005;
  const zoomItems: OverflowItem[] = [
    {
      id: 'fit',
      label: zoomRow(!picture.view.zoomed, 'Fit', 'the whole picture, in the room it has'),
      disabled: !picture.view.zoomed,
      onSelect: () => picture.view.zoom.reset(),
    },
    {
      id: 'one-pixel',
      label: zoomRow(atOnePixel, '100 %', 'one of the picture’s pixels per pixel of this screen'),
      disabled: atOnePixel || !picture.view.zoom.zoomTo,
      onSelect: () => picture.view.zoom.zoomTo?.(picture.view.onePixel),
    },
    {
      id: 'smooth',
      label: zoomRow(
        pixelView === 'smooth',
        'Smooth',
        'past 100 %, the gradients between pixels are the browser’s, not the picture’s',
      ),
      onSelect: () => setPixelView('smooth'),
    },
    {
      id: 'pixels',
      label: zoomRow(pixelView === 'pixels', 'Pixels as pixels', 'past 100 %, nothing is invented between them'),
      onSelect: () => setPixelView('pixels'),
    },
    {
      id: 'crop-view',
      label: zoomRow(false, 'Crop to this view', 'what the screen shows becomes the crop · ⇧C'),
      disabled: !cropToView,
      onSelect: () => cropToView?.(),
    },
  ];

  return (
    <>
      <div className={compact ? 'flex-1 min-h-0 flex flex-col gap-2' : 'col-start-1 row-start-1 min-w-0 min-h-0 flex flex-col gap-2'}>
        {/* One row above a phone: the name gives way first, the verbs never
            wrap. On a phone the name gave way ENTIRELY ("D…" at 390px), so
            the verbs take a line of their own under it — `contents` at every
            other width keeps the desktop row the one flex line it was — and
            every verb grows to a finger's height (`md` rather than `sm`). */}
        <div className="flex-none flex flex-wrap items-center gap-x-2 gap-y-1.5 min-w-0">
          {/* The NAME is the list of the capture's files (2026-09-22): the two
              answered the same question — which bytes are on screen — so they
              are one control, and the rendition stops costing a pill. Which is
              what lets it be drawn at every width: as a chip of its own it was
              hidden under 880px, and a phone could not reach it at all. */}
          <div className="flex-1 min-w-0 flex items-baseline gap-2">
            <DevelopBaseMenu
              className="min-w-0"
              name={entry.ref.name}
              chip={fidelity.chip}
              rows={rows}
              current={current}
              base={wantsRaw ? rung : 'proxy'}
              rungs={sensor ? rungs : []}
              onRendition={(id) => {
                // A file below the sensor: the base comes off with it, and
                // the opening row is stored as nothing, one spelling.
                if (baseRung(draft.draft.base) > 0) patchDraft({ base: null, rawGain: null });
                onRendition(id === opening?.id ? null : id);
              }}
              onBase={(next) => {
                if (next === 'proxy') {
                  patchDraft({ base: null, rawGain: null });
                  return;
                }
                const climbing = baseRung(draft.draft.base) === 0;
                patchDraft({ base: next });
                if (climbing && !draft.asShot) {
                  tell('your numbers now act on the RAW — another starting point');
                }
              }}
              status={wantsRaw ? (picture.problem ?? (!picture.source ? 'decoding the sensor’s data…' : null)) : null}
              gain={wantsRaw ? rawGain : null}
              calibration={calibration?.summary ?? null}
            />
            {told && (
              <span className="flex-none font-mono text-xs text-accent-ink" role="status">
                · {told}
              </span>
            )}
          </div>
          <div className={compact ? 'basis-full flex items-center gap-2 min-w-0' : 'contents'}>
          {compact && <span className="flex-1" />}
          {/* The pill is drawn at EVERY width, phone included — the lightbox
              hides it under 820px on the argument that the pinch is the gesture
              there, and a stage that answers a pinch best-effort (the browser
              can still take the fingers) needs the way in that always answers
              (`frontend.md`, «what it costs»). On the crop it drives the
              FRAMING's own zoom, which is what the picture is cropped by. */}
          {source &&
            (cropping ? (
              <StageZoomControl zoom={cropZoom} hint="look closer: pinch, the wheel or Z — the crop stays" className="flex-none" />
            ) : (
              // How the picture is DRAWN hangs off the percentage, which was
              // already the "back to the fit" button (that rung is now the
              // menu's first). The mode used to be a pill INSERTED past 1:1,
              // and inserting it slid every verb after it sideways — so a
              // second press of `+` landed on `pixels`, which is the fault
              // reported. Nothing is inserted now; the pill has one width.
              <StageZoomControl
                zoom={picture.view.zoom}
                hint="wheel, pinch, or Z"
                className="flex-none"
                items={zoomItems}
              />
            ))}
          {/* ONE well of verbs ends the row (variant E2): the three clipboard
              glyphs, then — past a hairline — the two that are about this
              stage. Loose pills read as five unrelated things; a block reads as
              "what you can do here", and the row has one edge instead of five.

              The split still says `A/B`, the Studio's own word for the same
              gesture: one wipe control across the suite is one thing to learn.
              While a mask tool holds the pointer the hook has suspended it
              anyway, and the button draws that (dashed, faint) rather than
              lying about a divider nobody can see. */}
          <DevelopActionsGroup
            className="flex-none"
            size={compact ? 'md' : 'sm'}
            clipboard={!cropping}
            draft={draft.draft}
            asShot={draft.asShot}
            onReplace={draft.setDraft}
            onTold={tell}
          >
            {source && !cropping && (
              <button
                type="button"
                className={`${abPill} ${
                  abHeld
                    ? 'border-line-strong border-dashed bg-paper-2 text-faint'
                    : compareOn
                      ? 'border-accent bg-accent-wash text-accent-ink'
                      : 'border-line-strong bg-surface text-muted hover:border-accent hover:text-accent-ink'
                }`}
                onClick={() => setCompareOn(!compareOn)}
                aria-pressed={compareOn}
                title={
                  abHeld
                    ? 'Before / after — suspended while a mask tool has the pointer; the divider comes back where it was'
                    : compareOn
                      ? 'Before / after — the divider is on, and a drag across the picture places it'
                      : 'Before / after — off: the whole picture is shown corrected'
                }
              >
                A/B
              </button>
            )}
            {/* The legend that used to run along the bottom of the editor, as a
                verb. Drawn at every width: on a phone there are no keys, but the
                GESTURES it lists are exactly the ones a finger has to
                discover. */}
            <button
              type="button"
              className={`${helpVerb} border-transparent bg-transparent text-muted hover:text-accent-ink`}
              onClick={() => setHelpOpen(true)}
              title="Keys and gestures (H)"
              aria-label="Keys and gestures"
            >
              ?
            </button>
          </DevelopActionsGroup>
          </div>
        </div>
        <DevelopViewport
          picture={picture}
          hasFile={Boolean(file)}
          emptyText={emptyText}
          scope={taskScope}
          pixelView={pixelView}
          facts={facts}
          shot={shotLine}
          marks={subjectMarks}
          // Shown whenever the subject layer is open — a picked point is a fact
          // about the layer, not about the tool — but removable only while Pick
          // is on, so a settled mask cannot be edited by a stray click.
          onUnmark={paintKind === 'subject' ? unmarkSubject : undefined}
          // The rings show on every tab — a patch is a fact about the
          // picture — and answer the hand on the Detail tab, where the panel
          // that explains them is. The proposed spots belong to the scan.
          rings={rings}
          onRing={ringsLive ? ringGesture : undefined}
          spots={ringsLive ? spotRings : null}
          onSpot={ringsLive ? healSpot : undefined}
          onCropToView={cropToView ?? undefined}
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
          {tab === 'adjust' ? (
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
              <DevelopLookSection
                stack={stack}
                legend={
                  <p>
                    This picture’s own look, applied AFTER its correction — the next picture keeps its
                    own, and <em>Apply look to…</em> is the one way to dress others with it. Looks apply
                    top to bottom and the output transform last.
                  </p>
                }
                header={
                  lookApplyTo.length > 0 ? (
                    <div className="flex flex-wrap items-start gap-2">
                      {lookApplyTo.map((verb) => (
                        <button
                          key={verb.id}
                          type="button"
                          title={verb.hint}
                          onClick={() => {
                            verb.run();
                            tell(`done · ${verb.label.toLowerCase()}`);
                          }}
                          className={developButtonClass}
                        >
                          {verb.label}
                        </button>
                      ))}
                    </div>
                  ) : null
                }
                previewHeight={picture.canvasSize?.h ?? null}
                // The decoded picture already on the stage: the look gallery's
                // scene grades THIS photograph rather than a reference frame.
                previewImage={picture.source}
                previewLabel={entry.ref.name}
              />
            </>
          ) : tab === 'detail' ? (
            <>
              <RepairPanel
                patches={repairDraft}
                tool={repairTool}
                onTool={onRepairTool}
                selected={selectedPatch}
                onSelectedChange={changeSelectedPatch}
                onRemoveSelected={removeSelectedPatch}
                onDeselect={() => setSelectedPatchId(null)}
                repairing={repairing}
                onRepairing={setRepairing}
                dust={dust}
                onDust={(change) => setDust((d) => ({ ...d, ...change }))}
                spotsFound={spots ? spots.length : null}
                onHealAll={healAllSpots}
                onRemoveLast={() => setRepairDraft((list) => list.slice(0, -1))}
                onClear={() => setRepairDraft([])}
              />
              <DetailPanel value={detailDraft} onChange={setDetailDraft} />
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
                    onBrush={onBrush}
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
              plan={exports.plan}
              proxiesOnly={proxiesOnly}
              onProxiesOnly={onProxiesOnly}
              verbs={exportVerbs}
              exporting={exports.exporting}
              note={exports.note}
              hdrRun={exports.lastRun?.hdr ?? null}
              pictures={deliveryTable}
              openExif={shotExif}
            />
          ) : null}
        </div>
      </PanelHost>

      {helpOpen && <DevelopShortcuts onClose={() => setHelpOpen(false)} />}
    </>
  );
}
