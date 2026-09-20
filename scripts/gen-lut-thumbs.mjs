/**
 * Bake every BUILT-IN look's picker thumbnail once, and commit the result.
 *
 * WHY AT ALL. The look gallery used to re-parse every lattice and re-bake
 * every tile each time it opened, on a synthetic chart that never changes —
 * the same pixels recomputed forever, and 37 MB of `.cube` text to fetch and
 * parse to draw a grid a phone would not draw at all. A built-in look and the
 * two reference pictures are both fixed at build time, so the tile is too.
 * `docs/lut-packs.md` §7 is the decision; a PACK's thumbnails are baked at
 * import instead (`pack-thumbs.ts`), because its files never reach this repo.
 *
 * WHY A SCRIPT RUN BY HAND, AND NOT A VITE PLUGIN. The plan floated "a Vite
 * plugin, like `virtual:luts`". This repo has already met that cost and chosen
 * otherwise, three times: `gen-luts.mjs`, `gen-icons.mjs` and
 * `gen-gazetteer.mjs` are all a generator in `scripts/` whose output is
 * committed in `public/` (`docs/memory/deployment.md`). The reason is written
 * on `gen-icons.mjs`: baking needs a JPEG decoder and an image encoder —
 * `sharp`, a NATIVE module — and "CI would pay for a native install on every
 * job". `virtual:luts` is a cheap directory scan; this is two JPEG decodes and
 * ~34 lattice bakes, which every `vite build` and every `npm run dev` would
 * then pay for as well. And the input changes about as often as the icons do:
 * only when someone drops a `.cube` into `public/luts/`.
 *
 * Note §3 rule 3 — "nothing of a pack in `public/` or git" — does NOT reach
 * these: a built-in's own `.cube` is already committed and already shipped.
 *
 * USAGE:  npm i --no-save sharp   (once; deliberately NOT a project dependency
 *                                  — same reason as gen-icons.mjs)
 *         node scripts/gen-lut-thumbs.mjs
 *
 * Re-run it after adding or removing a `.cube` under `public/luts/`, or after
 * changing a film stock's numbers, and COMMIT `public/lut-thumbs/` in the same
 * commit. A look with no tile is not broken — the gallery falls back to baking
 * it live — it just costs what this exists to avoid.
 */
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { registerTsImports } from './ts-imports.mjs';

registerTsImports();

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LUTS_DIR = join(ROOT, 'public', 'luts');
const REFERENCE_DIR = join(ROOT, 'public', 'reference');
const OUT_DIR = join(ROOT, 'public', 'lut-thumbs');

// The app's own modules — the arithmetic here must be the arithmetic the
// browser runs, or a tile stops meaning what it shows.
const { parseCube } = await import('../src/shared/lib/cube-parser.ts');
const { bakeLutPreview, PREVIEW_SAMPLE_SIZE } = await import('../src/shared/lut/lut-preview.ts');
const { familyForLookName } = await import('../src/shared/lut/lut-pack.ts');
const { filmCubeFor } = await import('../src/shared/film/film-layer.ts');
const { FILM_STOCKS, filmSettingsFor } = await import('../src/shared/film/stocks.ts');

/**
 * Tetrahedral, matching the app's default (`use-lut-interpolation.ts`). A
 * reader who switches to trilinear gets tiles baked the other way — which is
 * exactly what the live path was doing before, and invisible at 96 px: the
 * difference between the two is a neutral's tint, not a look's character.
 */
const INTERPOLATION = 'tetrahedral';

/** The two pictures, as `pack-thumbs.ts` names them. */
const REFERENCES = {
  log: 'reference-dlogm.jpg',
  rec709: 'reference-rec709.jpg',
};

/**
 * A reference, centre-cropped to a square and read back as RGBA — the same
 * crop `pack-thumbs.ts`'s `referenceSample` does with a canvas.
 */
async function referenceSample(family) {
  const file = join(REFERENCE_DIR, REFERENCES[family]);
  const image = sharp(await readFile(file));
  const { width, height } = await image.metadata();
  const side = Math.min(width, height);
  const { data } = await image
    .extract({
      left: Math.round((width - side) / 2),
      top: Math.round((height - side) / 2),
      width: side,
      height: side,
    })
    .resize(PREVIEW_SAMPLE_SIZE, PREVIEW_SAMPLE_SIZE, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    width: PREVIEW_SAMPLE_SIZE,
    height: PREVIEW_SAMPLE_SIZE,
    data: new Uint8ClampedArray(data),
  };
}

