/**
 * Lensfun on THIS DEVICE: the consent, the lookup and what it keeps.
 *
 * - **Consent** is a `localStorage` flag, never on a roll — the rule the place
 *   search set (`local-first.md`): an exported `.roll.json` must not carry
 *   someone's permission to talk to a third party. Off until turned on.
 * - **The lookup** fetches the fewest database files that can answer
 *   (`lensfun-source.ts`): the camera maker's, then the independent lens
 *   makers' for that kind of body only when the lens was not in the first.
 *   Each file is parsed once per visit and then let go.
 * - **What is kept** is the ANSWER, keyed by the body and the lens as the EXIF
 *   names them: the matched camera and the matched lens with its whole
 *   calibration (every focal length, every aperture — a few kilobytes), or
 *   "not in Lensfun". Never a file. So the second picture from that lens asks
 *   nothing, at any focal length, and neither does the hundredth.
 *
 * A "not in Lensfun" answer is asked again after a month: the database grows.
 * Every storage failure degrades to asking again rather than to an error.
 */

import { useSyncExternalStore } from 'react';
import {
  findCamera,
  findLens,
  makerKey,
  parseLensfunXml,
  profileTerms,
  type LensfunCamera,
  type LensfunDb,
  type LensfunLens,
} from './lensfun';
import { cameraFiles, lensFiles, lensfunUrl } from './lensfun-source';
import { lensKey, type LensProfileApplied } from './lens-profile';

// --- consent -------------------------------------------------------------------

const CONSENT_KEY = 'atelier.lensfun';
const listeners = new Set<() => void>();

export function lensfunAllowed(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === 'on';
  } catch {
    return false;
  }
}

export function setLensfunAllowed(on: boolean): void {
  try {
    if (on) localStorage.setItem(CONSENT_KEY, 'on');
    else localStorage.removeItem(CONSENT_KEY);
  } catch {
    // A browser that will not store it asks again next visit.
  }
  for (const l of listeners) l();
}

export function useLensfunAllowed(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      const onStorage = (e: StorageEvent) => {
        if (e.key === CONSENT_KEY) l();
      };
      window.addEventListener('storage', onStorage);
      return () => {
        listeners.delete(l);
        window.removeEventListener('storage', onStorage);
      };
    },
    lensfunAllowed,
    () => false,
  );
}

// --- the kept answers ------------------------------------------------------------

const DB_NAME = 'atelier-lens-profiles';
const STORE = 'matches';
/** How long "not in Lensfun" is believed before the database is asked again. */
const MISS_TTL_MS = 30 * 24 * 3600 * 1000;

