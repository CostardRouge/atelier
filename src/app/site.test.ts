import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AUDIENCE_DOMAINS } from '../shared/lib/audience';
import { SITE_URL } from './site';

/**
 * The site's address is written by hand in four files nothing builds — the
 * head of `index.html`, `public/robots.txt`, `public/sitemap.xml` and
 * `SITE_URL` — and the card they name is a committed PNG. This holds them
 * together, so a renamed domain or a redrawn card cannot leave one behind.
 */

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

/** The value of a head tag's attribute, found by its `name`, `property` or `rel`. */
function head(html: string, key: string, attr = 'content'): string | undefined {
  const tag = new RegExp(`<(?:meta|link)[^>]*?(?:name|property|rel)="${key}"[^>]*?${attr}="([^"]*)"`);
  return html.match(tag)?.[1];
}

describe('the site address', () => {
  it('is the custom domain at the root, the one audience measurement counts', () => {
    expect(SITE_URL).toBe('https://atelier.steeve.website/');
    expect(new URL(SITE_URL).host).toBe(AUDIENCE_DOMAINS[0]);
  });
});

describe('index.html', () => {
  const html = read('index.html');

  it('names its canonical address and the card a link unfurls with', () => {
    expect(head(html, 'canonical', 'href')).toBe(SITE_URL);
    expect(head(html, 'og:url')).toBe(SITE_URL);
    expect(head(html, 'og:image')).toBe(`${SITE_URL}social-card.png`);
    expect(head(html, 'twitter:image')).toBe(head(html, 'og:image'));
    expect(head(html, 'twitter:card')).toBe('summary_large_image');
  });

  it('says the same title and description to a tab, OpenGraph, Twitter and the manifest', () => {
    const title = html.match(/<title>([^<]*)<\/title>/)?.[1];
    expect(title).toBeTruthy();
    expect(head(html, 'og:title')).toBe(title);
    expect(head(html, 'twitter:title')).toBe(title);
    const description = head(html, 'description');
    expect(description).toBeTruthy();
    expect(head(html, 'og:description')).toBe(description);
    expect(head(html, 'twitter:description')).toBe(description);
    expect(JSON.parse(read('public/manifest.webmanifest')).description).toBe(description);
  });

  it('describes the committed card exactly', () => {
    const png = readFileSync(new URL('../../public/social-card.png', import.meta.url));
    // The PNG signature, then IHDR: the width and height are the first two
    // big-endian 32-bit integers of the first chunk's data (bytes 16 and 20).
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
    expect(head(html, 'og:image:width')).toBe('1200');
    expect(head(html, 'og:image:height')).toBe('630');
  });
});

describe('robots.txt and sitemap.xml', () => {
  it('allow everything and point at the same address', () => {
    const robots = read('public/robots.txt');
    expect(robots).toMatch(/^User-agent: \*\nAllow: \/$/m);
    expect(robots).not.toMatch(/^Disallow:/m);
    expect(robots).toContain(`Sitemap: ${SITE_URL}sitemap.xml`);
    expect(read('public/sitemap.xml')).toContain(`<loc>${SITE_URL}</loc>`);
  });
});
