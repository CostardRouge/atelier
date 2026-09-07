import { useEffect, useState } from 'react';
import { downloadBlob } from '../../shared/media/save';
import SectionLegend from '../../shared/ui/SectionLegend';
import type { CtaLayout } from '../../shared/roadtrip/cta-slide';
import {
  DEFAULT_BADGE_WORDS,
  FRENCH_BADGE_WORDS,
  WORD_FIELDS,
  type BadgeWords,
} from '../../shared/roadtrip/day-badge';
import { TIME_AGO_WORD_FIELDS, type TimeAgoWords } from '../../shared/roadtrip/time-ago';
import { serializeTripFile, toTripFile, tripFileName } from '../../shared/roadtrip/trip-file';
import { spanLength } from '../../shared/roadtrip/trip-days';
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

/** Which part of the sheet a click asked for. */
export type TripSettingsSection = 'words' | 'cta' | 'defaults';

const SECTIONS: Array<{ id: TripSettingsSection; label: string }> = [
  { id: 'words', label: 'Words' },
  { id: 'cta', label: 'Closing card' },
  { id: 'defaults', label: 'New pieces' },
];

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
 * A rail of sections beside one pane, rather than a single long scroll: the
 * three areas have nothing to do with each other, and a sheet you have to
 * scroll to discover is the fault this whole pass is about. Under 820px the
 * sheet is the whole screen and shows ONE pane at a time — the rail, then the
 * section, with a way back — never both stacked in a height that cannot grow
 * (`frontend.md`).
 *
 * The trip's TITLE STYLE is deliberately not here: it is chosen constantly
 * while composing, and its preset cards draw the style itself, so it stays a
 * click away on the Look tab. Stages are edited on the trip's Overview, which
 * is one control away in the same bar.
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
  const [open, setOpen] = useState<TripSettingsSection>(section);
  // Narrow only: the rail and the pane are two screens, and this says which.
  const [showRail, setShowRail] = useState(false);

  // A click on the closing card on the stage opens the sheet AT that card,
  // whether or not the sheet was already up.
  useEffect(() => {
    setOpen(section);
    setShowRail(false);
  }, [section]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // Mount-only: the sheet is short-lived, like the studio's own modals.
  }, [onClose]);

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

  const days = spanLength(trip.startDate, trip.endDate);
  const facts = [
    days === null ? null : `${days} day${days === 1 ? '' : 's'}`,
    `${trip.posts.length} piece${trip.posts.length === 1 ? '' : 's'}`,
  ]
    .filter(Boolean)
    .join(' · ');

  /** The whole trip on disk — a backup, and how it reaches another machine. */
  function backUp() {
    downloadBlob(
      new Blob([serializeTripFile(toTripFile(trip))], { type: 'application/json' }),
      tripFileName(trip.name),
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(20,18,15,0.45)] backdrop-blur-[2px] max-[820px]:p-0"
      role="dialog"
      aria-modal="true"
      aria-label="Trip settings"
    >
      <div className="w-full max-w-[52rem] h-[min(90dvh,40rem)] flex flex-col overflow-hidden bg-surface border border-line rounded-paper-lg shadow-paper max-[820px]:max-w-none max-[820px]:h-dvh max-[820px]:rounded-none max-[820px]:border-0">
        <div className="flex-none flex items-baseline gap-3 px-6 pt-[1.4rem] pb-3.5 border-b border-line">
          <h2 className="m-0 flex-none whitespace-nowrap font-serif text-[1.4rem]">Trip settings</h2>
          <span className="min-w-0 font-mono text-[0.68rem] text-muted truncate">
            {trip.name} · {facts}
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the trip settings"
            className="flex-none w-7 h-7 grid place-items-center rounded-full border border-line text-[1.05rem] leading-none text-muted cursor-pointer hover:border-accent hover:text-accent-ink"
          >
            ×
          </button>
        </div>

        <div className="flex-1 min-h-0 flex">
          {/* The rail. Wide it is always there; narrow it IS the first screen,
              and picking a section replaces it — a drill-down, never a stack. */}
          <div
            className={`flex-none w-[13rem] flex flex-col gap-[3px] px-3 py-4 border-r border-line overflow-y-auto max-[820px]:w-full max-[820px]:border-r-0 ${
              showRail ? 'max-[820px]:flex' : 'max-[820px]:hidden'
            }`}
          >
            <span className="font-mono text-[0.6rem] tracking-[0.14em] uppercase text-muted px-3 pt-1 pb-2">
              Shared by the whole trip
            </span>
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setOpen(s.id);
                  setShowRail(false);
                }}
                aria-current={s.id === open}
                className={`text-left px-3 py-2 rounded-paper text-[0.82rem] cursor-pointer transition-colors max-[820px]:text-base max-[820px]:py-2.5 ${
                  s.id === open
                    ? 'bg-accent-wash text-accent-ink font-semibold'
                    : 'text-ink-soft hover:bg-paper-2'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div
            className={`flex-1 min-w-0 flex flex-col gap-4 px-6 py-5 overflow-y-auto overscroll-contain ${
              showRail ? 'max-[820px]:hidden' : 'max-[820px]:flex'
            }`}
          >
            <button
              type="button"
              onClick={() => setShowRail(true)}
              className="hidden max-[820px]:inline-flex self-start items-center h-[2rem] px-3 rounded-full border border-line-strong bg-paper text-[0.82rem] font-semibold text-ink-soft cursor-pointer"
            >
              ‹ All settings
            </button>

            {open === 'words' && (
              <>
                <SectionLegend label="Words">
                  <p>
                    Every word the badge can say. English is only the default — a deck
                    in another language is these fields, not a second vocabulary in the
                    code.
                  </p>
                  <p>
                    “{'{n}'}” is replaced by the quantity, “{'{date}'}” by the picture’s
                    own day.
                  </p>
                </SectionLegend>
                <div className="flex gap-2 max-w-[18rem]">
                  <button
                    type="button"
                    onClick={() =>
                      onChangeTrip({ ...trip, badgeWords: { ...DEFAULT_BADGE_WORDS } })
                    }
                    className={`flex-1 ${smallButton} font-normal`}
                  >
                    English
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onChangeTrip({ ...trip, badgeWords: { ...FRENCH_BADGE_WORDS } })
                    }
                    className={`flex-1 ${smallButton} font-normal`}
                  >
                    Français
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 max-[820px]:grid-cols-1">
                  {WORD_FIELDS.map((f) => (
                    <label key={f.key} className="flex items-center gap-2.5">
                      <span className="w-[6.5rem] flex-none text-[0.72rem] text-muted">
                        {f.label}
                      </span>
                      <input
                        value={trip.badgeWords[f.key]}
                        onChange={(e) => patchWords({ [f.key]: e.target.value })}
                        className={`${inputClass} flex-1 min-w-0 max-[820px]:text-base`}
                      />
                    </label>
                  ))}
                </div>
                <span className="font-mono text-[0.62rem] tracking-[0.14em] uppercase text-muted">
                  Time
                </span>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 max-[820px]:grid-cols-1">
                  {TIME_AGO_WORD_FIELDS.map((f) => (
                    <label key={f.key} className="flex items-center gap-2.5">
                      <span className="w-[6.5rem] flex-none text-[0.72rem] text-muted">
                        {f.label}
                      </span>
                      <input
                        value={trip.badgeWords.time[f.key]}
                        onChange={(e) => patchTimeWords({ [f.key]: e.target.value })}
                        className={`${inputClass} flex-1 min-w-0 max-[820px]:text-base`}
                      />
                    </label>
                  ))}
                </div>
              </>
            )}

            {open === 'cta' && (
              <>
                <SectionLegend label="Closing card">
                  <p>
                    The slide every deck of this trip can close with — one template,
                    never re-authored per piece. Whether a given piece uses it is
                    decided on its own slide rail.
                  </p>
                </SectionLegend>
                <div className="max-w-[28rem]">
                  <CtaPanel
                    cta={trip.cta}
                    onChange={(next) => onChangeTrip({ ...trip, cta: next })}
                    problem={cta.qrProblem}
                    fieldRefs={ctaFieldRefs}
                  />
                </div>
              </>
            )}

            {open === 'defaults' && (
              <>
                <SectionLegend label={`New pieces · ${kindLabel}`}>
                  <p>
                    The frame, the placement, the shades, the per-piece styling and what
                    a piece counts — kept for the next {kindLabel} of this trip. What a
                    piece says about a particular day is never inherited.
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
              </>
            )}
          </div>
        </div>

        <div className="flex-none flex items-center gap-4 px-6 py-3.5 border-t border-line bg-surface max-[820px]:pb-[max(0.875rem,env(safe-area-inset-bottom))]">
          <button type="button" onClick={backUp} className={smallButton}>
            ↓ Back up the trip
          </button>
          <span className="flex-1" />
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
