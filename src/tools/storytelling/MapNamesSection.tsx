import { PLACE_STYLE_OPTIONS } from '../../shared/roadtrip/place-style';
import type { PlaceStyle } from '../../shared/roadtrip/trip-types';
import { mapNamesOf, NAME_FIELD_LABEL, NAME_FIELDS, NAME_PRESETS, NAMED_WHICH, NAMED_WHICH_LABEL, namePresetOf, type MapNames, type NamedWhich, type NameField } from '../../shared/story/map-names';
import { sourcesOf, withSeriesSources } from '../../shared/story/sources';
import type { StoryScript } from '../../shared/story/story-script';
import { SelectField, SwitchRow } from '../../shared/ui/Inspector';

const FIELD_OPTIONS = NAME_FIELDS.map((id) => ({ id, label: NAME_FIELD_LABEL[id] }));
const WHICH_OPTIONS = NAMED_WHICH.map((id) => ({ id, label: NAMED_WHICH_LABEL[id] }));
const WRITING_OPTIONS = PLACE_STYLE_OPTIONS.map((o) => ({ id: o.id, label: `${o.label} · ${o.example}` }));

/**
 * What each point of the map says (`map-names.ts`, the labels lab): a
 * ready-made setting, or two lines each one field of what the trip knows —
 * the place or the town written as Trips writes it, the state, the stage, the
 * day, the kilometres —, which points carry their name, and whether a line
 * the previous point said is said again. Written to the series' map.
 */
export default function MapNamesSection({ script, onScript, postId }: { script: StoryScript; onScript: (s: StoryScript) => void; postId: string }) {
  const map = sourcesOf(script, postId).map;
  const names = mapNamesOf(map);
  const preset = namePresetOf(names);
  const set = (patch: MapNames) => {
    const next: Record<string, unknown> = { ...(map ?? {}), names: { ...names, ...patch } };
    // The two lines replace the one-field label of before.
    delete next.label;
    onScript(withSeriesSources(script, { map: next as NonNullable<typeof map> }));
  };
  const uses = (f: NameField) => names.line1 === f || names.line2 === f;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Ready-made names">
        {NAME_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={preset === p.id}
            onClick={() => set(p.names)}
            className={`min-h-8 pointer-coarse:min-h-11 rounded-full border px-3 text-xs cursor-pointer ${
              preset === p.id ? 'border-ink bg-ink text-paper' : 'border-line-strong bg-surface text-ink-soft hover:text-ink'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-ink-soft w-16">Says</span>
        <SelectField<NameField> label="What each named point says first" value={names.line1} options={FIELD_OPTIONS} onChange={(line1) => set({ line1 })} />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-ink-soft w-16">Then</span>
        <SelectField<NameField> label="What it says under, smaller" value={names.line2} options={FIELD_OPTIONS} onChange={(line2) => set({ line2 })} />
      </div>
      {uses('place') || uses('town') ? (
        <div className="flex items-center gap-2">
          <span className="text-sm text-ink-soft w-16">Written</span>
          <SelectField<PlaceStyle> label="How a place is written, as in Trips" value={names.writing} options={WRITING_OPTIONS} onChange={(writing) => set({ writing })} />
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <span className="text-sm text-ink-soft w-16">Named</span>
        <SelectField<NamedWhich> label="Which points carry their name" value={names.which} options={WHICH_OPTIONS} onChange={(which) => set({ which })} />
      </div>
      <SwitchRow label="Say a line once" checked={names.once} onChange={(once) => set({ once })} hint="A line the point before said is left out: a state written where it is entered." />
      {uses('town') ? <p className="m-0 text-2xs text-muted leading-snug">Town: the one a point is in, else the biggest within 60 km, from the town index shipped with Atelier.</p> : null}
    </div>
  );
}
