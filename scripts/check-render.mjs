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
 * which samples black). The last row takes that extension away by hand, so
 * the half-float cube the core falls to there is measured too.
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
    const { createRenderGraph, passthroughPass } = await import('/atelier/src/shared/render/graph.ts');
    const { makeKeystonePass } = await import('/atelier/src/shared/render/keystone-pass.ts');
    const geo = await import('/atelier/src/shared/render/geometry.ts');

    const S = 128;
    const marked = document.createElement('canvas'); marked.width = S; marked.height = S;
    const mg = marked.getContext('2d');
    mg.fillStyle = '#000'; mg.fillRect(0, 0, S, S);
    // One bright block, up and to the LEFT of centre: source point (-0.25,-0.25)
    // in a y-DOWN centred space is the upper-left quadrant.
    mg.fillStyle = '#fff'; mg.fillRect(S * 0.25 - 6, S * 0.25 - 6, 12, 12);
    // The SAME picture as an ImageBitmap. This is the whole point of the row
    // pair: `v_uv`'s y runs with the picture for a canvas and against it for a
    // bitmap, so a geometry pass that reads `v_uv` directly is upside down for
    // one of them — which is exactly what shipped, and what `imageUv` fixes.
    const markedBitmap = await createImageBitmap(marked);

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

    const run = (source, pass) => {
      const cv = document.createElement('canvas');
      const graph = createRenderGraph(cv);
      graph.resize(S, S);
      graph.render(source, [pass]);
      const o = document.createElement('canvas'); o.width = S; o.height = S;
      const oc = o.getContext('2d', { willReadFrequently: true });
      oc.drawImage(cv, 0, 0);
      const at = centroid(oc.getImageData(0, 0, S, S).data, S);
      graph.dispose();
      return at;
    };
    const round = (p) => p.map((v) => Number(v.toFixed(4)));

    results.keystone = {
      expected: round(expected),
      viaCanvas: round(run(marked, makeKeystonePass(keystone, 1))),
      viaBitmap: round(run(markedBitmap, makeKeystonePass(keystone, 1))),
      // Untouched, both ways: if a passthrough did NOT put the marker back at
      // (-0.25,-0.25) the harness itself would be upside down and every row
      // above it would be measuring the wrong thing.
      restCanvas: round(run(marked, passthroughPass)),
      restBitmap: round(run(markedBitmap, passthroughPass)),
    };
    markedBitmap.close();
  }

  // --- the lens: does the GPU land a point where lensSampleRadius says? -----
  //
  // Distortion is radial, so a mirror is invisible to it — which is exactly why
  // it needs measuring rather than reasoning about. A marker is put at a known
  // radius on the horizontal centre line, warped, and its centroid's radius
  // compared with the radius the pure module solves for. Vignetting is checked
  // the same way, as a ratio the shader and `vignetteGain` must agree on.
  {
    const { createRenderGraph } = await import('/atelier/src/shared/render/graph.ts');
    const { makeLensPass } = await import('/atelier/src/shared/render/lens-pass.ts');
    const lens = await import('/atelier/src/shared/render/lens.ts');

    const S = 192;
    const HALF = 1 / Math.SQRT2; // a square frame: the corner sits at radius 1
    const toRadius = (px) => Math.abs(px / S - 0.5) * 2 * HALF;

    const draw = (paint) => {
      const c = document.createElement('canvas');
      c.width = S; c.height = S;
      paint(c.getContext('2d'));
      return c;
    };
    const run = (source, pass) => {
      const cv = document.createElement('canvas');
      const graph = createRenderGraph(cv);
      graph.resize(S, S);
      graph.render(source, [pass]);
      const o = document.createElement('canvas'); o.width = S; o.height = S;
      const oc = o.getContext('2d', { willReadFrequently: true });
      oc.drawImage(cv, 0, 0);
      const data = oc.getImageData(0, 0, S, S).data;
      graph.dispose();
      return data;
    };

    // A block on the centre line, well out towards the edge. Distortion is
    // CUBIC in the radius, so near the middle it barely moves anything — a
    // marker at 0.75 of the way out shifts by 0.007 and the run could not tell
    // a working warp from a broken one. Not so far out that the warped block
    // clips the frame, which would drag its centroid back inwards.
    const MARK = Math.round(S * 0.88);
    const marked = draw((g) => {
      g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
      g.fillStyle = '#fff'; g.fillRect(MARK - 3, (S >> 1) - 3, 6, 6);
    });
    const sourceR = toRadius(MARK);

    // Both terms at full barrel: a source point moves OUTWARD in the output, a
    // direction no sign error can fake, and this is the exact corner where the
    // radius map is closest to folding (`lens.ts`, f'(1) = 0.16).
    const setting = { ...lens.DEFAULT_LENS, distortion: -100, distortion2: -100 };
    const { k1, k2 } = lens.distortionTerms(setting);
    // Solve lensSampleRadius(ro) = sourceR by bisection — monotone, so it has
    // exactly one answer, which is the property the specs pin.
    let lo = 0, hi = 2;
    for (let i = 0; i < 80; i += 1) {
      const mid = (lo + hi) / 2;
      if (lens.lensSampleRadius(mid, k1, k2) < sourceR) lo = mid; else hi = mid;
    }
    const expectedR = (lo + hi) / 2;

    const data = run(marked, makeLensPass(setting, 1));
    let sx = 0, w = 0;
    for (let y = 0; y < S; y += 1) for (let x = 0; x < S; x += 1) {
      const v = data[(y * S + x) * 4];
      if (v < 128) continue;
      sx += x + 0.5; w += 1;
    }
    results.lens = {
      lit: w,
      sourceR: Number(sourceR.toFixed(4)),
      expectedR: Number(expectedR.toFixed(4)),
      // Undistorted, to keep on record that the warp is doing something: the
      // marker would sit back at sourceR.
      gotR: w ? Number(toRadius(sx / w).toFixed(4)) : null,
    };

    // Vignetting: a flat grey frame, corrected, read at the centre and at a
    // known radius out along the centre line.
    const flat = draw((g) => { g.fillStyle = '#808080'; g.fillRect(0, 0, S, S); });
    const vig = { ...lens.DEFAULT_LENS, vignette: 60, vignetteMidpoint: 20 };
    const vData = run(flat, makeLensPass(vig, 1));
    const at = (x, y) => vData[((y * S + x) * 4)];
    const centre = at(S >> 1, S >> 1);
    const OUT = Math.round(S * 0.92);
    results.vignette = {
      centre,
      out: at(OUT, S >> 1),
      // What the pure module says that pixel should have become.
      expected: Math.round(centre * lens.vignetteGain(toRadius(OUT), 60, 20)),
    };
  }

  // --- the mask: does the shader agree with maskAt, point for point? --------
  //
  // A mask is a function of WHERE, so unlike the lens it is not symmetric in y
  // and the source kind matters. The layer's develop is a cube that turns the
  // picture BLACK, so the rendered value reads back as `1 − mask` directly: no
  // grading arithmetic stands between the measurement and the mask.
  {
    const { createRenderGraph, passthroughPass } = await import('/atelier/src/shared/render/graph.ts');
    const { makeLayerPass } = await import('/atelier/src/shared/render/layer-pass.ts');
    const maskMod = await import('/atelier/src/shared/render/mask.ts');

    // A cube mapping every colour to black: size 2, all zeros.
    const toBlack = {
      title: 'black', size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1],
      data: new Float32Array(2 * 2 * 2 * 3),
    };

    const W = 192, H = 128;
    const AR = W / H;

    // Flat white for the POSITIONAL shapes, and a ramp for the luma one -- a
    // luma mask over a flat frame is one value everywhere, which would pass on
    // a shader that ignored the pixel entirely.
    const paint = (fill) => {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      fill(c.getContext('2d'));
      return c;
    };
    const white = paint((g) => { g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); });
    const ramp = paint((g) => {
      for (let x = 0; x < W; x += 1) {
        const t = Math.round((x / (W - 1)) * 255);
        g.fillStyle = `rgb(${t},${t},${t})`;
        g.fillRect(x, 0, 1, H);
      }
    });

    const shapes = {
      linear: { source: white, mask: { ...maskMod.DEFAULT_LINEAR, x: 0.5, y: 0.45, angle: 25, feather: 0.4 } },
      radial: { source: white, mask: { ...maskMod.DEFAULT_RADIAL, x: 0.4, y: 0.55, radiusX: 0.45, radiusY: 0.25, angle: 30, feather: 0.35 } },
      luma: { source: ramp, mask: { ...maskMod.DEFAULT_LUMA, from: 0.25, to: 0.6, feather: 0.2 } },
      // A painted mask is the one kind the CPU rasterises, so this row checks
      // something the others do not: that the alpha map is uploaded the right
      // way up and sampled in image coordinates. A y flip here would put the
      // stroke at the wrong end of the frame and nothing else would notice.
      brush: {
        source: white,
        mask: {
          kind: 'brush',
          strokes: [
            { points: [[0.25, 0.3], [0.7, 0.45]], radius: 0.22, hardness: 0.4, erase: false },
            { points: [[0.5, 0.38]], radius: 0.08, hardness: 1, erase: true },
          ],
        },
      },
    };

    // PIXELS, not fractions: the expectation is evaluated at the very texel
    // centre the read comes from. Asking maskAt for the probe point while
    // reading whichever texel contains it is off by up to half a texel, which
    // on a steep feather is several 8-bit codes -- measured, 0.043 on the
    // radial, and it looked exactly like a broken shader.
    const probes = [];
    for (const fx of [0.13, 0.37, 0.5, 0.71, 0.89]) {
      for (const fy of [0.17, 0.42, 0.63, 0.86]) {
        probes.push([Math.floor(fx * W), Math.floor(fy * H)]);
      }
    }
    const uvOf = ([x, y]) => [(x + 0.5) / W, (y + 0.5) / H];

    const readProbes = (canvas) => {
      const o = document.createElement('canvas'); o.width = W; o.height = H;
      const oc = o.getContext('2d', { willReadFrequently: true });
      oc.drawImage(canvas, 0, 0);
      const d = oc.getImageData(0, 0, W, H).data;
      return probes.map(([x, y]) => d[(y * W + x) * 4] / 255);
    };
    const through = (source, passes) => {
      const cv = document.createElement('canvas');
      const graph = createRenderGraph(cv);
      graph.resize(W, H);
      graph.render(source, passes);
      const got = readProbes(cv);
      graph.dispose();
      return got;
    };

    const rows = {};
    for (const [name, { source, mask }] of Object.entries(shapes)) {
      const bitmap = await createImageBitmap(source);
      for (const [kind, from] of [['canvas', source], ['bitmap', bitmap]]) {
        // What the source really is at each probe, measured rather than assumed
        // -- a fill colour is rounded to 8 bits and the ramp is not exact.
        const base = through(from, [passthroughPass]);
        const got = through(from, [makeLayerPass({ lut: toBlack, mask, aspectRatio: AR, id: `m:${name}` })]);
        let worst = 0;
        probes.forEach(([, ], i) => {
          if (base[i] < 0.15) return; // too dark to divide by
          const measured = 1 - got[i] / base[i];
          const [u, v] = uvOf(probes[i]);
          const want = maskMod.maskAt(mask, u, v, base[i], AR);
          worst = Math.max(worst, Math.abs(measured - want));
        });
        rows[`${name}_${kind}`] = Number(worst.toFixed(4));
      }
      bitmap.close();
      // And that the shape is not accidentally uniform over these probes, which
      // would make the rows above pass on a mask that does nothing.
      const base = through(source, [passthroughPass]);
      const spread = probes.map((p, i) => maskMod.maskAt(mask, ...uvOf(p), base[i], AR));
      rows[`${name}_spread`] = Number((Math.max(...spread) - Math.min(...spread)).toFixed(3));
    }
    // Opacity ~0 must be the picture untouched, which is what lets a parked
    // layer be skipped rather than mixed by zero.
    {
      const got = through(white, [
        makeLayerPass({ lut: toBlack, mask: null, opacity: 0.0001, aspectRatio: AR, id: 'm:zero' }),
      ]);
      rows.nearlyOff = Number((1 - got[0]).toFixed(4));
    }
    results.mask = rows;
  }

  // --- swapping passes: is a reused grader the same as a fresh one? --------
  //
  // `graderFor` stopped rebuilding the grader when only the passes move, so a
  // context now outlives its pass list. Two ways that goes wrong in silence: a
  // stale held copy served after the swap, and the replaced pass's textures
  // leaking (which nothing here can see, but `dispose` is what answers it).
  {
    const { makeFrameGrader } = await import('/atelier/src/shared/lut/frame-grader.ts');
    const { holdGrades } = await import('/atelier/src/shared/lut/held-grader.ts');
    const { makeLayerPass } = await import('/atelier/src/shared/render/layer-pass.ts');
    const maskMod = await import('/atelier/src/shared/render/mask.ts');

    const W = 160, H = 120;
    const grey = document.createElement('canvas');
    grey.width = W; grey.height = H;
    const gg = grey.getContext('2d');
    gg.fillStyle = '#9a9a9a'; gg.fillRect(0, 0, W, H);

    const toBlack = {
      title: 'black', size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1],
      data: new Float32Array(2 * 2 * 2 * 3),
    };
    const passFor = (y) => makeLayerPass({
      lut: toBlack,
      mask: { ...maskMod.DEFAULT_LINEAR, x: 0.5, y, angle: 0, feather: 0.2 },
      aspectRatio: W / H,
      id: 'swap',
    });
    const readTop = (canvas) => {
      const o = document.createElement('canvas'); o.width = W; o.height = H;
      const oc = o.getContext('2d', { willReadFrequently: true });
      oc.drawImage(canvas, 0, 0);
      const d = oc.getImageData(0, 0, W, H).data;
      const at = (fy) => d[((Math.round(H * fy) * W) + (W >> 1)) * 4];
      return [at(0.08), at(0.5), at(0.92)];
    };

    // One grader, graded at y = 0.2, then SWAPPED to y = 0.8 and graded again.
    const reused = holdGrades(makeFrameGrader(null, W, H, 1, [passFor(0.2)]));
    readTop(reused.render(grey));
    reused.setPasses([passFor(0.8)]);
    const swapped = readTop(reused.render(grey));
    reused.dispose();

    // A grader built from scratch at y = 0.8, which is the answer.
    const fresh = holdGrades(makeFrameGrader(null, W, H, 1, [passFor(0.8)]));
    const built = readTop(fresh.render(grey));
    fresh.dispose();

    // The same again from an ImageBitmap, which the graph uploads ONCE and
    // keeps across a swap: this row is what proves the kept upload is the
    // picture and not a stale or empty texture. A canvas is re-uploaded every
    // time, so the row above cannot see that path at all.
    const greyBitmap = await createImageBitmap(grey);
    const reusedB = holdGrades(makeFrameGrader(null, W, H, 1, [passFor(0.2)]));
    readTop(reusedB.render(greyBitmap));
    reusedB.setPasses([passFor(0.8)]);
    const swappedBitmap = readTop(reusedB.render(greyBitmap));
    // And a THIRD render with the same bitmap and the same passes: the cached
    // upload, drawn again, must still be the picture.
    const again = readTop(reusedB.render(greyBitmap));
    reusedB.dispose();
    greyBitmap.close();

    results.swap = { swapped, built, swappedBitmap, again, canSwap: Boolean(reused.setPasses) };
  }

  // --- the cube without OES_texture_float_linear: half-float, never 8-bit --
  //
  // This GPU has the extension, so the fallback would otherwise run nowhere a
  // gate can see it — which is how the old RGBA8 branch clamped a cube's
  // highlight rolloff for years on the GPUs that took it. The extension is
  // taken away here by hand, on every context made inside the block, and the
  // same look must come back within a code of the float path and be a picture.
  {
    const { makeGraphGrader } = await import('/atelier/src/shared/render/graph-grader.ts');
    const { cubeInternalFormat } = await import('/atelier/src/shared/render/cube-pass.ts');

    const withFloat = makeGraphGrader(cube, W, H, 1, 'tetrahedral');
    const a = read(withFloat.render(bitmap));
    withFloat.dispose();

    // The grader draws on an OffscreenCanvas where there is one, an element
    // elsewhere: both are patched, so the row cannot pass by missing the path.
    const protos = [HTMLCanvasElement.prototype, OffscreenCanvas.prototype];
    const real = protos.map((p) => p.getContext);
    let formatSeen = null;
    protos.forEach((proto, i) => {
      proto.getContext = function (kind, ...rest) {
        const ctx = real[i].call(this, kind, ...rest);
        if (ctx && kind === 'webgl2') {
          const realGetExtension = ctx.getExtension.bind(ctx);
          ctx.getExtension = (name) => (name === 'OES_texture_float_linear' ? null : realGetExtension(name));
          formatSeen = cubeInternalFormat(ctx) === ctx.RGBA16F ? 'RGBA16F' : 'RGBA32F';
        }
        return ctx;
      };
    });
    let b;
    try {
      const withoutFloat = makeGraphGrader(cube, W, H, 1, 'tetrahedral');
      b = read(withoutFloat.render(bitmap));
      withoutFloat.dispose();
    } finally {
      protos.forEach((proto, i) => { proto.getContext = real[i]; });
    }
    let sum = 0;
    for (let i = 0; i < b.length; i += 4) sum += b[i] + b[i + 1] + b[i + 2];
    results.halfCube = { ...worst(a, b), format: formatSeen, mean: sum / (b.length / 4) / 3 };
  }

  return results;
});

