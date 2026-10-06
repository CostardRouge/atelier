import type { ReactNode } from 'react';
import { PRESS_LOOK } from '../../shared/ui/press';

/**
 * The places of ONE stage as a table — the maintainer's pick (variant B of
 * the Deduce places lab, https://claude.ai/artifact/R4UyXo9JRF5cNwNiG9o4C5):
 * a line per place with its number in the lived order, its name, its state,
 * its COUNTRY (a code and a name), and its distance to what it is measured
 * against — so a town the search put on the wrong continent reads as such
 * on its line, in orange, before anyone looks at a map.
 *
 * Drawn the same in the Deduce window (a proposal's halts) and on a stage
 * card (the stage's places): the callers compute the rows through the one
 * formatter (`placeLine`) and the one rule (`placeOddity`), this draws them.
 *
 * In a narrow container the state and the distance go under the name and
 * the country keeps its code alone — a container query, because the table
 * sits in a modal's column and a sidebar's alike.
 */

export interface PlacesTableRow {
  key: string;
  /** The place's name alone; '' draws «Unnamed». */
  name: string;
  /** The state as the trip's writing says it («WA»), '' when none. */
  state: string;
  countryCode: string;
  countryName: string;
  /** Distance to the reference; null when either side has no position. */
  km: number | null;
  odd: boolean;
  /** Left out of the stage (Deduce): struck through, with ↩ to put it back. */
  out?: boolean;
  /** A chip after the name — a place's dates. */
  note?: ReactNode;
}

interface PlacesTableProps {
  rows: readonly PlacesTableRow[];
  /** The last column's header: what the distance is measured from. */
  kmLabel: string;
  /** The row whose panel is open under the table. */
  openKey: string | null;
  /** A click on a row (not on a verb). */
  onOpen?: (key: string) => void;
  /** The correction verb; drawn on every row while editing, else only on a suspect one. */
  onFix?: (key: string) => void;
  /** The order and leave-out verbs — present only while editing. */
  editing?: boolean;
  onMove?: (key: string, delta: -1 | 1) => void;
  onOut?: (key: string) => void;
  onBack?: (key: string) => void;
  /** Says what the table lists, for assistive tech. */
  label: string;
}

const op =
  `w-7 h-7 inline-grid place-items-center border-0 rounded-md bg-transparent text-xs text-muted cursor-pointer hover:bg-paper-2 hover:text-ink aria-disabled:opacity-25 aria-disabled:cursor-default aria-disabled:hover:bg-transparent ${PRESS_LOOK}`;
const fixOp = (odd: boolean) =>
  `h-7 px-2 inline-grid place-items-center border-0 rounded-md bg-transparent text-2xs cursor-pointer hover:bg-paper-2 ${PRESS_LOOK} ${
    odd ? 'text-warn font-semibold' : 'text-accent-ink font-medium'
  }`;
const th = 'px-2 pt-0.5 pb-1.5 border-b border-line-strong font-mono text-3xs font-medium tracking-[0.07em] uppercase text-muted text-left whitespace-nowrap';

