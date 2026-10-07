/**
 * WHICH FILE OF ITS CAPTURE EVERY PICTURE OF A ROLL OPENS ON, chosen once for
 * the roll (2026-10-02, the maintainer's pick of « C + B »: *"que le choix
 * soit appliqué automatiquement sur tous les autres médias"*).
 *
 * A picture's own choice is a FILE (`RollPicture.rendition` names
 * `delivered:dsc08463.arw`) or a material (`develop.base`), and neither can
 * be copied onto another picture: another capture has other files. So the
 * roll stores a ROLE — the camera's own file, or the sensor — and this module
 * resolves it against each capture's renditions, picture by picture, the same
 * way for the stage and for the export so that what is seen is what leaves.
 *
 * Three rules a later change must keep:
 *
 * - **A picture's own choice wins.** The roll decides only for a picture that
 *   has none, which is how his rule *"l'utilisateur choisit explicitement"*
 *   survives the shortcut. A clip never follows: its "camera file" is a rush
 *   of gigabytes.
 * - **Never fewer pixels than the proxy.** A DJI DNG's camera render is
 *   960 × 540 against a 2048 px proxy (`raw.md`); taking it because the roll
 *   said "camera render" would make the picture worse. Such a picture stays
 *   where it opens and says why. A render nobody has measured yet decides
 *   nothing until it is measured.
 * - **Numbers bind their material.** A picture whose develop was set on the
 *   8-bit render never moves onto the sensor by itself — numbers nobody has
 *   seen on the RAW are never applied to it (`raw.md`'s rule, decision 4) —
 *   and a follower given numbers ON the sensor writes that base as its own.
 *
 * Pure and DOM-free; `roll-choice.test.ts` holds it to the measured cases.
 */

import { isDefaultDevelop, isRawDevelop, type DevelopSettings } from './develop';
import { openingBaseCurve } from './base-curve';
import { isClipName } from '../library/assets';
import type { Rendition } from '../media/renditions';

/** What a roll can open its pictures on, beyond where each one opens (its proxy). */
export type RollChoice = 'delivered' | 'sensor';

/** A choice of bytes by ROLE: the roll's, or one picture's own. */
export type ChoiceRole = 'proxy' | RollChoice;

/** The words a person reads for each role — the menu, the line after a pick, the notice. */
export const CHOICE_WORDS: Readonly<Record<ChoiceRole, string>> = Object.freeze({
  proxy: 'Proxy',
  delivered: 'Camera render',
  sensor: 'Sensor (RAW)',
});

/** A stored value read back: anything but the two roles is "where it opens". */
export function readRollChoice(raw: unknown): RollChoice | null {
  return raw === 'delivered' || raw === 'sensor' ? raw : null;
}

interface ChoosingPicture {
  ref: { name: string };
  rendition?: string | null;
  develop: DevelopSettings | null;
}

/**
 * The picture's OWN choice, by role — or null where it made none and follows
 * the roll. On the sensor is a develop with a RAW base; a stored rendition is
 * the proxy (`proxy`) or a file of the capture (`delivered:<name>`).
 */
export function ownChoice(picture: ChoosingPicture): ChoiceRole | null {
  if (isRawDevelop(picture.develop)) return 'sensor';
  if (!picture.rendition) return null;
  return picture.rendition === 'proxy' ? 'proxy' : 'delivered';
}

/** A clip is never moved by the roll: its camera file is the rush. */
function exempt(picture: ChoosingPicture): boolean {
  return isClipName(picture.ref.name);
}

/** The picture takes the roll's choice: the roll has one, the picture none of its own. */
export function followsRoll(choice: RollChoice | null | undefined, picture: ChoosingPicture): boolean {
  return Boolean(choice) && !exempt(picture) && ownChoice(picture) === null;
}

/**
 * The picture's own choice differs from the roll's — what its cell marks.
 * Nothing departs from a roll that has no choice: every pick is then the
 * per-picture one it always was.
 */
export function departsFromRoll(choice: RollChoice | null | undefined, picture: ChoosingPicture): boolean {
  if (!choice || exempt(picture)) return false;
  const own = ownChoice(picture);
  return own !== null && own !== choice;
}

/**
 * The choice the roll hands THIS picture, before any file is looked at — or
 * null with the reason it hands none. The sensor is refused to a picture
 * whose numbers were set on the render.
 */
