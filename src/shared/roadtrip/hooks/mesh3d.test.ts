import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIGHT,
  box,
  centroid,
  cylinder,
  decal,
  dot,
  faceNormal,
  hexToRgb,
  lighting,
  litColor,
  outward,
  paintMesh,
  project,
  renderOrder,
  rotateAbout,
  sub,
  toWorld,
  viewDirection,
  type Face,
  type Part,
  type Pose,
} from './mesh3d';

const TOP_DOWN = Math.PI / 2;
const pose = (patch: Partial<Pose> = {}): Pose => ({ fx: 0, fy: 1, tilt: TOP_DOWN, scale: 10, x: 100, y: 100, ...patch });

describe('toWorld', () => {
  it('sends the nose where the heading points, the right side a quarter-turn clockwise', () => {
    // Heading east: the nose (+y) lands on +X, the right-hand side (+x) on -Y (south).
    const east = { fx: 1, fy: 0 };
    expect(toWorld([0, 1, 0], east)).toEqual([1, 0, 0]);
    expect(toWorld([1, 0, 0], east)).toEqual([0, -1, 0]);
    // Heading north is the identity.
    expect(toWorld([0.5, 2, 3], { fx: 0, fy: 1 })).toEqual([0.5, 2, 3]);
  });
});

describe('project', () => {
  it('looks straight down at a half-turn: Y up on screen, height invisible', () => {
    const p = pose();
    const a = project([1, 2, 0], p);
    expect(a.x).toBeCloseTo(110, 9);
    expect(a.y).toBeCloseTo(80, 9);
    const high = project([1, 2, 5], p);
    expect(high.y).toBeCloseTo(a.y, 9);
    // Higher is nearer to a camera above.
    expect(high.depth).toBeLessThan(a.depth);
  });

  it('shows height when the camera tilts, and farther north is farther away', () => {
    const p = pose({ tilt: Math.PI / 4 });
    const ground = project([0, 0, 0], p);
    const up = project([0, 0, 1], p);
    expect(up.y).toBeLessThan(ground.y);
    expect(project([0, 1, 0], p).depth).toBeGreaterThan(ground.depth);
  });
});

describe('faceNormal / outward', () => {
  it('reads a counter-clockwise square as facing up', () => {
    expect(faceNormal([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]])).toEqual([0, 0, 1]);
  });

  it('turns every face of a solid to face away from its centre', () => {
    const wrong: Face[] = [{ role: 'r', verts: [[0, 1, 0], [1, 1, 0], [1, 0, 0], [0, 0, 0]] }]; // clockwise: faces down
    const fixed = outward(wrong, [0.5, 0.5, -1]);
    expect(faceNormal(fixed[0].verts)).toEqual([0, 0, 1]);
  });

  it('builds a box whose six faces all point outward', () => {
    const b = box('b', [0, 0, 0], [2, 3, 4], 'body');
    expect(b.faces).toHaveLength(6);
    for (const face of b.faces) {
      expect(dot(faceNormal(face.verts), sub(centroid(face.verts), b.centre))).toBeGreaterThan(0);
    }
  });

  it('builds a cylinder whose caps face along its axis and whose sides face out', () => {
    const c = cylinder('w', [1, 2, 3], 'x', 1, 0.5, 8, { side: 's', cap: 'c' });
    expect(c.faces).toHaveLength(10);
    const caps = c.faces.filter((f) => f.role === 'c').map((f) => faceNormal(f.verts));
    expect(caps.map((n) => Math.round(n[0]))).toEqual(expect.arrayContaining([1, -1]));
    for (const face of c.faces.filter((f) => f.role === 's')) {
      const n = faceNormal(face.verts);
      expect(Math.abs(n[0])).toBeLessThan(1e-9);
      expect(dot(n, sub(centroid(face.verts), c.centre))).toBeGreaterThan(0);
    }
  });

  it('orients a decal the way it is told', () => {
    const d = decal('d', [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], 'r', [0, 0, -1]);
    expect(faceNormal(d.faces[0].verts)).toEqual([0, 0, -1]);
  });
});

describe('rotateAbout', () => {
  it('turns a point a quarter-turn about an axis through a pivot', () => {
    const r = rotateAbout([1, 2, 1], [1, 1, 1], 'x', Math.PI / 2);
    expect(r[0]).toBeCloseTo(1, 9);
    expect(r[1]).toBeCloseTo(1, 9);
    expect(r[2]).toBeCloseTo(2, 9);
  });
});

