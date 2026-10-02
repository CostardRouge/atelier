import type { ReactNode } from 'react';
import type { LibraryHalf } from '../client';
import Segmented from '../../../ui/Segmented';
import { Icons } from '../../../ui/icons';
import {
  activeFacets,
  BUCKET_LABEL,
  BUCKETS,
  DEFAULT_FACETS,
  facetValues,
  toggled,
  type Bucket,
  type FacetCounts,
  type MediaKind,
  type PickFacets,
} from './pick-filter';

/** The bucket's swatch: the verdict colours Winnow uses — green a pick, red a reject. */
const SWATCH: Record<Bucket, string> = {
  pick: 'bg-ok',
  star: 'bg-warn-bright',
  unrated: 'bg-faint',
  skip: 'bg-info',
  reject: 'bg-danger',
};

const legend = 'm-0 mb-1 font-mono text-3xs tracking-[0.12em] uppercase text-muted';

type HalfKey = 'all' | LibraryHalf;
const HALVES: { id: HalfKey; label: string; title: string }[] = [
  { id: 'all', label: 'All', title: 'Incoming and Gallery together' },
  { id: 'incoming', label: 'Incoming', title: 'Media still to cull' },
  { id: 'final', label: 'Gallery', title: 'Finished exports' },
];

/**
 * The picker's filters, in one column (his pick, face B of the brief):
 * the library half, Winnow's verdict, a star floor, the type, the extension,
 * the body, the tags, and two states. Every count is the SCOPE's — a facet
 * ticked elsewhere never moves it (`facetCounts`).
 *
 * The half is not a facet like the others: it goes to the server and reloads
 * the scope, because a capped list filtered afterwards would lose rows. It
 * sits first and looks like the sidebar's own half picker.
 */
