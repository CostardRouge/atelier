import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  DevelopActionsGroup,
  DevelopApplySection,
  DevelopLookSection,
  DevelopPresetsSection,
  type DevelopClipVerbs,
} from '../../shared/develop/DevelopSections';
import DevelopCurve from '../../shared/develop/DevelopCurve';
import { developButtonClass } from '../../shared/develop/develop-classes';
import { DevelopAutoSection, DevelopLevelsSection } from '../../shared/develop/DevelopAuto';
import { whiteBalanceFor } from '../../shared/develop/auto-develop';
import { useAutoMemory } from '../../shared/develop/use-auto-memory';
import { useCropSwitches } from './use-crop-switches';
import DevelopHistogram from '../../shared/develop/DevelopHistogram';
import DevelopMixer from '../../shared/develop/DevelopMixer';
import { straightMono } from '../../shared/develop/mixer';
import DevelopGrading from '../../shared/develop/DevelopGrading';
import DevelopSliders from '../../shared/develop/DevelopSliders';
import DevelopViewport from '../../shared/develop/DevelopViewport';
import {
  DEFAULT_DEVELOP,
  appliedProfile,
  decodeProfileOf,
  baseRung,
  developBase,
  developLines,
  isDefaultDevelop,
  isRawDevelop,
  profilePending,
  signed,
  type DevelopSettings,
} from '../../shared/develop/develop';
import { cloneBaseCurve, needsMeasuring, openingBaseCurve } from '../../shared/develop/base-curve';
import { measureBaseCurve } from '../../shared/develop/measure-base-curve';
import type { HalfImage } from '../../shared/render/half-image';
import { CHOICE_WORDS, followsRoll, resolveRollChoice, roleOfRow, rollChoiceFor, type ChoiceRole, type RollChoice } from '../../shared/develop/roll-choice';
import {
  calibrationAt,
  readRawCalibration,
  rungsFor,
  type RawCalibration,
} from '../../shared/raw/calibration';
import { pasteDevelop } from '../../shared/develop/develop-clipboard';
import type { DevelopApplyVerb } from '../../shared/develop/develop-host';
import { pictureFidelity } from '../../shared/develop/picture-fidelity';
import { renderPrecisionHere } from '../../shared/render/graph-grader';
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
import { editorKeyAction, sameDevelop, type WorkbenchTab } from '../../shared/develop/roll-editor';
import { framedThumbnail } from '../../shared/develop/roll-thumb';
import { isClipPicture, pictureLabel, type RollGrade, type RollPicture } from '../../shared/develop/roll-types';
import DevelopTransport from '../../shared/develop/DevelopTransport';
import { canStageDraw } from '../../shared/projects/media-rendition';
import { fetchHeld } from '../../shared/sources/held-fetch';
import { useDevelopDraft, useTold } from '../../shared/develop/use-develop-draft';
import { useWriteThrough } from '../../shared/develop/use-write-through';
import { useDevelopPicture, type DevelopFrame, type DevelopPicture } from '../../shared/develop/use-develop-picture';
import { useStageDeck } from '../../shared/develop/use-stage-deck';
import type { DeckNeighbour } from '../../shared/develop/stage-deck';
import { DECK_GAP } from '../../shared/ui/use-media-viewer';
import { isDefaultKeystone, sameKeystone, type Keystone } from '../../shared/render/geometry';
import { UPRIGHT_SAMPLE_EDGE, describeUpright, measureUpright, uprightKeystone } from '../../shared/develop/auto-keystone';
import { LEVEL_SAMPLE_EDGE, describeTilt, levelFine, lumaOf, measureTilt } from '../../shared/develop/auto-level';
import { DEFAULT_AUTO_PLAN, autoPlanPref } from '../../shared/develop/auto-plan';
import { runAutoVerb } from '../../shared/develop/DevelopAuto';
import { firstOpen, useAutoAll, type AutoAllStep } from '../../shared/develop/use-auto-all';
import { WRITE_DELAY_MS } from '../../shared/develop/use-write-through';
import { useLocalPref } from '../../shared/ui/local-pref';
import { isEdited, type JournalVia } from '../../shared/develop/roll-types';
import { sameLens, type LensCorrection } from '../../shared/render/lens';
import {
  DEFAULT_BRUSH_HARDNESS,
  DEFAULT_BRUSH_RADIUS,
  MAX_COLOUR_SAMPLES,
  MAX_STROKES,
  SUBJECT_HIT_RADIUS,
  defaultMask,
  dropSubjectPin,
  subjectPins,
  tapSubject,
  type BrushStroke,
  type Mask,
  type MaskKind,
  type ShadeMask,
  type SubjectPin,
} from '../../shared/render/mask';
import { centreAxis, placedCentre } from '../../shared/shades/shade-shape';
import { useSubjectMasks } from '../../shared/develop/use-subject-masks';
import { prefersReducedMotion } from '../../shared/ui/reduced-motion';
import { PRESS_LOOK, fingerSize } from '../../shared/ui/press';
import { useCoarsePointer } from '../../shared/ui/use-coarse-pointer';
import { useVerb } from '../../shared/ui/use-verb';
import VerbWord, { useVerbWord } from '../../shared/ui/VerbWord';
import type { VerbOutcome, VerbReturn } from '../../shared/ui/verb';
import { MASK_VIEW_LABELS, nextMaskView, shownMaskView, type MaskView } from './mask-view';
import type { BrushRaster } from '../../shared/render/brush-raster';
import type { MaskFlash } from '../../shared/develop/layer-render';

type SubjectRasters = ReadonlyMap<string, BrushRaster>;
const EMPTY_RASTERS: SubjectRasters = new Map();
/** One beat of the blink: on, off, on, off — about a third of a second. */
const FLASH_STEP_MS = 90;

/** What a tap on a subject does — the switch over the picture and in the panel. */
const SUBJECT_TONES: readonly { id: 'add' | 'remove'; label: string }[] = [
  { id: 'add', label: '+ Add' },
  { id: 'remove', label: '− Remove' },
];

/**
 * How near a tap must land to count as a tap ON an existing point rather than
 * beside it, in [0,1] frame coordinates. Generous, because the markers are
 * small and un-picking by accident is cheaper to undo than failing to un-pick.
 */

import {
  addLayer,
  componentMask,
  createLayer,
  drawingLayers,
  withComponentMask,
  duplicateLayer,
  moveLayer,
  moveLayerTo,
  newLayerId,
  patchLayer,
  removeLayer,
  sameLayers,
  type AdjustLayer,
  subjectLayersToSegment,
} from '../../shared/develop/layer';
import { usePresetBookHost } from '../../shared/develop/use-preset-book';
import type { LutStack } from '../../shared/lut/use-lut-stack';
import { DEFAULT_FRAMING, isDefaultFraming, sameFraming, type Framing } from '../../shared/media/framing';
import { describeKeyTarget, targetOwnsSpace, targetOwnsTyping, targetTakesText } from '../../shared/media/transport-keys';
import PanelHost from '../../shared/ui/PanelHost';
import Segmented from '../../shared/ui/Segmented';
import Button from '../../shared/ui/Button';
import IconButton from '../../shared/ui/IconButton';
import { Icons } from '../../shared/ui/icons';
import type { OverflowItem } from '../../shared/ui/OverflowMenu';
import StageZoomControl from '../../shared/ui/StageZoomControl';
import { usePixelView } from '../../shared/ui/use-pixel-view';
import { useLocalFlag } from '../../shared/ui/use-local-flag';
import DevelopShortcuts from '../../shared/develop/DevelopShortcuts';
import { STAGE_ZOOM_STEP, zoomLabel, type ZoomControls } from '../../shared/ui/stage-zoom';
import type { RollExport } from '../../shared/develop/roll-types';
import CropPanel, { type CropApplyVerb } from './CropPanel';
import { FieldRow, FoldHints } from '../../shared/ui/Inspector';
import { exposureSummary } from '../../shared/exif/exif-summary';
import { useDeliveryIdentity } from '../../shared/develop/use-preset-book';
import TimelapseSheet, { makingOfLine } from './TimelapseSheet';
import { usePictureChapters } from './use-picture-chapters';
import { useTimelapseExport } from './use-timelapse-export';
import { useAvcEncodeSupport } from '../../shared/media/use-encode-support';
import { rollCubes } from './roll-cubes';
import { useLutInterpolation } from '../../shared/lut/use-lut-interpolation';
import KeystonePanel from './KeystonePanel';
import LensPanel from './LensPanel';
import { lensKey, profileInEffect, type LensProfileApplied } from '../../shared/lens/lens-profile';
import { lookUpLens, profileFor, setLensfunAllowed, useLensfunAllowed, type LookUp, type ShotLens } from '../../shared/lens/lensfun-store';
import DetailPanel, { PresencePanel } from './DetailPanel';
import VignettePanel from './VignettePanel';
import WhiteBalancePanel from './WhiteBalancePanel';
import { dropDecodedRaws } from '../../shared/raw/raw-decoder';
import type { RawWhite } from '../../shared/raw/white-balance';
import { PROFILE_PENDING, type RawProfile } from '../../shared/raw/dng-color';
import { describePostVignette, samePostVignette, type PostCropVignette } from '../../shared/render/post-vignette';
import RepairPanel, { DEFAULT_DUST, type DustState, type RepairTool } from './RepairPanel';
import { describeDetail, isDefaultDetail, sameDetail, type DetailImage, type DetailSettings } from '../../shared/render/detail';
import { autoDetail, describeAutoDetail, withAutoDetail, type DetailFacts } from '../../shared/develop/auto-detail';
import { isWorkingPreview } from '../../shared/develop/working-preview';
import { useValueSwitch } from './use-value-switch';
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
import { takesPointer } from './kind-palette';
import { useLayerThumbs } from './use-layer-thumbs';
import LayerDetail, { type LayerTab } from './LayerDetail';
import type { PaletteKind } from './kind-palette';
import MaskPanel from './MaskPanel';
import type { BorderApplyVerb } from './BorderSection';
import { borderLayout, type RollBorder } from '../../shared/develop/border-layout';
import { zoneFromView } from '../../shared/develop/crop-rect';
import { visibleWindow } from '../../shared/ui/pan-zoom';
import ExportPanel, { type ExportVerb } from './ExportPanel';
import HdrPreviewSheet from './HdrPreviewSheet';
import { previewUltraHdr, type HdrPreview } from '../../shared/hdr/hdr-preview';
import DeliverBar from '../../shared/ui/DeliverBar';
import { runClock } from '../../shared/ui/RunLockNotice';
import CropStage from './CropStage';
import { useCropZone } from './use-crop-zone';
import { useSubjectCrop } from './use-subject-crop';
import { CROP_VIEW_FIT, CROP_VIEW_MAX } from './crop-view';
import type { RollExports } from './use-roll-export';

/** A shade mask with its centre moved under `point`, or unchanged where it has none to move. */
function withShadeCentre(m: ShadeMask, point: readonly [number, number]): ShadeMask {
  const center = placedCentre(m, { x: point[0], y: point[1] });
  return center ? { ...m, center } : m;
}

/** How long the picture rests before its filmstrip cell is redrawn. */
const SNAPSHOT_DELAY_MS = 700;

/**
 * Which grid column of the host the stage and the inspector take — the band
 * under the picture leaves the stage first, a band standing at the LEFT
 * pushes it to the second (`StripPrefs.place`); the inspector keeps the last.
 */
const COLUMN_CLASS = { 1: 'col-start-1', 2: 'col-start-2', 3: 'col-start-3' } as const;
const STAGE_COLUMNS = { stage: 1, panel: 2 } as const;

