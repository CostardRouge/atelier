import { useMemo } from 'react';
import { isExportFile, summarisePolarsteps, type PolarstepsExport } from '../../../shared/roadtrip/polarsteps';
import type { IsoDate } from '../../../shared/roadtrip/trip-days';
import { pickFilesOf } from '../../../shared/sources/file-sources';
import InfoDot from '../../../shared/ui/InfoDot';
import { num, plural, spanText } from './pieces';

/**
 * The one control a Polarsteps export gets in the Deduce window: a chip in
 * the head row, beside the chip saying what the instance answered. Empty, it
 * picks the files; loaded, it says what it read and drops it. A drop anywhere
 * on the window does the same as the pick (`DeduceStagesPanel`). The why is
 * behind the ⓘ, never a standing line (`docs/deduce-ux-laws.md`).
 *
 * Nothing read here leaves the machine, and nothing is kept: the export is an
 * input to this deduction, gone with the window.
 */

/**
 * The files of a pick or a drop worth reading, and their text. A folder's
 * walk holds photographs and a `user.json`; when it holds a `trip.json` or a
 * `locations.json`, only those are read — else every JSON (a renamed file)
 * and a zip, so the zip is refused with the reason.
 */
export async function exportTexts(files: readonly File[]): Promise<{ name: string; body: string }[]> {
  const named = files.filter((f) => isExportFile(f.name));
  const chosen = named.length ? named : files.filter((f) => /\.(json|zip|gpx|xml)$/i.test(f.name));
  return Promise.all(
    chosen.map(async (f) => ({ name: f.name, body: /\.zip$/i.test(f.name) ? '' : await f.text() })),
  );
}

interface PolarstepsChipProps {
  value: PolarstepsExport | null;
  tripStart: IsoDate;
  tripEnd: IsoDate;
  /** The last refusal, said on the chip until the next read. */
  error: string | null;
  onFiles: (files: File[]) => void;
  onClear: () => void;
}

const chip =
  'inline-flex items-center gap-1.5 h-7 rounded-full border bg-transparent font-mono text-2xs cursor-pointer';

export default function PolarstepsChip({ value, tripStart, tripEnd, error, onFiles, onClear }: PolarstepsChipProps) {
  const summary = useMemo(
    () => (value ? summarisePolarsteps(value, tripStart, tripEnd) : null),
    [value, tripStart, tripEnd],
  );
  const pick = () => {
    void pickFilesOf('.json,application/json,.zip,.gpx,application/gpx+xml').then((files) => {
      if (files.length) onFiles(files);
    });
  };

  const about = (
    <InfoDot about="Polarsteps">
      <p>
        Drop a Polarsteps export here — <code>trip.json</code>, <code>locations.json</code>, or the unzipped folder.
        Its track places each day on the day&apos;s own clock (the time zone of the step you were in), before the
        instance; its steps name the places, before the town index. Read in this browser, never sent, forgotten with
        the window.
      </p>
      <p>
        GPX files — a GPS logger&apos;s, a car&apos;s, Strava&apos;s — stand in for <code>locations.json</code>: their timed
        points place the days, alone or beside a <code>trip.json</code>. A file a day is read as one journey.
      </p>
    </InfoDot>
  );

  if (!value || !summary) {
    return (
      <>
        <button
          type="button"
          onClick={pick}
          title={error ?? 'Add a Polarsteps export (trip.json, locations.json or its folder) or GPX files — or drop them on this window'}
          className={`${chip} px-2.5 ${error ? 'border-warn text-warn' : 'border-dashed border-line-strong text-ink-soft hover:text-ink'}`}
        >
          + Polarsteps / GPX
        </button>
        {about}
      </>
    );
  }

  // What was read, named by its kind: a GPX stands in for locations.json.
  const label = value.track?.origin === 'gpx' ? (value.trip ? 'Polarsteps + GPX' : 'GPX') : 'Polarsteps';

  // The chip says one number — the trip's days it places; the rest is its
  // tooltip, so it sits beside the instance's chip even on a phone.
  const title = [
    `${label}${value.trip?.name ? ` · ${value.trip.name}` : ''}`,
    summary.first && summary.last ? spanText(summary.first, summary.last) : '',
    [summary.steps ? plural(summary.steps, 'step') : '', summary.fixes ? `${num(summary.fixes)} fixes` : ''].filter(Boolean).join(', '),
    `${summary.covered} days of this trip placed`,
    value.trip ? '' : 'no trip.json: names from the index, days by longitude',
    value.track ? '' : 'no track (locations.json or GPX): a step places only its own day',
    summary.solar ? 'days read on the solar clock' : '',
    error ?? '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <span className={`${chip} pl-2.5 pr-1 cursor-default ${error ? 'border-warn' : 'border-line'} text-ink-soft`} title={title}>
        <button type="button" onClick={pick} className="p-0 border-0 bg-transparent font-mono text-2xs text-ink-soft cursor-pointer hover:text-ink">
          {label} · {plural(summary.covered, 'day')}
        </button>
        <button
          type="button"
          onClick={onClear}
          aria-label={`Drop the ${label} files`}
          title={`Drop the ${label} files`}
          className="w-5 h-5 inline-grid place-items-center rounded-full border-0 bg-transparent text-muted cursor-pointer hover:bg-paper-2 hover:text-ink"
        >
          ×
        </button>
      </span>
      {about}
    </>
  );
}
