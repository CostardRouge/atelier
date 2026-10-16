import { FieldRow, TextField } from '../../shared/ui/Inspector';
import type { AtlasSettings } from './atlas-settings';

interface AtlasDroneNamesProps {
  settings: AtlasSettings;
  update: (fn: (s: AtlasSettings) => AtlasSettings) => void;
  /** Each aircraft a clip names, and how many flights it flew. */
  found: readonly { name: string; count: number }[];
  /** Flights whose file names no aircraft. */
  unnamed: number;
  /** Whether any flight is loaded at all — the empty line says why there is nothing. */
  hasFlights: boolean;
}

/**
 * The drones' names, one row per aircraft a clip names (renamed or left as
 * the file says) and one for the flights whose file says nothing. ONE
 * setting (`aircraft.names`, `aircraft.fallback`) drawn in two places: the
 * flight list's Drone names and the Sticker layer, where the names show.
 */
export default function AtlasDroneNames({ settings: s, update, found, unnamed, hasFlights }: AtlasDroneNamesProps) {
  return (
    <>
      {found.length === 0 && <p className="m-0 text-xs text-muted">No clip named its aircraft{hasFlights ? ' — the logs came without their videos, or the videos do not say.' : '.'}</p>}
      {found.map((a) => (
        <FieldRow key={a.name} label={<span className="font-mono text-2xs">{a.name}</span>} hint={`${a.count} flight${a.count === 1 ? '' : 's'}`} hintShown>
          <TextField
            label={`Call ${a.name}`}
            value={s.aircraft.names[a.name] ?? ''}
            placeholder={a.name}
            onChange={(v) => update((cur) => ({ ...cur, aircraft: { ...cur.aircraft, names: { ...cur.aircraft.names, [a.name]: v } } }))}
          />
        </FieldRow>
      ))}
      {unnamed > 0 && (
        <FieldRow label="Unnamed" hint={`${unnamed} flight${unnamed === 1 ? '' : 's'} whose file names no aircraft`} hintShown>
          <TextField label="Name the unnamed flights" value={s.aircraft.fallback} placeholder="DJI Mini 4 Pro" onChange={(v) => update((cur) => ({ ...cur, aircraft: { ...cur.aircraft, fallback: v } }))} />
        </FieldRow>
      )}
    </>
  );
}
