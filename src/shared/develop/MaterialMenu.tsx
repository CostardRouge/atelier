import OverflowMenu, { type OverflowItem } from '../ui/OverflowMenu';
import type { RawMaterial } from './raw-choice';

export interface MaterialRow {
  material: RawMaterial;
  /** «Camera render», «Proxy», «Sensor». */
  label: string;
  /** The word on the trigger, where the label is too long for a narrow card: «Render». */
  short?: string;
  /** What reading it costs, in a few words. */
  hint: string;
  /** Its pixels, when known: «960 px», «8064 × 4536». */
  pixels?: string | null;
}

/**
 * A RAW's file NAME as the menu that chooses which material it is read from
 * — its camera render (or a source's proxy) or its sensor — outside the
 * Develop tool (`sensor-outside-develop.md`). Develop's own grammar: the name
 * is the trigger, the material it is on is said after it in the accent, and
 * the file name truncates first so the material stays whole in a narrow card.
 *
 * Two rows and no rungs: the sensor is read at the top rung its file carries,
 * which is the Develop tool's ladder answered once.
 */
export default function MaterialMenu({
  name,
  current,
  auto,
  rows,
  onPick,
  busy = false,
  materialOnly = false,
  className = '',
}: {
  name: string;
  current: RawMaterial;
  /** The current material is Auto's answer, not a choice — said on its row. */
  auto: boolean;
  rows: readonly MaterialRow[];
  onPick: (material: RawMaterial) => void;
  /** The sensor is being read — said on the trigger. */
  busy?: boolean;
  /** The trigger says the material alone (the name is said elsewhere): beside a Develop door. */
  materialOnly?: boolean;
  className?: string;
}) {
  const on = rows.find((r) => r.material === current) ?? rows[0];
  const items: OverflowItem[] = rows.map((r) => ({
    id: r.material,
    checked: r.material === current,
    title: r.hint,
    onSelect: () => onPick(r.material),
    label: (
      <span className="flex flex-col min-w-0">
        <span className="flex items-baseline justify-between gap-3">
          <span>
            {r.label}
            {auto && r.material === current && <span className="text-muted"> · auto</span>}
          </span>
          {r.pixels && <span className="font-mono text-2xs text-ink-soft tabular-nums">{r.pixels}</span>}
        </span>
        <span className="text-2xs text-muted">{r.hint}</span>
      </span>
    ),
  }));
  return (
    <OverflowMenu
      label={`Read ${name} from its camera render or its sensor`}
      className={`min-w-0 ${className}`}
      size="sm"
      align="start"
      trigger={{
        bare: true,
        title: `${name} — read from ${on.label.toLowerCase()}${busy ? ' (reading the sensor…)' : ''}. Choose another`,
        className:
          'group flex w-full min-w-0 items-center gap-1.5 rounded-control border border-line-strong bg-paper-2 px-1.5 py-0.5 min-h-7 font-mono text-2xs text-ink-soft cursor-pointer hover:border-ink-soft',
        text: (
          <>
            {!materialOnly && <span className="min-w-0 flex-1 truncate text-left">{name}</span>}
            <span className="flex-none text-accent-ink">{busy ? `${on.short ?? on.label}…` : (on.short ?? on.label)}</span>
            <span className="flex-none text-3xs opacity-70" aria-hidden="true">
              ▾
            </span>
          </>
        ),
      }}
      items={items}
    />
  );
}
