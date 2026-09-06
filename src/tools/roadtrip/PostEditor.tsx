import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAssetLibrary } from '../../shared/library/AssetLibraryContext';
import { useActiveAsset } from '../../shared/library/use-active-asset';
import type { AssetKind } from '../../shared/library/assets';
import { ASPECT_PRESETS } from '../../shared/projects/project-types';
import type { SavedMediaRef } from '../../shared/projects/project-types';
import { hashedMediaRef } from '../../shared/projects/media-identity';
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
import ContentTab from './panels/ContentTab';
import DeckTab from './panels/DeckTab';
import ExportTab from './panels/ExportTab';
import GradeTab from './panels/GradeTab';
import PictureTab from './panels/PictureTab';
import StyleTab from './panels/StyleTab';
import { useBadgeClock } from './use-badge-clock';
import { usePostExports } from './use-post-exports';
import { pickable, useSlideLibrary } from './use-slide-library';
import { useTripGrade } from './use-trip-grade';

interface PostEditorProps {
  trip: TripDoc;
  post: TripPost;
  onBack: () => void;
  onChangePost: (post: TripPost) => void;
  onChangeTrip: (trip: TripDoc) => void;
}

/**
 * The inspector's tabs — Road Trip's own nouns, not the Studio's five. Tab
 * state is component state, not part of the route: the route says WHERE you
 * are (trip, day, piece), the tab says what you are looking at there.
 */
type PanelTab = 'content' | 'style' | 'picture' | 'grade' | 'deck' | 'export';

