import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAssetLibrary } from '../../shared/library/AssetLibraryContext';
import type { Asset } from '../../shared/library/assets';
import { ASPECT_PRESETS, savedMediaRef } from '../../shared/projects/project-types';
import { TITLE_STYLE_PRESETS, themeFromPreset } from '../../shared/overlay/title-styles';
import type { Anchor } from '../../shared/overlay/overlay-types';
import { badgeContent, BADGE_LANGUAGES, COUNTER_MODES } from '../../shared/roadtrip/day-badge';
import { badgeElements } from '../../shared/roadtrip/badge-layout';
import { badgeToPng, frameSize, loadBadgeSource } from '../../shared/roadtrip/badge-render';
import { formatIsoDate } from '../../shared/roadtrip/trip-days';
import type { PostBadge, TripDoc, TripPost } from '../../shared/roadtrip/trip-types';
import BadgeStage from './BadgeStage';

interface PostEditorProps {
  trip: TripDoc;
  post: TripPost;
  onBack: () => void;
  onChangePost: (post: TripPost) => void;
  onChangeTrip: (trip: TripDoc) => void;
}

const legend = 'font-mono text-[0.62rem] tracking-[0.14em] uppercase text-muted';
const section = 'flex flex-col gap-2';

const MEDIA_KINDS = new Set(['photo', 'video', 'video+telemetry']);

