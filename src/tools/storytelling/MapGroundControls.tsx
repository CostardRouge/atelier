import { useRef, useState } from 'react';
import { allowTiles, TILES_IN_OPENER_NOTICE } from '../../shared/map/osm-tiles';
import type { TileTone } from '../../shared/map/tile-tone';
import { MAP_GROUND_DEFAULTS, type MapGround, type MapGroundKind } from '../../shared/story/map-ground';
import { withLook } from '../../shared/story/sources';
import type { StoryScript } from '../../shared/story/story-script';
import Button from '../../shared/ui/Button';
import { SliderRow } from '../../shared/ui/Inspector';
import { AnchoredPopover } from '../../shared/ui/OverflowMenu';
import Segmented from '../../shared/ui/Segmented';
import type { MapGroundState } from './use-map-ground';
import { useClock } from './use-story-playback';
import type { PlayClock } from '../../shared/media/play-clock';

const KINDS: { id: MapGroundKind; label: string; title: string }[] = [
  { id: 'outline', label: 'Outline', title: 'The coastline shipped with Atelier: nothing is fetched' },
  { id: 'none', label: 'No land', title: 'The route alone, on the charte’s ground' },
  { id: 'tiles', label: 'OpenStreetMap', title: 'Streets, towns and terrain from OpenStreetMap’s tiles, credited on the map’s frames' },
];

const TONES: { id: TileTone; label: string }[] = [
  { id: 'grey', label: 'Grey' },
  { id: 'natural', label: 'Natural' },
  { id: 'sepia', label: 'Sepia' },
  { id: 'night', label: 'Night' },
];

export const GROUND_LABEL: Record<MapGroundKind, string> = { outline: 'Outline', none: 'No land', tiles: 'OpenStreetMap' };

/**
 * What the series' maps are drawn over (`map-ground.ts`): the shipped
 * outline, no land, or OpenStreetMap's tiles toned like Flight Atlas's
 * ground. The tiles wait on this device's yes (the suite's one consent,
 * `osm-tiles.ts`) and their credit is an object on the map's frames alone.
 */
export default function MapGroundControls({ script, onScript, state }: { script: StoryScript; onScript: (s: StoryScript) => void; state: MapGroundState }) {
  const g = { ...MAP_GROUND_DEFAULTS, ...(script.look?.map ?? {}) };
  const set = (map: Partial<MapGround>) => onScript(withLook(script, { map }));
  return (
    <div className="flex flex-col gap-2">
      <Segmented<MapGroundKind> options={KINDS} value={g.ground} onChange={(ground) => set({ ground })} size="sm" fill label="What the maps are drawn over" />
      {g.ground === 'tiles' ? (
        <>
          <Segmented<TileTone> options={TONES} value={g.tone} onChange={(tone) => set({ tone })} size="sm" fill label="How the tiles are toned" />
          <SliderRow
            label="Strength"
            value={Math.round(g.strength * 100)}
            min={20}
            max={100}
            step={5}
            reset={Math.round(MAP_GROUND_DEFAULTS.strength * 100)}
            format={(v) => `${v} %`}
            onChange={(v) => set({ strength: v / 100 })}
          />
          {state.state === 'not-allowed' ? (
            <div className="flex flex-col gap-1.5 rounded-control border border-line bg-paper p-2">
              <p className="m-0 text-2xs text-ink-soft leading-snug">{TILES_IN_OPENER_NOTICE}</p>
              <Button size="sm" onClick={() => allowTiles(true)}>
                Allow on this device
              </Button>
            </div>
          ) : (
            <p className="m-0 text-2xs text-muted leading-snug">
              {state.state === 'loading'
                ? 'Fetching the tiles… the outline stands in until they land.'
                : state.state === 'failed'
                  ? `${state.message} The outline stands in.`
                  : 'Credited « © OpenStreetMap contributors » on the map’s frames only. Pick the credit on the stage to move it or set its face and size.'}
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}

/** The ground's chip over the stage while a map is on it — the same controls, where the map is seen. */
export function MapGroundChip({
  clock,
  spans,
  script,
  onScript,
  state,
}: {
  clock: PlayClock;
  /** When a map is on the stage, on the post's clock. */
  spans: readonly (readonly [number, number])[];
  script: StoryScript;
  onScript: (s: StoryScript) => void;
  state: MapGroundState;
}) {
  const { t } = useClock(clock);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const kind = script.look?.map?.ground ?? MAP_GROUND_DEFAULTS.ground;
  // Kept while its panel is open, so a playhead leaving the map does not take the controls away mid-choice.
  if (!open && !spans.some(([a, b]) => t >= a && t < b)) return null;
  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        title="What the maps are drawn over"
        className="absolute right-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-control border border-line bg-surface/90 backdrop-blur-sm px-2.5 min-h-8 pointer-coarse:min-h-11 text-2xs text-ink-soft shadow-paper cursor-pointer hover:text-ink"
      >
        <span className="font-mono text-3xs uppercase tracking-[0.12em] text-muted">Map</span>
        {GROUND_LABEL[kind]}
        {state.state === 'loading' ? <span className="text-muted" aria-label="loading">…</span> : null}
      </button>
      {open ? (
        <AnchoredPopover anchorRect={() => ref.current?.getBoundingClientRect() ?? null} onClose={() => setOpen(false)} within={ref} role="dialog" label="The maps’ ground" className="w-[19rem] p-2.5">
          <MapGroundControls script={script} onScript={onScript} state={state} />
        </AnchoredPopover>
      ) : null}
    </>
  );
}
