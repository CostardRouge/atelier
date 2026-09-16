import type { ReactNode } from 'react';
import {
  CAR_COLOURS,
  GEAR_LABELS,
  defaultCarSpec,
  describeCar,
  sameCarSpec,
  type CarFinish,
  type CarGear,
  type CarSpec,
} from '../../shared/roadtrip/car-spec';
import { CAR_MODELS } from '../../shared/roadtrip/hooks/car-registry';
import { FieldRow, SelectField, SwitchRow, swatchClass } from '../../shared/ui/Inspector';
import Segmented from '../../shared/ui/Segmented';
import CarTurntable from './CarTurntable';
import { linkButton } from './panels/ui';

interface CarGaragePanelProps {
  value: CarSpec;
  onChange: (spec: CarSpec) => void;
}

const FINISHES: Array<{ id: CarFinish; label: string; hint: string }> = [
  { id: 'gloss', label: 'Gloss', hint: 'Factory paint: a highlight where the light strikes.' },
  { id: 'matte', label: 'Matte', hint: 'A textured coating: no highlight, a broad sheen instead.' },
];

/** The gear, grouped where it sits on the car; a row that needs another is listed under it. */
const GEAR_GROUPS: Array<{
  title: string;
  rows: Array<{ key: keyof CarGear; needs?: keyof CarGear; hint?: string }>;
}> = [
  {
    title: 'Front',
    rows: [
      { key: 'bullBar', hint: 'The tubular bar around the headlights.' },
      { key: 'spotLights', needs: 'bullBar', hint: 'Two round lights on the bar.' },
    ],
  },
  {
    title: 'Roof',
    rows: [
      { key: 'rack', hint: 'The basket the load rides in.' },
      { key: 'solar', needs: 'rack', hint: 'On the left of the basket.' },
      { key: 'box', needs: 'rack', hint: 'The aluminium box, front right.' },
      { key: 'jerryCans', needs: 'rack', hint: 'Three across the rear: water, petrol, water.' },
      { key: 'awning', needs: 'rack', hint: 'Along the basket’s left side.' },
    ],
  },
  {
    title: 'Body',
    rows: [
      { key: 'mudFlaps' },
      { key: 'visors', hint: 'The tinted visors over the door windows.' },
      { key: 'spare', hint: 'On the tailgate.' },
      { key: 'mirrors' },
    ],
  },
];

const legend = 'm-0 font-mono text-2xs tracking-[0.14em] uppercase text-muted';

/** A sentence's first letter up: the labels are written lower-case for the describing line. */
function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 pt-3 border-t border-line">
      <p className={legend}>{title}</p>
      {children}
    </div>
  );
}

/**
 * The garage: the trip's car on its turntable, and every choice about it.
 *
 * A controlled panel with no shell of its own, because it has TWO homes and
 * neither can be the only one (the `CoverPanel` rule): the trip's settings
 * sheet, where the trip's own properties are edited, and a modal the Virée
 * opener opens from the piece, where the car is looked at while the map is
 * composed. One panel, so the two can never drift.
 *
 * The model is a select over the registry (one car today; a second is a
 * registry line). The colour is a row of named swatches — the J120's factory
 * range and the maintainer's own two — plus a custom well; a preset that is a
 * COATING (Raptor) sets the finish with it, and the finish stays a choice of
 * its own after that. The gear is switches grouped by where it sits, and a
 * fitting that needs another (the spot lights the bar, the roof load the
 * basket) is listed only while that one is on: its flag stays stored, so
 * turning the basket back on brings the load back with it — `effectiveGear`
 * is what the drawing reads.
 *
 * The panel lays itself out by its OWN width (a container query), because its
 * two homes give it different room: past 44rem the car sits in one column
 * and the choices scroll in the other, so a switch flipped far down the list
 * is seen on the car at once — scrolling between the two was the complaint.
 * Split, the panel fills its host's height (the host gives it a definite
 * one); narrower, it stacks and the host scrolls, as before.
 */