export function formatKm(km: number | null): string {
  if (km === null) return '—';
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString('en-GB').replace(/,/g, ' ')} km`;
}

export default function PlacesTable({
  rows,
  kmLabel,
  openKey,
  onOpen,
  onFix,
  editing = false,
  onMove,
  onOut,
  onBack,
  label,
}: PlacesTableProps) {
  const kept = rows.filter((r) => !r.out);
  let n = 0;
  return (
    <div className="@container overflow-x-auto">
      <table className="w-full border-collapse text-xs" aria-label={label}>
        <thead>
          <tr>
            <th className={`${th} w-[1.6rem]`}>#</th>
            <th className={th}>Place</th>
            <th className={`${th} @max-[30rem]:hidden`}>State</th>
            <th className={th}>Country</th>
            <th className={`${th} text-right @max-[30rem]:hidden`}>{kmLabel}</th>
            <th className={th}>
              <span className="sr-only">Verbs</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const at = kept.indexOf(r);
            const number = r.out ? '–' : String(++n);
            const open = r.key === openKey;
            const tone = open
              ? 'bg-accent-wash'
              : r.odd
                ? 'bg-warn-wash text-warn'
                : 'hover:bg-paper-2';
            const struck = r.out ? 'opacity-50 line-through decoration-faint' : '';
            const td = `px-2 py-[7px] border-b border-line align-middle group-last/row:border-b-0`;
            const fix = onFix && !r.out && (editing || r.odd);
            return (
              <tr
                key={r.key}
                data-place-row={r.key}
                data-odd={r.odd || undefined}
                onClick={onOpen ? () => onOpen(r.key) : undefined}
                className={`group/row ${onOpen ? 'cursor-pointer' : ''} ${tone}`}
              >
                <td className={`${td} ${struck} font-mono text-2xs text-faint`}>{number}</td>
                <td className={`${td} ${struck}`}>
                  <span className={`font-medium ${r.name ? '' : 'italic text-muted'}`}>{r.name || 'Unnamed'}</span>
                  {r.note}
                  <span className="hidden @max-[30rem]:block font-mono text-3xs text-muted font-normal">
                    {[r.state, r.km !== null ? formatKm(r.km) : ''].filter(Boolean).join(' · ')}
                  </span>
                </td>
                <td className={`${td} ${struck} whitespace-nowrap text-ink-soft @max-[30rem]:hidden ${r.odd ? 'text-warn' : ''}`}>
                  {r.state ? <span className={r.state.length <= 4 ? 'font-mono text-2xs' : ''}>{r.state}</span> : <span className="text-faint">—</span>}
                </td>
                <td className={`${td} ${struck} whitespace-nowrap`}>
                  {r.countryCode ? (
                    <>
                      <span
                        className={`font-mono text-3xs font-medium tracking-[0.04em] px-1.5 py-px rounded-full mr-1.5 ${
                          r.odd ? 'bg-warn text-surface' : 'bg-paper-2 text-ink-soft'
                        }`}
                      >
                        {r.countryCode}
                      </span>
                      <span className="@max-[30rem]:hidden">{r.countryName}</span>
                      {r.odd && (
                        <span className="ml-1" aria-label="far from its stage, in another country" title="In another country than the trip, and far from its stage">
                          ⚠
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-faint">{r.countryName || '—'}</span>
                  )}
                </td>
                <td
                  className={`${td} ${struck} font-mono text-2xs text-right whitespace-nowrap tabular-nums @max-[30rem]:hidden ${
                    r.odd ? 'text-warn font-semibold' : 'text-muted'
                  }`}
                >
                  {formatKm(r.km)}
                </td>
                <td className={`${td} text-right whitespace-nowrap w-px`} onClick={(e) => e.stopPropagation()}>
                  {editing && r.out ? (
                    <button type="button" className={op} title="Put it back" aria-label={`Put ${r.name || 'this place'} back`} onClick={() => onBack?.(r.key)}>
                      ↩
                    </button>
                  ) : (
                    <>
                      {fix && (
                        <button type="button" className={fixOp(r.odd)} title="Another town of this name, a search, or by hand" onClick={() => onFix(r.key)}>
                          Fix
                        </button>
                      )}
                      {editing && onMove && (
                        <>
                          <button
                            type="button"
                            className={op}
                            title={at === 0 ? 'Already first' : 'Earlier'}
                            aria-label={`${r.name || 'This place'} earlier`}
                            aria-disabled={at === 0 || undefined}
                            onClick={() => at > 0 && onMove(r.key, -1)}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className={op}
                            title={at === kept.length - 1 ? 'Already last' : 'Later'}
                            aria-label={`${r.name || 'This place'} later`}
                            aria-disabled={at === kept.length - 1 || undefined}
                            onClick={() => at < kept.length - 1 && onMove(r.key, 1)}
                          >
                            ↓
                          </button>
                        </>
                      )}
                      {editing && onOut && (
                        <button
                          type="button"
                          className={op}
                          title={kept.length <= 1 ? 'A stage keeps one place at least' : 'Leave it out'}
                          aria-label={`Leave ${r.name || 'this place'} out`}
                          aria-disabled={kept.length <= 1 || undefined}
                          onClick={() => kept.length > 1 && onOut(r.key)}
                        >
                          ×
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
