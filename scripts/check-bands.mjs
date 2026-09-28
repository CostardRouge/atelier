/**
 * Does a picture drawn in BANDS equal the same picture drawn whole?
 *
 * The render core draws a big frame in full-width bands so its float16 targets
 * hold one band and the rows around it, never the whole frame
 * (`src/shared/render/band-plan.ts`). That is only worth anything if it is
 * INVISIBLE: every pass must say which rows it reads, and a pass that says too
 * few leaves a seam — a stripe of wrong pixels at every band edge, which no
 * unit test in node can see. This draws one chain with every kind of pass the
 * suite has (neighbourhood reads, a source reached through an offset, three
 * warps, a masked layer, the presence blurs, a sharpen, a post-crop vignette),
 * whole and then in bands of a few dozen rows, from a canvas AND from an
 * ImageBitmap, and compares them pixel for pixel.
 *
 * Usage: `npm run dev` in one shell, then
 *   node scripts/check-bands.mjs
 * with BASE set if the dev server is not on 5173.
 */
import { chromium } from 'playwright';
const EXE =
  process.env.CHROMIUM_PATH ??
  '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const BASE = process.env.BASE ?? 'http://127.0.0.1:5173/atelier/';

const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text());
});
await page.goto(BASE, { waitUntil: 'networkidle' });