describe('renderOrder', () => {
  const cube = box('cube', [-1, -1, 0], [1, 1, 2], 'body');

  it('culls what faces away: straight down, a cube shows its top only', () => {
    const faces = renderOrder([cube], pose());
    expect(faces).toHaveLength(1);
    expect(faces[0].points.map((p) => [Math.round(p.x), Math.round(p.y)])).toEqual(
      expect.arrayContaining([
        [90, 90],
        [110, 90],
        [110, 110],
        [90, 110],
      ]),
    );
  });

  it('shows the top and the side nearest the camera once tilted', () => {
    const faces = renderOrder([cube], pose({ tilt: Math.PI / 3 }));
    expect(faces).toHaveLength(2);
    // The top is drawn last: it is nearer a camera above than the south face's middle.
    expect(faces[faces.length - 1].depth).toBeLessThanOrEqual(faces[0].depth);
  });

  it('turns with the heading: heading west, the east side faces the camera... never', () => {
    // Facing west the cube's own +y side points west; the visible side is still the one facing south.
    const faces = renderOrder([cube], pose({ fx: -1, fy: 0, tilt: Math.PI / 3 }));
    expect(faces).toHaveLength(2);
    const view = viewDirection(Math.PI / 3);
    for (const face of faces) expect(face.points.length).toBe(4);
    expect(dot(view, [0, 0, 1])).toBeLessThan(0);
  });

  it('draws a nearer part after a farther one', () => {
    const far = box('far', [-1, 4, 0], [1, 6, 1], 'body');
    const near = box('near', [-1, -6, 0], [1, -4, 1], 'body');
    const faces = renderOrder([near, far], pose({ tilt: Math.PI / 3 }));
    const first = faces[0];
    const last = faces[faces.length - 1];
    expect(first.depth).toBeGreaterThan(last.depth);
  });

  it('spins a part about its axis by the pose’s angle', () => {
    const wheel = cylinder('w', [0, 0, 1], 'x', 1, 0.2, 8, { side: 's', sideAlt: 't', cap: 'c' }, false, true);
    const still = renderOrder([wheel], pose({ tilt: Math.PI / 3 }));
    const turned = renderOrder([wheel], pose({ tilt: Math.PI / 3, spins: { w: Math.PI / 8 } }));
    expect(turned.length).toBe(still.length);
    const shades = (faces: typeof still) => faces.filter((f) => f.role === 's' || f.role === 't').map((f) => f.shade.toFixed(3)).join(',');
    expect(shades(turned)).not.toBe(shades(still));
  });
});

describe('lighting / colours', () => {
  it('lights the roof more than a side turned from the key', () => {
    const up = lighting([0, 0, 1], DEFAULT_LIGHT);
    const north = lighting([0, 1, 0], DEFAULT_LIGHT);
    expect(up.shade).toBeGreaterThan(north.shade);
    expect(up.highlight).toBeGreaterThan(0);
    expect(north.highlight).toBe(0);
  });

  it('reads a hex colour, and falls to grey for anything else', () => {
    expect(hexToRgb('#d9442a')).toEqual([217, 68, 42]);
    expect(hexToRgb('red')).toEqual([128, 128, 128]);
  });

  it('lets a black surface come up under a highlight and clamps at white', () => {
    expect(litColor([28, 28, 30], 0.5, 0.2)).toBe('rgb(65,65,66)');
    expect(litColor([250, 250, 250], 1.2, 0.5)).toBe('rgb(255,255,255)');
  });
});

describe('paintMesh', () => {
  it('fills and strokes every face it is handed, inked where the part asks', () => {
    const calls: string[] = [];
    const strokes: string[] = [];
    const fake = {
      strokeStyle: '',
      save() {},
      restore() {},
      beginPath() {},
      closePath() {},
      moveTo() {},
      lineTo() {},
      fill() {
        calls.push('fill');
      },
      stroke() {
        strokes.push(String(fake.strokeStyle));
      },
      set lineJoin(_v: string) {},
      set lineCap(_v: string) {},
      set fillStyle(_v: string) {},
      set lineWidth(_v: number) {},
    };
    const g = fake as unknown as CanvasRenderingContext2D;
    const outlined: Part = { ...box('a', [0, 0, 0], [1, 1, 1], 'body'), outline: true };
    const plain: Part = { ...box('b', [0, 3, 0], [1, 4, 1], 'body'), outline: false };
    const faces = renderOrder([outlined, plain], pose({ tilt: Math.PI / 3 }));
    paintMesh(g, faces, { palette: { body: '#ffffff' }, ink: '#000000', outlineWidth: 2 });
    expect(calls.length).toBe(faces.length);
    expect(strokes.filter((s) => s === '#000000').length).toBe(faces.filter((f) => f.outline).length);
  });
});
