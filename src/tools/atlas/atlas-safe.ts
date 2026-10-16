/**
 * The SAFE ZONES of the social apps — where Reels, TikTok and Shorts draw
 * their own name, caption and buttons over a vertical video, a feed's crop
 * over a square or a 4:5 one, a player's bar over a wide one. Kept clear on
 * request: every spot of the overlay moves inside them and a piece dragged by
 * hand stops at their edge. Pure: fractions of the frame per ratio, and the
 * rectangle they leave.
 *
 * The 9:16 numbers are the three apps' interfaces put together and rounded
 * from their design guides, not measured on a phone: approximate on purpose,
 * erring on the side of more room.
 */

import type { FrameAspect, Rect } from './atlas-settings';

export type SafeMode = 'ignore' | 'clear';

/** What each edge loses, a fraction of the frame's width (left, right) or height (top, bottom). */
export interface SafeInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export const SAFE_ZONES: Record<FrameAspect, SafeInsets> = {
  // The account and caption at the bottom, the buttons down the right, the tabs at the top.
  '9:16': { top: 0.12, bottom: 0.24, left: 0.06, right: 0.14 },
  // A feed draws nothing over the picture; a small margin for its rounded crop.
  '4:5': { top: 0.04, bottom: 0.04, left: 0.04, right: 0.04 },
  '1:1': { top: 0.04, bottom: 0.04, left: 0.04, right: 0.04 },
  // A player's bar and title over a wide video.
  '16:9': { top: 0.08, bottom: 0.12, left: 0.04, right: 0.04 },
  '3:2': { top: 0.06, bottom: 0.1, left: 0.04, right: 0.04 },
};

/** The part of a `width × height` frame the apps leave alone. */
export function safeRect(aspect: FrameAspect, width: number, height: number): Rect {
  const z = SAFE_ZONES[aspect];
  return { x: z.left * width, y: z.top * height, w: width * (1 - z.left - z.right), h: height * (1 - z.top - z.bottom) };
}
