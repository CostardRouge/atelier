import { useState } from 'react';
import type { CtaLayout } from '../../../shared/roadtrip/cta-slide';
import type { DeckSlide } from '../../../shared/roadtrip/deck';
import {
  POST_KINDS,
  defaultPostBadge,
  hookDefaultsFrom,
  type PostBadge,
  type TripDoc,
  type TripPost,
} from '../../../shared/roadtrip/trip-types';
import CtaPanel, { type CtaFieldRefs } from '../CtaPanel';
import { dangerLink, legend, section, smallButton } from './ui';

interface DeckTabProps {
  trip: TripDoc;
  post: TripPost;
  slides: DeckSlide[];
  slideIndex: number;
  /** The slide in hand, when it is a content picture; -1 otherwise. */
  contentIndex: number;
  /** The closing card as laid out for this piece, for its QR problem. */
  cta: CtaLayout;
  onSelectSlide: (index: number) => void;
  onAddSlide: () => void;
  onRemoveSlide: () => void;
  /** Indices into `post.slides`, content pictures only. */
  onMoveSlide: (from: number, to: number) => void;
  onChangePost: (post: TripPost) => void;
  onChangeTrip: (trip: TripDoc) => void;
  patchBadge: (patch: Partial<PostBadge>) => void;
  /** The closing card's fields, which a click on the card focuses. */
  ctaFieldRefs: CtaFieldRefs;
}

/**
 * The deck as a whole: which pictures go out in what order, whether the
 * trip's call to action closes it, what that card says, and what a new piece
 * of this kind starts from. Everything here is about the PIECE or the TRIP,
 * so nothing in it is hidden behind which slide happens to be open.
 */
export default function DeckTab({
  trip,
  post,
  slides,
  slideIndex,
  contentIndex,
  cta,
  onSelectSlide,
  onAddSlide,
  onRemoveSlide,
  onMoveSlide,
  onChangePost,
  onChangeTrip,
  patchBadge,
  ctaFieldRefs,
}: DeckTabProps) {
  // --- reordering the middle of the deck -----------------------------------
  // Only the content pictures move: the hook opens the piece and the call to
  // action closes it, and a deck where either drifted into the middle would
  // stop working. Indices below are into `post.slides`; the strip adds one for
  // the hook when it needs a deck position.
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const savedDefault = trip.hookDefaults[post.kind] ?? null;

  return (
    <div className="flex flex-col gap-4">
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
                onClick={() => onSelectSlide(i)}
                aria-pressed={i === slideIndex}
                title={s.kind === 'content' ? `Slide ${s.position} — drag to reorder` : s.kind}
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
                  onMoveSlide(dragFrom, ci);
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
                {s.kind === 'hook' ? 'Hook' : s.kind === 'cta' ? 'Call to action' : s.position}
              </button>
            );
          })}
          <button type="button" onClick={onAddSlide} className={smallButton}>
            + Slide
          </button>
        </div>
        {contentIndex >= 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className={legend}>Order</span>
            <button
              type="button"
              onClick={() => onMoveSlide(contentIndex, contentIndex - 1)}
              disabled={contentIndex <= 0}
              aria-label="Move this slide earlier"
              className={`${smallButton} px-2 py-1 text-[0.72rem] font-normal`}
            >
              ← Earlier
            </button>
            <button
              type="button"
              onClick={() => onMoveSlide(contentIndex, contentIndex + 1)}
              disabled={contentIndex >= post.slides.length - 1}
              aria-label="Move this slide later"
              className={`${smallButton} px-2 py-1 text-[0.72rem] font-normal`}
            >
              Later →
            </button>
            <span className="text-[0.72rem] text-faint">or drag it in the strip</span>
            <button
              type="button"
              onClick={onRemoveSlide}
              className={`ml-auto ${dangerLink}`}
            >
              Remove this slide
            </button>
          </div>
        )}
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

      <div className={section}>
        <span className={legend}>Closing card · shared by the whole trip</span>
        <CtaPanel
          cta={trip.cta}
          onChange={(next) => onChangeTrip({ ...trip, cta: next })}
          problem={cta.qrProblem}
          fieldRefs={ctaFieldRefs}
        />
      </div>

      <div className={section}>
        <span className={legend}>Defaults · what a new piece starts from</span>
        <p className="m-0 text-[0.78rem] text-ink-soft">
          The frame, the placement, the shades, the per-piece styling and what this piece
          counts — kept for the next{' '}
          {POST_KINDS.find((k) => k.id === post.kind)?.label.toLowerCase() ?? post.kind} of
          this trip. What it says about a particular day is never inherited.
        </p>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() =>
              onChangeTrip({
                ...trip,
                hookDefaults: { ...trip.hookDefaults, [post.kind]: hookDefaultsFrom(post.badge) },
              })
            }
            className={smallButton}
          >
            Save as the default
          </button>
          {savedDefault && (
            <>
              <button
                type="button"
                onClick={() =>
                  patchBadge({
                    ...defaultPostBadge(post.kind, savedDefault),
                    // The day, the frame of the clip and the author's own
                    // words belong to this piece, not to the default.
                    referenceDate: post.badge.referenceDate,
                    videoTimeSeconds: post.badge.videoTimeSeconds,
                    textOverrides: post.badge.textOverrides,
                  })
                }
                className={`${smallButton} font-normal`}
              >
                Apply it to this piece
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = { ...trip.hookDefaults };
                  delete next[post.kind];
                  onChangeTrip({ ...trip, hookDefaults: next });
                }}
                className={dangerLink}
              >
                Forget it
              </button>
            </>
          )}
        </div>
        {!savedDefault && (
          <span className="text-[0.7rem] text-faint">
            Nothing saved yet — new pieces start from the factory look.
          </span>
        )}
      </div>
    </div>
  );
}
