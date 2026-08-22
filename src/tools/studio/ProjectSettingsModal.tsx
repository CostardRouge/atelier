import { useEffect, useRef, useState } from 'react';
import { ASPECT_PRESETS } from '../../shared/projects/project-types';
import {
  PROJECT_FILE_ACCEPT,
  parseProjectFile,
  type ProjectFile,
} from '../../shared/projects/project-file';
import { pickFile } from '../../shared/sources/file-sources';
import SectionLegend from './SectionLegend';
import { NO_SHIFT, type TimeShift } from '../../shared/telemetry/time-format';
import {
  describeTimeScale,
  formatCadence,
  type TimeScaleReading,
  type TimeScaleSetting,
} from '../../shared/telemetry/time-scale';

export interface ProjectSettingsDraft {
  name: string;
  aspectId: string;
  timeShift: TimeShift;
  /**
   * The clip's cadence correction. Rides in the draft so one shape serves
   * apply and export alike — but it is NOT portable, and `project-file.ts`
   * drops it on the way out: it is measured against one clip's telemetry and
   * would silently multiply another clip's speeds.
   */
  timeScale: TimeScaleSetting;
}

interface ProjectSettingsModalProps {
  name: string;
  aspectId: string;
  timeShift: TimeShift;
  timeScale: TimeScaleSetting;
  /** What this clip's telemetry says its cadence is, for the auto option. */
  measured: TimeScaleReading;
  onCancel: () => void;
  onApply: (next: ProjectSettingsDraft) => void;
  /** Download the project file; the draft above is folded in, applied or not. */
  onExport: (draft: ProjectSettingsDraft) => void;
  /** Replace the open project's portable half with an imported file. */
  onImport: (file: ProjectFile) => void;
}

const field = 'flex flex-col gap-1.5';
const legend = 'font-mono text-[0.64rem] tracking-[0.14em] uppercase text-muted';
const smallButton =
  'px-3 py-1.5 inline-flex items-center gap-1.5 border border-line-strong rounded-full bg-paper text-[0.78rem] text-ink-soft cursor-pointer transition-colors hover:border-accent hover:text-accent-ink';

/**
 * Project settings, DaVinci-style: everything chosen at creation stays
 * editable mid-flight. Today that's the name and the destination format;
 * future settings (frame rate, background, units) join here, not in new
 * scattered dialogs.
 */
