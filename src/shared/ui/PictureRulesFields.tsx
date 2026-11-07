import type { ReactNode } from 'react';
import { LEAVE_KEYS, LEAVE_LABEL, LEAVE_TITLE, PREFER_KEYS, PREFER_LABEL, type LeaveKey, type PictureRules, type PreferKey } from '../sources/winnow/picture-rules';
import IconButton from './IconButton';
import { Icons } from './icons';

/**
 * The shared conditions' fields (`sources/winnow/picture-rules.ts`): what to
 * LEAVE OUT, a box each, with how many each one took out when the tool
 * knows; and what to PREFER, in order (↑ ↓, a box to turn one off). The
 * same panel in Storytelling's wall and in Recap — the tool around it says
 * what the pictures are for.
 */
export default function PictureRulesFields({
  rules,
  onRules,
  counts,
  leaveKeys = LEAVE_KEYS,
  between,
}: {
  rules: PictureRules;
  onRules: (next: PictureRules) => void;
  /** How many each leave-out took out, when known. */
  counts?: Partial<Record<LeaveKey, number>> | null;
  /** The leave-outs this tool offers (Recap's pool holds no rejected picture: Winnow's fill leaves them). */
  leaveKeys?: readonly LeaveKey[];
  /** The tool's own fields, drawn between the leave-outs and the preferences (the wall's «Spread across»). */
  between?: ReactNode;
}) {
  const order = [...rules.prefer, ...PREFER_KEYS.filter((k) => !rules.prefer.includes(k))];
  const move = (k: PreferKey, by: -1 | 1) => {
    const on = rules.prefer.slice();
    const i = on.indexOf(k);
    const j = i + by;
    if (i < 0 || j < 0 || j >= on.length) return;
    [on[i], on[j]] = [on[j], on[i]];
    onRules({ ...rules, prefer: on });
  };
  return (
    <>
      <div className="flex flex-col gap-1">
        <span className="font-mono text-3xs uppercase tracking-[0.12em] text-muted">Leave out</span>
        {leaveKeys.map((k) => (
          <label key={k} className="flex items-center gap-2 text-xs text-ink-soft cursor-pointer" title={LEAVE_TITLE[k]}>
            <input type="checkbox" checked={rules.leave[k] !== false} onChange={(e) => onRules({ ...rules, leave: { ...rules.leave, [k]: e.target.checked ? undefined : false } })} />
            <span className="flex-1 min-w-0 truncate">{LEAVE_LABEL[k]}</span>
            {counts && rules.leave[k] !== false && counts[k] !== undefined ? <span className="font-mono text-3xs text-muted tabular-nums">−{counts[k]}</span> : null}
          </label>
        ))}
      </div>
      {between}
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
                    onChange={(e) => {
                      const prefer = e.target.checked ? [...rules.prefer, k] : rules.prefer.filter((x) => x !== k);
                      // The ♥ off is said aloud: a list without it would otherwise read as one from before favourites.
                      const { favOff: _was, ...rest } = rules;
                      void _was;
                      onRules(k === 'fav' && !e.target.checked ? { ...rest, prefer, favOff: true } : k === 'fav' ? { ...rest, prefer } : { ...rules, prefer });
                    }}
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
    </>
  );
}
