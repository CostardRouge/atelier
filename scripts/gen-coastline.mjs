#!/usr/bin/env node

/**
 * Generate `public/geo/land.json` — the land the Trips overview's map draws,
 * offline.
 *
 * Why it ships rather than being fetched from a tile server: the map view of
 * a trip (`TripMapView`) must work with the network off, like every map
 * surface of the suite, and the towns of `public/geo/cities.json` alone draw a
 * continent as a scatter of dots along its coast. One outline of the world's
 * land, served from our own origin and fetched only when the map view opens,
 * is what makes the paper read as a place — the README's network callout is
 * unchanged. OpenStreetMap tiles stay the existing opt-in on top of it.
 *
 * Source: Natural Earth's 1:50m land, as `world-atlas` redistributes it on
 * npm (TopoJSON, quantized, in degrees). 1:50m and not 1:110m because a trip
 * is read at the scale of a coast — at 1:110m the Whitsundays and the Gulf of
 * St Vincent are gone — and not 1:10m because that is 3 MB of topology for
 * detail nobody reads at an overview's zoom. Natural Earth is in the PUBLIC
 * DOMAIN; the credit rides in the file anyway, because a map should say where
 * its drawing comes from.
 *
 * Usage, either way round — the output is identical:
 *
 *     node scripts/gen-coastline.mjs                  # npm's copy of world-atlas
 *     node scripts/gen-coastline.mjs ~/land-50m.json  # a land-50m.json you already have
 *
 * Nothing is installed and nothing is added to `package.json`: the tarball is
 * fetched, unpacked in memory and forgotten, the way `gen-gazetteer.mjs`
 * reads its dump, and the TopoJSON is decoded by the forty lines below rather
 * than by a dependency.
 */

import { gunzipSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'geo', 'land.json');

const MIRROR = 'https://registry.npmjs.org/world-atlas/-/world-atlas-2.0.2.tgz';
const MIRROR_ENTRY = 'package/land-50m.json';

const ATTRIBUTION =
  'Made with Natural Earth (https://www.naturalearthdata.com), public domain — 1:50m land, ' +
  'via world-atlas 2.0.2. Built by scripts/gen-coastline.mjs.';

/**
 * Coordinates are stored as integers of 1/1000° (~110 m — finer than a 1:50m
 * coast was ever drawn), and each ring after its first point as DELTAS: a
 * coast moves a few hundredths of a degree per point, so a delta is two or
 * three digits where an absolute is seven. That is what brings the file from
 * ~1 MB of GeoJSON to a third of it; `shared/map/land.ts` turns it back.
 */
const DIGITS = 1e3;

/** The one file we want out of a gzipped tar (the gazetteer script's reader). */
function readFromTar(buffer, wanted) {
  let offset = 0;
  let longName = null;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const rawName = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const name = longName ?? rawName;
    longName = null;
    const size = parseInt(header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim(), 8);
    const type = String.fromCharCode(header[156]);
    const body = offset + 512;
    if (type === 'L') {
      longName = buffer.subarray(body, body + size).toString('utf8').replace(/\0.*$/, '');
    } else if (name === wanted) {
      return buffer.subarray(body, body + size);
    }
    offset = body + Math.ceil(size / 512) * 512;
  }
  return null;
}

async function topologyFromMirror() {
  process.stderr.write(`Fetching ${MIRROR}\n`);
  const res = await fetch(MIRROR);
  if (!res.ok) throw new Error(`npm answered ${res.status} for world-atlas`);
  const entry = readFromTar(gunzipSync(Buffer.from(await res.arrayBuffer())), MIRROR_ENTRY);
  if (!entry) throw new Error(`no ${MIRROR_ENTRY} inside the tarball`);
  return JSON.parse(entry.toString('utf8'));
}

/**
 * TopoJSON's arcs back to degrees: with a `transform`, each arc is a run of
 * quantized DELTAS, so a point is the running sum scaled and translated.
 */
function decodeArcs(topology) {
  const t = topology.transform;
  return topology.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      if (!t) return [dx, dy];
      x += dx;
      y += dy;
      return [x * t.scale[0] + t.translate[0], y * t.scale[1] + t.translate[1]];
    });
  });
}

