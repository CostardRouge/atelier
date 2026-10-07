/**
 * The rows of «Group nearby places» — the same control in Virée's Road group
 * and the Itinerary's Stops group, over `stop-clusters.ts`. Off by default; a
 * distance on a log slider with the three shortcuts, which places merge, and
 * what names a group — and the real count of halts it makes.
 */

import Button from '../../ui/Button';
import Segmented from '../../ui/Segmented';
import { FieldRow, RangeField, SelectField, SwitchRow } from '../../ui/Inspector';
import { GROUP_LIMITS, GROUP_SHORTCUTS, type GroupOptions } from './stop-clusters';

interface GroupRowsProps {
  value: GroupOptions;
  onChange: (patch: Partial<GroupOptions>) => void;
  /** How many stops the list holds, and how many halts the grouping makes of them. */
  count: { stops: number; halts: number };
  /** The town index is at hand, so `town` names a group now. */
  townsReady: boolean;
}

/** The distance a switched-on grouping starts at. */
const ON_KM = 10;

function formatKm(km: number): string {
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

export function GroupRows({ value, onChange, count, townsReady }: GroupRowsProps) {
  const on = value.groupKm > 0;
  const merged = count.stops - count.halts;
  return (
    <>
      <SwitchRow
        label="Group nearby places"
        name="Group nearby places"
        checked={on}
        onChange={(next) => onChange({ groupKm: next ? ON_KM : 0 })}
        hint={
          on
            ? merged > 0
              ? `${count.stops} places make ${count.halts} ${count.halts === 1 ? 'halt' : 'halts'}: a halt sits on a real place, shows every picture of its group and counts them. Your list is never changed.`
              : `No two places lie within ${formatKm(value.groupKm)} of each other: every place is a halt.`
            : 'Places a few kilometres apart become one halt — fifteen stops around a city, one halt. Your list is never changed.'
        }
      />
      {on && (
        <>
          <FieldRow label="Within" align="start">
            <div className="flex flex-col gap-1.5 min-w-0">
              <RangeField
                label="Grouping distance"
                min={Math.log10(GROUP_LIMITS.groupKm.min)}
                max={Math.log10(GROUP_LIMITS.groupKm.max)}
                step={0.02}
                value={Math.log10(Math.max(GROUP_LIMITS.groupKm.min, Math.min(GROUP_LIMITS.groupKm.max, value.groupKm)))}
                onChange={(v) => onChange({ groupKm: Math.round(10 ** v * 10) / 10 })}
                format={(v) => formatKm(10 ** v)}
              />
              <div className="flex items-center gap-1.5 flex-wrap">
                {GROUP_SHORTCUTS.map((s) => (
                  <Button key={s.km} size="sm" variant={value.groupKm === s.km ? 'primary' : 'default'} onClick={() => onChange({ groupKm: s.km })} title={`${s.label} — ${s.km} km`}>
                    {s.km} km
                  </Button>
                ))}
              </div>
            </div>
          </FieldRow>
          <FieldRow
            label="Which"
            hint={
              value.groupVisits === 'consecutive'
                ? 'Only places that follow each other merge, so the journey’s order stands; a later return is a second halt.'
                : 'Every visit merges into the first — the car never comes back.'
            }
          >
            <Segmented
              size="sm"
              fill
              label="Which places merge"
              value={value.groupVisits}
              onChange={(groupVisits) => onChange({ groupVisits })}
              options={[
                { id: 'consecutive', label: 'One after another' },
                { id: 'all', label: 'Every visit' },
              ]}
            />
          </FieldRow>
          <FieldRow
            label="Named"
            hint={
              value.groupName === 'town'
                ? townsReady
                  ? 'The biggest town of the shipped index near the group.'
                  : 'The biggest town of the shipped index near the group — the index is being read; until it is, the first place names the group.'
                : value.groupName === 'first'
                  ? 'The first place of the group, in your order.'
                  : 'The place the halt sits on — the one nearest the group’s centre.'
            }
          >
            <SelectField
              label="What names a group"
              value={value.groupName}
              onChange={(groupName) => onChange({ groupName })}
              options={[
                { id: 'town', label: 'Town' },
                { id: 'first', label: 'First place' },
                { id: 'central', label: 'Central place' },
              ]}
            />
          </FieldRow>
        </>
      )}
    </>
  );
}
