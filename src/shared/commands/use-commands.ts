import { useEffect, useRef } from 'react';
import { commands, type CommandSpec } from './registry';

/**
 * Register a screen's commands while it is MOUNTED (`registry.ts`).
 *
 * The specs are read through a ref at call time, so a command's `run` and
 * `available` see this render's state without the registry being touched on
 * every render — only a change in the SET of ids registers again. That
 * matters: a re-registration on every slider step would tell every subscriber
 * (the bridge, the console) that the command list changed sixty times a
 * second.
 */
export function useRegisterCommands(owner: string, specs: readonly CommandSpec[]): void {
  const latest = useRef(specs);
  latest.current = specs;
  const ids = specs.map((s) => s.id).join('\n');
  useEffect(() => {
    const byId = (id: string) => latest.current.find((s) => s.id === id);
    const proxies: CommandSpec[] = ids
      .split('\n')
      .filter(Boolean)
      .map((id) => {
        const first = byId(id);
        return {
          id,
          get title() {
            return byId(id)?.title ?? first?.title ?? id;
          },
          get description() {
            return byId(id)?.description ?? first?.description ?? '';
          },
          get params() {
            return byId(id)?.params ?? first?.params;
          },
          available: () => {
            const s = byId(id);
            if (!s) return 'this screen no longer offers it';
            return s.available ? s.available() : true;
          },
          run: (params) => {
            const s = byId(id);
            if (!s) throw new Error('this screen no longer offers it');
            return s.run(params);
          },
        };
      });
    return commands.register(owner, proxies);
  }, [owner, ids]);
}