const NO_FILES: readonly File[] = [];
const NO_LAYERS: readonly AdjustLayer[] = [];
const NO_PATCHES: readonly Patch[] = [];

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
  tabs,
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
  onLensProfile,
  onDetail,
  onVignette,
  onRepair,
  onLayers,
  onAspect,
  onRendition,
  rollChoice = null,
  onRollChoice,
  rollPhotos = 0,
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
  onWords,
  onSettings,
  clipboard,
  onCopy,
  onPaste,
  onVariant,
  onLook,
  timelapseOpen = false,
  onTimelapseOpen,
  onMakingOf,
  selecting = false,
  onSelectMode,
  onSelectAll,
  onEscape,
  onBand,
  onSheet,
  onThumbs,
  focused = false,
  onFocusMode,
  neighbours = null,
  still = null,
  columns = STAGE_COLUMNS,
  emptyText = 'This picture is not in the Library — open its folder, or take it from its day on your Winnow. Its numbers can still be set.',
}: {
  picture: RollPicture;
  /** Its bytes — the Library's or the roll's own — or null while they are not in hand. */
  file: File | null;
  /** Which file of the capture the picture is developed from (`RollPicture.rendition`); null for where it opens. */
  onRendition: (rendition: string | null) => void;
  /**
   * Which file the ROLL opens a picture on when the picture has no choice of
   * its own (`RollDoc.opensOn`, `roll-choice.ts`); null for where it opens.
   */
  rollChoice?: RollChoice | null;
  /** Set the roll's choice — from the foot of the name menu, or the line a pick offers. */
  onRollChoice?: (choice: RollChoice | null) => void;
  /** How many photographs the roll holds: a roll of one has no "every other picture". */
  rollPhotos?: number;
  /** The capture's other files a folder listed beside `file` (`AssetParts.siblings`) — a local picture's only. */
  siblings?: readonly File[];
  /** THIS picture's look (roll v5) — the stack follows the open picture; the draft rides it. */
  stack: LutStack;
  compact: boolean;
  sheetOpen: boolean;
  onSheetOpen: (open: boolean) => void;
  /** Which inspector tab is open — lifted to the editor so it survives stepping to another picture. */
  tab: WorkbenchTab;
  /** The tabs THIS picture has (`workbenchTabsFor`): every one for a photograph, Adjust, Crop and Export for a clip. */
  tabs: readonly { id: WorkbenchTab; label: string }[];
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
  onDevelop: (develop: DevelopSettings | null, via?: JournalVia) => void;
  onFraming: (framing: Framing | null, via?: JournalVia) => void;
  onKeystone: (keystone: Keystone | null, via?: JournalVia) => void;
  onLens: (lens: LensCorrection | null) => void;
  /** The lens's measured profile put on the picture, or taken off (`null`). */
  onLensProfile: (profile: LensProfileApplied | null) => void;
  onDetail: (detail: DetailSettings | null, via?: JournalVia) => void;
  onVignette: (vignette: PostCropVignette | null) => void;
  onRepair: (repair: Patch[]) => void;
  onLayers: (layers: AdjustLayer[]) => void;
  onAspect: (aspect: string, via?: JournalVia) => void;
  /** The roll's delivery settings, edited on the Export tab. */
  exportSettings: RollExport;
  onExportSettings: (patch: Partial<RollExport>) => void;
  /** *Proxies only, for this run* — the editor's, never the roll's. */
  proxiesOnly: boolean;
  onProxiesOnly: (on: boolean) => void;
  /** The roll's still export — its state and what the open picture delivers. */
  exports: RollExports;
  exportVerbs: readonly ExportVerb[];
  /** The open picture's cell, retaken as delivered — its bytes and its aspect (`roll-thumb.ts`). */
  onSnapshot: (thumb: Blob, aspect: number) => void;
  onStep: (step: number) => void;
  /**
   * The two pictures beside this one as the arrows would step — the roll as
   * a DECK under the stage (`stage-deck.ts`): with A/B off, a drag at the
   * fit reveals one and a release pages to it through `onStep`. Null draws
   * no deck (a roll of one, a host without a roll).
   */
  neighbours?: { previous: DeckNeighbour | null; next: DeckNeighbour | null } | null;
  /** This picture's own cell, drawn under the stage until it has decoded (`DevelopViewport`'s `still`). */
  still?: string | null;
  /**
   * The delivery keys (`P` send ↔ hold, `U` back to the rule, `M` ignore ↔
   * un-ignore): the editor answers from the roll as it stands, since the
   * state depends on whether the picture is edited.
   */
  onDeliver: (action: DeliverAction) => void;
  /** The Export tab's Pictures table — built by the editor, which holds the roll. */
  deliveryTable?: ReactNode;
  /** The picture's title and caption, written into its delivered file (M2). */
  onWords: (words: { title?: string; caption?: string }) => void;
  /** Open the sections sheet — the deliberate copy, apply to others, reset (`picture-sections.ts`). */
  onSettings: () => void;
  /** The copy and paste glyphs' state and the paste's ▾ — the editor's, which holds the roll. */
  clipboard: Omit<DevelopClipVerbs, 'onCopy' | 'onPaste'>;
  /** ⌘C: hold this picture as it stands — `develop` is the draft, a beat ahead of the roll. Says how it went. */
  onCopy: (develop: DevelopSettings) => VerbReturn;
  /** ⌘V: paste what is held onto the selection or this picture, and say how it went. Null when no picture is held. */
  onPaste: () => VerbOutcome | null;
  /** Make a variant of this picture as it stands (item 30); ⌘'. */
  onVariant?: () => void;
  /** Dress this picture in a look — a preset's (`DevelopPreset.look`). */
  onLook: (look: RollGrade) => void;
  /** The making-of sheet (`TimelapseSheet`) — opened by the editor, drawn here over the picture's bytes. */
  timelapseOpen?: boolean;
  onTimelapseOpen?: (open: boolean) => void;
  /** The picture's own making-of edits — a chapter hidden, a caption rewritten. */
  onMakingOf?: (change: { hidden?: string[]; captions?: Record<string, string> }) => void;
  /** The band's selection is on (`RollEditor`): ⌘A takes every shown picture, P / U / M act on the marked ones. */
  selecting?: boolean;
  /** `S` — the band's selection on ↔ off. */
  onSelectMode?: () => void;
  /** ⌘A while the selection is on. */
  onSelectAll?: () => void;
  /** Escape with nothing of the stage's to let go: the host's turn (the selection, the sheet, the focus). True when it took it. */
  onEscape?: () => boolean;
  /** `B` — the band folded to its rail ↔ back to its size. */
  onBand?: () => void;
  /** `G` — the contact sheet over the stage ↔ closed. */
  onSheet?: () => void;
  /** The picture alone (`F`): the inspector is not drawn and the ⤢ verb says so. */
  focused?: boolean;
  /** `F`, and the ⤢ verb — focus on ↔ off. */
  onFocusMode?: () => void;
  /**
   * Which grid columns the stage and the inspector take in the host's grid:
   * the first and the second by default; one further right each when the
   * roll's band stands in a column at the left (`RollEditor`).
   */
  columns?: { stage: 1 | 2; panel: 2 | 3 };
  /** `-` / `=` — the band's thumbnails one step smaller or larger. */
  onThumbs?: (direction: 1 | -1) => void;
  /** What the stage says while the picture's bytes are not in hand. */
  emptyText?: string;
}) {
  const presets = usePresetBookHost();
  const draft = useDevelopDraft(entry.develop, stack);
  const [told, tell] = useTold();
  // The Auto row's switches remember their clicks per picture, for the session.
  const auto = useAutoMemory({ pictureKey: entry.id, develop: draft.draft, onPatch: draft.patch, onTold: tell });
  // A CLIP (2026-09-30): played on the stage and developed WHOLE — the global
  // develop and the look, which the export grades every frame through, and
  // (2026-10-01) ONE crop held still over every frame, the same `frame` the
  // stage draws a photograph through. The border, the warps, detail, repair
  // and the layers are a photograph's (`roll-types.ts`, `isClipPicture`):
  // their tabs are not drawn, their keys do nothing, and the stage is handed
  // none of them, so what it shows is what the file will get. Constant for
  // this mount: the workbench is keyed per picture.
  const clip = isClipPicture(entry);
  // Read once, like the develop: the workbench is keyed per picture.
  const [framingDraft, setFramingDraft] = useState<Framing>(entry.framing ?? { ...DEFAULT_FRAMING });
  // The aspect rides a draft too: a FREE crop's aspect moves with every
  // pointer move of a handle, and written to the roll at once it rewrote the
  // whole document per move (the audit of 2026-09-22). Written through at
  // rest with the framing, like every other draft here.
  const [aspectDraft, setAspectDraft] = useState<string>(entry.aspect);
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
  const [vignetteDraft, setVignetteDraft] = useState<PostCropVignette | null>(entry.vignette ?? null);
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
  // The camera's white from the last RAW decode — what a Kelvin white balance is read against.
  const [rawWhite, setRawWhite] = useState<RawWhite | null>(null);
  const [stageWidth, setStageWidth] = useState(0);
  // The stack is a draft like the rest, so a slider drag is one write-through
  // rather than one document write per step.
  const [layersDraft, setLayersDraft] = useState<AdjustLayer[]>(entry.layers ?? []);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  // HOW the open layer's mask is shown — Hidden, Outline, Fill, on the bar's
  // glyph and on `M` (`mask-view.ts`). Hidden by default, and while Pick or
  // Paint makes the mask its OUTLINE shows by itself — the maintainer's pick
  // (2026-09-23): a line says where the edge is without hiding the colour
  // being set under it. Outline or Fill keep it shown, which the "keep it
  // shown" checkbox used to.
  const [maskView, setMaskView] = useState<MaskView>('off');
  // One point's region, on and off twice after the model answers a tap.
  const [flashMask, setFlashMask] = useState<MaskFlash | null>(null);
  const [pixelView, setPixelView] = usePixelView();
  // What the picture SAYS about itself, and where. Off by default — the
  // maintainer does not want the numbers in front of him while he works, and
  // when he does they belong over the photograph, not under it.
  const [factsOn, setFactsOn] = useLocalFlag('atelier.develop.facts', false);
  // The clipping view (J, or the histogram's end words). Never remembered
  // past the session: a red wash met on the next visit would be taken for
  // the picture — the rule the mask's own wash follows.
  const [clipping, setClipping] = useState(false);
  // The sharpen's Masking weight painted on the stage — only while the
  // Detail tab is where the author is: a white-and-black picture met on
  // another tab would read as a broken render.
  const [sharpenMaskView, setSharpenMaskView] = useState(false);
  // The before/after split, as a switch. On by default — it is what the editor
  // has always done — but a divider is a second thing on the picture, and the
  // hours spent on a mask are exactly the hours it is in the way.
  const [compareOn, setCompareOn] = useLocalFlag('atelier.develop.compare', true);
  const [helpOpen, setHelpOpen] = useState(false);
  const [hdrPreviewOpen, setHdrPreviewOpen] = useState(false);
  // The subject rasters come BACK through state, because the two hooks need
  // each other: the stage decodes the picture the model segments, and the model
  // produces the map the stage draws. One extra commit per answer, which is
  // once per tap rather than once per frame.
  const [subjectRasters, setSubjectRasters] = useState<SubjectRasters>(EMPTY_RASTERS);
  const [painting, setPainting] = useState(false);
  // What a tap on a subject does: ADD a region, or take one back OUT
  // (2026-10-02, his *«passer en soustraction»*). ⌥ held at the press flips
  // it for that one tap, as Lightroom and Photoshop do; the switch is the
  // touch screen's way and the one the panel shows. Back to Add whenever
  // another layer opens — a removal mode met by surprise is a lost subject.
  const [subjectTone, setSubjectTone] = useState<'add' | 'remove'>('add');
  const subjectToneRef = useRef(subjectTone);
  subjectToneRef.current = subjectTone;
  useEffect(() => setSubjectTone('add'), [selectedLayerId]);
  const selectedLayer = layersDraft.find((l) => l.id === selectedLayerId) ?? null;
  const drawingCount = drawingLayers(layersDraft).length;

  // --- painting ------------------------------------------------------------
  // The live stroke rides a REF and the draft alike: the ref is what the next
  // point is appended to, because a state read inside a pointermove closure is
  // one frame behind and would drop points (the same trap the curve editor's
  // drag wore). Each move rewrites the LAST stroke rather than adding one.
  const strokeRef = useRef<BrushStroke | null>(null);
  // WHICH of the open layer's masks the stage's gestures act on: null is its
  // own, 0.. its combined parts (item 16). Back to its own whenever another
  // layer opens, and whenever the part it pointed at is gone.
  const [selectedPart, setSelectedPart] = useState<number | null>(null);
  useEffect(() => setSelectedPart(null), [selectedLayerId]);
  const partIndex = selectedPart !== null && selectedLayer?.parts?.[selectedPart] ? selectedPart : null;
  // Which half of the open layer is shown — WHERE it applies or WHAT it
  // changes (`LayerDetail.tsx`) —, kept across layers like any tab.
  const [layerTab, setLayerTab] = useState<LayerTab>('mask');
  /** A layer's kind changed — from its row's ⋯ or its head's chip: the shape starts fresh, a pointer kind turns the pointer on. */
  const changeLayerKind = (id: string, kind: PaletteKind) => {
    setLayersDraft((list) => patchLayer(list, id, { mask: kind === 'whole' ? null : defaultMask(kind) }));
    setSelectedLayerId(id);
    setSelectedPart(null);
    setLayerTab('mask');
    setPainting(takesPointer(kind));
  };
  const activeMask = selectedLayer ? componentMask(selectedLayer, partIndex) : null;
  const paintKind = painting ? activeMask?.kind : undefined;
  // A shade takes the pointer only while it has a centre to place — a band or
  // a radial. An edge or a corner is its own position.
  const placingShade = paintKind === 'shade' && activeMask?.kind === 'shade' && centreAxis(activeMask.direction) !== null;
  const paintId =
    paintKind === 'brush' || paintKind === 'subject' || paintKind === 'colour' || placingShade
      ? (selectedLayer?.id ?? null)
      : null;
  // What the stage draws of the open layer's mask: the view chosen, else its
  // outline by itself while the pointer makes it.
  const shownMask = shownMaskView(maskView, paintId !== null);
  const brushRef = useRef(brush);
  brushRef.current = brush;
  // The picture's own sampler, read at the tap: the hook is made further down.
  const sampleColourRef = useRef<((point: readonly [number, number], layerId: string) => [number, number, number] | null) | null>(null);
  const layerPaint = useMemo(() => {
    if (!paintId) return null;
    // Every write goes to the ONE mask open in the panel, through the pure
    // helpers, so a painted part and the layer's own brush cannot be confused.
    const edit = (fn: (m: Mask | null) => Mask | null) =>
      setLayersDraft((list) =>
        list.map((l) => {
          if (l.id !== paintId) return l;
          const next = fn(componentMask(l, partIndex));
          return next ? withComponentMask(l, partIndex, next) : l;
        }),
      );
    return {
      onStart: (point: [number, number], mods?: { alt: boolean }) => {
        if (paintKind === 'subject') {
          // A tap ADDS a region or takes one OUT (`tapSubject`), ⌥ flipping
          // the mode for this tap; a tap on a pin takes that pin off — the
          // click-a-marker-to-unpick gesture.
          const mode = subjectToneRef.current;
          const tone = mods?.alt ? (mode === 'add' ? 'remove' : 'add') : mode;
          edit((m) => (m?.kind === 'subject' ? tapSubject(m, point, tone) : null));
          return;
        }
        if (paintKind === 'colour') {
          // The same gesture for a colour range: a tap SAMPLES the colour
          // there — as this layer sees it — and a tap on a marker removes it.
          const rgb = sampleColourRef.current?.(point, paintId) ?? null;
          edit((m) => {
            if (m?.kind !== 'colour') return null;
            const hit = m.samples.findIndex((c) => Math.hypot(c.x - point[0], c.y - point[1]) < SUBJECT_HIT_RADIUS);
            if (hit >= 0) return { ...m, samples: m.samples.filter((_, i) => i !== hit) };
            if (!rgb || m.samples.length >= MAX_COLOUR_SAMPLES) return null;
            return { ...m, samples: [...m.samples, { x: point[0], y: point[1], r: rgb[0], g: rgb[1], b: rgb[2] }] };
          });
          return;
        }
        if (paintKind === 'shade') {
          // Trips' "Place on the picture": a press puts the centre under it,
          // on the axis the shape moves along.
          edit((m) => (m?.kind === 'shade' ? withShadeCentre(m, point) : null));
          return;
        }
        const made: BrushStroke = { points: [point], ...brushRef.current };
        strokeRef.current = made;
        edit((m) => (m?.kind === 'brush' && m.strokes.length < MAX_STROKES ? { kind: 'brush', strokes: [...m.strokes, made] } : null));
      },
      onMove: (point: [number, number]) => {
        // A shade's centre follows the drag, as it does in Trips.
        if (paintKind === 'shade') {
          edit((m) => (m?.kind === 'shade' ? withShadeCentre(m, point) : null));
          return;
        }
        // A subject and a colour are TAPPED, never dragged.
        if (paintKind !== 'brush') return;
        const live = strokeRef.current;
        if (!live) return;
        const last = live.points[live.points.length - 1];
        // Points closer than this add nothing the radius does not already
        // cover, and every one of them is rasterised again.
        const step = Math.max(0.004, live.radius * 0.12);
        if (Math.hypot(point[0] - last[0], point[1] - last[1]) < step) return;
        const grown: BrushStroke = { ...live, points: [...live.points, point] };
        strokeRef.current = grown;
        edit((m) => {
          if (m?.kind !== 'brush' || m.strokes.length === 0) return null;
          const strokes = [...m.strokes];
          strokes[strokes.length - 1] = grown;
          return { kind: 'brush', strokes };
        });
      },
      onEnd: () => {
        strokeRef.current = null;
      },
      gesture: paintKind === 'brush' || paintKind === 'shade' ? ('drag' as const) : ('tap' as const),
    };
  }, [paintId, paintKind, partIndex]);
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
  // The roll's choice (`roll-choice.ts`) for a picture with none of its own,
  // read from the STORED picture: a draft not yet written changes nothing.
  // Let go for this visit when its file cannot be had (a cancel, a failure).
  const handed = rollChoiceFor(rollChoice, entry).choice;
  const [rollOff, setRollOff] = useState(false);
  // On the roll's sensor the base is the ROLL's, never written, until the
  // picture is given numbers — numbers bind their material, so the first
  // write carries the base with them. Its gain is metered by the stage's own
  // decode and held for this visit, which is how the export meters it too.
  const followsSensor = handed === 'sensor' && sensor !== null && !rollOff && !clip;
  const [followGain, setFollowGain] = useState<number | null>(null);
  // The camera profile (`dng-color.ts`) resolved on the same decode as the
  // gain, held with it while following and written with the first numbers.
  const [followProfile, setFollowProfile] = useState<RawProfile | null>(null);
  // The document already on a RAW base the draft has not been re-seeded
  // with yet — the render between the first write and its echo, or an undo
  // landing — is drawn on that base, never on the render for one frame.
  const stored = entry.develop;
  const settling = isRawDevelop(stored) && !isRawDevelop(draft.draft);
  const developNow = useMemo<DevelopSettings>(() => {
    if (isRawDevelop(draft.draft)) return draft.draft;
    if (settling && stored) return { ...draft.draft, base: stored.base, rawGain: stored.rawGain, rawProfile: stored.rawProfile ?? null, baseCurve: stored.baseCurve ?? null };
    // On the roll's sensor the picture opens on the opening curve, as the
    // export does (`openingBaseCurve`), until it is given its own.
    return followsSensor
      ? {
          ...draft.draft,
          base: 'gain',
          rawGain: followGain,
          // Resolved by the stage's first decode (C4), held for the visit.
          rawProfile: followProfile ?? PROFILE_PENDING,
          baseCurve: openingBaseCurve(draft.draft.baseCurve),
        }
      : draft.draft;
  }, [followsSensor, settling, stored, draft.draft, followGain, followProfile]);
  const inherited = developNow !== draft.draft;
  // On the roll's sensor and not yet on its own: what a cancel, a failed fetch
  // or the stage's meter answers for the visit rather than for the document.
  const following = inherited && !settling;
  const followingRef = useRef(following);
  followingRef.current = following;
  const inheritedRef = useRef<Pick<DevelopSettings, 'base' | 'rawGain' | 'rawProfile' | 'baseCurve'> | null>(null);
  inheritedRef.current = inherited
    ? { base: developNow.base, rawGain: developNow.rawGain, rawProfile: developNow.rawProfile ?? null, baseCurve: developNow.baseCurve ?? null }
    : null;
  // The stack grades what the picture is developed WITH: after the draft's
  // own effect, so the roll's base reaches the cube in the same commit.
  const { setDevelop: setStackDevelop } = stack;
  useEffect(() => {
    setStackDevelop(developNow);
  }, [developNow, setStackDevelop]);
  const wantsRaw = baseRung(developNow.base) > 0 && sensor !== null;
  const [rawFile, setRawFile] = useState<File | null>(null);
  // Developed from the sensor's own data right now — where a measured lens
  // profile applies by itself (`lens-profile.ts`).
  const onSensor = wantsRaw && Boolean(rawFile);
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
        if (followingRef.current) setRollOff(true);
        else patchDraft({ base: null, rawGain: null, rawProfile: null });
      });
    return () => {
      alive = false;
    };
  }, [wantsRaw, rawFile, sensorHeld, sensorName, tell, patchDraft]);
  const rawGain = developNow.rawGain ?? null;
  // The camera profile every decode of this picture folds in (C4): stored,
  // `'resolve'` while pending, or none — LibRaw's colour.
  const decodeProfile = decodeProfileOf(developNow);
  const decodeProfileKey = decodeProfile ? JSON.stringify(decodeProfile) : '';
  // The stage's last decode of the sensor — what an Auto base curve is measured on.
  const [sensorDecode, setSensorDecode] = useState<{ file: File; half: HalfImage; gain: number } | null>(null);
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
  const rung = rungs.includes(developBase(developNow)) ? developBase(developNow) : rungs[rungs.length - 1];
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
        // What this stage can draw: a picture the browser decodes, or a CLIP
        // — the rush behind a proxy is a row here since 2026-09-30, as on the
        // Studio's stage (`media-rendition.ts`).
        canDraw: canStageDraw,
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
  // The roll's camera file for a picture with none of its own: where it beats
  // the proxy, and nothing before its size is measured (`resolveRollChoice`).
  const rollAnswer = handed === 'delivered' && !rollOff ? resolveRollChoice(rows, 'delivered') : null;
  const chosen = renditionById(rows, entry.rendition) ?? rollAnswer?.row ?? null;
  const fromRoll = !entry.rendition && Boolean(rollAnswer?.row);
  // Why the roll's choice did not land on this picture, where it follows it.
  const rollReason =
    handed === 'delivered'
      ? rollOff
        ? 'its camera file could not be had — back where it opens for this visit'
        : (rollAnswer?.reason ?? null)
      : handed === 'sensor' && !followsSensor
        ? rollOff
          ? 'its RAW could not be opened — back on the render for this visit'
          : 'no RAW in this capture'
        : rollChoiceFor(rollChoice, entry).reason;
  // B of « C + B »: the file just picked, offered to the whole roll right
  // where it was picked — gone when ignored, never a mode left switched on.
  const [offer, setOffer] = useState<ChoiceRole | null>(null);
  const rollOffer =
    offer && onRollChoice && rollPhotos > 1 && !clip && (offer === 'proxy' ? null : offer) !== rollChoice ? offer : null;
  // The row on screen below the sensor: the stored choice where the capture
  // still offers it, else where the picture opens — never a blocked row.
  const current = (chosen && chosen.role !== 'sensor' && !chosen.blocked ? chosen : opening)?.id ?? null;
  const wanted = !wantsRaw && chosen && chosen.role === 'delivered' && !chosen.blocked && chosen.id !== opening?.id ? chosen : null;
  const wantedId = wanted?.id ?? null;
  // The delivered file for the stage: in hand already (a sibling, a held
  // original), else fetched once and held for the session. Keyed on the id
  // alone, so a list rebuilt around it never restarts a fetch in flight.
  const [deliveredFile, setDeliveredFile] = useState<{ id: string; file: File } | null>(null);
  const deliver = useRef({ wanted, siblings, origin, tell, onRendition, fromRoll });
  deliver.current = { wanted, siblings, origin, tell, onRendition, fromRoll };
  // The fetch under way for a row of THIS picture, so choosing another row —
  // the proxy back, after a gigabyte rush was asked for by mistake — lets go
  // of it. Through `fetchHeld` (2026-09-30) a reader that lets go detaches
  // itself alone: an export that joined the same fetch keeps it.
  const flight = useRef<{ id: string; controller: AbortController } | null>(null);
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
    const controller = new AbortController();
    flight.current = { id: row.id, controller };
    // A task of its own — the pill and the edge say it — and only a failure
    // is said here. ONE flight per asset (`held-fetch.ts`): an export that
    // asks for the same file before it lands joins this one, and the file is
    // held for the session on landing.
    const init = { label: `Fetching ${row.name}`, scope: taskScopeRef.current, bytes: row.bytes };
    const job = row.assetId
      ? fetchHeld(row.assetId, init, fetch, controller.signal)
      : trackedFetch({ ...init, signal: controller.signal }, (opts) => fetch(opts));
    job
      .then((fetched) => {
        if (!alive) return;
        if (row.assetId) holdOriginal(row.assetId, fetched);
        setDeliveredFile({ id: row.id, file: fetched });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        // Let go on purpose (another row chosen): nothing to say, and the
        // choice already moved. Anything else is said and the row cleared.
        if (controller.signal.aborted) return;
        deliver.current.tell(`${row.name} could not be fetched: ${err instanceof Error ? err.message : String(err)}`);
        // The roll's file is let go for this visit; a picture's own choice is cleared.
        if (deliver.current.fromRoll) setRollOff(true);
        else deliver.current.onRendition(null);
      })
      .finally(() => {
        if (flight.current?.controller === controller) flight.current = null;
      });
    return () => {
      alive = false;
    };
  }, [wantedId, file]);
  const shownFile = wanted && deliveredFile?.id === wanted.id ? deliveredFile.file : file;
  // The CLIP's moment across a switch of its file (proxy ↔ rush): the new
  // element opens where the old one was. Read DURING the render that swaps
  // the file — the old element is still the one mounted — and only then, so a
  // scrub never re-decodes (the Studio's own rule, `use-stage-rendition.ts`).
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastShown = useRef<{ file: File | null; start: number }>({ file: null, start: 0 });
  if (lastShown.current.file !== shownFile) {
    lastShown.current = { file: shownFile, start: clip ? (videoRef.current?.currentTime ?? 0) : 0 };
  }
  const clipStart = lastShown.current.start;
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
  // The roll as a deck under the stage (`use-stage-deck.ts`): the travel of
  // one page is the viewport's width, read at gesture time off the element
  // the picture hook below owns — so the deck is made first and told where
  // to measure once the hook has answered.
  const pictureRef = useRef<DevelopPicture | null>(null);
  const deck = useStageDeck({
    neighbours: { previous: Boolean(neighbours?.previous), next: Boolean(neighbours?.next) },
    travel: () => (pictureRef.current?.view.viewportRef.current?.clientWidth ?? 0) + DECK_GAP,
    onStep,
  });
  const picture = useDevelopPicture({
    file: shownFile,
    videoTimeSeconds: clipStart,
    cube: stack.composed,
    frame,
    // A free press at the fit — A/B off, no tool armed — is the deck's.
    swipe: neighbours ? deck.hands : null,
    // A clip is handed the develop and the look alone: every other input is
    // a pass over one still frame, and the export cannot follow it from
    // frame to frame — so the stage must not show it (`isClipPicture`).
    keystone: clip ? null : keystoneDraft,
    lens: clip ? null : lensDraft,
    // The measured profile on the SENSOR by itself; on a camera render only
    // where the author asked — a body's JPEG is often corrected in camera.
    lensProfile: clip ? null : profileInEffect(entry.lensProfile, onSensor),
    layers: clip ? NO_LAYERS : layersDraft,
    subjectMasks: clip ? EMPTY_RASTERS : subjectRasters,
    // A subject is shown to the model in the frame it was tapped in — the
    // picture as the geometry bends it (`segment-view.ts`).
    segmenting: !clip && subjectLayersToSegment(layersDraft).length > 0,
    paint: clip ? null : paint,
    compare: compareOn,
    clipping,
    sharpenMask: !clip && sharpenMaskView && tab === 'detail',
    vignette: clip ? null : vignetteDraft,
    // Only while the layer is open, and then by itself while Pick or Paint is
    // on — the moment the mask is what is being made — else only when pinned:
    // a red wash left on by accident would be mistaken for the picture.
    // On the Layers tab only: a wash left on is never carried onto Adjust.
    showMaskOf: !clip && selectedLayer && tab === 'layers' && shownMask !== 'off' ? selectedLayer.id : null,
    maskStyle: shownMask === 'fill' ? 'fill' : 'outline',
    flashMask: clip ? null : flashMask,
    raw: wantsRaw && rawFile ? { file: rawFile, gain: rawGain, profile: decodeProfile } : null,
    detail: clip ? null : detailDraft,
    repair: clip ? NO_PATCHES : repairDraft,
    // The dust map, when the scan shows it: drawn through the stage's own
    // crop so a proposed ring lands on the mark it names.
    veil: clip ? null : veil,
    // The roll's texture, drawn by the node after everything: the stage is
    // where grain is DIALLED and the loupe is where it is judged, since a
    // cell finer than the stage can resolve fades out rather than aliasing.
    film: stack.film,
    pixelScale: stageWidth && fullWidth ? Math.min(1, stageWidth / fullWidth) : 1,
    // The loupe decodes a FILE whole; a clip has no whole to decode.
    loupe: !clip,
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
      if (following) setRollOff(true);
      else patchDraft({ base: null, rawGain: null, rawWb: null, rawProfile: null });
      tell('Opening the RAW was cancelled — back on the render');
    },
    onRawDecoded: (info) => {
      setRawSize({ w: info.sourceWidth, h: info.sourceHeight });
      setRawWhite(info.meta.white);
      // Held for an Auto base curve, measured on this very decode (below).
      setSensorDecode({ file: info.file, half: info.half, gain: info.gain });
      if (rawGain === null) {
        // On the roll's sensor the gain is held for the visit and written
        // only with the picture's first numbers (`inheritedRef`).
        if (following) {
          setFollowGain(info.gain);
          setFollowProfile(info.profile);
        } else {
          // A picture put on its sensor since the profile existed carries
          // `'pending'` and is resolved here with the gain; one on its
          // sensor before keeps LibRaw's colour (his Q1, `camera-profiles.md`).
          const pending = profilePending(draft.draft);
          patchDraft({
            base: developBase(draft.draft) === 'proxy' ? 'gain' : draft.draft.base,
            rawGain: info.gain,
            ...(pending ? { rawProfile: info.profile } : {}),
          });
        }
        const ev = Math.log2(info.gain);
        tell(`RAW · ${info.width}×${info.height}${info.halved ? ' (half size)' : ''} · metered ${ev ? `${signed(ev, 1)} EV` : 'at its white'}`);
      } else if (!following && info.profile && profilePending(draft.draft)) {
        // Pending beside a gain already stored: resolved all the same, so the
        // picture stops asking every decode to work it out again.
        patchDraft({ rawProfile: info.profile });
      }
    },
  });
  sampleColourRef.current = picture.sampleColour;
  // An Auto base curve with no measurement yet — newly on the sensor, picked
  // in the menu, or carried here by a preset or a paste — is MEASURED once,
  // on the stage's own decode of this file against the render it carries,
  // and stored like the gain (preview = export). Never re-measured: points
  // once stored stay. A render too poor to measure falls back to Standard,
  // stored, and the reason is said.
  const curveToMeasure = wantsRaw && rawFile && sensorDecode?.file === rawFile && needsMeasuring(developNow.baseCurve);
  const measuringFor = useRef<File | null>(null);
  useEffect(() => {
    if (!curveToMeasure || !sensorDecode || measuringFor.current === sensorDecode.file) return;
    const { file: measured, half, gain } = sensorDecode;
    measuringFor.current = measured;
    let alive = true;
    void measureBaseCurve(measured, half, rawGain ?? gain).then((fit) => {
      if (!alive) return;
      measuringFor.current = null;
      if (fit.ok) {
        patchDraft({ baseCurve: { kind: 'auto', points: fit.points, error: fit.error } });
        tell(`Auto curve · measured on this file’s render · ${fit.error.toFixed(1)} code${fit.error === 1 ? '' : 's'} off`);
      } else {
        patchDraft({ baseCurve: { kind: 'standard' } });
        tell(`No Auto curve: ${fit.reason} — Standard instead`);
      }
    });
    return () => {
      alive = false;
      measuringFor.current = null;
    };
  }, [curveToMeasure, sensorDecode, rawGain, patchDraft, tell]);
  videoRef.current = picture.video;
  // Space plays and pauses the CLIP — the sheet's rule (`DevelopSheet.tsx`),
  // here on the tool's own window: a control the keyboard is on keeps its
  // press (`targetOwnsSpace`), a press somebody else already answered is left
  // alone, and on a photograph the key means nothing.
  useEffect(() => {
    if (!clip) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.defaultPrevented) return;
      if (targetOwnsSpace(describeKeyTarget(e.target))) return;
      if (document.querySelector('[role="alertdialog"], [role="dialog"]')) return;
      e.preventDefault();
      const v = videoRef.current;
      if (e.repeat || !v) return;
      if (v.paused) void v.play().catch(() => {});
      else v.pause();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clip]);
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
  const fidelity = pictureFidelity(shownFile, developNow.base, fidelityPixels, renderPrecisionHere());
  const subject = useSubjectMasks({
    layers: layersDraft,
    // `BadgeSource.image` is typed as `CanvasImageSource`, which admits an
    // SVGImageElement nothing here ever produces and no GPU can upload —
    // narrowed rather than widening the model's own contract.
    // The picture as its GEOMETRY bends it, never the raw source: a tap lands
    // in the warped frame and the layer pass samples the mask there, so the
    // model must see that frame too (his report, 2026-09-24 — a lens
    // correction bent the subject away from what it had picked). Named by its
    // frame, so a mask is never served on a view it was not segmented on.
    view: picture.segmentView,
    // Per PICTURE: one picture's subject must never be shown on another.
    pictureKey: entry.id,
  });
  const { rasters: resolvedSubjects, fresh: freshSubject } = subject;
  useEffect(() => setSubjectRasters(resolvedSubjects), [resolvedSubjects]);
  // The list's thumbnails of each layer's REAL mask, a moment after the stack moves.
  const layerThumbs = useLayerThumbs(layersDraft, picture, resolvedSubjects, selectedLayerId);
  // The region a tap just changed BLINKS twice (on, off, on, off, 90 ms
  // each), like a macOS menu item, then leaves the stage to the chosen view.
  // Only what the tap changed, never the whole subject — added in the accent,
  // taken away in ink; nothing under reduced motion, where the outline alone
  // says it.
  useEffect(() => {
    if (!freshSubject || prefersReducedMotion()) return;
    const blink: MaskFlash = { raster: freshSubject.raster, tone: freshSubject.tone };
    let step = 0;
    setFlashMask(blink);
    const timer = window.setInterval(() => {
      step += 1;
      setFlashMask(step === 2 ? blink : null);
      if (step >= 3) window.clearInterval(timer);
    }, FLASH_STEP_MS);
    return () => {
      window.clearInterval(timer);
      setFlashMask(null);
    };
  }, [freshSubject]);

  // --- write-through ---------------------------------------------------------
  // Both drafts ride `use-write-through.ts`, which also takes the roll BACK
  // when it moves under them: an undo, a redo, a batch verb or an instance's
  // copy changes the stored value without this editor's doing, and a draft that
  // ignored it would keep showing numbers the roll no longer holds — and write
  // them back over the step at the next nudge.
  const callbacks = useRef({ onLensProfile, onDevelop, onFraming, onKeystone, onLens, onDetail, onVignette, onRepair, onLayers, onAspect, onSnapshot, onStep, onTabChange, onDeliver, onSettings, onCopy, onPaste, onVariant, onSelectMode, onSelectAll, onEscape, onBand, onSheet, onThumbs, onFocusMode });
  callbacks.current = { onLensProfile, onDevelop, onFraming, onKeystone, onLens, onDetail, onVignette, onRepair, onLayers, onAspect, onSnapshot, onStep, onTabChange, onDeliver, onSettings, onCopy, onPaste, onVariant, onSelectMode, onSelectAll, onEscape, onBand, onSheet, onThumbs, onFocusMode };
  const { replace } = draft;
  // What the next writes are BY, when not the hand: the `Auto` switch run as
  // the picture opened sets it before applying and lets it go once the
  // write-throughs have flushed, so the journal says `auto` on those steps.
  const pendingVia = useRef<JournalVia | null>(null);
  useWriteThrough<DevelopSettings>({
    stored: entry.develop,
    // Keyed on the numbers themselves: `draft` is a new object every render.
    // A white balance set in kelvin is a number too, on the roll's sensor.
    // So is a base curve picked there: it binds the material like a number.
    draft: isDefaultDevelop(draft.draft) && !(inherited && (draft.draft.rawWb || draft.draft.baseCurve)) ? null : draft.draft,
    same: sameDevelop,
    // A picture on the roll's sensor writes the base WITH its first numbers:
    // they were set on the sensor's data and mean nothing on the render.
    onWrite: (value) => {
      const roll = inheritedRef.current;
      callbacks.current.onDevelop(roll && value && !isRawDevelop(value) ? { ...value, ...roll } : value, pendingVia.current ?? undefined);
    },
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
    onWrite: (value) => callbacks.current.onKeystone(value, pendingVia.current ?? undefined),
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
    onWrite: (value) => callbacks.current.onDetail(value, pendingVia.current ?? undefined),
    onReseed: (value) => setDetailDraft(value),
  });
  useWriteThrough<PostCropVignette>({
    stored: entry.vignette ?? null,
    draft: vignetteDraft,
    same: samePostVignette,
    onWrite: (value) => callbacks.current.onVignette(value),
    onReseed: (value) => setVignetteDraft(value),
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
  useWriteThrough<string>({
    stored: entry.aspect,
    draft: aspectDraft,
    same: (a, b) => a === b,
    onWrite: (value) => callbacks.current.onAspect(value ?? 'original', pendingVia.current ?? undefined),
    onReseed: (value) => setAspectDraft(value ?? 'original'),
  });
  useWriteThrough<Framing>({
    stored: entry.framing,
    draft: isDefaultFraming(framingDraft) ? null : framingDraft,
    same: sameFraming,
    onWrite: (value) => callbacks.current.onFraming(value, pendingVia.current ?? undefined),
    onReseed: (value) => setFramingDraft(value ?? { ...DEFAULT_FRAMING }),
  });

  // --- the filmstrip cell, redrawn as delivered once the picture rests -------
  // Delivered means graded AND framed: the strip shows the crop as well as
  // the light. Keyed on the crop too, so a drag that rests redraws the cell.
  const { source, cube, delivered } = picture;
  const aspectRatio = pictureAspectRatio(aspectDraft, source?.width ?? 0, source?.height ?? 0);
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
  // the aspect and the framing, each through its draft.
  // Memoised on the source: a fresh `{ width, height }` per render recomputed
  // the zone and the view, and both canvases under them repainted — a
  // rotated, high-quality draw at device pixels — on every render.
  const cropSrc = useMemo(() => (source ? { width: source.width, height: source.height } : null), [source]);
  const crop = useCropZone({
    src: cropSrc,
    aspect: aspectDraft,
    framing: framingDraft,
    onAspect: setAspectDraft,
    onFraming: setFramingDraft,
  });
  // The Crop tab's Auto level and Crop to subject are switches like the Auto row's.
  const cropSwitches = useCropSwitches({ pictureKey: entry.id, crop, aspect: aspectDraft, onTold: tell });
  const subjectCrop = useSubjectCrop({
    picture,
    crop,
    layers: layersDraft,
    rasters: resolvedSubjects,
    taskScope,
    onTold: tell,
    record: (write) => cropSwitches.record('subject', write),
  });
  // Auto level (`auto-level.ts`): the picture as shot, read whole and once,
  // on the click — held here rather than in the Crop tab since 2026-10-07,
  // so the one `Auto` can run it with the rest (`use-auto-all.ts`).
  const runAutoLevel = useCallback(() => {
    const sample = picture.asShotSample(LEVEL_SAMPLE_EDGE);
    const ctx = sample?.getContext('2d', { willReadFrequently: true });
    if (!sample || !ctx) {
      tell('the picture has not been read yet');
      return;
    }
    const tilt = measureTilt(lumaOf(ctx.getImageData(0, 0, sample.width, sample.height).data, sample.width, sample.height));
    cropSwitches.record('level', () => {
      if (tilt && tilt.tilt !== 0) crop.straighten(levelFine(tilt, framingDraft.flipX, framingDraft.flipY));
    });
    tell(`auto level · ${describeTilt(tilt)}`);
  }, [picture, cropSwitches, crop, framingDraft.flipX, framingDraft.flipY, tell]);
  useEffect(() => {
    if (!source) return;
    const t = window.setTimeout(() => {
      const image = delivered();
      if (!image) return;
      void framedThumbnail(image, source.width, source.height, aspectRatio, framingDraft, border).then((baked) => {
        if (baked) callbacks.current.onSnapshot(baked.blob, baked.aspect);
      });
    }, SNAPSHOT_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [source, cube, delivered, aspectRatio, framingDraft, border]);

  // --- the clipboard's two verbs ------------------------------------------------
  // Held HERE rather than in the well, so ⌘C and ⌘V light the very glyph a
  // press would (`useVerb`, `docs/press-feedback.md` C2).
  // Their WORD is drawn beside the well (`VerbWord`, C3), left of the glyphs —
  // the side the hand does not cover — where the eye already is.
  // Whether a finger holds the device: the well's size follows it (C5).
  const coarse = useCoarsePointer();
  const [clipWord, sayClip] = useVerbWord();
  const copyVerb = useVerb(sayClip);
  const pasteVerb = useVerb(sayClip);
  /** A paste: the picture held by the roll, else the numbers a Trips or Studio sheet copied. */
  const pasteNow = (): VerbReturn => {
    const held = onPaste();
    if (held) return held;
    const pasted = pasteDevelop();
    if (!pasted) return { ok: false, word: 'nothing copied yet' };
    draft.setDraft(pasted);
    return 'pasted';
  };
  // A paste that lands on the picture on screen ECHOES on the stage's edge
  // at once (C4); one that goes to a selection leaving it out does not.
  const pasteEcho = clipboard.pasteLandsHere === false ? null : taskScope;
  const clipVerbs = useRef({ copy: copyVerb, paste: pasteVerb, pasteNow, pasteEcho, canPaste: clipboard.canPaste });
  clipVerbs.current = { copy: copyVerb, paste: pasteVerb, pasteNow, pasteEcho, canPaste: clipboard.canPaste };

  // --- keys --------------------------------------------------------------------
  const keyState = useRef({ draft, picture, tell, crop, tab, tabs, factsOn, setFactsOn, setClipping, selectedLayer, activeMask, painting, selectedPatchId, removeSelectedPatch, repairing, selecting });
  keyState.current = { draft, picture, tell, crop, tab, tabs, factsOn, setFactsOn, setClipping, selectedLayer, activeMask, painting, selectedPatchId, removeSelectedPatch, repairing, selecting };
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      // A question over the editor keeps every key — and so does any modal
      // sheet over it (the keys sheet, the settings, the making-of): with one
      // open, ←/→, P/M/U, V and Delete used to act on the picture behind it,
      // out of sight and into the export.
      if (document.querySelector('[role="alertdialog"], [aria-modal="true"]')) return;
      const action = editorKeyAction({
        key: e.key,
        repeat: e.repeat,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        targetTypes: targetOwnsTyping(describeKeyTarget(e.target)),
        targetTakesText: targetTakesText(describeKeyTarget(e.target)),
        hasSelection: Boolean(window.getSelection()?.toString()),
        layersTab: keyState.current.tab === 'layers',
        selecting: keyState.current.selecting,
      });
      if (!action) return;
      const { draft: d, picture: pic, tell: say, crop: c, tab: open } = keyState.current;
      if (typeof action === 'object') {
        // A tab this picture has not got (a clip's Crop) is nobody's key.
        if (!keyState.current.tabs.some((t) => t.id === action.tab)) return;
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
        case 'copy': {
          e.preventDefault();
          // The glyph lives the verb a key started, the same as a press (C2).
          const settings = d.draft;
          clipVerbs.current.copy.run(() => callbacks.current.onCopy(settings));
          return;
        }
        case 'mono':
          // Lightroom's V: the treatment flips; the colour mixer is kept either way.
          e.preventDefault();
          d.patch({ mono: d.draft.mono ? null : straightMono() });
          say(d.draft.mono ? 'colour' : 'black and white');
          return;
        case 'variant':
          if (!callbacks.current.onVariant) return;
          e.preventDefault();
          callbacks.current.onVariant();
          return;
        case 'paste': {
          // Nothing held anywhere: the key is not ours.
          if (!clipVerbs.current.canPaste) return;
          e.preventDefault();
          clipVerbs.current.paste.run(clipVerbs.current.pasteNow, { echo: clipVerbs.current.pasteEcho });
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
        case 'select':
          if (!callbacks.current.onSelectMode) return;
          e.preventDefault();
          callbacks.current.onSelectMode();
          return;
        case 'select-all':
          if (!callbacks.current.onSelectAll) return;
          e.preventDefault();
          callbacks.current.onSelectAll();
          return;
        case 'band':
          if (!callbacks.current.onBand) return;
          e.preventDefault();
          callbacks.current.onBand();
          return;
        case 'sheet':
          if (!callbacks.current.onSheet) return;
          e.preventDefault();
          callbacks.current.onSheet();
          return;
        case 'focus':
          if (!callbacks.current.onFocusMode) return;
          e.preventDefault();
          callbacks.current.onFocusMode();
          return;
        case 'thumbs-smaller':
        case 'thumbs-larger':
          if (!callbacks.current.onThumbs) return;
          e.preventDefault();
          callbacks.current.onThumbs(action === 'thumbs-larger' ? 1 : -1);
          return;
        case 'clipping':
          e.preventDefault();
          keyState.current.setClipping((on) => !on);
          return;
        case 'mask': {
          // The Layers tab, with a layer open: anywhere else there is no mask.
          if (open !== 'layers' || !keyState.current.selectedLayer) return;
          e.preventDefault();
          setMaskView((v) => nextMaskView(v));
          return;
        }
        case 'pick': {
          const active = keyState.current.activeMask;
          const kind = active?.kind;
          const placeable = active?.kind === 'shade' && centreAxis(active.direction) !== null;
          if (open !== 'layers' || (kind !== 'subject' && kind !== 'brush' && kind !== 'colour' && !placeable)) return;
          e.preventDefault();
          setPainting(!keyState.current.painting);
          return;
        }
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
            return;
          }
          // Then the host's: the band's selection, its sheet, the focus.
          if (callbacks.current.onEscape?.()) e.preventDefault();
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
  const tabLabel = tabs.find((t) => t.id === tab)?.label ?? 'Adjust';
  // The making-of (`docs/develop-timelapse.md`): the picture's chapters,
  // memoised on its journal and its sections so their states keep identity
  // across a caption typed; the row on the Export tab, and the sheet.
  const chapters = usePictureChapters(entry, exports.openSize ? exports.openSize.width / exports.openSize.height : 1);
  const identity = useDeliveryIdentity();
  // The HDR preview (`hdr-preview.ts`): the picture as delivered and, where it
  // is developed on its sensor, the same picture the roll's stops darker —
  // the darker one FIRST, copied out, since both come off the one held
  // grader's canvas — framed as the crop stage shows it and wrapped as the
  // export would. A render alone has nothing above white, and says so.
  const hdrStops = exportSettings.hdrStops;
  const makeHdrPreview = useCallback(async (): Promise<HdrPreview | null> => {
    const dark = onSensor
      ? picture.deliveredWith(stack.composeWith({ ...developNow, exposure: developNow.exposure - hdrStops }))
      : null;
    const sdr = picture.delivered();
    if (!sdr) return null;
    const size = sdr as { width?: unknown; height?: unknown };
    const width = typeof size.width === 'number' ? size.width : 0;
    const height = typeof size.height === 'number' ? size.height : 0;
    if (!(width > 0 && height > 0)) return null;
    return previewUltraHdr({ sdr, dark, source: { width, height }, framing: framingDraft, aspect: aspectDraft, border, stops: hdrStops });
  }, [onSensor, picture, stack, developNow, hdrStops, framingDraft, aspectDraft, border]);
  // The making-of's own run (`use-timelapse-export.ts`): a task on this
  // picture's edge, one unit on the same Deliver bar as the roll's export,
  // the two never running at once. The states are graded through the
  // export's own cube resolver, shared with the sheet's preview.
  const { interpolation } = useLutInterpolation();
  const cubes = useMemo(() => rollCubes(interpolation), [interpolation]);
  const makingOf = useTimelapseExport({ cubes });
  const avcEncode = useAvcEncodeSupport();
  // The making-of's source, kept as ONE object while its bytes are the same:
  // a fresh object per render restarted the sheet's preview on every progress
  // report of a running export (his report: the sheet's status and buttons
  // jumping while it exports).
  const timelapseSource = useMemo(
    () =>
      shownFile
        ? {
            file: shownFile,
            raw: wantsRaw && rawFile ? { file: rawFile, gain: rawGain ?? 1, profile: decodeProfile } : null,
            calibration: wantsRaw ? applied : null,
          }
        : null,
    // The profile by its numbers, not its array's identity.
    [shownFile, wantsRaw, rawFile, rawGain, applied, decodeProfileKey],
  );
  const anyProgress = exports.progress ?? makingOf.progress;
  const anyExporting = exports.exporting ?? makingOf.exporting;
  const makingOfRow = (
    <FieldRow label="This picture" align="start" hintShown hint={file ? undefined : 'the picture’s bytes are not in hand'}>
      <div className="flex flex-col items-start gap-2 min-w-0 pt-1">
        <span className="font-mono text-sm leading-snug text-ink">{makingOfLine(chapters, exportSettings.timelapse)}</span>
        <Button size="sm" icon={Icons.video} onClick={() => onTimelapseOpen?.(true)} disabled={!file || !onTimelapseOpen}>
          Timelapse…
        </Button>
      </div>
    </FieldRow>
  );
  const deliverBar = (inDrawer: boolean) => (
    <DeliverBar
      verbs={exportVerbs}
      summary={exports.plan.summary}
      exporting={anyExporting}
      progress={anyProgress}
      onCancel={exports.progress ? exports.cancel : makingOf.cancel}
      note={exports.note ?? makingOf.note}
      placement={inDrawer ? 'drawer' : 'panel'}
      primary="roll"
      unitWord="picture"
      empty="Open a picture to export."
      settingsLine={
        anyProgress
          ? `Settings as at ${runClock(anyProgress.startedAt)} · an edit now goes to the next export`
          : null
      }
    />
  );

  /**
   * The points the author picked for the OPEN subject layer, drawn on the
   * picture. They were invisible until now, which made the documented
   * tap-a-marker-to-remove gesture unaimable — the maintainer's *"i can not
   * see"*.
   */
  const subjectMarks = useMemo<readonly SubjectPin[] | null>(
    () =>
      activeMask?.kind === 'subject'
        ? subjectPins(activeMask)
        : activeMask?.kind === 'colour'
          ? activeMask.samples.map((c) => ({ x: c.x, y: c.y, tone: 'add' as const }))
          : null,
    [activeMask],
  );
  // ⌥ held while a subject is picked shows the OTHER mode on the stage — in
  // the switch and in the cursor — for as long as it is held, so the hand is
  // told before it clicks what the click will do. The tap itself reads the
  // modifier off its own event (`paint.onStart`), never this state.
  const pickingSubject = paintKind === 'subject';
  const [altHeld, setAltHeld] = useState(false);
  useEffect(() => {
    if (!pickingSubject) {
      setAltHeld(false);
      return;
    }
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setAltHeld(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setAltHeld(false);
    };
    const lost = () => setAltHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', lost);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', lost);
    };
  }, [pickingSubject]);
  const tapTone: 'add' | 'remove' = altHeld ? (subjectTone === 'add' ? 'remove' : 'add') : subjectTone;
  // The switch over the picture while a subject is picked: the eye is on the
  // picture then, not on the panel.
  const subjectTool = pickingSubject ? (
    <div className="flex items-center gap-1.5 rounded-control border border-line-strong bg-surface/92 shadow-paper py-0.5 pl-0.5 pr-2">
      <Segmented
        size="sm"
        label="What a tap on the picture does"
        value={tapTone}
        onChange={(v) => setSubjectTone(v)}
        options={SUBJECT_TONES}
      />
      <span className="font-mono text-3xs text-faint">⌥ flips</span>
    </div>
  ) : null;
  const unmarkSubject = useCallback(
    (index: number) => {
      setLayersDraft((list) =>
        list.map((l) => {
          if (l.id !== paintId) return l;
          const m = componentMask(l, partIndex);
          if (m?.kind === 'subject') return withComponentMask(l, partIndex, dropSubjectPin(m, index));
          if (m?.kind === 'colour') return withComponentMask(l, partIndex, { ...m, samples: m.samples.filter((_, i) => i !== index) });
          return l;
        }),
      );
    },
    [paintId, partIndex],
  );

  /**
   * The facts drawn down the picture's corner, one per line: what the numbers
   * say, what else is on it, what the picture IS. The gesture hints that used
   * to ride the same sentence are gone from here — they live in the shortcuts
   * sheet now, where a hint can be read once rather than stared at all day.
   */
  const facts = useMemo<string[] | null>(() => {
    if (!factsOn) return null;
    const lines = developLines(developNow);
    if (drawingCount) lines.push(`${drawingCount} layer${drawingCount === 1 ? '' : 's'}`);
    if (detailDraft) lines.push(describeDetail(detailDraft));
    if (vignetteDraft) lines.push(describePostVignette(vignetteDraft));
    if (repairDraft.length) lines.push(describePatches(repairDraft));
    if (fidelity.note) lines.push(fidelity.note);
    return lines;
  }, [factsOn, developNow, drawingCount, detailDraft, vignetteDraft, repairDraft, fidelity.note]);

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

  // --- the lens's measured profile (Lensfun, `lens-profiles.md`) --------------
  // Looked up from what the picture says about its glass; kept on this device
  // once found. On the sensor, a picture that never decided gets it by itself;
  // anywhere else it is offered, never applied.
  const lensfunOn = useLensfunAllowed();
  const shot = useMemo<ShotLens | null>(
    () =>
      shotExif?.make && shotExif.model
        ? {
            make: shotExif.make,
            model: shotExif.model,
            lensModel: shotExif.lensModel,
            focalLength: shotExif.focalLength,
            focalLength35: shotExif.focalLength35,
            fNumber: shotExif.fNumber,
          }
        : null,
    [shotExif],
  );
  const shotKey = shot ? `${lensKey(shot.make ?? '', shot.model ?? '', shot.lensModel)}|${shot.focalLength ?? ''}|${shot.fNumber ?? ''}` : '';
  const [lensLookup, setLensLookup] = useState<{ key: string; result: LookUp } | null>(null);
  const profileState = useRef({ undecided: entry.lensProfile === undefined, onSensor });
  profileState.current = { undecided: entry.lensProfile === undefined, onSensor };
  useEffect(() => {
    if (!shot || !shotKey) {
      setLensLookup(null);
      return;
    }
    const ctrl = new AbortController();
    let alive = true;
    void lookUpLens(shot, ctrl.signal).then((result) => {
      if (!alive) return;
      setLensLookup({ key: shotKey, result });
      if (result.kind === 'found' && profileState.current.onSensor && profileState.current.undecided) {
        const found = profileFor(result.camera, result.lens, shot);
        if (found) callbacks.current.onLensProfile(found);
      }
    });
    return () => {
      alive = false;
      ctrl.abort();
    };
    // `shot` is keyed by `shotKey`; consent and the sensor are what re-ask.
  }, [shotKey, lensfunOn, onSensor]);
  const lookup = lensLookup?.key === shotKey ? lensLookup.result : null;
  const candidate = lookup?.kind === 'found' && shot ? profileFor(lookup.camera, lookup.lens, shot, !onSensor) : null;
  const shotLine = useMemo(() => (factsOn ? captureLine(shotExif) || null : null), [factsOn, shotExif]);

  // --- Auto detail (`auto-detail.ts`) -------------------------------------------
  // What it reads: the ISO of the file ON SCREEN (the vouched record for a
  // proxy), and the MATERIAL the picture is developed from — the sensor's
  // own data, the camera's file, or a re-encode made to look at. A switch
  // over the whole detail record (`use-value-switch.ts`): the radius and the
  // Detail it leaves alone come back with the rest on a turn-off.
  const detailFacts = useMemo<DetailFacts>(
    () => ({
      iso: typeof shotExif?.iso === 'number' && shotExif.iso > 0 ? shotExif.iso : null,
      material: onSensor
        ? 'sensor'
        : shownFile && (isWorkingPreview(shownFile) || mediaOrigin(shownFile)?.fidelity === 'proxy')
          ? 'proxy'
          : 'camera',
    }),
    [shotExif, onSensor, shownFile],
  );
  const detailSwitch = useValueSwitch<DetailSettings | null>({
    pictureKey: entry.id,
    verb: 'detail',
    value: detailDraft,
    same: sameDetail,
    write: setDetailDraft,
    onTold: tell,
    label: 'auto detail',
    words: 'the detail',
  });
  const autoDetailVerb = useMemo(() => {
    const apply = () => {
      const found = autoDetail(detailFacts);
      const next = withAutoDetail(detailDraft, found);
      detailSwitch.record(isDefaultDetail(next) ? null : next, `auto detail · ${describeAutoDetail(found, detailFacts)}`);
    };
    return {
      state: detailSwitch.state,
      facts: detailFacts,
      apply,
      turnOff: detailSwitch.turnOff,
      onClick: () => {
        if (!detailSwitch.turnOff()) apply();
      },
    };
  }, [detailSwitch, detailFacts, detailDraft]);

  // --- Auto upright (`auto-keystone.ts`) ----------------------------------------
  // The picture AS SHOT, read whole and once on the click — the source before
  // any warp, so the verb SETS the perspective rather than nudging a warped
  // view —, the two sliders solved against the matrix, the zoom re-solved on
  // the source's own frame (the one the keystone pass hands the matrix).
  const uprightSwitch = useValueSwitch<Keystone | null>({
    pictureKey: entry.id,
    verb: 'upright',
    value: keystoneDraft,
    same: sameKeystone,
    write: setKeystoneDraft,
    onTold: tell,
    label: 'auto upright',
    words: 'the perspective',
  });
  const autoUprightVerb = useMemo(() => {
    const apply = () => {
      const sample = picture.asShotSample(UPRIGHT_SAMPLE_EDGE);
      const ctx = sample?.getContext('2d', { willReadFrequently: true });
      if (!sample || !ctx) {
        tell('auto upright · the picture has not been read yet');
        return;
      }
      const up = measureUpright(lumaOf(ctx.getImageData(0, 0, sample.width, sample.height).data, sample.width, sample.height));
      const next = uprightKeystone(up, keystoneDraft, source ? source.width / source.height : 1);
      // Nothing to right: recorded as a press that changed nothing (dashed), never a stale warp.
      if (!next) {
        uprightSwitch.record(keystoneDraft, `auto upright · ${describeUpright(up)}`);
        return;
      }
      uprightSwitch.record(isDefaultKeystone(next) ? null : next, `auto upright · ${describeUpright(up)} · zoom ${next.scale.toFixed(2)}×`);
    };
    return {
      state: uprightSwitch.state,
      disabled: !source,
      apply,
      turnOff: uprightSwitch.turnOff,
      onClick: () => {
        if (!uprightSwitch.turnOff()) apply();
      },
    };
  }, [uprightSwitch, picture, keystoneDraft, source, tell]);

  // --- the one `Auto` (`auto-plan.ts`, `use-auto-all.ts`) -----------------------
  // Every step the plan may tick, as THIS picture can run it: the Auto row's
  // three over the stats, the Detail tab's, the Crop tab's two — a clip has
  // the develop alone. Each runs through its own switch, so each lights and
  // each can be taken back alone after.
  const [autoPlan] = useLocalPref(autoPlanPref, DEFAULT_AUTO_PLAN);
  const stats = picture.stats;
  const autoSteps = useMemo<AutoAllStep[]>(() => {
    const develop = (id: 'tone' | 'colour' | 'bands'): AutoAllStep => ({
      id,
      state: auto.state(id),
      apply: () => {
        if (stats && stats.total > 0) runAutoVerb(id, stats, auto);
      },
      turnOff: () => auto.turnOff(id),
    });
    const steps: AutoAllStep[] = [develop('tone'), develop('colour'), develop('bands')];
    if (!clip) {
      steps.push({ id: 'detail', state: autoDetailVerb.state, apply: autoDetailVerb.apply, turnOff: autoDetailVerb.turnOff });
      steps.push({ id: 'level', state: cropSwitches.state('level'), apply: runAutoLevel, turnOff: () => cropSwitches.turnOff('level') });
      steps.push({ id: 'upright', state: autoUprightVerb.state, apply: autoUprightVerb.apply, turnOff: autoUprightVerb.turnOff });
    }
    return steps;
  }, [auto, stats, clip, autoDetailVerb, cropSwitches, runAutoLevel, autoUprightVerb]);
  const autoAll = useAutoAll({ plan: autoPlan, steps: autoSteps, onTold: tell });
  // Run as the picture OPENS, when the device asks: an untouched photograph
  // (never a clip), once per picture per session, the moment its stats are
  // read — written `via: 'auto'` so the journal says so, one undo step like
  // any other. A second open in the session, an edited picture, or one the
  // switch was already pressed on gets nothing.
  const autoAllRef = useRef(autoAll);
  autoAllRef.current = autoAll;
  const entryRef = useRef(entry);
  entryRef.current = entry;
  const statsReady = Boolean(stats && stats.total > 0);
  useEffect(() => {
    if (!autoPlan.onOpen || clip || !statsReady || !source) return;
    if (isEdited(entryRef.current) || !firstOpen(entryRef.current.id)) return;
    pendingVia.current = 'auto';
    void autoAllRef.current.apply().finally(() => {
      window.setTimeout(() => {
        pendingVia.current = null;
      }, WRITE_DELAY_MS * 3);
    });
  }, [autoPlan.onOpen, clip, statsReady, source]);

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
  // The well's targets follow the HAND, not the width (C5): an iPad in
  // landscape is a wide shell under a finger, and it was given 28 px.
  const touchSized = fingerSize(compact, coarse) === 'md';
  const verbHeight = touchSized ? 'h-[2.125rem]' : 'h-7';
  /** A layer is open on the Layers tab: there is a mask to show. */
  const maskOpen = tab === 'layers' && selectedLayer !== null && !clip;
  // Both press like `IconButton` (`PRESS_LOOK`): they sit in its well.
  const verbPress =
    `transition-[background-color,border-color,color,translate,box-shadow] duration-150 ease-paper ${PRESS_LOOK} data-pressed:bg-paper-2`;
  const abPill =
    `${verbHeight} px-2 flex-none inline-flex items-center justify-center rounded-control border ` +
    `font-mono text-2xs tracking-[0.06em] whitespace-nowrap cursor-pointer ${verbPress}`;
  /** The `?`, square like the glyphs it sits beside rather than a pill of its own. */
  const helpVerb =
    `${verbHeight} ${touchSized ? 'w-[2.125rem]' : 'w-7'} flex-none inline-flex items-center justify-center ` +
    `rounded-control border font-mono text-xs cursor-pointer ${verbPress}`;
  /** The wipe is suspended, and the pill says so rather than claiming to be on. */
  const abHeld = compareOn && (picture.painting || picture.picking);
  pictureRef.current = picture;

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
  // A phone folds the zoom's ± and the view's verbs into one menu (`StageZoomControl`'s `folded`).
  const foldView = compact && !cropping;
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
    // On a phone the bar cannot hold the zoom pill and the whole well (a
    // 390 px screen lost Focus and Keys off its right edge): the view's own
    // two verbs join the view's menu there, and leave the well.
    ...(foldView
      ? [
          ...(onFocusMode
            ? [{ id: 'focus', label: zoomRow(!!focused, 'Focus', 'the picture alone, nothing else on screen'), onSelect: onFocusMode }]
            : []),
          { id: 'keys', label: zoomRow(false, 'Keys and gestures', 'what a finger and the keyboard can do here'), onSelect: () => setHelpOpen(true) },
        ]
      : []),
  ];

  return (
    <>
      <div className={compact ? 'flex-1 min-h-0 flex flex-col gap-2' : `${COLUMN_CLASS[columns.stage]} row-start-1 min-w-0 min-h-0 flex flex-col gap-2`}>
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
              name={pictureLabel(entry)}
              chip={fidelity.chip}
              rows={rows}
              current={current}
              base={wantsRaw ? rung : 'proxy'}
              rungs={sensor ? rungs : []}
              onRendition={(id) => {
                // A file below the sensor: the base comes off with it, and
                // the opening row is stored as nothing, one spelling.
                if (baseRung(draft.draft.base) > 0) patchDraft({ base: null, rawGain: null, rawProfile: null });
                // A row of this picture asked for and no longer wanted stops
                // coming — this reader lets go; an export that joined keeps it.
                if (flight.current && flight.current.id !== id) flight.current.controller.abort();
                // Under a roll's choice the opening row is a choice too — the
                // one that keeps this picture off the roll's file.
                onRendition(id === opening?.id && !rollChoice ? null : id);
                const row = rows.find((r) => r.id === id);
                setOffer(row ? roleOfRow(row) : null);
              }}
              onRemeter={() => {
                // The stored number goes, the held decodes with it (a held
                // decode answers with the gain it was asked for), and the
                // next decode measures anew and stores what it finds.
                patchDraft({ rawGain: null });
                setFollowGain(null);
                dropDecodedRaws();
                picture.redecode();
                tell('metering the exposure again from the sensor’s data');
              }}
              onBase={(next) => {
                if (next === 'proxy') {
                  patchDraft({ base: null, rawGain: null, rawProfile: null });
                  return;
                }
                const climbing = baseRung(developNow.base) === 0;
                // Newly on its sensor: the opening curve with it, so a RAW
                // does not read flatter than its camera's JPEG by default.
                // Auto, measured on the file's render once it is decoded —
                // Standard where the render cannot be measured.
                // Newly on its sensor: the camera profile too, resolved on
                // the coming decode with the gain (`camera-profiles.md`).
                patchDraft(
                  climbing
                    ? { base: next, rawProfile: PROFILE_PENDING, baseCurve: cloneBaseCurve(draft.draft.baseCurve) ?? { kind: 'auto' } }
                    : { base: next },
                );
                setOffer('sensor');
                if (climbing && !draft.asShot) {
                  tell('your numbers now act on the RAW — another starting point');
                }
              }}
              status={wantsRaw ? (picture.problem ?? (!picture.source ? 'decoding the sensor’s data…' : null)) : null}
              gain={wantsRaw ? rawGain : null}
              baseCurve={developNow.baseCurve ?? null}
              onBaseCurve={(next) => patchDraft({ baseCurve: next })}
              calibration={calibration?.summary ?? null}
              roll={
                onRollChoice && rollPhotos > 1 && !clip
                  ? { choice: rollChoice, onChoice: onRollChoice, follows: followsRoll(rollChoice, entry), reason: rollReason, count: rollPhotos }
                  : null
              }
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
                folded={foldView}
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
          <span className="relative flex-none inline-flex">
          {/* Left of the glyphs where the bar has room; on a phone the well
              starts near the screen's edge, so the word sits above it. */}
          <VerbWord word={clipWord} side={compact ? 'aboveStart' : 'left'} />
          <DevelopActionsGroup
            className="flex-none"
            size={touchSized ? 'md' : 'sm'}
            clipboard={!cropping}
            draft={draft.draft}
            asShot={draft.asShot}
            onReplace={draft.setDraft}
            onTold={tell}
            clip={{
              ...clipboard,
              canCopy: clipboard.canCopy || !draft.asShot,
              onCopy: () => onCopy(draft.draft),
              onPaste: pasteNow,
            }}
            verbs={{ copy: copyVerb, paste: pasteVerb }}
            onOutcome={sayClip}
            echo={taskScope}
          >
            {!cropping && (
              <IconButton
                label="Apply or reset sections"
                title="Sections — apply some of this picture to other pictures, or reset them here"
                size={touchSized ? 'md' : 'sm'}
                onClick={onSettings}
              >
                {Icons.settings}
              </IconButton>
            )}
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
            {/* The MASK VIEW — Hidden, Outline, Fill — as one glyph of fixed
                width in the well, drawn on every tab so it never slides a verb
                aside (`frontend.md`, a toolbar never inserts a control), lit
                only where there is a mask to show: the Layers tab with a layer
                open. A click steps it, like `M`. */}
            {source && !cropping && (
              <button
                type="button"
                className={`${helpVerb} ${
                  maskOpen && maskView !== 'off'
                    ? 'border-accent bg-accent-wash text-accent-ink'
                    : 'border-transparent bg-transparent text-muted hover:text-accent-ink'
                } disabled:opacity-35 disabled:cursor-default disabled:hover:text-muted`}
                disabled={!maskOpen}
                onClick={() => setMaskView((v) => nextMaskView(v))}
                aria-label={`Mask view: ${MASK_VIEW_LABELS[maskView]}`}
                title={
                  maskOpen
                    ? `Mask: ${MASK_VIEW_LABELS[maskView]} — click or M for ${MASK_VIEW_LABELS[nextMaskView(maskView)]}${
                        maskView === 'off' ? '; its outline shows by itself while you pick or paint' : ''
                      }`
                    : 'Mask view — open a layer on the Layers tab'
                }
              >
                <MaskViewGlyph view={maskView} />
              </button>
            )}
            {/* FOCUS — the picture alone, the band, the inspector and the page
                bar away (`docs/develop-roll-browser.md`, face D): a verb at
                every width, since a phone has no F and the way back must be
                where the way in was. Lit while on, like the A/B. */}
            {onFocusMode && !foldView && (
              <button
                type="button"
                className={`${helpVerb} ${
                  focused
                    ? 'border-accent bg-accent-wash text-accent-ink'
                    : 'border-transparent bg-transparent text-muted hover:text-accent-ink'
                }`}
                onClick={onFocusMode}
                aria-pressed={focused}
                title={focused ? 'Focus — the picture alone; F or Esc brings the rest back' : 'Focus — the picture alone, nothing else on screen (F)'}
                aria-label="Focus — the picture alone"
              >
                ⤢
              </button>
            )}
            {/* The legend that used to run along the bottom of the editor, as a
                verb. Drawn at every width: on a phone there are no keys, but the
                GESTURES it lists are exactly the ones a finger has to
                discover. */}
            {!foldView && (
            <button
              type="button"
              className={`${helpVerb} border-transparent bg-transparent text-muted hover:text-accent-ink`}
              onClick={() => setHelpOpen(true)}
              title="Keys and gestures (H)"
              aria-label="Keys and gestures"
            >
              ?
            </button>
            )}
          </DevelopActionsGroup>
          </span>
          </div>
        </div>
        <DevelopViewport
          picture={picture}
          hasFile={Boolean(file)}
          emptyText={emptyText}
          scope={taskScope}
          pixelView={pixelView}
          // The roll under the stage: where the deck is, and who sits either
          // side — drawn from their cells, paged by a swipe with A/B off.
          deck={neighbours ? { offset: deck.offset, settling: deck.settling, previous: neighbours.previous, next: neighbours.next } : null}
          still={still}
          facts={facts}
          shot={shotLine}
          // B of « C + B »: drawn OVER the picture, at the top, so the bar
          // above it never gains a control and nothing slides under a pointer.
          offer={
            rollOffer && onRollChoice ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  title={`Every picture with no choice of its own opens on ${CHOICE_WORDS[rollOffer]} — the ones you chose by hand keep theirs`}
                  onClick={() => {
                    onRollChoice(rollOffer === 'proxy' ? null : rollOffer);
                    setOffer(null);
                  }}
                >
                  {compact ? `${CHOICE_WORDS[rollOffer]} → whole roll` : `Use ${CHOICE_WORDS[rollOffer]} for the whole roll`}
                </Button>
                <IconButton size="sm" variant="ghost" label="Only this picture" onClick={() => setOffer(null)}>
                  {Icons.close}
                </IconButton>
              </>
            ) : null
          }
          marks={subjectMarks}
          tapTone={tapTone}
          tool={subjectTool}
          // Shown whenever the subject layer is open — a picked point is a fact
          // about the layer, not about the tool — but removable only while Pick
          // is on, so a settled mask cannot be edited by a stray click.
          onUnmark={paintKind === 'subject' || paintKind === 'colour' ? unmarkSubject : undefined}
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
            auto.apply(
              'pick',
              { temperature, tint },
              `picked grey · temperature ${temperature}, tint ${tint}` + (clamped ? ' · as far as the sliders reach' : ''),
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
        {/* A clip is judged MOVING: the transport under the picture (the
            sheet's own, `DevelopTransport`), the stage graded frame by frame
            as it plays — under the crop stage too, so the zone is judged on
            any frame. Viewing only — where it is paused is written nowhere. */}
        {clip && picture.video && <DevelopTransport video={picture.video} className="flex-none" />}
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
        open={sheetOpen && !focused}
        onClose={() => onSheetOpen(false)}
        title={`${tabLabel} · ${pictureLabel(entry)}`}
        // The docked inspector wears the frame both editors' inspectors wear
        // (`frontend.md`): the tab strip pinned, the sections scrolling under it.
        // In focus it is not drawn — kept mounted, so its folds and fields hold.
        className={`${focused ? 'hidden' : `${COLUMN_CLASS[columns.panel]} row-start-1 row-span-2`} min-h-0 flex flex-col gap-3 border border-line rounded-paper bg-surface p-3`}
      >
        {!compact && (
          <Segmented fill size="sm" label="Inspector" value={tab} onChange={onTabChange} options={tabs} className="flex-none" />
        )}
        {/* Adjust, Detail and Crop are columns of folding sections, each with
            its own rule and padding — a gap on top of that is the air twice
            (Layers and Export keep theirs: their blocks are not all sections
            yet). Every
            row's explanation folds behind an ⓘ here (`FoldHints`); a line
            that says a state stays in the open. */}
        <FoldHints>
        <div
          className={`${
            compact ? 'flex flex-col' : 'flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain flex flex-col -mr-3 pr-3'
          } ${tab === 'export' || tab === 'layers' ? 'gap-4' : 'gap-0'}`}
        >
          {tab === 'adjust' ? (
            <>
              <DevelopHistogram
                histogram={picture.histogram}
                clipping={clipping}
                onClipping={() => setClipping((on) => !on)}
                readout={picture.readout}
              />
              <DevelopAutoSection
                stats={picture.stats}
                auto={auto}
                all={autoAll}
                picking={picture.picking}
                onPicking={picture.setPicking}
                echo={taskScope}
              />
              {wantsRaw && rawWhite && (
                <WhiteBalancePanel
                  white={rawWhite}
                  profiled={Boolean(appliedProfile(developNow))}
                  value={draft.draft.rawWb ?? null}
                  onChange={(rawWb) => draft.patch({ rawWb })}
                />
              )}
              <DevelopSliders value={draft.draft} onChange={draft.set} />
              {/* Presence and the post-crop vignette are PASSES over one
                  frame (`detail.ts`, `post-vignette.ts`): a photograph's. */}
              {!clip && <PresencePanel value={detailDraft} onChange={setDetailDraft} />}
              <DevelopLevelsSection value={draft.draft.levels} onChange={(levels) => draft.patch({ levels })} />
              <DevelopCurve
                value={draft.draft.curves}
                histogram={picture.histogram}
                onChange={(curves) => draft.patch({ curves })}
              />
              <DevelopMixer
                value={draft.draft.mixer}
                onChange={(mixer) => draft.patch({ mixer })}
                mono={draft.draft.mono}
                onMono={(mono) => draft.patch({ mono })}
              />
              <DevelopGrading value={draft.draft.grading} onChange={(grading) => draft.patch({ grading })} />
              {!clip && <VignettePanel value={vignetteDraft} onChange={setVignetteDraft} />}
              <DevelopPresetsSection
                presets={presets}
                draft={draft.draft}
                asShot={draft.asShot}
                onApply={draft.setDraft}
                onTold={tell}
                look={entry.grade ?? null}
                onApplyLook={onLook}
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
              <DetailPanel
                value={detailDraft}
                onChange={setDetailDraft}
                maskView={sharpenMaskView}
                onMaskView={setSharpenMaskView}
                auto={autoDetailVerb}
              />
            </>
          ) : tab === 'layers' ? (
            <>
              <LayersPanel
                layers={layersDraft}
                selectedId={selectedLayerId}
                thumbs={layerThumbs.rows}
                onSelect={setSelectedLayerId}
                onAdd={(kind: MaskKind | null) => {
                  const made = createLayer(kind);
                  setLayersDraft((list) => addLayer(list, made));
                  setSelectedLayerId(made.id);
                  // A new layer is made WHERE first: its mask is what it lacks.
                  setLayerTab('mask');
                  // A fresh subject's only use is to be tapped, a painted
                  // mask's to be painted: Pick / Paint comes on with it rather
                  // than being one more thing to find.
                  setPainting(takesPointer(kind));
                }}
                onRemove={(id) => {
                  setLayersDraft((list) => removeLayer(list, id));
                  if (id === selectedLayerId) setSelectedLayerId(null);
                }}
                onMove={(id, delta) => setLayersDraft((list) => moveLayer(list, id, delta))}
                onMoveTo={(id, index) => setLayersDraft((list) => moveLayerTo(list, id, index))}
                onDuplicate={(id) => {
                  const copy = newLayerId();
                  setLayersDraft((list) => duplicateLayer(list, id, copy));
                  setSelectedLayerId(copy);
                }}
                onKind={changeLayerKind}
                onPatch={(id, patch) => setLayersDraft((list) => patchLayer(list, id, patch))}
              />
              {selectedLayer && (
                <LayerDetail
                  layer={selectedLayer}
                  tab={layerTab}
                  onTab={(next) => {
                    setLayerTab(next);
                    // The Adjust half has nothing to pick or paint.
                    if (next === 'adjust') setPainting(false);
                  }}
                  onRename={(name) => setLayersDraft((list) => patchLayer(list, selectedLayer.id, { name }))}
                  onKind={(kind) => changeLayerKind(selectedLayer.id, kind)}
                >
                  {layerTab === 'mask' ? (
                    <MaskPanel
                      layer={selectedLayer}
                      layers={layersDraft}
                      part={partIndex}
                      onPart={setSelectedPart}
                      onPatch={(patch) =>
                        setLayersDraft((list) => patchLayer(list, selectedLayer.id, patch))
                      }
                      brush={brush}
                      onBrush={onBrush}
                      painting={painting}
                      onPainting={setPainting}
                      subjectTone={tapTone}
                      onSubjectTone={(tone) => {
                        setSubjectTone(tone);
                        // Choosing what a tap does is choosing to tap.
                        if (!painting) setPainting(true);
                      }}
                      terms={layerThumbs.terms}
                      subject={
                        partIndex === null && selectedLayer.mask?.kind === 'subject'
                          ? {
                              working: subject.working === selectedLayer.id,
                              state: subject.state,
                              resolved: subjectRasters.has(selectedLayer.id),
                            }
                          : null
                      }
                    />
                  ) : (
                    <>
                      {/* The SAME sliders the global develop uses, because a
                          layer's adjustment IS a DevelopSettings — one maths, one
                          panel, and a local exposure behaves like a global one. */}
                      <DevelopSliders
                        foldPrefix="layer."
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
                        foldPrefix="layer."
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
                </LayerDetail>
              )}
            </>
          ) : tab === 'crop' ? (
            <CropPanel
              picture={picture}
              crop={crop}
              aspect={aspectDraft}
              border={entry.border}
              onBorder={onBorder}
              deliveredSize={exports.openDelivery?.out ?? null}
              verbs={cropApplyTo}
              borderVerbs={borderApplyTo}
              clip={clip}
              subjectCrop={subjectCrop}
              switches={cropSwitches}
              onAutoLevel={runAutoLevel}
              onTold={tell}
            />
          ) : null}
          {/* The warps are a photograph's: a clip's Crop tab is the crop alone. */}
          {tab === 'crop' && !clip ? (
            <>
              <KeystonePanel value={keystoneDraft} onChange={setKeystoneDraft} auto={autoUprightVerb} />
              <LensPanel
                value={lensDraft}
                onChange={setLensDraft}
                profile={{
                  applied: entry.lensProfile,
                  inEffect: profileInEffect(entry.lensProfile, onSensor) !== null,
                  lookup,
                  looking: Boolean(shot) && !lookup,
                  allowed: lensfunOn,
                  onSensor,
                  candidate,
                  onApply: () => candidate && onLensProfile(candidate),
                  onRemove: () => onLensProfile(null),
                  onAllow: () => setLensfunAllowed(true),
                }}
              />
            </>
          ) : tab === 'export' ? (
            <ExportPanel
              settings={exportSettings}
              onSettings={onExportSettings}
              delivery={exports.openDelivery}
              clip={clip}
              plan={exports.plan}
              proxiesOnly={proxiesOnly}
              onProxiesOnly={onProxiesOnly}
              exporting={anyExporting}
              lockedSince={anyProgress?.startedAt ?? null}
              hdrRun={exports.lastRun?.hdr ?? null}
              pictures={deliveryTable}
              openExif={shotExif}
              picture={entry}
              onWords={onWords}
              makingOf={clip ? null : makingOfRow}
              onHdrPreview={clip ? null : () => setHdrPreviewOpen(true)}
            />
          ) : null}
          {/* Inside the drawer's own scroll on a phone, where `sticky` pins it. */}
          {compact && (tab === 'export' || anyProgress) && deliverBar(true)}
        </div>
        </FoldHints>
        {/* Docked: under the scrolling sections, as the tab strip is over them.
            A run in flight keeps it on EVERY tab: the roll leaves while a
            picture is worked on, and the bar is where that is seen. */}
        {!compact && (tab === 'export' || anyProgress) && deliverBar(false)}
      </PanelHost>

      {helpOpen && <DevelopShortcuts onClose={() => setHelpOpen(false)} />}
      {hdrPreviewOpen && !clip && (
        <HdrPreviewSheet title={pictureLabel(entry)} make={makeHdrPreview} stops={exportSettings.hdrStops} onClose={() => setHdrPreviewOpen(false)} />
      )}
      {timelapseOpen && onTimelapseOpen && !clip && (
        <TimelapseSheet
          picture={entry}
          chapters={chapters}
          // The bytes the stage draws — the rendition on screen — and the
          // sensor's where the picture is developed on it, with the camera's
          // calibration at the rung it stands on: the states grade exactly as
          // the stage and the export do.
          source={timelapseSource}
          cubes={cubes}
          options={exportSettings.timelapse}
          onOptions={(patch) => onExportSettings({ timelapse: { ...exportSettings.timelapse, ...patch } })}
          onMakingOf={(change) => onMakingOf?.(change)}
          plate={exposureSummary(shotExif) || null}
          credit={identity.creator ? `Developed in Atelier · © ${identity.creator}` : 'Developed in Atelier'}
          // Said before the click: a browser without an H.264 encoder cannot
          // make the file, and a button that fails afterwards is worse.
          verdict={avcEncode ? null : 'This browser cannot encode H.264 video, which the making-of needs — Chrome, Edge or Safari can.'}
          exportVerb={{
            label: 'Export the making-of',
            busy: anyProgress !== null,
            note: makingOf.note,
            run: (script, source) =>
              void makingOf.run({ script, source, refName: entry.ref.name, pictureId: entry.id, scope: taskScope }),
          }}
          onClose={() => onTimelapseOpen(false)}
        />
      )}
    </>
  );
}

/** The mask view's glyph: a dotted ring hidden, a dashed one for its outline, a disc for its fill. */
function MaskViewGlyph({ view }: { view: MaskView }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.5}>
      {view === 'fill' ? (
        <circle cx="8" cy="8" r="6" fill="currentColor" stroke="none" />
      ) : (
        <circle cx="8" cy="8" r="5.5" strokeDasharray={view === 'off' ? '1.5 2.5' : '3 2'} opacity={view === 'off' ? 0.6 : 1} />
      )}
    </svg>
  );
}
