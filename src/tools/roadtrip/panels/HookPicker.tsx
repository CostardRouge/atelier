/**
 * Choosing the piece's OPENER — which hook variant draws its first slide.
 *
 * Cards, never a dropdown: the rule the title styles already settled is that a
 * look you cannot see before adopting is a look you adopt by trial. Each row
 * carries the variant's own sketch of what it DOES, its name and its line; the
 * variant's own options mount underneath, so the panel below the picker always
 * belongs to the card above it.
 *
 * A variant a piece cannot feed is greyed **with the reason on the card**, not
 * hidden — the counter modes' rule: say what it would draw, or say why it
 * cannot. A variant you cannot find is a feature that does not exist.
 */

import {
  setHookOptions,
  setHookVariant,
  type HookContext,
  type HookLayer,
  type HookVariant,
} from '../../../shared/roadtrip/hooks/hook-variant';
import { HOOK_VARIANTS, hookUnmet } from '../../../shared/roadtrip/hooks/registry';
import SectionLegend from '../../../shared/ui/SectionLegend';

interface HookPickerProps {
  /** The piece's stored layers; the picker writes the first and only the first. */
  layers: HookLayer[];
  /** What the variants were prepared against — also what an option panel reads. */
  ctx: HookContext;
  onChange: (layers: HookLayer[]) => void;
}

export default function HookPicker({ layers, ctx, onChange }: HookPickerProps) {
  const currentId = layers[0]?.id ?? '';
  const current: HookVariant | undefined = HOOK_VARIANTS.find((v) => v.id === currentId);
  const Panel = current?.Panel;

  return (
    <div className="flex flex-col gap-2">
      <SectionLegend label="Opener">
        <p>
          What draws the first slide. The badge is the plain one — the counter and the
          place over the picture. Another variant may bring its own drawing, its own
          animation and its own sound, and says so on its card.
        </p>
      </SectionLegend>

      <div className="flex flex-col gap-1.5">
        {HOOK_VARIANTS.map((variant) => {
          const active = variant.id === currentId;
          const unmet = hookUnmet(variant, ctx);
          const Sketch = variant.Sketch;
          return (
            <button
              key={variant.id}
              type="button"
              disabled={!!unmet}
              onClick={() => onChange(setHookVariant(layers, variant))}
              aria-pressed={active}
              className={`flex items-center gap-3 px-3 py-2 rounded-paper border text-left transition-colors ${
                unmet
                  ? 'border-line bg-paper opacity-55 cursor-default'
                  : active
                    ? 'border-accent bg-accent-wash cursor-pointer'
                    : 'border-line bg-paper hover:border-line-strong cursor-pointer'
              }`}
            >
              <span className="flex-none w-[4.6rem] h-[2.2rem] grid place-items-center rounded-[4px] bg-[#141210] overflow-hidden">
                {Sketch ? <Sketch /> : null}
              </span>
              <span className="min-w-0">
                <span className="block font-semibold text-[0.82rem]">{variant.name}</span>
                <span
                  className={`block text-[0.68rem] truncate ${
                    unmet ? 'text-accent-ink' : 'text-muted'
                  }`}
                >
                  {unmet ?? variant.tagline}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {Panel && (
        <Panel
          options={layers[0]?.options ?? {}}
          ctx={ctx}
          onChange={(options) => onChange(setHookOptions(layers, options))}
        />
      )}
    </div>
  );
}
