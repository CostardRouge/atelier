/**
 * How the open layer's mask is shown on the picture (2026-10-02,
 * `docs/mask-ui-redesign.md` §3.6): three states in the picture's bar and on
 * `M` — Hidden, its Outline, a Fill — where a segmented switch, a "keep it
 * shown" checkbox and a Done link used to share the inspector. While the
 * pointer is MAKING the mask (Pick, Paint), a Hidden view shows the outline by
 * itself — the moment it is needed —, and Outline or Fill keep it shown
 * whatever the pointer does, which is what the checkbox was for. Pure.
 */

export type MaskView = 'off' | 'outline' | 'fill';

export const MASK_VIEW_LABELS: Record<MaskView, string> = { off: 'Hidden', outline: 'Outline', fill: 'Fill' };

/** What `M` and the bar's glyph step to: hidden → outline → fill → hidden. */
export function nextMaskView(v: MaskView): MaskView {
  return v === 'off' ? 'outline' : v === 'outline' ? 'fill' : 'off';
}

/** What the stage draws: the view chosen, else the outline by itself while the pointer makes the mask. */
export function shownMaskView(view: MaskView, pointerOn: boolean): MaskView {
  return pointerOn && view === 'off' ? 'outline' : view;
}
