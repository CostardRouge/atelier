import type { ReactNode } from 'react';
import { ODD_KM } from '../../shared/roadtrip/place-oddity';
import Segmented from '../../shared/ui/Segmented';
import { PRESS_LOOK } from '../../shared/ui/press';
import { formatKm } from './PlacesTable';

/**
 * Correcting ONE place, opened from its line of a `PlacesTable`: the three
 * sources of a place, in the order they cost —
 *
 * 1. **Same name**: the other towns of its name in the index shipped with
 *    the app (`homonyms`), nearest first. Offline; nothing leaves the machine.
 * 2. **Search**: the opt-in online search, asked inside the trip's country
 *    first (the caller hands the field).
 * 3. **By hand**: typed (the caller hands the fields).
 *
 * The same panel in the Deduce window and on a stage card; only what a
 * pick WRITES differs (a draft's choice, a stage's place).
 */

export type FixTab = 'same' | 'search' | 'hand';

export interface FixCandidate {
  key: string;
  /** Written as the trip writes a place («Exmouth, WA»). */
  text: string;
  countryCode: string;
  countryName: string;
  km: number | null;
  /** The town the place is now. */
  current: boolean;
}

interface PlaceFixPanelProps {
  title: string;
  tab: FixTab;
  onTab: (tab: FixTab) => void;
  /** Null while the index is loading. */
  candidates: readonly FixCandidate[] | null;
  /** The trip's country — a town elsewhere and far is tagged. */
  home: string;
  /** «nearest your pictures» / «nearest the stage». */
  nearWord: string;
  onPick: (key: string) => void;
  /** The candidate under the hand — a map may show it without moving. */
  onHover?: (key: string | null) => void;
  search: ReactNode;
  hand: ReactNode;
  onClose: () => void;
}

const tag = 'font-mono text-3xs px-1.5 py-px rounded-full whitespace-nowrap';

export default function PlaceFixPanel({
  title,
  tab,
  onTab,
  candidates,
  home,
  nearWord,
  onPick,
  onHover,
  search,
  hand,
  onClose,
}: PlaceFixPanelProps) {
  const others = candidates?.filter((c) => !c.current) ?? [];
  return (
    <div className="flex flex-col gap-2 p-2.5 rounded-paper border border-accent bg-surface" role="group" aria-label={title} data-place-fix>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <h4 className="m-0 mr-auto text-sm font-semibold">{title}</h4>
        <Segmented
          size="sm"
          label="Where the place comes from"
          value={tab}
          onChange={onTab}
          options={[
            { id: 'same', label: 'Same name', title: 'The other towns of this name, from the index shipped with Atelier' },
            { id: 'search', label: 'Search', title: 'The online search, in the trip’s country first' },
            { id: 'hand', label: 'By hand', title: 'Type it yourself' },
          ]}
        />
        <button
          type="button"
          onClick={onClose}
          className={`h-7 px-2.5 rounded-full border-0 bg-transparent text-xs text-ink-soft cursor-pointer hover:bg-paper-2 hover:text-ink ${PRESS_LOOK}`}
        >
          Close
        </button>
      </div>

      {tab === 'same' &&
        (candidates === null ? (
          <p className="m-0 text-2xs text-muted">Reading the index of towns…</p>
        ) : (
          <>
            {candidates.length === 0 ? (
              <p className="m-0 text-2xs text-muted">No town of that name in the index. Try the search, or type it.</p>
            ) : (
              <ul className="m-0 p-0 list-none flex flex-col gap-1" onMouseLeave={() => onHover?.(null)}>
                {candidates.map((c) => {
                  const best = !c.current && c === others[0] && c.countryCode === home && c.km !== null && c.km < ODD_KM;
                  const far = c.countryCode !== home && c.km !== null && c.km > ODD_KM;
                  return (
                    <li key={c.key}>
                      <button
                        type="button"
                        onClick={() => onPick(c.key)}
                        onMouseEnter={() => onHover?.(c.key)}
                        onFocus={() => onHover?.(c.key)}
                        onBlur={() => onHover?.(null)}
                        aria-current={c.current || undefined}
                        className={`w-full grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2.5 px-2.5 py-1.5 rounded-lg border bg-paper text-left text-xs text-ink cursor-pointer hover:border-accent focus-visible:outline-none focus-visible:border-accent ${PRESS_LOOK} ${
                          c.current ? 'border-dashed border-line-strong' : 'border-line'
                        }`}
                      >
                        <span className="min-w-0">
                          {c.text}
                          <span className="font-mono text-3xs text-muted">
                            {' · '}
                            {c.countryCode} {c.countryName}
                          </span>
                        </span>
                        <span className="font-mono text-2xs text-muted tabular-nums whitespace-nowrap">{formatKm(c.km)}</span>
                        {c.current ? (
                          <span className={`${tag} bg-paper-2 text-muted`}>now</span>
                        ) : best ? (
                          <span className={`${tag} bg-ok-wash text-ok`}>{nearWord}</span>
                        ) : far ? (
                          <span className={`${tag} bg-warn-wash text-warn`}>far from it</span>
                        ) : (
                          <span />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="m-0 text-2xs text-muted">From the index shipped with Atelier, nearest first. Nothing leaves the machine.</p>
          </>
        ))}
      {tab === 'search' && search}
      {tab === 'hand' && hand}
    </div>
  );
}
