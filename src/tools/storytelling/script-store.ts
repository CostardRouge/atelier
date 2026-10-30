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
  try {
    if (script) localStorage.setItem(KEY, JSON.stringify(script));
    else localStorage.removeItem(KEY);
  } catch {
    // A full or blocked storage keeps the script for this tab only.
  }
}
