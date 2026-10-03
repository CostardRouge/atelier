/**
 * The frame shapes a project or a variant can be delivered in — their own
 * module because `project-types.ts` and `export-variants.ts` both read them
 * and import each other otherwise (the one runtime cycle the 2026-10-02 audit
 * found, ARC-03): it held only because the presets were read inside a
 * function, and a top-level read would have crashed at load depending on
 * which module came first.
 */

export interface AspectPreset {
  id: string;
  /** Destination-named, the way a creator thinks ("Reels", not "1080×1920"). */
  label: string;
  w: number;
  h: number;
}

export const ASPECT_PRESETS: readonly AspectPreset[] = [
  { id: '9:16', label: 'Reels · TikTok · Shorts', w: 9, h: 16 },
  { id: '16:9', label: 'YouTube · landscape', w: 16, h: 9 },
  { id: '1:1', label: 'Square post', w: 1, h: 1 },
  { id: '4:5', label: 'Portrait post', w: 4, h: 5 },
  // The shapes a photograph is SHOT in, so a still can go out whole. Added in
  // portrait/landscape pairs so the two-column pickers keep reading as pairs;
  // a picker wanting them by shape sorts by w / h rather than reordering this.
  { id: '3:4', label: 'Phone photo · portrait', w: 3, h: 4 },
  { id: '4:3', label: 'Phone & drone photo', w: 4, h: 3 },
  { id: '2:3', label: 'Pinterest · camera portrait', w: 2, h: 3 },
  { id: '3:2', label: 'Camera photo · landscape', w: 3, h: 2 },
];
