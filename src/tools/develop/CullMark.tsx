import { describeCulling, labelColour, type Culling, type LabelColour } from '../../shared/sources/winnow/culling';

/**
 * The five label colours as a swatch — DATA colours, the ones a photographer
 * knows from Lightroom, not interface tokens: they must read the same on
 * paper and at night.
 */
const SWATCH: Record<LabelColour, string> = {
  red: '#d4493c',
  yellow: '#e2bd2f',
  green: '#4f9a52',
  blue: '#3f78c8',
  purple: '#9361c1',
};

/**
 * Winnow's word on one picture, as small as it can be said: a flag for a pick
 * or a reject, the stars as a count, the label as a dot. Read-only — nothing
 * here is a target (culling is Winnow's, `culling.ts`). Draws nothing for a
 * picture Winnow has not culled.
 */
export default function CullMark({ culling, onMedia = false }: { culling: Culling | undefined; onMedia?: boolean }) {
  if (!culling) return null;
  const colour = labelColour(culling.color);
  const flag = culling.verdict === 'pick' ? '⚑' : culling.verdict === 'reject' ? '✕' : null;
  if (!flag && culling.star === 0 && !colour) return null;
  const said = `Winnow: ${describeCulling(culling)}`;
  return (
    <span
      className={`flex-none inline-flex items-center gap-0.5 font-mono text-3xs leading-none tabular-nums ${
        onMedia ? 'px-1 py-0.5 rounded-full bg-surface/85 text-ink' : 'text-ink-soft'
      }`}
      title={said}
      aria-label={said}
    >
      {flag && <span className={culling.verdict === 'pick' ? 'text-ok' : 'text-danger'}>{flag}</span>}
      {culling.star > 0 && <span>★{culling.star}</span>}
      {colour && <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: SWATCH[colour] }} />}
    </span>
  );
}
