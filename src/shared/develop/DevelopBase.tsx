import Segmented from '../ui/Segmented';
import SectionLegend from '../ui/SectionLegend';
import { formatBytes } from '../lib/format';
import { signed } from './develop';

const BASE_HINT =
  'What the numbers act on. "Camera render" is the 8-bit picture every browser decodes — the JPEG your camera wrote inside its RAW, or the proxy — and it clips at white. "RAW" decodes the sensor’s own data to linear light, sixteen bits of it: the white balance is a real one, and what the sensor kept above the displayed white is there for the highlights to bring back. It is ANOTHER starting point, not a sharper copy of the same one: numbers set on the render act differently here, and the picture opens metered by its own brightest tone. Chosen per picture, never copied by a preset or a paste, and never switched by an export.';

export type DevelopBase = 'render' | 'raw';

/** Where the sensor's data would come from: the file in hand is a RAW, or a proxy's original is one. */
export type RawOffer = 'file' | 'original';

/**
 * The material switch — Camera render · RAW — drawn only where a RAW is
 * reachable at all. The Develop tool's own section (`docs/develop-originals.md`
 * §3.1): the modal hosts keep the simple sheet and never see it.
 */
export function DevelopBaseSection({
  offer,
  base,
  onBase,
  status,
  gain,
  originalName,
  originalBytes,
  numbersSet,
}: {
  offer: RawOffer | null;
  base: DevelopBase;
  onBase: (base: DevelopBase) => void;
  /** What is happening to get the RAW on screen — fetching, decoding — or null. */
  status: string | null;
  /** The metered exposure once decoded, as `rawGain`; null before. */
  gain: number | null;
  /** For an `original` offer: what would be fetched, and how heavy. */
  originalName?: string | null;
  originalBytes?: number | null;
  /** Sliders are already set: switching means they act on another base. */
  numbersSet: boolean;
}) {
  if (!offer) return null;
  const ev = gain ? Math.log2(gain) : 0;
  const line =
    status ??
    (base === 'raw'
      ? gain
        ? `the sensor’s data, metered ${ev ? `${signed(ev, 1)} EV` : 'at its white'}${numbersSet ? ' — your numbers act on it, another starting point' : ''}`
        : 'decoding the sensor’s data…'
      : offer === 'original'
        ? `RAW opens ${originalName ?? 'the original'} from its instance${originalBytes ? ` · ${formatBytes(originalBytes)}` : ''}, held for this session`
        : 'RAW decodes the file’s own sensor data — a few seconds, once');
  return (
    <div className="flex flex-col gap-2">
      <SectionLegend label="Base">
        <p>{BASE_HINT}</p>
      </SectionLegend>
      <Segmented<DevelopBase>
        fill
        size="sm"
        label="Base"
        value={base}
        onChange={onBase}
        options={[
          { id: 'render', label: 'Camera render' },
          { id: 'raw', label: 'RAW' },
        ]}
      />
      <p className="m-0 font-mono text-2xs text-faint leading-relaxed" role="status">
        {line}
      </p>
    </div>
  );
}
