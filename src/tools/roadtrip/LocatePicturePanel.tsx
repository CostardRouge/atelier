import { DEFAULT_MAX_KM } from '../../shared/roadtrip/gazetteer';
import type { LocateProposal, PictureLocation } from '../../shared/roadtrip/locate-picture';
import type { CaptureDate } from '../../shared/roadtrip/media-date';
import { formatIsoDate } from '../../shared/roadtrip/trip-days';
import { formatCoords, stageLabel } from '../../shared/roadtrip/trip-places';
import type { TripDoc } from '../../shared/roadtrip/trip-types';
import Button from '../../shared/ui/Button';
import useDialogKeys from '../../shared/ui/use-dialog-keys';

/**
 * Where one picture was taken, and the one thing the trip could do about it.
 *
 * The small half of the itinerary deduction: that one asks an instance for a
 * position a day and proposes thirty legs (`DeduceStagesPanel`); this one reads
 * the picture in hand and proposes ONE edit to the leg of its own day. The
 * arithmetic is `locate-picture.ts` and the sentences are here, the same split
 * the deduction has with `segment-track.ts`.
 *
 * It **proposes**, like everything else in this tool that measures something:
 * the day a piece tells is offered and never applied, and so is this. The
 * sheet also says what it MEASURED — the day, where the day came from, the
 * coordinates, the city and how far away it is — because a name arriving with
 * no working shown is a name nobody can weigh.
 */

interface PictureRead {
  /** The day the picture says it was taken, and how confidently. */
  capture: CaptureDate | null;
  coords: { lat: number; lon: number } | null;
  location: PictureLocation;
}

interface LocatePicturePanelProps {
  trip: TripDoc;
  /** The file being located, by its own name. */
  name: string;
  /** Null while the picture is still being read. */
  read: PictureRead | null;
  /** Why there is nothing to read at all — no picture on the active media. */
  problem?: string | null;
  onCancel: () => void;
  onAccept: (proposal: LocateProposal) => void;
}

const legend = 'font-mono text-2xs tracking-[0.14em] uppercase text-muted';

/** Where the day came from, said as plainly as it is known. */
function dayWords(capture: CaptureDate): string {
  switch (capture.source) {
    case 'exif':
      return 'the camera’s own record';
    case 'source':
      return `as ${capture.via ?? 'the instance it came from'} read it`;
    case 'file':
      return 'the file’s own date — a weak guess, rewritten by any copy or re-grade';
  }
}

/** Why nothing is offered, in a sentence that says what to do instead. */
function silenceWords(trip: TripDoc, location: PictureLocation): string {
  switch (location.silence) {
    case 'no-position':
      return 'This picture carries no position: its EXIF says nothing about where it was taken, and no instance vouched for one.';
    case 'null-island':
      return 'Its position reads 0, 0 — what a camera writes when it never got a fix. Refused rather than believed.';
    case 'no-date':
      return 'Nothing says which day this picture belongs to, so there is no leg to offer its place to.';
    case 'outside-trip':
      return `${location.date ? formatIsoDate(location.date) : 'Its day'} is not a day of this trip (${formatIsoDate(trip.startDate)} → ${formatIsoDate(trip.endDate)}), so nothing is offered here.`;
    case 'no-name':
      return `Nothing in the city index is within ${DEFAULT_MAX_KM} km of that position, so there is no name to offer. The leg keeps its dates.`;
    case 'already':
      return location.stage && location.city
        ? `${stageLabel(location.stage) ? `“${stageLabel(location.stage)}”` : 'The leg of that day'} already names ${location.city.name}. Nothing to add.`
        : 'That place is already on the leg of this day.';
    default:
      return '';
  }
}

export default function LocatePicturePanel({
  trip,
  name,
  read,
  problem,
  onCancel,
  onAccept,
}: LocatePicturePanelProps) {
  const proposal = read?.location.proposal ?? null;
  useDialogKeys({ onCancel, onConfirm: proposal ? () => onAccept(proposal) : null });

  const location = read?.location ?? null;
  const city = location?.city ?? null;

  return (
    <div
      /* z-60, where every other sheet in the suite is z-50: this one is opened
         from INSIDE the shell's own library sheet, and at the same level the
         DOM order decides — the shell renders after the tool, so the library
         sheet covered the Accept button on a phone. Measured at 390 px. */
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-[rgba(20,18,15,0.45)] backdrop-blur-[2px] max-[820px]:p-0"
      role="dialog"
      aria-modal="true"
      aria-label={`Locate ${name}`}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-[32rem] max-h-[90dvh] overflow-auto flex flex-col gap-5 bg-surface border border-line rounded-paper-lg shadow-paper px-6 pt-6 max-[820px]:max-w-none max-[820px]:max-h-none max-[820px]:h-[var(--app-h)] max-[820px]:rounded-none max-[820px]:border-0 max-[820px]:px-4 max-[820px]:pt-4">
        <div className="min-w-0">
          <h2 className="m-0 font-serif text-2xl">Locate this picture</h2>
          <p className="m-0 mt-1 text-sm text-muted break-words">
            <span className="font-mono text-xs">{name}</span> — read on this machine, named
            from the city index that ships with the app. Nothing is sent anywhere, and
            nothing changes until you accept.
          </p>
        </div>

        {problem ? (
          <p className="m-0 text-sm text-muted">{problem}</p>
        ) : !read || !location ? (
          <p className="m-0 font-mono text-xs text-muted">reading the picture…</p>
        ) : (
          <>
            {/* --- what the file itself says, before any proposal ---------- */}
            <div className="flex flex-col gap-1.5">
              <span className={legend}>What the picture says</span>
              <p className="m-0 font-mono text-xs text-ink tabular-nums">
                {read.capture ? formatIsoDate(read.capture.date) : 'no date'}
                <span className="text-muted">
                  {' · '}
                  {read.capture ? dayWords(read.capture) : 'nothing dates it'}
                </span>
              </p>
              <p className="m-0 font-mono text-xs text-ink tabular-nums">
                {read.coords ? formatCoords(read.coords) : 'no position'}
                {city && (
                  <span className="text-muted">
                    {' · '}
                    {city.name}
                    {city.country && ` (${city.country})`}
                    {location.km !== null && `, ${location.km.toFixed(1)} km away`}
                  </span>
                )}
              </p>
            </div>

            {/* --- the one thing it could do ------------------------------- */}
            {proposal ? (
              <div className="flex flex-col gap-1.5">
                <span className={legend}>What accepting would do</span>
                <p className="m-0 text-sm text-ink">{proposal.label}</p>
                <p className="m-0 text-2xs text-faint leading-snug">{proposal.detail}</p>
              </div>
            ) : (
              <p className="m-0 text-sm text-muted">{silenceWords(trip, location)}</p>
            )}
          </>
        )}

        <div className="sticky bottom-0 -mx-6 mt-auto px-6 pb-6 flex items-center justify-end gap-4 pt-1 border-t border-line bg-surface max-[820px]:-mx-4 max-[820px]:px-4 max-[820px]:pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={onCancel}
            className="p-0 mt-4 border-0 bg-transparent text-sm text-muted cursor-pointer hover:text-ink"
          >
            {proposal ? 'Cancel' : 'Close'}
          </button>
          {proposal && (
            <Button variant="primary" className="mt-4" onClick={() => onAccept(proposal)}>
              Accept
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
