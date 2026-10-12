/**
 * The agent BRIDGE's own version — v1, v2, v3… — the one number a person
 * reads to know which bridge runs on their computer and whether the site has
 * a newer one (his ask, 2026-10-11: every download looked the same, so Claude
 * Desktop offered to uninstall instead of to update).
 *
 * It counts changes to the BRIDGE only — `scripts/atelier-mcp.mjs` and
 * `mcp-protocol.ts`, what is installed on the computer. A new command in the
 * tab needs no new bridge: the tab lists its commands live.
 *
 * `BRIDGE_SOURCE_HASH` is the SHA-256 of those two files as this version
 * shipped them; `bridge-version.test.ts` recomputes it, so a change to the
 * bridge that forgets to bump the number fails CI and says what to write.
 *
 * Imports nothing: the bridge script reads it through Node's type stripping
 * (`mcp-protocol.ts`'s rule).
 */

export const BRIDGE_VERSION = 4;

/** SHA-256 of `scripts/atelier-mcp.mjs` + `src/shared/commands/mcp-protocol.ts`, line endings normalised. */
export const BRIDGE_SOURCE_HASH = 'bc2f63796591533e511a3b37f150eb19db4638b5c364975f3ee4569a9839f9ea';

/** What each version changed, newest first — drawn on `#/agents`. */
export const BRIDGE_CHANGES: readonly { version: number; date: string; changes: readonly string[] }[] = [
  {
    version: 4,
    date: '2026-10-12',
    changes: [
      'The instructions teach the dosing rule: a look is never left at 100 % — it lands at 40 % (a log conversion whole), develop.fitLook measures how far it may go, and the result is looked at before going further.',
      'They name the purchased packs, now open to the agent by name (never their files), and the saturation develop.measure reads.',
      'No change to the bridge’s wire: the same four tools, the same files.',
    ],
  },
  {
    version: 3,
    date: '2026-10-12',
    changes: [
      'The instructions teach Winnow’s own names: a body, a lens, a country, a region, a town or a place asked by the name Winnow holds (winnow.names lists them), filtered by Winnow, with no day needed.',
      'They teach the text read inside a picture (words, withText), and to ask the tab for pictures rather than files — every picture sent now shows under the Agent pill.',
      'No change to the bridge’s wire: the same four tools, the same files.',
    ],
  },
  {
    version: 2,
    date: '2026-10-11',
    changes: [
      'The instructions the agent reads at connection teach the second round: finding by shape, focal, aperture, ISO, exposure, height, place and colour; sorting (duplicates, misses) and curating a story; the sum-up; Develop in batch (match, rules, Auto on many); Trips from a day’s facts to a piece in one call, and the legs deduced by command.',
      'No change to the bridge’s wire: the same four tools, the same files. The commands themselves live in the tab and need no reinstall; this number only carries the new instructions.',
    ],
  },
  {
    version: 1,
    date: '2026-10-11',
    changes: [
      'The first numbered bridge: from here on, a new number is offered by Claude Desktop as an Update.',
      'Four tools — status, commands (by family), run, and batch (several commands in one call).',
      'Claude Desktop and Claude Code at once: the second bridge follows the first.',
      'Exports land in ~/Pictures/Atelier (or --out), never over an existing file.',
    ],
  },
];

/** The version as people read it: "v4". */
export function bridgeLabel(version: number | null | undefined): string {
  return typeof version === 'number' && version > 0 ? `v${version}` : 'unnumbered';
}

/** The version as a manifest and MCP's serverInfo want it: semver, so Claude Desktop orders updates. */
export function bridgeSemver(version: number = BRIDGE_VERSION): string {
  return `${version}.0.0`;
}
