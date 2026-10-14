import { useState } from 'react';
import { InspectorSection, fieldClass } from '../../shared/ui/Inspector';
import Button from '../../shared/ui/Button';
import { applyPreset, cleanName, isCurrent, presetNamed } from './atlas-presets';
import type { AtlasSettings } from './atlas-settings';
import { useAtlasPresets } from './use-atlas-presets';

/**
 * The Presets tab: every dial under a name of his own (`atlas-presets.ts`).
 * A chip applies its preset and is lit while the dials match it; the field
 * below keeps the dials on screen — under a new name, or over a preset of
 * the same name, which the button then says.
 */
export default function AtlasPresetsSection({
  settings,
  update,
}: {
  settings: AtlasSettings;
  update: (fn: (s: AtlasSettings) => AtlasSettings) => void;
}) {
  const presets = useAtlasPresets();
  const [name, setName] = useState('');
  const [told, setTold] = useState<string | null>(null);
  const clean = cleanName(name);
  const replacing = clean ? presetNamed(presets.list, clean) : null;

  return (
    <InspectorSection
      id="atlas.presets"
      title="Presets"
      info="Every dial under a name of your own, kept on this browser. A preset keeps how the atlas draws — the look, the trails, the motion, the camera, the overlay, the format — never what names one set of flights: the title, the place or zone framed, the drones picked or named stay as they are on screen."
    >
      {presets.list.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {presets.list.map((p) => {
            const lit = isCurrent(settings, p);
            return (
              <span
                key={p.id}
                className={`inline-flex items-center rounded-full border overflow-hidden ${lit ? 'border-accent bg-accent-wash' : 'border-line-strong bg-paper'}`}
              >
                <button
                  type="button"
                  aria-pressed={lit}
                  onClick={() => {
                    update((cur) => applyPreset(cur, p));
                    setTold(`applied ${p.name}`);
                  }}
                  className={`h-7 pointer-coarse:h-[2.125rem] px-3 border-0 bg-transparent text-xs cursor-pointer ${lit ? 'text-accent-ink font-medium' : 'text-ink-soft hover:text-accent-ink'}`}
                  title={lit ? 'The dials on screen are this preset' : `Apply ${p.name}`}
                >
                  {p.name}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    presets.remove(p.id);
                    setTold(`removed ${p.name}`);
                  }}
                  className="h-7 pointer-coarse:h-[2.125rem] px-2.5 border-0 border-l border-line bg-transparent font-mono text-3xs text-muted cursor-pointer hover:text-accent"
                  aria-label={`Remove preset ${p.name}`}
                  title="Remove this preset"
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      ) : (
        <p className="m-0 text-xs text-muted">No preset yet — keep the dials on screen under a name.</p>
      )}
      <form
        className="flex items-center gap-1.5 mt-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!presets.save(clean, settings)) return;
          setTold(replacing ? `replaced ${replacing.name}` : `saved ${clean}`);
          setName('');
        }}
      >
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name these dials"
          aria-label="Preset name"
          className={fieldClass}
        />
        <Button type="submit" size="sm" aria-disabled={!clean || undefined} title={clean ? undefined : 'Type a name first'} className="flex-none">
          {replacing ? 'Replace' : 'Save'}
        </Button>
      </form>
      {told && (
        <p className="m-0 mt-2 text-2xs text-muted" role="status">
          {told}
        </p>
      )}
    </InspectorSection>
  );
}
