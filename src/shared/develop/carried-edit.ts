/**
 * A Develop picture's WHOLE EDIT, carried into Trips or the Studio (item 34
 * of `docs/lightroom-gaps.md`).
 *
 * The hosts already hold a picture's develop and its look in fields of their
 * own, edited by the one Develop sheet; what they could not draw was the rest
 * of a roll's work — the perspective, the lens, the detail, the repair, the
 * layers and their masks, the post-crop vignette. Those cross here as a
 * VALUE, copied onto the slide or the media with where they came from, and
 * the host draws them through the very pass chain a roll's export uses
 * (`picture-passes.ts`): the agreed shape of the photo editor — the hosts
 * "gain rendering, not panels" (`docs/photo-editor.md` §4).
 *
 * Copied, never linked: a trip opened on a phone draws what it holds, with no
 * roll to load; a later change on the roll is OFFERED as an update (`from.at`
 * against the picture's last step), never pushed into a document the author
 * is not looking at.
 *
 * What does not cross: the crop and the border — the frame is the host's own
 * (a slide's framing in the piece's aspect, a project's variants) — and a
 * develop made on the SENSOR, whose numbers bind a material the host never
 * draws (`roll-choice.md`: "numbers bind their material").
 *
 * Pure and DOM-free.
 */

import { isRawDevelop, type DevelopSettings } from './develop';
import { pictureLabel, pictureEdits, sameMediaRef, isClipPicture, type PictureEdit, type RollDoc, type RollGrade, type RollPicture } from './roll-types';
import { CARRIED_SECTIONS, type CarriedEdit } from './carried-record';
import { sectionValues } from './journal';
import { PICTURE_SECTIONS } from './picture-sections';
import { needsSubjectRasters } from './subject-rasters';
import { picturePasses, type PassSettings, type PicturePasses } from './picture-passes';
import type { BrushRaster } from '../render/brush-raster';
import { profileInEffect } from '../lens/lens-profile';
import type { SavedMediaRef } from '../projects/media-ref';

export { CARRIED_SECTIONS, readCarriedEdit, type CarriedEdit } from './carried-record';

/** The sections that stay in Develop: the frame is the host's. */
export const FRAME_SECTIONS: readonly PictureEdit[] = ['crop', 'border'];

/** What one roll picture offers a host: its develop and look, its carried edit, what stays behind. */
export interface EditOffer {
  roll: RollDoc;
  picture: RollPicture;
  develop: DevelopSettings | null;
  look: RollGrade | null;
  /** Its origin and its passes — none when it holds nothing beyond its develop and look, or is a clip. */
  edit: CarriedEdit;
  /** Sections the picture carries that do not cross (its crop, its border), said by the host. */
  stays: PictureEdit[];
  /** Why the offer cannot be taken, or null. */
  refusal: string | null;
}

/**
 * The offer a roll picture makes. A clip carries its develop and its look
 * alone — the rest are a still's passes. A develop made on the sensor is
 * REFUSED with its reason.
 */
export function offerFrom(roll: RollDoc, picture: RollPicture, now: number = Date.now()): EditOffer {
  const edits = new Set(pictureEdits(picture));
  const stays = FRAME_SECTIONS.filter((s) => edits.has(s));
  const refusal = isRawDevelop(picture.develop)
    ? 'developed on its sensor in Develop — this side draws the camera’s own render, where those numbers mean something else; export it from Develop instead'
    : null;
  const carried = isClipPicture(picture) ? [] : CARRIED_SECTIONS.filter((s) => edits.has(s));
  const profile = picture.lensProfile && picture.lensProfile.onRender ? picture.lensProfile : null;
  const edit: CarriedEdit = {
    from: { roll: roll.id, rollName: roll.name, picture: picture.id, label: pictureLabel(picture), media: { ...picture.ref }, at: now },
    values: structuredClone(sectionValues(picture, carried)),
    ...(profile ? { lensProfile: structuredClone(profile) } : {}),
  };
  return {
    roll,
    picture,
    develop: picture.develop ? structuredClone(picture.develop) : null,
    look: picture.grade ? structuredClone(picture.grade) : null,
    edit,
    stays,
    refusal,
  };
}

/**
 * The roll pictures that hold `media` and carry an edit — a variant is its own
 * offer —, the most recently edited roll first. What a host lists beside a
 * picture it shows.
 */
export function offersFor(rolls: readonly RollDoc[], media: SavedMediaRef, now: number = Date.now()): EditOffer[] {
  const out: EditOffer[] = [];
  for (const roll of [...rolls].sort((a, b) => b.updatedAt - a.updatedAt)) {
    for (const picture of roll.pictures) {
      if (!sameMediaRef(picture.ref, media) || pictureEdits(picture).length === 0) continue;
      out.push(offerFrom(roll, picture, now));
    }
  }
  return out;
}

/** The last time the roll's picture changed — its newest journal step, else the roll's own date. */
export function pictureChangedAt(roll: RollDoc, picture: RollPicture): number {
  const journal = picture.journal ?? [];
  return journal.length > 0 ? journal[journal.length - 1].at : roll.updatedAt;
}

