import { useEffect, useState, useSyncExternalStore } from 'react';
import { signature, versionWhen, WHY_LABEL, type ScriptVersion } from '../../shared/story/script-versions';
import type { StoryScript } from '../../shared/story/story-script';
import Button from '../../shared/ui/Button';
import { keepVersion, loadVersions, subscribeVersions, versionsNow } from './version-store';

/** Put a version back: the script it replaces is kept first, so a restore is undone by another. */
export function restoreVersion(current: StoryScript | null, v: ScriptVersion, onScript: (s: StoryScript) => void): void {
  if (current) void keepVersion(current, 'replaced');
  onScript(v.script);
  void keepVersion(v.script, 'restored');
}

/**
 * The script's last versions on this device (`script-versions.ts`), newest
 * first, the one shown now marked: a click puts one back. Folded to three
 * until asked, so the Script panel stays short.
 */
export default function ScriptVersions({ script, onScript }: { script: StoryScript | null; onScript: (s: StoryScript) => void }) {
  const list = useSyncExternalStore(subscribeVersions, versionsNow);
  useEffect(loadVersions, []);
  const [all, setAll] = useState(false);
  // Re-read « 3 min ago » now and then while the panel is up.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  if (!list.length) return null;
  const json = script ? JSON.stringify(script) : null;
  const current = json ? { sig: signature(json), bytes: json.length } : null;
  const shown = all ? list : list.slice(0, 3);
  // The newest version alike the script shown is « shown »; an older one alike has nothing to put back.
  const nowAt = current ? list.findIndex((v) => v.sig === current.sig && v.bytes === current.bytes) : -1;
  return (
    <div className="flex flex-col gap-1">
      <p className="m-0 font-mono text-3xs uppercase tracking-[0.12em] text-muted">Versions on this device</p>
      <ul className="m-0 p-0 list-none flex flex-col gap-1">
        {shown.map((v, i) => {
          const same = current !== null && v.sig === current.sig && v.bytes === current.bytes;
          const isNow = i === nowAt;
          return (
            <li key={`${v.opened}:${v.sig}`} className="flex items-center gap-2 min-h-8">
              <span className="flex-1 min-w-0 text-2xs leading-snug">
                <span className={isNow ? 'text-ink font-semibold' : 'text-ink-soft'}>{versionWhen(v.at, now)}</span>
                <span className="text-muted">
                  {' '}
                  · {v.series} · {v.posts} post{v.posts === 1 ? '' : 's'} · {WHY_LABEL[v.why]}
                </span>
              </span>
              {same ? (
                <span className="font-mono text-3xs text-muted px-1.5">{isNow ? 'shown' : 'same'}</span>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => restoreVersion(script, v, onScript)} title="Put this version back; the one shown now is kept as a version">
                  Restore
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {list.length > 3 ? (
        <button type="button" className="self-start text-2xs text-accent cursor-pointer hover:underline" onClick={() => setAll((a) => !a)}>
          {all ? 'Fewer' : `All ${list.length} versions`}
        </button>
      ) : null}
    </div>
  );
}
