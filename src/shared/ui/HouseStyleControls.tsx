import { useState, type ReactNode } from 'react';
import SectionLegend from './SectionLegend';
import { buttonClass } from './Button';

/** The dev server's writer — `houseStylePlugin` in `vite.config.ts`. */
const ENDPOINT = '/__atelier/house-style';

type Status =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'saved' }
  | { kind: 'reset' }
  | { kind: 'error'; message: string };

export interface HouseStyleRow {
  label: string;
  /** What the style will really carry — never an example. */
  value: string;
}

interface HouseStyleControlsProps {
  /** The writer's key in `vite.config.ts`. */
  target: 'trip' | 'project';
  /** Where the file lands, relative to the repository. */
  path: string;
  /** The file to write, exactly as it will be committed. */
  file: unknown;
  rows: HouseStyleRow[];
  /** One sentence per thing the style had to leave behind. */
  leftOut: string[];
  /** Whether the running build carries a house style of this target. */
  committed: boolean;
  /** Whether what is open is exactly that committed style. */
  same: boolean;
  /** The ⓘ behind the legend: what travels and what never does. */
  children: ReactNode;
}

async function send(target: string, method: 'POST' | 'DELETE', body?: string): Promise<void> {
  const response = await fetch(`${ENDPOINT}/${target}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body,
  });
  if (response.ok) return;
  const answer = (await response.json().catch(() => null)) as { error?: string } | null;
  throw new Error(answer?.error ?? `The dev server answered ${response.status}.`);
}

/**
 * Save what is open as the HOUSE STYLE, or go back to the factory look — the
 * part Trips' settings sheet and the Studio's project settings share. Mounted
 * behind `import.meta.env.DEV` by both, because only the dev server can write
 * into the repository, and what it writes becomes the deployed site's default
 * once committed (`shared/roadtrip/house-style.ts`).
 */
export default function HouseStyleControls({
  target,
  path,
  file,
  rows,
  leftOut,
  committed,
  same,
  children,
}: HouseStyleControlsProps) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  // What the running app would give a new one right now: the answer of the
  // last click wins over the bundle, which the component does not watch.
  const hasStyle = status.kind === 'saved' || (status.kind !== 'reset' && committed);
  const noun = target === 'trip' ? 'trip' : 'project';

  async function run(method: 'POST' | 'DELETE') {
    setStatus({ kind: 'busy' });
    try {
      await send(target, method, method === 'POST' ? JSON.stringify(file) : undefined);
      setStatus({ kind: method === 'POST' ? 'saved' : 'reset' });
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <>
      <SectionLegend label="House style · dev server">{children}</SectionLegend>

      <dl className="m-0 grid grid-cols-[7rem_1fr] gap-x-4 gap-y-1.5 max-w-[34rem] text-sm max-[820px]:grid-cols-1">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-xs text-muted pt-[2px]">{row.label}</dt>
            <dd className="m-0 min-w-0 text-ink-soft break-words max-[820px]:mb-1.5">{row.value}</dd>
          </div>
        ))}
      </dl>

      {leftOut.map((sentence) => (
        <p
          key={sentence}
          className="m-0 max-w-[34rem] px-3 py-2 rounded-control border border-line bg-paper text-xs text-ink-soft"
        >
          {sentence}
        </p>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => run('POST')}
          disabled={status.kind === 'busy'}
          className={buttonClass('default', 'sm')}
        >
          Save this {noun} as the house style
        </button>
        {hasStyle && (
          <button
            type="button"
            onClick={() => run('DELETE')}
            disabled={status.kind === 'busy'}
            className="p-0 border-0 bg-transparent text-xs text-faint cursor-pointer underline underline-offset-[3px] hover:text-danger"
          >
            Back to the factory look
          </button>
        )}
      </div>

      <span className="text-2xs text-faint" role="status">
        {status.kind === 'saved' &&
          `Written to ${path} — commit it to ship it. The next new ${noun} starts here.`}
        {status.kind === 'reset' &&
          `Removed ${path} — new ${noun}s start from the factory look. Commit the deletion to ship it.`}
        {status.kind === 'error' && `Nothing was written: ${status.message}`}
        {status.kind === 'busy' && 'Writing…'}
        {status.kind === 'idle' &&
          (!committed
            ? `New ${noun}s start from the factory look.`
            : same
              ? `This ${noun} already wears the house style.`
              : `New ${noun}s start from a house style this ${noun} differs from.`)}
      </span>
    </>
  );
}
