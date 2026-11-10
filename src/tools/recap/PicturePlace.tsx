import { useEffect, useState } from 'react';
import type { RecapDoc, RecapPicture } from '../../shared/recap/recap-doc';
import { shortDate } from '../../shared/recap/recap-days';
import { dayMates, isPlaceByHand, knownPlaces, placeName, withPlaceByHand, writtenPlace, type PlaceFacts } from '../../shared/recap/recap-places';
import { TextField, ToggleField } from '../../shared/ui/Inspector';
import type { Change } from './RecapPanels';

const legend = 'font-mono text-2xs tracking-[0.14em] uppercase text-muted';
const same = (a: PlaceFacts, b: PlaceFacts) => (a.place ?? '') === (b.place ?? '') && (a.region ?? '') === (b.region ?? '') && (a.country ?? '') === (b.country ?? '');

/**
 * A picture's place, in its card (lab 17 part III, his yes of 2026-11-10):
 * where it comes from — Winnow, by hand, or none — and ↺ to give Winnow's
 * back; the places the recap already knows as chips, then the covering
 * trip's (dashed); a place typed; and, once given by hand, the same place for
 * the day's other photos that have none (those Winnow placed keep theirs).
 */
export default function PicturePlace({ doc, pic, change, trip }: { doc: RecapDoc; pic: RecapPicture; change: Change; trip: { name: string; places: PlaceFacts[] } | null }) {
  const writing = doc.places.writing;
  const byHand = isPlaceByHand(pic);
  const mine: PlaceFacts = { place: pic.place, region: pic.region, country: pic.country };
  const known = knownPlaces(doc.pictures.filter((p) => !p.loose));
  const fromTrip = (trip?.places ?? []).filter((t) => !known.some((k) => same(k, t))).slice(0, 8);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState<PlaceFacts>({});
  useEffect(() => {
    setTyping(false);
    setDraft({});
  }, [pic.key]);
  const give = (facts: PlaceFacts | null) => change((d) => withPlaceByHand(d, [pic.key], facts));
  const mates = dayMates(doc, pic.key);
  const reach = mates.without.length + mates.same.length;
  const line = placeName(pic) ? [pic.place, pic.region, pic.country].filter(Boolean).join(' · ') : 'No place';
  const chip = (p: PlaceFacts, dashed: boolean) => {
    const on = Boolean(placeName(pic)) && same(p, mine);
    return (
      <button
        key={`${p.place}|${p.region}|${p.country}`}
        type="button"
        aria-pressed={on}
        title={[p.place, p.region, p.country].filter(Boolean).join(' · ')}
        onClick={() => give(p)}
        className={`max-w-full truncate px-2.5 py-1 pointer-coarse:min-h-11 rounded-full border text-xs cursor-pointer ${dashed ? 'border-dashed' : ''} ${on ? 'bg-ink text-paper border-ink' : 'bg-paper text-ink border-line hover:border-line-strong'}`}
      >
        {writtenPlace(p, writing)}
      </button>
    );
  };
  return (
    <div className="flex flex-col gap-1.5">
      <span className={legend}>Its place</span>
      <div className="flex items-start gap-2 px-2.5 py-2 rounded-control border border-line bg-paper-2">
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-semibold truncate ${placeName(pic) ? 'text-ink' : 'text-muted'}`} title={line}>
            {line}
          </div>
          <div className={`font-mono text-3xs uppercase tracking-[0.06em] ${byHand ? 'text-accent-ink' : 'text-muted'}`}>{byHand ? 'by hand' : placeName(pic) ? 'Winnow' : pic.lat !== undefined ? 'none · its GPS is not named yet' : 'none · no GPS'}</div>
        </div>
        {byHand && (
          <button type="button" onClick={() => give(null)} title={pic.placeWinnow && placeName(pic.placeWinnow) ? `Give Winnow's back: ${placeName(pic.placeWinnow)}` : 'Give it back: no place'} aria-label="Give Winnow's place back" className="flex-none px-1 font-mono text-xs text-accent-ink cursor-pointer hover:underline">
            ↺
          </button>
        )}
      </div>
      {known.length > 0 && (
        <>
          <span className={legend}>The recap's places</span>
          <div className="flex flex-wrap gap-1">{known.map((p) => chip(p, false))}</div>
        </>
      )}
      {fromTrip.length > 0 && (
        <>
          <span className={legend}>From your trip «{trip!.name}»</span>
          <div className="flex flex-wrap gap-1">{fromTrip.map((p) => chip(p, true))}</div>
        </>
      )}
      {typing ? (
        <form
          className="flex flex-col gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.place?.trim() && !draft.region?.trim()) return;
            give(draft);
            setTyping(false);
          }}
        >
          <label className="grid grid-cols-[4.6rem_minmax(0,1fr)] items-center gap-2 text-xs text-ink-soft">
            Town
            <TextField value={draft.place ?? ''} onChange={(place) => setDraft((d) => ({ ...d, place }))} label="Town" placeholder="Cape Le Grand" />
          </label>
          <label className="grid grid-cols-[4.6rem_minmax(0,1fr)] items-center gap-2 text-xs text-ink-soft">
            State
            <TextField value={draft.region ?? ''} onChange={(region) => setDraft((d) => ({ ...d, region }))} label="State" placeholder="Western Australia" />
          </label>
          <label className="grid grid-cols-[4.6rem_minmax(0,1fr)] items-center gap-2 text-xs text-ink-soft">
            Country
            <TextField value={draft.country ?? ''} onChange={(country) => setDraft((d) => ({ ...d, country }))} label="Country" placeholder="Australia" />
          </label>
          <button type="submit" disabled={!draft.place?.trim() && !draft.region?.trim()} className="w-full min-h-9 pointer-coarse:min-h-11 rounded-control border border-line bg-paper-2 text-xs text-ink cursor-pointer disabled:opacity-45 disabled:cursor-default hover:border-line-strong">
            Use this place
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => {
            setDraft(placeName(pic) ? mine : {});
            setTyping(true);
          }}
          className="self-start text-2xs text-accent-ink underline-offset-2 hover:underline"
        >
          Type another place…
        </button>
      )}
      {byHand && reach > 0 && pic.day && (
        <ToggleField
          checked={mates.without.length === 0}
          onChange={(on) => change((d) => (on ? withPlaceByHand(d, mates.without, mine) : withPlaceByHand(d, mates.same, null)))}
          label={`The ${reach} other photos of ${shortDate(pic.day)} without a place`}
        >
          Also {shortDate(pic.day).replace(/ \d{4}$/, '')}'s {reach} other{reach === 1 ? '' : 's'} with no place
        </ToggleField>
      )}
    </div>
  );
}
