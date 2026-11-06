import { useMemo, useState } from 'react';
import { withRecap, type RecapDoc, type RecapPicture } from '../../shared/recap/recap-doc';
import { shortDate } from '../../shared/recap/recap-days';
import { backgroundChoices, backgroundPicture, type ResolvedRecap } from '../../shared/recap/recap-slots';
import type { WinnowClient } from '../../shared/sources/winnow/client';
import { ToggleField } from '../../shared/ui/Inspector';
import PictureThumb from './PictureThumb';
import type { Change } from './RecapPanels';

const legend = 'font-mono text-2xs tracking-[0.14em] uppercase text-muted';
/** How many pictures the row offers before it scrolls. */
const MAX = 60;

/**
 * The picture a blurred ground softens (his ask, 2026-11-06): by default the
 * best photograph of the recap's own days or period (*Best*), else the one he
 * chooses among them — or, *From the whole pool*, any photograph, the
 * forcing marked «outside the period». Choosing one centres its frame.
 */
export default function GroundPicture({ doc, resolved, change, thumbs }: { doc: RecapDoc; resolved: ResolvedRecap; change: Change; thumbs: { client: WinnowClient | null; instance: string | null; files: ReadonlyMap<string, File> } }) {
  const [everywhere, setEverywhere] = useState(false);
  const choices = useMemo(() => backgroundChoices(doc, resolved, everywhere).slice(0, MAX), [doc, resolved, everywhere]);
  const current = backgroundPicture(doc, resolved);
  const inPeriod = useMemo(() => new Set(resolved.inScope.map((p) => p.key)), [resolved.inScope]);
  const own = doc.background.picture ?? null;
  const set = (picture: string | null) => change((d) => withRecap(d, { background: { ...d.background, picture: picture ?? undefined, frame: undefined } }));
  const tile = (p: RecapPicture) => <PictureThumb pic={p} client={thumbs.client} instance={thumbs.instance} file={thumbs.files.get(p.key) ?? null} className="absolute inset-0 w-full h-full" />;
  return (
    <div className="flex flex-col gap-1.5">
      <span className={legend}>The picture it softens</span>
      <div className="max-h-44 overflow-y-auto [scrollbar-width:thin]">
        <div className="grid grid-cols-6 gap-1 p-0.5" role="listbox" aria-label="The blurred background's picture">
          <button
            type="button"
            role="option"
            aria-selected={own === null}
            onClick={() => set(null)}
            title="The best photograph of the period: picked, then starred"
            className={`relative aspect-square rounded-[4px] border font-mono text-3xs uppercase ${own === null ? 'border-accent text-accent-ink bg-accent/10' : 'border-line text-muted bg-transparent'}`}
          >
            Best
          </button>
          {choices.map((p) => (
            <button
              key={p.key}
              type="button"
              role="option"
              aria-selected={own === p.key}
              onClick={() => set(p.key)}
              title={`${p.name}${p.day ? ` · ${shortDate(p.day)}` : ''}${inPeriod.has(p.key) ? '' : ' · outside the period'}`}
              className={`relative aspect-square overflow-hidden rounded-[4px] p-0 border-0 ${current?.key === p.key ? (own ? 'outline outline-2 outline-accent' : 'outline outline-2 outline-dashed outline-accent') : 'outline outline-1 outline-line'}`}
            >
              {tile(p)}
              {!inPeriod.has(p.key) && <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1 bg-accent/70" />}
            </button>
          ))}
        </div>
      </div>
      <ToggleField checked={everywhere} onChange={setEverywhere} label="From the whole pool">
        From the whole pool
      </ToggleField>
      {own && current && !inPeriod.has(current.key) && <p className="m-0 text-2xs text-muted">Outside the period{current.day ? ` · ${shortDate(current.day)}` : ''} — chosen by hand.</p>}
    </div>
  );
}
