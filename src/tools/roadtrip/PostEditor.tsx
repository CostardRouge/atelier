import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAssetLibrary } from '../../shared/library/AssetLibraryContext';
import { useActiveAsset } from '../../shared/library/use-active-asset';
import type { Asset, AssetKind } from '../../shared/library/assets';
import { ASPECT_PRESETS, savedMediaRef } from '../../shared/projects/project-types';
import StylePanel from '../../shared/overlay/StylePanel';
import type { Anchor } from '../../shared/overlay/overlay-types';
import {
  BADGE_PIECES,
  counterPreviews,
  DEFAULT_BADGE_WORDS,
  FRENCH_BADGE_WORDS,
  WORD_FIELDS,
  badgeContent,
  type BadgePiece,
  type BadgeWords,
} from '../../shared/roadtrip/day-badge';
import {
  badgeBlockExtent,
  badgeElements,
  badgeSettleSeconds,
  type BadgePieceStyle,
} from '../../shared/roadtrip/badge-layout';
import type { BadgeBackdrop } from '../../shared/roadtrip/badge-render';
import {
  TIME_AGO_WORD_FIELDS,
  timeAgoPreviews,
  type TimeAgoWords,
} from '../../shared/roadtrip/time-ago';
import { readCaptureDate, type CaptureDate } from '../../shared/roadtrip/media-date';
import { postDayRange, stageAt } from '../../shared/roadtrip/trip-coverage';
import { ctaLayout } from '../../shared/roadtrip/cta-slide';
import { contentSlideElements, deckSlides, moveItem } from '../../shared/roadtrip/deck';
import { renderDeck } from '../../shared/roadtrip/deck-export';
import {
  MAX_HOOK_SECONDS,
  MIN_HOOK_SECONDS,
  hookRange,
  hookSecondsWithin,
  hookSourceProblem,
  hookVariant,
  hookVideoName,
} from '../../shared/roadtrip/hook-video';
import { exportHookVideo } from '../../shared/roadtrip/hook-video-export';
import {
  formatIsoDate,
  isWithin,
  todayIso,
} from '../../shared/roadtrip/trip-days';
import {
  createPostSlide,
  type PostBadge,
  type TripDoc,
  type TripPost,
} from '../../shared/roadtrip/trip-types';
import { canvasThumbnail } from '../../shared/roadtrip/thumbnail';
import { putThumb } from '../../shared/roadtrip/trip-store';
import { canWriteToDisk, pickWritableDirectory, writeItems } from '../../shared/sources/write-files';
import BadgeStage from './BadgeStage';
import CtaPanel from './CtaPanel';
import PieceStylePanel from './PieceStylePanel';

interface PostEditorProps {
  trip: TripDoc;
  post: TripPost;
  onBack: () => void;
  onChangePost: (post: TripPost) => void;
  onChangeTrip: (trip: TripDoc) => void;
}

const legend = 'font-mono text-[0.62rem] tracking-[0.14em] uppercase text-muted';
const section = 'flex flex-col gap-2';
const inputClass =
  'font-sans text-[0.82rem] px-2.5 py-1.5 border border-line-strong rounded-paper bg-paper text-ink focus:outline-none focus:border-accent';

/** Pass as a module constant — a fresh array per render re-runs the projection. */
const MEDIA_KINDS: readonly AssetKind[] = ['photo', 'video+telemetry', 'video'];

/** The nine anchors, laid out as the 3×3 grid they are. */
const ANCHORS: Anchor[] = [
  'top-left',
  'top-center',
  'top-right',
  'center-left',
  'center',
  'center-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
];

/** Where an anchor's default position sits, so picking one actually moves it. */
function positionFor(anchor: Anchor): { x: number; y: number } {
  const x = anchor.endsWith('-left') ? 0.07 : anchor.endsWith('-right') ? 0.93 : 0.5;
  const y = anchor.startsWith('top-') ? 0.08 : anchor.startsWith('bottom-') ? 0.92 : 0.5;
  return { x, y };
}

function pickable(asset: Asset): File | null {
  return asset.parts.image ?? asset.parts.video ?? null;
}

