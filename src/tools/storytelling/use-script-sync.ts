import { useEffect, useRef } from 'react';
import { shouldFlush } from '../../shared/sources/doc-sync';
import type { StoryScript } from '../../shared/story/story-script';
import { pushScript, reduceRecord, resumeScript, scriptRemoteFor, syncRecordOf } from './script-sync';
import { keepVersion } from './version-store';

/** How often a dirty record is looked at; the push itself waits `REMOTE_IDLE_MS` after the last edit. */
const TICK_MS = 1000;

/**
 * Keep the script in step with its copy on a Winnow (`script-sync.ts`), the
 * way a trip is: on open and whenever the page comes back into view, ask
 * whether it moved there (a newer copy over a clean mirror is taken, the one
 * it replaces kept as a version; both moved is a conflict the Script panel
 * offers to settle); every edit marks the record dirty, and once the edits
 * pause it is pushed, guarded by its etag. A script never kept is left alone.
 */
export function useScriptSync(script: StoryScript | null, apply: (s: StoryScript) => void, canWrite: () => boolean): void {
  const latest = useRef(script);
  latest.current = script;
  // What came from the Winnow is not an edit; what the page opened on neither.
  const taken = useRef<StoryScript | null>(null);
  const seen = useRef<StoryScript | null>(script);
  const applyRef = useRef(apply);
  applyRef.current = apply;

  const id = script?.id;
  useEffect(() => {
    if (!id) return;
    let alive = true;
    const resume = async () => {
      const rec = syncRecordOf(id);
      const remote = rec ? scriptRemoteFor(rec.sourceId) : null;
      if (!rec || !remote || rec.status === 'saving' || !canWrite()) return;
      const take = await resumeScript(remote, id);
      if (!alive || !take || latest.current?.id !== id) return;
      if (latest.current) void keepVersion(latest.current, 'replaced');
      taken.current = take;
      applyRef.current(take);
      void keepVersion(take, 'from-winnow');
    };
    void resume();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void resume();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [id, canWrite]);

  // Every other change of the script is an edit of the kept series.
  useEffect(() => {
    if (!script?.id || script === seen.current) return;
    const prev = seen.current;
    seen.current = script;
    // Another series, or this one just given its id to be kept: not an edit of what is kept.
    if (script === taken.current || prev?.id !== script.id) return;
    if (syncRecordOf(script.id)) reduceRecord(script.id, { type: 'edited', now: Date.now() });
  }, [script]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const s = latest.current;
      const rec = syncRecordOf(s?.id);
      if (!s || !rec || !shouldFlush(rec, Date.now()) || !canWrite()) return;
      const remote = scriptRemoteFor(rec.sourceId);
      if (remote) void pushScript(remote, s);
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [canWrite]);
}
