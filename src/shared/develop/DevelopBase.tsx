import OverflowMenu, { type OverflowItem } from '../ui/OverflowMenu';
import { formatBytes } from '../lib/format';
import { renditionFacts, type Rendition } from '../media/renditions';
import { BASE_LABELS, baseRung, signed, type DevelopBase } from './develop';

export type { DevelopBase } from './develop';

/**
 * What each rung ADDS to the one below — the whole point of a ladder, and the
 * line a person reads before climbing it.
 */
export const BASE_ADDS: Readonly<Record<DevelopBase, string>> = Object.freeze({
  proxy: 'the 8-bit picture every browser decodes — the render your camera wrote, or your source’s proxy. It clips at white.',
  gain: 'the sensor’s own data at sixteen bits, metered by its brightest tone. A real white balance, and the highlights above white are there to bring back.',
  gainMap: 'and the shading grid the body was calibrated for — up to 2.5 stops at the corners on a DJI, a different figure per channel.',
  gainMapWarp: 'and the rectilinear warp beside it: the magnification and the lateral colour fringe the same file states.',
});

/** What a delivered row IS, in the words under its name. */
function describeDelivered(row: Rendition): string {
  if (row.blocked) return row.blocked;
  const fetched = row.here ? '' : ' — fetched from its instance and held for this session';
  if (row.reach === 'embedded') return `the 8-bit render your camera wrote inside the RAW${fetched}`;
  return `the file itself, 8-bit, drawn as it is${fetched}`;
}

/**
 * THE CAPTURE'S FILES, under the fidelity chip (2026-09-21, replacing the
 * four-rung ladder of 2026-09-20 — `docs/capture-renditions.md` §9.1).
 *
 * One list: the source's proxy where there is one, then what the camera
 * delivered — a JPEG, a HEIF, the render inside a RAW — then the sensor,
 * with the calibration rungs (`raw/calibration.ts`) nested under it, since
 * they are amounts of the SENSOR's own calibration and mean nothing on a
 * render. A row this browser cannot draw is listed blocked and says why; a
 * row not in hand says what fetching it costs before it is pressed.
 *
 * It hangs off the chip rather than sitting in the inspector (the
 * maintainer's placement): the chip already says what the picture IS, so
 * what it could be belongs on the same word, above the photograph, where it
 * is read at the moment the question comes up.
 */
export function DevelopBaseMenu({
  chip,
  rows,
  current,
  base,
  rungs,
  onRendition,
  onBase,
  status,
  gain,
  calibration,
  className = '',
}: {
  /** The fidelity chip's own words — this is that chip, made pressable. */
  chip: string;
  /** Every rendition of the capture, in the order `renditionsOf` gives them. */
  rows: readonly Rendition[];
  /** The rendition on screen, when the develop is below the sensor. */
  current: string | null;
  /** The rung the develop stands on; `proxy` while a rendition is on screen. */
  base: DevelopBase;
  /** Which rungs the RAW can honestly offer, lowest first (`rungsFor`). */
  rungs: readonly DevelopBase[];
  onRendition: (id: string) => void;
  onBase: (base: DevelopBase) => void;
  /** What is happening to get the chosen bytes on screen — fetching, decoding — or null. */
  status: string | null;
  /** The metered exposure once the sensor is decoded, as `rawGain`; null before. */
  gain: number | null;
  /** What the RAW's own calibration asks for, once read; null when it carries none. */
  calibration?: string | null;
  className?: string;
}) {
  const onSensor = baseRung(base) > 0;
  const ev = gain ? Math.log2(gain) : 0;
  const sensor = rows.find((r) => r.role === 'sensor') ?? null;

  const item = (id: string, marked: boolean, title: string, facts: string, hint: string, onSelect: () => void, disabled = false): OverflowItem => ({
    id,
    title: hint,
    disabled,
    onSelect,
    label: (
      <span className="flex flex-col items-start gap-0.5 text-left">
        <span className="font-mono text-xs">
          {marked ? '· ' : '  '}
          {title}
          {facts && <span className="text-faint"> · {facts}</span>}
        </span>
        <span className="font-mono text-3xs text-faint leading-relaxed max-w-[22rem] whitespace-normal">{hint}</span>
      </span>
    ),
  });

  const items: OverflowItem[] = rows
    .filter((r) => r.role !== 'sensor')
    .map((row) => {
      const marked = !onSensor && row.id === current;
      const hint = marked && status ? status : row.role === 'proxy' ? BASE_ADDS.proxy : describeDelivered(row);
      return item(
        row.id,
        marked,
        row.role === 'proxy' ? 'Proxy' : row.name,
        renditionFacts(row, formatBytes),
        hint,
        () => onRendition(row.id),
        Boolean(row.blocked),
      );
    });

  if (sensor) {
    for (const rung of rungs) {
      if (rung === 'proxy') continue;
      const marked = onSensor && rung === base;
      let hint: string;
      if (marked) {
        hint = gain ? `metered ${ev ? `${signed(ev, 1)} EV` : 'at its white'}` : (status ?? 'decoding the sensor’s data…');
      } else if (rung === 'gain' && !onSensor && !sensor.here) {
        hint = `opens ${sensor.name} from its instance${sensor.bytes ? ` · ${formatBytes(sensor.bytes)}` : ''}, held for this session`;
      } else {
        hint = BASE_ADDS[rung];
      }
      items.push(
        item(
          rung,
          marked,
          rung === 'gain' ? `${sensor.name} → ${BASE_LABELS.gain}` : `→ ${BASE_LABELS[rung]}`,
          rung === 'gain' ? renditionFacts(sensor, formatBytes) : '',
          hint,
          () => onBase(rung),
        ),
      );
    }
  }

  // What the FILE asks for, said once at the foot: the numbers a person can
  // check against the picture, rather than a promise.
  if (calibration) {
    items.push({
      id: 'calibration',
      disabled: true,
      onSelect: () => {},
      label: (
        <span className="font-mono text-3xs text-faint whitespace-normal max-w-[22rem]">this file asks for {calibration}</span>
      ),
    });
  }

  return (
    <OverflowMenu
      label="What this picture is developed from"
      className={className}
      size="sm"
      align="end"
      trigger={{ text: chip, variant: 'ghost' }}
      disabled={items.filter((i) => !i.disabled).length <= 1}
      items={items}
    />
  );
}
