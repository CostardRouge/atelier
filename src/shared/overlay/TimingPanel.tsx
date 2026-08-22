/**
 * When the selected element is on screen, and how it arrives and leaves.
 *
 * Deliberately a panel of its own rather than another branch of ElementPanel:
 * timing applies to EVERY kind (a title, a heading tape, an altitude readout),
 * where that panel is a stack of per-kind sections. It is mounted by the studio
 * only — the legacy overlay page has no playhead origin to count from.
 */

import type { AnimDirection, AnimPreset, AnimStep, Easing } from './animation';
import type { OverlayElement } from './overlay-types';
import type { Scene } from './scenes';

interface TimingPanelProps {
  element: OverlayElement;
  /** The scene the element belongs to, if any — its window is relative to it. */
  scene: Scene | null;
  /** Playhead position, in seconds from the first exported frame. */
  playhead: number;
  onChange: (patch: Partial<OverlayElement>) => void;
}

const labelClass = 'font-mono text-[0.62rem] tracking-[0.12em] uppercase text-muted';
const inputClass =
  'font-sans text-[0.82rem] text-ink bg-surface border border-line-strong rounded-paper px-[0.6rem] py-[0.4rem] w-full';
const linkClass =
  'p-0 border-0 bg-transparent text-accent-ink font-semibold text-[0.68rem] cursor-pointer underline underline-offset-[2px] hover:text-accent';

const PRESETS: { value: AnimPreset; label: string }[] = [
  { value: 'none', label: 'Cut — no animation' },
  { value: 'fade', label: 'Fade' },
  { value: 'slide', label: 'Slide + fade' },
  { value: 'scale', label: 'Scale + fade' },
  { value: 'typewriter', label: 'Typewriter' },
  { value: 'wipe', label: 'Wipe' },
];

