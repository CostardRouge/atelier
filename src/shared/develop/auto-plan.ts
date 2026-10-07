/**
 * The PLAN behind the one `Auto` switch — which automatic verbs it runs, in
 * which order, and whether an untouched photograph gets it the first time it
 * opens. A DEVICE choice (Develop's settings → Automatic), never on a roll,
 * a preset or a paste: Lightroom's one Auto button is a fixed recipe; here
 * the recipe is the author's, since a white balance is wrong on a sunset and
 * a levelled horizon is wrong on a composition — each step is a verb he can
 * leave out.
 *
 * Every step is one of the suite's own switches (`auto-slots.ts`,
 * `value-switch.ts`, the Crop tab's), run in turn by `use-auto-all.ts`; the
 * `Auto` switch's own state is read off theirs. Pure and DOM-free.
 */

import type { AutoState } from './auto-slots';
import { localPref } from '../ui/local-pref';

/** The verbs `Auto` may run, in the order it runs them. */
export type AutoStep = 'tone' | 'colour' | 'bands' | 'detail' | 'level' | 'upright';

export const AUTO_STEPS: readonly { id: AutoStep; label: string; hint: string }[] = [
  { id: 'tone', label: 'Tone', hint: 'A black point, a white point and a gamma, as levels' },
  { id: 'colour', label: 'Colour', hint: 'The average cast neutralised — wrong on a sunset, so off by default' },
  { id: 'bands', label: 'Bands', hint: 'Shadows lifted and highlights pulled where the picture leans' },
  { id: 'detail', label: 'Detail', hint: 'Noise reduction from the ISO, sharpening from what the picture is developed from' },
  { id: 'level', label: 'Level', hint: 'The horizon straightened — a tilted composition is tilted on purpose, so off by default' },
  { id: 'upright', label: 'Upright', hint: 'Converging verticals and horizontals stood up, the zoom hiding the corners' },
];

export interface AutoPlan {
  /** The steps `Auto` runs, in `AUTO_STEPS`' order. */
  steps: AutoStep[];
  /** An untouched photograph is auto-developed the first time it opens. */
  onOpen: boolean;
}

/**
 * What runs until the author says otherwise: the three that are almost
 * always an improvement. Colour, level and upright each have a picture they
 * are exactly wrong on, so they wait for a tick.
 */
export const DEFAULT_AUTO_PLAN: Readonly<AutoPlan> = Object.freeze({ steps: ['tone', 'bands', 'detail'] as AutoStep[], onOpen: false });

const STEP_IDS: ReadonlySet<string> = new Set(AUTO_STEPS.map((s) => s.id));

/** A stored plan read back safely, its steps in the canonical order; junk is the default. */
export function readAutoPlan(raw: unknown): AutoPlan {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_AUTO_PLAN, steps: [...DEFAULT_AUTO_PLAN.steps] };
  const r = raw as Record<string, unknown>;
  const wanted = new Set(Array.isArray(r.steps) ? r.steps.filter((s): s is AutoStep => typeof s === 'string' && STEP_IDS.has(s)) : DEFAULT_AUTO_PLAN.steps);
  return {
    steps: AUTO_STEPS.map((s) => s.id).filter((id) => wanted.has(id)),
    onOpen: r.onOpen === true,
  };
}

export const autoPlanPref = localPref<AutoPlan>(
  'atelier.develop.auto',
  (raw) => {
    if (!raw) return readAutoPlan(null);
    try {
      return readAutoPlan(JSON.parse(raw));
    } catch {
      return readAutoPlan(null);
    }
  },
  (plan) => JSON.stringify(plan),
);

/** The plan with one step ticked or unticked, the order kept. */
export function withStep(plan: AutoPlan, step: AutoStep, on: boolean): AutoPlan {
  const wanted = new Set(plan.steps);
  if (on) wanted.add(step);
  else wanted.delete(step);
  return { ...plan, steps: AUTO_STEPS.map((s) => s.id).filter((id) => wanted.has(id)) };
}

/**
 * What the one `Auto` switch shows over its steps' switches: off while every
 * step is off; on while every step that ran still holds (a step that found
 * nothing counts as holding); nothing when every step found nothing; edited
 * when a hand moved one of them since, or only some are on.
 */
export function allState(states: readonly AutoState[]): AutoState {
  if (states.length === 0) return 'off';
  if (states.every((s) => s === 'off')) return 'off';
  if (states.every((s) => s === 'nothing')) return 'nothing';
  if (states.every((s) => s === 'on' || s === 'nothing')) return 'on';
  return 'edited';
}

/** `tone, bands and detail` — for the hint and the settings' line. */
export function describeSteps(steps: readonly AutoStep[]): string {
  const labels = AUTO_STEPS.filter((s) => steps.includes(s.id)).map((s) => s.label.toLowerCase());
  if (labels.length === 0) return 'nothing';
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}
