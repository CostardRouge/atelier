import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAssetLibrary } from '../../shared/library/AssetLibraryContext';
import { useActiveAsset } from '../../shared/library/use-active-asset';
import type { AssetKind } from '../../shared/library/assets';
import { ASPECT_PRESETS } from '../../shared/projects/project-types';
import type { SavedMediaRef } from '../../shared/projects/project-types';
import { hashedMediaRef } from '../../shared/projects/media-identity';
import type { AssetDragItem, DroppedAsset, DropResult } from '../../shared/library/asset-drag';
import {
  collageCellAt,
  collageCellCount,
  collageSettleSeconds,
  swapCollageCells,
  withCollageCell,
  type CollageLead,
  type SlideCollage,
} from '../../shared/roadtrip/collage';
import { normaliseCellPlace } from '../../shared/media/media-layout';
import DevelopSheet from '../../shared/develop/DevelopSheet';
import type { DevelopApplyVerb } from '../../shared/develop/develop-host';
import type { DevelopSettings } from '../../shared/develop/develop';
import { pictureFidelity } from '../../shared/develop/picture-fidelity';
import { normaliseFraming, type Framing } from '../../shared/media/framing';
import { badgeContent, type BadgePiece } from '../../shared/roadtrip/day-badge';
import {
  applyDevelopToDay,
  applyDevelopToPost,
  countDayPictures,
  countPostPictures,
} from '../../shared/roadtrip/develop-apply';
import {
  badgeBlockExtent,
  badgeElements,
  pieceElementId,
  pieceFromElementId,
} from '../../shared/roadtrip/badge-layout';
import { countOwnGrades, pictureKeyOf } from '../../shared/roadtrip/post-grade';
import { hookVariantById, resolveHook } from '../../shared/roadtrip/hooks/registry';
import { setHookOptions, type HookContext } from '../../shared/roadtrip/hooks/hook-variant';
import { hookContextFor } from '../../shared/roadtrip/hooks/hook-context';
import { hookElementsAt as hookElementsAtFor } from '../../shared/roadtrip/hooks/hook-elements';
import useHookPictures from './use-hook-pictures';
import { useHookSound } from './use-hook-sound';
import { ctaLayout, ctaRoleFromElementId, type CtaRole } from '../../shared/roadtrip/cta-slide';
import {
  captionLineFromElementId,
  contentSlideElements,
  deckSlides,
  moveItem,
  type DeckSlide,
} from '../../shared/roadtrip/deck';
import {
  clipSlice,
  hookSecondsWithin,
  retimedScreenSeconds,
  screenSecondsOf,
} from '../../shared/roadtrip/hook-video';
import { badgeSettleSeconds } from '../../shared/roadtrip/badge-layout';
import { loopsOpenSlide, screenLength, type LoopScope } from '../../shared/roadtrip/deck-strip';
import { MIN_HOOK_SECONDS } from '../../shared/roadtrip/hook-video';
import { setEnd, setStart, TRIM_EPSILON, type TrimRange } from '../../shared/media/trim';
import { formatIsoDate } from '../../shared/roadtrip/trip-days';
import { describeKeyTarget, targetOwnsSpace, targetOwnsTyping } from '../../shared/media/transport-keys';
import { usePublishMediaScope, type MediaScope } from '../../shared/sources/media-scope';
import {
  createPostSlide,
  type PostBadge,
  type PostSlide,
  type TripDoc,
  type TripPost,
} from '../../shared/roadtrip/trip-types';
import { canvasThumbnail } from '../../shared/roadtrip/thumbnail';
import { putThumb } from '../../shared/roadtrip/trip-store';
import BadgeStage, { HOOK_ID } from './BadgeStage';
import type { CtaFieldRefs } from './CtaPanel';
import DeckStrip from './DeckStrip';
import CarGarageModal from './CarGarageModal';
import TripSettingsModal, { type TripSettingsSection } from './TripSettingsModal';
import ContentTab from './panels/ContentTab';
import ExportTab from './panels/ExportTab';
import LookTab from './panels/LookTab';
import PictureTab, { GradeScopeChips } from './panels/PictureTab';
import PiecePicker from './panels/PiecePicker';
import { useCollageRefetch } from './use-collage-refetch';
import { useDeckTransport } from './use-deck-transport';
import { usePostExports } from './use-post-exports';
import useRailThumbs from './use-rail-thumbs';
import { useExposureLine } from './use-exposure-line';
import { pickable, useSlideLibrary } from './use-slide-library';
import { useTripGrade } from './use-trip-grade';
import PageBar from '../../shared/ui/PageBar';
import { buttonClass } from '../../shared/ui/Button';
import IconButton from '../../shared/ui/IconButton';
import PanelHost from '../../shared/ui/PanelHost';
import { usePublishSectionBar } from '../../shared/ui/section-rail';
import { useIsCompact } from '../../shared/ui/use-layout-mode';
import { Icons } from '../../shared/ui/icons';
import Segmented from '../../shared/ui/Segmented';
import { useSurface } from '../../shared/ui/use-surface';
import { FieldRow } from '../../shared/ui/Inspector';

interface PostEditorProps {
  trip: TripDoc;
  post: TripPost;
  onBack: () => void;
  onChangePost: (post: TripPost) => void;
  onChangeTrip: (trip: TripDoc) => void;
  /** What the shell wants in the top bar — the sync pill of a remote trip. */
  headerExtra?: ReactNode;
}

/**
 * The inspector's tabs — Road Trip's own nouns, not the Studio's five. Tab
 * state is component state, not part of the route: the route says WHERE you
 * are (trip, day, piece), the tab says what you are looking at there.
 *
 * Four, on one row. Six wrapped onto two rows in a 22rem column, and two of
 * them were paying for themselves in very little: Grade was one scope switch
 * over the Studio's own panel, so it joined the Picture it treats, and the
 * Deck was a list of slides you could not see while working on them, so it
 * became the rail beside the stage. What was left of the Deck tab — the
 * closing card, the per-kind defaults — belongs to the TRIP, and went to the
 * trip's own settings sheet with the words.
 */
type PanelTab = 'content' | 'look' | 'picture' | 'export';

const TABS: Array<{ id: PanelTab; label: string }> = [
  { id: 'content', label: 'Content' },
  { id: 'look', label: 'Look' },
  { id: 'picture', label: 'Picture' },
  { id: 'export', label: 'Export' },
];

/** Pass as a module constant — a fresh array per render re-runs the projection. */
const MEDIA_KINDS: readonly AssetKind[] = ['photo', 'video+telemetry', 'video'];

const NO_SOURCE = { width: 0, height: 0, duration: 0 };

/** What the stage last decoded, and for which file — see `duration` below. */
interface LoadedSource {
  width: number;
  height: number;
  duration: number;
  file: File | null;
}

/** Shortest cut `I` / `O` may leave — the floor `clipSlice` keeps. */
const MIN_CUT = MIN_HOOK_SECONDS / 4;

/**
 * Composing one post's hook: the picture, the badge over it, and the PNG that
 * comes out.
 *
 * Two scopes, deliberately. The TRIP owns the look — the title style and the
 * words — because a badge that varies per post stops being the signature that
 * makes a post recognisable in a feed. The POST owns what is true of this one
 * piece: which day it counts, where the block sits, and any departure a
 * particular picture needs.
 *
 * The picture is whatever is active in the Library on the left, and the two
 * stay in step: opening a post points the Library at its picture, and picking
 * another one there re-points the post.
 */
