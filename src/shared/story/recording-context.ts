/**
 * A 2D context that WRITES DOWN what it is asked to paint (strategy R5, the
 * reference frames): every fill, stroke, text and image, with where it lands
 * on the frame — the current transform applied — its colour, its alpha and
 * its face, rounded so a sub-pixel drift is not a change. Two frames that
 * paint the same things in the same places record the same list, on any
 * machine: unlike a PNG, no font rasteriser, GPU or OS changes it, so it can
 * be compared in CI. Text is measured as `nullContext` measures it (half an
 * em a letter), which is all a layout needs to be stable. (pure)
 */

type M = [number, number, number, number, number, number];
const ID: M = [1, 0, 0, 1, 0, 0];
const mul = (a: M, b: M): M => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];
const apply = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** How finely a position is told apart, in frame pixels: a change under it is not a change. */
export const RECORD_GRID = 2;
const r = (v: number) => Math.round(v / RECORD_GRID) * RECORD_GRID;
const a2 = (v: number) => Math.round(v * 100) / 100;

export interface Recording {
  ctx: CanvasRenderingContext2D;
  /** One line a paint, in order. */
  ops: string[];
  /** The words painted, in order. */
  texts: string[];
}

/** A box over points, transformed. */
class Box {
  x0 = Infinity;
  y0 = Infinity;
  x1 = -Infinity;
  y1 = -Infinity;
  add([x, y]: [number, number]) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.x0 = Math.min(this.x0, x);
    this.y0 = Math.min(this.y0, y);
    this.x1 = Math.max(this.x1, x);
    this.y1 = Math.max(this.y1, y);
  }
  get empty() {
    return this.x1 < this.x0;
  }
  text() {
    return this.empty ? 'empty' : `${r(this.x0)},${r(this.y0)} ${r(this.x1 - this.x0)}x${r(this.y1 - this.y0)}`;
  }
}

/**
 * A `Path2D` for where there is none (Node): it keeps the path's points, and
 * a recording context filling or stroking it boxes them under its transform.
 */
export class RecordingPath2D {
  readonly points: [number, number][] = [];
  constructor(from?: RecordingPath2D | string) {
    if (from instanceof RecordingPath2D) this.points.push(...from.points);
  }
  moveTo(x: number, y: number) {
    this.points.push([x, y]);
  }
  lineTo(x: number, y: number) {
    this.points.push([x, y]);
  }
  quadraticCurveTo(_cx: number, _cy: number, x: number, y: number) {
    this.points.push([x, y]);
  }
  bezierCurveTo(_a: number, _b: number, _c: number, _d: number, x: number, y: number) {
    this.points.push([x, y]);
  }
  arc(x: number, y: number, r: number) {
    this.points.push([x - r, y - r], [x + r, y + r]);
  }
  ellipse(x: number, y: number, rx: number, ry: number) {
    this.points.push([x - rx, y - ry], [x + rx, y + ry]);
  }
  rect(x: number, y: number, w: number, h: number) {
    this.points.push([x, y], [x + w, y + h]);
  }
  roundRect(x: number, y: number, w: number, h: number) {
    this.rect(x, y, w, h);
  }
  arcTo(x1: number, y1: number, x2: number, y2: number) {
    this.points.push([x1, y1], [x2, y2]);
  }
  closePath() {}
  addPath(p: RecordingPath2D) {
    this.points.push(...p.points);
  }
}

const colour = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, '').toLowerCase() : 'paint');

