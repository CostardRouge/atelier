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
import Button from '../ui/Button';
import { FieldRow, NumberField, RangeField, SelectField, ToggleField } from '../ui/Inspector';

interface TimingPanelProps {
  element: OverlayElement;
  /** The scene the element belongs to, if any — its window is relative to it. */
  scene: Scene | null;
  /** Playhead position, in seconds from the first exported frame. */
  playhead: number;
  onChange: (patch: Partial<OverlayElement>) => void;
}

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
    <>
      <FieldRow label={phase === 'in' ? 'Entrance' : 'Exit'}>
        <SelectField
          label={phase === 'in' ? 'Entrance' : 'Exit'}
          value={step.preset}
          onChange={(preset) => onChange({ ...step, preset })}
          options={PRESETS.map((p) => ({ id: p.value, label: p.label }))}
        />
      </FieldRow>
      {animated && (
        <>
          <FieldRow label="Duration">
            <RangeField
              label={`${phase === 'in' ? 'Entrance' : 'Exit'} duration`}
              min={0.05}
              max={3}
              step={0.05}
              value={step.duration}
              onChange={(duration) => onChange({ ...step, duration })}
              format={(v) => `${v.toFixed(2)} s`}
            />
          </FieldRow>
          <FieldRow label="Curve">
            <SelectField
              label="Curve"
              value={step.easing}
              onChange={(easing) => onChange({ ...step, easing })}
              options={EASINGS.map((c) => ({ id: c.value, label: c.label }))}
            />
          </FieldRow>
          {step.preset === 'slide' && (
            <>
              <FieldRow label="Direction">
                <SelectField
                  label="Direction"
                  value={step.direction ?? 'up'}
                  onChange={(direction) => onChange({ ...step, direction })}
                  options={DIRECTIONS.map((d) => ({ id: d.value, label: d.label }))}
                />
              </FieldRow>
              <FieldRow label="Travel">
                <RangeField
                  label="Travel"
                  min={0.01}
                  max={0.4}
                  step={0.01}
                  value={step.distanceFrac ?? 0.06}
                  onChange={(distanceFrac) => onChange({ ...step, distanceFrac })}
                  format={(v) => `${Math.round(v * 100)}%`}
                />
              </FieldRow>
            </>
          )}
          {step.preset === 'scale' && (
            <FieldRow label={phase === 'in' ? 'From' : 'To'}>
              <RangeField
                label={phase === 'in' ? 'Scale from' : 'Scale to'}
                min={0.2}
                max={2}
                step={0.02}
                value={step.scaleFrom ?? 0.86}
                onChange={(scaleFrom) => onChange({ ...step, scaleFrom })}
                format={(v) => `${Math.round(v * 100)}%`}
              />
            </FieldRow>
          )}
        </>
      )}
    </>
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
    <div className="flex flex-col gap-2.5">
      <p className="m-0 text-xs text-muted">
        {scene ? (
          <>
            In <strong className="font-semibold text-ink">{scene.name}</strong> — times count from
            the scene's start ({scene.start.toFixed(1)} s), and it leaves with the scene at{' '}
            {scene.end.toFixed(1)} s at the latest.
          </>
        ) : (
          "Times count from the clip's in point — the first frame an export keeps."
        )}
      </p>
      {scene && (
        <FieldRow label="Scene">
          <Button size="sm" variant="ghost" onClick={() => onChange({ sceneId: undefined })}>
            Take it out
          </Button>
        </FieldRow>
      )}

      <FieldRow label="Window">
        <ToggleField
          label="Give it a window"
          checked={timed}
          onChange={(on) =>
            onChange({ window: on ? { start: 0, end: scene ? null : 3 } : undefined })
          }
        >
          {timed ? 'Timed' : 'The whole clip'}
        </ToggleField>
      </FieldRow>
      {timed && (
        <>
          <FieldRow label="Appears">
            <NumberField
              label="Appears"
              min={0}
              step={0.1}
              unit="s"
              value={win.start}
              onChange={(v) => setWindow({ start: Math.max(0, v) })}
            />
            <Button size="sm" variant="ghost" onClick={() => setWindow({ start: Number(local.toFixed(2)) })}>
              Playhead
            </Button>
          </FieldRow>
          <FieldRow label="Disappears">
            <NumberField
              label="Disappears"
              min={0}
              step={0.1}
              unit="s"
              placeholder={scene ? 'with the scene' : 'end of clip'}
              value={win.end}
              onChange={(v) => setWindow({ end: v })}
              onClear={() => setWindow({ end: null })}
            />
            <Button size="sm" variant="ghost" onClick={() => setWindow({ end: Number(local.toFixed(2)) })}>
              Playhead
            </Button>
          </FieldRow>
        </>
      )}

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
        <FieldRow label="Wait">
          <RangeField
            label="Wait before it starts"
            min={0}
            max={5}
            step={0.05}
            value={anim.in.delay ?? 0}
            onChange={(delay) => setStep('in', { ...anim.in!, delay })}
            format={(v) => `${v.toFixed(2)} s`}
          />
        </FieldRow>
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
        <p className="m-0 text-xs text-muted">
          An exit needs an end to play against — give the element a window above.
        </p>
      )}
    </div>
  );
}
