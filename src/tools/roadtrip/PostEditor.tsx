import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAssetLibrary } from '../../shared/library/AssetLibraryContext';
import { useActiveAsset } from '../../shared/library/use-active-asset';
import type { Asset, AssetKind } from '../../shared/library/assets';
import { ASPECT_PRESETS, savedMediaRef } from '../../shared/projects/project-types';
import StylePanel from '../../shared/overlay/StylePanel';
import type { Anchor } from '../../shared/overlay/overlay-types';
import {
  BADGE_PIECES,
  COUNTER_MODES,
  DEFAULT_BADGE_WORDS,
  FRENCH_BADGE_WORDS,
  WORD_FIELDS,
  badgeContent,
  type BadgePiece,
  type BadgeWords,
} from '../../shared/roadtrip/day-badge';
import {
  badgeElements,
  badgeSettleSeconds,
  type BadgePieceStyle,
} from '../../shared/roadtrip/badge-layout';
import { badgeToPng, frameSize, loadBadgeSource } from '../../shared/roadtrip/badge-render';
import { formatIsoDate } from '../../shared/roadtrip/trip-days';
import type { PostBadge, TripDoc, TripPost } from '../../shared/roadtrip/trip-types';
import BadgeStage from './BadgeStage';
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
  const [exporting, setExporting] = useState(false);
  const [duration, setDuration] = useState(0);
  const [piece, setPiece] = useState<BadgePiece>('kicker');
  const [openFold, setOpenFold] = useState<string | null>('piece');

  const activeFile = active ? pickable(active) : null;

  // --- the Library and the post point at the same picture ------------------
  // Opening a post activates its picture; from then on the sidebar leads.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    if (!post.media) {
      restored.current = true;
      return;
    }
    if (!lib.assets.length) return;
    const want = post.media.name.toLowerCase();
    const match = lib.assets.find((a) => {
      const f = pickable(a);
      return f && f.name.toLowerCase() === want;
    });
    if (match) lib.setActive(match.id);
    restored.current = true;
  }, [post.media, lib.assets, lib.setActive]);

  useEffect(() => {
    if (!restored.current || !activeFile) return;
    if (post.media?.name.toLowerCase() === activeFile.name.toLowerCase()) return;
    onChangePost({ ...post, media: savedMediaRef(activeFile) });
  }, [activeFile, post, onChangePost]);

  const missing = post.media !== null && activeFile === null;
  const isVideo = Boolean(activeFile && !activeFile.type.startsWith('image/'));

  const aspectPreset =
    ASPECT_PRESETS.find((a) => a.id === post.badge.aspectId) ?? ASPECT_PRESETS[0];
  const aspect = aspectPreset.w / aspectPreset.h;

  const content = useMemo(
    () =>
      badgeContent(trip, post, {
        mode: post.badge.mode,
        words: trip.badgeWords,
        showAnniversary: post.badge.showAnniversary,
        overrides: post.badge.textOverrides,
      }),
    [trip, post],
  );

  const elements = useMemo(
    () =>
      content
        ? badgeElements(content, post.badge.layout, aspect, post.badge.pieceStyles)
        : [],
    [content, post.badge.layout, post.badge.pieceStyles, aspect],
  );

  // --- the badge's own clock ------------------------------------------------
  const settle = badgeSettleSeconds(post.badge.pieceStyles);
  const animated = settle > 0 || Object.values(post.badge.pieceStyles).some((s) => s?.animation);
  const loopSeconds = Math.max(settle + 1.5, 3);
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

  const patchBadge = useCallback(
    (patch: Partial<PostBadge>) =>
      onChangePost({ ...post, badge: { ...post.badge, ...patch } }),
    [post, onChangePost],
  );

  const patchWords = (patch: Partial<BadgeWords>) =>
    onChangeTrip({ ...trip, badgeWords: { ...trip.badgeWords, ...patch } });

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

  async function exportPng() {
    setExporting(true);
    try {
      const { w, h } = frameSize(aspect, 1920);
      const source = activeFile
        ? await loadBadgeSource(activeFile, post.badge.videoTimeSeconds)
        : null;
      try {
        const blob = await badgeToPng({
          source,
          elements,
          theme: trip.theme,
          timeSeconds: time,
          width: w,
          height: h,
        });
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const slug =
          (post.title.trim() || `day-${post.date}`).replace(/[^\w-]+/g, '-') || 'hook';
        a.href = url;
        a.download = `${trip.name || 'trip'}-${slug}.png`.replace(/^-+/, '');
        a.click();
        URL.revokeObjectURL(url);
      } finally {
        source?.release();
      }
    } finally {
      setExporting(false);
    }
  }

  const fold = (id: string) => ({
    open: openFold === id,
    onToggle: () => setOpenFold((cur) => (cur === id ? null : id)),
  });

  return (
    <section
      className="@container flex flex-col flex-1 min-h-0 gap-4 overflow-auto"
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
          onClick={() => void exportPng()}
          disabled={exporting}
          className="px-[1.1rem] py-2 inline-flex items-center border border-ink rounded-full bg-ink text-paper cursor-pointer text-[0.82rem] font-semibold hover:bg-accent hover:border-accent disabled:opacity-60"
        >
          {exporting ? 'Rendering…' : '↓ Export PNG'}
        </button>
      </div>

      <div className="flex flex-col @min-[860px]:flex-row gap-5 min-h-0">
        <div className="flex-1 min-w-0 flex flex-col items-center gap-3">
          <BadgeStage
            file={activeFile}
            videoTimeSeconds={post.badge.videoTimeSeconds}
            aspect={aspect}
            elements={elements}
            theme={trip.theme}
            timeSeconds={time}
            onSourceLoaded={(info) => setDuration(info.duration)}
          />

          {animated && (
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

        <div className="flex-none w-full @min-[860px]:w-[22rem] flex flex-col gap-3">
          <div className={section}>
            <span className={legend}>Picture · from the Library</span>
            {activeFile ? (
              <p className="m-0 text-[0.8rem] text-ink-soft truncate" title={activeFile.name}>
                {activeFile.name}
              </p>
            ) : (
              <p className="m-0 text-[0.78rem] text-muted">
                {missing
                  ? `“${post.media?.name}” is not in the Library right now. The post keeps its day and its badge.`
                  : 'Tick a photo or a clip in the Library on the left — the badge composes over whatever is active there.'}
              </p>
            )}
            {isVideo && duration > 0 && (
              <label className="flex flex-col gap-1">
                <span className={legend}>
                  Frame · {post.badge.videoTimeSeconds.toFixed(1)}s
                </span>
                <input
                  type="range"
                  min={0}
                  max={Math.max(duration - 0.05, 0)}
                  step={0.1}
                  value={post.badge.videoTimeSeconds}
                  onChange={(e) =>
                    patchBadge({ videoTimeSeconds: Number(e.target.value) })
                  }
                  className="accent-accent"
                />
              </label>
            )}
          </div>

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

          <div className={section}>
            <span className={legend}>What it counts</span>
            <select
              value={post.badge.mode}
              onChange={(e) =>
                patchBadge({ mode: e.target.value as PostBadge['mode'] })
              }
              className={`${inputClass} cursor-pointer`}
            >
              {COUNTER_MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} — {m.hint}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-[0.8rem] text-ink-soft cursor-pointer">
              <input
                type="checkbox"
                checked={post.badge.showAnniversary}
                onChange={(e) => patchBadge({ showAnniversary: e.target.checked })}
                className="accent-accent"
              />
              Lead with “one year ago today”
            </label>
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
              <p className="m-0 text-[0.68rem] text-faint">
                “{'{n}'}” in the N-years line is replaced by the number of years.
              </p>
            </div>
          </Fold>

          {!content && (
            <p className="m-0 text-[0.78rem] text-[#9a3a23]" role="alert">
              This trip’s dates read backwards, so there is no total to count
              towards. Fix them and the badge comes back.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
