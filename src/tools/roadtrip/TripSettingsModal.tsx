import { useEffect, useMemo, useState, type ReactNode } from 'react';
import SectionLegend from '../../shared/ui/SectionLegend';
import InfoDot from '../../shared/ui/InfoDot';
import IconButton from '../../shared/ui/IconButton';
import { buttonClass } from '../../shared/ui/Button';
import { Icons } from '../../shared/ui/icons';
import { useIsCompact } from '../../shared/ui/use-layout-mode';
import useDialogKeys from '../../shared/ui/use-dialog-keys';
import type { CtaLayout } from '../../shared/roadtrip/cta-slide';
import {
  DEFAULT_BADGE_WORDS,
  FRENCH_BADGE_WORDS,
  WORD_FIELDS,
  type BadgeWords,
} from '../../shared/roadtrip/day-badge';
import { TIME_AGO_WORD_FIELDS, type TimeAgoWords } from '../../shared/roadtrip/time-ago';
import { CAMERA_FIELDS, type CameraField } from '../../shared/exif/camera-facts';
import { DEFAULT_CAMERA_WORDS } from '../../shared/overlay/camera-plate';
import { formatIsoDate, spanLength } from '../../shared/roadtrip/trip-days';
import { prunePins } from '../../shared/roadtrip/trip-cover';
import {
  POST_KINDS,
  defaultPostBadge,
  hookDefaultsFrom,
  type PostBadge,
  type PostKind,
  type TripDoc,
  type TripPost,
} from '../../shared/roadtrip/trip-types';
import CrossingsPanel from './CrossingsPanel';
import FleetPanel from './FleetPanel';
import CtaPanel, { type CtaFieldRefs } from './CtaPanel';
import CoverPanel from './CoverPanel';
import TripDatesSection from './TripDatesSection';
import TripKeepSection from './TripKeepSection';
import HouseStylePanel from './HouseStylePanel';
import PlacesSettingsPanel, { PLACES_ABOUT } from './PlacesSettingsPanel';
import RoadSettingsPanel, { ROAD_ABOUT } from './RoadSettingsPanel';
import { DEFAULT_ROAD_DETAIL, DEFAULT_ROAD_MODE } from '../../shared/roadtrip/road-track';
import { dangerLink, inputClass, smallButton } from './panels/ui';

/** Which part of the sheet a click asked for. */
export type TripSettingsSection =
  | 'dates'
  | 'cover'
  | 'places'
  | 'road'
  | 'car'
  | 'words'
  | 'cta'
  | 'defaults'
  | 'keep'
  | 'house';

/** The rail, in four groups — the trip itself, how it speaks, its pieces, keeping it. */
const GROUPS: Array<{ label: string; sections: Array<{ id: TripSettingsSection; label: string }> }> = [
  {
    label: 'The trip',
    sections: [
      { id: 'dates', label: 'Name and dates' },
      { id: 'cover', label: 'Cover' },
      { id: 'places', label: 'Places' },
      { id: 'road', label: 'Road' },
      { id: 'car', label: 'Vehicle' },
    ],
  },
  {
    label: 'How it speaks',
    sections: [
      { id: 'words', label: 'Badge words' },
      { id: 'cta', label: 'Closing card' },
    ],
  },
  { label: 'Pieces', sections: [{ id: 'defaults', label: 'New pieces' }] },
  {
    label: 'Keep',
    sections: [
      { id: 'keep', label: 'Backup and start over' },
      // The dev server alone can write the house style into the repository;
      // the built site never draws this section, and Vite drops the panel.
      ...(import.meta.env.DEV ? [{ id: 'house' as const, label: 'House style' }] : []),
    ],
  },
];

/** Each section's name, as the rail and the pane's heading say it. */
const TITLE = Object.fromEntries(GROUPS.flatMap((g) => g.sections.map((s) => [s.id, s.label]))) as Record<
  TripSettingsSection,
  string
>;

/** The sections drawn across the whole pane — a map, a turning vehicle; the rest keep a reading column. */
const WIDE: ReadonlySet<TripSettingsSection> = new Set(['road', 'car']);

