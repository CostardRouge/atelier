import { useEffect, useRef } from 'react';
import SectionLegend from '../../shared/ui/SectionLegend';
import type { CtaLayout } from '../../shared/roadtrip/cta-slide';
import {
  DEFAULT_BADGE_WORDS,
  FRENCH_BADGE_WORDS,
  WORD_FIELDS,
  type BadgeWords,
} from '../../shared/roadtrip/day-badge';
import { TIME_AGO_WORD_FIELDS, type TimeAgoWords } from '../../shared/roadtrip/time-ago';
import {
  POST_KINDS,
  defaultPostBadge,
  hookDefaultsFrom,
  type PostBadge,
  type TripDoc,
  type TripPost,
} from '../../shared/roadtrip/trip-types';
import CtaPanel, { type CtaFieldRefs } from './CtaPanel';
import { dangerLink, inputClass, smallButton } from './panels/ui';

/** Which part of the sheet a click on the stage asked for. */
export type TripSettingsSection = 'words' | 'cta' | 'defaults';

interface TripSettingsModalProps {
  trip: TripDoc;
  /** The piece in hand — only for its kind, which is what a default is filed under. */
  post: TripPost;
  /** The closing card as laid out for this piece, for its QR problem. */
  cta: CtaLayout;
  section: TripSettingsSection;
  ctaFieldRefs: CtaFieldRefs;
  onChangeTrip: (trip: TripDoc) => void;
  patchBadge: (patch: Partial<PostBadge>) => void;
  onClose: () => void;
}

/**
 * Everything shared by the WHOLE trip, in one sheet.
 *
 * These controls used to sit inside the per-piece inspector with the words
 * "· shared by the whole trip" appended to their legends — so scope was a
 * sentence you had to read rather than a place you were in, and four of the
 * six tabs were partly about the trip. They move here, where the Studio keeps
 * a project's own settings: one ⚙ in the piece's bar, and the inspector is
 * about the piece again.
 *
 * Nothing is computed here and nothing autosaves differently: the trip is
 * written through `onChangeTrip` exactly as before, on every keystroke.
 */
export default function TripSettingsModal({
  trip,
  post,
  cta,
  section,
  ctaFieldRefs,
  onChangeTrip,
  patchBadge,
  onClose,
}: TripSettingsModalProps) {
  const wordsRef = useRef<HTMLDivElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);
  const defaultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // Mount-only: the sheet is short-lived, like the studio's own modals.
  }, [onClose]);

  // Opened from a click on the closing card, the sheet must land on it —
  // scrolling a modal to find what you just clicked is the friction this
  // whole pass is about.
  useEffect(() => {
    const target =
      section === 'cta' ? ctaRef : section === 'defaults' ? defaultsRef : wordsRef;
    target.current?.scrollIntoView({ block: 'start' });
  }, [section]);

  const patchWords = (patch: Partial<BadgeWords>) =>
    onChangeTrip({ ...trip, badgeWords: { ...trip.badgeWords, ...patch } });

  const patchTimeWords = (patch: Partial<TimeAgoWords>) =>
    onChangeTrip({
      ...trip,
      badgeWords: { ...trip.badgeWords, time: { ...trip.badgeWords.time, ...patch } },
    });

  const savedDefault = trip.hookDefaults[post.kind] ?? null;
  const kindLabel =
    POST_KINDS.find((k) => k.id === post.kind)?.label.toLowerCase() ?? post.kind;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(20,18,15,0.45)] backdrop-blur-[2px] max-[820px]:p-0"
      role="dialog"
      aria-modal="true"
      aria-label="Trip settings"
    >
      <div className="w-full max-w-[32rem] max-h-[90dvh] overflow-auto flex flex-col gap-5 bg-surface border border-line rounded-paper-lg shadow-paper px-6 pt-6 max-[820px]:max-w-none max-[820px]:h-dvh max-[820px]:max-h-none max-[820px]:rounded-none max-[820px]:border-0">
        <div className="flex items-baseline gap-3">
          <h2 className="m-0 font-serif text-[1.4rem]">Trip settings</h2>
          <span className="font-mono text-[0.68rem] text-muted truncate">{trip.name}</span>
        </div>

        <div ref={wordsRef} className="flex flex-col gap-2">
          <SectionLegend label="Words">
            <p>
              Every word the badge can say. English is only the default — a deck in
              another language is these fields, not a second vocabulary in the code.
            </p>
            <p>
              “{'{n}'}” is replaced by the quantity, “{'{date}'}” by the picture’s own
              day.
            </p>
          </SectionLegend>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onChangeTrip({ ...trip, badgeWords: { ...DEFAULT_BADGE_WORDS } })}
              className={`flex-1 ${smallButton} font-normal`}
            >
              English
            </button>
            <button
              type="button"
              onClick={() => onChangeTrip({ ...trip, badgeWords: { ...FRENCH_BADGE_WORDS } })}
              className={`flex-1 ${smallButton} font-normal`}
            >
              Français
            </button>
          </div>
          {WORD_FIELDS.map((f) => (
            <label key={f.key} className="flex items-center gap-2">
              <span className="w-28 flex-none text-[0.72rem] text-muted">{f.label}</span>
              <input
                value={trip.badgeWords[f.key]}
                onChange={(e) => patchWords({ [f.key]: e.target.value })}
                className={`${inputClass} flex-1 min-w-0 max-[820px]:text-base`}
              />
            </label>
          ))}
          <span className="font-mono text-[0.62rem] tracking-[0.14em] uppercase text-muted pt-2">
            Time
          </span>
          {TIME_AGO_WORD_FIELDS.map((f) => (
            <label key={f.key} className="flex items-center gap-2">
              <span className="w-28 flex-none text-[0.72rem] text-muted">{f.label}</span>
              <input
                value={trip.badgeWords.time[f.key]}
                onChange={(e) => patchTimeWords({ [f.key]: e.target.value })}
                className={`${inputClass} flex-1 min-w-0 max-[820px]:text-base`}
              />
            </label>
          ))}
        </div>

        <div ref={ctaRef} className="flex flex-col gap-2 pt-1 border-t border-line">
          <SectionLegend label="Closing card">
            <p>
              The slide every deck of this trip can close with — one template, never
              re-authored per piece. Whether a given piece uses it is decided on its own
              slide rail.
            </p>
          </SectionLegend>
          <CtaPanel
            cta={trip.cta}
            onChange={(next) => onChangeTrip({ ...trip, cta: next })}
            problem={cta.qrProblem}
            fieldRefs={ctaFieldRefs}
          />
        </div>

        <div ref={defaultsRef} className="flex flex-col gap-2 pt-1 border-t border-line">
          <SectionLegend label={`New pieces · ${kindLabel}`}>
            <p>
              The frame, the placement, the shades, the per-piece styling and what a
              piece counts — kept for the next {kindLabel} of this trip. What a piece
              says about a particular day is never inherited.
            </p>
          </SectionLegend>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() =>
                onChangeTrip({
                  ...trip,
                  hookDefaults: {
                    ...trip.hookDefaults,
                    [post.kind]: hookDefaultsFrom(post.badge),
                  },
                })
              }
              className={smallButton}
            >
              Save this piece as the default
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

        <div className="sticky bottom-0 -mx-6 mt-4 px-6 pb-6 flex items-center justify-end gap-4 pt-1 border-t border-line bg-surface max-[820px]:pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={onClose}
            className="h-[2.1rem] px-[1.1rem] inline-flex items-center border border-ink rounded-full bg-ink text-paper cursor-pointer text-[0.82rem] font-semibold hover:bg-accent hover:border-accent"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