export default function PickerRail({
  counts,
  facets,
  onFacets,
  half,
  onHalf,
  heldLabel,
  footer,
}: {
  counts: FacetCounts;
  facets: PickFacets;
  onFacets: (next: PickFacets) => void;
  half: LibraryHalf | null;
  onHalf: (half: LibraryHalf | null) => void;
  heldLabel: string;
  /** What closes the rail on a phone, where it covers the grid. */
  footer?: ReactNode;
}) {
  const set = (patch: Partial<PickFacets>) => onFacets({ ...facets, ...patch });
  const active = activeFacets(facets);
  const starMax = Math.max(1, ...counts.starsAtLeast.slice(1));
  const exts = facetValues(new Map([...counts.exts].map(([k, v]) => [k, v.count])), facets.exts);
  const devices = facetValues(counts.devices, facets.devices);
  const tags = facetValues(counts.tags, facets.tags);

  return (
    <div className="flex flex-col gap-4 min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <p className={`${legend} mb-0`}>Filters{active ? ` · ${active}` : ''}</p>
        {active > 0 && (
          <button
            type="button"
            onClick={() => onFacets(DEFAULT_FACETS)}
            className="p-0 border-0 bg-transparent text-xs text-muted cursor-pointer underline underline-offset-[3px] hover:text-ink"
          >
            Reset
          </button>
        )}
      </div>

      <section>
        <p className={legend}>Library</p>
        <Segmented
          label="Which half of the library"
          size="sm"
          fill
          value={half ?? 'all'}
          onChange={(id) => onHalf(id === 'all' ? null : id)}
          options={HALVES.map((h) => ({ id: h.id, label: h.label, title: h.title }))}
        />
      </section>

      <section>
        <p className={legend}>Winnow verdict</p>
        {BUCKETS.map((b) => (
          <Row
            key={b}
            on={facets.buckets.includes(b)}
            count={counts.buckets[b]}
            onClick={() => {
              const next = toggled(facets.buckets, b);
              // Nothing shown at all is never what a click meant.
              if (next.length) set({ buckets: next });
            }}
            swatch={SWATCH[b]}
          >
            {BUCKET_LABEL[b]}
          </Row>
        ))}
      </section>

      <section>
        <p className={legend}>Stars, at least</p>
        <div className="flex flex-col gap-0.5">
          {[5, 4, 3, 2, 1].map((k) => {
            const n = counts.starsAtLeast[k];
            const on = facets.minStar === k;
            return (
              <button
                key={k}
                type="button"
                aria-pressed={on}
                onClick={() => set({ minStar: on ? 0 : k })}
                className={`grid grid-cols-[3.6rem_minmax(0,1fr)_2rem] items-center gap-1.5 px-1 py-0.5 rounded-md border-0 font-mono text-3xs cursor-pointer text-left ${
                  on ? 'bg-warn-wash text-ink' : 'bg-transparent text-ink-soft hover:bg-paper-2'
                }`}
              >
                <span className="text-warn">{'★'.repeat(k)}</span>
                <span className="relative h-2 rounded-sm bg-line overflow-hidden">
                  <span className="absolute inset-y-0 left-0 rounded-sm bg-warn-bright" style={{ width: `${(n / starMax) * 100}%` }} />
                </span>
                <span className="text-right text-muted tabular-nums">{n}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <p className={legend}>Type</p>
        {(['photo', 'video'] as MediaKind[]).map((k) => (
          <Row key={k} on={facets.kinds.includes(k)} count={counts.kinds.get(k) ?? 0} onClick={() => set({ kinds: toggled(facets.kinds, k) })}>
            {k === 'photo' ? 'Photos' : 'Clips'}
          </Row>
        ))}
      </section>

      {exts.length > 0 && (
        <section>
          <p className={legend}>Extension</p>
          {exts.map(([ext, n]) => {
            const pair = counts.exts.get(ext)?.pair;
            return (
              <Row key={ext} on={facets.exts.includes(ext)} count={n} onClick={() => set({ exts: toggled(facets.exts, ext) })}>
                .{ext}
                {pair ? <span className="text-muted"> + .{pair}</span> : null}
              </Row>
            );
          })}
        </section>
      )}

      {devices.length > 0 && (
        <section>
          <p className={legend}>Device</p>
          {devices.map(([d, n]) => (
            <Row key={d} on={facets.devices.includes(d)} count={n} onClick={() => set({ devices: toggled(facets.devices, d) })}>
              {d}
            </Row>
          ))}
        </section>
      )}

      {tags.length > 0 && (
        <section>
          <p className={legend}>Winnow tags</p>
          {tags.map(([t, n]) => (
            <Row key={t} on={facets.tags.includes(t)} count={n} onClick={() => set({ tags: toggled(facets.tags, t) })}>
              #{t}
            </Row>
          ))}
        </section>
      )}

      <section>
        <p className={legend}>State</p>
        <Row on={facets.noFinal} count={counts.noFinal} onClick={() => set({ noFinal: !facets.noFinal })} title="No Gallery final links to it yet">
          No final yet
        </Row>
        <Row on={facets.notHeld} count={counts.notHeld} onClick={() => set({ notHeld: !facets.notHeld })}>
          Not {heldLabel}
        </Row>
      </section>

      {footer}
    </div>
  );
}

function Row({
  on,
  count,
  onClick,
  swatch,
  title,
  children,
}: {
  on: boolean;
  count: number;
  onClick: () => void;
  swatch?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      title={title}
      className={`w-full grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-2 px-1.5 py-1 rounded-md border-0 text-left text-sm cursor-pointer max-[820px]:py-2 ${
        on ? 'text-ink' : 'text-ink-soft'
      } ${count === 0 && !on ? 'opacity-50' : ''} bg-transparent hover:bg-paper-2`}
    >
      <span
        aria-hidden="true"
        className={`w-3.5 h-3.5 grid place-items-center rounded-[4px] border [&_svg]:w-2.5 [&_svg]:h-2.5 ${
          on ? 'bg-ink border-ink text-paper' : 'bg-surface border-line-strong text-transparent'
        }`}
      >
        {Icons.check}
      </span>
      <span className="min-w-0 truncate flex items-center gap-1.5">
        {swatch && <span aria-hidden="true" className={`w-2 h-2 shrink-0 rounded-[2px] ${swatch}`} />}
        <span className="truncate">{children}</span>
      </span>
      <span className="font-mono text-3xs text-muted tabular-nums">{count}</span>
    </button>
  );
}
