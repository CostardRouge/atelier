import { commands, type CommandInfo } from './registry';

/** What the page hands the console, a test driver or a browser automation. */
export interface AtelierConsole {
  /** Every command open right now, with its parameters and availability. */
  commands: () => CommandInfo[];
  /** Run one through the same door the agent bridge uses. */
  run: (id: string, params?: unknown) => Promise<unknown>;
}

declare global {
  interface Window {
    atelier?: AtelierConsole;
  }
}

/**
 * `window.atelier` — the registry from the browser's own console, Playwright
 * or a bookmarklet: `await atelier.run('develop.set', { values: { exposure: 0.5 } })`.
 * It grants nothing a script on the page could not already do; it only gives
 * that script the same named, checked, undoable door an agent gets.
 */
export function installCommandConsole(): void {
  window.atelier = {
    commands: () => commands.list(),
    run: (id, params) => commands.execute(id, params),
  };
}