export default function PostEditor({
  trip,
  post,
  onBack,
  onChangePost,
  onChangeTrip,
  headerExtra,
}: PostEditorProps) {
  // A grading screen sits in the darkroom: neutral grey, so the eye does not
  // adapt to warm paper and misjudge the frame (`use-surface.ts`).
  useSurface('darkroom');
  const lib = useAssetLibrary();
  const { active } = useActiveAsset(MEDIA_KINDS);
  const [srcInfo, setSrcInfo] = useState<LoadedSource>({ ...NO_SOURCE, file: null });
  const [selected, setSelected] = useState(0);
  const [piece, setPiece] = useState<BadgePiece>('kicker');
  const [tab, setTab] = useState<PanelTab>('content');
  // On a phone the inspector is a sheet and its four tabs are the shell's
  // bottom bar, so picking a section is also what raises the panel. It opens
  // closed: the badge on its picture is what you came to look at.
  const compact = useIsCompact();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  // The shell draws them, from the SAME `TABS` the docked strip renders from.
  usePublishSectionBar(
    useMemo(
      () =>
        compact
          ? {
              sections: TABS,
              // Marked only while the panel it opens is UP. A cell left
              // marked after the sheet was dismissed says the screen is
              // somewhere it is not — the maintainer's report, from a bar
              // still showing PICTURE over a closed inspector.
              active: inspectorOpen ? tab : null,
              label: 'Piece inspector',
              onSelect: (id: string) => {
                setTab(id as PanelTab);
                setInspectorOpen(true);
              },
            }
          : null,
      [compact, tab, inspectorOpen],
    ),
  );
  /** The trip-wide sheet, and which of its sections was asked for. */
  const [tripSheet, setTripSheet] = useState<TripSettingsSection | null>(null);
  /** The garage, opened from the opener that drives the trip's car. */
  const [garageOpen, setGarageOpen] = useState(false);

  const activeFile = active ? pickable(active) : null;

  // Tell the shell which day(s) this piece tells, so the Library's Winnow tab
  // can list them without a date being picked by hand. A post is keyed by
  // its day, so the day IS the query (roadtrip.md); a multi-day post is its
  // span. Taken back on unmount by the hook.
  const mediaScope = useMemo<MediaScope>(
    () => ({
      from: post.date,
      to: post.endDate ?? post.date,
      label: post.endDate
        ? `${formatIsoDate(post.date)} → ${formatIsoDate(post.endDate)}`
        : formatIsoDate(post.date),
      publisher: 'Trips',
      // A slide is waiting for a picture: a click should put one on it.
      intent: 'pick',
      // The trip around it, shaded in the Library's month.
      within: { from: trip.startDate, to: trip.endDate, label: trip.name },
    }),
    [post.date, post.endDate, trip.startDate, trip.endDate, trip.name],
  );
  usePublishMediaScope(mediaScope);

  // --- the deck: the hook, any content pictures, and the closing card ------
  const slides = useMemo(() => deckSlides(trip, post), [trip, post]);
  const slideIndex = Math.min(selected, slides.length - 1);
  const slide = slides[slideIndex];
  const isHook = slide.kind === 'hook';
  const isCta = slide.kind === 'cta';
  /**
   * Which picture of the piece the panels treat: the key the develop verbs
   * and the grade chain both address a picture by (`post-grade.ts`). The
   * closing card is `null` — it has no photograph to correct or to grade.
   */
  const picture = pictureKeyOf(slide);

  // --- the collage: several pictures in this slide's frame ----------------
  // Cell 0 is the slide itself (`collage.ts`); the inspector, the Library and
  // the develop sheet all follow the SELECTED cell, which is what lets one
  // Picture tab work a six-piece bento. The selection belongs to one slide.
  const collage = slide.kind === 'cta' ? null : slide.collage;
  const [selectedCell, setSelectedCellState] = useState(0);
  const cellCount = collage ? collageCellCount(collage) : 1;
  const cellIndex = collage ? Math.min(selectedCell, Math.max(0, cellCount - 1)) : 0;
  // What the Library had ticked when a cell was selected. An EMPTY cell must
  // not take that picture just for being looked at — the record-back below
  // would otherwise copy the lead into every cell the author steps through —
  // so the Library only writes into it once something ELSE is ticked; the
  // ticked picture itself goes in through "Use the ticked picture".
  const [cellBaseline, setCellBaseline] = useState<File | null>(null);
  const activeFileRef = useRef(activeFile);
  activeFileRef.current = activeFile;
  const setSelectedCell = useCallback((i: number) => {
    setSelectedCellState(Math.max(0, i));
    setCellBaseline(activeFileRef.current);
  }, []);
  const lead: CollageLead = useMemo(
    () => ({ media: slide.media, framing: slide.framing, develop: slide.develop }),
    [slide.media, slide.framing, slide.develop],
  );
  const cell = collage ? collageCellAt(lead, collage, cellIndex) : null;

  /**
   * Write the open slide's lead and collage in one go — the hook's live on
   * the badge, a carousel picture's on its slide, the split every per-picture
   * field already makes.
   */
  const writeLead = useCallback(
    (next: { lead: CollageLead; collage: SlideCollage | null }) => {
      const fields = {
        media: next.lead.media,
        framing: next.lead.framing,
        develop: next.lead.develop,
        collage: next.collage,
      };
      if (slide.kind === 'hook') {
        onChangePost({ ...post, media: fields.media, badge: { ...post.badge, ...fields } });
      } else if (slide.slideId) {
        onChangePost({
          ...post,
          slides: post.slides.map((s) => (s.id === slide.slideId ? { ...s, ...fields } : s)),
        });
      }
    },
    [slide, post, onChangePost],
  );
  const setCollage = useCallback(
    (next: SlideCollage | null) => writeLead({ lead, collage: next }),
    [writeLead, lead],
  );
  /** Write one field of the SELECTED cell (the lead when it is cell 0). */
  const patchCell = useCallback(
    (i: number, patch: Parameters<typeof withCollageCell>[3]) => {
      if (!collage) {
        // No collage: cell 0 is the slide, written the way it always was.
        writeLead({
          lead: {
            media: patch.media !== undefined ? patch.media : lead.media,
            framing: patch.framing ?? lead.framing,
            develop: patch.develop !== undefined ? patch.develop : lead.develop,
          },
          collage: null,
        });
        return;
      }
      writeLead(withCollageCell(lead, collage, i, patch));
    },
    [collage, lead, writeLead],
  );
  /**
   * A picture dragged out of the Library onto a cell — the sidebar says WHICH
   * picture, the stage says WHERE. It selects that cell as well as filling it:
   * a drop is also a way of saying "this is the one I am working on", and it
   * keeps the Library's own tick pointing at what the cell now holds.
   */
  //
  // The picture may take seconds to arrive (a tile an instance still holds is
  // fetched on drop), and the piece keeps changing meanwhile: the write goes
  // through the LATEST `patchCell` and `lib`, never the ones this drop began
  // with, or it would put back a document the author has already edited.
  const patchCellRef = useRef(patchCell);
  patchCellRef.current = patchCell;
  const libRef = useRef(lib);
  libRef.current = lib;
  const dropAsset = useCallback(
    async (i: number, item: AssetDragItem): Promise<DropResult> => {
      let got: DroppedAsset | null = null;
      try {
        got = await item.resolve();
      } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : String(err) };
      }
      if (!got) {
        return {
          ok: false,
          reason:
            item.origin === 'instance'
              ? `${item.sourceLabel ?? 'The instance'} did not hand it over — see the Library`
              : 'Nothing to compose over in that file',
        };
      }
      // WRITE FIRST, select after. Selecting a cell restarts the Library sync
      // for it, and that sync re-activates whatever the cell holds — so a
      // cell selected before the write was re-pointed at its OLD picture, and
      // the sync then wrote the old picture back over the drop (measured: a
      // drop on an occupied, unselected cell silently did nothing).
      const ref = await hashedMediaRef(got.file);
      patchCellRef.current(i, { media: ref });
      setSelectedCell(i);
      // Ticked (idempotent — a fetched tile is ticked already) and active, so
      // the Library shows what the cell now holds.
      libRef.current.select([got.assetId], true);
      libRef.current.setActive(got.assetId);
      return { ok: true };
    },
    [setSelectedCell],
  );

  const swapCells = useCallback(
    (a: number, b: number) => {
      if (collage) writeLead(swapCollageCells(lead, collage, a, b));
    },
    [collage, lead, writeLead],
  );
  const moveCell = useCallback(
    (i: number, dx: number, dy: number) => {
      if (!collage) return;
      const from = collageCellAt(lead, collage, i).place;
      const place = normaliseCellPlace({ ...from, dx: from.dx + dx, dy: from.dy + dy });
      patchCell(i, { place });
    },
    [collage, lead, patchCell],
  );

  /** Write a picture to the SELECTED cell of whichever slide is open. */
  const setSlideMedia = useCallback(
    (ref: SavedMediaRef | null) => patchCell(cellIndex, { media: ref }),
    [patchCell, cellIndex],
  );
  /**
   * What the Library follows: the selected cell, wearing the slide's key
   * plus its own index so stepping between cells re-points the Library the
   * way stepping between slides does.
   */
  const librarySlide = useMemo<DeckSlide>(
    () =>
      collage && cellIndex > 0
        ? { ...slide, media: cell?.media ?? null, slideId: `${slide.slideId ?? slide.kind}#${cellIndex}` }
        : slide,
    [slide, collage, cellIndex, cell?.media],
  );

  // A collage's OTHER cells: the Library sync below only follows the selected
  // one, so every drawn cell's instance-held picture is fetched back here,
  // once per opening, without touching the active asset or the selection.
  const collageRefs = useMemo(
    () => (collage ? Array.from({ length: cellCount }, (_, i) => collageCellAt(lead, collage, i).media) : []),
    [collage, cellCount, lead],
  );
  const collageFetch = useCollageRefetch(slide.slideId ?? slide.kind, collageRefs, lib.assets, lib.addFiles);

  // The Library and the open slide point at the same picture, both ways —
  // and a picture the pool lost to a reload is fetched back from the instance
  // that holds it, rather than reported missing.
  const libraryRecovery = useSlideLibrary(
    librarySlide,
    lib.assets,
    lib.setActive,
    collage && cellIndex > 0 && !cell?.media && activeFile === cellBaseline ? null : activeFile,
    setSlideMedia,
    lib.addFiles,
    collageFetch.elsewhereFor(librarySlide.media),
  );
  const recovery = libraryRecovery ?? (collage ? collageFetch.recoveryOf(librarySlide.media) : null);

  /**
   * A picture fetched from the day strip: into the pool, then made active —
   * from there the ordinary Library ↔ slide machinery records it onto the
   * slide, so this adds no second path to a piece's picture.
   */
  const pickFromSource = useCallback(
    (files: File[], assetId: string) => {
      lib.addFiles(files);
      lib.setActive(assetId);
    },
    [lib],
  );

  /** A stored ref's file in the Library, by name, or null when it is not loaded. */
  const resolve = useCallback(
    (ref: { name: string } | null) => {
      if (!ref) return null;
      const want = ref.name.toLowerCase();
      for (const asset of lib.assets) {
        const f = pickable(asset);
        if (f && f.name.toLowerCase() === want) return f;
      }
      return null;
    },
    [lib.assets],
  );

  // The stage's `file` is the LEAD's. Without a collage that is what the
  // Library has ticked; with one, the Library follows the selected cell, so
  // the lead is resolved from its own ref.
  const slideFile = isCta ? null : collage ? resolve(slide.media) : activeFile;
  const missing =
    !isCta && (collage ? (cell?.media ?? null) : slide.media) !== null && activeFile === null;
  /** Every drawn cell's file, the lead first — for the stage and the labels. */
  const cellFiles = useMemo(
    () =>
      collage
        ? Array.from({ length: cellCount }, (_, i) => resolve(collageCellAt(lead, collage, i).media))
        : [slideFile],
    [collage, cellCount, lead, resolve, slideFile],
  );
  const cellFile = cellFiles[cellIndex] ?? null;
  /** What each cell holds, by name — what a drop target says it will replace. */
  const cellLabels = useMemo(
    () => cellFiles.map((f) => (f ? f.name.replace(/\.[^.]+$/, '') : null)),
    [cellFiles],
  );
  // The selection is one slide's: a new slide starts on its lead.
  const slideKeyForCell = slide.slideId ?? slide.kind;
  useEffect(() => setSelectedCellState(0), [slideKeyForCell]);
  const isVideo = Boolean(slideFile && !slideFile.type.startsWith('image/'));
  // The stage's numbers are only this slide's once they describe THIS file:
  // while the piece plays from a clip into another, the last clip's duration
  // would otherwise cut the next one with a stretch it does not have.
  const sourceReady = srcInfo.file === slideFile;
  const duration = sourceReady ? srcInfo.duration : 0;

  // --- the hook's own picture, whichever slide is open ---------------------
  // The stage reports the OPEN slide's source; the hook clip export, the
  // camera credit and the Studio bridge are about the piece and must work
  // from a carousel's second slide too, so the hook's file and dimensions are
  // kept apart. `resolve` itself sits above, beside the collage's cells, which
  // need it first.
  const hookFile = isHook ? slideFile : resolve(post.media);
  const hookIsVideo = Boolean(hookFile && !hookFile.type.startsWith('image/'));

  /**
   * What took the hook's picture, read from the picture itself — the badge's
   * camera credit, and the line the Content tab shows beside its toggle so a
   * piece whose photograph says nothing says why rather than drawing a blank.
   */
  const exposure = useExposureLine(hookFile);

  const aspectPreset =
    ASPECT_PRESETS.find((a) => a.id === post.badge.aspectId) ?? ASPECT_PRESETS[0];
  const aspect = aspectPreset.w / aspectPreset.h;

  const content = useMemo(
    () =>
      badgeContent(trip, post, {
        mode: post.badge.mode,
        words: trip.badgeWords,
        timeAgo: post.badge.timeAgo,
        referenceDate: post.badge.referenceDate,
        showPin: post.badge.showPin,
        showExif: post.badge.showExif,
        exposure,
        overrides: post.badge.textOverrides,
      }),
    [trip, post, exposure],
  );

  const cta = useMemo(() => ctaLayout(trip.cta, aspect), [trip.cta, aspect]);

  const hookElements = useMemo(
    () =>
      content
        ? badgeElements(
            content,
            post.badge.layout,
            aspect,
            post.badge.pieceStyles,
            post.badge.durationSeconds,
            post.badge.cascade,
          )
        : [],
    [
      content,
      post.badge.layout,
      post.badge.pieceStyles,
      post.badge.durationSeconds,
      post.badge.cascade,
      aspect,
    ],
  );

  const elements = useMemo(() => {
    if (isHook) return hookElements;
    if (isCta) return cta.elements;
    return contentSlideElements(slide.caption, aspect);
  }, [isHook, isCta, hookElements, cta.elements, slide.caption, aspect]);

  const block = useMemo(
    () => (content ? badgeBlockExtent(content, post.badge.layout, aspect) : null),
    [content, post.badge.layout, aspect],
  );

  // What every hook variant is prepared against — built by the one function
  // the deck, the rail and the exports use too — and what the picker hands to a
  // variant's options panel, so a control there can say a real value. The
  // pictures an opener asked for are decoded apart and joined in after.
  const baseHookCtx = useMemo<HookContext>(
    () => hookContextFor(trip, post, aspect, content),
    [trip, post, aspect, content],
  );
  // The grade is bound here, before the opener's pictures: a flashed picture
  // wears the HOOK's grade (without any one slide's develop), so a sweep and
  // the picture it lands on read as one look — which is now a chain, since a
  // picture of the deck may carry a look of its own (`post-grade.ts`).
  const grade = useTripGrade(trip, post, picture, onChangeTrip, onChangePost);
  const flashLut = grade.lutFor({ ...slides[0], develop: null });
  const { pictures: hookPictures, status: hookPictureStatus } = useHookPictures(
    post.badge.hook,
    baseHookCtx,
    lib.assets,
    flashLut,
  );
  const hookCtx = useMemo<HookContext>(
    () => ({ ...baseHookCtx, pictures: hookPictures }),
    [baseHookCtx, hookPictures],
  );

  // The piece's opener, prepared once per change of what it reads — never per
  // frame: the transport's clock reaches it at PAINT time, inside the stage.
  const hook = useMemo(
    () => resolveHook(post.badge.hook, hookCtx),
    [post.badge.hook, hookCtx],
  );
  /**
   * The opener as CONTENT on the stage: where its drawing sits, and what a
   * drag of it writes. Both come from the variant (`frameBox` / `moveBy`),
   * so an opener that does not offer them simply is not grabbable — the
   * badge does not; Défilé offers its tape, the Itinerary its map.
   */
  const hookVariant = hookVariantById(post.badge.hook[0]?.id ?? '');
  const hookOptions = post.badge.hook[0]?.options ?? {};
  const hookRectFor = useMemo(
    () =>
      hookVariant?.frameBox
        ? (frame: { width: number; height: number }) =>
            hookVariant.frameBox?.(hookOptions, hookCtx, frame) ?? null
        : null,
    [hookVariant, hookOptions, hookCtx],
  );
  const moveHook = (dx: number, dy: number) => {
    if (!hookVariant?.moveBy) return;
    patchBadge({ hook: setHookOptions(post.badge.hook, hookVariant.moveBy(hookOptions, dx, dy)) });
  };

  // Only an opener that rewrites the badge's words gets elements per frame;
  // every other piece keeps the ones built above, once per edit.
  const hookElementsAt = useMemo(
    () =>
      hookElementsAtFor(
        hook,
        content,
        post.badge.layout,
        aspect,
        post.badge.pieceStyles,
        post.badge.durationSeconds,
      ),
    [hook, content, post.badge.layout, aspect, post.badge.pieceStyles, post.badge.durationSeconds],
  );

  const patchBadge = useCallback(
    (patch: Partial<PostBadge>) =>
      onChangePost({ ...post, badge: { ...post.badge, ...patch } }),
    [post, onChangePost],
  );

  /**
   * Where the OPEN slide's picture sits. The hook's lives on the badge beside
   * its frame choice, a carousel picture's on the slide — the same split
   * `videoTimeSeconds` already makes, because both are about one photograph
   * rather than about the piece.
   */
  const setFraming = useCallback(
    (framing: Framing) => {
      if (slide.kind === 'hook') {
        onChangePost({ ...post, badge: { ...post.badge, framing } });
      } else if (slide.slideId) {
        onChangePost({
          ...post,
          slides: post.slides.map((s) =>
            s.id === slide.slideId ? { ...s, framing } : s,
          ),
        });
      }
    },
    [slide, post, onChangePost],
  );
  /** The SELECTED cell's framing — the slide's own when it is cell 0. */
  const cellFraming = normaliseFraming(cell ? cell.framing : slide.framing);
  const setCellFraming = useCallback(
    (i: number, framing: Framing) => patchCell(i, { framing }),
    [patchCell],
  );
  const setSelectedCellFraming = useCallback(
    (framing: Framing) => patchCell(cellIndex, { framing }),
    [patchCell, cellIndex],
  );

  const patchSlide = (patch: Partial<PostSlide>) => {
    if (!slide.slideId) return;
    onChangePost({
      ...post,
      slides: post.slides.map((s) => (s.id === slide.slideId ? { ...s, ...patch } : s)),
    });
  };

  /**
   * The OPEN slide's own correction — the hook's on the badge, a carousel
   * picture's on its slide, the same split as the framing, and for the same
   * reason: it is about one photograph. Null is as shot.
   */
  const setDevelop = useCallback(
    (develop: DevelopSettings | null) => patchCell(cellIndex, { develop }),
    [patchCell, cellIndex],
  );
  /** The SELECTED cell's own correction. */
  const cellDevelop = cell ? cell.develop : slide.develop;
  const [developOpen, setDevelopOpen] = useState(false);
  // The sheet's time-savers (`docs/photo-develop.md` §8): the presets are the
  // person's own book, drawn by the sheet itself; the trip adds two batch verbs that write a COPY onto each target now — the open
  // slide is left to Done, which is what `picture` keeps out of the count (the
  // key naming the open picture, the same one the grade chain addresses).
  const otherSlides = isCta ? 0 : countPostPictures(post, picture);
  const otherPieces = countDayPictures(trip, post);
  const developApplyTo = useMemo(() => {
    const verbs: DevelopApplyVerb[] = [];
    if (otherSlides > 0) {
      verbs.push({
        id: 'slides',
        label: `Apply to ${otherSlides} other slide${otherSlides === 1 ? '' : 's'}`,
        hint: 'the other pictures of this piece',
        run: (settings: DevelopSettings) =>
          onChangePost(applyDevelopToPost(post, settings, picture)),
      });
    }
    if (otherPieces > 0) {
      verbs.push({
        id: 'day',
        label: `Apply to ${otherPieces} picture${otherPieces === 1 ? '' : 's'} of this day`,
        hint: `the other pieces telling ${formatIsoDate(post.date)}`,
        run: (settings: DevelopSettings) =>
          onChangeTrip({ ...applyDevelopToDay(trip, post, settings), updatedAt: Date.now() }),
      });
    }
    return verbs;
  }, [otherSlides, otherPieces, post, trip, picture, onChangePost, onChangeTrip]);

  async function addSlide() {
    const ref = activeFile ? await hashedMediaRef(activeFile) : null;
    onChangePost({ ...post, slides: [...post.slides, createPostSlide(ref)] });
    // Land on what was just added, which is where the author is looking.
    setSelected(post.slides.length + 1);
  }

  function removeSlide() {
    if (!slide.slideId) return;
    onChangePost({
      ...post,
      slides: post.slides.filter((s) => s.id !== slide.slideId),
    });
    setSelected(Math.max(0, slideIndex - 1));
  }

  function moveSlideTo(from: number, to: number) {
    if (to < 0 || to >= post.slides.length || from === to) return;
    onChangePost({ ...post, slides: moveItem(post.slides, from, to) });
    // Follow the slide that moved, so the stage keeps showing what was dragged.
    setSelected(to + 1);
  }

  // --- the clip under the open slide: its stretch, its playhead ------------
  // A slide whose picture is a clip PLAYS on the stage, from its in point to
  // its out point at its speed — the stretch the file will hold, nothing
  // else. The stretch is derived from the slide's in point, screen time and
  // speed (`clipSlice`), never stored a second time; the playhead is session
  // state, reset to the in point whenever another slide or picture opens.
  const isClipSlide = isVideo && duration > 0;
  const slideKey = slide.slideId ?? slide.kind;
  const clipRange = useMemo<TrimRange>(
    () => clipSlice(slide.videoTimeSeconds, slide.seconds, slide.speed, duration),
    [slide.videoTimeSeconds, slide.seconds, slide.speed, duration],
  );
  const [playhead, setPlayhead] = useState(slide.videoTimeSeconds);
  // The clip's OWN playback, used while its cut is open on the band (it
  // loops there); the piece's playback is the deck transport's, below.
  const [clipPlaying, setClipPlaying] = useState(false);
  // Scrubs arrive per pointer event; the stage can only seek once a frame.
  const scrubRaf = useRef(0);
  const scrubTo = useRef(0);
  const seekPlayhead = useCallback((t: number) => {
    scrubTo.current = t;
    if (scrubRaf.current) return;
    scrubRaf.current = requestAnimationFrame(() => {
      scrubRaf.current = 0;
      setPlayhead(scrubTo.current);
    });
  }, []);
  useEffect(() => () => cancelAnimationFrame(scrubRaf.current), []);

  /** A cut on the bar: the in point and the screen time are what it writes. */
  const setClipRange = useCallback(
    (range: TrimRange) => {
      const seconds = screenSecondsOf(range, slide.speed);
      if (slide.kind === 'hook') {
        patchBadge({ videoTimeSeconds: range.start, hookSeconds: seconds });
      } else if (slide.slideId) {
        onChangePost({
          ...post,
          slides: post.slides.map((s) =>
            s.id === slide.slideId
              ? { ...s, videoTimeSeconds: range.start, seconds }
              : s,
          ),
        });
      }
    },
    [slide, post, patchBadge, onChangePost],
  );

  /**
   * A new speed keeps the footage and moves the screen time. The footage is
   * read from the stretch the stage really shows — clamped to the clip —
   * rather than from the stored screen time, so a hook still carrying the 5s
   * default over a 3s clip lands on the 1.5s it can deliver at 2×, not 2.5.
   */
  const setClipSpeed = useCallback(
    (speed: number) => {
      const seconds = retimedScreenSeconds(
        screenSecondsOf(clipRange, slide.speed),
        slide.speed,
        speed,
      );
      if (slide.kind === 'hook') {
        patchBadge({ videoSpeed: speed, hookSeconds: seconds });
      } else if (slide.slideId) {
        onChangePost({
          ...post,
          slides: post.slides.map((s) =>
            s.id === slide.slideId ? { ...s, videoSpeed: speed, seconds } : s,
          ),
        });
      }
    },
    [slide, clipRange, post, patchBadge, onChangePost],
  );

  // --- the piece's transport: every slide, one after the other --------------
  // The band under the picture (`DeckStrip`) slides the whole piece under a
  // fixed needle, and ▶ plays it slide after slide on this one stage. Each
  // slide holds the screen for what it really delivers — a clip its cut, a
  // still the seconds its inspector gives it — and the durations of clips the
  // stage has already decoded are remembered, so a stored 5s over a 3s clip
  // reads 3 on the band before that slide is opened again.
  const [clipDurations, setClipDurations] = useState<Record<string, number>>({});
  const lengths = useMemo(
    () =>
      slides.map((s) =>
        screenLength(s, s.media ? (clipDurations[s.media.name.toLowerCase()] ?? 0) : 0),
      ),
    [slides, clipDurations],
  );
  const slideKeys = useMemo(() => slides.map((s) => s.slideId ?? s.kind), [slides]);
  // Playback always loops; this says over what — the whole piece, or the slide
  // under the needle. The band's pill and `L` switch it.
  const [loopScope, setLoopScope] = useState<LoopScope>('piece');
  const deck = useDeckTransport({
    lengths,
    keys: slideKeys,
    index: slideIndex,
    select: setSelected,
    clip: isClipSlide
      ? { start: clipRange.start, speed: slide.speed, playhead, seek: seekPlayhead }
      : null,
    pending: Boolean(slideFile) && !sourceReady,
    scope: loopScope,
  });

  // The cut, opened on the band. It belongs to one clip: another slide, or a
  // picture that is not a clip, closes it.
  const [trimming, setTrimming] = useState(false);
  const trimOpen = trimming && isClipSlide;
  useEffect(() => {
    setTrimming(false);
  }, [slideKey]);
  const stagePlaying = trimOpen ? clipPlaying : deck.playing;
  const togglePlay = trimOpen ? () => setClipPlaying((p) => !p) : deck.toggle;

  // A new slide or a newly decoded file puts the playhead where the band sent
  // it (its in point, unless a scrub landed inside the clip); an in point
  // moved by the cut puts it on the new in point.
  const lastOpened = useRef<{ key: string; file: File | null } | null>(null);
  useEffect(() => {
    const moved = lastOpened.current?.key !== slideKey || lastOpened.current?.file !== slideFile;
    lastOpened.current = { key: slideKey, file: slideFile };
    setPlayhead(slide.videoTimeSeconds + (moved ? deck.pendingLocal(slideKey) * slide.speed : 0));
    setClipPlaying(false);
    // `deck.pendingLocal` is stable; the in point and the speed are read as of this change.
  }, [slideKey, slideFile, slide.videoTimeSeconds]);

  // The badge's clock. On a CLIP the clip is the clock: the badge's time is
  // how far into the delivered stretch the playhead is, at the slide's speed —
  // exactly what the export draws, and exactly the clock `export-variant.ts`
  // hands a hook variant's own paint under `overlayClock: 'delivered'`. On a
  // photograph it is how far the piece's transport is into the slide. Either
  // way, AT REST on the slide's first moment the badge draws settled: that is
  // the composition every other surface (the band, the PNG) shows, and the one
  // a piece opens on — an opener that moves with no animated piece (a scrub)
  // settles past its own length.
  const settle = badgeSettleSeconds(post.badge.pieceStyles, post.badge.cascade);
  const clipAtRest = !stagePlaying && playhead <= clipRange.start + TRIM_EPSILON;
  const stillAtRest = !deck.playing && deck.local <= TRIM_EPSILON;
  const composedView = isClipSlide ? clipAtRest : stillAtRest;
  // A collage's cells have an entrance of their own on ANY slide, so a content
  // slide has a clock too: at rest it shows the cells settled, playing it
  // shows them arriving and leaving on the piece's transport.
  const collageSettle = collageSettleSeconds(collage, aspect);
  const badgeTime = !isHook
    ? stillAtRest
      ? collageSettle
      : deck.local
    : isClipSlide
      ? clipAtRest
        ? Math.max(settle, collageSettle)
        : Math.max(0, (playhead - clipRange.start) / slide.speed)
      : stillAtRest
        ? Math.max(settle, hook.seconds, collageSettle)
        : deck.local;

  // The opener's ticks, heard while whichever transport is actually driving
  // the badge plays — a clip's own, or the photo transport above — off until
  // asked for. `badgeTime` already reads whichever clock applies.
  const hookScore = useMemo(() => hook.score(), [hook]);
  const [soundOn, setSoundOn] = useState(false);
  useHookSound(hookScore, isHook && stagePlaying, badgeTime, soundOn);

  // Space plays — the piece, or the cut while it is open — and `I` / `O` cut
  // the open clip at the playhead (Shift: back to the clip's own ends), the
  // Studio's reflexes. On `window`, like every transport in the suite, and
  // read through a ref so the listener is bound once.
  const keys = useRef({ togglePlay, isClipSlide, clipRange, playhead, duration, setClipRange });
  keys.current = { togglePlay, isClipSlide, clipRange, playhead, duration, setClipRange };
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = describeKeyTarget(e.target);
      const k = keys.current;
      if (e.code === 'Space' || e.key === ' ') {
        if (e.repeat || e.shiftKey || targetOwnsSpace(target)) return;
        e.preventDefault();
        k.togglePlay();
        return;
      }
      // A letter needs the NARROWER guard: a button does not own `i`.
      if (!k.isClipSlide || targetOwnsTyping(target)) return;
      const key = e.key.toLowerCase();
      if (key === 'i') {
        e.preventDefault();
        k.setClipRange(setStart(k.clipRange, e.shiftKey ? 0 : k.playhead, k.duration, MIN_CUT));
      } else if (key === 'o') {
        e.preventDefault();
        k.setClipRange(setEnd(k.clipRange, e.shiftKey ? k.duration : k.playhead, k.duration, MIN_CUT));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // `L` switches what playback loops over — the piece or the open slide —
  // never while typing, and not while the cut is open (it loops its stretch).
  const trimOpenRef = useRef(trimOpen);
  trimOpenRef.current = trimOpen;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || e.key.toLowerCase() !== 'l') return;
      if (trimOpenRef.current || targetOwnsTyping(describeKeyTarget(e.target))) return;
      e.preventDefault();
      setLoopScope((s) => (s === 'piece' ? 'slide' : 'piece'));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // `M` mutes the opener's ticks, the reflex every other player answers to —
  // only where there is something to mute, and never while typing.
  useEffect(() => {
    if (hookScore.length === 0) return;
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.key.toLowerCase() !== 'm') return;
      if (targetOwnsTyping(describeKeyTarget(e.target))) return;
      e.preventDefault();
      setSoundOn((on) => !on);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hookScore.length]);

  /** Whether the Library holds a slide's picture — what the export plan reads. */
  const hasPicture = useCallback(
    (s: { media: SavedMediaRef | null }) => s.media === null || resolve(s.media) !== null,
    [resolve],
  );

  const [hookInfo, setHookInfo] = useState(NO_SOURCE);
  const onSourceLoaded = useCallback(
    (info: { width: number; height: number; duration: number }) => {
      // Called from the decode of the file this render hands the stage, so
      // `slideFile` here IS the file these numbers describe.
      setSrcInfo({ ...info, file: slideFile });
      if (isHook) setHookInfo(info);
      if (info.duration > 0 && slideFile) {
        const name = slideFile.name.toLowerCase();
        setClipDurations((known) =>
          known[name] === info.duration ? known : { ...known, [name]: info.duration },
        );
      }
    },
    [isHook, slideFile],
  );

  // How long the burned-in hook clip runs. It lives on the DOCUMENT since
  // 2026-09-09 (`badge.hookSeconds`): it was session state while a length was
  // only an export choice, and it stopped being only that when every slide
  // gained a screen time. Still clamped on read — a stored 8s over a 3s clip
  // must not claim a file it cannot write.
  const hookLength = hookSecondsWithin(
    post.badge.hookSeconds,
    post.badge.durationSeconds,
    hookInfo.duration,
    post.badge.videoTimeSeconds,
    post.badge.videoSpeed,
  );

  // A clip's in point must stay inside the clip: switching to a shorter video
  // would otherwise leave the badge pinned past the end and decode nothing.
  // Any slide, not only the hook — a carousel picture is re-pointed too.
  useEffect(() => {
    if (!isVideo || duration <= 0 || slide.videoTimeSeconds <= duration) return;
    if (slide.kind === 'hook') patchBadge({ videoTimeSeconds: 0 });
    else if (slide.slideId) {
      onChangePost({
        ...post,
        slides: post.slides.map((s) =>
          s.id === slide.slideId ? { ...s, videoTimeSeconds: 0 } : s,
        ),
      });
    }
  }, [isVideo, duration, slide, post, patchBadge, onChangePost]);

  // --- the grade: the Studio's stack, bound to the trip or to this piece ----
  // (bound above, beside the opener's pictures, which wear it too)
  // One cube per SLIDE: the grade that slide wears, baked with its own
  // develop (memoised, so untouched slides share one cube). The stage reads
  // the STORED develop even while the sheet is open — the sheet's draft rides
  // `stack.composed`, which only the sheet itself paints from.
  const lutFor = grade.lutFor;
  const filmFor = grade.filmFor;
  const lut = isCta ? null : lutFor(slide);
  // Each cell's cube: the slide's grade baked with THAT cell's develop, the
  // lead first — the same call the rail and the PNG deck make per cell.
  const collageLuts = useMemo(
    () =>
      collage
        ? Array.from({ length: cellCount }, (_, i) =>
            lutFor({ ...slide, develop: collageCellAt(lead, collage, i).develop }),
          )
        : undefined,
    [collage, cellCount, lead, lutFor, slide],
  );

  // Every cell of the rail, composed exactly as it will be delivered — the
  // crop, the caption, the badge, the grade. It needs the grade, so it sits
  // here rather than beside the deck above.
  const railThumb = useRailThumbs({
    trip,
    post,
    slides,
    aspect,
    resolve,
    lutFor,
    pictures: hookPictures,
    exposure,
  });

  const exports = usePostExports({
    trip,
    post,
    aspect,
    slideCount: slides.length,
    hookSlide: slides[0],
    // A still is taken SETTLED, never at the transport's time: a PNG caught
    // mid-entrance is a picture nobody composed. Only the still/PNG path
    // reads this — the video paths below drive their own per-frame clock
    // through `hook`/`hookElementsAt`, unrelated to this value.
    timeSeconds: settle,
    hook,
    hookPictures,
    exposure,
    hookElementsAt,
    resolve,
    hookFile,
    hookIsVideo,
    hookInfo,
    hookElements,
    block,
    hookLength,
    lutFor,
    filmFor,
    // The outcome is reported on the Export tab, so that is where to be.
    onStart: () => setTab('export'),
  });

  // --- the fields a click on the stage lands in -----------------------------
  const textFieldRef = useRef<HTMLInputElement>(null);
  const ctaHeadlineRef = useRef<HTMLInputElement>(null);
  const ctaBodyRef = useRef<HTMLTextAreaElement>(null);
  const ctaUrlRef = useRef<HTMLInputElement>(null);
  const ctaFieldRefs: CtaFieldRefs = {
    headline: ctaHeadlineRef,
    body: ctaBodyRef,
    url: ctaUrlRef,
  };

  // --- selection: the stage and the chips name the same thing --------------
  // `selectedId` is the outlined element (null = nothing outlined); `piece` is
  // the badge piece the Content and Style tabs edit, which survives a click
  // on the empty picture. Both come from `selectElement`, never set apart.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The width the picture takes from the height it is given — the stage
  // measures it and the column wears it as a cap, so the rail sits against
  // the picture instead of against the edge of the section.
  const [fitWidth, setFitWidth] = useState<number | null>(null);
  const [focusSeq, setFocusSeq] = useState(0);
  const focusTarget = useRef<'text' | CtaRole | null>(null);

  /**
   * Picking an element is a request to edit it, wherever the inspector
   * happens to be: its field lives on one tab, so that tab comes back with
   * the selection and the field takes focus. Everything that selects goes
   * through here — a stage click, a chip — or the tab stays put.
   */
  function selectElement(id: string | null) {
    setSelectedId(id);
    if (!id) return;
    if (id === HOOK_ID) {
      // The opener's panel is the first thing on the Look tab, and it has no
      // one field to focus — the whole panel IS what was selected.
      setTab('look');
      return;
    }
    const badgePiece = pieceFromElementId(id);
    if (badgePiece) {
      setPiece(badgePiece);
      setTab('content');
      focusTarget.current = 'text';
    } else if (captionLineFromElementId(id) !== null) {
      setTab('content');
      focusTarget.current = 'text';
    } else {
      const role = ctaRoleFromElementId(id)?.role;
      if (!role) return;
      // The closing card belongs to the whole trip, so it is edited in the
      // trip's own sheet rather than on a tab about this piece.
      setTripSheet('cta');
      focusTarget.current = role;
    }
    setFocusSeq((n) => n + 1);
  }

  const selectPiece = (next: BadgePiece) => selectElement(pieceElementId(next));

  /**
   * A tap on an element, as opposed to a drag of the block. On a phone the
   * inspector is a sheet, so picking an element has to RAISE it — otherwise
   * the tab the selection just switched to is behind a bottom-bar cell and
   * the tap reads as having done nothing. Only on release, and only when the
   * press never travelled: a sheet rising mid-drag would cover the picture
   * the block is being moved over.
   */
  function activateElement(id: string) {
    selectElement(id);
    // The closing card opens the trip's own sheet from `selectElement`; a
    // second panel over it would be two sheets deep on a phone.
    if (compact && !ctaRoleFromElementId(id)) setInspectorOpen(true);
  }

  // Keyed on the tab (and the sheet) as well as the request: the field only
  // exists once whatever holds it is mounted, and clicking the
  // already-selected piece from another tab changes no id.
  useEffect(() => {
    const target = focusTarget.current;
    if (!target) return;
    const field =
      target === 'text' ? textFieldRef.current : ctaFieldRefs[target]?.current ?? null;
    if (!field) return;
    focusTarget.current = null;
    field.focus({ preventScroll: true });
    field.scrollIntoView({ block: 'nearest' });
  }, [focusSeq, tab, tripSheet]);

  // A selection names an element of ONE slide; another slide has other ids.
  useEffect(() => {
    setSelectedId(null);
  }, [slideIndex]);

  const moveBlockTo = useCallback(
    (x: number, y: number) => patchBadge({ layout: { ...post.badge.layout, x, y } }),
    [patchBadge, post.badge.layout],
  );

  /**
   * Keep a small picture of the hook beside the trip, so a day opened months
   * later shows what is sitting in it rather than a file name. Debounced and
   * taken only from the hook — the stage redraws on every frame of the badge's
   * transport, and writing each one would be a write per animation frame.
   *
   * Never while the piece's picture is MISSING. A piece that names no picture
   * is a badge over nothing and is worth storing as it is; a piece that names
   * one the Library cannot resolve right now is drawing a placeholder, and
   * baking that black frame destroys the good thumbnail the trip already had.
   * Measured: opening a piece before its folder is loaded emptied its card.
   *
   * Read through a ref, and checked again when the timer fires: the picture
   * can go between the paint that scheduled the write and the write itself.
   */
  const thumbTimer = useRef<number | null>(null);
  const missingRef = useRef(missing);
  useEffect(() => {
    missingRef.current = missing;
  }, [missing]);
  // Settled means BOTH: not mid-sweep of a photo's own transport (a
  // thumbnail caught there would be ANOTHER day's picture standing for this
  // piece — in the gallery's cover and in every other piece's scrub that
  // flashes it) and, on a clip, not playing or away from its in point — the
  // thumbnail is the COMPOSITION, not whatever frame either transport
  // stopped on. `composedView` alone does not cover the photo case: it is
  // unconditionally true off a clip slide, transport included.
  const settledRef = useRef(composedView);
  useEffect(() => {
    settledRef.current = composedView;
  }, [composedView]);
  const captureThumb = useCallback(
    (canvas: HTMLCanvasElement) => {
      if (!isHook || missingRef.current || !settledRef.current) return;
      if (thumbTimer.current !== null) window.clearTimeout(thumbTimer.current);
      thumbTimer.current = window.setTimeout(() => {
        if (missingRef.current || !settledRef.current) return;
        void canvasThumbnail(canvas).then((blob) => {
          if (blob) void putThumb(post.id, blob);
        });
      }, 700);
    },
    [isHook, post.id],
  );
  useEffect(
    () => () => {
      if (thumbTimer.current !== null) window.clearTimeout(thumbTimer.current);
    },
    [],
  );


  const deckStrip = (
    <DeckStrip
      slides={slides}
      lengths={lengths}
      index={slideIndex}
      time={deck.time}
      playing={stagePlaying}
      aspect={aspect}
      thumbFor={railThumb}
      onTogglePlay={togglePlay}
      onScrub={deck.scrub}
      onSelect={(i) => deck.goTo(i, 0)}
      onAdd={() => void addSlide()}
      onRemove={removeSlide}
      onMove={moveSlideTo}
      includeCta={post.includeCta}
      onIncludeCta={(on) => onChangePost({ ...post, includeCta: on })}
      onEditClosingCard={() => setTripSheet('cta')}
      clip={
        isClipSlide
          ? {
              duration,
              range: clipRange,
              playhead,
              speed: slide.speed,
              onSpeed: setClipSpeed,
              onRangeChange: setClipRange,
              onSeek: seekPlayhead,
              onScrubStart: () => setClipPlaying(false),
            }
          : null
      }
      loopScope={loopScope}
      onLoopScope={setLoopScope}
      trimming={trimOpen}
      onTrimming={(on) => {
        deck.setPlaying(false);
        setClipPlaying(false);
        setTrimming(on);
      }}
      sound={
        isHook && hookScore.length > 0
          ? { on: soundOn, onToggle: () => setSoundOn((on) => !on) }
          : null
      }
      compact={compact}
    />
  );

  // The piece's ONE primary action, in the header where the maintainer looked
  // for it. It is not the duplicate removed in `5d11245`: the Export tab's
  // buttons are the per-format escapes FROM this one, which delivers the whole
  // deck in the formats the slides say they are.
  //
  // While it runs the button IS the progress: a fill sweeping left to right
  // over a number of fixed width. The sentence ("Encoding 2/3 · 42%…") goes to
  // the tooltip — as a label it changed length every percent and made the bar
  // jump. It is not `disabled` while it runs (that would fade the progress to
  // 45%); a second press is simply ignored.
  const exportRunning = exports.exporting !== null;
  const exportPercent = exports.progress === null ? null : Math.round(exports.progress * 100);
  const exportTitle = exportRunning
    ? `${exports.exporting} — every slide of this piece`
    : 'Export every slide of this piece, in the format it is';
  const exportFace = (
    <>
      <span className="inline-flex shrink-0 [&>svg]:w-[1.1em] [&>svg]:h-[1.1em]">{Icons.export}</span>
      {/* The bar's one word yields to a status pill that is speaking. */}
      <span className="tabular-nums group-has-[[data-speaks]]/bar:hidden">
        {exportRunning ? (exportPercent === null ? '…' : `${exportPercent} %`) : 'Export'}
      </span>
    </>
  );
  const exportButton = (
    <button
      type="button"
      onClick={() => {
        if (!exportRunning) void exports.exportPiece();
      }}
      aria-busy={exportRunning || undefined}
      aria-label={exportTitle}
      title={exportTitle}
      className={buttonClass(
        // `default` while running, not `primary` with overrides: two utilities
        // of one property are ordered by Tailwind, not by this string.
        exportRunning ? 'default' : 'primary',
        'md',
        'relative overflow-hidden min-w-[6.0625rem] group-has-[[data-speaks]]/bar:min-w-0 group-has-[[data-speaks]]/bar:w-[2.125rem] group-has-[[data-speaks]]/bar:px-0',
      )}
    >
      {exportFace}
      {exportRunning && (
        <span
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-center gap-1.5 bg-ink text-paper transition-[clip-path] duration-150 motion-reduce:transition-none"
          style={{ clipPath: `inset(0 ${100 - (exportPercent ?? 0)}% 0 0)` }}
        >
          {exportFace}
        </span>
      )}
    </button>
  );

  return (
    // Wide: a two-column grid — the stage spans both rows on the left and
    // takes the section's whole height, the piece's header sits atop the
    // inspector on the right, and the inspector's body scrolls by itself so
    // the badge stays in view while its controls are worked through. Nothing
    // sits above the picture: on a portrait frame height is what decides the
    // preview's size, and a header row over both columns cost it 60px.
    // Narrow (stacked): header, stage, inspector in a column, and the whole
    // page scrolls, because a panel with its own scrollbar inside a scrolling
    // page is a trap on a phone.
    // The `@container` is the section and the queried layout is its CHILD: a
    // container query only ever matches an ancestor, so classes like
    // `@min-[860px]:grid` on the container element itself never apply.
    <section className="@container flex-1 min-h-0 flex flex-col" aria-label="Hook">
    <div
      className={`flex-1 min-h-0 flex flex-col gap-4 ${
        // Stacked on a TABLET the inspector is still in this column, so the
        // column scrolls. Stacked on a phone it is a sheet, nothing here
        // outgrows the screen, and the stage flexes into whatever the docked
        // library leaves — a scroll container would hand it an indefinite
        // height again, which is the trap `frontend.md` names.
        compact ? '' : 'overflow-auto'
      } @min-[860px]:grid @min-[860px]:grid-cols-[minmax(0,1fr)_22rem] @min-[860px]:grid-rows-[auto_minmax(0,1fr)] @min-[860px]:gap-x-5 @min-[860px]:gap-y-3 @min-[860px]:overflow-hidden`}
    >
      <div className="flex flex-col gap-1 min-w-0 @min-[860px]:col-start-2 @min-[860px]:row-start-1">
        {/* ONE row, and one LINE (2026-09-16): this bar lives in the
            inspector's 352px column, and once undo/redo joined it the row
            asked ~430px and broke in two. So the cells that took width without
            saying anything went square — the way back is the chevron alone,
            the trip's settings a cog — the history is one joined control,
            and the bar says ONE word at most: "Export" at rest, a number
            while it runs, and nothing while the status pill is the one
            speaking (a conflict, a sign-in), when Export folds to its glyph
            in the same place. Exporting per format stays on the Export tab;
            this block is navigation, status and the piece's one action. */}
        <PageBar
          back={{ label: 'Overview', title: 'Back to the overview', onClick: onBack, iconOnly: true }}
          trailing={
            <>
              {headerExtra}
              {exportButton}
            </>
          }
        >
          {/* What is true of the WHOLE trip lives behind this, beside the way
              back to that trip — so the inspector below is about the piece
              and nothing else. */}
          <IconButton
            label="Trip settings"
            title="Trip settings — the words, the closing card, what a new piece starts from"
            onClick={() => setTripSheet('words')}
          >
            {Icons.settings}
          </IconButton>
        </PageBar>
        {/* Editable in place, like the Studio's project name: a piece is
            found again by what it is called, and having to go back to the
            day panel to rename it is the kind of friction that stops you
            naming things at all. */}
        <input
          value={post.title}
          onChange={(e) => onChangePost({ ...post, title: e.target.value })}
          placeholder="Untitled piece"
          aria-label="What this piece shows"
          className={`w-full leading-tight bg-transparent border-0 border-b border-transparent focus:border-line-strong focus:outline-none text-ink px-1 py-0.5 placeholder:text-faint placeholder:italic ${
            // Every pixel this takes is one the picture does not get, and on a
            // phone the picture is the whole screen's job.
            compact ? 'font-serif text-base' : 'font-serif text-xl'
          }`}
        />
        <p
          className={`m-0 px-1 font-mono text-muted ${
            compact ? 'text-2xs -mt-0.5' : 'text-2xs'
          }`}
        >
          {formatIsoDate(post.date)} · {post.kind}
        </p>
      </div>

      {/* The picture and, under it, the piece as ONE band (`DeckStrip`): the
          deck and its transport together, the same at every width — the
          maintainer's pick (2026-09-14) over a rail beside the picture, a
          transport and a timeline stacked under it. On a compact shell this
          column FLEXES, so the stage fills a screen whose height is fixed and
          the band keeps its own; stacked on a tablet the column scrolls. */}
      <div
        className={`min-w-0 flex flex-col gap-3 @min-[860px]:min-h-0 @min-[860px]:col-start-1 @min-[860px]:row-start-1 @min-[860px]:row-span-2 ${
          compact ? 'flex-1 min-h-0' : ''
        }`}
      >
        <div className="flex-1 min-h-0 flex flex-row items-stretch justify-center">
          <div
            style={{ '--fit': fitWidth === null ? '100%' : `${Math.round(fitWidth)}px` } as React.CSSProperties}
            /* `w-full` is load-bearing on a narrow screen: the row above
               centres its children, so this column used to take its width
               from the badge's own measured box — the stage then measured a
               box the picture had sized, which is how a preview ends up
               measuring its own output. The column states its width instead. */
            className="w-full flex-1 min-w-0 min-h-0 flex flex-col items-center @min-[860px]:max-w-[min(100%,var(--fit))]"
          >
          <BadgeStage
            file={slideFile}
            videoTimeSeconds={isClipSlide ? playhead : slide.videoTimeSeconds}
            playback={
              isClipSlide
                ? {
                    playing: stagePlaying,
                    rate: slide.speed,
                    range: clipRange,
                    // The cut loops while it is being made, and so does a clip
                    // that loops on its own (asked for, or the whole piece);
                    // otherwise the piece moves on when it ends.
                    loop: trimOpen || loopsOpenSlide(loopScope, slides.length),
                    key: slideKey,
                    onTime: setPlayhead,
                    onEnded: trimOpen ? () => setClipPlaying(false) : deck.onClipEnded,
                  }
                : null
            }
            aspect={aspect}
            elements={elements}
            theme={isCta ? null : trip.theme}
            timeSeconds={badgeTime}
            shades={isHook ? post.badge.shades : undefined}
            block={isHook ? block : null}
            hook={isHook ? hook : null}
            elementsAt={isHook ? hookElementsAt : null}
            background={isCta ? trip.cta.background : undefined}
            qr={
              isCta && cta.qr
                ? { ...cta.qr, dark: trip.cta.ink, light: trip.cta.background }
                : null
            }
            lut={lut}
            film={isCta ? null : filmFor(slide)}
            selectedId={selectedId}
            onSelect={selectElement}
            onActivate={activateElement}
            // Only the hook's block has somewhere to be written back to; a
            // caption and the closing card sit at fixed positions.
            blockAnchor={isHook ? post.badge.layout : null}
            onMoveBlock={isHook ? moveBlockTo : undefined}
            // The opener draws on the hook slide alone, so it can only be
            // pointed at there.
            hookRectFor={isHook ? hookRectFor : null}
            onMoveHook={isHook && hookVariant?.moveBy ? moveHook : undefined}
            framing={slide.framing}
            // The closing card carries no photograph, so there is nothing to
            // reframe there and a drag must not pretend otherwise.
            onFraming={isCta ? undefined : setFraming}
            collage={collage}
            collageFiles={cellFiles}
            collageLuts={collageLuts}
            collageSeconds={slide.seconds}
            selectedCell={cellIndex}
            onSelectCell={setSelectedCell}
            onCellFraming={setCellFraming}
            onMoveCell={moveCell}
            onSwapCells={swapCells}
            onDropAsset={isCta ? undefined : dropAsset}
            cellLabels={cellLabels}
            onSourceLoaded={onSourceLoaded}
            onRendered={captureThumb}
            onFit={setFitWidth}
          />
          {compact && <div className="w-full flex-none mt-2">{deckStrip}</div>}
          </div>
        </div>
        {/* Wide, the band spans the picture's side of the editor. On a phone
            it sits in the stage's column instead, directly under the picture:
            the stage there is an aspect box, and the slack of a tall screen
            falls below the pair rather than between the frame and the band
            that drives it (`frontend.md`, «A stage that FLEXES»). */}
        {!compact && (
          <div className="w-full flex-none @min-[860px]:max-w-[52rem] @min-[860px]:self-center">
            {deckStrip}
          </div>
        )}
      </div>

      <PanelHost
        asSheet={compact}
        open={inspectorOpen}
        onClose={() => setInspectorOpen(false)}
        title={TABS.find((t) => t.id === tab)?.label ?? 'Piece'}
        // The Studio inspector's frame: one rounded paper box holding the tab
        // strip and the sections, so the two editors read as one suite. The
        // header above it (Overview, Trip, Export, the name) stays outside.
        className="w-full min-w-0 flex flex-col gap-3 border border-line rounded-paper bg-surface p-3 @min-[860px]:min-h-0 @min-[860px]:col-start-2 @min-[860px]:row-start-2"
      >
        {/* Four tabs share one row, so the container is a pill again: it was
            a soft rectangle only because six of them wrapped onto two rows,
            and a `rounded-full` box stretched over two rows reads as a blob
            rather than a toolbar. On a phone they are the shell's bottom bar
            instead, so there is no strip here at all. */}
        {!compact && (
          <Segmented
            fill
            label="Piece inspector"
            value={tab}
            onChange={setTab}
            options={TABS}
            className="flex-none"
          />
        )}

        {/* The piece in hand, rendered ONCE above the body: the Content and
            Look tabs both edit it, and two copies of the same six chips read
            as two different controls. A click on the stage picks one too. */}
        {isHook && (tab === 'content' || tab === 'look') && (
          <div className="flex-none">
            <FieldRow label="Piece" hint="Or click it on the picture.">
              <PiecePicker piece={piece} onPiece={selectPiece} />
            </FieldRow>
          </div>
        )}

        <div className="flex flex-col @min-[860px]:flex-1 @min-[860px]:min-h-0 @min-[860px]:overflow-y-auto @min-[860px]:overscroll-contain @min-[860px]:pr-1.5">
          {tab === 'content' && (
            <ContentTab
              trip={trip}
              post={post}
              slide={slide}
              content={content}
              piece={piece}
              slideFile={slideFile}
              exposure={exposure}
              clipSeconds={isVideo ? duration : 0}
              clip={isClipSlide ? { range: clipRange, speed: slide.speed, onSpeed: setClipSpeed } : null}
              onChangePost={onChangePost}
              patchBadge={patchBadge}
              patchSlide={patchSlide}
              textFieldRef={textFieldRef}
              onEditClosingCard={() => setTripSheet('cta')}
            />
          )}

          {tab === 'look' && (
            <LookTab
              trip={trip}
              post={post}
              isHook={isHook}
              hookCtx={hookCtx}
              hookPictureStatus={hookPictureStatus}
              piece={piece}
              onChangeTrip={onChangeTrip}
              patchBadge={patchBadge}
              onOpenTripSettings={() => setTripSheet('words')}
              onConfigureCar={() => setGarageOpen(true)}
            />
          )}

          {tab === 'picture' && (
            <PictureTab
              post={post}
              slide={slide}
              slideFile={slideFile}
              missing={missing}
              recovery={recovery}
              isVideo={isVideo}
              duration={duration}
              onPickFromSource={pickFromSource}
              patchBadge={patchBadge}
              patchSlide={patchSlide}
              framing={cellFraming}
              onFraming={setSelectedCellFraming}
              grade={grade}
              linkedToProject={post.projectId !== null}
              develop={cellDevelop}
              onOpenDevelop={() => setDevelopOpen(true)}
              onResetDevelop={() => setDevelop(null)}
              collage={collage}
              lead={lead}
              selectedCell={cellIndex}
              onSelectCell={setSelectedCell}
              activeFile={activeFile}
              cellFiles={cellFiles}
              onChangeCollage={setCollage}
              onUseActiveInCell={() => {
                if (!activeFile) return;
                void hashedMediaRef(activeFile).then((ref) => patchCell(cellIndex, { media: ref }));
              }}
              onClearCell={() => patchCell(cellIndex, { media: null })}
              cellFile={cellFile}
              cellFetches={collageFetch.states}
            />
          )}

          {tab === 'export' && (
            <ExportTab
              trip={trip}
              post={post}
              slides={slides}
              hookElements={hookElements}
              aspect={aspect}
              hookFile={hookFile}
              hookIsVideo={hookIsVideo}
              hookLength={hookLength}
              hasPicture={hasPicture}
              exporting={exports.exporting}
              exportNote={exports.note}
              undecodable={exports.undecodable}
              onExportPiece={(imagesOnly) => void exports.exportPiece(imagesOnly)}
              onExportDeck={() => void exports.exportDeck()}
              onExportHookClip={() => void exports.exportHookClip()}
              onChangePost={onChangePost}
              grade={grade.hookGrade}
              gradeScope={grade.hookScope}
              ownGrades={countOwnGrades(post)}
            />
          )}
        </div>
      </PanelHost>
    </div>

    {developOpen && !isCta && (
      <DevelopSheet
        file={cellFile}
        videoTimeSeconds={cellIndex === 0 ? slide.videoTimeSeconds : 0}
        title={cellFile?.name ?? 'this slide'}
        fidelity={pictureFidelity(cellFile).chip}
        note={pictureFidelity(cellFile).note}
        emptyText="This slide has no picture yet — tick one in the Library."
        stack={grade.stack}
        value={cellDevelop}
        onDone={(develop) => {
          setDevelop(develop);
          setDevelopOpen(false);
        }}
        onCancel={() => setDevelopOpen(false)}
        lookHeader={<GradeScopeChips grade={grade} />}
        footerHint={
          collage && cellIndex > 0
            ? `writes to cell ${cellIndex + 1} of ${isHook ? 'the hook' : `slide ${slide.position}`}`
            : isHook
              ? 'writes to the hook'
              : `writes to slide ${slide.position}`
        }
        applyTo={developApplyTo}
      />
    )}

    {tripSheet && (
      <TripSettingsModal
        trip={trip}
        post={post}
        cta={cta}
        section={tripSheet}
        ctaFieldRefs={ctaFieldRefs}
        onChangeTrip={onChangeTrip}
        patchBadge={patchBadge}
        onClose={() => setTripSheet(null)}
      />
    )}

    {garageOpen && (
      <CarGarageModal
        trip={trip}
        onCancel={() => setGarageOpen(false)}
        onDone={(car) => {
          onChangeTrip({ ...trip, car });
          setGarageOpen(false);
        }}
      />
    )}
    </section>
  );
}
