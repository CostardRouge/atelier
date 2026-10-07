/**
 * The OpenStreetMap background, as an opener's panel offers it — ONE face for
 * the Itinerary's switch and Virée's «OSM» ground.
 *
 * Two different yeses meet here and the panel keeps them apart, because they
 * travel differently. The PIECE asks for its background (an option, in the
 * document, carried by the backup and the sync); this DEVICE allows the fetch
 * (`localStorage`, `osm-tiles.ts`) — so a trip opened on another machine, or
 * from someone else's file, shows the paper until that machine says yes too.
 * Turning the background on here is both at once: the gesture is the consent,
 * made with the notice in view.
 */

import Button from '../../ui/Button';
import { FieldRow, RangeField } from '../../ui/Inspector';
import { TILES_IN_OPENER_NOTICE, allowTiles, useTilesAllowed } from '../../map/osm-tiles';
import { useStreamProgress } from '../../map/tile-stream';
import { clearTiles, useTileCacheSize } from '../../map/tile-cache';
import { formatBytes } from '../../lib/format';
import type { BasemapSet } from './basemap-strip';
import type { HookBasemapWant, HookContext, HookPictureStatus } from './hook-variant';

interface BasemapStatusProps {
  /** What the opener would fetch, or null when it has nothing to draw yet. */
  want: HookBasemapWant | null;
  /** The ground under a following camera — its pyramid of finer tiles along the road (`basemap-strip.ts`). */
  set?: BasemapSet | null;
  ctx: HookContext;
  status?: HookPictureStatus;
  opacity: number;
  onOpacity: (opacity: number) => void;
  limits: { min: number; max: number };
  /** One line about what the tiles do to this opener's drawing, or nothing. */
  note?: string;
}

/** Where the background stands, and how strongly it shows. For a background that is ON. */
export function BasemapStatus({ want, set, ctx, status, opacity, onOpacity, limits, note }: BasemapStatusProps) {
  const allowed = useTilesAllowed();
  const drawn = want ? ctx.pictures?.has(want.key) === true : false;
  const problem = want ? status?.problems.get(want.key) : undefined;
  // The pyramid along the road: said as a count, since a tile still on its
  // way is nothing to act on — the coarser ground stands in, and an export
  // waits for every one of them before its first frame. The tiles are
  // fetched ahead and decoded around the playhead (`tile-stream.ts`).
  const progress = useStreamProgress(set?.pyramid?.key);
  const total = set?.pyramid?.tiles.length ?? 0;
  const short =
    set && set.short > 0
      ? ` ${set.short === 1 ? 'One zoom' : `${set.short} zooms`} short where the camera moves fastest — full detail would take ${set.full} tiles, past what this device fetches.`
      : ' Every frame at its own zoom.';
  const line = !allowed
    ? null
    : !want
      ? 'Nothing to draw it under yet — the map needs stops first.'
      : drawn
        ? !total
          ? null
          : progress?.done
            ? progress.failed
              ? `${progress.failed} of ${total} finer tiles could not be fetched — a coarser map stands in there.`
              : `Plus ${total} finer tiles along the road, decoded as the camera reaches them.${short}`
            : `Fetching the finer tiles along the road — ${progress?.fetched ?? 0} of ${total} in. An export waits for all of them.`
        : problem
          ? problem
          : 'Fetching the map background…';

  return (
    <div className="flex flex-col gap-2">
      {!allowed && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="m-0 text-xs text-accent-ink">
            This piece asks for the OpenStreetMap background, and this device has not allowed it —
            nothing is fetched, the paper stands in.
          </p>
          <Button size="sm" onClick={() => allowTiles(true)}>
            Allow on this device
          </Button>
        </div>
      )}
      {line && (
        <p className={`m-0 text-xs ${problem ? 'text-danger' : 'text-muted'}`} role={problem ? 'alert' : undefined}>
          {line}
        </p>
      )}
      <FieldRow label="Map strength" hint={note}>
        <RangeField
          label="How strongly the map background shows"
          min={limits.min}
          max={limits.max}
          step={0.05}
          value={opacity}
          onChange={onOpacity}
          format={(v) => `${Math.round(v * 100)}%`}
        />
      </FieldRow>
      <p className="m-0 text-2xs text-faint">{TILES_IN_OPENER_NOTICE}</p>
      {allowed && <KeptTiles />}
    </div>
  );
}

/**
 * What this device keeps of the map (`tile-cache.ts`), and the verb that
 * forgets it — one line, said only once something is kept.
 */
function KeptTiles() {
  const kept = useTileCacheSize();
  if (!kept || kept.tiles === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="m-0 text-2xs text-faint">
        {kept.tiles} tiles kept on this device ({formatBytes(kept.bytes)}) for a month, so a second export asks the
        server nothing.
      </p>
      <Button size="sm" variant="ghost" onClick={() => void clearTiles()}>
        Forget them
      </Button>
    </div>
  );
}

/** Turn the background on for this piece, and allow it on this device in the same gesture. */
export function enableBasemap(set: (on: boolean) => void): (on: boolean) => void {
  return (on) => {
    if (on) allowTiles(true);
    set(on);
  };
}
