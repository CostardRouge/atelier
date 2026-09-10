import type { WinnowAssetRow, WinnowClient } from '../shared/sources/winnow/client';
import WinnowThumb from '../shared/sources/winnow/WinnowThumb';
import type { WinnowConnection } from '../shared/sources/winnow/store';
import type { ScopeRows } from '../shared/sources/winnow/use-scope-rows';
import type { InstancePicker } from '../shared/sources/winnow/use-pick';

interface WinnowScopeGridProps {
  connection: WinnowConnection;
  client: WinnowClient;
  /** Inclusive span the tiles were asked for — for the empty-state sentence. */
  from: string;
  to: string;
  /** The instance's answer for that span, owned by the sidebar (it subtracts it from the pool list). */
  scope: ScopeRows;
  /**
   * The rows to draw: `scope.rows` past the sidebar's filter box. The sidebar
   * owns the filtering because the lightbox pages through exactly this list,
   * and two copies of the same predicate would eventually disagree about
   * which picture index 3 is.
   */
  shown: readonly WinnowAssetRow[];
  /**
   * The remote ids (`"<host>/<id>"`) already in the pool, mapped to the
   * Library asset id they became — so a tile that is already here activates
   * it instead of fetching it twice, and is drawn as such.
   */
  inLibrary: ReadonlyMap<string, string>;
  /** The Library's active asset id, so its tile is the one with the ring. */
  activeId: string | null;
  /** Bringing one picture across, shared with the lightbox. */
  picker: InstancePicker;
  /**
   * What a click does. `pick` fetches the picture and makes it active — a
   * slide is waiting for it. `preview` opens it large instead, and the fetch
   * becomes a button in there. The active tool decides, through
   * `MediaScope.intent`; the grid only obeys.
   */
  onPreview: ((index: number) => void) | null;
  /**
   * Whether the grid states the two quiet cases itself — asking, and a span
   * the instance holds nothing on. False when the sidebar's day stepper
   * already carries that reading under the control, so the fact is stated
   * once. A real problem is never quiet: it is drawn here either way.
   */
  announce: boolean;
}

/**
 * The tiles of the Library's Winnow tab: what the instance holds for the span
 * the active tool is on, fetched one picture per click.
 *
 * It is a VIEW of the instance, never a pool of its own — the maintainer's
 * design: *"en mode sidebar winnow ça change automatiquement les médias
 * affichés en fonction de la date range"*, so nothing accumulates when the
 * day changes and nothing needs cleaning. What a click fetches lands in the
 * ordinary Library through `addFiles`, vouched for by `materialize`, and
 * from then on it is an ordinary asset: it grades, exports and comes back by
 * itself after a reload (`resolve-media.ts`). A tile whose picture is already
 * in the pool is marked and only re-activates it.
 *
 * What a click DOES depends on what the active tool has open: with a slide
 * waiting for a picture it fetches, and otherwise it opens the lightbox
 * (`onPreview`) so a day can be read at a readable size. The tool says which
 * through `MediaScope.intent`; nothing is decided here.
 *
 * Fixed-height tiles, not `aspect-square` — the trap `frontend.md` records
 * for exactly this kind of grid.
 */
