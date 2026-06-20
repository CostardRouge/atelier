import type { ReactNode } from 'react';
import type { ExifData } from './exif-parser';
import {
  exposureProgramLabel,
  flashLabel,
  formatAltitude,
  formatAperture,
  formatCoord,
  formatExposureBias,
  formatFocal,
  formatIso,
  formatShutter,
  mapsUrl,
  meteringModeLabel,
  orientationLabel,
  whiteBalanceLabel,
} from './exif-format';

/** One label/value row inside a definition list — missing values read as an em-dash. */
function Field({ label, value }: { label: string; value?: string }) {
  const empty = !value;
  return (
    <div style={{ display: 'contents' }}>
      <dt className="text-muted text-[0.85rem]">{label}</dt>
      <dd
        className={`m-0 font-mono tabular-nums text-right break-words ${
          empty ? 'text-faint' : 'text-ink'
        }`}
      >
        {value ?? '—'}
      </dd>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="bg-surface border border-line rounded-paper p-[1.25rem_1.35rem] shadow-paper-soft">
      <h3 className="flex items-center gap-2 m-0 mb-4 font-mono text-[0.74rem] font-medium uppercase tracking-[0.18em] text-muted before:content-[''] before:w-[14px] before:h-px before:bg-accent">
        {title}
      </h3>
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-[0.55rem_1rem]">{children}</dl>
    </section>
  );
}

/** The full Camera / Exposure / Image / Location panels for one photo's EXIF. */
export function ExifPanels({ data }: { data: ExifData }) {
  const lens = [data.lensMake, data.lensModel].filter(Boolean).join(' ').trim() || undefined;
  const dims =
    data.pixelWidth && data.pixelHeight
      ? `${data.pixelWidth} × ${data.pixelHeight}`
      : undefined;

  return (
    <div className="grid grid-cols-1 min-[680px]:grid-cols-2 gap-5">
      <Panel title="Camera">
        <Field label="Make" value={data.make} />
        <Field label="Model" value={data.model} />
        <Field label="Lens" value={lens} />
        <Field label="Software" value={data.software} />
        <Field label="Artist" value={data.artist} />
      </Panel>

      <Panel title="Exposure">
        <Field label="Shutter" value={formatShutter(data.exposureTime)} />
        <Field label="Aperture" value={formatAperture(data.fNumber)} />
        <Field label="ISO" value={formatIso(data.iso)} />
        <Field label="Exposure bias" value={formatExposureBias(data.exposureBias)} />
        <Field label="Focal length" value={formatFocal(data.focalLength)} />
        <Field label="35 mm equiv." value={formatFocal(data.focalLength35)} />
        <Field label="Program" value={exposureProgramLabel(data.exposureProgram)} />
        <Field label="Metering" value={meteringModeLabel(data.meteringMode)} />
        <Field label="White balance" value={whiteBalanceLabel(data.whiteBalance)} />
        <Field label="Flash" value={flashLabel(data.flash)} />
      </Panel>

      <Panel title="Image">
        <Field label="Dimensions" value={dims} />
        <Field label="Orientation" value={orientationLabel(data.orientation)} />
        <Field label="Captured" value={data.dateTimeOriginal} />
      </Panel>

      <Panel title="Location">
        <Field label="Coordinates" value={formatCoord(data.gps)} />
        <Field label="Altitude" value={formatAltitude(data.gpsAltitude)} />
        {data.gps && (
          <div style={{ display: 'contents' }}>
            <dt className="text-muted text-[0.85rem]">Map</dt>
            <dd className="m-0 text-right">
              <a
                className="font-mono text-[0.82rem] text-accent-ink underline underline-offset-[3px] hover:text-accent"
                href={mapsUrl(data.gps)}
                target="_blank"
                rel="noreferrer"
              >
                OpenStreetMap ↗
              </a>
            </dd>
          </div>
        )}
      </Panel>
    </div>
  );
}