/** The standing why of each section, folded behind the ⓘ beside its heading. */
const ABOUT: Partial<Record<TripSettingsSection, ReactNode>> = {
  cover: (
    <p>
      How the trip shows itself in the gallery. Pin up to three pieces; what you leave unpinned fills from the trip&apos;s
      busiest days.
    </p>
  ),
  places: PLACES_ABOUT,
  road: ROAD_ABOUT,
  car: (
    <>
      <p>
        The vehicles this trip drives — the main one on every stage that names no other — and how each changed on the
        way, dated. A piece shows a vehicle as it was on the piece’s own day. A stage can name another in its card, a
        place the vehicle it was reached by. They travel in the trip’s backup.
      </p>
      <p>Drag the vehicle to turn it. The angle here is only a look: it is never kept, and never becomes a piece’s camera.</p>
    </>
  ),
  words: (
    <>
      <p>
        Every word the badge can say. English is only the default — a deck in another language is these fields, not a
        second vocabulary in the code.
      </p>
      <p>“{'{n}'}” is replaced by the quantity, “{'{date}'}” by the picture’s own day.</p>
    </>
  ),
  cta: (
    <p>
      The slide every deck of this trip can close with — one template, never re-authored per piece. Whether a given piece
      uses it is decided on its own slide rail.
    </p>
  ),
  defaults: (
    <>
      <p>
        The frame, the opener, the placement, the shades, the per-piece styling and what a piece counts — kept per kind
        for the next piece of this trip. What a piece says about a particular day is never inherited.
      </p>
      <p>A look is saved from a piece: its ⚙ shows «This piece» here.</p>
    </>
  ),
};