function Fold({
  title,
  children,
  open,
  onToggle,
}: {
  title: string;
  children: React.ReactNode;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border border-line rounded-paper bg-surface">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`w-full flex items-center gap-2 px-3 py-2 border-0 bg-transparent cursor-pointer ${legend}`}
      >
        <span className="flex-1 text-left">{title}</span>
        <span className="text-faint" aria-hidden="true">
          {open ? '−' : '+'}
        </span>
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

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
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [srcInfo, setSrcInfo] = useState({ width: 0, height: 0, duration: 0 });
  const duration = srcInfo.duration;
  const [selected, setSelected] = useState(0);
  const [piece, setPiece] = useState<BadgePiece>('kicker');
  const [openFold, setOpenFold] = useState<string | null>('piece');

  const activeFile = active ? pickable(active) : null;

  // --- the deck: the hook, any content pictures, and the closing card ------
  const slides = useMemo(() => deckSlides(trip, post), [trip, post]);
  const slideIndex = Math.min(selected, slides.length - 1);
  const slide = slides[slideIndex];
  const isHook = slide.kind === 'hook';
  const isCta = slide.kind === 'cta';

  /** Write a picture to whichever slide is open. */
  const setSlideMedia = useCallback(
    (ref: ReturnType<typeof savedMediaRef> | null) => {
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

  // --- the Library and the open slide point at the same picture ------------
  // Opening a slide activates its picture; from then on the sidebar leads.
  // Keyed by slide, so stepping through a carousel re-points the Library each
  // time rather than writing the first slide's picture over the others.
  const restoredFor = useRef<string | null>(null);
  const slideKey = slide.slideId ?? slide.kind;
  useEffect(() => {
    if (restoredFor.current === slideKey) return;
    if (isCta || !slide.media) {
      restoredFor.current = slideKey;
      return;
    }
    if (!lib.assets.length) return;
    const want = slide.media.name.toLowerCase();
    const match = lib.assets.find((a) => {
      const f = pickable(a);
      return f && f.name.toLowerCase() === want;
    });
    if (match) lib.setActive(match.id);
    restoredFor.current = slideKey;
  }, [slideKey, slide.media, isCta, lib.assets, lib.setActive]);

  useEffect(() => {
    if (restoredFor.current !== slideKey || !activeFile || isCta) return;
    if (slide.media?.name.toLowerCase() === activeFile.name.toLowerCase()) return;
    setSlideMedia(savedMediaRef(activeFile));
  }, [activeFile, slideKey, slide.media, isCta, setSlideMedia]);

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

  // --- the day the picture was actually taken -------------------------------
  // Every number the badge draws is a subtraction from the day the piece is
  // filed under, so a picture filed under the wrong day reads confidently
  // wrong. The file is measured and the answer offered; the author still
  // decides — nothing here rewrites a post on its own.
  const [captured, setCaptured] = useState<CaptureDate | null>(null);
  useEffect(() => {
    if (!slideFile) {
      setCaptured(null);
      return;
    }
    let alive = true;
    void readCaptureDate(slideFile).then((d) => {
      if (alive) setCaptured(d);
    });
    return () => {
      alive = false;
    };
  }, [slideFile]);

  const capturedElsewhere = captured !== null && captured.date !== post.date;
  const capturedOutsideTrip =
    captured !== null && !isWithin(trip.startDate, trip.endDate, captured.date);

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

  const patchSlide = (patch: Partial<(typeof post.slides)[number]>) => {
    if (!slide.slideId) return;
    onChangePost({
      ...post,
      slides: post.slides.map((s) => (s.id === slide.slideId ? { ...s, ...patch } : s)),
    });
  };

  function addSlide() {
    const ref = activeFile ? savedMediaRef(activeFile) : null;
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

  // --- reordering the middle of the deck -----------------------------------
  // Only the content pictures move: the hook opens the piece and the call to
  // action closes it, and a deck where either drifted into the middle would
  // stop working. Indices below are into `post.slides`; the strip adds one for
  // the hook when it needs a deck position.
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

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
  const settle = badgeSettleSeconds(post.badge.pieceStyles);
  const styles = Object.values(post.badge.pieceStyles);
  const animated = styles.some((s) => s?.animation);
  const exits = styles.some((s) => s?.animation?.out);
  // With an exit, the loop IS the hook: you have to watch it leave.
  const loopSeconds = exits
    ? post.badge.durationSeconds
    : Math.max(settle + 1.5, 3);
  // A still of an animated badge shows it settled, never caught mid-slide.
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!animated) setTime(0);
    else if (!playing) setTime(settle);
  }, [animated, settle, playing]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let started: number | null = null;
    const tick = (now: number) => {
      started ??= now;
      setTime(((now - started) / 1000) % loopSeconds);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, loopSeconds]);

  // How long the burned-in hook clip runs. Session state, not part of the
  // document: it is derived from the badge's own hold, so it is never
  // arbitrary, and a length is an export choice rather than a property of the
  // piece. Null means "follow the badge".
  const [hookSeconds, setHookSeconds] = useState<number | null>(null);
  const hookLength = hookSecondsWithin(
    hookSeconds,
    post.badge.durationSeconds,
    duration,
  );

  const patchBadge = useCallback(
    (patch: Partial<PostBadge>) =>
      onChangePost({ ...post, badge: { ...post.badge, ...patch } }),
    [post, onChangePost],
  );

  const patchWords = (patch: Partial<BadgeWords>) =>
    onChangeTrip({ ...trip, badgeWords: { ...trip.badgeWords, ...patch } });

  const patchTimeWords = (patch: Partial<TimeAgoWords>) =>
    onChangeTrip({
      ...trip,
      badgeWords: {
        ...trip.badgeWords,
        time: { ...trip.badgeWords.time, ...patch },
      },
    });

  const patchBackdrop = (patch: Partial<BadgeBackdrop>) =>
    patchBadge({ backdrop: { ...post.badge.backdrop, ...patch } });

  /** What the temporal line actually says, so the panel shows it rather than
   *  describing it — a mode that has nothing true to say must be visible. */
  const reference = post.badge.referenceDate ?? todayIso();
  const timePreviews = useMemo(
    () => timeAgoPreviews(post.date, reference, trip.badgeWords.time),
    [post.date, reference, trip.badgeWords.time],
  );
  const timeLine =
    timePreviews.find((p) => p.id === post.badge.timeAgo)?.text ?? null;

  /** What each counter mode would really say for THIS post — or why it cannot. */
  const modePreviews = useMemo(
    () => counterPreviews(trip, post, trip.badgeWords, post.badge.showPin),
    [trip, post],
  );
  const activeMode = modePreviews.find((m) => m.id === post.badge.mode) ?? null;

  /** Where the day lands in the trip, and what the trip calls that place. */
  const range = postDayRange(trip, post);
  const dayOfTrip = range
    ? `day ${range.from}${range.to > range.from ? `–${range.to}` : ''} / ${range.total}`
    : 'outside the trip';
  const place = stageAt(trip, post.date)?.name.trim() || null;

  const pieceStyle: BadgePieceStyle = post.badge.pieceStyles[piece] ?? {};
  const setPieceStyle = (style: BadgePieceStyle) =>
    patchBadge({ pieceStyles: { ...post.badge.pieceStyles, [piece]: style } });

  // A clip's frame must stay inside the clip: switching to a shorter video
  // would otherwise leave the badge pinned past the end and decode nothing.
  useEffect(() => {
    if (duration > 0 && post.badge.videoTimeSeconds > duration) {
      patchBadge({ videoTimeSeconds: 0 });
    }
  }, [duration, post.badge.videoTimeSeconds, patchBadge]);

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

  function download(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Burn the animated hook into the clip, through the Studio's own video
   * export. The still shows the badge settled; this is the version that plays
   * it — which is the whole point of an entrance.
   */
  async function exportHookClip() {
    if (!slideFile || !isHook || !isVideo) return;
    const problem = hookSourceProblem(slideFile.name, slideFile.type);
    if (problem) {
      setExportNote(problem);
      return;
    }
    if (!srcInfo.width || !srcInfo.height) {
      setExportNote('The clip is still loading — try again in a moment.');
      return;
    }
    setExportNote(null);
    setExporting('Encoding…');
    try {
      const variant = hookVariant(post.badge.aspectId);
      const blob = await exportHookVideo({
        file: slideFile,
        variant,
        elements: hookElements,
        theme: trip.theme,
        srcWidth: srcInfo.width,
        srcHeight: srcInfo.height,
        range: hookRange(post.badge.videoTimeSeconds, hookLength, duration),
        backdrop: post.badge.backdrop,
        block,
        onProgress: (p) =>
          setExporting(
            p.ratio === null
              ? `${p.phase}…`
              : `Encoding ${Math.round(p.ratio * 100)}%…`,
          ),
      });
      const name = hookVideoName(
        trip.name,
        post.title.trim() || `day-${post.date}`,
        variant,
      );
      download(blob, name);
      setExportNote(`${name} downloaded`);
    } catch (err) {
      // The pipeline's messages already name the cause (an undecodable HEVC
      // points at the transcode), so they are shown as they come.
      setExportNote(
        err instanceof Error ? err.message : 'The clip could not be encoded.',
      );
    } finally {
      setExporting(null);
    }
  }

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

  /**
   * Render every slide and hand the set over. A folder keeps the deck in
   * order on disk; where the picker is unavailable each slide is downloaded
   * in turn, which is the only thing a non-Chromium browser can do.
   */
  async function exportDeck() {
    setExportNote(null);
    setExporting('Rendering…');
    try {
      const rendered = await renderDeck({
        trip,
        post,
        aspect,
        longEdge: 1920,
        timeSeconds: time,
        resolve,
        onProgress: (done, total) => setExporting(`Rendering ${done}/${total}…`),
      });
      if (!rendered.length) {
        setExportNote('Nothing could be rendered — check the pictures are loaded.');
        return;
      }
      const short = slides.length - rendered.length;

      if (canWriteToDisk()) {
        let dir: FileSystemDirectoryHandle;
        try {
          dir = await pickWritableDirectory();
        } catch {
          return; // dismissed
        }
        setExporting('Writing…');
        const res = await writeItems(
          dir,
          rendered.map((r) => ({ name: r.name, file: new File([r.blob], r.name) })),
        );
        setExportNote(
          `${res.written} slide${res.written === 1 ? '' : 's'} written` +
            (short ? ` · ${short} could not be rendered` : '') +
            (res.errors.length ? ` · ${res.errors.length} failed to write` : ''),
        );
      } else {
        for (const r of rendered) download(r.blob, r.name);
        setExportNote(
          `${rendered.length} slide${rendered.length === 1 ? '' : 's'} downloaded` +
            (short ? ` · ${short} could not be rendered` : ''),
        );
      }
    } finally {
      setExporting(null);
    }
  }

  const fold = (id: string) => ({
    open: openFold === id,
    onToggle: () => setOpenFold((cur) => (cur === id ? null : id)),
  });

  return (
    // Wide: the page holds still and the panel scrolls by itself, so the badge
    // stays in view while its controls are worked through — the studio's own
    // layout. Narrow (stacked): the whole page scrolls, because a panel with
    // its own scrollbar inside a scrolling page is a trap on a phone.
    <section
      className="@container flex flex-col flex-1 min-h-0 gap-4 overflow-auto @min-[860px]:overflow-hidden"
      aria-label="Hook"
    >
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center h-[1.9rem] px-3 rounded-full border border-line-strong bg-paper text-[0.78rem] font-semibold text-ink-soft cursor-pointer hover:border-accent hover:text-accent-ink"
        >
          ← Overview
        </button>
        <div className="min-w-0">
          <h1 className="m-0 font-serif text-[1.25rem] leading-tight truncate">
            {post.title || 'Untitled piece'}
          </h1>
          <p className="m-0 font-mono text-[0.68rem] text-muted">
            {formatIsoDate(post.date)} · {post.kind}
          </p>
        </div>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => void exportDeck()}
          disabled={exporting !== null}
          className="px-[1.1rem] py-2 inline-flex items-center border border-ink rounded-full bg-ink text-paper cursor-pointer text-[0.82rem] font-semibold hover:bg-accent hover:border-accent disabled:opacity-60"
        >
          {exporting ??
            (slides.length === 1
              ? '↓ Export PNG'
              : `↓ Export ${slides.length} slides`)}
        </button>
      </div>

      <div className="flex flex-col @min-[860px]:flex-row gap-5 min-h-0 @min-[860px]:flex-1">
        <div className="flex-1 min-w-0 flex flex-col items-center gap-3 @min-[860px]:min-h-0">
          <BadgeStage
            file={slideFile}
            videoTimeSeconds={slide.videoTimeSeconds}
            aspect={aspect}
            elements={elements}
            theme={isCta ? null : trip.theme}
            timeSeconds={isHook ? time : 0}
            backdrop={isHook ? post.badge.backdrop : undefined}
            block={isHook ? block : null}
            background={isCta ? trip.cta.background : undefined}
            qr={
              isCta && cta.qr
                ? { ...cta.qr, dark: trip.cta.ink, light: trip.cta.background }
                : null
            }
            onSourceLoaded={setSrcInfo}
            onRendered={captureThumb}
          />

          {isHook && animated && (
            <div className="flex items-center gap-3 w-full max-w-[26rem]">
              <button
                type="button"
                onClick={() => setPlaying((p) => !p)}
                className="flex-none px-3 py-1.5 border border-line-strong rounded-full bg-paper text-[0.76rem] font-semibold text-ink-soft cursor-pointer hover:border-accent hover:text-accent-ink"
              >
                {playing ? '❚❚ Pause' : '▶ Play'}
              </button>
              <input
                type="range"
                min={0}
                max={loopSeconds}
                step={0.02}
                value={time}
                onChange={(e) => {
                  setPlaying(false);
                  setTime(Number(e.target.value));
                }}
                className="flex-1 accent-accent"
                aria-label="Badge time"
              />
              <span className="flex-none font-mono text-[0.68rem] tabular-nums text-muted">
                {time.toFixed(2)}s
              </span>
            </div>
          )}
        </div>

        <div className="flex-none w-full @min-[860px]:w-[22rem] flex flex-col gap-3 @min-[860px]:min-h-0 @min-[860px]:overflow-y-auto @min-[860px]:overscroll-contain @min-[860px]:pr-1.5">
          <div className={section}>
            <span className={legend}>
              Deck · {slides.length} slide{slides.length === 1 ? '' : 's'}
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {slides.map((s, i) => {
                const ci = s.kind === 'content' ? i - 1 : -1;
                const dropping = ci >= 0 && dragOver === ci && dragFrom !== ci;
                return (
                  <button
                    key={s.slideId ?? s.kind}
                    type="button"
                    onClick={() => setSelected(i)}
                    aria-pressed={i === slideIndex}
                    title={
                      s.kind === 'content'
                        ? `Slide ${s.position} — drag to reorder`
                        : s.kind
                    }
                    draggable={ci >= 0}
                    onDragStart={(e) => {
                      if (ci < 0) return;
                      setDragFrom(ci);
                      e.dataTransfer.effectAllowed = 'move';
                      // Firefox starts no drag at all without a payload.
                      e.dataTransfer.setData('text/plain', String(ci));
                    }}
                    onDragOver={(e) => {
                      if (ci < 0 || dragFrom === null) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      setDragOver(ci);
                    }}
                    onDrop={(e) => {
                      if (ci < 0 || dragFrom === null) return;
                      e.preventDefault();
                      moveSlideTo(dragFrom, ci);
                      setDragFrom(null);
                      setDragOver(null);
                    }}
                    onDragEnd={() => {
                      setDragFrom(null);
                      setDragOver(null);
                    }}
                    className={`px-2.5 py-1.5 rounded-paper border text-[0.72rem] transition-colors ${
                      ci >= 0 ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
                    } ${dragFrom === ci && ci >= 0 ? 'opacity-50 ' : ''}${
                      dropping
                        ? 'border-accent border-dashed bg-accent-wash text-accent-ink'
                        : i === slideIndex
                          ? 'border-accent bg-accent-wash text-accent-ink font-semibold'
                          : 'border-line bg-paper text-ink-soft hover:border-line-strong'
                    }`}
                  >
                    {s.kind === 'hook'
                      ? 'Hook'
                      : s.kind === 'cta'
                        ? 'Call to action'
                        : s.position}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={addSlide}
                className="px-2.5 py-1.5 rounded-paper border border-line-strong bg-paper text-[0.72rem] font-semibold text-ink-soft cursor-pointer hover:border-accent hover:text-accent-ink"
              >
                + Slide
              </button>
            </div>
            <label className="flex items-center gap-2 text-[0.78rem] text-ink-soft cursor-pointer">
              <input
                type="checkbox"
                checked={post.includeCta}
                onChange={(e) => onChangePost({ ...post, includeCta: e.target.checked })}
                className="accent-accent"
              />
              Close with the trip’s call to action
            </label>
          </div>

          {exportNote && (
            <p className="m-0 px-2.5 py-2 rounded-paper border border-line bg-paper text-[0.76rem] text-ink-soft">
              {exportNote}
            </p>
          )}

          <div className={section}>
            <span className={legend}>Frame</span>
            <div className="grid grid-cols-4 gap-1.5">
              {ASPECT_PRESETS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => patchBadge({ aspectId: a.id })}
                  aria-pressed={a.id === post.badge.aspectId}
                  className={`px-2 py-1.5 rounded-paper border text-center cursor-pointer text-[0.74rem] transition-colors ${
                    a.id === post.badge.aspectId
                      ? 'border-accent bg-accent-wash text-accent-ink font-semibold'
                      : 'border-line bg-paper hover:border-line-strong'
                  }`}
                >
                  {a.id}
                </button>
              ))}
            </div>
          </div>

          {isCta ? (
            <div className={section}>
              <span className={legend}>Closing card · shared by the whole trip</span>
              <CtaPanel
                cta={trip.cta}
                onChange={(next) => onChangeTrip({ ...trip, cta: next })}
                problem={cta.qrProblem}
              />
            </div>
          ) : (
          <>
          <div className={section}>
            <span className={legend}>Picture · from the Library</span>
            {slideFile ? (
              <p className="m-0 text-[0.8rem] text-ink-soft truncate" title={slideFile.name}>
                {slideFile.name}
              </p>
            ) : (
              <p className="m-0 text-[0.78rem] text-muted">
                {missing
                  ? `“${slide.media?.name}” is not in the Library right now. The slide keeps its place in the deck.`
                  : 'Tick a photo or a clip in the Library on the left — this slide composes over whatever is active there.'}
              </p>
            )}
            {isVideo && duration > 0 && (
              <label className="flex flex-col gap-1">
                <span className={legend}>
                  Frame · {slide.videoTimeSeconds.toFixed(1)}s
                </span>
                <input
                  type="range"
                  min={0}
                  max={Math.max(duration - 0.05, 0)}
                  step={0.1}
                  value={slide.videoTimeSeconds}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (isHook) patchBadge({ videoTimeSeconds: v });
                    else patchSlide({ videoTimeSeconds: v });
                  }}
                  className="accent-accent"
                />
              </label>
            )}
            {isHook && isVideo && duration > 0 && (
              <div className="flex flex-col gap-1.5 pt-1 border-t border-line">
                <label className="flex flex-col gap-1">
                  <span className={legend}>Hook clip · {hookLength.toFixed(1)}s</span>
                  <input
                    type="range"
                    min={MIN_HOOK_SECONDS}
                    max={Math.min(MAX_HOOK_SECONDS, Math.max(MIN_HOOK_SECONDS, duration))}
                    step={0.5}
                    value={hookLength}
                    onChange={(e) => setHookSeconds(Number(e.target.value))}
                    className="accent-accent"
                  />
                </label>
                <p className="m-0 text-[0.72rem] text-muted">
                  Starts on the frame above, so the badge animates in on the
                  first frame of the clip. Audio is copied through.
                </p>
                <button
                  type="button"
                  onClick={() => void exportHookClip()}
                  disabled={exporting !== null}
                  className="self-start px-3 py-1.5 rounded-full border border-line-strong bg-paper text-[0.76rem] font-semibold text-ink-soft cursor-pointer hover:border-accent hover:text-accent-ink disabled:opacity-60"
                >
                  ↓ Export hook video
                </button>
              </div>
            )}
          </div>

          {slide.kind === 'content' && (
            <div className={section}>
              <label className="flex flex-col gap-1">
                <span className={legend}>Caption</span>
                <input
                  value={slide.caption}
                  onChange={(e) => patchSlide({ caption: e.target.value })}
                  placeholder="A line over this picture — optional"
                  className={inputClass}
                />
              </label>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={legend}>Order</span>
                <button
                  type="button"
                  onClick={() => moveSlideTo(contentIndex, contentIndex - 1)}
                  disabled={contentIndex <= 0}
                  aria-label="Move this slide earlier"
                  className="px-2 py-1 rounded-paper border border-line-strong bg-paper text-[0.72rem] text-ink-soft cursor-pointer hover:border-accent hover:text-accent-ink disabled:opacity-40 disabled:cursor-default"
                >
                  ← Earlier
                </button>
                <button
                  type="button"
                  onClick={() => moveSlideTo(contentIndex, contentIndex + 1)}
                  disabled={contentIndex < 0 || contentIndex >= post.slides.length - 1}
                  aria-label="Move this slide later"
                  className="px-2 py-1 rounded-paper border border-line-strong bg-paper text-[0.72rem] text-ink-soft cursor-pointer hover:border-accent hover:text-accent-ink disabled:opacity-40 disabled:cursor-default"
                >
                  Later →
                </button>
                <span className="text-[0.72rem] text-faint">or drag it in the strip</span>
              </div>
              <button
                type="button"
                onClick={removeSlide}
                className="self-start p-0 border-0 bg-transparent text-[0.75rem] text-faint cursor-pointer underline underline-offset-[3px] hover:text-[#9a3a23]"
              >
                Remove this slide
              </button>
            </div>
          )}

          {isHook && (
          <>
          <div className={section}>
            <span className={legend}>The day this piece tells</span>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={post.date}
                onChange={(e) => onChangePost({ ...post, date: e.target.value })}
                className={`${inputClass} flex-1 min-w-0`}
                aria-label="The day this piece tells"
              />
              <span className="flex-none font-mono text-[0.68rem] text-muted tabular-nums">
                {dayOfTrip}
              </span>
            </div>
            {captured ? (
              <p className="m-0 text-[0.74rem] text-muted">
                The picture is dated{' '}
                <span className="text-ink">{formatIsoDate(captured.date)}</span>{' '}
                {captured.source === 'exif'
                  ? '(the camera’s own record)'
                  : '(the file’s date — a copy or an export rewrites it)'}
                {capturedElsewhere && (
                  <>
                    {' · '}
                    <button
                      type="button"
                      onClick={() => onChangePost({ ...post, date: captured.date })}
                      className="p-0 border-0 bg-transparent text-[0.74rem] text-accent-ink cursor-pointer underline underline-offset-[3px]"
                    >
                      file it under that day
                    </button>
                  </>
                )}
                {capturedOutsideTrip && (
                  <span className="text-[#9a3a23]">
                    {' '}
                    — outside this trip’s dates, so every count here would be
                    about a day this picture has nothing to do with.
                  </span>
                )}
              </p>
            ) : (
              <p className="m-0 text-[0.74rem] text-faint">
                Everything the badge says is counted from this day.
              </p>
            )}
            <label className="flex flex-col gap-1">
              <span className={legend}>Through (for a range)</span>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={post.endDate ?? ''}
                  min={post.date}
                  onChange={(e) =>
                    onChangePost({ ...post, endDate: e.target.value || null })
                  }
                  className={`${inputClass} flex-1 min-w-0`}
                />
                {post.endDate && (
                  <button
                    type="button"
                    onClick={() => onChangePost({ ...post, endDate: null })}
                    className="flex-none p-0 border-0 bg-transparent text-[0.74rem] text-muted cursor-pointer underline underline-offset-[3px] hover:text-accent-ink"
                  >
                    One day
                  </button>
                )}
              </div>
            </label>
          </div>

          <div className={section}>
            <span className={legend}>What it counts</span>
            {/* Each mode shows the line it would really draw for this post, or
                why it cannot draw one. Fabricated examples made three of the
                four look inert: clicking changed nothing and said nothing. */}
            <div className="flex flex-col gap-1.5">
              {modePreviews.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => patchBadge({ mode: m.id })}
                  aria-pressed={m.id === post.badge.mode}
                  className={`px-2.5 py-1.5 rounded-paper border text-left cursor-pointer transition-colors ${
                    m.id === post.badge.mode
                      ? 'border-accent bg-accent-wash'
                      : 'border-line bg-paper hover:border-line-strong'
                  }`}
                >
                  <span
                    className={`block text-[0.78rem] ${
                      m.id === post.badge.mode
                        ? 'text-accent-ink font-semibold'
                        : 'text-ink-soft'
                    }`}
                  >
                    {m.label}
                  </span>
                  <span
                    className={`block font-mono text-[0.7rem] ${
                      m.text ? 'text-ink' : 'text-faint'
                    }`}
                  >
                    {m.text ?? m.reason}
                  </span>
                </button>
              ))}
            </div>
            {activeMode?.reason && (
              <p className="m-0 px-2.5 py-2 rounded-paper border border-line bg-paper text-[0.75rem] text-muted">
                {activeMode.reason}{' '}
                {activeMode.id === 'day-range'
                  ? 'It counts the single day above meanwhile.'
                  : 'Stages are edited on the trip’s Overview; the day of the trip is counted meanwhile.'}
              </p>
            )}
            <label className="flex items-center gap-2 text-[0.8rem] text-ink-soft cursor-pointer">
              <input
                type="checkbox"
                checked={post.badge.showPin}
                onChange={(e) => patchBadge({ showPin: e.target.checked })}
                className="accent-accent"
              />
              Marker before the place
            </label>
            <p className="m-0 text-[0.72rem] text-faint">
              {place
                ? `The place reads “${place}”.`
                : 'No stage covers this day, so there is no place to mark — add one on the Overview.'}
            </p>
          </div>

          <div className={section}>
            <span className={legend}>Placement</span>
            <div className="flex items-start gap-3">
              <div className="grid grid-cols-3 gap-1.5 w-[6.5rem] flex-none">
                {ANCHORS.map((anchor) => (
                  <button
                    key={anchor}
                    type="button"
                    onClick={() =>
                      patchBadge({
                        layout: { ...post.badge.layout, anchor, ...positionFor(anchor) },
                      })
                    }
                    aria-label={anchor}
                    aria-pressed={anchor === post.badge.layout.anchor}
                    className={`h-7 rounded-[4px] border cursor-pointer transition-colors ${
                      anchor === post.badge.layout.anchor
                        ? 'border-accent bg-accent'
                        : 'border-line bg-paper hover:border-line-strong'
                    }`}
                  />
                ))}
              </div>
              <label className="flex-1 flex flex-col gap-1">
                <span className={legend}>
                  Numeral · {Math.round(post.badge.layout.sizeFrac * 100)}%
                </span>
                <input
                  type="range"
                  min={0.05}
                  max={0.4}
                  step={0.005}
                  value={post.badge.layout.sizeFrac}
                  onChange={(e) =>
                    patchBadge({
                      layout: { ...post.badge.layout, sizeFrac: Number(e.target.value) },
                    })
                  }
                  className="accent-accent"
                />
              </label>
            </div>
          </div>

          <Fold title="Time · the line about when, under the place" {...fold('time')}>
            <div className="flex flex-col gap-3">
              {/* Each mode shows the line it would really draw for this
                  picture on the reading day below — never an example. */}
              <div className="flex flex-col gap-1.5">
                {timePreviews.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => patchBadge({ timeAgo: m.id })}
                    title={m.hint}
                    aria-pressed={post.badge.timeAgo === m.id}
                    className={`px-2.5 py-1.5 rounded-paper border text-left cursor-pointer transition-colors ${
                      post.badge.timeAgo === m.id
                        ? 'border-accent bg-accent-wash'
                        : 'border-line bg-paper hover:border-line-strong'
                    }`}
                  >
                    <span
                      className={`block text-[0.78rem] ${
                        post.badge.timeAgo === m.id
                          ? 'text-accent-ink font-semibold'
                          : 'text-ink-soft'
                      }`}
                    >
                      {m.label}
                    </span>
                    <span
                      className={`block font-mono text-[0.7rem] ${
                        m.text ? 'text-ink' : 'text-faint'
                      }`}
                    >
                      {m.id === 'off'
                        ? 'no line'
                        : (m.text ?? 'nothing true to say on that day')}
                    </span>
                  </button>
                ))}
              </div>

              <label className="flex flex-col gap-1">
                <span className={legend}>Read on</span>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={post.badge.referenceDate ?? todayIso()}
                    onChange={(e) => patchBadge({ referenceDate: e.target.value })}
                    className={`${inputClass} flex-1 min-w-0`}
                  />
                  {post.badge.referenceDate && (
                    <button
                      type="button"
                      onClick={() => patchBadge({ referenceDate: null })}
                      className="flex-none p-0 border-0 bg-transparent text-[0.74rem] text-muted cursor-pointer underline underline-offset-[3px] hover:text-accent-ink"
                    >
                      Today
                    </button>
                  )}
                </div>
                <span className="text-[0.68rem] text-faint">
                  The day this goes out. Set it ahead and the line reads
                  correctly then, not now.
                </span>
              </label>

              <p className="m-0 px-2.5 py-2 rounded-paper bg-paper border border-line text-[0.8rem]">
                {timeLine ? (
                  <span className="text-ink">“{timeLine}”</span>
                ) : (
                  <span className="text-muted">
                    {post.badge.timeAgo === 'off'
                      ? 'No line about when. The trip’s name is on the badge either way.'
                      : post.badge.timeAgo === 'anniversary'
                        ? 'Not the anniversary on that day, so the line is left out. Nothing claims a date it is not.'
                        : 'Nothing true to say about that gap yet, so the line is left out.'}
                  </span>
                )}
              </p>
            </div>
          </Fold>

          <Fold title="Picture · vignette, scrim, duration" {...fold('backdrop')}>
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className={legend}>
                  Hook duration · {post.badge.durationSeconds.toFixed(1)}s
                </span>
                <input
                  type="range"
                  min={1}
                  max={15}
                  step={0.5}
                  value={post.badge.durationSeconds}
                  onChange={(e) =>
                    patchBadge({ durationSeconds: Number(e.target.value) })
                  }
                  className="accent-accent"
                />
                <span className="text-[0.68rem] text-faint">
                  How long the hook lasts — what an exit animation lands on.
                </span>
              </label>

              <label className="flex flex-col gap-1">
                <span className={legend}>
                  Vignette · {Math.round(post.badge.backdrop.vignette * 100)}%
                </span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.02}
                  value={post.badge.backdrop.vignette}
                  onChange={(e) =>
                    patchBackdrop({ vignette: Number(e.target.value) })
                  }
                  className="accent-accent"
                />
              </label>

              <div className="flex flex-col gap-1.5">
                <span className={legend}>Scrim</span>
                <div className="grid grid-cols-3 gap-1.5">
                  {(
                    [
                      ['off', 'Off'],
                      ['linear', 'Whole frame'],
                      ['under', 'Under the hook'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => patchBackdrop({ gradient: id })}
                      aria-pressed={post.badge.backdrop.gradient === id}
                      className={`px-2 py-1.5 rounded-paper border text-[0.72rem] cursor-pointer transition-colors ${
                        post.badge.backdrop.gradient === id
                          ? 'border-accent bg-accent-wash text-accent-ink font-semibold'
                          : 'border-line bg-paper text-ink-soft hover:border-line-strong'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {post.badge.backdrop.gradient !== 'off' && (
                <>
                  <label className="flex flex-col gap-1">
                    <span className={legend}>
                      Strength ·{' '}
                      {Math.round(post.badge.backdrop.gradientStrength * 100)}%
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.02}
                      value={post.badge.backdrop.gradientStrength}
                      onChange={(e) =>
                        patchBackdrop({ gradientStrength: Number(e.target.value) })
                      }
                      className="accent-accent"
                    />
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="flex-1 text-[0.78rem] text-ink-soft">
                      Scrim colour
                    </span>
                    <input
                      type="color"
                      value={post.badge.backdrop.gradientColor}
                      onChange={(e) =>
                        patchBackdrop({ gradientColor: e.target.value })
                      }
                      className="w-7 h-7 p-0 border border-line-strong rounded-[5px] bg-paper cursor-pointer"
                      aria-label="Scrim colour"
                    />
                  </div>
                  <div className="flex gap-1.5">
                    {(['bottom', 'top'] as const).map((edge) => (
                      <button
                        key={edge}
                        type="button"
                        onClick={() => patchBackdrop({ gradientFrom: edge })}
                        aria-pressed={post.badge.backdrop.gradientFrom === edge}
                        className={`flex-1 px-2 py-1.5 rounded-paper border text-[0.72rem] cursor-pointer transition-colors ${
                          post.badge.backdrop.gradientFrom === edge
                            ? 'border-accent bg-accent-wash text-accent-ink font-semibold'
                            : 'border-line bg-paper text-ink-soft hover:border-line-strong'
                        }`}
                      >
                        From the {edge}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </Fold>

          <Fold title="Piece · text, colour, animation" {...fold('piece')}>
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-5 gap-1">
                {BADGE_PIECES.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPiece(p.id)}
                    aria-pressed={piece === p.id}
                    title={p.label}
                    className={`px-1 py-1.5 rounded-paper border text-[0.68rem] cursor-pointer truncate transition-colors ${
                      piece === p.id
                        ? 'border-accent bg-accent-wash text-accent-ink font-semibold'
                        : 'border-line bg-paper text-ink-soft hover:border-line-strong'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <label className="flex flex-col gap-1">
                <span className={legend}>Text</span>
                <input
                  value={post.badge.textOverrides[piece] ?? ''}
                  placeholder={content?.[piece] ?? '(nothing here)'}
                  onChange={(e) =>
                    patchBadge({
                      textOverrides: {
                        ...post.badge.textOverrides,
                        [piece]: e.target.value,
                      },
                    })
                  }
                  className={inputClass}
                />
                <span className="text-[0.68rem] text-faint">
                  Empty follows the trip — clearing it always gives the computed
                  value back.
                </span>
              </label>

              <PieceStylePanel style={pieceStyle} onChange={setPieceStyle} />
            </div>
          </Fold>

          <Fold title="Style · shared by the whole trip" {...fold('style')}>
            <StylePanel
              theme={trip.theme}
              onChange={(theme) => onChangeTrip({ ...trip, theme })}
            />
          </Fold>

          <Fold title="Words · shared by the whole trip" {...fold('words')}>
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onChangeTrip({ ...trip, badgeWords: { ...DEFAULT_BADGE_WORDS } })}
                  className="flex-1 px-2 py-1.5 rounded-paper border border-line bg-paper text-[0.74rem] text-ink-soft cursor-pointer hover:border-accent hover:text-accent-ink"
                >
                  English
                </button>
                <button
                  type="button"
                  onClick={() => onChangeTrip({ ...trip, badgeWords: { ...FRENCH_BADGE_WORDS } })}
                  className="flex-1 px-2 py-1.5 rounded-paper border border-line bg-paper text-[0.74rem] text-ink-soft cursor-pointer hover:border-accent hover:text-accent-ink"
                >
                  Français
                </button>
              </div>
              {WORD_FIELDS.map((f) => (
                <label key={f.key} className="flex items-center gap-2">
                  <span className="w-24 flex-none text-[0.72rem] text-muted">
                    {f.label}
                  </span>
                  <input
                    value={trip.badgeWords[f.key]}
                    onChange={(e) => patchWords({ [f.key]: e.target.value })}
                    className={`${inputClass} flex-1 min-w-0`}
                  />
                </label>
              ))}
              <span className={`${legend} pt-2`}>Time</span>
              {TIME_AGO_WORD_FIELDS.map((f) => (
                <label key={f.key} className="flex items-center gap-2">
                  <span className="w-24 flex-none text-[0.72rem] text-muted">
                    {f.label}
                  </span>
                  <input
                    value={trip.badgeWords.time[f.key]}
                    onChange={(e) => patchTimeWords({ [f.key]: e.target.value })}
                    className={`${inputClass} flex-1 min-w-0`}
                  />
                </label>
              ))}
              <p className="m-0 text-[0.68rem] text-faint">
                “{'{n}'}” is replaced by the quantity, “{'{date}'}” by the
                picture’s own day.
              </p>
            </div>
          </Fold>

          {!content && (
            <p className="m-0 text-[0.78rem] text-[#9a3a23]" role="alert">
              This trip’s dates read backwards, so there is no total to count
              towards. Fix them and the badge comes back.
            </p>
          )}
          </>
          )}
          </>
          )}
        </div>
      </div>
    </section>
  );
}
