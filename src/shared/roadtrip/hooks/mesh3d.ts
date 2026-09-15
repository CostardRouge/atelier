/**
 * A very small software 3D renderer for a cartoon on a map — the car the
 * drive opener moves, and nothing heavier.
 *
 * Why not a 3D library: the car is ~180 flat-shaded faces drawn a few hundred
 * times per export, into the same 2D context every other opener paints in.
 * A WebGL scene would cost a dependency the size of the rest of the tool, a
 * context that is never reclaimed (`media-pipeline.md`) and a copy per frame
 * into the 2D canvas; a painter's algorithm over convex parts costs nothing
 * and stays inside the engine's one seam.
 *
 * The model: a list of PARTS, each a convex solid (a box, a cylinder, an
 * extruded plan) or a flat decal, made of faces wound counter-clockwise seen
 * from outside. Convexity is what makes the picture right without a depth
 * buffer: within a part, back-face culling alone leaves exactly the visible
 * faces; between parts, the one whose centre is nearer is drawn later. The
 * view is a 2.5D orthographic camera looking north and down at `tilt` above
 * the ground — a half-turn (π/2) is straight down, the map's own view.
 *
 * Coordinates. Model: x to the right, y forward (the nose), z up, ground at
 * z = 0. World: X east (screen right), Y north (screen UP), Z up. The pose
 * turns the model about Z so its nose points along a unit heading (fx, fy),
 * then scales it to pixels and places its origin on screen.
 *
 * Pure geometry, one paint function at the end; DOM-free.
 */

export type Vec3 = readonly [number, number, number];

export interface Face {
  verts: readonly Vec3[];
  /** A colour role, resolved through a palette at paint time. */
  role: string;
}

export interface Part {
  id: string;
  faces: Face[];
  /** The part's middle — what orders parts against each other. */
  centre: Vec3;
  /** Draw the ink outline on this part's faces. */
  outline: boolean;
  /** Turn the part about an axis through `pivot` by the pose's spin for its id. */
  spin?: { pivot: Vec3; axis: 'x' | 'y' | 'z' };
}

export interface Pose {
  /** The nose's direction in the world: a unit vector, X east and Y north. */
  fx: number;
  fy: number;
  /** The camera's elevation above the ground, radians; π/2 looks straight down. */
  tilt: number;
  /** Pixels per model unit. */
  scale: number;
  /** Where the model's origin lands on screen. */
  x: number;
  y: number;
  /** Spin angles, radians, by part id — the wheels. */
  spins?: Readonly<Record<string, number>>;
}

export interface Projected {
  x: number;
  y: number;
  /** Larger is farther from the camera. */
  depth: number;
}

/** A model-space point after the pose, in world axes, still in model units. */
export function toWorld(p: Vec3, pose: Pick<Pose, 'fx' | 'fy'>): Vec3 {
  const [x, y, z] = p;
  // R·(0,1) = (fx, fy): the nose goes where the heading points, the right-hand
  // side a quarter-turn clockwise from it.
  return [x * pose.fy + y * pose.fx, -x * pose.fx + y * pose.fy, z];
}

/** A world point on screen, and its distance along the view. */
export function project(w: Vec3, pose: Pick<Pose, 'tilt' | 'scale' | 'x' | 'y'>): Projected {
  const [X, Y, Z] = w;
  const s = Math.sin(pose.tilt);
  const c = Math.cos(pose.tilt);
  return {
    x: pose.x + X * pose.scale,
    y: pose.y - (Y * s + Z * c) * pose.scale,
    depth: Y * c - Z * s,
  };
}

/** The camera's own direction of view, for the tilt: north and down. */
export function viewDirection(tilt: number): Vec3 {
  return [0, Math.cos(tilt), -Math.sin(tilt)];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function normalise(v: Vec3): Vec3 {
  const n = Math.hypot(v[0], v[1], v[2]);
  return n > 0 ? [v[0] / n, v[1] / n, v[2] / n] : [0, 0, 1];
}

/** A polygon's normal by Newell's method — sound for any planar polygon. */
export function faceNormal(verts: readonly Vec3[]): Vec3 {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return normalise([nx, ny, nz]);
}

export function centroid(verts: readonly Vec3[]): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const v of verts) {
    x += v[0];
    y += v[1];
    z += v[2];
  }
  const n = Math.max(1, verts.length);
  return [x / n, y / n, z / n];
}

