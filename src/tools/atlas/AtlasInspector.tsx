import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FieldRow, InspectorSection, RangeField, Readout, SelectField, SwitchRow, TextField, swatchClass } from '../../shared/ui/Inspector';
import Segmented from '../../shared/ui/Segmented';
import Button from '../../shared/ui/Button';
import IconButton from '../../shared/ui/IconButton';
import { Icons } from '../../shared/ui/icons';
import StylePanel from '../../shared/overlay/StylePanel';
import { mulberry32 } from '../../shared/lib/prng';
import { TILES_IN_OPENER_NOTICE } from '../../shared/map/osm-tiles';
import { dayKey, type AtlasFlight } from './atlas-flight';
import { flightTone, PALETTES, paletteById, samplePalette, toHex } from './atlas-colour';
import type { AtlasPlace } from './atlas-places';
import AtlasWinnow from './AtlasWinnow';
import {
  ASPECTS,
  LOOK_PRESETS,
  MOTION_PRESETS,
  SPOTS,
  surpriseLook,
  themeWith,
  type AtlasSettings,
  type CameraFrame,
  type ClockMode,
  type ColourBy,
  type DroneLine,
  type FrameAspect,
  type GridMode,
  type LandMode,
  type Spot,
  type TileTone,
} from './atlas-settings';
import type { ChoreoMode, ChoreoOrder, Tempo } from './atlas-schedule';
import type { SpotlightPick, SpotlightSettings } from './atlas-spotlight';
import { STAT_KEYS, STAT_LABELS, type Units } from './atlas-stats';
import type { AtlasExport, ExportKind } from './use-atlas-export';
import { exportSize } from './use-atlas-export';
import { formatElapsed } from './atlas-hud';

type Update = (fn: (s: AtlasSettings) => AtlasSettings) => void;

type Tab = 'flights' | 'style' | 'motion' | 'camera' | 'overlay' | 'format' | 'export';
const TABS: { id: Tab; label: string }[] = [
  { id: 'flights', label: 'Flights' },
  { id: 'style', label: 'Style' },
  { id: 'motion', label: 'Motion' },
  { id: 'camera', label: 'Camera' },
  { id: 'overlay', label: 'Overlay' },
  { id: 'format', label: 'Format' },
  { id: 'export', label: 'Export' },
];
const TAB_KEY = 'atelier.atlas.tab';

function readTab(): Tab {
  try {
    const v = localStorage.getItem(TAB_KEY);
    return TABS.some((t) => t.id === v) ? (v as Tab) : 'flights';
  } catch {
    return 'flights';
  }
}

