#!/usr/bin/env node

/**
 * Generate `public/geo/cities.json` — the city index a deduced Road Trip leg
 * is NAMED from, offline.
 *
 * Why an index ships with the app rather than a lookup going out: the suite's
 * only place lookup (`shared/map/geocode.ts`) is an opt-in network exception
 * that sends text the author typed. Reverse-geocoding a deduced leg would send
 * the coordinates of their photographs instead — a different and larger claim
 * on someone's data, for a name. A committed index answers the same question
 * from our own origin, so the README's network callout is unchanged. The
 * precedent and the sizes: `public/models` is 17 MB and `public/luts` is
 * 37 MB, both served from here and both fetched only when wanted.
 *
 * Source: GeoNames `cities1000` — every populated place of 1 000 inhabitants
 * or more, ~135 000 rows. `cities1000` and not `cities15000`, because the
 * towns worth naming a leg after are small: Kalbarri is 2 602 people and
 * Broome 5 314, and a 15 000 floor loses them both.
 *
 * GeoNames is licensed **CC BY 4.0**, so the attribution travels inside the
 * generated file and must not be stripped.
 *
 * Usage, either way round — the output is identical:
 *
 *     node scripts/gen-gazetteer.mjs                  # npm's mirror of the dump
 *     node scripts/gen-gazetteer.mjs ~/cities1000.txt # a dump you already have
 *
 * With no argument it reads the `cities-with-1000` package from the npm
 * registry, which ships GeoNames' `cities1000.txt` verbatim. That path exists
 * because some networks reach npm and not `download.geonames.org` — an agent
 * container being one of them. Nothing is installed and nothing is added to
 * `package.json`: the tarball is fetched, unpacked in memory and forgotten.
 */

import { gunzipSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'geo', 'cities.json');

const MIRROR = 'https://registry.npmjs.org/cities-with-1000/-/cities-with-1000-1.0.4.tgz';
const MIRROR_ENTRY = 'package/cities1000.txt';

const ATTRIBUTION =
  'Data from GeoNames (https://www.geonames.org), licensed CC BY 4.0. ' +
  'Built from the cities1000 dump by scripts/gen-gazetteer.mjs.';

/**
 * The one file we want out of a gzipped tar, read without a dependency.
 *
 * tar is 512-byte blocks: a header whose name is the first 100 bytes and
 * whose size is octal at offset 124, then the file's own blocks, padded up.
 * A GNU long name (type `L`) carries the name in the NEXT entry's body, which
 * this handles because npm tarballs use it for deep paths.
 */
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
    const padded = Math.ceil(size / 512) * 512;

    if (type === 'L') {
      longName = buffer.subarray(body, body + size).toString('utf8').replace(/\0.*$/, '');
    } else if (name === wanted) {
      return buffer.subarray(body, body + size);
    }

    offset = body + padded;
  }
  return null;
}

async function dumpFromMirror() {
  process.stderr.write(`Fetching ${MIRROR}\n`);
  const res = await fetch(MIRROR);
  if (!res.ok) throw new Error(`npm answered ${res.status} for the cities dump`);
  const tar = gunzipSync(Buffer.from(await res.arrayBuffer()));
  const entry = readFromTar(tar, MIRROR_ENTRY);
  if (!entry) throw new Error(`no ${MIRROR_ENTRY} inside the tarball`);
  return entry.toString('utf8');
}

/**
 * GeoNames' own column order. Five are kept: a name to say, a country to tell
 * two places of the same name apart, the position, the population, and
 * whether the row is a SECTION of a place rather than a place.
 *
 * That last one is what stops a leg at Broome being called "Cable Beach".
 * GeoNames records Cable Beach (a Broome suburb) at 8 529 people against
 * Broome's own 5 314, so population alone picks the suburb — but its feature
 * code is `PPLX`, "section of populated place", where Broome is `PPL` and
 * Perth is `PPLA`. Only 4 817 rows of 135 233 are sections, so the flag is
 * one bit that fixes a whole class of wrong names.
 */
const NAME = 1;
const LAT = 4;
const LON = 5;
const FEATURE_CODE = 7;
const COUNTRY = 8;
const POPULATION = 14;

/** `PPLX` — a district or suburb, named only when nothing else is near. */
const SECTION = 'PPLX';

function parseDump(text) {
  const cities = [];
  let skipped = 0;

  for (const line of text.split('\n')) {
    if (!line) continue;
    const cols = line.split('\t');
    const name = (cols[NAME] ?? '').trim();
    const lat = Number(cols[LAT]);
    const lon = Number(cols[LON]);
    const country = (cols[COUNTRY] ?? '').trim();
    const population = Number(cols[POPULATION]) || 0;

    if (
      !name ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180 ||
      (lat === 0 && lon === 0)
    ) {
      skipped += 1;
      continue;
    }

    // Four decimals is ~11 m. A leg is named from a centroid compared at tens
    // of kilometres, so more digits would be bytes spent on nothing.
    const section = (cols[FEATURE_CODE] ?? '').trim() === SECTION ? 1 : 0;
    cities.push([name, country, round4(lat), round4(lon), population, section]);
  }

  return { cities, skipped };
}

function round4(value) {
  return Math.round(value * 1e4) / 1e4;
}

async function main() {
  const given = process.argv[2];
  const text = given ? readFileSync(given, 'utf8') : await dumpFromMirror();

  const { cities, skipped } = parseDump(text);
  if (cities.length < 100_000) {
    throw new Error(`only ${cities.length} cities parsed — the dump looks wrong`);
  }

  // Sorted by name so the committed file has a stable order: a regenerated
  // index must diff as the rows that actually changed, not as a reshuffle.
  cities.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(
    OUT,
    JSON.stringify({ attribution: ATTRIBUTION, count: cities.length, cities }),
  );

  const mb = (statSync(OUT).size / 1e6).toFixed(1);
  process.stderr.write(`${cities.length} cities → public/geo/cities.json (${mb} MB)\n`);
  if (skipped) process.stderr.write(`${skipped} rows skipped as unusable\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
