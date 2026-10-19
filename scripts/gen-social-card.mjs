/**
 * Draw the social card — the 1200 × 630 picture a link to Atelier unfurls
 * with in a chat, a feed or a search result — and commit the result.
 *
 * WHY A CARD AT ALL. OpenGraph and Twitter read ONE picture from `og:image` /
 * `twitter:image` in `index.html`, and an app icon stretched to a banner is
 * what every site shows when it has none (COMMON-PROJECT-SPEC C17). A static
 * host cannot draw one on request, so it is drawn here, once, and tracked —
 * the same shape as `gen-icons.mjs`, the LUT tiles and the gazetteer: a
 * generator in `scripts/`, its output in `public/`, both in the repo.
 *
 * WHAT IT DRAWS. The mark, rasterised from `public/icons/icon.svg` (the one
 * drawing of it — never re-traced here), beside the wordmark in the suite's
 * own faces: Instrument Serif for "Atelier", Space Grotesk for the sentence,
 * JetBrains Mono for the eyebrow and the address, read from the `@fontsource`
 * packages `main.tsx` already ships. Paper, ink, one vermilion: the tokens of
 * `src/index.css`, flat — no gradient, no grain.
 *
 * THE FONT TRAP. sharp's librsvg finds fonts through fontconfig, and the
 * `@fontsource` packages ship WOFF/WOFF2 only, which its FreeType does not
 * open: every face silently fell back to a system sans. A WOFF is a TrueType
 * whose tables are zlib-compressed, so `woffToSfnt` unwraps the four files
 * needed into a temp folder, a `fonts.conf` names that folder alone, and
 * `FONTCONFIG_FILE` is set BEFORE sharp is imported (dynamically — a static
 * import is hoisted above the assignment). Nothing of that is committed.
 *
 * USAGE:  npm i --no-save sharp   (once; deliberately NOT a project dependency
 *                                 — this runs by hand, and CI would pay for a
 *                                 native install on every job)
 *         node scripts/gen-social-card.mjs
 *
 * A redesigned card takes a NEW file name: the card's URL is what every
 * platform caches on, and a changed picture under the old name stays the old
 * picture for weeks. Rename it here and in `index.html` together.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'social-card.png');
const MARK = join(ROOT, 'public', 'icons', 'icon.svg');
const FONTSOURCE = join(ROOT, 'node_modules', '@fontsource');

const WIDTH = 1200;
const HEIGHT = 630;

/** The tokens of `src/index.css` (light theme): the card is paper whatever the viewer's theme. */
const PAPER = '#f4f0e7';
const INK = '#1b1813';
const INK_SOFT = '#4f4a40';
const MUTED = '#938b7c';
const ACCENT = '#d9442a';
const ACCENT_INK = '#b2331e';
const LINE_STRONG = '#d2c8b3';

/** The faces the card uses, as `main.tsx` ships them: `@fontsource/<family>/files/<file>`. */
const FONTS = [
  'instrument-serif/files/instrument-serif-latin-400-italic.woff',
  'space-grotesk/files/space-grotesk-latin-500-normal.woff',
  'jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff',
];

/**
 * Unwrap a WOFF (version 1) into the TrueType/OpenType it carries: the sfnt
 * header, the table directory, then each table inflated (or copied when it
 * was stored uncompressed) at a 4-byte boundary. The checksums are copied as
 * found — FreeType does not verify them.
 */
