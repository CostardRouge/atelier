import OverflowMenu from '../ui/OverflowMenu';
import { formatBytes } from '../lib/format';
import { BASE_LABELS, baseRung, signed, type DevelopBase } from './develop';

export type { DevelopBase } from './develop';

/** Where the sensor's data would come from: the file in hand is a RAW, or a proxy's original is one. */
export type RawOffer = 'file' | 'original';

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

/**
 * THE MATERIAL LADDER, under the fidelity chip.
 *
 * Four rungs, each a real and nameable amount of the camera's own
 * calibration: the proxy, the sensor with its measured gain, the gain map,
 * the gain map and the warp. The two top rungs appear only where the FILE
 * carries those opcodes (`raw/calibration.ts`) — a correction nobody measured
 * is worse than none, which is the rule P6 shipped with no lens profiles for.
 *
 * It hangs off the chip rather than sitting in the inspector (2026-09-20, the
 * maintainer's placement): the chip already says what the picture IS, so what
 * it could be belongs on the same word, above the photograph, where it is
 * read at the moment the question comes up.
 */
export function DevelopBaseMenu({
  chip,
  offer,
  base,
  rungs,
  onBase,
  status,
  gain,
  originalName,
  originalBytes,
  calibration,
  className = '',
}: {
  /** The fidelity chip's own words — this is that chip, made pressable. */
  chip: string;
  offer: RawOffer | null;
  base: DevelopBase;
  /** Which rungs this file can honestly offer, lowest first. */
  rungs: readonly DevelopBase[];
  onBase: (base: DevelopBase) => void;
  /** What is happening to get the RAW on screen — fetching, decoding — or null. */
  status: string | null;
  /** The metered exposure once decoded, as `rawGain`; null before. */
  gain: number | null;
  /** For an `original` offer: what would be fetched, and how heavy. */
  originalName?: string | null;
  originalBytes?: number | null;
  /** What the file's own calibration asks for, once read; null when it carries none. */
  calibration?: string | null;
  className?: string;
}) {
  const ev = gain ? Math.log2(gain) : 0;
  const hint = (rung: DevelopBase): string => {
    if (rung === base) {
      if (rung === 'proxy') return BASE_ADDS.proxy;
      return gain
        ? `metered ${ev ? `${signed(ev, 1)} EV` : 'at its white'}`
        : (status ?? 'decoding the sensor’s data…');
    }
    if (rung === 'gain' && baseRung(base) === 0) {
      return offer === 'original'
        ? `opens ${originalName ?? 'the original'} from its instance${originalBytes ? ` · ${formatBytes(originalBytes)}` : ''}, held for this session`
        : BASE_ADDS.gain;
    }
    return BASE_ADDS[rung];
  };
  return (
    <OverflowMenu
      label="What this picture is developed from"
      className={className}
      size="sm"
      align="end"
      trigger={{ text: chip, variant: 'ghost' }}
      disabled={!offer}
      items={[
        ...rungs.map((rung) => ({
          id: rung,
          title: BASE_ADDS[rung],
          onSelect: () => onBase(rung),
          label: (
            <span className="flex flex-col items-start gap-0.5 text-left">
              <span className="font-mono text-xs">
                {rung === base ? '· ' : '  '}
                {BASE_LABELS[rung]}
              </span>
              <span className="font-mono text-3xs text-faint leading-relaxed max-w-[22rem] whitespace-normal">
                {hint(rung)}
              </span>
            </span>
          ),
        })),
        // What the FILE asks for, said once at the foot: the numbers a person
        // can check against the picture, rather than a promise.
        ...(calibration
          ? [
              {
                id: 'calibration',
                disabled: true,
                onSelect: () => {},
                label: (
                  <span className="font-mono text-3xs text-faint whitespace-normal max-w-[22rem]">
                    this file asks for {calibration}
                  </span>
                ),
              },
            ]
          : []),
      ]}
    />
  );
}
