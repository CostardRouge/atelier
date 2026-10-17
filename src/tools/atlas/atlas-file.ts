/**
 * The atlas FILE — `.atlas.json`: one atlas, or everything this device keeps
 * for the Flight Atlas, on disk. It is the one guarantee local storage cannot
 * give (a browser may clear a site's data; a private window keeps nothing), so
 * it is WHOLE: the atlases, the TEXT of every log they draw, and — for a full
 * backup — the presets and the makers' logos.
 *
 * Read like the roll and trip files (`develop/roll-file.ts`): an import makes
 * NEW atlases, never an overwrite, and belongs to the source that imports it.
 * Every log is checked against the hash its flights name before it is kept —
 * a text that does not match is dropped and its flights say «log missing» —
 * so a hand-edited or damaged file can never put a wrong track under a right
 * name. Bounded everywhere: the input is whatever was on the disk.
 */

import { ATLAS_DOC_VERSION, cleanAtlasName, newAtlasId, readAtlasDoc, type AtlasDoc } from './atlas-doc';
import { readPresets, type AtlasPreset } from './atlas-presets';

export const ATLAS_FILE_KIND = 'atelier/flight-atlas';
export const ATLAS_FILE_EXTENSION = '.atlas.json';
export const ATLAS_FILE_ACCEPT = '.json,application/json';

/** A logo as the file carries it — its bytes in base64. */
export interface AtlasFileLogo {
  maker: string;
  fileName: string;
  type: string;
  data: string;
  keepGround?: boolean;
}

export interface AtlasFile {
  kind: typeof ATLAS_FILE_KIND;
  version: number;
  /** ISO timestamp, for the human reading the file. */
  exportedAt: string;
  atlases: Omit<AtlasDoc, 'sourceId'>[];
  /** Each log's text, by the SHA-256 its flights name. */
  logs: Record<string, string>;
  presets?: AtlasPreset[];
  logos?: AtlasFileLogo[];
}

/** What an import hands back: atlases ready to keep, and what came with them. */
export interface ReadAtlasFile {
  atlases: AtlasDoc[];
  /** Only the logs whose text matched their hash. */
  logs: Map<string, string>;
  presets: AtlasPreset[];
  logos: AtlasFileLogo[];
  /** Logs whose text did not match the hash its flights name. */
  rejected: number;
}

export type AtlasParseResult = { ok: true; file: ReadAtlasFile } | { ok: false; error: string };

/** A file's largest reasonable size: logs are text, a few hundred kilobytes each. */
export const MAX_ATLAS_FILE_BYTES = 512 * 1024 * 1024;
const MAX_LOGO_DATA = Math.ceil((4 * 1024 * 1024 * 4) / 3) + 4;

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function toAtlasFile(
  atlases: readonly AtlasDoc[],
  logs: ReadonlyMap<string, string>,
  extras: { presets?: readonly AtlasPreset[]; logos?: readonly AtlasFileLogo[] } = {},
  exportedAt: number = Date.now(),
): AtlasFile {
  const wanted = new Set(atlases.flatMap((a) => a.flights.map((f) => f.log)));
  const out: Record<string, string> = {};
  for (const hash of wanted) {
    const text = logs.get(hash);
    if (text !== undefined) out[hash] = text;
  }
  return {
    kind: ATLAS_FILE_KIND,
    version: ATLAS_DOC_VERSION,
    exportedAt: new Date(exportedAt).toISOString(),
    atlases: atlases.map((a) => {
      const { sourceId: _dropped, ...rest } = structuredClone(a);
      void _dropped;
      return rest;
    }),
    logs: out,
    ...(extras.presets?.length ? { presets: [...extras.presets] } : {}),
    ...(extras.logos?.length ? { logos: [...extras.logos] } : {}),
  };
}

/** Compact: the logs are most of it, and indenting them doubles nothing useful. */
export function serializeAtlasFile(file: AtlasFile): string {
  return JSON.stringify(file);
}

function slug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** `Western Australia` → `western-australia.atlas.json`. */
export function atlasFileName(name: string): string {
  return `${slug(name) || 'atlas'}${ATLAS_FILE_EXTENSION}`;
}

/** `atelier-flight-atlas-2026-10-17.atlas.json` — everything this device keeps. */
export function backupFileName(now: number = Date.now()): string {
  return `atelier-flight-atlas-${new Date(now).toISOString().slice(0, 10)}${ATLAS_FILE_EXTENSION}`;
}

function readLogo(raw: unknown): AtlasFileLogo | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.maker !== 'string' || !r.maker.trim() || typeof r.data !== 'string') return null;
  if (r.data.length > MAX_LOGO_DATA || !/^[A-Za-z0-9+/]*={0,2}$/.test(r.data)) return null;
  return {
    maker: r.maker.trim().slice(0, 60),
    fileName: typeof r.fileName === 'string' ? r.fileName.slice(0, 200) : 'logo',
    type: typeof r.type === 'string' ? r.type.slice(0, 60) : '',
    data: r.data,
    ...(r.keepGround === true ? { keepGround: true } : {}),
  };
}

/**
 * A file's text into atlases ready to keep, or the reason it is not one.
 * Never throws. Each atlas gets a NEW id (the same file read twice is two
 * atlases); its flights keep theirs, which are their logs' hashes.
 */
export async function parseAtlasFile(text: string, sourceId: string, now: number = Date.now()): Promise<AtlasParseResult> {
  if (text.length > MAX_ATLAS_FILE_BYTES) return { ok: false, error: 'This file is too large to be an atlas file.' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This file is not JSON — an atlas file ends in .atlas.json.' };
  }
  if (!raw || typeof raw !== 'object' || (raw as Record<string, unknown>).kind !== ATLAS_FILE_KIND) {
    return { ok: false, error: 'This is not a Flight Atlas file.' };
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.version === 'number' && r.version > ATLAS_DOC_VERSION) {
    return { ok: false, error: 'This atlas file was written by a newer Atelier — update this page and try again.' };
  }
  const atlases: AtlasDoc[] = [];
  for (const item of Array.isArray(r.atlases) ? r.atlases.slice(0, 500) : []) {
    const body = item && typeof item === 'object' ? (item as Record<string, unknown>) : null;
    const doc = body ? readAtlasDoc({ ...body, id: newAtlasId(), sourceId, createdAt: now, updatedAt: now }, sourceId, now) : null;
    if (doc) atlases.push({ ...doc, name: cleanAtlasName(doc.name) });
  }
  const wanted = new Set(atlases.flatMap((a) => a.flights.map((f) => f.log)));
  const logs = new Map<string, string>();
  let rejected = 0;
  const given = r.logs && typeof r.logs === 'object' ? (r.logs as Record<string, unknown>) : {};
  for (const hash of wanted) {
    const body = given[hash];
    if (typeof body !== 'string') continue;
    if ((await sha256Hex(body)) === hash) logs.set(hash, body);
    else rejected += 1;
  }
  const presets = readPresets(r.presets);
  const logos = (Array.isArray(r.logos) ? r.logos.slice(0, 200) : []).flatMap((l) => readLogo(l) ?? []);
  if (!atlases.length && !presets.length && !logos.length) return { ok: false, error: 'This atlas file holds nothing to import.' };
  return { ok: true, file: { atlases, logs, presets, logos, rejected } };
}

export function bytesToBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let out = '';
  for (let i = 0; i < view.length; i += 0x8000) out += String.fromCharCode(...view.subarray(i, i + 0x8000));
  return btoa(out);
}

export function base64ToBytes(data: string): ArrayBuffer {
  const s = atob(data);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out.buffer;
}
