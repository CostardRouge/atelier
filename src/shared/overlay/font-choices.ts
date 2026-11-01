import type { FontChoice } from '../ui/font-picker';
import { CURATED_FONTS, type OverlayFontFamily } from './overlay-types';

/**
 * The overlay's fonts as a font picker lists them (`shared/ui/FontPicker.tsx`):
 * the brand faces the shell ships (`main.tsx`) by kind, then the three every
 * device has. The id is the family name, as an element stores it. (pure)
 */
const FACES: Record<OverlayFontFamily, Omit<FontChoice, 'id' | 'label'>> = {
  'Space Grotesk': { family: "'Space Grotesk', system-ui, sans-serif", weights: [400, 500, 600, 700], group: 'Sans' },
  'Instrument Serif': { family: "'Instrument Serif', Georgia, serif", weights: [400], group: 'Serif' },
  'JetBrains Mono': { family: "'JetBrains Mono', ui-monospace, monospace", weights: [400, 500, 600], group: 'Mono' },
  VT323: { family: "VT323, 'JetBrains Mono', monospace", weights: [400], group: 'Mono' },
  Arial: { family: 'Arial, Helvetica, sans-serif', weights: [400, 700], group: 'On every device', system: true },
  Georgia: { family: 'Georgia, serif', weights: [400, 700], group: 'On every device', system: true },
  'Courier New': { family: "'Courier New', Courier, monospace", weights: [400, 700], group: 'On every device', system: true },
};

const ORDER = ['Sans', 'Serif', 'Mono', 'On every device'];

export const OVERLAY_FONT_CHOICES: readonly FontChoice[] = CURATED_FONTS.map((f) => ({ id: f, label: f, ...FACES[f] })).sort(
  (a, b) => ORDER.indexOf(a.group) - ORDER.indexOf(b.group),
);