export interface MatchRecord {
  id: string;
  camera: LensfunCamera | null;
  lens: LensfunLens | null;
  at: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

async function readMatch(id: string): Promise<MatchRecord | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
      req.onsuccess = () => resolve((req.result as MatchRecord | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function writeMatch(record: MatchRecord): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Not kept: the next picture asks again.
  }
}

// --- the lookup --------------------------------------------------------------------

const parsed = new Map<string, Promise<LensfunDb | null>>();

/** One database file, fetched and read once per visit; null when it cannot be had. */
function fileDb(file: string, signal?: AbortSignal): Promise<LensfunDb | null> {
  let held = parsed.get(file);
  if (!held) {
    held = fetch(lensfunUrl(file), { signal, credentials: 'omit' })
      .then((r) => (r.ok ? r.text() : null))
      .then((text) => (text ? parseLensfunXml(text) : null))
      .catch(() => null);
    parsed.set(file, held);
    // A failure is not remembered: the next ask tries the network again.
    void held.then((db) => {
      if (!db) parsed.delete(file);
    });
  }
  return held;
}

/** What a picture's EXIF says about its glass. */
export interface ShotLens {
  make?: string;
  model?: string;
  lensModel?: string;
  focalLength?: number;
  /** The 35 mm equivalent, which says a body shot in a CROP mode (a full-frame Sony in APS-C). */
  focalLength35?: number;
  fNumber?: number;
}

/**
 * The crop factor of the PICTURE: the body's, unless the EXIF's 35 mm
 * equivalent says it was shot in a crop mode — the calibration is then read
 * against the smaller area really exposed.
 */
export function imageCrop(camera: LensfunCamera, shot: ShotLens): number {
  const f = shot.focalLength ?? 0;
  const f35 = shot.focalLength35 ?? 0;
  const said = f > 0 && f35 > 0 ? f35 / f : 0;
  return said > camera.crop * 1.1 && said < camera.crop * 3 ? said : camera.crop;
}

export type LookUp =
  | { kind: 'found'; camera: LensfunCamera; lens: LensfunLens }
  | { kind: 'missing'; why: 'no-exif' | 'camera' | 'lens' }
  | { kind: 'offline' }
  | { kind: 'not-allowed' };

/**
 * The camera and the lens a picture was taken with, from the device's kept
 * answers, else from Lensfun when the person allowed it. Never throws.
 */
export async function lookUpLens(shot: ShotLens, signal?: AbortSignal): Promise<LookUp> {
  if (!shot.make || !shot.model || !(shot.focalLength && shot.focalLength > 0)) return { kind: 'missing', why: 'no-exif' };
  const id = lensKey(shot.make, shot.model, shot.lensModel);
  const kept = await readMatch(id);
  if (kept && (kept.lens || Date.now() - kept.at < MISS_TTL_MS)) {
    if (kept.camera && kept.lens) return { kind: 'found', camera: kept.camera, lens: kept.lens };
    return { kind: 'missing', why: kept.camera ? 'lens' : 'camera' };
  }
  if (!lensfunAllowed()) return { kind: 'not-allowed' };

  const maker = makerKey(shot.make);
  const tried: LensfunDb[] = [];
  let camera: LensfunCamera | null = null;
  let cameraFile: string | null = null;
  let reached = false;
  for (const file of cameraFiles(maker)) {
    const db = await fileDb(file, signal);
    if (!db) continue;
    reached = true;
    tried.push(db);
    camera = findCamera([db], shot.make, shot.model);
    if (camera) {
      cameraFile = file;
      break;
    }
  }
  if (!camera || !cameraFile) {
    if (!reached && cameraFiles(maker).length) return { kind: 'offline' };
    await writeMatch({ id, camera: null, lens: null, at: Date.now() });
    return { kind: 'missing', why: 'camera' };
  }
  let match = findLens(tried, camera, shot.lensModel);
  for (const file of match ? [] : lensFiles(cameraFile)) {
    const db = await fileDb(file, signal);
    if (!db) continue;
    tried.push(db);
    match = findLens(tried, camera, shot.lensModel);
    if (match) break;
  }
  await writeMatch({ id, camera, lens: match?.lens ?? null, at: Date.now() });
  return match ? { kind: 'found', camera, lens: match.lens } : { kind: 'missing', why: 'lens' };
}

/** The profile a found lens gives THIS picture: its focal length, its aperture, its body's sensor. */
export function profileFor(
  camera: LensfunCamera,
  lens: LensfunLens,
  shot: ShotLens,
  onRender = false,
): LensProfileApplied | null {
  if (!shot.focalLength || !(shot.focalLength > 0)) return null;
  const { terms, has } = profileTerms(lens, {
    focal: shot.focalLength,
    aperture: shot.fNumber && shot.fNumber > 0 ? shot.fNumber : null,
    imageCrop: imageCrop(camera, shot),
  });
  if (!has.distortion && !has.tca && !has.vignette) return null;
  return {
    lens: `${lens.maker} ${lens.models[0]}`.trim(),
    camera: `${camera.maker} ${camera.models[0]}`.trim(),
    focal: shot.focalLength,
    aperture: shot.fNumber && shot.fNumber > 0 ? shot.fNumber : null,
    terms,
    has,
    onRender,
  };
}
