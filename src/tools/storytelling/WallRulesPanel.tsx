import { useMemo } from 'react';
import type { WallPick } from '../../shared/story/story-facts';
import type { StoryScript } from '../../shared/story/story-script';
import { withWallRules } from '../../shared/story/sources';
import { LEAVE_KEYS, PREFER_KEYS, PREFER_LABEL, pickWall, type LeaveKey, type PreferKey, type WallCandidate, type WallRules } from '../../shared/story/wall-pick';
import Segmented from '../../shared/ui/Segmented';
import IconButton from '../../shared/ui/IconButton';
import { Icons } from '../../shared/ui/icons';

const LEAVE_LABEL: Record<LeaveKey, string> = {
  reject: 'Rejected in Winnow',
  screen: 'Screenshots and saved images',
  burst: 'All but the best of a burst',
  alike: 'Look-alikes a few minutes apart',
};
const LEAVE_TITLE: Record<LeaveKey, string> = {
  reject: 'Your verdict in Winnow',
  screen: 'No camera named them, or a PNG',
  burst: 'The bursts Winnow already grouped: the best one stays',
  alike: "Winnow's image fingerprint, in the same folder, ten minutes apart at most — where Winnow has one",
};

/**
 * The rules a wall is chosen by (`wall-pick.ts`), set in the series' Sources:
 * what to leave out, what the places are spread across and how, and the
 * preferences in order (↑ ↓, a box to turn one off). With the series'
 * pictures read this visit (`kept`), a change re-chooses the wall at once;
 * otherwise the next counting does.
 */
export default function WallRulesPanel({
  script,
  onScript,
  rules,
  places,
  kept,
  pins,
  removed,
}: {
  script: StoryScript;
  onScript: (s: StoryScript) => void;
  rules: WallRules;
  places: number;
  kept: readonly WallCandidate[] | null;
  pins: readonly number[];
  removed: readonly number[];
}) {
  const outcome = useMemo(() => (kept ? pickWall(kept, rules, places, { pins, removed }) : null), [kept, rules, places, pins, removed]);
  const write = (next: WallRules) => {
    const picks: WallPick[] | null = kept ? pickWall(kept, next, places, { pins, removed }).picks.map((p) => ({ id: p.id, day: p.day })) : null;
    onScript(withWallRules(script, { rules: next }, picks));
  };
  const order = [...rules.prefer, ...PREFER_KEYS.filter((k) => !rules.prefer.includes(k))];
  const move = (k: PreferKey, by: -1 | 1) => {
    const on = rules.prefer.slice();
    const i = on.indexOf(k);
    const j = i + by;
    if (i < 0 || j < 0 || j >= on.length) return;
    [on[i], on[j]] = [on[j], on[i]];
    write({ ...rules, prefer: on });
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-control border border-line bg-paper p-2.5">
      <p className="m-0 text-2xs text-muted leading-snug">
        {outcome
          ? `${outcome.picks.length} on the wall, from ${outcome.pool.toLocaleString('en-GB')} pictures over ${outcome.groups} ${rules.unit === 'folder' ? 'folders' : rules.unit === 'week' ? 'weeks' : 'days'}.`
          : 'Count to read the pictures these rules choose from.'}
      </p>
      <div className="flex flex-col gap-1">
        <span className="font-mono text-3xs uppercase tracking-[0.12em] text-muted">Leave out</span>
        {LEAVE_KEYS.map((k) => (
          <label key={k} className="flex items-center gap-2 text-xs text-ink-soft cursor-pointer" title={LEAVE_TITLE[k]}>
            <input
              type="checkbox"
              checked={rules.leave[k] !== false}
              onChange={(e) => write({ ...rules, leave: { ...rules.leave, [k]: e.target.checked ? undefined : false } })}
            />
            <span className="flex-1 min-w-0 truncate">{LEAVE_LABEL[k]}</span>
            {outcome && rules.leave[k] !== false ? <span className="font-mono text-3xs text-muted tabular-nums">−{outcome.left[k]}</span> : null}
          </label>
        ))}
      </div>
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
      <div className="flex flex-col gap-1">
        <span className="font-mono text-3xs uppercase tracking-[0.12em] text-muted">Prefer, in this order</span>
        <ol className="m-0 p-0 list-none flex flex-col gap-1" aria-label="Preferences, the first deciding">
          {order.map((k) => {
            const i = rules.prefer.indexOf(k);
            const on = i >= 0;
            return (
              <li key={k} className={`flex items-center gap-2 rounded-control border border-line bg-surface pl-2 pr-1 min-h-9 ${on ? '' : 'opacity-55'}`}>
                <span className="w-4 font-mono text-2xs text-muted text-right">{on ? i + 1 : '–'}</span>
                <label className="flex-1 min-w-0 flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => write({ ...rules, prefer: e.target.checked ? [...rules.prefer, k] : rules.prefer.filter((x) => x !== k) })}
                  />
                  <span className="truncate">{PREFER_LABEL[k]}</span>
                </label>
                <IconButton label={`Prefer ${PREFER_LABEL[k]} sooner`} size="sm" variant="ghost" disabled={!on || i === 0} onClick={() => move(k, -1)}>
                  {Icons.up}
                </IconButton>
                <IconButton label={`Prefer ${PREFER_LABEL[k]} later`} size="sm" variant="ghost" disabled={!on || i === rules.prefer.length - 1} onClick={() => move(k, 1)}>
                  {Icons.down}
                </IconButton>
              </li>
            );
          })}
        </ol>
        <p className="m-0 text-3xs text-faint leading-snug">The first decides; the next breaks its ties. A rule Winnow has no fact for a picture on simply does not count for it.</p>
      </div>
    </div>
  );
}
