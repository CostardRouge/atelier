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

export const BRIDGE_VERSION = 1;

/** SHA-256 of `scripts/atelier-mcp.mjs` + `src/shared/commands/mcp-protocol.ts`, line endings normalised. */
export const BRIDGE_SOURCE_HASH = 'ec6c42a3b41fd74d61a3bd52d362eaace1d6ab7f4beec59f0aca132a65a48b9e';

/** What each version changed, newest first — drawn on `#/agents`. */
export const BRIDGE_CHANGES: readonly { version: number; date: string; changes: readonly string[] }[] = [
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
