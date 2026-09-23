/**
 * What a delivered picture SAYS beyond the capture's own EXIF: who made it,
 * whose it is, and what wrote it (`docs/lightroom-gaps.md` §9, M1).
 *
 * The capture's metadata travels on its own account (`stamp-exif.ts`); this
 * module is the AUTHOR's half, written over it:
 *
 * - **The signature**, always: `Software` in the EXIF and `xmp:CreatorTool`
 *   in the XMP both say `Atelier` (`software-mark.ts`), on every delivered
 *   file — including one whose capture is unknown, which used to leave with
 *   nothing at all. It is not a switch: it is what tells this suite's export
 *   from the camera's own file beside it, and the maintainer wants the credit
 *   (*"j'ai bien envie de faire ma publicité"*).
 * - **The rights**, from an IDENTITY set once per person and kept with the
 *   preset book (`preset-book.ts`), so a second device signs the same way:
 *   `Artist` + `dc:creator`, `Copyright` + `dc:rights`. The copyright is a
 *   TEMPLATE whose `{year}` is the CAPTURE's year — a photograph taken in
 *   2024 and exported today is © 2024 — and whose `{creator}` is the name.
 *   Nothing is written until a name is set: the site is public, so no
 *   person's name is anybody's default.
 *
 * - **The words**, the PICTURE's own (M2, `RollPicture.title` / `caption`):
 *   a title as `dc:title`, a caption as `dc:description` and EXIF
 *   `ImageDescription` — the field Lightroom and Capture One call Caption.
 *   EXIF has no title tag worth writing (Windows' `XPTitle` is UTF-16 in a
 *   BYTE array and read by Explorer alone), so a title lives in the XMP.
 *
 * - **The place** (M4, `delivery-place.ts`): `photoshop:City`,
 *   `photoshop:Country`, `Iptc4xmpCore:CountryCode` — XMP only, since EXIF
 *   has no field for a place's name.
 *
 * Written twice, EXIF and XMP, because readers split: a camera-minded viewer
 * reads the EXIF, Lightroom and every DAM prefer the XMP, and only the XMP
 * holds Unicode by definition. The XMP is ONE packet — a second one in the
 * same file is what readers disagree about — so the Ultra HDR container
 * FOLDS this packet into its own rather than writing beside it (`ultra-hdr.ts`).
 *
 * Pure and DOM-free.
 */

import { ATELIER_SOFTWARE } from './software-mark';

/** Who signs a delivered picture — one per person, kept with the preset book. */
export interface DeliveryIdentity {
  /** The name written as `Artist` and `dc:creator`. Empty: no rights are written. */
  creator: string;
  /** The copyright line as a template: `{year}` is the capture's year, `{creator}` the name. */
  copyright: string;
}

/** The line a copyright takes until its author writes another — English, the suite's language. */
export const DEFAULT_COPYRIGHT_TEMPLATE = '© {year} {creator}. All rights reserved.';

export const EMPTY_IDENTITY: Readonly<DeliveryIdentity> = Object.freeze({
  creator: '',
  copyright: DEFAULT_COPYRIGHT_TEMPLATE,
});

/** A stored identity, or the empty one. Text is trimmed; an empty template falls back to the default. */
export function readIdentity(raw: unknown): DeliveryIdentity {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...EMPTY_IDENTITY };
  const r = raw as Record<string, unknown>;
  const creator = typeof r.creator === 'string' ? r.creator.trim() : '';
  const copyright = typeof r.copyright === 'string' ? r.copyright.trim() : '';
  return { creator, copyright: copyright || DEFAULT_COPYRIGHT_TEMPLATE };
}

export function sameIdentity(a: DeliveryIdentity, b: DeliveryIdentity): boolean {
  return a.creator === b.creator && a.copyright === b.copyright;
}

/**
 * The year a picture was TAKEN, from an EXIF `DateTimeOriginal`
 * (`YYYY:MM:DD HH:MM:SS`), else `fallback` — the export's own year, for a
 * picture whose capture time nobody knows.
 */
export function captureYear(dateTimeOriginal: string | undefined, fallback: number): number {
  const m = /^(\d{4})[:-]/.exec(dateTimeOriginal?.trim() ?? '');
  const year = m ? Number(m[1]) : NaN;
  return Number.isInteger(year) && year >= 1826 && year <= 9999 ? year : fallback;
}

/** The rights a picture carries, resolved: the name and the copyright line, or null for each that says nothing. */
export interface DeliveryRights {
  creator: string | null;
  copyright: string | null;
}

