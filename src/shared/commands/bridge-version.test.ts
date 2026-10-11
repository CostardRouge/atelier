import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BRIDGE_CHANGES, BRIDGE_SOURCE_HASH, BRIDGE_VERSION, bridgeLabel, bridgeSemver } from './bridge-version';

/** The hash `bridge-version.ts` records: the two files a person installs, line endings normalised. */
function bridgeSourceHash(): string {
  const hash = createHash('sha256');
  for (const rel of ['../../../scripts/atelier-mcp.mjs', './mcp-protocol.ts']) {
    hash.update(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8').replace(/\r\n/g, '\n'));
  }
  return hash.digest('hex');
}

describe('the bridge version', () => {
  it('is bumped whenever the bridge changes', () => {
    const now = bridgeSourceHash();
    if (now !== BRIDGE_SOURCE_HASH) {
      throw new Error(
        `The bridge changed (scripts/atelier-mcp.mjs or mcp-protocol.ts). In src/shared/commands/bridge-version.ts: ` +
          `bump BRIDGE_VERSION to ${BRIDGE_VERSION + 1}, add its line to BRIDGE_CHANGES, and set BRIDGE_SOURCE_HASH to '${now}'. ` +
          `(Only the hash, if this change must not make people reinstall — a comment, a typo.)`,
      );
    }
  });

  it('has a changelog entry for every version, newest first', () => {
    expect(BRIDGE_CHANGES[0].version).toBe(BRIDGE_VERSION);
    BRIDGE_CHANGES.forEach((entry, i) => {
      expect(entry.version).toBe(BRIDGE_VERSION - i);
      expect(entry.changes.length).toBeGreaterThan(0);
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  it('reads as people and Claude Desktop want it', () => {
    expect(bridgeLabel(4)).toBe('v4');
    expect(bridgeLabel(null)).toBe('unnumbered');
    expect(bridgeSemver(4)).toBe('4.0.0');
  });
});
