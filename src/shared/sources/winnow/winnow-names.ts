/**
 * The NAMES the connected Winnow holds — its bodies, lenses and places — and
 * an agent's words resolved against them. Winnow is the one that knows what
 * a body is called (`SONY ILCE-7CM2`, `DJI FC8482`, a name set by hand) and
 * where a frame was taken (its reverse geocoding: country, region, city, a
 * point of interest); the agent knows that an «A7C II» is an `ILCE-7CM2`.
 * So the agent reads the names (`winnow.names`), asks with one, and Winnow
 * filters on the exact value — on the SERVER, which makes a body or a place
 * a scope of its own: "every frame of the A7C II" needs no day and is not
 * cut by `allAssets`' cap before it is narrowed.
 *
 * Resolution, pure: case, accents and punctuation aside (`ilce 7cm2` finds
 * `ILCE-7CM2`), an exact name wins; else every name the words are part of
 * (`iphone` takes every iPhone), and the answer SAYS which were taken; else
 * refused with the names most used, so the agent can pick one.
 */

import { CommandError } from '../../commands/registry';
import type { ValueCount, WinnowAssetRow, WinnowClient, WinnowFacets } from './client';

/** What a name can be asked about — each is one of Winnow's own filters. */
export const NAME_KINDS = ['camera', 'lens', 'country', 'region', 'city', 'place'] as const;
export type NameKind = (typeof NAME_KINDS)[number];

/** For each kind: the facet listing its names, the `/api/assets` filter, the row field it is checked on. */
const WIRE: Record<NameKind, { facet: keyof WinnowFacets; param: string; field: keyof WinnowAssetRow }> = {
  camera: { facet: 'devices', param: 'device', field: 'device' },
  lens: { facet: 'lenses', param: 'lens', field: 'lens' },
  country: { facet: 'place_countries', param: 'place_country', field: 'place_country' },
  region: { facet: 'place_regions', param: 'place_region', field: 'place_region' },
  city: { facet: 'place_cities', param: 'place_city', field: 'place_city' },
  place: { facet: 'place_pois', param: 'place_poi', field: 'place_poi' },
};

/** The values chosen per kind, exactly as Winnow writes them. */
export type NameAsk = Partial<Record<NameKind, string[]>>;

/** Params every listing takes, one per kind. */
export const NAME_PARAMS = {
  camera: {
    type: 'string',
    description:
      'The BODY, as Winnow names it — its maker and model as the file wrote them ("SONY ILCE-7CM2" is the Sony A7C II, "DJI FC8482" the Mini 4 Pro), or a name set by hand. Case and punctuation aside; a part takes every body it is in ("iphone"). winnow.names {kind: camera} lists them. A scope of its own: no day needed.',
    optional: true,
  },
  lens: { type: 'string', description: 'The lens, as Winnow names it (winnow.names {kind: lens}). A scope of its own.', optional: true },
  country: { type: 'string', description: 'The country Winnow placed the frame in, by its own reverse geocoding ("France", "Australia"). A scope of its own.', optional: true },
  region: { type: 'string', description: 'The region or state ("Île-de-France", "Queensland"), as Winnow names it. A scope of its own.', optional: true },
  city: { type: 'string', description: 'The town ("Paris", "Cairns"), as Winnow names it — exact names, not a radius (near is the radius). A scope of its own.', optional: true },
  place: { type: 'string', description: 'A point of interest Winnow named ("Uluru", "Sydney Opera House"). A scope of its own.', optional: true },
} as const;

/** Whether the params name a body, a lens or a place. */
export function asksNames(p: Record<string, unknown>): boolean {
  return NAME_KINDS.some((k) => typeof p[k] === 'string' && (p[k] as string).trim() !== '');
}

/** A name as it is compared: case, accents and every non-alphanumeric aside. */
export function foldKey(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/** The names of one kind that the words ask for — exact first, else every name they are part of. */
export function resolveName(kind: NameKind, asked: string, names: readonly ValueCount[]): string[] {
  const want = foldKey(asked);
  if (!want) throw new CommandError('invalid', `${kind} is empty`);
  const values = names.map((n) => String(n.value));
  const exact = values.filter((v) => foldKey(v) === want);
  const hits = exact.length ? exact : values.filter((v) => foldKey(v).includes(want));
  if (hits.length) return hits;
  const known = names.slice(0, 12).map((n) => `"${n.value}" (${n.count})`).join(', ');
  throw new CommandError(
    'invalid',
    names.length
      ? `this Winnow has no ${kind} named "${asked}" — the most used are ${known}${names.length > 12 ? '…' : ''}; winnow.names {kind: ${kind}} lists them all`
      : `this Winnow names no ${kind} yet`,
  );
}

/** Every name asked in the params, resolved against the instance's lists. */
export function resolveNames(p: Record<string, unknown>, facets: WinnowFacets): NameAsk {
  const out: NameAsk = {};
  for (const kind of NAME_KINDS) {
    const raw = p[kind];
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const values = resolveName(kind, raw.trim(), facets[WIRE[kind].facet] as ValueCount[]);
    // Winnow reads a filter as ONE comma-separated value: a name holding a comma cannot travel.
    const comma = values.find((v) => v.includes(','));
    if (comma) throw new CommandError('invalid', `Winnow cannot be asked for "${comma}" (a comma in the name) — narrow by date and words instead`);
    out[kind] = values;
  }
  return out;
}

/** The `/api/assets` params a name ask becomes. */
export function nameParams(names: NameAsk | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!names) return out;
  for (const kind of NAME_KINDS) {
    const values = names[kind];
    if (values?.length) out[WIRE[kind].param] = values.join(',');
  }
  return out;
}

/** Whether a row carries one of the asked names of every kind — for rows Winnow did not filter itself (a search). */
export function passesNames(row: WinnowAssetRow, names: NameAsk | undefined): boolean {
  if (!names) return true;
  for (const kind of NAME_KINDS) {
    const values = names[kind];
    if (!values?.length) continue;
    const have = row[WIRE[kind].field];
    if (typeof have !== 'string' || !values.includes(have)) return false;
  }
  return true;
}

/** The names of one kind, busiest first, as `winnow.names` answers them. */
export function namesOfKind(facets: WinnowFacets, kind: NameKind): ValueCount[] {
  return (facets[WIRE[kind].facet] as ValueCount[]) ?? [];
}

/** How long a read of the names is trusted — a library gains a body rarely, and the list is one request. */
const NAMES_TTL_MS = 10 * 60_000;
const held = new WeakMap<WinnowClient, { at: number; facets: Promise<WinnowFacets> }>();

/** The instance's names, read once per ten minutes per connection. */
export function instanceNames(client: WinnowClient): Promise<WinnowFacets> {
  const now = Date.now();
  const have = held.get(client);
  if (have && now - have.at < NAMES_TTL_MS) return have.facets;
  const facets = client.facets();
  held.set(client, { at: now, facets });
  facets.catch(() => held.delete(client));
  return facets;
}
