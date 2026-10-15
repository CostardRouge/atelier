import { useEffect, useRef, type ReactNode } from 'react';
import { FieldRow, InspectorSection, SliderRow } from '../../shared/ui/Inspector';
import Segmented from '../../shared/ui/Segmented';
import { TILES_IN_OPENER_NOTICE } from '../../shared/map/osm-tiles';
import type { AtlasSettings, LandMode, TileTone } from './atlas-settings';

/** What is under the flights, in one word: the three grounds the atlas draws. */
export type Ground = 'plain' | 'coast' | 'streets';

/** The ground the dials describe: streets whenever the tiles are on, else the land's mode. */
export function groundOf(tilesOn: boolean, land: LandMode): Ground {
  if (tilesOn) return 'streets';
  return land === 'off' ? 'plain' : 'coast';
}

/** The tiles' tones, each roughly as it lands on the map — only to paint the Streets picture. */
const TONE_SWATCH: Record<TileTone, { ground: string; road: string }> = {
  night: { ground: '#141a22', road: '#38425a' },
  grey: { ground: '#25272b', road: '#555a63' },
  sepia: { ground: '#2a2117', road: '#6b5639' },
  natural: { ground: '#e8e4da', road: '#b9b2a2' },
};

interface AtlasGroundProps {
  settings: AtlasSettings;
  update: (fn: (s: AtlasSettings) => AtlasSettings) => void;
  tilesOn: boolean;
  setTilesOn: (on: boolean) => void;
}

/**
 * The first thing the Style tab asks: what the flights are drawn over. Three
 * pictures, each painted in the look's own colours, so the choice shows what
 * the frame will be before it is made. Streets is the tiles' switch (the
 * transport's map glyph is the same switch); Plain and Coastline set the
 * land's mode, Coastline giving back the mode it had before Plain.
 */
export default function AtlasGround({ settings: s, update, tilesOn, setTilesOn }: AtlasGroundProps) {
  const ground = groundOf(tilesOn, s.map.land);
  const lastLand = useRef<LandMode>(s.map.land === 'off' ? 'fill' : s.map.land);
  useEffect(() => {
    if (s.map.land !== 'off') lastLand.current = s.map.land;
  }, [s.map.land]);

  const pick = (g: Ground) => {
    if (g === 'streets') {
      setTilesOn(true);
      return;
    }
    setTilesOn(false);
    update((cur) => ({
      ...cur,
      map: { ...cur.map, land: g === 'plain' ? 'off' : cur.map.land === 'off' ? lastLand.current : cur.map.land },
    }));
  };
  const map = (patch: Partial<AtlasSettings['map']>) => update((cur) => ({ ...cur, map: { ...cur.map, ...patch } }));

  const bg = s.map.background;
  const land = s.map.landColour;
  const trail = s.colour.trail;
  const tone = TONE_SWATCH[s.map.tileTone];
  const options: { id: Ground; label: string; picture: ReactNode }[] = [
    {
      id: 'plain',
      label: 'Plain',
      picture: (
        <>
          <rect width="80" height="50" fill={bg} />
          <path d="M14 40 C24 22 40 20 52 12" fill="none" stroke={trail} strokeWidth="2" strokeLinecap="round" />
        </>
      ),
    },
    {
      id: 'coast',
      label: 'Coastline',
      picture: (
        <>
          <rect width="80" height="50" fill={bg} />
          <path d="M0 30 C14 28 26 36 36 44 S52 50 60 50 L0 50 Z" fill={land} stroke={land} strokeWidth="1.4" />
          <path d="M14 40 C24 22 40 20 52 12" fill="none" stroke={trail} strokeWidth="2" strokeLinecap="round" />
        </>
      ),
    },
    {
      id: 'streets',
      label: 'Streets',
      picture: (
        <>
          <rect width="80" height="50" fill={tone.ground} />
          <path d="M0 12 C20 10 40 16 80 10 M0 30 C24 28 50 34 80 28 M14 0 L18 50 M44 0 C42 20 48 34 46 50 M64 0 L60 50" fill="none" stroke={tone.road} strokeWidth="1.3" />
          <path d="M14 40 C24 22 40 20 52 12" fill="none" stroke={trail} strokeWidth="2" strokeLinecap="round" />
        </>
      ),
    },
  ];

  return (
    <InspectorSection
      id="atlas.ground"
      title="Ground"
      info={`What the flights are drawn over: the ground's colour alone, the coastline shipped with the app (offline), or the streets. ${TILES_IN_OPENER_NOTICE} Off each time the atlas opens; the map glyph beside Play is the same switch.`}
    >
      <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Ground">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            aria-pressed={ground === o.id}
            onClick={() => pick(o.id)}
            className="flex flex-col items-stretch gap-1 p-1 rounded-control border-2 border-transparent bg-paper hover:border-line-strong transition-colors aria-pressed:border-accent"
          >
            <svg viewBox="0 0 80 50" className="block w-full h-auto rounded-[6px]" aria-hidden="true">
              {o.picture}
            </svg>
            <span className="text-2xs text-ink-soft truncate text-center">{o.label}</span>
          </button>
        ))}
      </div>
      {ground === 'streets' && (
        <>
          <FieldRow label="Tone">
            <Segmented<TileTone>
              size="sm"
              fill
              label="Tile tone"
              value={s.map.tileTone}
              onChange={(v) => map({ tileTone: v })}
              options={[
                { id: 'night', label: 'Night' },
                { id: 'grey', label: 'Grey' },
                { id: 'sepia', label: 'Sepia' },
                { id: 'natural', label: 'Natural' },
              ]}
            />
          </FieldRow>
          <SliderRow label="Dim" value={s.map.tileDim} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => map({ tileDim: v })} />
        </>
      )}
    </InspectorSection>
  );
}
