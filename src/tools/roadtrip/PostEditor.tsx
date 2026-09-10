import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAssetLibrary } from '../../shared/library/AssetLibraryContext';
import { useActiveAsset } from '../../shared/library/use-active-asset';
import type { AssetKind } from '../../shared/library/assets';
import { ASPECT_PRESETS } from '../../shared/projects/project-types';
import type { SavedMediaRef } from '../../shared/projects/project-types';
import { hashedMediaRef } from '../../shared/projects/media-identity';
import { normaliseFraming, type Framing } from '../../shared/media/framing';
import { badgeContent, type BadgePiece } from '../../shared/roadtrip/day-badge';
import {
  badgeBlockExtent,
  badgeElements,
  pieceElementId,
  pieceFromElementId,
} from '../../shared/roadtrip/badge-layout';
import { ctaLayout, ctaRoleFromElementId, type CtaRole } from '../../shared/roadtrip/cta-slide';
import {
  captionLineFromElementId,
  contentSlideElements,
  deckSlides,
  moveItem,
} from '../../shared/roadtrip/deck';
import { hookSecondsWithin } from '../../shared/roadtrip/hook-video';
import { formatIsoDate } from '../../shared/roadtrip/trip-days';
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
import BadgeStage from './BadgeStage';
import type { CtaFieldRefs } from './CtaPanel';
import SlideRail from './SlideRail';
import TripSettingsModal, { type TripSettingsSection } from './TripSettingsModal';
import ContentTab from './panels/ContentTab';
import ExportTab from './panels/ExportTab';
import LookTab from './panels/LookTab';
import PictureTab from './panels/PictureTab';
import PiecePicker from './panels/PiecePicker';
import { useBadgeClock } from './use-badge-clock';
import { usePostExports } from './use-post-exports';
import useRailThumbs from './use-rail-thumbs';
import { pickable, useSlideLibrary } from './use-slide-library';
import { useTripGrade } from './use-trip-grade';
import PanelHost from '../../shared/ui/PanelHost';
import { usePublishSectionBar } from '../../shared/ui/section-rail';
import { useIsCompact } from '../../shared/ui/use-layout-mode';

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
  const lib = useAssetLibrary();
  const { active } = useActiveAsset(MEDIA_KINDS);
  const [srcInfo, setSrcInfo] = useState(NO_SOURCE);
  const duration = srcInfo.duration;
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
              active: tab,
              label: 'Piece inspector',
              onSelect: (id: string) => {
                setTab(id as PanelTab);
                setInspectorOpen(true);
              },
            }
          : null,
      [compact, tab],
    ),
  );
  /** The trip-wide sheet, and which of its sections was asked for. */
  const [tripSheet, setTripSheet] = useState<TripSettingsSection | null>(null);

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
      publisher: 'Road Trip',
      // A slide is waiting for a picture: a click should put one on it.
      intent: 'pick',
    }),
    [post.date, post.endDate],
  );
  usePublishMediaScope(mediaScope);

  // --- the deck: the hook, any content pictures, and the closing card ------
  const slides = useMemo(() => deckSlides(trip, post), [trip, post]);
  const slideIndex = Math.min(selected, slides.length - 1);
  const slide = slides[slideIndex];
  const isHook = slide.kind === 'hook';
  const isCta = slide.kind === 'cta';

  /** Write a picture to whichever slide is open. */
  const setSlideMedia = useCallback(
    (ref: SavedMediaRef | null) => {
      if (slide.kind === 'hook') {
        onChangePost({ ...post, media: ref });
      } else if (slide.slideId) {
        onChangePost({
          ...post,
          slides: post.slides.map((s) =>
            s.id === slide.slideId ? { ...s, media: ref } : s,
          ),
        });
      }
    },
    [slide, post, onChangePost],
  );

  // The Library and the open slide point at the same picture, both ways —
  // and a picture the pool lost to a reload is fetched back from the instance
  // that holds it, rather than reported missing.
  const recovery = useSlideLibrary(
    slide,
    lib.assets,
    lib.setActive,
    activeFile,
    setSlideMedia,
    lib.addFiles,
  );

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

  const slideFile = isCta ? null : activeFile;
  const missing = !isCta && slide.media !== null && activeFile === null;
  const isVideo = Boolean(slideFile && !slideFile.type.startsWith('image/'));

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
        overrides: post.badge.textOverrides,
      }),
    [trip, post],
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
          )
        : [],
    [
      content,
      post.badge.layout,
      post.badge.pieceStyles,
      post.badge.durationSeconds,
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

  const patchSlide = (patch: Partial<PostSlide>) => {
    if (!slide.slideId) return;
    onChangePost({
      ...post,
      slides: post.slides.map((s) => (s.id === slide.slideId ? { ...s, ...patch } : s)),
    });
  };

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

  // --- the badge's own clock ------------------------------------------------
  const clock = useBadgeClock(post.badge.pieceStyles, post.badge.durationSeconds, isHook);

  // --- the hook's own picture, whichever slide is open ---------------------
  // The stage reports the OPEN slide's source; the hook clip export and the
  // Studio bridge are about the piece and must work from a carousel's second
  // slide too, so the hook's file and dimensions are kept apart.
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
  /** Whether the Library holds a slide's picture — what the export plan reads. */
  const hasPicture = useCallback(
    (s: { media: SavedMediaRef | null }) => s.media === null || resolve(s.media) !== null,
    [resolve],
  );

  const hookFile = isHook ? slideFile : resolve(post.media);
  const hookIsVideo = Boolean(hookFile && !hookFile.type.startsWith('image/'));
  const [hookInfo, setHookInfo] = useState(NO_SOURCE);
  const onSourceLoaded = useCallback(
    (info: { width: number; height: number; duration: number }) => {
      setSrcInfo(info);
      if (isHook) setHookInfo(info);
    },
    [isHook],
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
  );

  // A clip's frame must stay inside the clip: switching to a shorter video
  // would otherwise leave the badge pinned past the end and decode nothing.
  useEffect(() => {
    if (isHook && duration > 0 && post.badge.videoTimeSeconds > duration) {
      patchBadge({ videoTimeSeconds: 0 });
    }
  }, [isHook, duration, post.badge.videoTimeSeconds, patchBadge]);

  // --- the grade: the Studio's stack, bound to the trip or to this piece ----
  const grade = useTripGrade(trip, post, onChangeTrip, onChangePost);
  const lut = grade.stack.composed;

  // Every cell of the rail, composed exactly as it will be delivered — the
  // crop, the caption, the badge, the grade. It needs the grade, so it sits
  // here rather than beside the deck above.
  const railThumb = useRailThumbs({ trip, post, slides, aspect, resolve, lut });

  const exports = usePostExports({
    trip,
    post,
    aspect,
    slideCount: slides.length,
    timeSeconds: clock.time,
    resolve,
    hookFile,
    hookIsVideo,
    hookInfo,
    hookElements,
    block,
    hookLength,
    lut,
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
  const captureThumb = useCallback(
    (canvas: HTMLCanvasElement) => {
      if (!isHook || missingRef.current) return;
      if (thumbTimer.current !== null) window.clearTimeout(thumbTimer.current);
      thumbTimer.current = window.setTimeout(() => {
        if (missingRef.current) return;
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

  const tabButton = (t: { id: PanelTab; label: string }) => (
    <button
      key={t.id}
      type="button"
      onClick={() => setTab(t.id)}
      className={`flex-1 px-2 py-[0.45rem] font-mono text-[0.66rem] tracking-[0.14em] uppercase rounded-full cursor-pointer transition-colors ${
        tab === t.id
          ? 'bg-ink text-paper'
          : 'bg-transparent text-muted hover:text-accent-ink'
      }`}
      aria-pressed={tab === t.id}
    >
      {t.label}
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
    <div className="flex-1 min-h-0 flex flex-col gap-4 overflow-auto @min-[860px]:grid @min-[860px]:grid-cols-[minmax(0,1fr)_22rem] @min-[860px]:grid-rows-[auto_minmax(0,1fr)] @min-[860px]:gap-x-5 @min-[860px]:gap-y-3 @min-[860px]:overflow-hidden">
      <div className="flex flex-col gap-1 min-w-0 @min-[860px]:col-start-2 @min-[860px]:row-start-1">
        {/* Two rows, not one wrapping row: the two buttons are NAVIGATION and
            stay together and short, while the sync status is a sentence whose
            length nobody controls (a host name, a relative time, up to three
            actions). Sharing a row made the three fixed-height pills wrap one
            per line in a ragged stack, each with a different height and
            border; giving the status its own full-width row is what keeps it
            legible at every width. Exporting has its own button on the Export
            tab — this block is navigation and status only, never a second
            place to trigger the same action. */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center shrink-0 whitespace-nowrap h-[1.9rem] px-3 rounded-full border border-line-strong bg-paper text-[0.78rem] font-semibold text-ink-soft cursor-pointer hover:border-accent hover:text-accent-ink"
          >
            ← Overview
          </button>
          {/* What is true of the WHOLE trip lives behind this, exactly where
              the Studio keeps a project's own settings — so the inspector on
              the right is about the piece and nothing else. */}
          <button
            type="button"
            onClick={() => setTripSheet('words')}
            title="Trip settings — the words, the closing card, what a new piece starts from"
            className="inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap h-[1.9rem] px-2.5 rounded-full border border-line-strong bg-paper font-mono text-[0.66rem] tracking-[0.06em] uppercase text-ink-soft cursor-pointer hover:border-accent hover:text-accent-ink"
          >
            Trip
            <span className="text-[0.95rem] leading-none" aria-hidden="true">
              ⚙
            </span>
          </button>
          <span className="flex-1" />
          {/* The piece's ONE primary action, back in the header where the
              maintainer looked for it. It is not the duplicate that was
              removed in `5d11245`: the Export tab's buttons are the
              per-format escapes FROM this one, which delivers the whole deck
              in the formats the slides say they are. Pressing it switches to
              that tab, so the report is read where it is written.
              `shrink-0 whitespace-nowrap` for the reason the Overview pill
              carries it — a fixed-height button with nowhere to put its text
              spills a second line outside its own box. */}
          <button
            type="button"
            onClick={() => void exports.exportPiece()}
            disabled={exports.exporting !== null}
            title="Every slide of this piece, in the format it is"
            className="inline-flex items-center shrink-0 whitespace-nowrap h-[1.9rem] px-[1.1rem] border border-ink rounded-full bg-ink text-paper cursor-pointer text-[0.78rem] font-semibold hover:bg-accent hover:border-accent disabled:opacity-60 disabled:cursor-default"
          >
            {exports.exporting ?? '↓ Export'}
          </button>
        </div>
        {headerExtra && <div className="flex min-w-0">{headerExtra}</div>}
        {/* Editable in place, like the Studio's project name: a piece is
            found again by what it is called, and having to go back to the
            day panel to rename it is the kind of friction that stops you
            naming things at all. */}
        <input
          value={post.title}
          onChange={(e) => onChangePost({ ...post, title: e.target.value })}
          placeholder="Untitled piece"
          aria-label="What this piece shows"
          className="w-full font-serif text-[1.25rem] leading-tight bg-transparent border-0 border-b border-transparent focus:border-line-strong focus:outline-none text-ink px-1 py-0.5 placeholder:text-faint placeholder:italic"
        />
        <p className="m-0 px-1 font-mono text-[0.68rem] text-muted">
          {formatIsoDate(post.date)} · {post.kind}
        </p>
      </div>

      {/* The deck sits beside the picture, not behind a tab: a carousel is
          the one thing about a piece you cannot see while you work on it.
          Wide it is a column against the stage; stacked it is a row under it,
          which is also why the rail is a child of the queried layout. */}
      <div className="min-w-0 flex flex-col gap-3 @min-[860px]:min-h-0 @min-[860px]:col-start-1 @min-[860px]:row-start-1 @min-[860px]:row-span-2">
        {/* Centred as a PAIR, and the picture's column capped to the width
            the picture actually takes (reported by the stage from the height
            it was given): a portrait frame on a wide screen used to centre
            itself inside a full-width column, leaving the rail stranded a
            third of a screen away from the thumbnails it belongs to. */}
        <div className="flex-1 min-h-0 flex flex-col-reverse items-center gap-3 @min-[860px]:flex-row @min-[860px]:items-stretch @min-[860px]:justify-center @min-[860px]:gap-3">
          <SlideRail
            slides={slides}
            index={slideIndex}
            aspect={aspect}
            includeCta={post.includeCta}
            thumbFor={railThumb}
            onSelect={setSelected}
            onAdd={() => void addSlide()}
            onRemove={removeSlide}
            onMove={moveSlideTo}
            onIncludeCta={(on) => onChangePost({ ...post, includeCta: on })}
            onEditClosingCard={() => setTripSheet('cta')}
          />
          <div
            style={{ '--fit': fitWidth === null ? '100%' : `${Math.round(fitWidth)}px` } as React.CSSProperties}
            /* `w-full` is load-bearing on a narrow screen: the row above
               centres its children, so this column used to take its width
               from the badge's own measured box — and the stage became a
               SCROLL box (view zoom), whose intrinsic width is zero. Without
               a width to measure, the picture collapsed to its border. */
            className="w-full flex-1 min-w-0 min-h-0 flex flex-col items-center gap-3 @min-[860px]:max-w-[min(100%,var(--fit))]"
          >
          <BadgeStage
            file={slideFile}
            videoTimeSeconds={slide.videoTimeSeconds}
            aspect={aspect}
            elements={elements}
            theme={isCta ? null : trip.theme}
            timeSeconds={isHook ? clock.time : 0}
            shades={isHook ? post.badge.shades : undefined}
            block={isHook ? block : null}
            background={isCta ? trip.cta.background : undefined}
            qr={
              isCta && cta.qr
                ? { ...cta.qr, dark: trip.cta.ink, light: trip.cta.background }
                : null
            }
            lut={isCta ? null : lut}
            selectedId={selectedId}
            onSelect={selectElement}
            // Only the hook's block has somewhere to be written back to; a
            // caption and the closing card sit at fixed positions.
            blockAnchor={isHook ? post.badge.layout : null}
            onMoveBlock={isHook ? moveBlockTo : undefined}
            framing={slide.framing}
            // The closing card carries no photograph, so there is nothing to
            // reframe there and a drag must not pretend otherwise.
            onFraming={isCta ? undefined : setFraming}
            onSourceLoaded={onSourceLoaded}
            onRendered={captureThumb}
            onFit={setFitWidth}
          />

          {isHook && clock.animated && (
            <div className="flex-none flex items-center gap-3 w-full max-w-[26rem]">
              <button
                type="button"
                onClick={() => clock.setPlaying((p) => !p)}
                className="flex-none px-3 py-1.5 border border-line-strong rounded-full bg-paper text-[0.76rem] font-semibold text-ink-soft cursor-pointer hover:border-accent hover:text-accent-ink"
              >
                {clock.playing ? '❚❚ Pause' : '▶ Play'}
                <span className="ml-1.5 text-faint font-mono text-[0.62rem]">space</span>
              </button>
              <input
                type="range"
                min={0}
                max={clock.loopSeconds}
                step={0.02}
                value={clock.time}
                onChange={(e) => {
                  clock.setPlaying(false);
                  clock.setTime(Number(e.target.value));
                }}
                className="flex-1 accent-accent"
                aria-label="Badge time"
              />
              <span className="flex-none font-mono text-[0.68rem] tabular-nums text-muted">
                {clock.time.toFixed(2)}s
              </span>
            </div>
          )}
          </div>
        </div>
      </div>

      <PanelHost
        asSheet={compact}
        open={inspectorOpen}
        onClose={() => setInspectorOpen(false)}
        title={TABS.find((t) => t.id === tab)?.label ?? 'Piece'}
        className="w-full min-w-0 flex flex-col gap-3 @min-[860px]:min-h-0 @min-[860px]:col-start-2 @min-[860px]:row-start-2"
      >
        {/* Four tabs share one row, so the container is a pill again: it was
            a soft rectangle only because six of them wrapped onto two rows,
            and a `rounded-full` box stretched over two rows reads as a blob
            rather than a toolbar. On a phone they are the shell's bottom bar
            instead, so there is no strip here at all. */}
        {!compact && (
          <div
            className="flex-none flex gap-1 p-1 rounded-full border border-line bg-surface"
            role="tablist"
            aria-label="Piece inspector"
          >
            {TABS.map(tabButton)}
          </div>
        )}

        {/* The piece in hand, rendered ONCE above the body: the Content and
            Look tabs both edit it, and two copies of the same six chips read
            as two different controls. A click on the stage picks one too. */}
        {isHook && (tab === 'content' || tab === 'look') && (
          <div className="flex-none flex flex-col gap-1.5">
            <span className="flex items-center gap-2">
              <span className="font-mono text-[0.62rem] tracking-[0.14em] uppercase text-muted">
                Piece
              </span>
              <span className="text-[0.68rem] text-faint">or click it on the picture</span>
            </span>
            <PiecePicker piece={piece} onPiece={selectPiece} />
          </div>
        )}

        <div className="flex flex-col gap-3 @min-[860px]:flex-1 @min-[860px]:min-h-0 @min-[860px]:overflow-y-auto @min-[860px]:overscroll-contain @min-[860px]:pr-1.5">
          {tab === 'content' && (
            <ContentTab
              trip={trip}
              post={post}
              slide={slide}
              content={content}
              piece={piece}
              slideFile={slideFile}
              clipSeconds={isVideo ? duration : 0}
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
              piece={piece}
              onChangeTrip={onChangeTrip}
              patchBadge={patchBadge}
              onOpenTripSettings={() => setTripSheet('words')}
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
              framing={normaliseFraming(slide.framing)}
              onFraming={setFraming}
              grade={grade}
              linkedToProject={post.projectId !== null}
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
              onExportPiece={(imagesOnly) => void exports.exportPiece(imagesOnly)}
              onExportDeck={() => void exports.exportDeck()}
              onExportHookClip={() => void exports.exportHookClip()}
              onChangePost={onChangePost}
              grade={grade.saved}
              gradeScope={grade.scope}
            />
          )}
        </div>
      </PanelHost>
    </div>

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
    </section>
  );
}