/** The nine anchors, laid out as the 3×3 grid they are. */
const ANCHORS: Anchor[][] = [
  ['top-left', 'top-center', 'top-right'],
  ['center-left', 'center', 'center-right'],
  ['bottom-left', 'bottom-center', 'bottom-right'],
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

/**
 * Composing one post's hook: the picture, the badge over it, and the PNG that
 * comes out. The style is the TRIP's — a badge that varies per post stops being
 * a signature, which is the whole reason it exists — so the preset picker
 * writes to the trip while everything else writes to the post.
 */
export default function PostEditor({
  trip,
  post,
  onBack,
  onChangePost,
  onChangeTrip,
}: PostEditorProps) {
  const lib = useAssetLibrary();
  const [exporting, setExporting] = useState(false);
  const [duration, setDuration] = useState(0);

  const candidates = useMemo(
    () => lib.assets.filter((a) => MEDIA_KINDS.has(a.kind) && pickable(a)),
    [lib.assets],
  );

  /** The library file matching the post's hint, if it is loaded right now. */
  const file = useMemo(() => {
    if (!post.media) return null;
    const want = post.media.name.toLowerCase();
    for (const asset of candidates) {
      const f = pickable(asset);
      if (f && f.name.toLowerCase() === want) return f;
    }
    return null;
  }, [post.media, candidates]);

  const missing = post.media !== null && file === null;
  const isVideo = Boolean(file && !file.type.startsWith('image/'));

  const aspectPreset =
    ASPECT_PRESETS.find((a) => a.id === post.badge.aspectId) ?? ASPECT_PRESETS[0];
  const aspect = aspectPreset.w / aspectPreset.h;

  const content = useMemo(
    () =>
      badgeContent(trip, post, {
        mode: post.badge.mode,
        language: trip.badgeLanguage,
        showAnniversary: post.badge.showAnniversary,
      }),
    [trip, post],
  );

  const elements = useMemo(
    () => (content ? badgeElements(content, post.badge.layout, aspect) : []),
    [content, post.badge.layout, aspect],
  );

  const patchBadge = useCallback(
    (patch: Partial<PostBadge>) =>
      onChangePost({ ...post, badge: { ...post.badge, ...patch } }),
    [post, onChangePost],
  );

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
      const els = content ? badgeElements(content, post.badge.layout, aspect) : [];
      const source = file
        ? await loadBadgeSource(file, post.badge.videoTimeSeconds)
        : null;
      try {
        const blob = await badgeToPng({
          source,
          elements: els,
          theme: trip.theme,
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
        <div className="flex-1 min-w-0 flex items-start justify-center">
          <BadgeStage
            file={file}
            videoTimeSeconds={post.badge.videoTimeSeconds}
            aspect={aspect}
            elements={elements}
            theme={trip.theme}
            onSourceLoaded={(info) => setDuration(info.duration)}
          />
        </div>

        <div className="flex-none w-full @min-[860px]:w-[21rem] flex flex-col gap-5">
          <div className={section}>
            <span className={legend}>Picture</span>
            {candidates.length === 0 ? (
              <p className="m-0 text-[0.78rem] text-muted">
                Nothing in the Library yet — add files on the left and they show
                up here.
              </p>
            ) : (
              <select
                value={post.media?.name ?? ''}
                onChange={(e) => {
                  const chosen = candidates
                    .map(pickable)
                    .find((f) => f && f.name === e.target.value);
                  onChangePost({ ...post, media: chosen ? savedMediaRef(chosen) : null });
                }}
                className="font-sans text-[0.85rem] px-3 py-2 border border-line-strong rounded-paper bg-paper text-ink cursor-pointer focus:outline-none focus:border-accent"
              >
                <option value="">No picture — badge alone</option>
                {candidates.map((asset) => {
                  const f = pickable(asset)!;
                  return (
                    <option key={asset.id} value={f.name}>
                      {f.name}
                    </option>
                  );
                })}
              </select>
            )}
            {missing && (
              <p className="m-0 text-[0.75rem] text-muted">
                “{post.media?.name}” is not in the Library right now. The post
                keeps its day and its badge — add the folder back to see the
                picture again.
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
            <div className="grid grid-cols-2 gap-2">
              {ASPECT_PRESETS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => patchBadge({ aspectId: a.id })}
                  aria-pressed={a.id === post.badge.aspectId}
                  className={`px-3 py-2 rounded-paper border text-left cursor-pointer text-[0.78rem] transition-colors ${
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
              className="font-sans text-[0.85rem] px-3 py-2 border border-line-strong rounded-paper bg-paper text-ink cursor-pointer focus:outline-none focus:border-accent"
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
            {post.badge.showAnniversary && content && !/\d+\s*(an|year)/i.test(content.kicker ?? '') && (
              <p className="m-0 text-[0.72rem] text-faint">
                Less than a year has passed, so the trip’s name is used instead —
                nothing claims an anniversary that has not come round.
              </p>
            )}
          </div>

          <div className={section}>
            <span className={legend}>Style · shared by the whole trip</span>
            <select
              value={trip.theme?.presetId ?? ''}
              onChange={(e) =>
                onChangeTrip({ ...trip, theme: themeFromPreset(e.target.value) })
              }
              className="font-sans text-[0.85rem] px-3 py-2 border border-line-strong rounded-paper bg-paper text-ink cursor-pointer focus:outline-none focus:border-accent"
            >
              {TITLE_STYLE_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.tagline}
                </option>
              ))}
            </select>
            <select
              value={trip.badgeLanguage}
              onChange={(e) =>
                onChangeTrip({
                  ...trip,
                  badgeLanguage: e.target.value as TripDoc['badgeLanguage'],
                })
              }
              className="font-sans text-[0.85rem] px-3 py-2 border border-line-strong rounded-paper bg-paper text-ink cursor-pointer focus:outline-none focus:border-accent"
            >
              {BADGE_LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>
                  Badge language · {l.label}
                </option>
              ))}
            </select>
          </div>

          <div className={section}>
            <span className={legend}>Placement</span>
            <div className="grid grid-cols-3 gap-1.5 w-[7.5rem]">
              {ANCHORS.flat().map((anchor) => (
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
                  className={`h-8 rounded-[4px] border cursor-pointer transition-colors ${
                    anchor === post.badge.layout.anchor
                      ? 'border-accent bg-accent'
                      : 'border-line bg-paper hover:border-line-strong'
                  }`}
                />
              ))}
            </div>
            <label className="flex flex-col gap-1">
              <span className={legend}>
                Numeral size · {Math.round(post.badge.layout.sizeFrac * 100)}%
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
