import { parseScript, type StoryScript } from '../../shared/story/story-script';

/**
 * The one script the tool remembers, on this device: the words of the
 * author's posts, kept so a reload does not lose them. It is his own file,
 * loaded by his gesture; nothing sends it anywhere, and Forget clears it.
 */
const KEY = 'atelier.storytelling.script';

export function loadStoredScript(): StoryScript | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = parseScript(JSON.parse(raw));
    return parsed.ok ? parsed.script : null;
  } catch {
    return null;
  }
}

export function storeScript(script: StoryScript | null): void {
  window.clearTimeout(pending.timer);
  pending.script = undefined;
  write(script);
}

/** Told after every write: whether the browser kept it — a full or blocked storage keeps the script in this tab only. */
type StoredListener = (ok: boolean) => void;
const listeners = new Set<StoredListener>();
export function onScriptStored(fn: StoredListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function write(script: StoryScript | null): void {
  let ok = true;
  try {
    if (script) localStorage.setItem(KEY, JSON.stringify(script));
    else localStorage.removeItem(KEY);
  } catch {
    ok = false;
  }
  for (const fn of listeners) fn(ok);
}

/** Drop the write still waiting — another tab took the script, and what this one held never reaches the store. */
export function discardPendingScript(): void {
  window.clearTimeout(pending.timer);
  pending.script = undefined;
}

/**
 * The same, a moment later: the Studio changes the script on every step of a
 * slider, and the whole script — its wall's pool, its counted tiles — is
 * serialised on each write. The last version is written once the steps pause
 * (`STORE_AFTER_MS`), and at once when the page is hidden or closed.
 */
const STORE_AFTER_MS = 500;
const pending: { script: StoryScript | null | undefined; timer: number } = { script: undefined, timer: 0 };
export function storeScriptSoon(script: StoryScript | null): void {
  pending.script = script;
  window.clearTimeout(pending.timer);
  pending.timer = window.setTimeout(flushScript, STORE_AFTER_MS);
}
export function flushScript(): void {
  window.clearTimeout(pending.timer);
  if (pending.script === undefined) return;
  const s = pending.script;
  pending.script = undefined;
  write(s);
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushScript);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushScript();
  });
}
