import type { Cue } from '../../shared/telemetry/srt-parser';
import {
  formatGroundSpeed,
  formatHeading,
  formatVerticalSpeed,
  motionAt,
} from '../../shared/telemetry/motion';
import { summarizeTelemetry } from '../../shared/telemetry/telemetry-summary';
import { formatBytes, formatDuration } from '../../shared/lib/format';

interface InfoPanelProps {
  baseName: string;
  video: File | null;
  /** Resolution · codec · fps, already assembled by the editor. */
  detail: string;
  duration: number;
  cues: Cue[];
  /** The cue under the playhead, or null. */
  cue: Cue | null;
}

const dt = 'font-mono text-[0.66rem] tracking-[0.12em] uppercase text-muted pt-[2px]';
const dd = 'm-0 font-mono text-[0.76rem] tabular-nums text-ink';
const heading =
  'font-mono text-[0.66rem] tracking-[0.12em] uppercase text-muted flex items-center gap-2 before:content-[""] before:w-[14px] before:h-px before:bg-accent';

/** One label/value row; missing values read "—" in the faint ink. */
function Row({
  label,
  value,
  suffix,
}: {
  label: string;
  value: string | undefined;
  suffix?: string;
}) {
  const empty = value === undefined || value === '';
  return (
    <>
      <dt className={dt}>{label}</dt>
      <dd className={`${dd} ${empty ? 'text-faint' : ''}`}>
        {empty ? '—' : suffix ? `${value}${suffix}` : value}
      </dd>
    </>
  );
}

/**
 * The studio inspector's Info tab: the clip's facts, then the telemetry under
 * the playhead. Everything is one narrow two-column list — Flight and Camera
 * are STACKED sections of the same list, not side-by-side cards: the
 * inspector is a column, and a long live list reads fine vertically.
 */
export default function InfoPanel({
  baseName,
  video,
  detail,
  duration,
  cues,
  cue,
}: InfoPanelProps) {
  const hasTelemetry = cues.length > 0;
  const d = cue?.data ?? {};
  const summary = hasTelemetry ? summarizeTelemetry(cues) : null;
  const flightLine = summary
    ? [
        `${summary.cueCount} cues`,
        summary.relAltMax != null
          ? `alt ${summary.relAltMin ?? 0}–${summary.relAltMax} m`
          : null,
        summary.colorProfile,
      ]
        .filter(Boolean)
        .join(' · ')
    : undefined;

  return (
    <div className="flex flex-col gap-3">
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[0.8rem]">
        <dt className={dt}>Clip</dt>
        <dd className="m-0 truncate text-[0.8rem]" title={baseName}>
          {baseName}
        </dd>
        {video && <Row label="Size" value={formatBytes(video.size)} />}
        {detail && <Row label="Detail" value={detail} />}
        {duration > 0 && <Row label="Duration" value={formatDuration(duration)} />}
        {flightLine && <Row label="Flight" value={flightLine} />}
      </dl>

      {hasTelemetry ? (
        <div className="flex flex-col gap-2.5 pt-2.5 border-t border-line">
          <p className="m-0 font-mono text-[0.66rem] tracking-[0.12em] uppercase text-muted">
            Telemetry at playhead
          </p>

          <p className={`m-0 ${heading}`}>Flight</p>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <Row label="Rel. alt" value={d.rel_alt} suffix=" m" />
            <Row label="Abs. alt" value={d.abs_alt} suffix=" m" />
            <Row label="Speed" value={formatGroundSpeed(motionAt(cue).groundSpeed)} />
            <Row label="V. speed" value={formatVerticalSpeed(motionAt(cue).verticalSpeed)} />
            <Row label="Heading" value={formatHeading(motionAt(cue).heading)} />
            <Row label="Lat" value={d.latitude} />
            <Row label="Lon" value={d.longitude} />
            <Row
              label="Frame"
              value={cue?.frame != null ? String(cue.frame) : undefined}
            />
            <Row label="Time" value={cue?.timestamp ?? undefined} />
          </dl>

          <p className={`m-0 mt-1 ${heading}`}>Camera</p>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <Row label="ISO" value={d.iso} />
            <Row label="Shutter" value={d.shutter} />
            <Row label="Aperture" value={d.fnum ? `f/${d.fnum}` : undefined} />
            <Row label="EV" value={d.ev} />
            <Row label="Focal" value={d.focal_len} suffix=" mm" />
            <Row label="Profile" value={d.color_md} />
            <Row label="WB" value={d.ct} suffix=" K" />
          </dl>
        </div>
      ) : (
        <p className="m-0 text-[0.78rem] text-muted pt-2.5 border-t border-line">
          No flight log (.srt) with this clip — the inspector shows live
          telemetry when one is present.
        </p>
      )}
    </div>
  );
}