await browser.close();

const kx = out.keystone;
const away = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));

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
console.log(`\n  keystone: a 90 degree turn; the matrix says ${JSON.stringify(kx.expected)}`);
// The harness first: a passthrough must leave the marker where it was drawn,
// from EITHER source kind, or every row here is measuring an upside-down page.
for (const [name, at] of [['canvas', kx.restCanvas], ['ImageBitmap', kx.restBitmap]]) {
  const off = away(at, [-0.25, -0.25]);
  if (off > 0.02) {
    bad += 1;
    console.log(`  FAIL  untouched, a ${name} source puts the marker at ${JSON.stringify(at)}`);
  }
}
// Then the warp itself, from both. A canvas and an ImageBitmap hand the shader
// opposite y conventions, so one of them passing proves nothing about the
// other — which is how a mirrored keystone shipped on every decoded photograph.
for (const [name, at] of [['canvas     ', kx.viaCanvas], ['ImageBitmap', kx.viaBitmap]]) {
  const off = away(at, kx.expected);
  const ok = off <= 0.02;
  if (!ok) bad += 1;
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'}  ${name} source lands at ${JSON.stringify(at)}` +
      (ok ? `, within ${off.toFixed(4)}` : `, out by ${off.toFixed(3)}`),
  );
}
// And the two must agree with EACH OTHER, which is the property that actually
// broke: both could be wrong the same way and still be one picture.
if (away(kx.viaCanvas, kx.viaBitmap) > 0.02) {
  bad += 1;
  console.log('  FAIL  the two source kinds warp differently');
}