/** Rotate `p` about an axis through `pivot` by `angle` radians. */
export function rotateAbout(p: Vec3, pivot: Vec3, axis: 'x' | 'y' | 'z', angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const [x, y, z] = sub(p, pivot);
  let r: Vec3;
  if (axis === 'x') r = [x, y * c - z * s, y * s + z * c];
  else if (axis === 'y') r = [x * c + z * s, y, -x * s + z * c];
  else r = [x * c - y * s, x * s + y * c, z];
  return [r[0] + pivot[0], r[1] + pivot[1], r[2] + pivot[2]];
}

/**
 * The light. Two directional lights, world-space unit vectors TOWARD each: a
 * key from behind the camera's left shoulder and high, a weaker fill from the
 * other side, so no side of a turning car is ever the same flat tone as its
 * neighbour. The key also throws a highlight, which is what lets a black car
 * read as a shape rather than a silhouette.
 */
export interface Light {
  key: Vec3;
  fill: Vec3;
  ambient: number;
  keyWeight: number;
  fillWeight: number;
  /** Strength of the highlight the key throws, 0..1. */
  gloss: number;
  /**
   * A broad, additive sheen from the key — light that a matte coating
   * scatters back rather than reflects. A multiplier cannot lift a black
   * surface, so a matte black car with no gloss would be a silhouette with
   * inked edges; this is the term that keeps it a shape. Absent = none.
   */
  sheen?: number;
}

export const DEFAULT_LIGHT: Light = {
  key: normalise([-0.5, -0.42, 0.75]),
  fill: normalise([0.6, 0.5, 0.55]),
  ambient: 0.4,
  keyWeight: 0.48,
  fillWeight: 0.16,
  gloss: 0.34,
};

/** The shade (multiplier) and the highlight (added) a face of normal `n` gets. */
export function lighting(n: Vec3, light: Light): { shade: number; highlight: number } {
  const k = Math.max(0, dot(n, light.key));
  const f = Math.max(0, dot(n, light.fill));
  return {
    shade: light.ambient + light.keyWeight * k + light.fillWeight * f,
    highlight: light.gloss * k ** 3 + (light.sheen ?? 0) * k,
  };
}

const HEX = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

/** `#rrggbb` → [r, g, b]; anything else is mid grey rather than a throw. */
export function hexToRgb(hex: string): [number, number, number] {
  const m = HEX.exec(hex);
  if (!m) return [128, 128, 128];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/** A colour under a shade and a highlight, as a CSS string. */
export function litColor(rgb: readonly [number, number, number], shade: number, highlight: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * shade + 255 * highlight)));
  return `rgb(${c(rgb[0])},${c(rgb[1])},${c(rgb[2])})`;
}

export interface RenderedFace {
  points: readonly { x: number; y: number }[];
  role: string;
  shade: number;
  highlight: number;
  outline: boolean;
  depth: number;
}

/**
 * Every visible face of every part under `pose`, back to front — what the
 * paint draws in order. Culling is by the face's world normal against the
 * view; ordering is ONE sort over every visible face, keyed on the depth of
 * the face's FARTHEST vertex.
 *
 * Not by part. Comparing two parts by their centres is only sound when
 * neither one's span along the view contains the other's, and this model
 * breaks that everywhere: a decal lies ON the face that carries it, the
 * cabin sits ON a body whose top face spans the whole car. Where the
 * comparison flipped, a whole part was painted over and simply was not
 * there — the wrap-around corner lights lost to the body for a ~20° arc of
 * headings at every elevation, the cabin lost to the body's top plate for up
 * to 95° of them below 46°. Dissolving the grouping costs nothing, because a
 * part is convex and, after culling, no two of its own visible faces overlap.
 *
 * The farthest vertex rather than the average: a face that spans the whole
 * car then sorts by the end that is genuinely behind everything, so it is
 * laid down first and cannot cover what stands in front of it. It is also
 * exact for a decal, whose outline sits inside the face it is pushed off —
 * depth is linear over a plane, so the maximum over the smaller polygon
 * cannot exceed the maximum over the one containing it. An average key is
 * measurably worse and the nearest vertex is worse still; `render-order.test.ts`
 * is the gate that says so at every angle.
 *
 * Equal keys keep the order they were built in, so the same pose paints the
 * same sequence twice — a video export cannot shimmer where a still looks
 * right.
 */