/** `RgbBitmap` → a WebP file, the same format and quality the import bakes. */
async function writeTile(bitmap, file) {
  await sharp(Buffer.from(bitmap.data.buffer, bitmap.data.byteOffset, bitmap.data.byteLength), {
    raw: { width: bitmap.width, height: bitmap.height, channels: 4 },
  })
    .webp({ quality: 82 })
    .toFile(join(OUT_DIR, file));
}

/**
 * Every `.cube` under `public/luts/`, with the id `vite.config.ts`'s
 * `luts-manifest` plugin gives it — the id the gallery's items carry, and so
 * the key the manifest has to answer to. Kept in step with that plugin by
 * hand; a drift shows up as a look that bakes live, never as a wrong picture.
 */
async function builtinLuts() {
  const out = [];
  const walk = async (dir) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.cube')) {
        const rel = relative(LUTS_DIR, full).split(sep).join('/');
        out.push({
          id: rel.replace(/\.cube$/i, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase(),
          file: full,
          name: entry.name,
        });
      }
    }
  };
  await walk(LUTS_DIR);
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** A tile's file name: the item's id, made safe (`film:x` → `film-x`). */
const tileFile = (id) => `${id.replace(/[^a-z0-9._-]+/gi, '-').toLowerCase()}.webp`;

// --- bake -------------------------------------------------------------------

await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });

const samples = {
  log: await referenceSample('log'),
  rec709: await referenceSample('rec709'),
};
const thumbs = {};
let failed = 0;

// The "No look (original)" tile: the Rec.709 reference, untouched.
await writeTile(bakeLutPreview(samples.rec709, null, 1, INTERPOLATION), tileFile('none'));
thumbs.none = tileFile('none');
console.log(`✓ none — the original, on ${REFERENCES.rec709}`);

for (const lut of await builtinLuts()) {
  // Read from the NAME: a built-in's folder is a brand, not a category, so
  // `familyFor` has nothing to read — `docs/lut-packs.md` §7's log-input trap.
  const family = familyForLookName(lut.name);
  const parsed = parseCube(await readFile(lut.file, 'utf8'));
  if (!parsed) {
    console.warn(`✗ ${lut.id} — not a 3D .cube (it will bake live in the gallery)`);
    failed += 1;
    continue;
  }
  const file = tileFile(lut.id);
  await writeTile(bakeLutPreview(samples[family], parsed, 1, INTERPOLATION), file);
  thumbs[lut.id] = file;
  console.log(`✓ ${lut.id} — ${parsed.size}³ on ${REFERENCES[family]}`);
}

// The film stocks are generated from numbers, not files, and cost ~50 ms of
// real CPU apiece (`film-layer.ts`) — which is exactly why they are worth
// baking here rather than on every open of the picker.
for (const stock of FILM_STOCKS) {
  const id = `film:${stock.id}`;
  const file = tileFile(id);
  await writeTile(
    bakeLutPreview(samples.rec709, filmCubeFor(filmSettingsFor(stock.id)), 1, INTERPOLATION),
    file,
  );
  thumbs[id] = file;
  console.log(`✓ ${id} — ${stock.name}, on ${REFERENCES.rec709}`);
}

await writeFile(
  join(OUT_DIR, 'index.json'),
  `${JSON.stringify(
    {
      note: 'Generated by scripts/gen-lut-thumbs.mjs — do not edit by hand.',
      version: 1,
      size: PREVIEW_SAMPLE_SIZE,
      interpolation: INTERPOLATION,
      references: REFERENCES,
      thumbs,
    },
    null,
    1,
  )}\n`,
);

const count = Object.keys(thumbs).length;
console.log(
  `\nDone — ${count} tiles in public/lut-thumbs/${failed ? ` (${failed} look(s) skipped)` : ''}.` +
    `\nCommit the folder: the gallery reads index.json and falls back to baking live without it.`,
);
