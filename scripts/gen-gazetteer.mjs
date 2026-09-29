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
 * Each city also carries its REGION — the first administrative subdivision,
 * GeoNames' `admin1` (Western Australia, Northern Territory…). It is what a
 * deduced trip groups its halts into CHAPTERS by, and what a chapter is
 * offered as a name. The dump carries only the region's CODE, and a code is
 * enough to group by; naming needs GeoNames' `admin1CodesASCII.txt`. Note the
 * key is `<country>.<code>` and never the code alone: GeoNames numbers
 * Australia's states `01`…`08`, so `08` means Western Australia only once the
 * country is attached — and the second Perth in the file, in Tasmania, is why
 * the key must never be the city's own name either.
 *
 * Usage, either way round — the output is identical:
 *
 *     node scripts/gen-gazetteer.mjs                              # npm mirrors
 *     node scripts/gen-gazetteer.mjs ~/cities1000.txt             # your dump
 *     node scripts/gen-gazetteer.mjs ~/cities1000.txt ~/admin1CodesASCII.txt
 *
 * With no argument it reads two npm packages instead: `cities-with-1000`,
 * which ships `cities1000.txt` verbatim, and `cities.json`, whose
 * `admin1.json` is the same region table as JSON. That path exists because
 * some networks reach npm and not `download.geonames.org` — an agent
 * container being one of them. Nothing is installed and nothing is added to
 * `package.json`: each tarball is fetched, unpacked in memory and forgotten.
 */

import { gunzipSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'geo', 'cities.json');

const MIRROR = 'https://registry.npmjs.org/cities-with-1000/-/cities-with-1000-1.0.4.tgz';
const MIRROR_ENTRY = 'package/cities1000.txt';

// Pinned, like the dump above: a region table that moved under a regenerate
// would rename a chapter the author already accepted.
const ADMIN1_MIRROR = 'https://registry.npmjs.org/cities.json/-/cities.json-1.1.64.tgz';
const ADMIN1_ENTRY = 'package/admin1.json';

const ATTRIBUTION =
  'Data from GeoNames (https://www.geonames.org), licensed CC BY 4.0. ' +
  'Built from the cities1000 dump and the admin1 region table by scripts/gen-gazetteer.mjs.';

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

async function fromTarball(url, wanted, what) {
  process.stderr.write(`Fetching ${url}\n`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`npm answered ${res.status} for ${what}`);
  const tar = gunzipSync(Buffer.from(await res.arrayBuffer()));
  const entry = readFromTar(tar, wanted);
  if (!entry) throw new Error(`no ${wanted} inside the tarball for ${what}`);
  return entry.toString('utf8');
}

/**
 * The region table, `<country>.<code>` → name. Read in either of its two
 * shapes: GeoNames' own `admin1CodesASCII.txt` (tab-separated: code, name,
 * ascii name, geoname id) or `cities.json`'s `admin1.json` (an array of
 * `{ code, name }`). Both carry the same GeoNames rows.
 */
function readRegionNames(text) {
  const names = new Map();
  const trimmed = text.trimStart();
  if (trimmed.startsWith('[')) {
    for (const row of JSON.parse(trimmed)) {
      if (row && typeof row.code === 'string' && typeof row.name === 'string') {
        names.set(row.code, row.name.trim());
      }
    }
  } else {
    for (const line of text.split('\n')) {
      const [code, name] = line.split('\t');
      if (code && name) names.set(code.trim(), name.trim());
    }
  }
  return names;
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
/** `admin1` — a region CODE, meaningful only with the country in front. */
const ADMIN1 = 10;
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
    const admin1 = (cols[ADMIN1] ?? '').trim();
    // The region KEY for now; `main` swaps it for an index into one table.
    const regionKey = country && admin1 ? `${country}.${admin1}` : '';
    cities.push([name, country, round4(lat), round4(lon), population, section, regionKey]);
  }

  return { cities, skipped };
}

function round4(value) {
  return Math.round(value * 1e4) / 1e4;
}

async function main() {
  const [dumpPath, regionsPath] = process.argv.slice(2);
  const text = dumpPath
    ? readFileSync(dumpPath, 'utf8')
    : await fromTarball(MIRROR, MIRROR_ENTRY, 'the cities dump');
  const regionText = regionsPath
    ? readFileSync(regionsPath, 'utf8')
    : await fromTarball(ADMIN1_MIRROR, ADMIN1_ENTRY, 'the region table');

  const { cities, skipped } = parseDump(text);
  if (cities.length < 100_000) {
    throw new Error(`only ${cities.length} cities parsed — the dump looks wrong`);
  }

  const regionNames = readRegionNames(regionText);
  if (regionNames.size < 1_000) {
    throw new Error(`only ${regionNames.size} regions read — the region table looks wrong`);
  }

  // ONE table of regions, each city pointing into it by index: "Western
  // Australia" is written once, not 448 times. A key the table does not name
  // keeps an empty name — it still GROUPS, it just offers no word.
  const keys = [...new Set(cities.map((c) => c[6]).filter(Boolean))].sort();
  const indexOf = new Map(keys.map((key, i) => [key, i]));
  const regions = keys.map((key) => [key, regionNames.get(key) ?? '']);
  for (const city of cities) city[6] = city[6] ? indexOf.get(city[6]) : -1;
  const unnamed = regions.filter(([, name]) => !name).length;

  // Sorted by name so the committed file has a stable order: a regenerated
  // index must diff as the rows that actually changed, not as a reshuffle.
  cities.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(
    OUT,
    JSON.stringify({ attribution: ATTRIBUTION, count: cities.length, regions, cities }),
  );

  const mb = (statSync(OUT).size / 1e6).toFixed(1);
  process.stderr.write(`${cities.length} cities → public/geo/cities.json (${mb} MB)\n`);
  process.stderr.write(
    `${regions.length} regions, ${unnamed} of them with no name in the table\n`,
  );
  if (skipped) process.stderr.write(`${skipped} rows skipped as unusable\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
