import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkParams, type CommandSpec } from '../registry';
import { winnowCommands } from '../../sources/winnow/winnow-commands';
import { winnowTimeCommands } from '../../sources/winnow/winnow-time-commands';
import { AGENT_SCREENS, screenOfCommand } from './registry';
import { SHEETS, STATS } from './fixtures';

/** Every `.ts` / `.tsx` source under `src`, read once. */
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(readFileSync(path, 'utf8'));
  }
  return out;
}
const SRC = sources(new URL('../../..', import.meta.url).pathname).join('\n');

/** The specs that can be built here with no screen mounted — enough to check their cases' params. */
const deps = { winnow: () => ({ client: null, connection: null }), sheet: async () => ({ kind: 'image' as const, mimeType: 'image/jpeg' as const, data: '', width: 1, height: 1 }) };
const SPECS = new Map<string, CommandSpec>([...winnowCommands(deps), ...winnowTimeCommands(deps)].map((s) => [s.id, s]));

describe('the agent’s screens', () => {
  it('have unique ids, and cases that are unique, ordinary and edge alike', () => {
    expect(new Set(AGENT_SCREENS.map((s) => s.id)).size).toBe(AGENT_SCREENS.length);
    for (const s of AGENT_SCREENS) {
      expect(new Set(s.cases.map((c) => c.id)).size).toBe(s.cases.length);
      expect(s.cases.some((c) => !c.edge)).toBe(true);
      expect(s.cases.some((c) => c.edge)).toBe(true);
      if (s.widths) expect(s.widths).toContain(s.width);
    }
  });

  it('name commands that exist, and each case shows one of them', () => {
    for (const s of AGENT_SCREENS) {
      for (const id of s.commands) expect([s.id, id, SRC.includes(`id: '${id}'`)]).toEqual([s.id, id, true]);
      for (const c of s.cases) expect(s.commands).toContain(c.example.command);
    }
  });

  it('give example params the command accepts, where its spec can be built here', () => {
    for (const s of AGENT_SCREENS) {
      for (const c of s.cases) {
        const spec = SPECS.get(c.example.command);
        if (spec) expect(() => checkParams(spec.params, c.example.params)).not.toThrow();
      }
    }
  });

  it('point at fixtures that exist, a sheet for a sheet and a sum-up for a card', () => {
    for (const s of AGENT_SCREENS) {
      for (const c of s.cases) {
        expect(c.fixture.kind).toBe(s.id === 'contact-sheet' ? 'sheet' : 'stats');
        expect(c.fixture.kind === 'sheet' ? c.fixture.id in SHEETS : c.fixture.id in STATS).toBe(true);
      }
    }
  });

  it('tells which screen draws a command’s image', () => {
    expect(screenOfCommand('winnow.statsSheet')?.id).toBe('stats-card');
    expect(screenOfCommand('develop.compare')?.id).toBe('contact-sheet');
    expect(screenOfCommand('develop.snapshot')).toBeNull();
  });
});