export function rollChoiceFor(
  choice: RollChoice | null | undefined,
  picture: ChoosingPicture,
): { choice: RollChoice | null; reason: string | null } {
  if (!choice || !followsRoll(choice, picture)) return { choice: null, reason: null };
  if (choice === 'sensor' && !isDefaultDevelop(picture.develop)) {
    return { choice: null, reason: 'its numbers were set on the render — choose the sensor on it to move them' };
  }
  return { choice, reason: null };
}

/**
 * A batch's develop (Apply to, Paste) onto a picture that FOLLOWS the roll's
 * sensor. Numbers made on a sensor keep it there: they are written with the
 * base — the gain measured at its next decode, or by the run — since a
 * develop with numbers and no base reads as set on the render and would take
 * the picture off the roll's sensor. `target` is the picture BEFORE the batch.
 */
export function ontoRollSensor(
  choice: RollChoice | null | undefined,
  target: ChoosingPicture,
  fromSensor: boolean,
  develop: DevelopSettings | null,
): DevelopSettings | null {
  if (!develop || !fromSensor || isRawDevelop(develop) || rollChoiceFor(choice, target).choice !== 'sensor') return develop;
  return { ...develop, base: 'gain', rawGain: null, baseCurve: openingBaseCurve(develop.baseCurve) };
}

export interface RollAnswer {
  /** The rendition the roll's choice lands on for this capture; null where the picture stays where it opens. */
  row: Rendition | null;
  /** Why it stays, in the words a cell or a menu says; null when it lands. */
  reason: string | null;
  /** True while a size that decides it has not been measured: nothing is fetched before it is. */
  pending: boolean;
}

function area(row: Rendition): number {
  return row.pixels ? row.pixels.width * row.pixels.height : 0;
}

/** Cheapest reach first, for two files that give the same pixels. */
const REACH_COST: Record<Rendition['reach'], number> = { file: 0, embedded: 1, decoder: 2, sensor: 3 };

/**
 * Where the roll's `choice` lands among one capture's renditions.
 *
 * The SENSOR is the capture's sensor row, where it has one. The CAMERA's file
 * is its largest measured delivered row — a JPEG beside the RAW, the render
 * inside it, a HEIF — kept only where it beats the proxy; a camera file that
 * is not a render inside a RAW is taken unmeasured, since a source's proxy is
 * a downscale of it and never the larger.
 */
export function resolveRollChoice(rows: readonly Rendition[], choice: RollChoice): RollAnswer {
  if (choice === 'sensor') {
    const sensor = rows.find((r) => r.role === 'sensor' && !r.blocked) ?? null;
    return sensor ? { row: sensor, reason: null, pending: false } : { row: null, reason: 'no RAW in this capture', pending: false };
  }
  const candidates = rows.filter((r) => r.role === 'delivered' && !r.blocked);
  if (!candidates.length) return { row: null, reason: 'no file of the camera’s in this capture', pending: false };
  const proxy = rows.find((r) => r.role === 'proxy') ?? null;
  const measured = candidates
    .filter((r) => r.pixels)
    .sort((a, b) => area(b) - area(a) || REACH_COST[a.reach] - REACH_COST[b.reach]);
  let best: Rendition | null = measured[0] ?? null;
  let smaller: Rendition | null = null;
  let waiting = false;
  if (best && proxy) {
    if (!proxy.pixels) {
      // The proxy not measured yet: a full camera file needs no comparison,
      // a render inside a RAW does.
      if (best.reach === 'embedded') {
        waiting = true;
        best = null;
      }
    } else if (area(best) <= area(proxy)) {
      smaller = best;
      best = null;
    }
  }
  if (best) return { row: best, reason: null, pending: false };
  const unmeasured = candidates.filter((r) => !r.pixels);
  const file = unmeasured.find((r) => r.reach !== 'embedded') ?? null;
  if (file) return { row: file, reason: null, pending: false };
  if (waiting || unmeasured.length) return { row: null, reason: 'measuring its camera render', pending: true };
  const px = smaller?.pixels;
  return {
    row: null,
    reason: px ? `its camera render is ${px.width} × ${px.height}, smaller than the proxy` : 'its camera render is smaller than the proxy',
    pending: false,
  };
}

/** The role a row of the name menu stands for — what the line after a pick offers the roll. */
export function roleOfRow(row: Pick<Rendition, 'role'>): ChoiceRole {
  return row.role === 'proxy' ? 'proxy' : row.role === 'sensor' ? 'sensor' : 'delivered';
}