/** A ring from arc indices: `~i` is arc i reversed; each arc after the first drops its shared first point. */
function ringOf(indices, arcs) {
  const ring = [];
  for (const index of indices) {
    const arc = index < 0 ? arcs[~index].slice().reverse() : arcs[index];
    ring.push(...(ring.length ? arc.slice(1) : arc));
  }
  return ring;
}

/**
 * A ring as a flat map can draw it. Natural Earth is SPHERICAL: a ring that
 * crosses the antimeridian jumps from 179.9° to −179.9° between two points,
 * and drawn flat that jump is a band across the whole world. So the ring is
 * UNWRAPPED — each longitude taken the short way from the one before, past
 * ±180 if need be (MapLibre draws beyond ±180 on its next world copy). A ring
 * that winds all the way round (Antarctica) cannot close that way; it is
 * closed through the pole it winds round instead.
 */
function flatRing(ring) {
  const out = [];
  let prev = null;
  for (const [lon, lat] of ring) {
    let x = lon;
    if (prev !== null) {
      while (x - prev > 180) x -= 360;
      while (x - prev < -180) x += 360;
    }
    out.push([x, lat]);
    prev = x;
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (Math.abs(last[0] - first[0]) > 180) {
    // Wound once round a pole: go down to it and back along it.
    const pole = out.reduce((sum, p) => sum + p[1], 0) < 0 ? -90 : 90;
    out.push([last[0], pole], [first[0], pole], [first[0], first[1]]);
  }
  // Back onto the world the camera opens on: an unwrapped ring may have
  // drifted a whole turn west (Eurasia, when its ring starts in Chukotka), and
  // a feature entirely on a neighbouring copy is drawn only there.
  const xs = out.map(([x]) => x);
  const shift = Math.round((Math.min(...xs) + Math.max(...xs)) / 2 / 360) * 360;
  return out.map(([x, y]) => [Math.round((x - shift) * DIGITS), Math.round(y * DIGITS)]);
}

/** Consecutive points that rounding made equal are one point. */
function dedupe(ring) {
  return ring.filter((p, i) => i === 0 || p[0] !== ring[i - 1][0] || p[1] !== ring[i - 1][1]);
}

/** A ring of integer points as one flat run: the first point, then deltas. */
function deltaRing(ring) {
  const flat = [ring[0][0], ring[0][1]];
  for (let i = 1; i < ring.length; i++) flat.push(ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1]);
  return flat;
}

async function main() {
  const given = process.argv[2];
  const topology = given ? JSON.parse(readFileSync(given, 'utf8')) : await topologyFromMirror();
  const land = topology.objects?.land;
  if (!land) throw new Error('no `land` object in the topology — is this land-50m.json?');
  const arcs = decodeArcs(topology);

  const polygons = [];
  let rings = 0;
  let points = 0;
  let unwrapped = 0;
  for (const geometry of land.geometries) {
    const list = geometry.type === 'Polygon' ? [geometry.arcs] : geometry.type === 'MultiPolygon' ? geometry.arcs : [];
    for (const polygon of list) {
      const out = [];
      for (const indices of polygon) {
        const raw = ringOf(indices, arcs);
        const ring = dedupe(flatRing(raw));
        if (ring.some(([x]) => x > 180 * DIGITS || x < -180 * DIGITS)) unwrapped += 1;
        if (ring.length < 4) continue;
        out.push(deltaRing(ring));
        rings += 1;
        points += ring.length;
      }
      if (out.length) polygons.push(out);
    }
  }
  if (polygons.length < 500) throw new Error(`only ${polygons.length} polygons decoded — the topology looks wrong`);

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(
    OUT,
    JSON.stringify({ attribution: ATTRIBUTION, scale: DIGITS, polygons }),
  );

  const kb = Math.round(statSync(OUT).size / 1e3);
  process.stderr.write(
    `${polygons.length} polygons, ${rings} rings, ${points} points → public/geo/land.json (${kb} kB)\n`,
  );
  if (unwrapped) process.stderr.write(`${unwrapped} rings unwrapped across the antimeridian\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
