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
  'font-sans text-[0.8rem] px-2 py-1 border border-line-strong rounded-paper bg-surface text-ink focus:outline-none focus:border-accent';

/**
 * The places one stage went through, in the order they were lived. The first
 * and the last ARE the stage's start and end — there is no separate pair of
 * fields, because a second copy of that fact is a second thing to keep in sync.
 *
 * The order is a row of chips read left to right with the badge's own `→`
 * between them, so it reads as the route it is; one chip is open at a time
 * and its fields sit underneath. A chip is dragged to reorder — the same
 * gesture as the deck's slide rail — and, because drag is unreachable by
 * keyboard, a focused chip also moves with the arrow keys.
 */
export default function PlacesEditor({ stage, onChange }: PlacesEditorProps) {
  const places = stage.places ?? [];
  const [openId, setOpenId] = useState<string | null>(null);
  // The chip just added gets its name field focused; an existing one opened
  // by a click keeps the focus where the click put it.
  const [fresh, setFresh] = useState<string | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const open = places.find((p) => p.id === openId) ?? null;
  const openIndex = open ? places.indexOf(open) : -1;

  function add() {
    const place = createTripPlace();
    onChange([...places, place]);
    setOpenId(place.id);
    setFresh(place.id);
  }

  function move(from: number, to: number) {
    onChange(moveItem(places, from, to));
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex flex-wrap items-center gap-1.5"
        role="listbox"
        aria-label="Places of this stage, in the order they were lived"
      >
        {places.map((place, i) => {
          const isOpen = place.id === openId;
          const dropping = dragOver === i && dragFrom !== null && dragFrom !== i;
          const name = place.name.trim();
          return (
            <span key={place.id} className="inline-flex items-center gap-1.5">
              {i > 0 && (
                <span className="font-mono text-[0.8rem] text-faint" aria-hidden="true">
                  →
                </span>
              )}
              <button
                type="button"
                role="option"
                aria-selected={isOpen}
                onClick={() => setOpenId(isOpen ? null : place.id)}
                draggable
                onDragStart={(e) => {
                  setDragFrom(i);
                  e.dataTransfer.effectAllowed = 'move';
                  // Firefox starts no drag at all without a payload.
                  e.dataTransfer.setData('text/plain', String(i));
                }}
                onDragOver={(e) => {
                  if (dragFrom === null) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setDragOver(i);
                }}
                onDrop={(e) => {
                  if (dragFrom === null) return;
                  e.preventDefault();
                  move(dragFrom, i);
                  setDragFrom(null);
                  setDragOver(null);
                }}
                onDragEnd={() => {
                  setDragFrom(null);
                  setDragOver(null);
                }}
                onKeyDown={(e) => {
                  if (e.altKey || e.metaKey || e.ctrlKey) return;
                  const back = e.key === 'ArrowLeft';
                  const on = e.key === 'ArrowRight';
                  if (!back && !on) return;
                  e.preventDefault();
                  move(i, back ? i - 1 : i + 1);
                }}
                title={`${name || 'Unnamed place'} — drag it, or move it with the arrow keys`}
                className={`inline-flex items-center gap-1.5 h-[1.9rem] pl-2 pr-2.5 rounded-full border text-[0.78rem] cursor-grab active:cursor-grabbing transition-colors ${
                  dragFrom === i ? 'opacity-50 ' : ''
                }${
                  dropping
                    ? 'border-accent border-dashed bg-paper'
                    : isOpen
                      ? 'border-accent bg-accent-wash text-accent-ink font-semibold'
                      : 'border-line-strong bg-surface text-ink hover:border-accent'
                }`}
              >
                <span
                  className="font-mono text-[0.72rem] leading-none text-faint tracking-[-0.1em]"
                  aria-hidden="true"
                >
                  ⠿
                </span>
                <span className={name ? '' : 'text-muted italic'}>{name || 'Unnamed'}</span>
              </button>
            </span>
          );
        })}
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center h-[1.9rem] px-2.5 rounded-full border border-dashed border-line-strong bg-transparent text-[0.78rem] text-muted cursor-pointer hover:border-accent hover:text-accent-ink"
        >
          + Place
        </button>
      </div>

      {open && (
        <PlaceFields
          key={open.id}
          stage={stage}
          place={open}
          index={openIndex}
          autoFocus={open.id === fresh}
          onChange={(next) => onChange(places.map((p) => (p.id === next.id ? next : p)))}
          onDelete={() => {
            onChange(places.filter((p) => p.id !== open.id));
            setOpenId(null);
          }}
        />
      )}
    </div>
  );
}

function PlaceFields({
  stage,
  place,
  index,
  autoFocus,
  onChange,
  onDelete,
}: {
  stage: TripStage;
  place: TripPlace;
  index: number;
  autoFocus: boolean;
  onChange: (place: TripPlace) => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const name = place.name.trim() || 'this place';
  // The stage's region stands in when the place has none — an empty field
  // means "the stage's", never blank.
  const inherited = stageRegionLabel(stage);

  return (
    <div className="flex flex-col gap-1 pl-1">
      <div className="flex flex-wrap items-start gap-1.5">
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
          autoFocus={autoFocus}
          className="flex-1 min-w-[9rem]"
          inputClassName={inputClass}
        />
        <input
          value={place.region}
          onChange={(e) => onChange({ ...place, region: e.target.value })}
          placeholder={inherited || 'Western Australia'}
          aria-label={`Region of ${name}`}
          className={`${inputClass} flex-1 min-w-[7rem]`}
        />
        {confirming ? (
          <span className="flex items-center gap-1.5 text-[0.7rem] pt-1.5">
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
            className="p-0 pt-1.5 border-0 bg-transparent text-[0.7rem] text-faint cursor-pointer hover:text-[#9a3a23]"
            aria-label={`Delete ${name}`}
          >
            Delete
          </button>
        )}
      </div>
      {place.coords && (
        <p className="m-0 font-mono text-[0.64rem] text-faint tabular-nums">
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
    </div>
  );
}