/** Whether the roll's picture changed after the edit was carried — an update to offer. */
export function carriedIsStale(edit: Pick<CarriedEdit, 'from'>, roll: RollDoc, picture: RollPicture): boolean {
  return pictureChangedAt(roll, picture) > edit.from.at;
}

/** The edit when it was made on `media`, else null — what a host may say about the picture it holds. */
export function carriedOn(edit: CarriedEdit | null | undefined, media: SavedMediaRef | null | undefined): CarriedEdit | null {
  return edit && media && sameMediaRef(edit.from.media, media) ? edit : null;
}

/** Whether the edit draws anything beyond the host's own develop and look. */
export function carriedDraws(edit: CarriedEdit | null | undefined): boolean {
  return carriedSections(edit).length > 0;
}

/** The edit a host DRAWS over `media`: made on it, and holding a pass. */
export function drawnEdit(edit: CarriedEdit | null | undefined, media: SavedMediaRef | null | undefined): CarriedEdit | null {
  const on = carriedOn(edit, media);
  return on && carriedDraws(on) ? on : null;
}

/** The roll picture a held edit came from, when this browser still holds the roll. */
export function carriedSource(
  rolls: readonly RollDoc[],
  edit: CarriedEdit | null | undefined,
): { roll: RollDoc; picture: RollPicture } | null {
  if (!edit) return null;
  const roll = rolls.find((r) => r.id === edit.from.roll);
  const picture = roll?.pictures.find((p) => p.id === edit.from.picture);
  return roll && picture ? { roll, picture } : null;
}

/** The pass settings a carried edit draws with: the whole picture, no crop. */
export function carriedPassSettings(edit: CarriedEdit): PassSettings {
  const v = edit.values;
  return {
    framing: null,
    aspect: 'original',
    keystone: v.perspective ?? null,
    lens: v.lens ?? null,
    lensProfile: profileInEffect(edit.lensProfile, false),
    layers: v.layers ?? null,
    detail: v.detail ?? null,
    repair: v.repair ?? null,
    vignette: v.vignette ?? null,
  };
}

/**
 * The passes a host grades a picture through: on either side of its cube,
 * for a picture of aspect `ar` decoded at `scale` of its own size. Built per
 * grader — a pass holds textures on the context it first drew on.
 */
export function carriedPasses(
  edit: CarriedEdit | null | undefined,
  ar: number,
  scale: number,
  rasters: ReadonlyMap<string, BrushRaster> | null,
): PicturePasses {
  if (!edit) return { pre: [], passes: [] };
  return picturePasses(carriedPassSettings(edit), ar, scale, rasters, false);
}

/**
 * The same over a decoded picture: its aspect from its size, the kernels'
 * scale from its own size against the file's (`natural`, when it was decoded
 * smaller) — detail is stated in the FILE's pixels.
 */
export function carriedPassesOver(
  edit: CarriedEdit | null | undefined,
  picture: { width: number; height: number; natural?: { width: number; height: number } },
  rasters: ReadonlyMap<string, BrushRaster> | null,
): PicturePasses {
  if (!edit || picture.width <= 0 || picture.height <= 0) return { pre: [], passes: [] };
  return carriedPasses(edit, picture.width / picture.height, picture.width / (picture.natural?.width ?? picture.width), rasters);
}

/** Whether drawing the edit asks the subject model first. */
export function carriedNeedsRasters(edit: CarriedEdit | null | undefined): boolean {
  return Boolean(edit && needsSubjectRasters(edit.values.layers));
}

/** A key that changes whenever what the edit draws changes — for a host's held grade. */
export function carriedKey(edit: CarriedEdit | null | undefined): string {
  return edit && carriedDraws(edit) ? JSON.stringify([edit.values, edit.lensProfile ?? null]) : '';
}

/** `perspective · lens · layers` — what a carried edit draws, for a host's line. */
export function carriedSections(edit: CarriedEdit | null | undefined): PictureEdit[] {
  if (!edit) return [];
  const has = CARRIED_SECTIONS.filter((s) => s in edit.values);
  return edit.lensProfile && !has.includes('lens') ? ['lens', ...has] : has;
}

const word = (s: PictureEdit) => (PICTURE_SECTIONS.find((x) => x.id === s)?.label ?? s).toLowerCase();

/** What a taken edit draws beyond the host's develop and look: `perspective · layers`, or empty. */
export function carriedWords(edit: CarriedEdit | null | undefined): string {
  return carriedSections(edit).map(word).join(' · ');
}

/**
 * What taking an offer writes, in words — `develop · look · perspective` —
 * and what it leaves in Develop: `carriesLook` false for a host whose look is
 * not the picture's own (a Studio project's is the whole clip's).
 */
export function offerWords(offer: EditOffer, carriesLook = true): { takes: string; leaves: string } {
  const takes = [
    ...(offer.develop ? ['develop'] : []),
    ...(offer.look && carriesLook ? ['look'] : []),
    ...carriedSections(offer.edit).map(word),
  ];
  const leaves = [...(offer.look && !carriesLook ? ['look'] : []), ...offer.stays.map(word)];
  return { takes: takes.join(' · '), leaves: leaves.join(' · ') };
}
