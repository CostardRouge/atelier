/**
 * Is the render core the same picture as the renderer it grows from?
 *
 * The one gate P4 of `docs/photo-editor.md` is defined by, and it is a NULL
 * RESULT: a look through `makeGraphGrader` must equal the same look through
 * `makeFrameGrader`, pixel for pixel, or the core is not a drop-in and nothing
 * built on it can be trusted.
 *
 * Nothing in `npm test` can see this — vitest runs in node, and a broken pass
 * degrades to a black or un-graded picture with every gate green
 * (`media-pipeline.md`). Two real bugs were caught by exactly this run: a
 * `sampler3D` left on texture unit 0 beside the source's `sampler2D` (an
 * INVALID_OPERATION that drops the draw, silently), and an `RGBA32F` cube set
 * to LINEAR on a GPU without `OES_texture_float_linear` (an incomplete texture,
 * which samples black).
 *
 * Usage: `npm run dev` in one shell, then
 *   node scripts/check-render.mjs
 * with BASE set if the dev server is not on 5174.
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
await page.goto(BASE, { waitUntil: 'networkidle' });

const out = await page.evaluate(async () => {
  // The OLD engine is built straight from `createLutRenderer`, never through
  // `makeFrameGrader` — that seam now returns the core itself, so comparing
  // against it would compare the core with the core and always pass.
  const { createLutRenderer } = await import('/atelier/src/shared/lut/lut-gl.ts');
  const { makeExportCanvas } = await import('/atelier/src/shared/media/webcodecs-export.ts');
  const { makeGraphGrader } = await import('/atelier/src/shared/render/graph-grader.ts');
  const makeFrameGrader = (lut, w, h, intensity) => {
    const canvas = makeExportCanvas(w, h);
    const renderer = createLutRenderer(canvas);
    if (!renderer) return { render: (s) => s, dispose() {} };
    renderer.setLut(lut);
    renderer.setIntensity(intensity);
    renderer.resize(w, h);
    return { render: (s) => (renderer.draw(s), canvas), dispose: () => renderer.dispose() };
  };
  const { createRenderGraph, passthroughPass } = await import('/atelier/src/shared/render/graph.ts');
  const { makeCubePass } = await import('/atelier/src/shared/render/cube-pass.ts');
  const { composeLutStack } = await import('/atelier/src/shared/lut/lut-stack.ts');
  const { DEFAULT_DEVELOP } = await import('/atelier/src/shared/develop/develop.ts');

  // A real, asymmetric look: a develop with curves, baked through the cube.
  const develop = {
    ...DEFAULT_DEVELOP, exposure: 0.4, contrast: 25, temperature: -30,
    curves: { luma: [{x:0,y:0},{x:0.3,y:0.18},{x:0.75,y:0.85},{x:1,y:1}], rgb: null,
              red: [{x:0,y:0},{x:0.5,y:0.6},{x:1,y:1}], green: null, blue: null },
  };
  const cube = composeLutStack([], 'rec709-to-srgb', 'tetrahedral', develop);

  const W = 256, H = 192;
  const src = document.createElement('canvas'); src.width = W; src.height = H;
  const g = src.getContext('2d');
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    g.fillStyle = `rgb(${x},${Math.round(y * 255 / H)},${(x * y) % 256})`;
    g.fillRect(x, y, 1, 1);
  }
  const bitmap = await createImageBitmap(src);

  const read = (canvas) => {
    const o = document.createElement('canvas'); o.width = W; o.height = H;
    const c = o.getContext('2d', { willReadFrequently: true });
    c.drawImage(canvas, 0, 0, W, H);
    return c.getImageData(0, 0, W, H).data;
  };
  const worst = (a, b) => {
    let w = 0, at = -1;
    for (let i = 0; i < a.length; i++) {
      if (i % 4 === 3) continue;
      const d = Math.abs(a[i] - b[i]);
      if (d > w) { w = d; at = i; }
    }
    return { worst: w, at };
  };

  const results = {};
  for (const kind of ['canvas', 'bitmap']) {
    const source = kind === 'canvas' ? src : bitmap;
    const oldG = makeFrameGrader(cube, W, H, 1);
    const a = read(oldG.render(source));
    oldG.dispose();

    const newG = makeGraphGrader(cube, W, H, 1, 'tetrahedral');
    const b = read(newG.render(source));
    results[kind + '_precision'] = newG.precision;
    newG.dispose();
    results[kind] = worst(a, b);

    // And with a second, do-nothing pass: proves the ping-pong round trip is
    // neutral in orientation and in value.
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const graph = createRenderGraph(cv);
    graph.resize(W, H);
    graph.render(source, [makeCubePass({ lut: cube, intensity: 1, interpolation: 'tetrahedral' }), passthroughPass]);
    const c = read(cv);
    graph.dispose();
    results[kind + '_twoPass'] = worst(a, c);
  }
  // --- the keystone: does the GPU warp agree with the pure module? ---------
  //
  // The question no reasoning settles: a texture's v axis and a screen's y axis
  // disagree, and the vertex shader flips UVs for an ImageBitmap and not for a
  // canvas. So a marker is put in a KNOWN corner, warped, and looked for where
  // `keystoneMatrix` says it should be.
  {
    const { createRenderGraph } = await import('/atelier/src/shared/render/graph.ts');
    const { makeKeystonePass, keystonePassFromMatrix } = await import(
      '/atelier/src/shared/render/keystone-pass.ts'
    );
    const geo = await import('/atelier/src/shared/render/geometry.ts');

    const S = 128;
    const marked = document.createElement('canvas'); marked.width = S; marked.height = S;
    const mg = marked.getContext('2d');
    mg.fillStyle = '#000'; mg.fillRect(0, 0, S, S);
    // One bright block, up and to the LEFT of centre: source point (-0.25,-0.25)
    // in a y-DOWN centred space is the upper-left quadrant.
    mg.fillStyle = '#fff'; mg.fillRect(S * 0.25 - 6, S * 0.25 - 6, 12, 12);

    const keystone = { ...geo.DEFAULT_KEYSTONE, rotation: 90 };
    const forward = geo.keystoneMatrix(keystone, 1);
    // A 90 degree turn sends the upper-left to the upper-RIGHT in a y-down
    // space, which is an unambiguous, sign-revealing answer.
    const expected = geo.applyMatrix3(forward, -0.25, -0.25);

    // The CENTROID of what is lit, so the answer is the middle of the marker
    // rather than whichever of its pixels was scanned first.
    const centroid = (data, n) => {
      let sx = 0, sy = 0, w = 0;
      for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) {
        const v = data[(y * n + x) * 4];
        if (v < 128) continue;
        sx += (x + 0.5) / n - 0.5; sy += (y + 0.5) / n - 0.5; w += 1;
      }
      return w ? [sx / w, sy / w] : null;
    };

    const run = (pass) => {
      const cv = document.createElement('canvas');
      const graph = createRenderGraph(cv);
      graph.resize(S, S);
      graph.render(marked, [pass]);
      const o = document.createElement('canvas'); o.width = S; o.height = S;
      const oc = o.getContext('2d', { willReadFrequently: true });
      oc.drawImage(cv, 0, 0);
      const at = centroid(oc.getImageData(0, 0, S, S).data, S);
      graph.dispose();
      return at;
    };

    results.keystone = {
      expected: expected.map((v) => Number(v.toFixed(4))),
      // What every consumer gets: the pass builds its own matrix.
      viaPass: run(makeKeystonePass(keystone, 1)).map((v) => Number(v.toFixed(4))),
      // And WITHOUT the mirror, to keep on record that it is load-bearing.
      unmirrored: run(
        keystonePassFromMatrix(geo.keystoneSampleMatrix(keystone, 1)),
      ).map((v) => Number(v.toFixed(4))),
    };
  }

  return results;
});

await browser.close();

const kx = out.keystone;
const keyOff = Math.max(
  Math.abs(kx.viaPass[0] - kx.expected[0]),
  Math.abs(kx.viaPass[1] - kx.expected[1]),
);
const unmirroredOff = Math.max(
  Math.abs(kx.unmirrored[0] - kx.expected[0]),
  Math.abs(kx.unmirrored[1] - kx.expected[1]),
);

const rows = [
  ['canvas source, one pass', out.canvas.worst, 0],
  ['ImageBitmap source, one pass', out.bitmap.worst, 0],
  ['canvas source, cube + passthrough', out.canvas_twoPass.worst, 1],
  ['ImageBitmap source, cube + passthrough', out.bitmap_twoPass.worst, 1],
];
console.log(`\n  buffers: ${out.canvas_precision}\n`);
let bad = 0;
for (const [name, worst, allowed] of rows) {
  const ok = worst <= allowed;
  if (!ok) bad += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(40)} worst ${worst} code${worst === 1 ? '' : 's'} (allowed ${allowed})`);
}
console.log(
  `\n  keystone: a 90 degree turn puts the marker at ${JSON.stringify(kx.viaPass)}, ` +
    `the matrix says ${JSON.stringify(kx.expected)}`,
);
if (keyOff > 0.02) {
  bad += 1;
  console.log(`  FAIL  the warp disagrees with geometry.ts by ${keyOff.toFixed(3)}`);
} else {
  console.log(`  ok    within ${keyOff.toFixed(4)} of it`);
}
// The mirror is load-bearing: without it the marker lands somewhere else, and
// a run where BOTH agree would mean the check had stopped proving anything.
if (unmirroredOff < 0.02) {
  bad += 1;
  console.log('  FAIL  unmirrored agrees too, so this check proves nothing any more');
} else {
  console.log(`  ok    unmirrored is ${unmirroredOff.toFixed(3)} away, so the mirror is doing the work`);
}

if (errors.length) {
  bad += 1;
  console.log('\n  page errors:', errors.slice(0, 3));
}
console.log(
  bad
    ? '\n  The core does NOT match the renderer it replaces.\n'
    : '\n  The core is the same picture; a round trip costs at most a code of rounding.\n',
);
process.exit(bad ? 1 : 0);
