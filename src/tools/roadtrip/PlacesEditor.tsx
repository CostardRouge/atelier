import { useState } from 'react';
import PlaceSearchField from '../../shared/map/PlaceSearchField';
import { moveItem } from '../../shared/roadtrip/deck';
import { formatCoords, stageRegionLabel } from '../../shared/roadtrip/trip-places';
import { createTripPlace, type TripPlace, type TripStage } from '../../shared/roadtrip/trip-types';

interface PlacesEditorProps {
  stage: TripStage;
  onChange: (places: TripPlace[]) => void;
}

const inputClass =
  'font-sans text-[0.8rem] px-2 py-1 border border-line-strong rounded-paper bg-paper text-ink focus:outline-none focus:border-accent';
const iconButton =
  'flex-none w-6 h-6 inline-flex items-center justify-center border border-line rounded-full bg-paper text-[0.7rem] text-ink-soft cursor-pointer hover:border-accent hover:text-accent-ink disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:border-line disabled:hover:text-ink-soft';

function PlaceRow({
  stage,
  place,
  index,
  count,
  onChange,
  onMove,
  onDelete,
}: {
  stage: TripStage;
  place: TripPlace;
  index: number;
  count: number;
  onChange: (place: TripPlace) => void;
  onMove: (to: number) => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const name = place.name.trim() || 'this place';
  // The stage's region stands in when the place has none — an empty field
  // means "the stage's", never blank.
  const inherited = stageRegionLabel(stage);

  return (
    <li className="flex flex-col gap-1 py-1.5 border-b border-line last:border-b-0">
      <div className="flex items-start gap-1.5">
        <span
          className="flex-none w-5 pt-1.5 font-mono text-[0.64rem] text-faint tabular-nums"
          aria-hidden="true"
        >
          {index + 1}
        </span>
        <PlaceSearchField
          value={place.name}
          onChange={(next) => onChange({ ...place, name: next })}
          onPick={(result) =>
            onChange({
              ...place,
              name: result.name,
              // Only fill a region the author has not written themselves.
              region: place.region.trim() || result.region,
              coords: { lat: result.lat, lon: result.lon },
            })
          }
          placeholder="Kalbarri"
          label={`Place ${index + 1}`}
          className="flex-1 min-w-[9rem]"
          inputClassName={inputClass}
        />
        <input
          value={place.region}
          onChange={(e) => onChange({ ...place, region: e.target.value })}
          placeholder={inherited || 'Western Australia'}
          aria-label={`Region of ${name}`}
          className={`${inputClass} flex-1 min-w-[7rem] self-start`}
        />
        <div className="flex-none flex items-center gap-1 pt-0.5">
          <button
            type="button"
            onClick={() => onMove(index - 1)}
            disabled={index === 0}
            className={iconButton}
            title={`Move ${name} earlier`}
            aria-label={`Move ${name} earlier`}
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => onMove(index + 1)}
            disabled={index === count - 1}
            className={iconButton}
            title={`Move ${name} later`}
            aria-label={`Move ${name} later`}
          >
            ↓
          </button>
          {confirming ? (
            <span className="flex items-center gap-1.5 text-[0.7rem] pl-1">
              <button
                type="button"
                onClick={onDelete}
                className="p-0 border-0 bg-transparent text-[#9a3a23] font-semibold cursor-pointer underline underline-offset-[3px]"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="p-0 border-0 bg-transparent text-muted cursor-pointer"
              >
                Keep
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className={iconButton}
              title={`Delete ${name}`}
              aria-label={`Delete ${name}`}
            >
              ×
            </button>
          )}
        </div>
      </div>
      {place.coords && (
        <p className="m-0 pl-[1.625rem] font-mono text-[0.64rem] text-faint tabular-nums">
          {formatCoords(place.coords)}
          <button
            type="button"
            onClick={() => onChange({ ...place, coords: null })}
            className="ml-2 p-0 border-0 bg-transparent text-[0.64rem] text-faint cursor-pointer underline underline-offset-[2px] hover:text-[#9a3a23]"
          >
            forget
          </button>
        </p>
      )}
    </li>
  );
}

/**
 * The places one stage went through, in the order they were lived. The first
 * and the last ARE the stage's start and end — there is no separate pair of
 * fields, because a second copy of that fact is a second thing to keep in sync.
 *
 * Reordering is buttons, not drag: HTML5 drag is unreachable by keyboard and
 * undiscoverable (the same call the deck's slide strip made), and a leg of
 * three stops does not earn a drag surface.
 */
export default function PlacesEditor({ stage, onChange }: PlacesEditorProps) {
  const places = stage.places ?? [];

  return (
    <div className="flex flex-col gap-1 pl-1">
      {places.length > 0 && (
        <ul className="m-0 p-0 list-none flex flex-col">
          {places.map((place, index) => (
            <PlaceRow
              key={place.id}
              stage={stage}
              place={place}
              index={index}
              count={places.length}
              onChange={(next) =>
                onChange(places.map((p) => (p.id === next.id ? next : p)))
              }
              onMove={(to) => onChange(moveItem(places, index, to))}
              onDelete={() => onChange(places.filter((p) => p.id !== place.id))}
            />
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={() => onChange([...places, createTripPlace()])}
        className="self-start p-0 border-0 bg-transparent font-mono text-[0.66rem] tracking-[0.1em] uppercase text-faint cursor-pointer hover:text-accent-ink"
      >
        + Place
      </button>
    </div>
  );
}
