/**
 * Compile and run the LUT shader on a REAL WebGL2 context, and compare its
 * output against the pure module in src/shared/lut/interpolate.ts.
 *
 * WHY THIS EXISTS. `npm run typecheck`, `lint`, `test` and `build` are all
 * blind to GLSL: the shader is a template literal, nothing in a node test
 * compiles it, and a compile failure degrades silently — createLutRenderer
 * returns null and the grader falls back to pass-through, so exports come out
 * UNGRADED with every gate green. Two real bugs were caught here that all four
 * gates missed:
 *   - a backtick inside a GLSL comment terminates the template literal;
 *   - `flat` is a reserved interpolation qualifier and cannot name a variable.
 * Run this after ANY change to lut-gl.ts.
 *
 * It also guards the invariant that the shader and interpolate.ts are two
 * implementations of one formula: they must agree, or the preview and the
 * export diverge.
 *
 * USAGE:  npm i --no-save playwright   (once; not a project dependency)
 *         node scripts/check-shader.mjs
 * Chromium is expected at /opt/pw-browsers/chromium; override with
 * CHROMIUM_PATH. Software rendering (SwiftShader) is fine — this checks
 * correctness, not speed.
 *
 * Agreement is judged in 8-bit code values because the framebuffer is 8-bit;
 * anything at or below ~0.5 of a code is rounding. Expectations are clamped to
 * [0,1] since the framebuffer clamps on write while the pure module does not.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

const ROOT = new URL('..', import.meta.url).pathname;

/** Pull the two shader sources straight out of lut-gl.ts. */
function shaderSources() {
  const src = readFileSync(new URL('../src/shared/lut/lut-gl.ts', import.meta.url), 'utf8');
  const grab = (name) => {
    const m = new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`).exec(src);
    if (!m) throw new Error(`could not extract ${name} from lut-gl.ts`);
    return m[1];
  };
  return { VERT: grab('VERT_SRC'), FRAG: grab('FRAG_SRC') };
}

/** Load the pure module through Vite so the .ts is the single source of truth. */
async function loadInterpolate() {
  const server = await createServer({
    root: ROOT,
    logLevel: 'error',
    server: { middlewareMode: true },
    // We only ever SSR-load one dependency-free module; letting Vite scan the
    // app's entry races with close() and prints an alarming, harmless error.
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    return await server.ssrLoadModule('/src/shared/lut/interpolate.ts');
  } finally {
    await server.close();
  }
}

const N = 5;
/** Non-affine and channel-asymmetric, so interpolation error actually shows. */
const cube = [];
for (let b = 0; b < N; b += 1)
  for (let g = 0; g < N; g += 1)
    for (let r = 0; r < N; r += 1) {
      const [x, y, z] = [r / (N - 1), g / (N - 1), b / (N - 1)];
      cube.push(Math.pow(x, 0.8), y * 0.9 + 0.05 * z * z, Math.min(1, z * 1.1 - 0.07 * x * x));
    }

const CASES = [
  { label: 'default domain [0,1]', domainMin: [0, 0, 0], domainMax: [1, 1, 1] },
  { label: 'non-unit domain', domainMin: [0.1, 0.1, 0.1], domainMax: [0.9, 0.9, 0.9] },
  { label: 'asymmetric per-channel', domainMin: [0, 0.2, 0.05], domainMax: [0.8, 1, 0.75] },
  { label: 'degenerate (zero span)', domainMin: [0.5, 0, 0], domainMax: [0.5, 1, 1] },
];

const inputs = [];
for (let i = 0; i <= 12; i += 1) inputs.push([i / 12, i / 12, i / 12]);
for (const t of [[0.15, 0.7, 0.35], [0.85, 0.25, 0.6], [0.05, 0.95, 0.5], [0.5, 0.1, 0.9]]) inputs.push(t);

const { VERT, FRAG } = shaderSources();

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage();
const gpu = await page.evaluate(
  ({ VERT, FRAG, cube, inputs, N, CASES }) => {
    const W = inputs.length;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = 1;
    const gl = cv.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) return { error: 'no WebGL2' };
    const compile = (type, source) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, source);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      return sh;
    };
    const prog = gl.createProgram();
    try {
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    } catch (e) {
      return { error: String(e.message ?? e) };
    }
    gl.useProgram(prog);

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    const px = new Uint8Array(W * 4);
    inputs.forEach((c, i) => {
      px[i * 4] = Math.round(c[0] * 255);
      px[i * 4 + 1] = Math.round(c[1] * 255);
      px[i * 4 + 2] = Math.round(c[2] * 255);
      px[i * 4 + 3] = 255;
    });
    const vt = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, vt);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);

    const lt = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, lt);
    for (const w of ['TEXTURE_WRAP_S', 'TEXTURE_WRAP_T', 'TEXTURE_WRAP_R'])
      gl.texParameteri(gl.TEXTURE_3D, gl[w], gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.getExtension('OES_texture_float_linear');
    const rgba = new Float32Array(N * N * N * 4);
    for (let i = 0; i < N * N * N; i += 1) {
      rgba[i * 4] = cube[i * 3];
      rgba[i * 4 + 1] = cube[i * 3 + 1];
      rgba[i * 4 + 2] = cube[i * 3 + 2];
      rgba[i * 4 + 3] = 1;
    }
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA32F, N, N, N, 0, gl.RGBA, gl.FLOAT, rgba);

    const U = (n) => gl.getUniformLocation(prog, n);
    gl.uniform1i(U('u_video'), 0);
    gl.uniform1i(U('u_lut'), 1);
    gl.uniform1i(U('u_hasLut'), 1);
    gl.uniform1f(U('u_lutSize'), N);
    gl.uniform1f(U('u_intensity'), 1);
    gl.uniform1i(U('u_split'), 0);
    gl.viewport(0, 0, W, 1);
    const read = () => {
      const o = new Uint8Array(W * 4);
      gl.readPixels(0, 0, W, 1, gl.RGBA, gl.UNSIGNED_BYTE, o);
      return inputs.map((_, i) => [o[i * 4] / 255, o[i * 4 + 1] / 255, o[i * 4 + 2] / 255]);
    };

    const res = {};
    for (const c of CASES) {
      gl.uniform3f(U('u_domainMin'), ...c.domainMin);
      gl.uniform3f(U('u_domainMax'), ...c.domainMax);
      gl.uniform1i(U('u_tetra'), 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      const tetra = read();
      gl.uniform1i(U('u_tetra'), 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      const tri = read();
      res[c.label] = { tetra, tri };
    }
    return { res, renderer: gl.getParameter(gl.RENDERER) };
  },
  { VERT, FRAG, cube, inputs, N, CASES },
);
await browser.close();

if (gpu.error) {
  console.error(`\n  SHADER FAILED TO COMPILE OR LINK:\n\n${gpu.error}\n`);
  process.exit(1);
}

const { sampleTetrahedral, sampleTrilinear } = await loadInterpolate();
const q = (c) => c.map((v) => Math.round(v * 255) / 255);
const clamp01 = (c) => c.map((v) => (v < 0 ? 0 : v > 1 ? 1 : v));
/** The framebuffer is 8-bit, so half a code is rounding, not disagreement. */
const TOLERANCE_CODES = 1.5;

console.log(`\n  renderer: ${gpu.renderer}\n`);
let failed = false;
for (const c of CASES) {
  const lut = {
    size: N,
    data: new Float32Array(cube),
    domainMin: c.domainMin,
    domainMax: c.domainMax,
  };
  let worstTet = 0;
  let worstTri = 0;
  inputs.forEach((inp, i) => {
    const wantTet = clamp01(sampleTetrahedral(lut, ...q(inp)));
    const wantTri = clamp01(sampleTrilinear(lut, ...q(inp)));
    for (let ch = 0; ch < 3; ch += 1) {
      worstTet = Math.max(worstTet, Math.abs(gpu.res[c.label].tetra[i][ch] - wantTet[ch]) * 255);
      worstTri = Math.max(worstTri, Math.abs(gpu.res[c.label].tri[i][ch] - wantTri[ch]) * 255);
    }
  });
  const bad = worstTet > TOLERANCE_CODES || worstTri > TOLERANCE_CODES;
  failed ||= bad;
  console.log(
    `  ${bad ? 'FAIL' : 'ok  '}  ${c.label.padEnd(24)} tetrahedral ${worstTet.toFixed(2)} · trilinear ${worstTri.toFixed(2)} codes`,
  );
}
console.log(
  failed
    ? '\n  The shader and interpolate.ts disagree. Preview and export would diverge.\n'
    : '\n  Shader compiles, and agrees with the pure module within rounding.\n',
);
process.exit(failed ? 1 : 0);
