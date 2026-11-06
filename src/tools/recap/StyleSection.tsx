import { useEffect, useState } from 'react';
import { RECIPES, type RecapDoc } from '../../shared/recap/recap-doc';
import { hasStyle, styleKey, styleOf, withStyle, type RecapStyle } from '../../shared/recap/recap-style';
import Button from '../../shared/ui/Button';
import { InspectorSection } from '../../shared/ui/Inspector';
import type { Change } from './RecapPanels';
import { deleteValue, getValue, setValue } from './recap-store';

/**
 * «Keep as my style»: this recap's look kept on the device for its template,
 * so the next one starts from it (`recap-style.ts`) — kept, applied back to
 * a recap that drifted from it, or forgotten for the recipe.
 */
export default function StyleSection({ doc, change }: { doc: RecapDoc; change: Change }) {
  const [kept, setKept] = useState<RecapStyle | null | undefined>(undefined);
  const key = styleKey(doc.template);
  useEffect(() => {
    let alive = true;
    void getValue<RecapStyle>(key)
      .catch(() => null)
      .then((s) => alive && setKept(s));
    return () => {
      alive = false;
    };
  }, [key]);
  const label = RECIPES[doc.template].label;
  const same = kept ? hasStyle(doc, kept) : false;
  const keep = async () => {
    const s = styleOf(doc);
    if (await setValue(key, s)) setKept(s);
  };
  return (
    <InspectorSection id="recap-style" title="Your style" marked={Boolean(kept)}>
      <div className="flex flex-col gap-2">
        <p className="m-0 text-2xs text-muted">
          {kept === undefined ? '…' : same ? `Every new ${label} starts as this one looks.` : kept ? `New ${label} recaps start from a style kept earlier.` : `New ${label} recaps start from the recipe.`}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {!same && (
            <Button size="sm" variant="primary" onClick={() => void keep()} title="Its format, words and their styles, background, cells, motion, look, length and quality — never its pictures, days, clips or sound">
              Keep as my style
            </Button>
          )}
          {same && <span className="inline-flex items-center h-8 px-2 rounded-full bg-accent-wash text-2xs font-mono text-accent-ink">✓ your style</span>}
          {kept && !same && (
            <Button size="sm" variant="ghost" onClick={() => change((d) => withStyle(d, kept))} title="Dress this recap in the style kept for its template">
              Apply my style
            </Button>
          )}
          {kept && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void deleteValue(key).then((ok) => {
                  if (ok) setKept(null);
                })
              }
              title="New recaps of this template start from the recipe again"
            >
              Forget
            </Button>
          )}
        </div>
      </div>
    </InspectorSection>
  );
}
