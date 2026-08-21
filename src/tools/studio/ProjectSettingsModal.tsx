import { useEffect, useRef, useState } from 'react';
import { ASPECT_PRESETS } from '../../shared/projects/project-types';
import { NO_SHIFT, type TimeShift } from '../../shared/telemetry/time-format';

interface ProjectSettingsModalProps {
  name: string;
  aspectId: string;
  timeShift: TimeShift;
  onCancel: () => void;
  onApply: (next: {
    name: string;
    aspectId: string;
    timeShift: TimeShift;
  }) => void;
}

const field = 'flex flex-col gap-1.5';
const legend = 'font-mono text-[0.64rem] tracking-[0.14em] uppercase text-muted';

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
  onCancel,
  onApply,
}: ProjectSettingsModalProps) {
  const [draftName, setDraftName] = useState(name);
  const [draftAspect, setDraftAspect] = useState(aspectId);
  const [shift, setShift] = useState<TimeShift>(timeShift ?? NO_SHIFT);
  const nameRef = useRef<HTMLInputElement>(null);
  const hours = Math.trunc(shift.minutes / 60);
  const mins = Math.abs(shift.minutes % 60);

  useEffect(() => {
    nameRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // Mount-only: the modal is short-lived.
  }, []);

  function apply() {
    onApply({
      name: draftName.trim() || name,
      aspectId: draftAspect,
      timeShift: shift,
    });
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
      <div className="w-full max-w-[28rem] max-h-[90vh] overflow-auto flex flex-col gap-5 bg-surface border border-line rounded-paper-lg shadow-paper p-6">
        <div>
          <h2 className="m-0 font-serif text-[1.4rem]">Project settings</h2>
        </div>

        <label className={field}>
          <span className={legend}>Name</span>
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
          <span className={legend}>Format</span>
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
          <p className="m-0 text-[0.7rem] text-faint">
            The project's format seeds new export variants; the Export tab can
            still add other formats per variant.
          </p>
        </fieldset>

        <fieldset className="m-0 p-0 border-0 flex flex-col gap-1.5">
          <span className={legend}>Capture time</span>
          <p className="m-0 text-[0.72rem] text-muted leading-relaxed">
            The flight log records a bare wall-clock reading with no timezone —
            whatever the aircraft's clock said. If it was off, correct it here:
            the shift applies to every clock, date and timestamp element at
            once, and rolls the date when it crosses midnight.
          </p>
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
          <p className="m-0 text-[0.7rem] text-faint">
            Minutes cover the half- and quarter-hour zones; days are for a
            controller that came back from a flat battery with the wrong date.
          </p>
        </fieldset>

        <div className="flex items-center justify-end gap-4 pt-1 border-t border-line">
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