const out = await page.evaluate(async () => {
  const root = '/atelier/src/shared';
  // The banding hooks come through the grader's module, never `graph.ts`
  // directly: after a hot reload the dev server serves `graph.ts` under a
  // second URL, and a hook set on the other instance changes nothing.
  const { makeGraphGrader, setBandingForTest, bandsLastDrawnForTest } = await import(`${root}/render/graph-grader.ts`);
  const { composeLutStack } = await import(`${root}/lut/lut-stack.ts`);
  const { DEFAULT_DEVELOP } = await import(`${root}/develop/develop.ts`);
  const { DEFAULT_DETAIL } = await import(`${root}/render/detail.ts`);
  const { detailPasses } = await import(`${root}/render/detail-pass.ts`);
  const { makeLensPass } = await import(`${root}/render/lens-pass.ts`);
  const { DEFAULT_LENS } = await import(`${root}/render/lens.ts`);
  const { makeKeystonePass } = await import(`${root}/render/keystone-pass.ts`);
  const { makeCameraWarpPass } = await import(`${root}/render/camera-warp-pass.ts`);
  const { makeRepairPass } = await import(`${root}/render/repair-pass.ts`);
  const { makeLayerPass } = await import(`${root}/render/layer-pass.ts`);
  const maskMod = await import(`${root}/render/mask.ts`);
  const { makePostVignettePass } = await import(`${root}/render/post-vignette-pass.ts`);
  const { DEFAULT_POST_VIGNETTE } = await import(`${root}/render/post-vignette.ts`);

  const W = 960;
  const H = 720;
  const AR = W / H;
  const src = document.createElement('canvas');
  src.width = W;
  src.height = H;
  const g = src.getContext('2d');
  // Detail everywhere: a gradient, stripes both ways, a checker and noise, so
  // a wrong row anywhere shows.
  const img = g.createImageData(W, H);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const check = ((x >> 4) + (y >> 4)) & 1;
      img.data[i] = (x * 255) / W + rnd() * 20;
      img.data[i + 1] = (y * 255) / H * 0.8 + (check ? 40 : 0);
      img.data[i + 2] = ((x + y) % 23) * 9 + rnd() * 20;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const bitmap = await createImageBitmap(src);

  const develop = { ...DEFAULT_DEVELOP, exposure: 0.3, contrast: 20, saturation: 15 };
  const cube = composeLutStack([], 'none', 'tetrahedral', develop);
  const toWarm = composeLutStack([], 'none', 'tetrahedral', { ...DEFAULT_DEVELOP, temperature: 40, exposure: -0.4 });

  const detail = { ...DEFAULT_DETAIL, luminance: 40, colour: 50, defringe: 60, sharpen: 60, sharpenMasking: 30, clarity: 45, dehaze: 30, texture: 25 };
  const { pre, post } = detailPasses(detail);
  const repair = makeRepairPass(
    [
      { id: 'a', x: 0.3, y: 0.4, radius: 0.05, feather: 0.4, dx: 0.1, dy: 0.06, kind: 'heal' },
      { id: 'b', x: 0.7, y: 0.75, radius: 0.04, feather: 0.2, dx: -0.2, dy: -0.08, kind: 'clone' },
    ],
    AR,
  );
  const lens = makeLensPass({ ...DEFAULT_LENS, distortion: 35, chromaRed: 40, chromaBlue: -30, vignette: 30 }, AR, {
    distortion: [0.02, -0.05, 0.01, 0],
    tcaRed: [1.002, 0, 0],
    tcaBlue: [0.998, 0, 0],
    vignette: [0.1, 0, 0],
  });
  const keystone = makeKeystonePass({ vertical: 18, horizontal: -9, rotation: 3, scale: 1.1, aspect: 0 }, AR);
  const warp = makeCameraWarpPass(
    { centerH: 0.52, centerV: 0.47, planes: [{ radial: [1.03, 0.02, -0.01, 0], tangential: [0.001, -0.002] }] },
    W,
    H,
  );
  const layer = makeLayerPass({
    lut: toWarm,
    mask: { ...maskMod.DEFAULT_RADIAL, x: 0.45, y: 0.55, radiusX: 0.4, radiusY: 0.3, angle: 20, feather: 0.4 },
    aspectRatio: AR,
    id: 'band:layer',
  });
  const vignette = makePostVignettePass({ ...DEFAULT_POST_VIGNETTE, amount: -40 }, [1, 0, 0, 0, 1, 0], AR);

  const passes = { pre: [...pre, repair].filter(Boolean), post: [lens, keystone, warp, layer, ...post, vignette].filter(Boolean) };

  const read = (canvas) => {
    const o = document.createElement('canvas');
    o.width = W;
    o.height = H;
    const c = o.getContext('2d', { willReadFrequently: true });
    c.drawImage(canvas, 0, 0);
    return c.getImageData(0, 0, W, H).data;
  };
  let drawn = 0;
  const draw = (source, banding) => {
    setBandingForTest(banding);
    const grader = makeGraphGrader(cube, W, H);
    grader.setExtraPasses(passes.post, passes.pre);
    const px = read(grader.render(source));
    drawn = bandsLastDrawnForTest();
    grader.dispose();
    setBandingForTest(null);
    return px;
  };
  const compare = (a, b) => {
    let worst = 0;
    let off = 0;
    let rowWorst = 0;
    let worstRow = -1;
    for (let y = 0; y < H; y++) {
      let row = 0;
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        for (let c = 0; c < 3; c++) {
          const d = Math.abs(a[i + c] - b[i + c]);
          if (d > 1) off += 1;
          worst = Math.max(worst, d);
          row = Math.max(row, d);
        }
      }
      if (row > rowWorst) {
        rowWorst = row;
        worstRow = y;
      }
    }
    return { worst, off, worstRow };
  };

  const results = { passes: passes.pre.length + 1 + passes.post.length };
  for (const [name, source] of [['canvas', src], ['bitmap', bitmap]]) {
    const whole = draw(source, null);
    const wholeBands = drawn;
    // Bands of 37 rows: an odd height, so no band edge falls on a tile of the
    // checker, and small enough for fifteen seams across the frame.
    const banded = draw(source, { min: 0, pixels: W * 37 });
    const bands = drawn;
    // The chain must MOVE the picture, or both draws could be the source and agree.
    const plain = read(src);
    let moved = 0;
    for (let i = 0; i < plain.length; i += 4) moved = Math.max(moved, Math.abs(plain[i] - whole[i]));
    results[name] = { ...compare(whole, banded), moved, bands, wholeBands };
  }
  return results;
});

await browser.close();
let bad = 0;
console.log(`\n  one chain of ${out.passes} passes, whole against bands of 37 rows:\n`);
for (const name of ['canvas', 'bitmap']) {
  const r = out[name];
  // One code of float16 → 8-bit rounding is allowed; a seam is dozens.
  // …and the bands must really have been drawn, or this compares whole with whole.
  const ok = r.worst <= 1 && r.moved > 20 && r.bands > 10 && r.wholeBands === 1;
  if (!ok) bad += 1;
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(7)} worst ${r.worst} code(s), ${r.off} samples past 1` +
      (r.worst > 1 ? `, worst row ${r.worstRow}` : '') +
      `; ${r.bands} bands against ${r.wholeBands}; the chain moves the picture up to ${r.moved} codes`,
  );
}
if (errors.length) {
  bad += 1;
  console.log(`\n  FAIL  the page said:\n    ${errors.join('\n    ')}`);
}
console.log(bad ? `\n  ${bad} failure(s)\n` : '\n  all rows pass\n');
process.exit(bad ? 1 : 0);
