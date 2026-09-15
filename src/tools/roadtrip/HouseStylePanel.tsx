import { useState } from 'react';
import SectionLegend from '../../shared/ui/SectionLegend';
import { presetById } from '../../shared/overlay/title-styles';
import { CAR_COLOURS } from '../../shared/roadtrip/car-spec';
import {
  HOUSE_STYLE_PATH,
  houseStyleFrom,
  type TripHouseStyle,
} from '../../shared/roadtrip/house-style';
import { bundledHouseStyle } from '../../shared/roadtrip/house-style-bundle';
import { POST_KINDS, type TripDoc } from '../../shared/roadtrip/trip-types';
import { dangerLink, note, smallButton } from './panels/ui';

/** The dev server's writer — `houseStylePlugin` in `vite.config.ts`. */
const ENDPOINT = '/__atelier/house-style';

type Status =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'saved' }
  | { kind: 'reset' }
  | { kind: 'error'; message: string };

/** What each block of the style will actually say — never an example. */
function rowsOf(style: TripHouseStyle): Array<{ label: string; value: string }> {
  const colour = CAR_COLOURS.find((c) => c.hex.toLowerCase() === style.car.color.toLowerCase());
  const looks = style.grade.layers.map((layer) => layer.name);
  return [
    {
      label: 'Title style',
      value: style.theme ? (presetById(style.theme.presetId)?.name ?? style.theme.presetId) : 'None',
    },
    {
      label: 'Words',
      value: [style.badgeWords.day, style.badgeWords.days, style.badgeWords.of, style.badgeWords.at].join(' · '),
    },
    { label: 'Closing card', value: style.cta.headline.trim() || '(no headline)' },
    {
      label: 'New pieces',
      value: POST_KINDS.map(
        (k) => `${k.label}: ${style.hookDefaults[k.id] ? 'saved look' : 'factory'}`,
      ).join(' · '),
    },
    { label: 'Grade', value: looks.length ? looks.join(' + ') : 'None' },
    { label: 'Car', value: colour?.name ?? style.car.color },
  ];
}

async function send(method: 'POST' | 'DELETE', body?: string): Promise<void> {
  const response = await fetch(ENDPOINT, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body,
  });
  if (response.ok) return;
  const answer = (await response.json().catch(() => null)) as { error?: string } | null;
  throw new Error(answer?.error ?? `The dev server answered ${response.status}.`);
}

/**
 * Save the trip's look as the HOUSE STYLE — the one every new trip starts
 * from. Rendered by the dev server only (`import.meta.env.DEV`), because only
 * the dev server can write into the repository, and what it writes becomes
 * the deployed site's default once committed (`house-style.ts`).
 */
export default function HouseStylePanel({ trip }: { trip: TripDoc }) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const { file, uploadedLooks } = houseStyleFrom(trip);
  const committed = bundledHouseStyle();
  // What the running app would give a new trip right now: the answer of the
  // last click wins over the bundle, which only refreshes on the next import.
  const hasStyle =
    status.kind === 'saved' || (status.kind !== 'reset' && committed !== null);
  const same = committed !== null && JSON.stringify(committed) === JSON.stringify(file.style);

  async function run(method: 'POST' | 'DELETE') {
    setStatus({ kind: 'busy' });
    try {
      await send(method, method === 'POST' ? JSON.stringify(file) : undefined);
      setStatus({ kind: method === 'POST' ? 'saved' : 'reset' });
    } catch (error) {
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return (
    <>
      <SectionLegend label="House style · dev server">
        <p>
          Every new trip starts from this trip’s look — its words, title style,
          closing card, the look saved for each kind of piece, its grade and its
          car. Never its name, dates, legs or pieces. Trips that already exist
          never change.
        </p>
        <p>
          Saving writes <code>{HOUSE_STYLE_PATH}</code> in the repository: commit
          it and the deployed site’s new trips start there too. This panel only
          exists on the dev server.
        </p>
      </SectionLegend>

      <dl className="m-0 grid grid-cols-[7rem_1fr] gap-x-4 gap-y-1.5 max-w-[34rem] text-sm max-[820px]:grid-cols-1">
        {rowsOf(file.style).map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-xs text-muted pt-[2px]">{row.label}</dt>
            <dd className="m-0 min-w-0 text-ink-soft break-words max-[820px]:mb-1.5">{row.value}</dd>
          </div>
        ))}
      </dl>

      {uploadedLooks.length > 0 && (
        <p className={`${note} max-w-[34rem]`}>
          Left out: {uploadedLooks.join(', ')} — an uploaded look carries its whole
          .cube. Drop the file in <code>public/luts/</code> to ship it as a built-in.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => run('POST')}
          disabled={status.kind === 'busy'}
          className={smallButton}
        >
          Save this trip as the house style
        </button>
        {hasStyle && (
          <button
            type="button"
            onClick={() => run('DELETE')}
            disabled={status.kind === 'busy'}
            className={dangerLink}
          >
            Back to the factory look
          </button>
        )}
      </div>

      <span className="text-2xs text-faint" role="status">
        {status.kind === 'saved' &&
          `Written to ${HOUSE_STYLE_PATH} — commit it to ship it. The next new trip starts here.`}
        {status.kind === 'reset' &&
          `Removed ${HOUSE_STYLE_PATH} — new trips start from the factory look. Commit the deletion to ship it.`}
        {status.kind === 'error' && `Nothing was written: ${status.message}`}
        {status.kind === 'busy' && 'Writing…'}
        {status.kind === 'idle' &&
          (committed === null
            ? 'New trips start from the factory look.'
            : same
              ? 'This trip already wears the house style.'
              : 'New trips start from a house style this trip differs from.')}
      </span>
    </>
  );
}
