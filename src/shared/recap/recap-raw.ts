/**
 * A recap's RAW pictures: which material each is read from — its camera
 * render (or Winnow's proxy) or its sensor — and the key its print is kept
 * under (`sensor-outside-develop.md`).
 *
 * The rule is `raw-choice.ts`'s: the picture's own choice, then the recap's
 * (`RecapDoc.raw`, set by «Use … for every RAW of this recap»), then Auto. For
 * Auto a LOCAL RAW is «in hand» whether or not its file is handed over in this
 * visit — its print is kept on the device — so the answer never changes
 * between two visits; an instance's RAW is never in hand.
 *
 * Pure and DOM-free.
 */

import { isRawImage } from '../library/assets';
import { autoMaterial, materialOf, type RawMaterial } from '../develop/raw-choice';
import type { RecapDoc, RecapPicture } from './recap-doc';

/** A still whose file is a camera RAW — the pictures the material menu is offered on. */
export function isRawPicture(pic: Pick<RecapPicture, 'kind' | 'name'>): boolean {
  return pic.kind === 'photo' && isRawImage(pic.name);
}

/** What Auto answers for `pic`, from the sizes its pool entry carries. */
export function autoMaterialOf(pic: Pick<RecapPicture, 'origin' | 'width' | 'height' | 'renderEdge'>): RawMaterial {
  const sensorEdge = pic.width && pic.height ? Math.max(pic.width, pic.height) : null;
  return autoMaterial({ inHand: pic.origin === 'local', sensorEdge, renderEdge: pic.renderEdge ?? null });
}

/** The material `pic` is read from in `doc`; a picture that is not a RAW is always its render. */
export function pictureMaterial(pic: RecapPicture, doc: Pick<RecapDoc, 'raw'>): RawMaterial {
  if (!isRawPicture(pic)) return 'render';
  return materialOf(pic.material, doc.raw, autoMaterialOf(pic));
}

/** True when `pic`'s material is Auto's answer — no choice of its own nor of the recap. */
export function materialIsAuto(pic: RecapPicture, doc: Pick<RecapDoc, 'raw'>): boolean {
  return isRawPicture(pic) && !pic.material && !doc.raw;
}

/** The key `pic`'s print is kept under for `material`: the sensor's is a second print beside the render's. */
export function printKey(key: string, material: RawMaterial): string {
  return material === 'sensor' ? `${key}#sensor` : key;
}

/** `doc` with every RAW picture following `material`: the recap's choice set, the pictures' own ones cleared. */
export function withRawMaterial(doc: RecapDoc, material: RawMaterial): RecapDoc {
  return {
    ...doc,
    raw: material,
    pictures: doc.pictures.map((p) => {
      if (!p.material) return p;
      const { material: _gone, ...rest } = p;
      void _gone;
      return rest;
    }),
  };
}

/** How many of `doc`'s pictures are RAWs — whether «for every RAW» means anything. */
export function rawCount(doc: Pick<RecapDoc, 'pictures'>): number {
  return doc.pictures.reduce((n, p) => n + (isRawPicture(p) ? 1 : 0), 0);
}

/** The words of a material for a picture of `origin`: an instance's render is its proxy. */
export function materialLabel(material: RawMaterial, origin: RecapPicture['origin']): string {
  return material === 'sensor' ? 'Sensor' : origin === 'winnow' ? 'Proxy' : 'Camera render';
}