export function renderOrder(parts: readonly Part[], pose: Pose, light: Light = DEFAULT_LIGHT): RenderedFace[] {
  const view = viewDirection(pose.tilt);
  const out: RenderedFace[] = [];
  const emitted: number[] = [];

  for (const part of parts) {
    const spin = part.spin ? (pose.spins?.[part.id] ?? 0) : 0;
    for (const face of part.faces) {
      const world = face.verts.map((v) => {
        const turned = part.spin && spin !== 0 ? rotateAbout(v, part.spin.pivot, part.spin.axis, spin) : v;
        return toWorld(turned, pose);
      });
      const n = faceNormal(world);
      // A polygon with no area has no normal to speak of — `faceNormal` hands
      // back a default that would sail through the cull and paint a sliver.
      if (n[0] === 0 && n[1] === 0 && n[2] === 1 && !hasArea(world)) continue;
      // Facing the camera means facing AGAINST the view direction.
      if (dot(n, view) >= -1e-9) continue;
      const projected = world.map((w) => project(w, pose));
      let depth = -Infinity;
      for (const p of projected) if (p.depth > depth) depth = p.depth;
      const { shade, highlight } = lighting(n, light);
      emitted.push(out.length);
      out.push({
        points: projected.map(({ x, y }) => ({ x, y })),
        role: face.role,
        shade,
        highlight,
        outline: part.outline,
        depth,
      });
    }
  }

  return out
    .map((face, i) => ({ face, i }))
    .sort((a, b) => b.face.depth - a.face.depth || a.i - b.i)
    .map(({ face }) => face);
}

/** Whether a polygon encloses any area at all, in the plane it spans. */
function hasArea(verts: readonly Vec3[]): boolean {
  for (let i = 2; i < verts.length; i++) {
    const u = sub(verts[i - 1], verts[0]);
    const v = sub(verts[i], verts[0]);
    const c = cross(u, v);
    if (Math.hypot(c[0], c[1], c[2]) > 1e-12) return true;
  }
  return false;
}

/** The context the paint accepts — both canvases the engine draws into. */
export type MeshCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface PaintMeshOptions {
  /** Colour by role, `#rrggbb`. An unknown role paints mid grey. */
  palette: Readonly<Record<string, string>>;
  /** The ink outline, and how wide it is in pixels. */
  ink: string;
  outlineWidth: number;
}

/**
 * Draw the ordered faces. Every face is stroked with its own fill first —
 * adjacent fills on a canvas leave hairline seams, and a one-pixel stroke in
 * the same colour is the standard cure — then, on the parts that ask, the
 * ink outline that gives the whole thing its drawn look.
 */
export function paintMesh(g: MeshCtx, faces: readonly RenderedFace[], opts: PaintMeshOptions): void {
  const rgbByRole = new Map<string, [number, number, number]>();
  const rgbOf = (role: string) => {
    let rgb = rgbByRole.get(role);
    if (!rgb) {
      rgb = hexToRgb(opts.palette[role] ?? '#808080');
      rgbByRole.set(role, rgb);
    }
    return rgb;
  };
  g.save();
  g.lineJoin = 'round';
  g.lineCap = 'round';
  for (const face of faces) {
    if (face.points.length < 3) continue;
    const color = litColor(rgbOf(face.role), face.shade, face.highlight);
    g.beginPath();
    g.moveTo(face.points[0].x, face.points[0].y);
    for (let i = 1; i < face.points.length; i++) g.lineTo(face.points[i].x, face.points[i].y);
    g.closePath();
    g.fillStyle = color;
    g.fill();
    g.strokeStyle = face.outline ? opts.ink : color;
    g.lineWidth = face.outline ? opts.outlineWidth : Math.min(1, opts.outlineWidth);
    g.stroke();
  }
  g.restore();
}

// --- builders ----------------------------------------------------------------

/**
 * A convex solid's faces, each wound so its normal points away from the
 * solid's centre — the one property the renderer relies on, enforced here
 * rather than trusted from whoever typed the vertices.
 */
export function outward(faces: Face[], centre: Vec3): Face[] {
  return faces.map((face) => {
    const n = faceNormal(face.verts);
    const away = sub(centroid(face.verts), centre);
    return dot(n, away) < 0 ? { ...face, verts: [...face.verts].reverse() } : face;
  });
}

/** A convex part from faces that may be wound either way. */
export function solid(id: string, faces: Face[], outline = true, spin?: Part['spin']): Part {
  const centre = centroid(faces.flatMap((f) => [...f.verts]));
  return { id, faces: outward(faces, centre), centre, outline, ...(spin ? { spin } : {}) };
}

/**
 * A flat decal — a single face with a stated outward side — drawn a hair off
 * the surface it sits on, so it always lands after that surface.
 */
export function decal(id: string, verts: readonly Vec3[], role: string, normal: Vec3, outline = false): Part {
  const n = faceNormal(verts);
  const face: Face = { verts: dot(n, normal) < 0 ? [...verts].reverse() : [...verts], role };
  return { id, faces: [face], centre: centroid(verts), outline };
}

