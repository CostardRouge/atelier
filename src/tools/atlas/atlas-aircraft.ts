/**
 * Which drone flew a flight — read from the clip's own MP4 metadata, pure.
 *
 * A DJI `.srt` names no aircraft, so the atlas asks the VIDEO beside it, and
 * only its metadata: the `udta` and `meta` boxes of the `moov` (a few
 * kilobytes, `readAircraft` slices exactly them out of a multi-gigabyte
 * file). Three shapes are read — QuickTime's `©mdl`/`©mak`/`©enc`/`©too`
 * atoms, an iTunes-style `meta/ilst`, and Apple's `meta/keys` + `ilst`
 * (`com.apple.quicktime.model`) — then, failing those, a camera code
 * (`FC8482`) or a `DJI…` word written anywhere in them.
 *
 * Nothing is guessed from the flight itself. What a file does not say stays
 * unsaid (null), and the author names it in the panel; a camera code we do
 * not know is shown as the code.
 */

export interface AircraftTags {
  make?: string;
  model?: string;
  encoder?: string;
  software?: string;
  /** Every printable run found, for the last-resort scans. */
  strings: string[];
}

/** Camera codes DJI writes as the model, mapped to the aircraft they ship in. */
const DJI_CODES: Record<string, string> = {
  FC8482: 'DJI Mini 4 Pro',
  FC3582: 'DJI Mini 3 Pro',
  FC7303: 'DJI Mini 2',
  FC3411: 'DJI Air 2S',
  FC3170: 'DJI Mavic Air 2',
  FC220: 'DJI Mavic Pro',
  FC330: 'DJI Phantom 4',
};

const decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8', { fatal: false }) : null;

function text(bytes: Uint8Array): string {
  // eslint-disable-next-line no-control-regex
  return (decoder ? decoder.decode(bytes) : String.fromCharCode(...bytes)).replace(/\u0000/g, '').trim();
}

function u32(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

function fourcc(b: Uint8Array, o: number): string {
  return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
}

interface Box {
  type: string;
  /** Payload start and end (after the header). */
  start: number;
  end: number;
}

/** The boxes laid end to end in `[from, to)`; a malformed size stops the walk. */
export function childBoxes(b: Uint8Array, from: number, to: number): Box[] {
  const out: Box[] = [];
  let o = from;
  while (o + 8 <= to) {
    let size = u32(b, o);
    const type = fourcc(b, o + 4);
    let header = 8;
    if (size === 1) {
      if (o + 16 > to) break;
      size = u32(b, o + 8) * 2 ** 32 + u32(b, o + 12);
      header = 16;
    } else if (size === 0) size = to - o;
    if (size < header || o + size > to) break;
    out.push({ type, start: o + header, end: o + size });
    o += size;
  }
  return out;
}

/**
 * A `meta` box's children: in MP4 it is a FullBox (four bytes of version and
 * flags, zero here) before its children; in QuickTime it is not. A child box
 * can never measure zero, so a zero first word is the FullBox's.
 */
function metaChildren(b: Uint8Array, box: Box): Box[] {
  const skip = box.end - box.start >= 4 && u32(b, box.start) === 0 ? 4 : 0;
  return childBoxes(b, box.start + skip, box.end);
}

/** The text an `ilst` item or a `data` atom holds. */
function itemText(b: Uint8Array, box: Box): string | null {
  const data = childBoxes(b, box.start, box.end).find((c) => c.type === 'data');
  if (data && data.end - data.start > 8) return text(b.subarray(data.start + 8, data.end));
  return null;
}

/** A QuickTime `©xxx` atom: two bytes of length, two of language, then the text. */
function qtText(b: Uint8Array, box: Box): string | null {
  const inner = itemText(b, box);
  if (inner) return inner;
  if (box.end - box.start < 4) return null;
  const len = (b[box.start] << 8) | b[box.start + 1];
  const end = Math.min(box.end, box.start + 4 + len);
  return text(b.subarray(box.start + 4, end)) || null;
}

const TAG_OF: Record<string, keyof Omit<AircraftTags, 'strings'>> = {
  '©mak': 'make',
  '©mdl': 'model',
  '©enc': 'encoder',
  '©too': 'software',
  '©swr': 'software',
};

const KEY_OF: Record<string, keyof Omit<AircraftTags, 'strings'>> = {
  'com.apple.quicktime.make': 'make',
  'com.apple.quicktime.model': 'model',
  'com.apple.quicktime.software': 'software',
};

/** Printable ASCII runs of four or more characters. */
function printableRuns(b: Uint8Array): string[] {
  const out: string[] = [];
  let run = '';
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    if (c >= 32 && c < 127) run += String.fromCharCode(c);
    else {
      if (run.length >= 4) out.push(run);
      run = '';
    }
  }
  if (run.length >= 4) out.push(run);
  return out;
}