export default function WinnowScopeGrid({
  connection,
  client,
  from,
  to,
  scope,
  shown,
  inLibrary,
  activeId,
  picker,
  onPreview,
  announce,
}: WinnowScopeGridProps) {
  const { rows, problem, reload } = scope;
  const { pick, fetching } = picker;
  const shownProblem = picker.problem ?? problem;

  return (
    <div className="flex flex-col gap-2">
      {rows === null && !problem ? (
        // Waiting on a span. Skeleton tiles, not an empty grid: the day arrows
        // and the month arrows both answer slowly enough that a blank pane
        // reads as "nothing here", and the pictures then arrive after the
        // reader has moved on. The sentence stays optional (`announce`); the
        // skeleton is not a sentence, so it is drawn either way.
        <div className="flex flex-col gap-2" aria-busy="true">
          {announce && (
            <p className="m-0 font-mono text-[0.68rem] text-muted">asking {connection.id}…</p>
          )}
          <div className="w-full grid grid-cols-[repeat(auto-fill,minmax(74px,1fr))] gap-1.5">
            {Array.from({ length: 8 }, (_, i) => (
              <span
                key={i}
                className="block h-[74px] rounded-md border border-line bg-paper-2 animate-pulse motion-reduce:animate-none"
              />
            ))}
          </div>
        </div>
      ) : rows !== null && rows.length === 0 && !problem ? (
        announce ? (
          <p className="m-0 text-[0.78rem] text-muted">
            {connection.id} holds nothing shot{' '}
            {from === to ? `on ${from}` : `from ${from} to ${to}`}.
          </p>
        ) : null
      ) : shown.length === 0 && rows && rows.length > 0 ? (
        <p className="m-0 text-[0.78rem] text-muted">Nothing here matches the filter.</p>
      ) : (
        <div className="w-full grid grid-cols-[repeat(auto-fill,minmax(74px,1fr))] gap-1.5">
          {shown.map((r, i) => {
            const have = inLibrary.get(`${connection.id}/${r.id}`);
            const active = have !== undefined && have === activeId;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => (onPreview ? onPreview(i) : void pick(r))}
                disabled={fetching !== null}
                aria-pressed={active}
                title={`${onPreview ? 'Look at' : 'Use'} ${r.filename}${
                  r.has_telemetry ? ' · flight log' : ''
                }${have ? ' · in the library' : ''}`}
                className={`relative block rounded-md overflow-hidden border bg-frame cursor-pointer p-0 disabled:cursor-wait transition-colors ${
                  active
                    ? 'border-accent shadow-[inset_0_0_0_2px_var(--color-accent)]'
                    : have
                      ? 'border-line-strong'
                      : 'border-line hover:border-line-strong'
                }`}
              >
                <WinnowThumb
                  client={client}
                  id={r.id}
                  alt={r.filename}
                  label={r.media_type === 'video' ? 'video' : 'photo'}
                  box="w-full h-[74px]"
                />
                {r.media_type === 'video' && (
                  <span
                    className="absolute top-1 left-1 font-mono text-[0.55rem] text-paper bg-[rgba(20,18,15,0.62)] px-1 rounded-[3px] leading-[1.4]"
                    aria-hidden="true"
                  >
                    ▶{r.has_telemetry ? ' srt' : ''}
                  </span>
                )}
                {/* Two independent facts, so both are always drawn: the ✓
                    says the picture is in the pool, the ring says it is the
                    one the tool is on. Hiding the ✓ under the ring made a
                    click look like it had ticked the PREVIOUS tile — the
                    badge only ever appeared where the ring had just left. */}
                {have && (
                  <span
                    className={`absolute bottom-1 right-1 w-[14px] h-[14px] grid place-items-center rounded-full text-[0.6rem] leading-none border ${
                      active
                        ? 'bg-accent text-paper border-accent'
                        : 'bg-paper text-ink border-line-strong'
                    }`}
                    aria-hidden="true"
                    title="In the library"
                  >
                    ✓
                  </span>
                )}
                {fetching === r.id && (
                  <span className="absolute inset-0 grid place-items-center bg-[rgba(20,18,15,0.55)] font-mono text-[0.58rem] text-paper">
                    fetching…
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {shownProblem && (
        <p className="m-0 text-[0.78rem] text-[#9a3a23]" role="alert">
          {shownProblem.text}{' '}
          {shownProblem.login && (
            <a
              className="font-semibold underline underline-offset-[3px]"
              href={shownProblem.login}
              target="_blank"
              rel="noreferrer"
            >
              Sign in there
            </a>
          )}{' '}
          <button
            type="button"
            onClick={() => {
              picker.clearProblem();
              reload();
            }}
            className="p-0 border-0 bg-transparent text-[0.74rem] text-muted cursor-pointer underline underline-offset-[3px] hover:text-ink"
          >
            ask again
          </button>
        </p>
      )}
    </div>
  );
}