const DIRECTIONS: { value: AnimDirection; label: string }[] = [
  { value: 'up', label: 'Up' },
  { value: 'down', label: 'Down' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
];

const EASINGS: { value: Easing; label: string }[] = [
  { value: 'out', label: 'Ease out' },
  { value: 'in', label: 'Ease in' },
  { value: 'in-out', label: 'Ease in-out' },
  { value: 'linear', label: 'Linear' },
];

function defaultFor(phase: 'in' | 'out'): AnimStep {
  return { preset: 'fade', duration: phase === 'in' ? 0.5 : 0.4, easing: phase === 'in' ? 'out' : 'in' };
}

function StepControls({
  step,
  phase,
  onChange,
}: {
  step: AnimStep;
  phase: 'in' | 'out';
  onChange: (next: AnimStep) => void;
}) {
  const animated = step.preset !== 'none';
  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        <span className={labelClass}>{phase === 'in' ? 'Entrance' : 'Exit'}</span>
        <select
          className={`${inputClass} cursor-pointer`}
          value={step.preset}
          onChange={(e) => onChange({ ...step, preset: e.target.value as AnimPreset })}
        >
          {PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      {animated && (
        <>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Duration · {step.duration.toFixed(2)} s</span>
            <input
              type="range"
              className="w-full accent-accent cursor-pointer"
              min={0.05}
              max={3}
              step={0.05}
              value={step.duration}
              onChange={(e) => onChange({ ...step, duration: Number(e.target.value) })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Curve</span>
            <select
              className={`${inputClass} cursor-pointer`}
              value={step.easing}
              onChange={(e) => onChange({ ...step, easing: e.target.value as Easing })}
            >
              {EASINGS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          {step.preset === 'slide' && (
            <div className="flex gap-2">
              <label className="flex flex-col gap-1 flex-1 min-w-0">
                <span className={labelClass}>Direction</span>
                <select
                  className={`${inputClass} cursor-pointer`}
                  value={step.direction ?? 'up'}
                  onChange={(e) =>
                    onChange({ ...step, direction: e.target.value as AnimDirection })
                  }
                >
                  {DIRECTIONS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 flex-1 min-w-0">
                <span className={labelClass}>
                  Travel · {Math.round((step.distanceFrac ?? 0.06) * 100)}%
                </span>
                <input
                  type="range"
                  className="w-full accent-accent cursor-pointer"
                  min={0.01}
                  max={0.4}
                  step={0.01}
                  value={step.distanceFrac ?? 0.06}
                  onChange={(e) =>
                    onChange({ ...step, distanceFrac: Number(e.target.value) })
                  }
                />
              </label>
            </div>
          )}
          {step.preset === 'scale' && (
            <label className="flex flex-col gap-1">
              <span className={labelClass}>
                {phase === 'in' ? 'From' : 'To'} · {Math.round((step.scaleFrom ?? 0.86) * 100)}%
              </span>
              <input
                type="range"
                className="w-full accent-accent cursor-pointer"
                min={0.2}
                max={2}
                step={0.02}
                value={step.scaleFrom ?? 0.86}
                onChange={(e) => onChange({ ...step, scaleFrom: Number(e.target.value) })}
              />
            </label>
          )}
        </>
      )}
    </div>
  );
}

export default function TimingPanel({
  element,
  scene,
  playhead,
  onChange,
}: TimingPanelProps) {
  const win = element.window ?? null;
  const anim = element.animation ?? {};
  // Inside a scene the numbers are offsets into it, so the playhead has to be
  // read the same way before it can be dropped into a field.
  const local = Math.max(0, playhead - (scene?.start ?? 0));
  const timed = win != null;

  function setWindow(patch: { start?: number; end?: number | null }) {
    const base = win ?? { start: 0, end: null };
    const next = { ...base, ...patch };
    // The handles never cross: an end at or before the start would make the
    // element unreachable, which reads as "my title vanished".
    if (next.end != null && next.end <= next.start) next.end = next.start + 0.1;
    onChange({ window: next });
  }

  function setStep(phase: 'in' | 'out', step: AnimStep | null) {
    onChange({ animation: { ...anim, [phase]: step } });
  }

  return (
    <div className="flex flex-col gap-[0.85rem]">
      {scene ? (
        <p className="m-0 text-[0.78rem] text-muted">
          In <strong className="font-semibold text-ink">{scene.name}</strong> —
          times below count from the scene's start ({scene.start.toFixed(1)} s), and it
          leaves with the scene at {scene.end.toFixed(1)} s at the latest.{' '}
          <button
            type="button"
            className={linkClass}
            onClick={() => onChange({ sceneId: undefined })}
          >
            Take it out
          </button>
        </p>
      ) : (
        <p className="m-0 text-[0.78rem] text-muted">
          Times count from the clip's in point — the first frame an export keeps.
        </p>
      )}

      {!timed ? (
        <div className="flex items-center gap-2">
          <span className="text-[0.78rem] text-muted">On screen the whole clip.</span>
          <button
            type="button"
            className={linkClass}
            onClick={() => onChange({ window: { start: 0, end: scene ? null : 3 } })}
          >
            Give it a window
          </button>
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <label className="flex flex-col gap-1 flex-1 min-w-0">
              <span className={labelClass}>Appears · s</span>
              <input
                type="number"
                className={inputClass}
                min={0}
                step={0.1}
                value={win.start}
                onChange={(e) => setWindow({ start: Math.max(0, Number(e.target.value)) })}
              />
              <button
                type="button"
                className={`${linkClass} self-start`}
                onClick={() => setWindow({ start: Number(local.toFixed(2)) })}
              >
                From playhead
              </button>
            </label>
            <label className="flex flex-col gap-1 flex-1 min-w-0">
              <span className={labelClass}>Disappears · s</span>
              <input
                type="number"
                className={inputClass}
                min={0}
                step={0.1}
                placeholder={scene ? 'with the scene' : 'end of clip'}
                value={win.end ?? ''}
                onChange={(e) =>
                  setWindow({
                    end: e.target.value === '' ? null : Number(e.target.value),
                  })
                }
              />
              <button
                type="button"
                className={`${linkClass} self-start`}
                onClick={() => setWindow({ end: Number(local.toFixed(2)) })}
              >
                From playhead
              </button>
            </label>
          </div>
          <button
            type="button"
            className={`${linkClass} self-start`}
            onClick={() => onChange({ window: undefined })}
          >
            Remove the window
          </button>
        </>
      )}

      <div className="pt-2 border-t border-line flex flex-col gap-3">
        <StepControls
          phase="in"
          step={anim.in ?? { preset: 'none', duration: 0, easing: 'out' }}
          onChange={(next) => {
            if (next.preset === 'none') return setStep('in', null);
            // Turning an animation ON starts from a usable step, not from the
            // zero-duration placeholder the "Cut" row stands on.
            setStep('in', anim.in ? next : { ...defaultFor('in'), preset: next.preset });
          }}
        />
        {anim.in && (
          <label className="flex flex-col gap-1">
            <span className={labelClass}>
              Wait before it starts · {(anim.in.delay ?? 0).toFixed(2)} s
            </span>
            <input
              type="range"
              className="w-full accent-accent cursor-pointer"
              min={0}
              max={5}
              step={0.05}
              value={anim.in.delay ?? 0}
              onChange={(e) =>
                setStep('in', { ...anim.in!, delay: Number(e.target.value) })
              }
            />
          </label>
        )}
        <StepControls
          phase="out"
          step={anim.out ?? { preset: 'none', duration: 0, easing: 'in' }}
          onChange={(next) => {
            if (next.preset === 'none') return setStep('out', null);
            setStep('out', anim.out ? next : { ...defaultFor('out'), preset: next.preset });
          }}
        />
        {!anim.out && win?.end == null && !scene && (
          <p className="m-0 text-[0.72rem] text-faint">
            An exit needs an end to play against — give the element one above.
          </p>
        )}
      </div>
    </div>
  );
}
