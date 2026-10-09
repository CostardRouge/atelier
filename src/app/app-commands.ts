import { CommandError, commands, waitForCommand, type CommandSpec } from '../shared/commands/registry';
import { navigate } from './use-hash-route';
import { TOOLS, toolForPath } from './tools';

/** How long `app.waitFor` may wait at most: a RAW decode on a phone, not a hang. */
const MAX_WAIT_MS = 120_000;

/** What the screen at `path` is, in one word an agent can branch on. */
function screenOf(path: string): string {
  if (path === '/sources' || path.startsWith('/sources?') || path === '/connect' || path.startsWith('/connect?')) return 'sources';
  return toolForPath(path)?.id ?? 'home';
}

/**
 * The SHELL's commands (`shared/commands/registry.ts`): where the suite is,
 * which tools exist, going somewhere, and waiting for a screen's own commands
 * to open. Registered by `App` for the whole session; every tool adds its own
 * while it is mounted.
 */
export function appCommands(path: string): CommandSpec[] {
  return [
    {
      id: 'app.status',
      title: 'Where the suite is',
      description:
        'The current route, the screen it shows (a tool id, "home" or "sources"), every tool with its route, and how many commands are open right now. Start here.',
      run: () => ({
        route: path,
        screen: screenOf(path),
        tools: TOOLS.map((t) => ({ id: t.id, label: t.label, path: t.path })),
        openCommands: commands.list().length,
      }),
    },
    {
      id: 'app.navigate',
      title: 'Go to a route',
      description:
        'Open a route of the suite, e.g. "/develop/home", "/develop/<roll>/<picture>", "/roadtrip/home", "/sources". The tool then registers its own commands — wait for one with app.waitFor before calling it.',
      params: {
        path: { type: 'string', description: 'A route path starting with "/" — the hash without "#".' },
        replace: { type: 'boolean', description: 'Replace the history entry instead of adding one.', optional: true },
      },
      run: (p) => {
        const to = p.path as string;
        if (!to.startsWith('/') || to.startsWith('//')) throw new CommandError('invalid', 'path must start with a single "/"');
        navigate(to, { replace: p.replace === true });
        return { route: to, screen: screenOf(to) };
      },
    },
    {
      id: 'app.waitFor',
      title: 'Wait for a command',
      description:
        'Resolve once a command is open AND available (a tool loaded, a roll read, a picture decoded), or fail after the timeout with what stood in the way.',
      params: {
        command: { type: 'string', description: 'The command id to wait for, e.g. "develop.set".' },
        timeoutMs: { type: 'number', description: `At most this long; default 15000, at most ${MAX_WAIT_MS}.`, min: 0, max: MAX_WAIT_MS, optional: true },
      },
      run: async (p) => {
        const id = p.command as string;
        await waitForCommand(commands, id, typeof p.timeoutMs === 'number' ? p.timeoutMs : 15_000);
        return { command: id, available: true };
      },
    },
  ];
}