/**
 * The identity applied to one picture. No name, no rights at all — a line
 * reading "© 2026 . All rights reserved." is worse than none; a template
 * with no `{creator}` in it stands on its own once there is a name.
 */
export function resolveRights(identity: DeliveryIdentity | null, year: number): DeliveryRights {
  const creator = identity?.creator.trim() ?? '';
  if (!creator) return { creator: null, copyright: null };
  const template = identity?.copyright.trim() || DEFAULT_COPYRIGHT_TEMPLATE;
  const copyright = template.split('{year}').join(String(year)).split('{creator}').join(creator).trim();
  return { creator, copyright: copyright || null };
}

/** What the XMP packet of one delivered picture says. */
export interface DeliveryText {
  creator?: string | null;
  copyright?: string | null;
  /** The picture's own title — `dc:title` (M2). */
  title?: string | null;
  /** The picture's caption — `dc:description`, and EXIF `ImageDescription` beside it (M2). */
  caption?: string | null;
  /** Where it was taken, named offline (M4, `delivery-place.ts`). */
  place?: { city: string; country: string; countryCode: string } | null;
}

const NS = {
  x: 'adobe:ns:meta/',
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  xmp: 'http://ns.adobe.com/xap/1.0/',
  dc: 'http://purl.org/dc/elements/1.1/',
  xmpRights: 'http://ns.adobe.com/xap/1.0/rights/',
  photoshop: 'http://ns.adobe.com/photoshop/1.0/',
  iptc: 'http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/',
};

/** Text as XML character data or an attribute value. */
export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}

/** A language alternative with its one default entry — how XMP holds rights, a title, a caption. */
function alt(name: string, text: string): string {
  return `<${name}><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(text)}</rdf:li></rdf:Alt></${name}>`;
}

/**
 * The `rdf:Description` of one delivered picture: the signature always, the
 * rest where there is something to say.
 */
export function deliveryDescription(text: DeliveryText): string {
  const attrs = [`xmp:CreatorTool="${ATELIER_SOFTWARE}"`];
  const children: string[] = [];
  if (text.creator) children.push(`<dc:creator><rdf:Seq><rdf:li>${escapeXml(text.creator)}</rdf:li></rdf:Seq></dc:creator>`);
  if (text.copyright) {
    attrs.push('xmpRights:Marked="True"');
    children.push(alt('dc:rights', text.copyright));
  }
  if (text.title) children.push(alt('dc:title', text.title));
  if (text.caption) children.push(alt('dc:description', text.caption));
  if (text.place) {
    if (text.place.city) attrs.push(`photoshop:City="${escapeXml(text.place.city)}"`);
    if (text.place.country) attrs.push(`photoshop:Country="${escapeXml(text.place.country)}"`);
    if (text.place.countryCode) attrs.push(`Iptc4xmpCore:CountryCode="${escapeXml(text.place.countryCode)}"`);
  }
  return (
    `<rdf:Description rdf:about="" xmlns:xmp="${NS.xmp}" xmlns:dc="${NS.dc}" xmlns:xmpRights="${NS.xmpRights}"` +
    ` xmlns:photoshop="${NS.photoshop}" xmlns:Iptc4xmpCore="${NS.iptc}" ${attrs.join(' ')}>` +
    children.join('') +
    `</rdf:Description>`
  );
}

/** A whole XMP packet around `descriptions`, in the shape `ultra-hdr.ts` writes its own. */
export function xmpPacket(descriptions: string): string {
  return (
    `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>` +
    `<x:xmpmeta xmlns:x="${NS.x}" x:xmptk="${ATELIER_SOFTWARE}">` +
    `<rdf:RDF xmlns:rdf="${NS.rdf}">` +
    descriptions +
    `</rdf:RDF></x:xmpmeta><?xpacket end="w"?>`
  );
}

/** The packet a delivered picture carries. */
export function deliveryXmp(text: DeliveryText): string {
  return xmpPacket(deliveryDescription(text));
}

/**
 * The `rdf:Description`s inside a packet, verbatim — what a second writer
 * (the Ultra HDR container) folds into its own packet so the file keeps ONE.
 * Empty when the packet holds none it can read.
 */
export function xmpDescriptions(packet: string): string {
  const open = /<rdf:RDF\b[^>]*>/.exec(packet);
  const close = packet.lastIndexOf('</rdf:RDF>');
  if (!open || close < open.index) return '';
  return packet.slice(open.index + open[0].length, close).trim();
}
