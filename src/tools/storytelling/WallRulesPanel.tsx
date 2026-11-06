import { useMemo } from 'react';
import type { WallPick } from '../../shared/story/story-facts';
import type { StoryScript } from '../../shared/story/story-script';
import { withWallRules } from '../../shared/story/sources';
import { pickWall, type WallCandidate, type WallRules } from '../../shared/story/wall-pick';
import PictureRulesFields from '../../shared/ui/PictureRulesFields';
import Segmented from '../../shared/ui/Segmented';

/**
 * The rules a wall is chosen by (`wall-pick.ts`), set in the series' Sources:
 * what to leave out, what the places are spread across and how, and the
 * preferences in order (↑ ↓, a box to turn one off). With the series'
 * pictures read this visit (`kept`), a change re-chooses the wall at once;
 * otherwise the next counting does. A wall FROZEN by his corrections
 * (`wall-correct.ts`) stays as he left it whatever the rules, until «Let the
 * rules choose again».
 */
export default function WallRulesPanel({
  script,
  onScript,
  rules,
  places,
  kept,
  pins,
  removed,
  frozen,
}: {
  script: StoryScript;
  onScript: (s: StoryScript) => void;
  rules: WallRules;
  places: number;
  kept: readonly WallCandidate[] | null;
  pins: readonly number[];
  removed: readonly number[];
  frozen: boolean;
}) {
  const outcome = useMemo(() => (kept ? pickWall(kept, rules, places, { pins, removed }) : null), [kept, rules, places, pins, removed]);
  const chosenBy = (next: WallRules): WallPick[] | null => (kept ? pickWall(kept, next, places, { pins, removed }).picks.map((p) => ({ id: p.id, day: p.day })) : null);
  // Frozen, a rule changed reshuffles nothing: it is what the rules read when they choose again.
  const write = (next: WallRules) => onScript(withWallRules(script, { rules: next }, frozen ? null : chosenBy(next)));

  return (
    <div className="flex flex-col gap-2.5 rounded-control border border-line bg-paper p-2.5">
      <p className="m-0 text-2xs text-muted leading-snug">
        {outcome
          ? `${outcome.picks.length} on the wall, from ${outcome.pool.toLocaleString('en-GB')} pictures over ${outcome.groups} ${rules.unit === 'folder' ? 'folders' : rules.unit === 'week' ? 'weeks' : 'days'}.`
          : 'Count to read the pictures these rules choose from.'}
      </p>
      {frozen ? (
        <p className="m-0 text-2xs text-muted leading-snug">
          Your corrections froze the wall.{' '}
          <button
            type="button"
            onClick={() => onScript(withWallRules(script, { order: null }, chosenBy(rules)))}
            title="The rules choose again; your pins stay and the pictures you removed stay out"
            className="text-accent-ink underline-offset-2 hover:underline"
          >
            Let the rules choose again
          </button>
        </p>
      ) : null}
      {/* The shared conditions (leave out, prefer) — Recap draws the same panel. */}
      <PictureRulesFields
        rules={rules}
        onRules={(next) => write({ ...rules, leave: next.leave, prefer: next.prefer })}
        counts={outcome?.left ?? null}
        between={
          <div className="flex flex-col gap-1">
            <span className="font-mono text-3xs uppercase tracking-[0.12em] text-muted">Spread across</span>
            <Segmented<WallRules['unit']>
              options={[
                { id: 'day', label: 'Days' },
                { id: 'folder', label: 'Folders' },
                { id: 'week', label: 'Weeks' },
              ]}
              value={rules.unit}
              onChange={(unit) => write({ ...rules, unit })}
              size="sm"
              fill
              label="What the places are spread across"
            />
            <Segmented<WallRules['share']>
              options={[
                { id: 'even', label: 'The same each', title: 'Every group the same number of places' },
                { id: 'busy', label: 'More on busy ones', title: 'A busy group gets more, at most three times a quiet one' },
              ]}
              value={rules.share}
              onChange={(share) => write({ ...rules, share })}
              size="sm"
              fill
              label="How many each gets"
            />
          </div>
        }
      />
    </div>
  );
}