export default function ProjectSettingsModal({
  name,
  aspectId,
  timeShift,
  timeScale,
  measured,
  onCancel,
  onApply,
  onExport,
  onImport,
}: ProjectSettingsModalProps) {
  const [draftName, setDraftName] = useState(name);
  const [draftAspect, setDraftAspect] = useState(aspectId);
  const [shift, setShift] = useState<TimeShift>(timeShift ?? NO_SHIFT);
  // An imported file waits for a confirmation: importing overwrites the whole
  // portable half, which is a lot of work to lose to a mis-click.
  const [pending, setPending] = useState<ProjectFile | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [scaleMode, setScaleMode] = useState<'auto' | 'manual'>(
    timeScale?.mode ?? 'auto',
  );
  // The author thinks in "four times slower", not in "0.25 capture seconds per
  // media second" — so the box holds the factor and a direction, and the scale
  // is rebuilt from them on apply.
  const startScale =
    timeScale?.mode === 'manual' ? timeScale.scale : measured.scale;
  const [slower, setSlower] = useState(startScale <= 1);
  const [factor, setFactor] = useState(
    () => Math.round((startScale <= 1 ? 1 / startScale : startScale) * 100) / 100,
  );
  const nameRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const hours = Math.trunc(shift.minutes / 60);
  const mins = Math.abs(shift.minutes % 60);
  const measuredLabel =
    measured.basis === 'none'
      ? 'nothing measurable in this clip — treated as real time'
      : [describeTimeScale(measured.scale) ?? 'real time', formatCadence(measured)]
          .filter(Boolean)
          .join(' · ');

  useEffect(() => {
    nameRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // Mount-only: the modal is short-lived.
  }, []);

  // The import/export section sits at the bottom of a scrollable dialog: on a
  // short window the confirmation would otherwise appear below the fold and
  // read as "nothing happened".
  useEffect(() => {
    if (pending) confirmRef.current?.scrollIntoView({ block: 'nearest' });
  }, [pending]);

  function draft(): ProjectSettingsDraft {
    const magnitude = Math.min(600, Math.max(1, Number(factor) || 1));
    return {
      name: draftName.trim() || name,
      aspectId: draftAspect,
      timeShift: shift,
      timeScale:
        scaleMode === 'manual'
          ? { mode: 'manual', scale: slower ? 1 / magnitude : magnitude }
          : { mode: 'auto', scale: 1 },
    };
  }

  function apply() {
    onApply(draft());
  }

  /** Read a chosen file; a bad one explains itself instead of throwing. */
  async function chooseFile() {
    const file = await pickFile(PROJECT_FILE_ACCEPT);
    if (!file) return;
    setImportError(null);
    setPending(null);
    const parsed = parseProjectFile(await file.text());
    if (!parsed.ok) {
      setImportError(parsed.error);
      return;
    }
    setPending(parsed.file);
  }

  /** Rebuild the signed minute total from the hour and minute boxes. */
  function setHM(h: number, m: number) {
    const sign = h < 0 || (h === 0 && Object.is(h, -0)) ? -1 : 1;
    setShift({ ...shift, minutes: h * 60 + sign * Math.abs(m) });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(20,18,15,0.45)] backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="Project settings"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-[28rem] max-h-[90vh] overflow-auto flex flex-col gap-5 bg-surface border border-line rounded-paper-lg shadow-paper px-6 pt-6">
        <div>
          <h2 className="m-0 font-serif text-[1.4rem]">Project settings</h2>
        </div>

        <label className={field}>
          <SectionLegend label="Name" />
          <input
            ref={nameRef}
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') apply();
            }}
            className="font-sans text-[0.95rem] px-3.5 py-2 border border-line-strong rounded-paper bg-paper text-ink focus:outline-none focus:border-accent"
          />
        </label>

        <fieldset className="m-0 p-0 border-0 flex flex-col gap-1.5">
          <SectionLegend label="Format">
            <p>
              The project's format seeds new export variants; the Export tab can
              still add other formats per variant.
            </p>
          </SectionLegend>
          <div className="grid grid-cols-2 gap-2">
            {ASPECT_PRESETS.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setDraftAspect(a.id)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-paper border text-left cursor-pointer transition-colors ${
                  draftAspect === a.id
                    ? 'border-accent bg-accent-wash'
                    : 'border-line bg-paper hover:border-line-strong'
                }`}
                aria-pressed={draftAspect === a.id}
              >
                <span
                  className="flex-none border-[1.5px] border-ink-soft rounded-[2px]"
                  style={{
                    width: a.w >= a.h ? 26 : Math.round((26 * a.w) / a.h),
                    height: a.w >= a.h ? Math.round((26 * a.h) / a.w) : 26,
                  }}
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span className="block font-semibold text-[0.82rem]">{a.id}</span>
                  <span className="block text-[0.7rem] text-muted truncate">
                    {a.label}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="m-0 p-0 border-0 flex flex-col gap-1.5">
          <SectionLegend label="Cadence">
            <p>
              Slow motion and time-lapse are <em>conformed</em>: the file plays
              at a speed the camera never shot at, so every speed read from the
              flight log — ground, vertical — would be divided by the wrong
              seconds. The log's own timestamps say what the real cadence was.
            </p>
            <p>
              Only rates move: a heading is a direction and survives any
              conform, and the clock badges keep reading the capture time, which
              is why they tick slowly on a ralenti — that part is true.
            </p>
          </SectionLegend>
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => setScaleMode('auto')}
              aria-pressed={scaleMode === 'auto'}
              className={`flex flex-col items-start gap-0.5 px-3 py-2 rounded-paper border text-left cursor-pointer transition-colors ${
                scaleMode === 'auto'
                  ? 'border-accent bg-accent-wash'
                  : 'border-line bg-paper hover:border-line-strong'
              }`}
            >
              <span className="font-semibold text-[0.82rem]">
                Follow the flight log
              </span>
              <span className="font-mono text-[0.68rem] text-muted">
                {measuredLabel}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setScaleMode('manual')}
              aria-pressed={scaleMode === 'manual'}
              className={`flex flex-col items-start gap-0.5 px-3 py-2 rounded-paper border text-left cursor-pointer transition-colors ${
                scaleMode === 'manual'
                  ? 'border-accent bg-accent-wash'
                  : 'border-line bg-paper hover:border-line-strong'
              }`}
            >
              <span className="font-semibold text-[0.82rem]">Set it by hand</span>
              <span className="text-[0.68rem] text-muted">
                For footage whose log says nothing — or a conform you did yourself.
              </span>
            </button>
          </div>
          {scaleMode === 'manual' && (
            <div className="flex items-center gap-2 pl-3">
              <span className="text-[0.78rem] text-ink-soft">This clip plays</span>
              <input
                type="number"
                value={factor}
                min={1}
                max={600}
                step={0.5}
                onChange={(e) => setFactor(Number(e.target.value))}
                className="w-[5rem] font-mono text-[0.85rem] px-2 py-1.5 border border-line-strong rounded-paper bg-paper text-ink focus:outline-none focus:border-accent"
              />
              <span className="text-[0.78rem] text-ink-soft">×</span>
              <div className="flex rounded-full border border-line-strong overflow-hidden">
                {(['slower', 'faster'] as const).map((dir) => (
                  <button
                    key={dir}
                    type="button"
                    onClick={() => setSlower(dir === 'slower')}
                    aria-pressed={slower === (dir === 'slower')}
                    className={`px-2.5 py-1 font-mono text-[0.68rem] cursor-pointer transition-colors ${
                      slower === (dir === 'slower')
                        ? 'bg-ink text-paper'
                        : 'bg-paper text-muted hover:text-ink'
                    }`}
                  >
                    {dir}
                  </button>
                ))}
              </div>
              <span className="text-[0.78rem] text-ink-soft">than life</span>
            </div>
          )}
        </fieldset>

        <fieldset className="m-0 p-0 border-0 flex flex-col gap-1.5">
          <SectionLegend label="Capture-time shift">
            <p>
              The flight log records a bare wall-clock reading with no timezone
              — whatever the aircraft's clock said. If it was off, correct it
              here: the shift applies to every clock, date and timestamp element
              at once, and rolls the date when it crosses midnight.
            </p>
            <p>
              Minutes cover the half- and quarter-hour zones; days are for a
              controller that came back from a flat battery with the wrong date.
            </p>
          </SectionLegend>
          <div className="flex items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className={legend}>Hours</span>
              <input
                type="number"
                value={hours}
                min={-23}
                max={23}
                onChange={(e) => setHM(Number(e.target.value) || 0, mins)}
                className="w-[4.5rem] font-mono text-[0.85rem] px-2 py-1.5 border border-line-strong rounded-paper bg-paper text-ink focus:outline-none focus:border-accent"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={legend}>Minutes</span>
              <input
                type="number"
                value={mins}
                min={0}
                max={59}
                step={15}
                onChange={(e) => setHM(hours, Number(e.target.value) || 0)}
                className="w-[4.5rem] font-mono text-[0.85rem] px-2 py-1.5 border border-line-strong rounded-paper bg-paper text-ink focus:outline-none focus:border-accent"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={legend}>Days</span>
              <input
                type="number"
                value={shift.days}
                min={-366}
                max={366}
                onChange={(e) =>
                  setShift({ ...shift, days: Number(e.target.value) || 0 })
                }
                className="w-[4.5rem] font-mono text-[0.85rem] px-2 py-1.5 border border-line-strong rounded-paper bg-paper text-ink focus:outline-none focus:border-accent"
              />
            </label>
            {(shift.minutes !== 0 || shift.days !== 0) && (
              <button
                type="button"
                onClick={() => setShift({ ...NO_SHIFT })}
                className="mb-1.5 p-0 border-0 bg-transparent text-[0.75rem] text-accent-ink cursor-pointer underline underline-offset-[3px]"
              >
                Clear
              </button>
            )}
          </div>
        </fieldset>

        <fieldset className="m-0 p-0 border-0 flex flex-col gap-2 pt-4 border-t border-line">
          <SectionLegend label="Import / export">
            <p>
              A project file carries the settings only — overlays, style, grade,
              format, capture-time shift and the export matrix. Never your
              media, and never this clip's cadence: it is a template you can
              keep, share or reuse on another machine.
            </p>
          </SectionLegend>
          <div className="flex flex-wrap items-center gap-2.5">
            <button type="button" onClick={() => onExport(draft())} className={smallButton}>
              <span aria-hidden="true">↓</span> Export settings
            </button>
            <button type="button" onClick={() => void chooseFile()} className={smallButton}>
              <span aria-hidden="true">↑</span> Import a file…
            </button>
          </div>

          {pending && (
            <div
              ref={confirmRef}
              className="flex flex-col gap-2 p-3 rounded-paper border border-accent bg-accent-wash"
            >
              <p className="m-0 text-[0.78rem] leading-relaxed">
                Replace this project's overlays, style, grade and format with
                {pending.name ? ` “${pending.name}”` : ' the imported file'}?
              </p>
              <p className="m-0 text-[0.72rem] text-muted leading-relaxed">
                {pending.elements.length} element
                {pending.elements.length === 1 ? '' : 's'} · {pending.settings.aspectId}
                {pending.lutStack.length > 0 &&
                  ` · ${pending.lutStack.length} LUT layer${pending.lutStack.length === 1 ? '' : 's'}`}
                {' '}— the media and the project name stay as they are.
              </p>
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => onImport(pending)}
                  className="p-0 border-0 bg-transparent text-[0.78rem] font-semibold text-accent-ink cursor-pointer underline underline-offset-[3px]"
                >
                  Replace the settings
                </button>
                <button
                  type="button"
                  onClick={() => setPending(null)}
                  className="p-0 border-0 bg-transparent text-[0.78rem] text-muted cursor-pointer"
                >
                  Keep mine
                </button>
              </div>
            </div>
          )}

          {importError && (
            <p className="m-0 text-[0.75rem] text-[#9a3a23]" role="alert">
              {importError}
            </p>
          )}
        </fieldset>

        {/* Pinned: on a phone the card scrolls, and Apply used to sit below
            the fold — the one control every visit ends with. */}
        <div className="sticky bottom-0 -mx-6 mt-4 px-6 pb-6 flex items-center justify-end gap-4 pt-1 border-t border-line bg-surface">
          <button
            type="button"
            onClick={onCancel}
            className="p-0 mt-4 border-0 bg-transparent text-[0.84rem] text-muted cursor-pointer hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={apply}
            className="mt-4 px-[1.1rem] py-2 inline-flex items-center border border-ink rounded-full bg-ink text-paper cursor-pointer text-[0.84rem] font-semibold transition-colors duration-200 ease-paper hover:bg-accent hover:border-accent"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
