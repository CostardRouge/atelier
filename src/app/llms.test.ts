import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REPO_URL, SITE_URL } from './site';
import { TOOLS } from './tools';

/**
 * `public/llms.txt` (llmstxt.org) is written by hand, since nothing builds
 * the site's pages: every screen is a hash route of one page. This holds it
 * to the tool registry — every tool linked under its group, and no link to a
 * route that does not exist — so adding, renaming or regrouping a tool fails
 * here until the file says the same.
 */

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const llms = read('public/llms.txt');

/** The `## Section` a line sits under, and the line's `[title](url)` link. */
function links(): { section: string; title: string; url: string }[] {
  const out: { section: string; title: string; url: string }[] = [];
  let section = '';
  for (const line of llms.split('\n')) {
    const heading = line.match(/^## (.+)$/);
    if (heading) section = heading[1];
    const link = line.match(/^- \[([^\]]+)\]\(([^)]+)\): \S/);
    if (link) out.push({ section, title: link[1], url: link[2] });
  }
  return out;
}

describe('llms.txt', () => {
  it('has the shape llmstxt.org asks for: a title, a summary, then lists', () => {
    expect(llms).toMatch(/^# Atelier\n\n> \S.*\n\n\S/);
    expect(links().length).toBeGreaterThan(0);
  });

  it('links every tool of the registry, under its group, by its label and route', () => {
    const found = links();
    for (const tool of TOOLS) {
      const section = tool.group === 'editor' ? 'Editors' : 'Instruments';
      expect(found, tool.id).toContainEqual({ section, title: tool.label, url: `${SITE_URL}#${tool.path}` });
    }
    const listed = found.filter((l) => l.section === 'Editors' || l.section === 'Instruments');
    expect(listed).toHaveLength(TOOLS.length);
  });

  it('links only the live site and the repository, and only routes the shell answers', () => {
    // The reading pages the shell routes itself (`App.tsx`), beside the tools.
    const app = read('src/app/App.tsx');
    for (const { url } of links()) {
      expect(url.startsWith(SITE_URL) || url === REPO_URL, url).toBe(true);
      const hash = url.startsWith(SITE_URL) ? url.slice(SITE_URL.length) : '';
      if (!hash) continue;
      const path = hash.replace(/^#/, '');
      const isTool = TOOLS.some((t) => t.path === path);
      expect(isTool || app.includes(`path === '${path}'`), url).toBe(true);
    }
  });
});