export function recordingContext(width = 1080, height = 1920): Recording {
  const ops: string[] = [];
  const texts: string[] = [];
  const state: Record<string | symbol, unknown> = {
    globalAlpha: 1,
    font: '10px sans-serif',
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    canvas: { width, height },
  };
  let m: M = [...ID];
  const stack: { m: M; state: Record<string | symbol, unknown> }[] = [];
  let path = new Box();
  const px = () => Number(/(\d+(?:\.\d+)?)px/.exec(String(state.font))?.[1] ?? 10);
  const style = (which: 'fill' | 'stroke') => `${colour(state[`${which}Style`])} a${a2(Number(state.globalAlpha))}`;
  const rectBox = (x: number, y: number, w: number, h: number) => {
    const b = new Box();
    b.add(apply(m, x, y));
    b.add(apply(m, x + w, y));
    b.add(apply(m, x, y + h));
    b.add(apply(m, x + w, y + h));
    return b;
  };
  // A Path2D handed to fill/stroke/clip, boxed under the transform in force; else the current path.
  const of = (p: unknown): Box => {
    if (!(p instanceof RecordingPath2D)) return path;
    const b = new Box();
    for (const [x, y] of p.points) b.add(apply(m, x, y));
    return b;
  };
  const visible = () => Number(state.globalAlpha) > 0.004;

  // The canvas API's own variety of signatures: each method reads what it needs.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const methods: Record<string, (...a: any[]) => unknown> = {
    save: () => void stack.push({ m: [...m], state: { ...state } }),
    restore: () => {
      const s = stack.pop();
      if (!s) return;
      m = s.m;
      for (const k of Object.keys(state)) delete state[k];
      Object.assign(state, s.state);
    },
    setTransform: (...a: unknown[]) => {
      const v = a.length === 1 && a[0] && typeof a[0] === 'object' ? a[0] as { a: number; b: number; c: number; d: number; e: number; f: number } : null;
      m = v ? [v.a, v.b, v.c, v.d, v.e, v.f] : (a.slice(0, 6) as M);
    },
    resetTransform: () => void (m = [...ID]),
    transform: (...a: unknown[]) => void (m = mul(m, a.slice(0, 6) as M)),
    translate: (x, y) => void (m = mul(m, [1, 0, 0, 1, x as number, y as number])),
    scale: (x, y) => void (m = mul(m, [x as number, 0, 0, y as number, 0, 0])),
    rotate: (t) => void (m = mul(m, [Math.cos(t as number), Math.sin(t as number), -Math.sin(t as number), Math.cos(t as number), 0, 0])),
    getTransform: () => ({ a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5] }),
    beginPath: () => void (path = new Box()),
    moveTo: (x, y) => path.add(apply(m, x as number, y as number)),
    lineTo: (x, y) => path.add(apply(m, x as number, y as number)),
    quadraticCurveTo: (_cx, _cy, x, y) => path.add(apply(m, x as number, y as number)),
    bezierCurveTo: (_a, _b, _c, _d, x, y) => path.add(apply(m, x as number, y as number)),
    arcTo: (x1, y1, x2, y2) => {
      path.add(apply(m, x1 as number, y1 as number));
      path.add(apply(m, x2 as number, y2 as number));
    },
    arc: (x, y, rad) => {
      path.add(apply(m, (x as number) - (rad as number), (y as number) - (rad as number)));
      path.add(apply(m, (x as number) + (rad as number), (y as number) + (rad as number)));
    },
    ellipse: (x, y, rx, ry) => {
      path.add(apply(m, (x as number) - (rx as number), (y as number) - (ry as number)));
      path.add(apply(m, (x as number) + (rx as number), (y as number) + (ry as number)));
    },
    rect: (x, y, w, h) => {
      const b = rectBox(x as number, y as number, w as number, h as number);
      path.add([b.x0, b.y0]);
      path.add([b.x1, b.y1]);
    },
    roundRect: (x, y, w, h) => methods.rect(x, y, w, h),
    closePath: () => undefined,
    fill: (p) => void (visible() && ops.push(`fill ${of(p).text()} ${style('fill')}`)),
    stroke: (p) => void (visible() && ops.push(`stroke ${of(p).text()} ${style('stroke')} w${a2(Number(state.lineWidth))}`)),
    clip: (p) => void ops.push(`clip ${of(p).text()}`),
    fillRect: (x, y, w, h) => void (visible() && ops.push(`fillRect ${rectBox(x as number, y as number, w as number, h as number).text()} ${style('fill')}`)),
    strokeRect: (x, y, w, h) => void (visible() && ops.push(`strokeRect ${rectBox(x as number, y as number, w as number, h as number).text()} ${style('stroke')}`)),
    clearRect: (x, y, w, h) => void ops.push(`clear ${rectBox(x as number, y as number, w as number, h as number).text()}`),
    fillText: (s, x, y) => {
      if (!visible()) return;
      const [tx, ty] = apply(m, x as number, y as number);
      texts.push(String(s));
      ops.push(`text "${String(s)}" ${r(tx)},${r(ty)} ${String(state.font)} ${String(state.textAlign ?? 'start')} ${style('fill')}`);
    },
    strokeText: (s, x, y) => {
      if (!visible()) return;
      const [tx, ty] = apply(m, x as number, y as number);
      ops.push(`strokeText "${String(s)}" ${r(tx)},${r(ty)} ${style('stroke')}`);
    },
    drawImage: (...a: unknown[]) => {
      if (!visible()) return;
      const n = a.length;
      const [x, y, w, h] = (n >= 9 ? a.slice(5, 9) : n >= 5 ? a.slice(1, 5) : [a[1], a[2], 0, 0]) as number[];
      ops.push(`image ${rectBox(x, y, w, h).text()} a${a2(Number(state.globalAlpha))}`);
    },
    measureText: (s) => {
      const p = px();
      const w = String(s).length * p * 0.55;
      return { width: w, actualBoundingBoxAscent: p * 0.75, actualBoundingBoxDescent: p * 0.2, actualBoundingBoxLeft: 0, actualBoundingBoxRight: w, fontBoundingBoxAscent: p * 0.8, fontBoundingBoxDescent: p * 0.2 };
    },
    getImageData: (_x, _y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray((w as number) * (h as number) * 4) }),
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray((w as number) * (h as number) * 4) }),
    putImageData: () => void ops.push('putImageData'),
    setLineDash: () => undefined,
    getLineDash: () => [],
    isPointInPath: () => false,
  };
  // A gradient or a pattern is a paint whose colour stops do not matter to a layout.
  const paint = { addColorStop: () => undefined, setTransform: () => undefined };
  for (const k of ['createLinearGradient', 'createRadialGradient', 'createConicGradient', 'createPattern']) methods[k] = () => paint;

  const ctx = new Proxy({} as object, {
    get(_t, prop) {
      if (typeof prop === 'string' && prop in methods) return methods[prop];
      if (prop in state) return state[prop];
      return undefined;
    },
    set(_t, prop, value) {
      state[prop] = value;
      return true;
    },
  }) as CanvasRenderingContext2D;
  return { ctx, ops, texts };
}

/** FNV-1a over the lines, hex: a frame's fingerprint. (pure) */
export function fingerprint(lines: readonly string[]): string {
  let h = 0x811c9dc5;
  for (const line of lines)
    for (let i = 0; i <= line.length; i++) {
      h ^= i === line.length ? 10 : line.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  return (h >>> 0).toString(16).padStart(8, '0');
}