/** Read the tags out of `udta` / `meta` payloads (each a run of boxes). */
export function parseMetadata(blocks: readonly Uint8Array[]): AircraftTags {
  const tags: AircraftTags = { strings: [] };
  const set = (key: keyof Omit<AircraftTags, 'strings'>, value: string | null) => {
    if (value && !tags[key]) tags[key] = value;
  };
  const walk = (b: Uint8Array, boxes: Box[], depth: number) => {
    for (const box of boxes) {
      const tag = TAG_OF[box.type];
      if (tag) set(tag, qtText(b, box));
      if (box.type === 'meta' && depth < 4) {
        const kids = metaChildren(b, box);
        const keys = kids.find((k) => k.type === 'keys');
        const ilst = kids.find((k) => k.type === 'ilst');
        if (keys && ilst) {
          // `keys`: version/flags, a count, then [size, namespace, name] each.
          const names: string[] = [];
          for (const k of childBoxes(b, keys.start + 8, keys.end)) names.push(fourcc(b, k.start - 4) + text(b.subarray(k.start, k.end)));
          for (const item of childBoxes(b, ilst.start, ilst.end)) {
            const index = u32(b, item.start - 4);
            const name = names[index - 1]?.slice(4);
            if (name && KEY_OF[name]) set(KEY_OF[name], itemText(b, item));
          }
        }
        if (ilst) walk(b, childBoxes(b, ilst.start, ilst.end), depth + 1);
      }
      if (box.type === 'udta' && depth < 4) walk(b, childBoxes(b, box.start, box.end), depth + 1);
    }
  };
  for (const b of blocks) {
    walk(b, childBoxes(b, 0, b.length), 0);
    tags.strings.push(...printableRuns(b));
  }
  return tags;
}

/** `DJIMini4Pro` → `DJI Mini 4 Pro`: the words a run-together name already holds, spaced. */
export function spaceWords(name: string): string {
  return name
    .replace(/[_]+/g, ' ')
    .replace(/^DJI(?=[A-Z])/, 'DJI ')
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/([0-9])([A-Z][a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The aircraft's name as the file states it, or null. A known camera code
 * becomes its aircraft; an unknown one stays the code («DJI FC9113»).
 */
export function aircraftName(tags: AircraftTags): string | null {
  const code = (s: string | undefined) => s?.match(/\bFC\d{3,4}\b/)?.[0];
  const fromCode = (c: string) => DJI_CODES[c] ?? `DJI ${c}`;
  const model = tags.model?.trim();
  if (model) {
    const c = code(model);
    if (c) return fromCode(c);
    const make = tags.make?.trim();
    const spaced = spaceWords(model);
    if (make && !spaced.toLowerCase().startsWith(make.toLowerCase())) return `${make} ${spaced}`;
    return spaced;
  }
  for (const s of [tags.encoder, tags.software]) {
    const c = code(s);
    if (c) return fromCode(c);
    if (s && /^DJI\s?[A-Z]/.test(s)) return spaceWords(s);
  }
  for (const s of tags.strings) {
    const c = code(s);
    if (c) return fromCode(c);
  }
  for (const s of tags.strings) {
    const m = s.match(/\bDJI ?(?:Mini|Air|Mavic|Avata|FPV|Neo|Flip|Phantom|Inspire|Matrice)[ A-Za-z0-9]{0,16}/);
    if (m) return spaceWords(m[0]).trim();
  }
  return null;
}