interface TripSettingsModalProps {
  trip: TripDoc;
  /**
   * The piece the sheet was opened from, when it was — what «This piece» in
   * New pieces saves and resets. Absent: opened from the overview.
   */
  post?: TripPost;
  /** The closing card as laid out for that piece, for its QR problem. */
  cta?: CtaLayout;
  section: TripSettingsSection;
  /**
   * The click named THIS section (the dates under the heading, the closing
   * card on the stage, the gallery card's cover) — so a phone opens on it
   * too. Absent, a phone opens on the list of sections, the way a settings
   * screen does, and a wide screen on `section` beside the rail.
   */
  land?: boolean;
  ctaFieldRefs?: CtaFieldRefs;
  onChangeTrip: (trip: TripDoc) => void;
  /** Writes the piece's badge — with `post`. */
  patchBadge?: (patch: Partial<PostBadge>) => void;
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
 * four areas have nothing to do with each other, and a sheet you have to
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
 * The sheet is large on a desktop (80rem × 54rem at most) so the Car
 * section can hold the rail, the turning car and its choices side by side.
 *
 * Nothing is computed here and nothing autosaves differently: the trip is
 * written through `onChangeTrip` exactly as before, on every keystroke.
 */
export default function TripSettingsModal({
  trip,
  post,
  cta,
  section,
  land = false,
  ctaFieldRefs,
  onChangeTrip,
  patchBadge,
  onClose,
}: TripSettingsModalProps) {
  const [open, setOpen] = useState<TripSettingsSection>(section);
  // A question or a map of a section is up: its keys, not this sheet's.
  const [roadNested, setRoadNested] = useState(false);
  const [keepNested, setKeepNested] = useState(false);
  const nested = roadNested || keepNested;
  // Narrow only: the rail and the pane are two screens, and this says which.
  const compact = useIsCompact();
  const [showRail, setShowRail] = useState(() => compact && !land);

  // A click on the closing card on the stage opens the sheet AT that card,
  // whether or not the sheet was already up.
  useEffect(() => {
    setOpen(section);
    setShowRail(compact && !land);
    // The width is read when the sheet is asked for, not followed after.
  }, [section, land]);

  // Nothing here is applied on a button — the trip is written on every
  // keystroke — so the sheet's primary action IS closing it: Enter says
  // "done" from any field, and Escape dismisses it.
  useDialogKeys({ onCancel: nested ? undefined : onClose, onConfirm: nested ? null : onClose });

  const patchWords = (patch: Partial<BadgeWords>) =>
    onChangeTrip({ ...trip, badgeWords: { ...trip.badgeWords, ...patch } });

  const patchTimeWords = (patch: Partial<TimeAgoWords>) =>
    onChangeTrip({
      ...trip,
      badgeWords: { ...trip.badgeWords, time: { ...trip.badgeWords.time, ...patch } },
    });

  // What was TYPED, blanks included — a field that snapped back to its
  // default the moment it was emptied could not be retyped. The drawing reads
  // a blank as the default (`cameraWordsOf`).
  const cameraWords = {
    shotOn: trip.badgeWords.camera?.shotOn ?? DEFAULT_CAMERA_WORDS.shotOn,
    tags: { ...DEFAULT_CAMERA_WORDS.tags, ...trip.badgeWords.camera?.tags },
  };
  const patchCameraWords = (patch: { shotOn?: string; tag?: [CameraField, string] }) =>
    patchWords({
      camera: {
        shotOn: patch.shotOn ?? cameraWords.shotOn,
        tags: patch.tag ? { ...cameraWords.tags, [patch.tag[0]]: patch.tag[1] } : cameraWords.tags,
      },
    });

  const savedDefault = post ? (trip.hookDefaults[post.kind] ?? null) : null;
  const kindLabel = (kind: PostKind) => POST_KINDS.find((k) => k.id === kind)?.label.toLowerCase() ?? kind;
  const pieceLabel = post ? `${POST_KINDS.find((k) => k.id === post.kind)?.label ?? post.kind} · ${formatIsoDate(post.date)}` : null;

  // The trip's located places in lived order — what the road's map draws.
  const roadPlaces = useMemo(
    () =>
      [...trip.stages]
        .sort((p, q) => p.startDate.localeCompare(q.startDate))
        .flatMap((st) => st.places.flatMap((pl) => (pl.coords ? [{ lat: pl.coords.lat, lon: pl.coords.lon }] : []))),
    [trip.stages],
  );

  const days = spanLength(trip.startDate, trip.endDate);
  const facts = [
    days === null ? null : `${days} day${days === 1 ? '' : 's'}`,
    `${trip.posts.length} piece${trip.posts.length === 1 ? '' : 's'}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(20,18,15,0.45)] backdrop-blur-[2px] max-[820px]:p-0"
      role="dialog"
      aria-modal="true"
      aria-label="Trip settings"
    >
      <div className="w-full max-w-[80rem] h-[min(calc(var(--app-h)*0.9),54rem)] flex flex-col overflow-hidden bg-surface border border-line rounded-paper-lg shadow-paper max-[820px]:max-w-none max-[820px]:h-[var(--app-h)] max-[820px]:rounded-none max-[820px]:border-0">
        {/* Wide: the title, the trip it is about, ×. Narrow, the bar of a
            drill-down: the list of sections is the first screen, a section
            the second with its way back, and Done where a phone puts it. */}
        <div className="flex-none flex items-center gap-3 px-6 pt-[1.4rem] pb-3.5 border-b border-line max-[820px]:px-3 max-[820px]:pt-[max(0.625rem,env(safe-area-inset-top))] max-[820px]:pb-2.5">
          {!showRail && (
            <span className="hidden max-[820px]:inline-flex">
              <IconButton label="All the trip's settings" onClick={() => setShowRail(true)}>
                {Icons.back}
              </IconButton>
            </span>
          )}
          <div className="min-w-0 flex items-baseline gap-3 max-[820px]:flex-col max-[820px]:gap-0">
            <h2 className="m-0 flex-none whitespace-nowrap font-serif text-2xl max-[820px]:text-xl">
              Trip settings
            </h2>
            <span className="min-w-0 max-w-full font-mono text-2xs text-muted truncate">
              {trip.name}
              <span className="max-[820px]:hidden"> · {facts}</span>
            </span>
          </div>
          {pieceLabel && (
            <span className="flex-none font-mono text-2xs px-2 py-0.5 rounded-full bg-accent-wash text-accent-ink max-[820px]:hidden">
              from {pieceLabel}
            </span>
          )}
          <span className="flex-1" />
          <span className="max-[820px]:hidden">
            <IconButton label="Close the trip settings" size="sm" variant="ghost" onClick={onClose}>
              {Icons.close}
            </IconButton>
          </span>
          {/* The recipe is inline-flex, so the width rule rides a wrapper. */}
          <span className="hidden max-[820px]:inline-flex">
            <button type="button" onClick={onClose} className={buttonClass('primary', 'sm')}>
              Done
            </button>
          </span>
        </div>

        <div className="flex-1 min-h-0 flex">
          {/* The rail. Wide it is always there; narrow it IS the first screen,
              and picking a section replaces it — a drill-down, never a stack. */}
          <nav
            aria-label="Trip settings sections"
            className={`flex-none w-[13rem] flex flex-col gap-[3px] px-3 py-4 border-r border-line overflow-y-auto max-[820px]:w-full max-[820px]:border-r-0 max-[820px]:px-0 max-[820px]:py-2 ${
              showRail ? 'max-[820px]:flex' : 'max-[820px]:hidden'
            }`}
          >
            {GROUPS.map((g) => (
              <div key={g.label} className="flex flex-col gap-[3px] pb-2.5 max-[820px]:gap-0 max-[820px]:pb-4">
                <span className="font-mono text-3xs tracking-[0.14em] uppercase text-muted px-3 pt-1 pb-1.5 max-[820px]:px-5">
                  {g.label}
                </span>
                {g.sections.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setOpen(s.id);
                      setShowRail(false);
                    }}
                    aria-current={s.id === open}
                    className={`flex items-center gap-2 text-left px-3 py-2 rounded-paper text-sm cursor-pointer transition-colors max-[820px]:rounded-none max-[820px]:px-5 max-[820px]:py-3.5 max-[820px]:text-base max-[820px]:border-b max-[820px]:border-line max-[820px]:bg-transparent max-[820px]:text-ink max-[820px]:font-normal ${
                      s.id === open ? 'bg-accent-wash text-accent-ink font-semibold' : 'text-ink-soft hover:bg-paper-2'
                    }`}
                  >
                    <span className="flex-1">{s.label}</span>
                    <span className="hidden max-[820px]:inline-flex text-muted" aria-hidden>
                      {Icons.chevronRight}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </nav>

          <div
            className={`flex-1 min-w-0 flex flex-col gap-4 px-8 pt-6 pb-8 overflow-y-auto overscroll-contain max-[820px]:px-4 max-[820px]:pt-4 max-[820px]:pb-[max(2rem,env(safe-area-inset-bottom))] ${
              showRail ? 'max-[820px]:hidden' : 'max-[820px]:flex'
            }`}
          >
            {/* One heading for every section, its why behind the ⓘ. */}
            <div className="flex-none flex flex-wrap items-center gap-x-2">
              <h3 className="m-0 font-serif text-xl font-normal max-[820px]:text-2xl">{TITLE[open]}</h3>
              {ABOUT[open] && <InfoDot about={TITLE[open].toLowerCase()}>{ABOUT[open]}</InfoDot>}
            </div>

            <div className={WIDE.has(open) ? 'flex-1 min-h-0 flex flex-col gap-4' : 'w-full max-w-[44rem] flex flex-col gap-4'}>
            {open === 'dates' && <TripDatesSection trip={trip} onChange={onChangeTrip} />}

            {open === 'cover' && (
              <>
                <CoverPanel
                  trip={trip}
                  value={trip.cover}
                  onChange={(cover) => onChangeTrip({ ...trip, cover: prunePins(trip, cover) })}
                />
              </>
            )}

            {open === 'keep' && <TripKeepSection trip={trip} onChange={onChangeTrip} onNested={setKeepNested} />}

            {open === 'words' && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted">Fill every word in</span>
                  <button
                    type="button"
                    onClick={() => onChangeTrip({ ...trip, badgeWords: { ...DEFAULT_BADGE_WORDS } })}
                    className={buttonClass('default', 'sm')}
                  >
                    English
                  </button>
                  <button
                    type="button"
                    onClick={() => onChangeTrip({ ...trip, badgeWords: { ...FRENCH_BADGE_WORDS } })}
                    className={buttonClass('default', 'sm')}
                  >
                    Français
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 max-[820px]:grid-cols-1">
                  {WORD_FIELDS.map((f) => (
                    <label key={f.key} className="flex items-center gap-2.5">
                      <span className="w-[6.5rem] flex-none text-xs text-muted">
                        {f.label}
                      </span>
                      <input
                        value={trip.badgeWords[f.key] ?? ''}
                        onChange={(e) => patchWords({ [f.key]: e.target.value })}
                        className={`${inputClass} flex-1 min-w-0 max-[820px]:text-base`}
                      />
                    </label>
                  ))}
                </div>
                <SectionLegend label="Time" />
                <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 max-[820px]:grid-cols-1">
                  {TIME_AGO_WORD_FIELDS.map((f) => (
                    <label key={f.key} className="flex items-center gap-2.5">
                      <span className="w-[6.5rem] flex-none text-xs text-muted">
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
                <SectionLegend label="Camera credit" />
                <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 max-[820px]:grid-cols-1">
                  <label className="flex items-center gap-2.5">
                    <span className="w-[6.5rem] flex-none text-xs text-muted">Shot on</span>
                    <input
                      value={cameraWords.shotOn}
                      onChange={(e) => patchCameraWords({ shotOn: e.target.value })}
                      className={`${inputClass} flex-1 min-w-0 max-[820px]:text-base`}
                    />
                  </label>
                  {CAMERA_FIELDS.map((f) => (
                    <label key={f.id} className="flex items-center gap-2.5">
                      <span className="w-[6.5rem] flex-none text-xs text-muted">{f.label}</span>
                      <input
                        value={cameraWords.tags[f.id]}
                        onChange={(e) => patchCameraWords({ tag: [f.id, e.target.value] })}
                        className={`${inputClass} flex-1 min-w-0 max-[820px]:text-base`}
                      />
                    </label>
                  ))}
                </div>
              </>
            )}

            {open === 'places' && <PlacesSettingsPanel trip={trip} onChange={onChangeTrip} />}

            {open === 'road' && (
              <RoadSettingsPanel
                road={trip.road}
                mode={trip.road?.mode ?? DEFAULT_ROAD_MODE}
                detail={trip.road?.detail ?? DEFAULT_ROAD_DETAIL}
                onMode={(mode) => trip.road && onChangeTrip({ ...trip, road: { ...trip.road, mode } })}
                onDetail={(detail) => trip.road && onChangeTrip({ ...trip, road: { ...trip.road, detail } })}
                onForget={() => onChangeTrip({ ...trip, road: null })}
                onNested={setRoadNested}
                onRoad={(road) => onChangeTrip({ ...trip, road })}
                tripSpan={trip}
                places={roadPlaces}
              />
            )}

            {open === 'cta' && (
              <>
                <CtaPanel
                  cta={trip.cta}
                  onChange={(next) => onChangeTrip({ ...trip, cta: next })}
                  problem={cta?.qrProblem ?? null}
                  fieldRefs={ctaFieldRefs}
                />
              </>
            )}

            {open === 'defaults' && (
              <>
                {post && patchBadge && (
                  <div className="flex flex-col gap-2.5 px-4 py-3.5 border border-accent rounded-paper bg-accent-wash">
                    <span className="font-mono text-2xs tracking-[0.14em] uppercase text-accent-ink">This piece · {pieceLabel}</span>
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
                        Save its look for new {kindLabel(post.kind)}s
                      </button>
                      {savedDefault && (
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
                          Reset it to the {kindLabel(post.kind)}s&apos; look
                        </button>
                      )}
                    </div>
                  </div>
                )}
                <div className="border border-line rounded-paper overflow-hidden">
                  {POST_KINDS.map((k, i) => {
                    const saved = trip.hookDefaults[k.id];
                    return (
                      <div key={k.id} className={`flex items-center gap-3 px-3.5 py-2.5 ${i ? 'border-t border-line' : ''}`}>
                        <span className="flex-1 text-sm font-semibold">{k.label}</span>
                        <span className="text-xs text-muted">{saved ? 'a saved look' : 'the factory look'}</span>
                        {saved && (
                          <button
                            type="button"
                            onClick={() => {
                              const next = { ...trip.hookDefaults };
                              delete next[k.id];
                              onChangeTrip({ ...trip, hookDefaults: next });
                            }}
                            className={dangerLink}
                          >
                            Forget
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {open === 'car' && (
              <>
                <CrossingsPanel
                  value={trip.crossings}
                  onChange={(crossings) => onChangeTrip({ ...trip, crossings })}
                />
                {/* A definite height wide, so the garage can keep the car in
                    view beside its own scrolling choices; narrow, the panel
                    stacks and this pane scrolls. */}
                <div className="min-[821px]:flex-1 min-[821px]:min-h-0">
                  <FleetPanel
                    trip={trip}
                    value={trip.vehicles}
                    onChange={(vehicles) => onChangeTrip({ ...trip, vehicles })}
                  />
                </div>
              </>
            )}

            {import.meta.env.DEV && open === 'house' && <HouseStylePanel trip={trip} />}
            </div>
          </div>
        </div>

        <div className="flex-none flex items-center gap-4 px-6 py-3.5 border-t border-line bg-surface max-[820px]:hidden">
          <span className="text-2xs text-muted">Every change is written at once · ⌘Z takes it back</span>
          <span className="flex-1" />
          <button type="button" onClick={onClose} className={buttonClass('primary')}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