const TABS: Array<{ id: PanelTab; label: string }> = [
  { id: 'content', label: 'Content' },
  { id: 'style', label: 'Style' },
  { id: 'picture', label: 'Picture' },
  { id: 'grade', label: 'Grade' },
  { id: 'deck', label: 'Deck' },
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
}: PostEditorProps) {
  const lib = useAssetLibrary();
  const { active } = useActiveAsset(MEDIA_KINDS);
  const [srcInfo, setSrcInfo] = useState(NO_SOURCE);
  const duration = srcInfo.duration;
  const [selected, setSelected] = useState(0);
  const [piece, setPiece] = useState<BadgePiece>('kicker');
  const [tab, setTab] = useState<PanelTab>('content');

  const activeFile = active ? pickable(active) : null;

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

  const contentIndex = slide.slideId
    ? post.slides.findIndex((s) => s.id === slide.slideId)
    : -1;

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

  // How long the burned-in hook clip runs. Session state, not part of the
  // document: it is derived from the badge's own hold, so it is never
  // arbitrary, and a length is an export choice rather than a property of the
  // piece. Null means "follow the badge".
  const [hookSeconds, setHookSeconds] = useState<number | null>(null);
  const hookLength = hookSecondsWithin(
    hookSeconds,
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
      // The closing card is edited on the Deck tab, shared by the whole trip.
      setTab('deck');
      focusTarget.current = role;
    }
    setFocusSeq((n) => n + 1);
  }

  const selectPiece = (next: BadgePiece) => selectElement(pieceElementId(next));

  // Keyed on the tab as well as the request: the field only exists once its
  // tab is mounted, and clicking the already-selected piece from another tab
  // changes no id.
  useEffect(() => {
    const target = focusTarget.current;
    if (!target) return;
    const field =
      target === 'text' ? textFieldRef.current : ctaFieldRefs[target]?.current ?? null;
    if (!field) return;
    focusTarget.current = null;
    field.focus({ preventScroll: true });
    field.scrollIntoView({ block: 'nearest' });
  }, [focusSeq, tab]);

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
   */
  const thumbTimer = useRef<number | null>(null);
  const captureThumb = useCallback(
    (canvas: HTMLCanvasElement) => {
      if (!isHook) return;
      if (thumbTimer.current !== null) window.clearTimeout(thumbTimer.current);
      thumbTimer.current = window.setTimeout(() => {
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
      className={`px-2 py-[0.45rem] font-mono text-[0.66rem] tracking-[0.14em] uppercase rounded-full cursor-pointer transition-colors ${
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
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center h-[1.9rem] px-3 rounded-full border border-line-strong bg-paper text-[0.78rem] font-semibold text-ink-soft cursor-pointer hover:border-accent hover:text-accent-ink"
          >
            ← Overview
          </button>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => void exports.exportDeck()}
            disabled={exports.exporting !== null}
            className="h-[1.9rem] px-[1.1rem] inline-flex items-center border border-ink rounded-full bg-ink text-paper cursor-pointer text-[0.8rem] font-semibold hover:bg-accent hover:border-accent disabled:opacity-60"
          >
            {exports.exporting ??
              (slides.length === 1
                ? '↓ Export PNG'
                : `↓ Export ${slides.length} slides`)}
          </button>
        </div>
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

      <div className="min-w-0 flex flex-col items-center gap-3 @min-[860px]:min-h-0 @min-[860px]:col-start-1 @min-[860px]:row-start-1 @min-[860px]:row-span-2">
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
            onSourceLoaded={onSourceLoaded}
            onRendered={captureThumb}
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

      <div className="w-full min-w-0 flex flex-col gap-3 @min-[860px]:min-h-0 @min-[860px]:col-start-2 @min-[860px]:row-start-2">
        {/* Six tabs in a 22rem column wrap into two rows rather than
            squeezing into one: the Studio's five at 340px is already tight. */}
        <div
          className="flex-none flex flex-wrap gap-1 p-1 rounded-full border border-line bg-surface"
          role="tablist"
          aria-label="Piece inspector"
        >
          {TABS.map(tabButton)}
        </div>

        <div className="flex flex-col gap-3 @min-[860px]:flex-1 @min-[860px]:min-h-0 @min-[860px]:overflow-y-auto @min-[860px]:overscroll-contain @min-[860px]:pr-1.5">
          {tab === 'content' && (
            <ContentTab
              trip={trip}
              post={post}
              slide={slide}
              content={content}
              piece={piece}
              onPiece={selectPiece}
              slideFile={slideFile}
              onChangePost={onChangePost}
              patchBadge={patchBadge}
              patchSlide={patchSlide}
              textFieldRef={textFieldRef}
              onGoToDeck={() => setTab('deck')}
            />
          )}

          {tab === 'style' && (
            <StyleTab
              trip={trip}
              post={post}
              isHook={isHook}
              piece={piece}
              onPiece={setPiece}
              onChangeTrip={onChangeTrip}
              patchBadge={patchBadge}
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
              patchBadge={patchBadge}
              patchSlide={patchSlide}
            />
          )}

          {tab === 'grade' && (
            <GradeTab grade={grade} linkedToProject={post.projectId !== null} />
          )}

          {tab === 'deck' && (
            <DeckTab
              trip={trip}
              post={post}
              slides={slides}
              slideIndex={slideIndex}
              contentIndex={contentIndex}
              cta={cta}
              onSelectSlide={setSelected}
              onAddSlide={() => void addSlide()}
              onRemoveSlide={removeSlide}
              onMoveSlide={moveSlideTo}
              onChangePost={onChangePost}
              onChangeTrip={onChangeTrip}
              patchBadge={patchBadge}
              ctaFieldRefs={ctaFieldRefs}
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
              duration={hookInfo.duration}
              hookLength={hookLength}
              onHookSeconds={setHookSeconds}
              exporting={exports.exporting}
              exportNote={exports.note}
              onExportDeck={() => void exports.exportDeck()}
              onExportHookClip={() => void exports.exportHookClip()}
              onChangePost={onChangePost}
              grade={grade.saved}
              gradeScope={grade.scope}
            />
          )}
        </div>
      </div>
    </div>
    </section>
  );
}