const lens = out.lens;
console.log(
  `\n  lens: a marker at radius ${lens.sourceR} lands at ${lens.gotR}, ` +
    `lensSampleRadius solves for ${lens.expectedR}`,
);
if (!lens.lit) {
  bad += 1;
  console.log('  FAIL  nothing was lit at all — the warp threw the marker off the frame');
} else if (Math.abs(lens.gotR - lens.expectedR) > 0.01) {
  bad += 1;
  console.log(
    `  FAIL  the warp disagrees with lens.ts by ${Math.abs(lens.gotR - lens.expectedR).toFixed(4)}`,
  );
} else if (Math.abs(lens.gotR - lens.sourceR) < 0.01) {
  // If the corrected radius equalled the source's, the pass did nothing and the
  // check would pass on an empty shader for ever after.
  bad += 1;
  console.log('  FAIL  the marker did not move, so this check proves nothing any more');
} else {
  console.log(
    `  ok    within ${Math.abs(lens.gotR - lens.expectedR).toFixed(4)}, ` +
      `and it moved ${Math.abs(lens.gotR - lens.sourceR).toFixed(3)} to get there`,
  );
}

const vig = out.vignette;
console.log(
  `  vignette: centre ${vig.centre}, corner ${vig.out}, vignetteGain says ${vig.expected}`,
);
if (Math.abs(vig.out - vig.expected) > 2) {
  bad += 1;
  console.log(`  FAIL  the lift disagrees with lens.ts by ${Math.abs(vig.out - vig.expected)} codes`);
} else {
  console.log(`  ok    within ${Math.abs(vig.out - vig.expected)} code(s) of it`);
}

