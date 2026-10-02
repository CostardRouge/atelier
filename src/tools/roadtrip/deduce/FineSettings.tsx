import Button from '../../../shared/ui/Button';
import Segmented from '../../../shared/ui/Segmented';
import { legend, note } from './pieces';
import { settingsChanged, type DeduceSettings } from './settings';
import type { DeduceActions } from './context';

/**
 * The thresholds, folded under one summary line — the maintainer's call
 * (2026-10-01): they are settings, live, and out of the way. The grain is
 * the slider's and not listed here; `nameByRegion` is, because it is a
 * decision about the stages' NAMES and not about where they are cut.
 */

interface FineSettingsProps {
  settings: DeduceSettings;
  actions: DeduceActions;
}

function Range({
  label,
  value,
  unit,
  min,
  max,
  step,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step: number;
  hint: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-baseline justify-between gap-3">
        <span className={legend}>{label}</span>
        <span className="font-mono text-xs text-accent-ink tabular-nums">
          {value} {unit}
        </span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-accent" />
      <span className={note}>{hint}</span>
    </label>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex items-start gap-2.5 cursor-pointer">
      <input type="checkbox" className="mt-[3px] w-[15px] h-[15px] accent-ink flex-none" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0">
        <span className="block text-sm">{label}</span>
        <span className={note}>{hint}</span>
      </span>
    </label>
  );
}

export default function FineSettings({ settings: s, actions }: FineSettingsProps) {
  const changed = settingsChanged(s);
  return (
    <details className="group rounded-paper border border-line bg-paper px-3 py-2.5">
      <summary className="flex flex-wrap items-baseline gap-x-3 gap-y-1 cursor-pointer list-none text-sm text-ink-soft [&::-webkit-details-marker]:hidden">
        <span>
          <span className="text-muted mr-1 group-open:hidden">▸</span>
          <span className="text-muted mr-1 hidden group-open:inline">▾</span>
          Fine settings
        </span>
        {/* The values are inside; the line only says whether they are yours. */}
        {changed && <span className="font-mono text-2xs text-accent-ink">changed</span>}
      </summary>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] gap-x-5 gap-y-3.5 mt-3">
        <Range label="Radius of one halt" value={s.radiusKm} unit="km" min={5} max={120} step={5} hint="Two days this close are the same place. Beyond it, you drove." onChange={(v) => actions.setSettings({ radiusKm: v })} />
        <Range label="A long drive is" value={s.hopKm} unit="km" min={100} max={1000} step={50} hint="Only the Long drives grain reads it. Lower, more stages." onChange={(v) => actions.setSettings({ hopKm: v })} />
        <Range label="A big halt is" value={s.bigDays} unit="days" min={2} max={7} step={1} hint="Only the Big halts grain reads it; a shorter halt rides with the stage before." onChange={(v) => actions.setSettings({ bigDays: v })} />
        <Range label="A halt is at least" value={s.minNights} unit={s.minNights === 1 ? 'day' : 'days'} min={1} max={6} step={1} hint="Below that, a stop on the way — listed and marked, or folded in." onChange={(v) => actions.setSettings({ minNights: v })} />
        <div className="flex flex-col gap-1">
          <span className={legend}>Shorter than that</span>
          <Segmented
            fill
            size="sm"
            label="What to do with a short halt"
            value={s.shortLegs}
            onChange={(id) => actions.setSettings({ shortLegs: id })}
            options={[
              { id: 'list', label: 'List it', title: 'A halt of its own, marked' },
              { id: 'merge', label: 'Fold it in', title: 'Into the halt it was on the way to' },
            ]}
          />
        </div>
        <Toggle label="Cover a blind day inside a halt" hint="A day with no position between two days in one place stays in that place. Nothing is invented: a stage is a span." checked={s.bridgeBlind} onChange={(v) => actions.setSettings({ bridgeBlind: v })} />
        <Toggle label="Ignore a position far from its neighbours" hint="A single day more than 1 500 km from the days around it, which are close to each other. Kept, it becomes a halt of its own." checked={s.ignoreOutliers} onChange={(v) => actions.setSettings({ ignoreOutliers: v })} />
        <Toggle label="Invent the days of a move" hint="A guess between two places — off, and what it makes is marked." checked={s.interpolateMoves} onChange={(v) => actions.setSettings({ interpolateMoves: v })} />
        <Toggle label="Name every stage after its region" hint="Off, a stage is called by its route — Perth → Broome — and follows its places." checked={s.nameByRegion} onChange={(v) => actions.setSettings({ nameByRegion: v })} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
        <span className={`${note} basis-[14rem] grow`}>Remembered on this machine. The halts are found the way they always were; the grain only says how many go in one stage.</span>
        <Button size="sm" variant="ghost" disabled={!changed} onClick={actions.resetSettings}>
          Reset
        </Button>
      </div>
    </details>
  );
}
