/**
 * The one row every opener draws about its length against the slide's
 * (`slide-timing.ts`, rule D): nothing while the slide follows the opener or
 * holds it whole; when a SET slide is shorter, the switch that fits the
 * opener into it, saying what the fit does — or why the floor refuses it —
 * and, off, that the end is cut and where the slide's own length is set.
 * The red sentence each panel used to carry, which named the problem far
 * from any control, is this.
 */

import { SwitchRow } from '../../ui/Inspector';
import { fitRefusal, fitScale } from '../slide-timing';

interface FitRowProps {
  /** What the opener takes on its own. */
  seconds: number;
  /** The slide's length, as `HookContext.screenSeconds` gives it: undefined under Auto. */
  screenSeconds: number | undefined;
  /** The opener's shortest beat, for the floor. */
  shortestBeat: number;
  fit: boolean;
  onChange: (fit: boolean) => void;
}

export function FitRow({ seconds, screenSeconds, shortestBeat, fit, onChange }: FitRowProps) {
  if (screenSeconds === undefined || !(seconds > screenSeconds + 1e-6)) {
    // Still offered while on, so it can be turned off; silent otherwise.
    if (!fit || screenSeconds === undefined) return null;
    return (
      <SwitchRow
        label="Fit to the slide"
        name="Fit to the slide"
        checked={fit}
        onChange={onChange}
        hint="Nothing to fit for now: the slide is long enough. Kept on, so a longer run still fits the slide."
      />
    );
  }
  const scale = fitScale(seconds, screenSeconds);
  const refused = fitRefusal(scale, shortestBeat);
  const text = fit
    ? refused ?? `Fitted: ${seconds.toFixed(1)} s run in ${screenSeconds.toFixed(1)} s, every beat ${Math.round(scale * 100)}% of its length. Follows the slide’s length when it changes.`
    : `${seconds.toFixed(1)} s on its own, ${screenSeconds.toFixed(1)} s on screen — the end is cut. Fit it here, or give the slide the opener’s length under Content → On screen.`;
  const warn = !fit || Boolean(refused);
  return (
    <SwitchRow
      label="Fit to the slide"
      name="Fit to the slide"
      checked={fit}
      onChange={onChange}
      hint={<span className={warn ? 'text-accent-ink' : undefined}>{text}</span>}
      hintShown
    />
  );
}