const mask = out.mask;
console.log('\n  masks, against maskAt over 20 points of the frame:');
for (const shape of ['linear', 'radial', 'luma', 'brush']) {
  const spread = mask[`${shape}_spread`];
  const worst = Math.max(mask[`${shape}_canvas`], mask[`${shape}_bitmap`]);
  // 1/255 is one 8-bit code; the read-back is through a byte canvas.
  const ok = worst <= 0.006 && spread > 0.05;
  if (!ok) bad += 1;
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'}  ${shape.padEnd(7)} worst ${worst.toFixed(4)} ` +
      `(canvas ${mask[`${shape}_canvas`]}, bitmap ${mask[`${shape}_bitmap`]}), ` +
      `spread ${spread}${spread > 0.05 ? '' : ' — FLAT, so this row proves nothing'}`,
  );
}
if (mask.nearlyOff > 0.002) {
  bad += 1;
  console.log(`  FAIL  a layer at opacity ~0 changed the picture by ${mask.nearlyOff}`);
} else {
  console.log(`  ok    a layer at opacity ~0 leaves the picture alone (${mask.nearlyOff})`);
}

const swap = out.swap;
if (!swap.canSwap) {
  bad += 1;
  console.log('\n  FAIL  the held grader cannot swap its passes at all');
} else {
  const off = Math.max(...swap.swapped.map((v, i) => Math.abs(v - swap.built[i])));
  const ok = off <= 1;
  if (!ok) bad += 1;
  console.log(
    `\n  ${ok ? 'ok  ' : 'FAIL'}  a grader whose passes were swapped reads ` +
      `${JSON.stringify(swap.swapped)}, a fresh one ${JSON.stringify(swap.built)}`,
  );
  const offB = Math.max(
    ...swap.swappedBitmap.map((v, i) => Math.abs(v - swap.built[i])),
    ...swap.again.map((v, i) => Math.abs(v - swap.built[i])),
  );
  const okB = offB <= 1;
  if (!okB) bad += 1;
  console.log(
    `  ${okB ? 'ok  ' : 'FAIL'}  the same from a kept bitmap upload: after the swap ` +
      `${JSON.stringify(swap.swappedBitmap)}, drawn again ${JSON.stringify(swap.again)}`,
  );
  // And that the swap CHANGED something, or the row would pass on a no-op.
  if (swap.built[0] === swap.built[2]) {
    bad += 1;
    console.log('  FAIL  the two pass sets draw the same picture, so this proves nothing');
  }
}

const half = out.halfCube;
{
  const okFormat = half.format === 'RGBA16F';
  const okValue = half.worst <= 1 && half.mean > 16;
  if (!okFormat || !okValue) bad += 1;
  console.log(
    `\n  ${okFormat && okValue ? 'ok  ' : 'FAIL'}  without OES_texture_float_linear the cube is ${half.format}` +
      `, worst ${half.worst} code${half.worst === 1 ? '' : 's'} from the float path (allowed 1)` +
      (half.mean > 16 ? '' : ' — and the picture is BLACK'),
  );
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