/** An axis-aligned box from two corners. */
export function box(id: string, a: Vec3, b: Vec3, role: string, outline = true): Part {
  const x0 = Math.min(a[0], b[0]);
  const x1 = Math.max(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]);
  const y1 = Math.max(a[1], b[1]);
  const z0 = Math.min(a[2], b[2]);
  const z1 = Math.max(a[2], b[2]);
  return extrude(
    id,
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ],
    z0,
    z1,
    { side: role, top: role, bottom: role },
    outline,
  );
}

/** A convex plan (x, y) pulled up from `z0` to `z1`. */
/**
 * The roles an extrusion paints with. A cap may be `null`, which builds it
 * NOT AT ALL — for a face that is interior by construction, buried against
 * the block stacked on it. Such a face is not merely invisible: it is a
 * surface the painter's algorithm has to place among the ones you can see,
 * and it will sometimes place it on top of them. The cure is to not have it.
 */
export interface ExtrudeRoles {
  side: string;
  top: string | null;
  bottom: string | null;
}

export function extrude(
  id: string,
  plan: readonly (readonly [number, number])[],
  z0: number,
  z1: number,
  roles: ExtrudeRoles,
  outline = true,
): Part {
  const faces: Face[] = [];
  const n = plan.length;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = plan[i];
    const [bx, by] = plan[(i + 1) % n];
    faces.push({
      role: roles.side,
      verts: [
        [ax, ay, z0],
        [bx, by, z0],
        [bx, by, z1],
        [ax, ay, z1],
      ],
    });
  }
  if (roles.top !== null) faces.push({ role: roles.top, verts: plan.map(([x, y]) => [x, y, z1] as Vec3) });
  if (roles.bottom !== null) faces.push({ role: roles.bottom, verts: plan.map(([x, y]) => [x, y, z0] as Vec3) });
  return solid(id, faces, outline);
}

/**
 * A cylinder about the x or y axis: `segments` side quads and two caps, the
 * side quads alternating between two roles when `sideAlt` is given (a tyre's
 * tread, so its turning shows).
 */
export function cylinder(
  id: string,
  centre: Vec3,
  axis: 'x' | 'y',
  radius: number,
  halfWidth: number,
  segments: number,
  roles: { side: string; sideAlt?: string; cap: string },
  outline = false,
  spin = false,
): Part {
  const ring = (offset: number): Vec3[] =>
    Array.from({ length: segments }, (_, i) => {
      const a = (i / segments) * Math.PI * 2;
      const u = radius * Math.cos(a);
      const v = radius * Math.sin(a);
      return axis === 'x'
        ? [centre[0] + offset, centre[1] + u, centre[2] + v]
        : [centre[0] + u, centre[1] + offset, centre[2] + v];
    });
  const near = ring(-halfWidth);
  const far = ring(halfWidth);
  const faces: Face[] = [];
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    faces.push({
      role: roles.sideAlt && i % 2 ? roles.sideAlt : roles.side,
      verts: [near[i], near[j], far[j], far[i]],
    });
  }
  faces.push({ role: roles.cap, verts: near });
  faces.push({ role: roles.cap, verts: far });
  return solid(id, faces, outline, spin ? { pivot: centre, axis } : undefined);
}

/**
 * A soft ground shadow under a body of `halfLength` × `halfWidth` model units
 * — three ellipses of falling alpha, no shadow blur (`studio.md`: a blur per
 * frame is the one canvas operation the openers avoid). Foreshortened by the
 * tilt like the ground plane it lies on, turned with the heading, and thrown
 * a little north-east, away from the key light, which is what makes the
 * miniature sit ON the map rather than in it.
 */
export function paintGroundShadow(
  g: MeshCtx,
  pose: Pose,
  halfLength: number,
  halfWidth: number,
  alpha = 0.26,
): void {
  const angle = Math.atan2(pose.fx, pose.fy);
  const sinT = Math.sin(pose.tilt);
  g.save();
  g.translate(pose.x + pose.scale * 0.3, pose.y - pose.scale * 0.22 * sinT);
  // Screen y grows downward while world Y grows upward, hence the flip.
  g.scale(1, sinT);
  g.rotate(angle);
  for (const [grow, a] of [
    [1.16, alpha * 0.35],
    [1.06, alpha * 0.5],
    [0.96, alpha],
  ] as const) {
    g.beginPath();
    g.ellipse(0, 0, halfWidth * pose.scale * grow, halfLength * pose.scale * grow, 0, 0, Math.PI * 2);
    g.fillStyle = `rgba(20,16,12,${a})`;
    g.fill();
  }
  g.restore();
}
