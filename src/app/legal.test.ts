import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEPLOYED_ORIGINS } from '../shared/commands/mcp-protocol';
import { MEASUREMENT_HOST, NETWORK_EXCEPTIONS } from './legal';

/**
 * The legal notice names every host a request may leave for. This holds the
 * notice to the code both ways: each host it names is the one its module
 * contacts, and no module names a third-party host the notice does not —
 * so a new request has to become a line of the notice, or this fails.
 */

const root = (path: string) => new URL(`../../${path}`, import.meta.url);

/**
 * Hosts that appear in an address the app never requests: XML namespaces
 * written into a file's metadata, and the links a page offers to click.
 */
const NOT_REQUESTS = new Set([
  'www.w3.org',
  'ns.adobe.com',
  'ns.google.com',
  'purl.org',
  'iptc.org',
  'claude.ai',
  'github.com',
  'docs.github.com',
  'www.openstreetmap.org',
  'umami.is',
  'www.cnil.fr',
  'winnow.example',
  ...DEPLOYED_ORIGINS.map((origin) => new URL(origin).host),
]);

function sources(): string[] {
  return readdirSync(root('src'), { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
    .map((file) => `src/${file}`);
}

describe('the legal notice', () => {
  it('names each host where its module contacts it', () => {
    for (const exception of NETWORK_EXCEPTIONS) {
      expect(readFileSync(root(exception.module), 'utf8'), exception.name).toContain(exception.host);
    }
    expect(MEASUREMENT_HOST).toBe('insight.steevepommier.com');
  });

  it('names every third-party host the code may request', () => {
    const named = new Set(NETWORK_EXCEPTIONS.map((exception) => exception.host));
    const unnamed = new Map<string, string>();
    for (const file of sources()) {
      const text = readFileSync(root(file), 'utf8');
      for (const match of text.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
        const host = match[1].toLowerCase();
        if (!named.has(host) && !NOT_REQUESTS.has(host)) unnamed.set(host, file);
      }
    }
    expect(
      Object.fromEntries(unnamed),
      'a host the notice does not name: add it to NETWORK_EXCEPTIONS (a request) or NOT_REQUESTS (a link, a namespace)',
    ).toEqual({});
  });

  it('describes each exception without markup, as the page prints it', () => {
    for (const exception of NETWORK_EXCEPTIONS) {
      expect(exception.when).not.toMatch(/[<>]/);
      expect(exception.when.trim().endsWith('.')).toBe(true);
    }
  });
});
