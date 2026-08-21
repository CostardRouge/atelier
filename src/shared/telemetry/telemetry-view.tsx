import type { Cue } from './srt-parser';
import {
  formatGroundSpeed,
  formatHeading,
  formatVerticalSpeed,
} from './motion';

/** Format a raw value with a unit suffix, tolerating missing data. */
export function fmt(value: string | undefined, suffix = ''): string {
  if (value === undefined || value === '') return '—';
  return suffix ? `${value}${suffix}` : value;
}

/** One label/value row inside a definition list. */
export function Field({
  label,
  value,
  suffix,
  highlight,
}: {
  label: string;
  value: string | undefined;
  suffix?: string;
  highlight?: boolean;
}) {
  const display = fmt(value, suffix);
  const empty = display === '—';
  return (
    <div style={{ display: 'contents' }}>
      <dt
        className={
          highlight
            ? 'text-[1.15rem] font-semibold text-accent-ink'
            : 'text-muted text-[0.85rem]'
        }
      >
        {label}
      </dt>
      <dd
        className={`m-0 font-mono tabular-nums text-right ${
          highlight
            ? 'text-[1.15rem] font-semibold text-accent-ink'
            : empty
              ? 'text-faint'
              : 'text-ink'
        }`}
      >
        {display}
      </dd>
    </div>
  );
}

/**
 * Full Flight + Camera panels for a single cue. Used by the detail player and
 * (in a tighter layout) anywhere the complete telemetry readout is wanted.
 */
export function TelemetryPanels({ cue }: { cue: Cue | null }) {
  const d = cue?.data ?? {};
  return (
    <div className="grid grid-cols-1 min-[680px]:grid-cols-2 gap-5 mt-6">
      <section className="bg-surface border border-line rounded-paper p-[1.25rem_1.35rem] shadow-paper-soft">
        <h2 className="flex items-center gap-2 m-0 mb-4 font-mono text-[0.74rem] font-medium uppercase tracking-[0.18em] text-muted before:content-[''] before:w-[14px] before:h-px before:bg-accent">
          Flight
        </h2>
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-[0.55rem_1rem]">
          <Field label="Rel. altitude" value={d.rel_alt} suffix=" m" highlight />
          <Field label="Abs. altitude" value={d.abs_alt} suffix=" m" />
          <Field label="Ground speed" value={formatGroundSpeed(cue?.derived?.groundSpeed)} />
          <Field label="Vertical speed" value={formatVerticalSpeed(cue?.derived?.verticalSpeed)} />
          <Field label="Heading" value={formatHeading(cue?.derived?.heading)} />
          <Field label="Latitude" value={d.latitude} />
          <Field label="Longitude" value={d.longitude} />
          <Field
            label="FrameCnt"
            value={cue?.frame != null ? String(cue.frame) : undefined}
          />
          <Field label="Timestamp" value={cue?.timestamp ?? undefined} />
        </dl>
      </section>

      <section className="bg-surface border border-line rounded-paper p-[1.25rem_1.35rem] shadow-paper-soft">
        <h2 className="flex items-center gap-2 m-0 mb-4 font-mono text-[0.74rem] font-medium uppercase tracking-[0.18em] text-muted before:content-[''] before:w-[14px] before:h-px before:bg-accent">
          Camera
        </h2>
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-[0.55rem_1rem]">
          <Field label="ISO" value={d.iso} />
          <Field label="Shutter" value={d.shutter} />
          <Field label="Aperture" value={d.fnum ? `f/${d.fnum}` : undefined} />
          <Field label="EV" value={d.ev} />
          <Field label="Focal length" value={d.focal_len} suffix=" mm" />
          <Field label="Color profile" value={d.color_md} />
          <Field label="Color temp." value={d.ct} suffix=" K" />
        </dl>
      </section>
    </div>
  );
}

/**
 * Compact live readout for a gallery card: a few key fields that update as the
 * inline video plays. Altitude is the headline; GPS and the exposure triplet
 * sit beneath it.
 */
export function LiveTelemetry({ cue }: { cue: Cue | null }) {
  const d = cue?.data ?? {};
  const gps =
    d.latitude && d.longitude ? `${d.latitude}, ${d.longitude}` : '—';
  const motion =
    [formatGroundSpeed(cue?.derived?.groundSpeed), formatHeading(cue?.derived?.heading)]
      .filter(Boolean)
      .join('  ·  ');
  const exposure = [
    d.iso ? `ISO ${d.iso}` : null,
    d.shutter ? d.shutter : null,
    d.fnum ? `f/${d.fnum}` : null,
  ]
    .filter(Boolean)
    .join('  ·  ');

  return (
    <dl className="m-0 grid grid-cols-[auto_1fr] items-baseline gap-[0.4rem_0.9rem] px-[0.95rem] py-[0.85rem] border border-line rounded-paper bg-paper">
      <dt className="font-mono text-[0.62rem] tracking-[0.14em] uppercase text-muted">
        Altitude
      </dt>
      <dd className="m-0 text-right font-serif text-[1.7rem] leading-none text-accent-ink">
        {fmt(d.rel_alt, ' m')}
      </dd>
      <dt className="font-mono text-[0.62rem] tracking-[0.14em] uppercase text-muted">
        Speed
      </dt>
      <dd className="m-0 text-right font-mono tabular-nums text-[0.82rem] text-ink">
        {motion || '—'}
      </dd>
      <dt className="font-mono text-[0.62rem] tracking-[0.14em] uppercase text-muted">
        GPS
      </dt>
      <dd className="m-0 text-right font-mono tabular-nums text-[0.82rem] text-ink">
        {gps}
      </dd>
      <dt className="font-mono text-[0.62rem] tracking-[0.14em] uppercase text-muted">
        Exposure
      </dt>
      <dd className="m-0 text-right font-mono tabular-nums text-[0.82rem] text-ink">
        {exposure || '—'}
      </dd>
    </dl>
  );
}