function woffToSfnt(woff) {
  const dv = new DataView(woff.buffer, woff.byteOffset, woff.byteLength);
  if (dv.getUint32(0) !== 0x774f4646) throw new Error('Not a WOFF file.');
  const flavor = dv.getUint32(4);
  const numTables = dv.getUint16(12);
  const tables = [];
  for (let i = 0, p = 44; i < numTables; i++, p += 20) {
    const table = {
      tag: dv.getUint32(p),
      offset: dv.getUint32(p + 4),
      compLength: dv.getUint32(p + 8),
      origLength: dv.getUint32(p + 12),
      checksum: dv.getUint32(p + 16),
    };
    const raw = woff.subarray(table.offset, table.offset + table.compLength);
    table.data = table.compLength === table.origLength ? raw : inflateSync(raw);
    tables.push(table);
  }
  let offset = 12 + numTables * 16;
  for (const table of tables) {
    table.out = offset;
    offset += (table.origLength + 3) & ~3;
  }
  const sfnt = Buffer.alloc(offset);
  const w = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength);
  const entrySelector = Math.floor(Math.log2(numTables));
  const searchRange = (1 << entrySelector) * 16;
  w.setUint32(0, flavor);
  w.setUint16(4, numTables);
  w.setUint16(6, searchRange);
  w.setUint16(8, entrySelector);
  w.setUint16(10, numTables * 16 - searchRange);
  tables.forEach((table, i) => {
    const q = 12 + i * 16;
    w.setUint32(q, table.tag);
    w.setUint32(q + 4, table.checksum);
    w.setUint32(q + 8, table.out);
    w.setUint32(q + 12, table.origLength);
    table.data.copy(sfnt, table.out);
  });
  return sfnt;
}

/** The temp folder fontconfig reads the unwrapped faces from; removed at the end. */
function prepareFonts() {
  const dir = mkdtempSync(join(tmpdir(), 'atelier-social-card-'));
  for (const file of FONTS) {
    const name = file.split('/').pop().replace(/\.woff$/, '.ttf');
    writeFileSync(join(dir, name), woffToSfnt(readFileSync(join(FONTSOURCE, file))));
  }
  const conf = join(dir, 'fonts.conf');
  writeFileSync(
    conf,
    `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig>\n  <dir>${dir}</dir>\n  <cachedir>${join(dir, 'cache')}</cachedir>\n</fontconfig>\n`,
  );
  return { dir, conf };
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The card without the mark: the home page's own order — the accent rule and
 * its mono eyebrow, the serif wordmark, the one sentence the footer repeats,
 * the address in mono. The text column starts past the mark's column.
 */
function cardSvg() {
  const x = 520;
  const eyebrow = 'A studio for your captures';
  const sentence = 'Everything stays on your machine.';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${PAPER}"/>
  <rect x="${x}" y="224" width="40" height="2" fill="${ACCENT}"/>
  <text x="${x + 58}" y="232" font-family="JetBrains Mono" font-size="22" letter-spacing="4.4" fill="${ACCENT_INK}">${esc(eyebrow.toUpperCase())}</text>
  <text x="${x - 6}" y="372" font-family="Instrument Serif" font-style="italic" font-size="168" letter-spacing="-2" fill="${INK}">Atelier</text>
  <rect x="${x}" y="404" width="620" height="1" fill="${LINE_STRONG}"/>
  <text x="${x}" y="456" font-family="Space Grotesk" font-weight="500" font-size="31" fill="${INK_SOFT}">${esc(sentence)}</text>
  <text x="${x}" y="562" font-family="JetBrains Mono" font-size="22" fill="${MUTED}">atelier.steeve.website</text>
</svg>`;
}

const fonts = prepareFonts();
process.env.FONTCONFIG_FILE = fonts.conf;
try {
  const { default: sharp } = await import('sharp');
  // The mark, from its one source, at the size the left column gives it.
  const markSize = 360;
  const mark = await sharp(readFileSync(MARK), { density: 384 }).resize(markSize, markSize).png().toBuffer();
  await sharp(Buffer.from(cardSvg()))
    .composite([{ input: mark, left: 100, top: (HEIGHT - markSize) / 2 }])
    .png()
    .toFile(OUT);
  console.log(`✓ public/social-card.png (${WIDTH}×${HEIGHT}) — og:image and twitter:image`);
  console.log('Done. Commit the PNG; a redesign takes a new file name (index.html points at it).');
} finally {
  rmSync(fonts.dir, { recursive: true, force: true });
}
