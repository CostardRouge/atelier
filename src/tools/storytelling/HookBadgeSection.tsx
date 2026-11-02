import { useEffect, useState } from 'react';
import StylePanel from '../../shared/overlay/StylePanel';
import type { TripDoc } from '../../shared/roadtrip/trip-types';
import { HOOK_COMPOSITIONS, HOOK_PIECES, HOOK_SIZE_MAX, HOOK_SIZE_MIN, hookBadgeOf, hookThemeOf, type HookBadge, type HookComposition, type HookLong, type HookPieceKey } from '../../shared/story/hook-badge';
import { withLook } from '../../shared/story/sources';
import type { StoryScript } from '../../shared/story/story-script';
import { SelectField, SliderRow, SwitchRow } from '../../shared/ui/Inspector';
import Segmented from '../../shared/ui/Segmented';
import { PAL } from '../../shared/story/charte';

/**
 * The hook's look for the whole series (hook lab B3–B4, his picks): Trips'
 * badge — the very title-style panel Trips' Look tab shows (Or ciné, Pixel
 * CRT, Rouge plein cadre, Neutral, every dial, Export / Import of the
 * `.badge.json` the three tools share), or the charte's colours; where it sits
 * (the stack, the centre, top and bottom, a band); how big; which pieces show;
 * a trip's own badge taken as it is. « As before » keeps the typed lines and
 * the sticker.
 */
export default function HookBadgeSection({ script, onScript }: { script: StoryScript; onScript: (s: StoryScript) => void }) {
  const raw = script.look?.hook;
  const b = hookBadgeOf(raw);
  const write = (patch: Partial<HookBadge>) => {
    const next: HookBadge = { ...(raw ?? {}), ...patch };
    for (const k of Object.keys(next) as (keyof HookBadge)[]) if (next[k] === undefined) delete next[k];
    onScript(withLook(script, { hook: next }));
  };
  const [trips, setTrips] = useState<TripDoc[] | null>(null);
  useEffect(() => {
    let alive = true;
    void import('../../shared/roadtrip/trip-store').then((m) => m.listTrips()).then((all) => alive && setTrips(all.filter((t) => t.theme)));
    return () => {
      alive = false;
    };
  }, []);
  const takeTrip = (id: string) => {
    const trip = trips?.find((t) => t.id === id);
    if (!trip?.theme) return;
    const kinds = Object.values(trip.hookDefaults ?? {});
    const styles = kinds.find((d) => d && Object.keys(d.pieceStyles ?? {}).length)?.pieceStyles;
    write({ theme: structuredClone(trip.theme), look: undefined, ...(styles ? { styles: structuredClone(styles) } : {}) });
  };
  const charte = b.look === 'charte' && !b.theme;
  return (
    <div className="flex flex-col gap-2.5">
      <Segmented<'badge' | 'classic'>
        options={[
          { id: 'badge', label: 'Badge' },
          { id: 'classic', label: 'As before', title: 'The typed lines and the sticker' },
        ]}
        value={b.mode}
        onChange={(mode) => write({ mode: mode === 'badge' ? undefined : mode })}
        size="sm"
        fill
        label="How the hook is drawn"
      />
      {b.mode === 'badge' ? (
        <>
          <StylePanel
            theme={charte ? null : hookThemeOf(raw)}
            onChange={(theme) => write({ theme: theme ?? undefined, look: theme ? undefined : 'neutral' })}
            heading={<span className="text-xs text-muted">Title style · Trips’ own</span>}
            pieceStyles={b.styles}
            onPieceStyles={(styles) => write({ styles })}
          />
          <button
            type="button"
            aria-pressed={charte}
            onClick={() => write({ look: 'charte', theme: undefined })}
            className={`min-h-9 rounded-control border px-3 text-left text-xs cursor-pointer ${charte ? 'border-ink' : 'border-line'}`}
            style={{ background: PAL.bg }}
          >
            The charte — the series’ colours, the second line on the accent
          </button>
          {trips?.length ? (
            <SelectField<string>
              label="Take a trip's badge style"
              value=""
              options={[{ id: '', label: 'Use a trip’s badge…' }, ...trips.map((t) => ({ id: t.id, label: t.name || 'Untitled trip' }))]}
              onChange={takeTrip}
            />
          ) : null}
          <Segmented<HookComposition> options={HOOK_COMPOSITIONS.map((c) => ({ id: c.id, label: c.label }))} value={b.composition} onChange={(composition) => write({ composition })} size="sm" fill label="Where the badge sits" />
          <SliderRow
            label="Numeral"
            value={Math.round(b.size * 1000) / 10}
            min={HOOK_SIZE_MIN * 100}
            max={HOOK_SIZE_MAX * 100}
            step={0.5}
            reset={10}
            format={(v) => `${v} %`}
            onChange={(v) => write({ size: v / 100 })}
          />
          <p className="m-0 text-2xs text-muted leading-snug">The big text&apos;s size, a share of the frame&apos;s width: every other piece keeps its ratio to it, so the whole badge grows at once.</p>
          <SliderRow label="Column" value={Math.round(b.column * 100)} min={30} max={95} step={1} reset={86} format={(v) => `${v} %`} onChange={(v) => write({ column: v === 86 ? undefined : v / 100 })} />
          <Segmented<HookLong>
            options={[
              { id: 'wrap', label: 'Wrap', title: 'Broken at words inside the column; past three lines it shrinks' },
              { id: 'fit', label: 'Shrink to fit', title: 'Kept on one line, shrunk to the column' },
            ]}
            value={b.long}
            onChange={(long) => write({ long: long === 'wrap' ? undefined : long })}
            size="sm"
            fill
            label="A big text longer than the column"
          />
          <div className="flex flex-col gap-1">
            {HOOK_PIECES.map((p) => (
              <SwitchRow key={p.id} label={p.label} checked={b.pieces[p.id]} onChange={(on) => write({ pieces: { ...(raw?.pieces ?? {}), [p.id]: on } as Partial<Record<HookPieceKey, boolean>> })} />
            ))}
          </div>
          <p className="m-0 text-2xs text-muted leading-snug">The big text and the second line are each post’s hook; the header, the place and why now come from the series, the camera from the post. Each post can write its own under Hook.</p>
        </>
      ) : null}
    </div>
  );
}
