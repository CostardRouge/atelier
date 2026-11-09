/** The pieces every row of `#/sources` is drawn with — a source, the agent bridge, a Postiz. */

export const legend = 'font-mono text-2xs tracking-[0.14em] uppercase text-muted';
export const pill =
  'inline-flex items-center gap-1.5 font-mono text-2xs tracking-[0.04em] px-2 py-[0.15rem] rounded-full border whitespace-nowrap';
export const btn =
  'px-3 py-[0.28rem] rounded-full border text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-default';
export const solid = `${btn} border-ink bg-ink text-paper hover:bg-accent hover:border-accent`;
export const ghost = `${btn} border-line-strong bg-transparent text-ink hover:text-accent-ink hover:border-accent`;
export const danger = `${btn} border-danger-line bg-transparent text-danger hover:bg-danger-wash`;

/** One fact, monospaced — the row's own facts line reads as a data strip. */
export function Fact({ label, value }: { label: string; value: string }) {
  return (
    <span>
      {label} <b className="text-ink-soft font-medium">{value}</b>
    </span>
  );
}

export interface RowProps {
  glyph: string;
  remote?: boolean;
  name: string;
  aside: string | null;
  pill: React.ReactNode;
  facts: React.ReactNode;
  actions?: React.ReactNode;
  note?: React.ReactNode;
  dim?: boolean;
}

/** The one shape every source is drawn in — local and remote alike. */
export function SourceRow({ glyph, remote, name, aside, pill: state, facts, actions, note, dim }: RowProps) {
  return (
    <div
      className={`grid grid-cols-[auto_1fr] sm:grid-cols-[auto_1fr_auto] gap-x-4 gap-y-1.5 items-start px-4 py-3.5 border rounded-paper ${
        dim ? 'border-line bg-paper/50' : 'border-line bg-surface'
      }`}
    >
      <span
        className={`row-span-2 w-8 h-8 rounded-[10px] grid place-items-center font-mono text-2xs font-bold border ${
          remote
            ? 'bg-accent-wash text-accent-ink border-danger-line'
            : 'bg-paper-2 text-ink-soft border-line'
        }`}
        aria-hidden="true"
      >
        {glyph}
      </span>
      <span className={`min-w-0 font-mono text-sm font-medium ${dim ? 'text-muted' : ''}`}>
        <span className="break-all">{name}</span>
        {aside && <small className="ml-2 font-sans text-xs text-muted">{aside}</small>}
      </span>
      <span className="col-span-2 sm:col-span-1 flex flex-wrap items-center justify-start sm:justify-end gap-1.5 order-3 sm:order-none">
        {state}
        {actions}
      </span>
      <span
        className={`col-start-2 col-span-1 sm:col-span-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-2xs text-muted tabular-nums ${
          dim ? 'opacity-70' : ''
        }`}
      >
        {facts}
      </span>
      {note && <span className="col-start-1 col-span-2 sm:col-span-3 order-4">{note}</span>}
    </div>
  );
}