export default function CarGaragePanel({ value, onChange }: CarGaragePanelProps) {
  const model = CAR_MODELS.find((m) => m.id === value.model) ?? CAR_MODELS[0];
  const preset = CAR_COLOURS.find((c) => c.hex === value.color.toLowerCase());
  const isDefault = sameCarSpec(value, defaultCarSpec());

  const patch = (p: Partial<CarSpec>) => onChange({ ...value, ...p });
  const patchGear = (p: Partial<CarGear>) => onChange({ ...value, gear: { ...value.gear, ...p } });

  return (
    <div className="@container h-full">
      <div className="flex flex-col gap-4 @min-[44rem]:h-full @min-[44rem]:grid @min-[44rem]:grid-cols-[minmax(0,1.2fr)_minmax(19rem,1fr)] @min-[44rem]:grid-rows-[minmax(0,1fr)] @min-[44rem]:gap-6">
        <div className="flex flex-col gap-3 @min-[44rem]:min-h-0">
          <CarTurntable
            spec={value}
            className="h-[18rem] max-[820px]:h-[calc(var(--app-h)*0.36)] @min-[44rem]:h-auto @min-[44rem]:flex-1 @min-[44rem]:min-h-[16rem]"
          />
          <p className="m-0 text-xs leading-relaxed text-muted">{describeCar(value, model.name)}</p>
        </div>

        <div className="flex flex-col gap-4 @min-[44rem]:min-h-0 @min-[44rem]:overflow-y-auto @min-[44rem]:overscroll-contain @min-[44rem]:pr-2 @min-[44rem]:pb-1">
          <FieldRow label="Model" hint={model.series}>
            <SelectField
              value={value.model}
              options={CAR_MODELS.map((m) => ({ id: m.id, label: m.name }))}
              onChange={(id) => patch({ model: id })}
              label="Car model"
            />
          </FieldRow>

          <FieldRow
            label="Colour"
            align="start"
            hint={
              preset
                ? `${preset.name}${preset.note ? ` — ${preset.note.charAt(0).toLowerCase()}${preset.note.slice(1)}` : ''}`
                : 'A colour of your own.'
            }
          >
            <div className="flex flex-wrap items-center gap-1.5">
              {CAR_COLOURS.map((c) => {
                const on = c.hex === value.color.toLowerCase();
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-label={c.name}
                    aria-pressed={on}
                    title={c.note ? `${c.name} — ${c.note}` : c.name}
                    onClick={() => patch({ color: c.hex, ...(c.finish ? { finish: c.finish } : {}) })}
                    className={`flex-none w-7 h-7 p-0 rounded-full border-2 cursor-pointer transition-[box-shadow,border-color] duration-150 ease-paper focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 ${
                      on ? 'border-accent shadow-[0_0_0_2px_var(--color-surface)_inset]' : 'border-line-strong hover:border-muted'
                    }`}
                    style={{ background: c.hex }}
                  />
                );
              })}
              <input
                type="color"
                value={value.color}
                onChange={(e) => patch({ color: e.target.value.toLowerCase() })}
                aria-label="A custom colour"
                title="A colour of your own"
                className={swatchClass}
              />
            </div>
          </FieldRow>

          <FieldRow label="Finish" hint={FINISHES.find((f) => f.id === value.finish)?.hint}>
            <Segmented
              options={FINISHES.map((f) => ({ id: f.id, label: f.label }))}
              value={value.finish}
              onChange={(finish) => patch({ finish })}
              label="Finish"
            />
          </FieldRow>

          {GEAR_GROUPS.map((group) => (
            <Group key={group.title} title={group.title}>
              {group.rows
                .filter((row) => !row.needs || value.gear[row.needs])
                .map((row) => (
                  <SwitchRow
                    key={row.key}
                    label={capitalise(GEAR_LABELS[row.key])}
                    checked={value.gear[row.key]}
                    onChange={(on) => patchGear({ [row.key]: on })}
                    hint={row.hint}
                  />
                ))}
            </Group>
          ))}

          <div className="pt-3 border-t border-line">
            <button
              type="button"
              onClick={() => onChange(defaultCarSpec())}
              disabled={isDefault}
              title="The Prado as it was photographed: Raptor black, matte, everything fitted"
              className={`${linkButton} disabled:opacity-45 disabled:cursor-default disabled:no-underline`}
            >
              Back to the default car
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