interface AtlasInspectorProps {
  settings: AtlasSettings;
  update: Update;
  onReset: () => void;
  flights: readonly AtlasFlight[];
  hidden: ReadonlySet<string>;
  setHidden: (next: Set<string>) => void;
  places: readonly AtlasPlace[];
  placeNames: readonly (string | null)[];
  onFocus: (id: string | null) => void;
  reading: { done: number; total: number } | null;
  empty: readonly string[];
  onAddFiles: (files: File[]) => void;
  tilesOn: boolean;
  setTilesOn: (on: boolean) => void;
  onFit: () => void;
  drawingZone: boolean;
  setDrawingZone: (on: boolean) => void;
  onZoneFromView: () => void;
  aircraftFound: readonly { name: string; count: number }[];
  unnamed: number;
  dateRange: string | null;
  /** The animation's length, hold included. */
  total: number;
  exporter: AtlasExport;
  onExport: (kind: ExportKind) => void;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const secs = (v: number) => `${v < 10 ? v.toFixed(1) : Math.round(v)} s`;

/** One slider row. */
function Slider(props: { label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void; hint?: ReactNode }) {
  return (
    <FieldRow label={props.label} hint={props.hint}>
      <RangeField label={props.label} value={props.value} min={props.min} max={props.max} step={props.step} format={props.format} onChange={props.onChange} />
    </FieldRow>
  );
}

/** One colour row. */
function Colour({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <FieldRow label={label}>
      <input type="color" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={swatchClass} />
      <Readout muted>{value}</Readout>
    </FieldRow>
  );
}

const SPOT_GLYPH: Record<Spot, string> = { tl: '↖', tc: '↑', tr: '↗', bl: '↙', bc: '↓', br: '↘' };
const SPOT_NAME: Record<Spot, string> = { tl: 'Top left', tc: 'Top', tr: 'Top right', bl: 'Bottom left', bc: 'Bottom', br: 'Bottom right' };

/** Where a piece sits: the frame's six spots, laid out as they are on the frame. */
function SpotRow({ label, value, onChange }: { label: string; value: Spot; onChange: (v: Spot) => void }) {
  return (
    <FieldRow label={label} align="start">
      <Segmented<Spot>
        size="sm"
        columns={3}
        label={label}
        value={value}
        onChange={onChange}
        options={SPOTS.map((id) => ({ id, label: SPOT_GLYPH[id], title: SPOT_NAME[id] }))}
      />
    </FieldRow>
  );
}

function placeLabel(names: readonly (string | null)[], k: number): string {
  return names[k] ?? `Place ${k + 1}`;
}

/**
 * Every dial of the atlas, in the suite's one panel grammar (`Inspector.tsx`),
 * in seven tabs: what is drawn (flights, places, drones), how it looks, how
 * it moves, what the frame shows, the words over it, the frame itself, and
 * the export.
 */
export default function AtlasInspector(p: AtlasInspectorProps) {
  const { settings: s, update } = p;
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [surprise, setSurprise] = useState(1);
  const [tab, setTab] = useState<Tab>(readTab);
  const pickTab = (next: Tab) => {
    setTab(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      /* the tab holds for the session */
    }
  };
  // Drawing a zone is a Camera-tab gesture: Escape or leaving the tab ends it.
  const { drawingZone, setDrawingZone } = p;
  useEffect(() => {
    if (!drawingZone) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawingZone(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawingZone, setDrawingZone]);
  useEffect(() => {
    if (tab !== 'camera') setDrawingZone(false);
  }, [tab, setDrawingZone]);

  const set = <K extends keyof AtlasSettings>(key: K, patch: Partial<AtlasSettings[K]>) =>
    update((cur) => ({ ...cur, [key]: { ...(cur[key] as object), ...patch } }));
  const choreo = (patch: Partial<AtlasSettings['choreo']>) => set('choreo', patch);
  const trail = (patch: Partial<AtlasSettings['trail']>) => set('trail', patch);
  const head = (patch: Partial<AtlasSettings['head']>) => set('head', patch);
  const colour = (patch: Partial<AtlasSettings['colour']>) => set('colour', patch);
  const map = (patch: Partial<AtlasSettings['map']>) => set('map', patch);
  const camera = (patch: Partial<AtlasSettings['camera']>) => set('camera', patch);
  const hud = (patch: Partial<AtlasSettings['hud']>) => set('hud', patch);
  const format = (patch: Partial<AtlasSettings['format']>) => set('format', patch);
  const spot = (patch: Partial<SpotlightSettings>) => update((cur) => ({ ...cur, camera: { ...cur.camera, spotlight: { ...cur.camera.spotlight, ...patch } } }));

  const picked = useMemo(() => new Set(s.camera.picked), [s.camera.picked]);
  const togglePicked = (id: string) =>
    update((cur) => ({ ...cur, camera: { ...cur.camera, picked: cur.camera.picked.includes(id) ? cur.camera.picked.filter((x) => x !== id) : [...cur.camera.picked, id] } }));

  const shown = p.flights.filter((f) => !p.hidden.has(f.id)).length;
  const placeOfId = useMemo(() => {
    const out = new Map<string, number>();
    p.places.forEach((pl, k) => pl.flights.forEach((i) => p.flights[i] && out.set(p.flights[i].id, k)));
    return out;
  }, [p.places, p.flights]);

  const toggleFlight = (id: string) => {
    const next = new Set(p.hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    p.setHidden(next);
  };
  const togglePlace = (k: number) => {
    const ids = p.places[k].flights.map((i) => p.flights[i]?.id).filter(Boolean) as string[];
    const allShown = ids.every((id) => !p.hidden.has(id));
    const next = new Set(p.hidden);
    for (const id of ids) {
      if (allShown) next.add(id);
      else next.delete(id);
    }
    p.setHidden(next);
  };
  const soloPlace = (k: number) => {
    const keep = new Set(p.places[k].flights.map((i) => p.flights[i]?.id));
    p.setHidden(new Set(p.flights.filter((f) => !keep.has(f.id)).map((f) => f.id)));
  };

  const dotColour = (f: AtlasFlight, i: number): string => {
    const stops = paletteById(s.colour.palette).stops;
    if (s.colour.by === 'flight') return toHex(samplePalette(stops, flightTone(i)));
    if (s.colour.by === 'place') return toHex(samplePalette(stops, flightTone(placeOfId.get(f.id) ?? 0)));
    if (s.colour.by === 'single') return s.colour.trail;
    return toHex(samplePalette(stops, 0.7));
  };

  const mode = s.choreo.mode;
  const timed = mode === 'clock' || mode === 'calendar';
  const size = exportSize(s.format.aspect, s.format.short);

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-[1] -mx-3 px-3 pt-3 pb-2 bg-surface border-b border-line">
        <Segmented<Tab> size="sm" columns={4} label="Settings" value={tab} onChange={pickTab} options={TABS} />
      </div>
      {tab === 'flights' && (
        <>
      {/* Flights ---------------------------------------------------------- */}
      <InspectorSection
        id="atlas.flights"
        title="Flights"
        badge={<span className="font-mono text-2xs text-muted tabular-nums">{shown}/{p.flights.length}</span>}
        info="Every DJI telemetry log (.srt) selected in the Library becomes a flight. Only the GPS track is read — never the video. From a connected Winnow, only each clip's .srt is downloaded. Hover a flight to single it out on the map."
      >
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" onClick={() => fileRef.current?.click()}>
              {Icons.plus} Add .srt files
            </Button>
            <Button size="sm" variant="ghost" onClick={() => folderRef.current?.click()}>
              {Icons.folder} A folder
            </Button>
            <AtlasWinnow onAdd={p.onAddFiles} />
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".srt,.SRT"
              className="hidden"
              onChange={(e) => {
                p.onAddFiles([...(e.target.files ?? [])]);
                e.target.value = '';
              }}
            />
            <input
              ref={folderRef}
              type="file"
              multiple
              className="hidden"
              {...({ webkitdirectory: '' } as Record<string, string>)}
              onChange={(e) => {
                p.onAddFiles([...(e.target.files ?? [])].filter((f) => /\.srt$/i.test(f.name)));
                e.target.value = '';
              }}
            />
          </div>
          {p.reading && (
            <p className="m-0 text-xs text-muted font-mono tabular-nums">
              Reading logs… {p.reading.done}/{p.reading.total}
            </p>
          )}
          {p.places.length > 1 && (
            <div className="flex flex-col gap-1">
              <span className="text-2xs font-mono uppercase tracking-[0.12em] text-muted">Places</span>
              <div className="flex flex-wrap gap-1">
                {p.places.map((pl, k) => {
                  const ids = pl.flights.map((i) => p.flights[i]?.id);
                  const on = ids.some((id) => id && !p.hidden.has(id));
                  return (
                    <button
                      key={pl.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => togglePlace(k)}
                      onDoubleClick={() => soloPlace(k)}
                      title="Click to show or hide this place — double-click to show it alone"
                      className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full border text-xs transition-colors border-line-strong bg-paper text-muted aria-pressed:border-accent aria-pressed:text-accent-ink aria-pressed:bg-accent-wash"
                    >
                      <span className="truncate max-w-[9rem]">{placeLabel(p.placeNames, k)}</span>
                      <span className="font-mono text-2xs tabular-nums opacity-70">{pl.flights.length}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {p.flights.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => p.setHidden(new Set())}>
                Show all
              </Button>
              <Button size="sm" variant="ghost" onClick={() => p.setHidden(new Set(p.flights.map((f) => f.id)))}>
                Hide all
              </Button>
            </div>
          )}
          <ul className="m-0 p-0 list-none flex flex-col max-h-[calc(var(--app-h)*0.32)] overflow-y-auto border border-line rounded-control divide-y divide-line">
            {p.flights.length === 0 && !p.reading && (
              <li className="px-3 py-3 text-sm text-muted">No flight yet — select DJI clips or loose .srt logs in the Library, or add some here.</li>
            )}
            {p.flights.map((f, i) => {
              const off = p.hidden.has(f.id);
              return (
                <li
                  key={f.id}
                  onMouseEnter={() => !off && p.onFocus(f.id)}
                  onMouseLeave={() => p.onFocus(null)}
                  className={`flex items-center gap-2 px-2 py-1.5 ${off ? 'opacity-45' : ''}`}
                >
                  <button
                    type="button"
                    onClick={() => toggleFlight(f.id)}
                    aria-label={off ? `Show ${f.name}` : `Hide ${f.name}`}
                    title={off ? 'Show' : 'Hide'}
                    className="flex-none w-7 h-7 grid place-items-center rounded-control text-muted hover:text-ink [&>svg]:w-4 [&>svg]:h-4"
                  >
                    {off ? Icons.eyeOff : Icons.eye}
                  </button>
                  <span className="flex-none w-2.5 h-2.5 rounded-full" style={{ background: dotColour(f, i) }} aria-hidden="true" />
                  <span className="flex-1 min-w-0 flex flex-col">
                    <span className="text-sm text-ink truncate">{f.name}</span>
                    <span className="font-mono text-2xs text-muted tabular-nums truncate">
                      {f.startWall !== null ? `${dayKey(f.startWall)} · ` : ''}
                      {formatElapsed(f.duration)} · {f.distanceKm.toFixed(2)} km · {Math.round(f.maxAlt)} m
                    </span>
                  </span>
                  {s.camera.spotlight.on && s.camera.spotlight.pick === 'picked' && (
                    <button
                      type="button"
                      onClick={() => togglePicked(f.id)}
                      aria-pressed={picked.has(f.id)}
                      aria-label={picked.has(f.id) ? `Stop following ${f.name}` : `Follow ${f.name} in the spotlight`}
                      title={picked.has(f.id) ? 'Picked for the spotlight' : 'Pick for the spotlight'}
                      className="flex-none w-7 h-7 grid place-items-center rounded-control text-faint aria-pressed:text-accent [&>svg]:w-4 [&>svg]:h-4"
                    >
                      {Icons.star}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {p.empty.length > 0 && (
            <p className="m-0 text-xs text-muted">
              {p.empty.length} log{p.empty.length === 1 ? '' : 's'} without a GPS track left out: {p.empty.slice(0, 4).join(', ')}
              {p.empty.length > 4 ? '…' : ''}
            </p>
          )}
        </div>
      </InspectorSection>

      <InspectorSection
        id="atlas.drones"
        title="Drones"
        info="The aircraft is read from each clip's own metadata (never from the log, which names none). Rename what a file says, or name the flights whose file says nothing — a loose .srt."
      >
        {p.aircraftFound.length === 0 && (
          <p className="m-0 text-xs text-muted">No clip named its aircraft{p.flights.length ? ' — the logs came without their videos, or the videos do not say.' : '.'}</p>
        )}
        {p.aircraftFound.map((a) => (
          <FieldRow key={a.name} label={<span className="font-mono text-2xs">{a.name}</span>} hint={`${a.count} flight${a.count === 1 ? '' : 's'}`} hintShown>
            <TextField
              label={`Call ${a.name}`}
              value={s.aircraft.names[a.name] ?? ''}
              placeholder={a.name}
              onChange={(v) => update((cur) => ({ ...cur, aircraft: { ...cur.aircraft, names: { ...cur.aircraft.names, [a.name]: v } } }))}
            />
          </FieldRow>
        ))}
        {p.unnamed > 0 && (
          <FieldRow label="Unnamed" hint={`${p.unnamed} flight${p.unnamed === 1 ? '' : 's'} whose file names no aircraft`} hintShown>
            <TextField label="Name the unnamed flights" value={s.aircraft.fallback} placeholder="DJI Mini 4 Pro" onChange={(v) => update((cur) => ({ ...cur, aircraft: { ...cur.aircraft, fallback: v } }))} />
          </FieldRow>
        )}
      </InspectorSection>

        </>
      )}
      {tab === 'style' && (
        <>
      {/* Looks -------------------------------------------------------------- */}
      <InspectorSection id="atlas.looks" title="Look" info="A look sets the colours, the trails, the heads and the ground at once. Every dial below stays yours afterwards.">
        <div className="grid grid-cols-4 gap-1.5">
          {LOOK_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => update(preset.apply)}
              className="flex flex-col items-stretch gap-1 p-1 rounded-control border border-line bg-paper hover:border-accent transition-colors"
              title={preset.label}
            >
              <span className="relative h-9 rounded-[6px] overflow-hidden" style={{ background: preset.swatch[0] }} aria-hidden="true">
                <span className="absolute left-1 right-3 top-[55%] h-[1.5px] rotate-[-12deg]" style={{ background: preset.swatch[1] }} />
                <span className="absolute left-3 right-1 top-[40%] h-[2px] rotate-[8deg]" style={{ background: preset.swatch[2], boxShadow: `0 0 6px ${preset.swatch[2]}` }} />
              </span>
              <span className="text-2xs text-ink-soft truncate text-center">{preset.label}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 mt-2">
          <Button
            size="sm"
            onClick={() => {
              const seed = surprise * 7919 + Date.now();
              setSurprise((n) => n + 1);
              update((cur) => surpriseLook(cur, mulberry32(seed >>> 0)));
            }}
          >
            {Icons.refresh} Surprise me
          </Button>
          <Button size="sm" variant="ghost" onClick={p.onReset}>
            {Icons.reset} Reset all
          </Button>
        </div>
      </InspectorSection>

      {/* Trails ------------------------------------------------------------- */}
      <InspectorSection id="atlas.trails" title="Trails" info="The comet behind each flight in the air, what it leaves once flown, and the faint network of every route.">
        <Slider label="Tail" value={s.trail.length} min={0.01} max={1} step={0.01} format={pct} onChange={(v) => trail({ length: v })} hint="The share of a flight its comet's tail spans — 100% draws everything flown." />
        <Slider label="Taper" value={s.trail.taper} min={0} max={1} step={0.01} format={pct} onChange={(v) => trail({ taper: v })} />
        <Slider label="Width" value={s.trail.width} min={0.3} max={10} step={0.1} format={(v) => `${v.toFixed(1)} px`} onChange={(v) => trail({ width: v })} />
        <Slider label="Afterglow" value={s.trail.afterglow} min={0} max={1} step={0.01} format={pct} onChange={(v) => trail({ afterglow: v })} hint="What a flight leaves behind once flown." />
        <Slider label="Fades in" value={s.trail.decay} min={0} max={30} step={0.5} format={(v) => (v === 0 ? 'never' : secs(v))} onChange={(v) => trail({ decay: v })} />
        <Slider label="Network" value={s.trail.ghost} min={0} max={1} step={0.01} format={pct} onChange={(v) => trail({ ghost: v })} hint="Every route, faint, from the first frame." />
        <Slider label="Network width" value={s.trail.ghostWidth} min={0.2} max={6} step={0.1} format={(v) => `${v.toFixed(1)} px`} onChange={(v) => trail({ ghostWidth: v })} />
        <SwitchRow label="Smooth curves through the GPS fixes" checked={s.trail.smooth} onChange={(v) => trail({ smooth: v })} />
      </InspectorSection>

      {/* Heads -------------------------------------------------------------- */}
      <InspectorSection id="atlas.heads" title="Drones" info="The dot at the head of each flight: its size, its breathing, the ripple it makes at take-off and landing, and its altitude drawn as height.">
        <Slider label="Size" value={s.head.size} min={0} max={12} step={0.1} format={(v) => (v === 0 ? 'hidden' : `${v.toFixed(1)} px`)} onChange={(v) => head({ size: v })} />
        <Slider label="Pulse" value={s.head.pulse} min={0} max={1} step={0.01} format={pct} onChange={(v) => head({ pulse: v })} />
        <Slider label="Pulse rate" value={s.head.pulseRate} min={0.1} max={5} step={0.1} format={(v) => `${v.toFixed(1)} /s`} onChange={(v) => head({ pulseRate: v })} />
        <Slider label="Halo" value={s.head.halo} min={0} max={1} step={0.01} format={pct} onChange={(v) => head({ halo: v })} />
        <Slider label="Ripples" value={s.head.ripple} min={0} max={1} step={0.01} format={pct} onChange={(v) => head({ ripple: v })} hint="A ring that spreads where a flight takes off and lands." />
        <Slider label="Altitude" value={s.head.lift} min={0} max={150} step={1} format={(v) => (v === 0 ? 'flat' : `${v} px/100 m`)} onChange={(v) => head({ lift: v })} hint="Lift each line by its height above take-off — tilt the camera to see it as relief." />
        {s.head.lift > 0 && (
          <>
            <SwitchRow label="Shadow on the ground" checked={s.head.shadow} onChange={(v) => head({ shadow: v })} />
            <SwitchRow label="Thread from the drone to its shadow" checked={s.head.tether} onChange={(v) => head({ tether: v })} />
          </>
        )}
      </InspectorSection>

      {/* Colour ------------------------------------------------------------- */}
      <InspectorSection id="atlas.colour" title="Colour" info="What a line's colour says: one colour, one per flight or per place, or the altitude, the speed, the date or the hour of the day.">
        <FieldRow label="Colour by">
          <SelectField<ColourBy>
            label="Colour by"
            value={s.colour.by}
            onChange={(v) => colour({ by: v })}
            options={[
              { id: 'single', label: 'One colour' },
              { id: 'flight', label: 'Each flight' },
              { id: 'place', label: 'Each place' },
              { id: 'altitude', label: 'Altitude' },
              { id: 'speed', label: 'Speed' },
              { id: 'date', label: 'Date (oldest → newest)' },
              { id: 'hour', label: 'Hour of the day' },
            ]}
          />
        </FieldRow>
        {s.colour.by !== 'single' && s.colour.by !== 'hour' && (
          <FieldRow label="Palette" align="start">
            <div className="grid grid-cols-3 gap-1 w-full">
              {PALETTES.map((pal) => (
                <button
                  key={pal.id}
                  type="button"
                  aria-pressed={s.colour.palette === pal.id}
                  onClick={() => colour({ palette: pal.id })}
                  className="flex flex-col gap-0.5 p-1 rounded-[7px] border border-transparent aria-pressed:border-accent hover:border-line-strong"
                  title={pal.label}
                >
                  <span className="h-3 rounded-[4px]" style={{ background: `linear-gradient(90deg, ${pal.stops.join(',')})` }} aria-hidden="true" />
                  <span className="text-3xs text-muted truncate">{pal.label}</span>
                </button>
              ))}
            </div>
          </FieldRow>
        )}
        {s.colour.by === 'single' && <Colour label="Trail" value={s.colour.trail} onChange={(v) => colour({ trail: v })} />}
        <Colour label="Drone" value={s.colour.head} onChange={(v) => colour({ head: v })} />
        <Colour label="Network" value={s.colour.ghost} onChange={(v) => colour({ ghost: v })} />
        <Slider label="Glow" value={s.colour.glow} min={0} max={1} step={0.01} format={pct} onChange={(v) => colour({ glow: v })} />
        <SwitchRow label="Light adds up where lines cross" checked={s.colour.additive} onChange={(v) => colour({ additive: v })} hint="On for a night look; off on a light ground." />
      </InspectorSection>

      {/* Map ---------------------------------------------------------------- */}
      <InspectorSection id="atlas.map" title="Map" info="The ground under the flights: a colour, the coastline shipped with the app (offline), a grid, and — only if you turn it on here — OpenStreetMap tiles.">
        <Colour label="Ground" value={s.map.background} onChange={(v) => map({ background: v })} />
        <FieldRow label="Land">
          <Segmented<LandMode>
            size="sm"
            fill
            label="Land"
            value={s.map.land}
            onChange={(v) => map({ land: v })}
            options={[
              { id: 'off', label: 'Off' },
              { id: 'fill', label: 'Filled' },
              { id: 'outline', label: 'Coast' },
            ]}
          />
        </FieldRow>
        {s.map.land !== 'off' && <Colour label="Land colour" value={s.map.landColour} onChange={(v) => map({ landColour: v })} />}
        <FieldRow label="Grid">
          <Segmented<GridMode>
            size="sm"
            fill
            label="Grid"
            value={s.map.grid}
            onChange={(v) => map({ grid: v })}
            options={[
              { id: 'off', label: 'Off' },
              { id: 'lines', label: 'Lines' },
              { id: 'dots', label: 'Dots' },
            ]}
          />
        </FieldRow>
        {s.map.grid !== 'off' && <Colour label="Grid colour" value={s.map.gridColour} onChange={(v) => map({ gridColour: v })} />}
        <Slider label="Vignette" value={s.map.vignette} min={0} max={1} step={0.01} format={pct} onChange={(v) => map({ vignette: v })} />
        <SwitchRow label="Place names on the map" checked={s.map.labels} onChange={(v) => map({ labels: v })} />
        <SwitchRow label="OpenStreetMap tiles" checked={p.tilesOn} onChange={p.setTilesOn} hint={TILES_IN_OPENER_NOTICE} />
        {p.tilesOn && (
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
            <Slider label="Dim" value={s.map.tileDim} min={0} max={1} step={0.01} format={pct} onChange={(v) => map({ tileDim: v })} />
          </>
        )}
      </InspectorSection>

        </>
      )}
      {tab === 'motion' && (
        <>
      {/* Motion ------------------------------------------------------------- */}
      <InspectorSection id="atlas.motion" title="Choreography" info="When each flight plays. Together, one after another, in relay, on the hour of day they were flown, or in the order of the calendar.">
        <div className="flex flex-wrap gap-1 mb-1">
          {MOTION_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              title={preset.hint}
              onClick={() => update(preset.apply)}
              className="h-7 px-2.5 rounded-full border border-line-strong bg-paper text-xs text-ink-soft hover:border-accent hover:text-accent-ink transition-colors"
            >
              {preset.label}
            </button>
          ))}
        </div>
        <FieldRow label="Mode">
          <SelectField<ChoreoMode>
            label="Mode"
            value={mode}
            onChange={(v) => choreo({ mode: v })}
            options={[
              { id: 'together', label: 'Together — all at once' },
              { id: 'cascade', label: 'Cascade — staggered launches' },
              { id: 'relay', label: 'Relay — one after the other' },
              { id: 'clock', label: 'Day clock — at the hour flown' },
              { id: 'calendar', label: 'Calendar — in the order flown' },
            ]}
          />
        </FieldRow>
        {!timed && (
          <FieldRow label="Order">
            <SelectField<ChoreoOrder>
              label="Order"
              value={s.choreo.order}
              onChange={(v) => choreo({ order: v })}
              options={[
                { id: 'date', label: 'Oldest first' },
                { id: 'date-desc', label: 'Newest first' },
                { id: 'duration', label: 'Shortest first' },
                { id: 'duration-desc', label: 'Longest first' },
                { id: 'distance', label: 'Farthest flown first' },
                { id: 'altitude', label: 'Highest first' },
                { id: 'west-east', label: 'West to east' },
                { id: 'north-south', label: 'North to south' },
                { id: 'name', label: 'By name' },
                { id: 'random', label: 'Shuffled' },
              ]}
            />
          </FieldRow>
        )}
        <Slider label="Length" value={s.choreo.length} min={5} max={180} step={1} format={secs} onChange={(v) => choreo({ length: v })} hint="How long the whole animation lasts, whatever the flights' own lengths." />
        {mode === 'cascade' && (
          <Slider label="Stagger" value={s.choreo.stagger} min={0} max={1.5} step={0.01} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => choreo({ stagger: v })} hint="Time between two take-offs, as a share of an average flight." />
        )}
        {mode === 'relay' && (
          <Slider label="Overlap" value={s.choreo.overlap} min={0} max={0.95} step={0.01} format={pct} onChange={(v) => choreo({ overlap: v })} hint="How much of a flight the next one already flies over." />
        )}
        {mode === 'clock' && (
          <>
            <Slider label="Slow-down" value={s.choreo.dayStretch} min={1} max={120} step={1} format={(v) => `×${v}`} onChange={(v) => choreo({ dayStretch: v })} hint="A flight runs this many times slower than the clock, so a ten-minute hop is more than a blink." />
            <SwitchRow label="Skip the night — the day starts at the first flight" checked={s.choreo.cropNight} onChange={(v) => choreo({ cropNight: v })} />
          </>
        )}
        {mode === 'calendar' && (
          <Slider
            label="Idle kept"
            value={s.choreo.idleCap}
            min={0}
            max={6}
            step={0.05}
            format={(v) => (v < 1 ? `${Math.round(v * 60)} min` : `${v.toFixed(1)} h`)}
            onChange={(v) => choreo({ idleCap: v })}
            hint="The longest pause kept between two flights — the clock races through the rest."
          />
        )}
        <Slider label="Equalize" value={s.choreo.equalize} min={0} max={1} step={0.01} format={pct} onChange={(v) => choreo({ equalize: v })} hint="0 keeps each flight's real length; 100% gives every flight the same." />
        {(mode === 'cascade' || mode === 'relay') && (
          <FieldRow label="Jitter">
            <RangeField label="Jitter" value={s.choreo.jitter} min={0} max={1} step={0.01} format={pct} onChange={(v) => choreo({ jitter: v })} />
            <IconButton size="sm" variant="ghost" label="Shake differently" onClick={() => choreo({ seed: (s.choreo.seed * 48271 + 11) % 2147483647 })}>
              {Icons.refresh}
            </IconButton>
          </FieldRow>
        )}
        <FieldRow label="Tempo" hint="How time runs inside each flight.">
          <Segmented<Tempo>
            size="sm"
            fill
            label="Tempo"
            value={s.choreo.tempo}
            onChange={(v) => choreo({ tempo: v })}
            options={[
              { id: 'linear', label: 'Even' },
              { id: 'ease', label: 'Ease' },
              { id: 'rush', label: 'Rush' },
              { id: 'linger', label: 'Linger' },
            ]}
          />
        </FieldRow>
        <Slider label="Hold at end" value={s.choreo.hold} min={0} max={10} step={0.5} format={secs} onChange={(v) => choreo({ hold: v })} />
      </InspectorSection>

        </>
      )}
      {tab === 'camera' && (
        <>
      {/* Camera ------------------------------------------------------------- */}
      <InspectorSection id="atlas.camera" title="Framing" info="Which part of the world the frame shows: the whole world, every flight, one place, a zone you draw, a camera that follows what is in the air, or wherever you drag and zoom the map.">
        <FieldRow label="Show" align="start">
          <Segmented<CameraFrame>
            size="sm"
            columns={3}
            label="Frame"
            value={s.camera.frame}
            onChange={(v) => camera({ frame: v, place: v === 'place' ? (s.camera.place ?? p.places[0]?.id ?? null) : s.camera.place })}
            options={[
              { id: 'world', label: 'World' },
              { id: 'all', label: 'Flights' },
              { id: 'place', label: 'Place', disabled: p.places.length === 0 ? 'No place yet' : false },
              { id: 'zone', label: 'Zone' },
              { id: 'follow', label: 'Follow' },
              { id: 'free', label: 'Free' },
            ]}
          />
        </FieldRow>
        {s.camera.frame === 'place' && p.places.length > 0 && (
          <FieldRow label="Place">
            <SelectField<string>
              label="Place"
              value={s.camera.place ?? p.places[0].id}
              onChange={(v) => camera({ place: v })}
              options={p.places.map((pl, k) => ({ id: pl.id, label: `${placeLabel(p.placeNames, k)} · ${pl.flights.length}` }))}
            />
          </FieldRow>
        )}
        {s.camera.frame === 'place' && p.places.length > 1 && (
          <div className="flex gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => soloPlace(Math.max(0, p.places.findIndex((pl) => pl.id === (s.camera.place ?? p.places[0].id))))}>
              Play only this place&rsquo;s flights
            </Button>
          </div>
        )}
        {s.camera.frame === 'zone' && (
          <FieldRow label="Zone" hint={s.camera.zone ? 'The frame shows exactly this zone.' : 'No zone yet: every flight is framed until you draw one.'} hintShown>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant={p.drawingZone ? 'primary' : 'default'} onClick={() => p.setDrawingZone(!p.drawingZone)}>
                {p.drawingZone ? 'Drawing… (Esc)' : 'Draw on the map'}
              </Button>
              <Button size="sm" variant="ghost" onClick={p.onZoneFromView}>
                Use this view
              </Button>
            </div>
          </FieldRow>
        )}
        {s.camera.frame === 'follow' && (
          <Slider label="Tightness" value={s.camera.tightness} min={0} max={1} step={0.01} format={pct} onChange={(v) => camera({ tightness: v })} hint="How quickly the camera catches up with the flights." />
        )}
        {(s.camera.frame === 'all' || s.camera.frame === 'place' || s.camera.frame === 'follow') && (
          <Slider label="Margin" value={s.camera.padding} min={0} max={0.4} step={0.01} format={pct} onChange={(v) => camera({ padding: v })} />
        )}
        {s.camera.frame !== 'free' && (
          <Slider label="Drift" value={s.camera.drift} min={-2} max={2} step={0.05} format={(v) => (v === 0 ? 'still' : `${v > 0 ? 'in' : 'out'} ${Math.abs(v).toFixed(2)}`)} onChange={(v) => camera({ drift: v })} hint="A slow zoom over the whole animation." />
        )}
        <Slider label="Bearing" value={s.camera.bearing} min={-180} max={180} step={1} format={(v) => `${v}°`} onChange={(v) => camera({ bearing: v })} />
        <Slider label="Tilt" value={s.camera.tilt} min={0.3} max={1} step={0.01} format={(v) => (v >= 0.995 ? 'top-down' : `${Math.round(Math.acos(v) * (180 / Math.PI))}°`)} onChange={(v) => camera({ tilt: v })} />
        <div className="flex gap-1.5">
          <Button size="sm" onClick={p.onFit}>
            {Icons.map} Fit every flight
          </Button>
        </div>
      </InspectorSection>

      <InspectorSection
        id="atlas.spotlight"
        title="Spotlight"
        marked={s.camera.spotlight.on}
        info="Now and then the camera leaves its frame, dives on one flight, follows it for a while and comes back. Optional: off, the camera never moves for it."
      >
        <SwitchRow label="Follow a drone from time to time" checked={s.camera.spotlight.on} onChange={(v) => spot({ on: v })} />
        {s.camera.spotlight.on && (
          <>
            <FieldRow label="Which">
              <SelectField<SpotlightPick>
                label="Which flight"
                value={s.camera.spotlight.pick}
                onChange={(v) => spot({ pick: v })}
                options={[
                  { id: 'random', label: 'At random' },
                  { id: 'picked', label: 'The flights I pick (★)' },
                  { id: 'longest', label: 'The longest still flying' },
                  { id: 'farthest', label: 'The one that goes farthest' },
                ]}
              />
            </FieldRow>
            {s.camera.spotlight.pick === 'picked' && (
              <p className="m-0 text-xs text-muted">
                {picked.size ? `${picked.size} picked — ` : 'None picked yet — every flight is a candidate. '}tick the ★ beside a flight in the Flights tab.
              </p>
            )}
            <Slider label="Every" value={s.camera.spotlight.every} min={0.5} max={30} step={0.5} format={secs} onChange={(v) => spot({ every: v })} hint="Time on the frame between two dives." />
            <Slider label="Follow for" value={s.camera.spotlight.hold} min={1} max={30} step={0.5} format={secs} onChange={(v) => spot({ hold: v })} />
            <Slider
              label="Closeness"
              value={s.camera.spotlight.closeness}
              min={0.1}
              max={10}
              step={0.1}
              format={(v) => (v < 1 ? `${Math.round(v * 1000)} m` : `${v.toFixed(1)} km`)}
              onChange={(v) => spot({ closeness: v })}
              hint="What the frame spans while following."
            />
            <Slider label="Others fade" value={s.camera.spotlight.dim} min={0} max={1} step={0.01} format={pct} onChange={(v) => spot({ dim: v })} />
            {s.camera.spotlight.pick === 'random' && (
              <div className="flex gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => spot({ seed: (s.camera.spotlight.seed * 48271 + 7) % 2147483647 })}>
                  {Icons.refresh} Other flights
                </Button>
              </div>
            )}
          </>
        )}
      </InspectorSection>
        </>
      )}
      {tab === 'overlay' && (
        <>
      {/* Overlay ------------------------------------------------------------ */}
      <InspectorSection id="atlas.textstyle" title="Text style" info="The same title styles as the Studio and Trips: pick a preset, then its font, case, colour, legibility and glow. Every word of the overlay wears it.">
        <StylePanel theme={s.hud.theme} onChange={(theme) => hud({ theme: theme ?? themeWith('neutral') })} heading={null} />
        <Colour label="Accent" value={s.hud.accent} onChange={(v) => hud({ accent: v })} />
        <Slider label="Text size" value={s.hud.scale} min={0.5} max={2} step={0.05} format={pct} onChange={(v) => hud({ scale: v })} />
      </InspectorSection>

      <InspectorSection id="atlas.title" title="Title" marked={!!(s.hud.title || s.hud.subtitle)} info="The post's title and its subtitle.">
        <FieldRow label="Title">
          <TextField label="Title" value={s.hud.title} onChange={(v) => hud({ title: v })} placeholder="Australia, by drone" />
        </FieldRow>
        <FieldRow label="Subtitle">
          <TextField label="Subtitle" value={s.hud.subtitle} onChange={(v) => hud({ subtitle: v })} placeholder="Six months, 37 flights" />
        </FieldRow>
        <Slider label="Size" value={s.hud.titleSize} min={0.4} max={3} step={0.05} format={pct} onChange={(v) => hud({ titleSize: v })} />
        <SpotRow label="Where" value={s.hud.titleAt} onChange={(v) => hud({ titleAt: v })} />
      </InspectorSection>

      <InspectorSection id="atlas.stats" title="Statistics" marked={s.hud.stats.length > 0} info="What the flights add up to, measured from the tracks: live (the numbers grow as the animation flies) or the totals throughout.">
        <div className="flex flex-wrap gap-1">
          {STAT_KEYS.map((key) => {
            const on = s.hud.stats.includes(key);
            return (
              <button
                key={key}
                type="button"
                aria-pressed={on}
                onClick={() => hud({ stats: on ? s.hud.stats.filter((k) => k !== key) : STAT_KEYS.filter((k) => k === key || s.hud.stats.includes(k)) })}
                className="h-7 px-2.5 rounded-full border text-xs transition-colors border-line-strong bg-paper text-muted aria-pressed:border-accent aria-pressed:text-accent-ink aria-pressed:bg-accent-wash"
              >
                {STAT_LABELS[key]}
              </button>
            );
          })}
        </div>
        {s.hud.stats.length > 0 && (
          <>
            <FieldRow label="Count">
              <Segmented<string> size="sm" fill label="Count" value={s.hud.statsLive ? 'live' : 'total'} onChange={(v) => hud({ statsLive: v === 'live' })} options={[{ id: 'live', label: 'As it flies' }, { id: 'total', label: 'Totals' }]} />
            </FieldRow>
            <FieldRow label="Layout">
              <Segmented<'row' | 'column'> size="sm" fill label="Layout" value={s.hud.statsLayout} onChange={(v) => hud({ statsLayout: v })} options={[{ id: 'column', label: 'Column' }, { id: 'row', label: 'Row' }]} />
            </FieldRow>
            <FieldRow label="Units">
              <Segmented<Units> size="sm" fill label="Units" value={s.hud.units} onChange={(v) => hud({ units: v })} options={[{ id: 'metric', label: 'km · m' }, { id: 'imperial', label: 'mi · ft' }]} />
            </FieldRow>
            <SpotRow label="Where" value={s.hud.statsAt} onChange={(v) => hud({ statsAt: v })} />
          </>
        )}
      </InspectorSection>

      <InspectorSection id="atlas.clock" title="Clock and count" info="A clock, the number of drones in the air, the activity curve and the credits — stacked in one spot.">
        <FieldRow label="Clock">
          <SelectField<ClockMode>
            label="Clock"
            value={s.hud.clock}
            onChange={(v) => hud({ clock: v })}
            options={[
              { id: 'auto', label: 'Auto (follows the mode)' },
              { id: 'time', label: 'Time of day' },
              { id: 'date', label: 'Date' },
              { id: 'datetime', label: 'Date and time' },
              { id: 'elapsed', label: 'Elapsed' },
              { id: 'off', label: 'Off' },
            ]}
          />
        </FieldRow>
        <SwitchRow label="Count what is flying" checked={s.hud.counter} onChange={(v) => hud({ counter: v })} />
        {s.hud.counter && (
          <FieldRow label="Words">
            <TextField label="Words after the count" value={s.hud.noun} onChange={(v) => hud({ noun: v })} placeholder="drones flying" />
          </FieldRow>
        )}
        <SwitchRow label="Activity curve" checked={s.hud.graph} onChange={(v) => hud({ graph: v })} />
        <SwitchRow label="Data credit" checked={s.hud.credit} onChange={(v) => hud({ credit: v })} hint="The map's own credit is always written when its tiles are drawn." />
        <SpotRow label="Where" value={s.hud.clockAt} onChange={(v) => hud({ clockAt: v })} />
      </InspectorSection>

      <InspectorSection id="atlas.info" title="Dates and drones" marked={s.hud.dates || s.hud.drone !== 'off'} info="The span of the flights shown, and the aircraft that flew them (named in the Flights tab).">
        <SwitchRow label="Date range" checked={s.hud.dates} onChange={(v) => hud({ dates: v })} hint={p.dateRange ?? 'No flight carries a date.'} hintShown />
        {s.hud.dates && <SpotRow label="Where" value={s.hud.datesAt} onChange={(v) => hud({ datesAt: v })} />}
        <FieldRow label="Drone">
          <Segmented<DroneLine> size="sm" fill label="Drone" value={s.hud.drone} onChange={(v) => hud({ drone: v })} options={[{ id: 'off', label: 'Off' }, { id: 'all', label: 'All shown' }, { id: 'flying', label: 'In the air' }]} />
        </FieldRow>
        {s.hud.drone !== 'off' && <SpotRow label="Where" value={s.hud.droneAt} onChange={(v) => hud({ droneAt: v })} />}
        <SwitchRow
          label="A card for the drone in the spotlight"
          checked={s.hud.spotCard}
          onChange={(v) => hud({ spotCard: v })}
          hint={s.camera.spotlight.on ? 'Its name, day, aircraft, height, speed and distance, while it is followed.' : 'Turn the spotlight on in the Camera tab.'}
          hintShown={!s.camera.spotlight.on}
        />
        {s.hud.spotCard && <SpotRow label="Where" value={s.hud.spotCardAt} onChange={(v) => hud({ spotCardAt: v })} />}
      </InspectorSection>
        </>
      )}
      {tab === 'format' && (
        <>
      {/* Format ------------------------------------------------------------- */}
      <InspectorSection id="atlas.format" title="Frame" info="The shape and size of the picture, and the mount around the map — a border, a band for the text, rounded corners. The preview is the file.">
        <FieldRow label="Ratio">
          <Segmented<FrameAspect> size="sm" fill label="Ratio" value={s.format.aspect} onChange={(v) => format({ aspect: v })} options={ASPECTS.map((a) => ({ id: a, label: a }))} />
        </FieldRow>
        <FieldRow label="Resolution" hint={`${size.w} × ${size.h} px`} hintShown>
          <Segmented<string>
            size="sm"
            fill
            label="Resolution"
            value={String(s.format.short)}
            onChange={(v) => format({ short: Number(v) })}
            options={[
              { id: '720', label: '720' },
              { id: '1080', label: '1080' },
              { id: '1440', label: '1440' },
              { id: '2160', label: '4K' },
            ]}
          />
        </FieldRow>
        <FieldRow label="Frame rate">
          <Segmented<string> size="sm" fill label="Frame rate" value={String(s.format.fps)} onChange={(v) => format({ fps: Number(v) })} options={[{ id: '30', label: '30 fps' }, { id: '60', label: '60 fps' }]} />
        </FieldRow>
      </InspectorSection>
      <InspectorSection id="atlas.mount" title="Border" marked={s.format.border > 0 || s.format.band > 0 || s.format.radius > 0} info="A mount around the map, like a print's: its width, a deeper band under the map for the title, its colour, and the map's rounded corners.">
        <Slider label="Border" value={s.format.border} min={0} max={0.2} step={0.005} format={pct} onChange={(v) => format({ border: v })} />
        <Slider label="Text band" value={s.format.band} min={0} max={0.45} step={0.005} format={pct} onChange={(v) => format({ band: v })} hint="Extra room under the map." />
        <Slider label="Corners" value={s.format.radius} min={0} max={0.12} step={0.002} format={pct} onChange={(v) => format({ radius: v })} />
        <Colour label="Colour" value={s.format.borderColour} onChange={(v) => format({ borderColour: v })} />
        <FieldRow label="Text on">
          <Segmented<'map' | 'frame'> size="sm" fill label="Text on" value={s.format.textOn} onChange={(v) => format({ textOn: v })} options={[{ id: 'map', label: 'The map' }, { id: 'frame', label: 'The whole frame' }]} />
        </FieldRow>
      </InspectorSection>
        </>
      )}
      {tab === 'export' && (
        <>
      {/* Export ------------------------------------------------------------- */}
      <InspectorSection id="atlas.export" title="Export" info="The preview IS the file: the same painter draws both. A video is H.264 with no sound; a poster draws every route whole.">
        <p className="m-0 text-sm text-ink-soft">
          {size.w} × {size.h} · {s.format.fps} fps · {formatElapsed(p.total)} · {shown} flight{shown === 1 ? '' : 's'}
        </p>
        <div className="flex flex-wrap gap-1.5">
          <Button variant="primary" size="sm" disabled={!!p.exporter.running || shown === 0} onClick={() => p.onExport('mp4')}>
            {Icons.export} Video
          </Button>
          <Button size="sm" disabled={!!p.exporter.running || shown === 0} onClick={() => p.onExport('still')}>
            {Icons.image} This frame
          </Button>
          <Button size="sm" disabled={!!p.exporter.running || shown === 0} onClick={() => p.onExport('poster')}>
            {Icons.image} Poster
          </Button>
        </div>
        {p.exporter.running && (
          <div className="flex items-center gap-2 mt-2">
            <div className="flex-1 h-1.5 rounded-full bg-paper-2 overflow-hidden">
              <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round((p.exporter.progress ?? 0) * 100)}%` }} />
            </div>
            <span className="text-xs text-muted">{p.exporter.running}</span>
            <Button size="sm" variant="ghost" onClick={p.exporter.cancel}>
              Cancel
            </Button>
          </div>
        )}
        {p.exporter.note && <p className="m-0 mt-2 text-xs text-muted">{p.exporter.note}</p>}
      </InspectorSection>
        </>
      )}
    </div>
  );
}

