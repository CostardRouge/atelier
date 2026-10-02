# The Layers tab's face — palette, list, Mask | Adjust, recipe, mask view

Read before touching `LayersPanel.tsx`, `MaskPanel.tsx`, `KindPalette.tsx`,
`kind-palette.ts` or `KindGlyph.tsx`. What the subject model answers is
`subject-model.md`; the mask maths is `render-layers.md` and `mask-parts.md`.
The plan is `docs/mask-ui-redesign.md` §5, built on his *«vas-y avec tes
recommandations»* (2026-10-02) — the lab's face, drawn at
https://claude.ai/artifact/5jy9NnEg1SoRdUNjDcAMas.

## ONE palette of kinds (2026-10-02)

**Decision**: a single `+ Layer` opens a grouped palette — *Point at it*
(Subject, Colour, Brightness), *Draw it* (Linear, Radial, Shade, Painted),
*Everywhere* (Whole picture) — each a glyph and one line of use. The SAME
component changes a layer's kind (the chip beside *Mask*, `type`; a term's,
`part-type`) and combines a term (`part`, Add / Subtract / Intersect at its
head). **Why**: the tab had 22 kind buttons on one screen asking one question
three ways (eight `+ Kind`, an eight-way switch, six `± Kind` under Combine),
his *«les boutons peut-être qu'ils peuvent être mieux faits»* — Hick's law.
**How to apply**: a new kind is ONE entry in `PALETTE_GROUPS`, never a button
somewhere; a term's kinds are `PART_KINDS`, filtered in `paletteGroups`, never
listed twice. It is a popover portalled at fixed coordinates (`menuAnchor`,
the menu rule of `frontend.md`) and a `BottomSheet` on a compact shell. A
kind made with the pointer (`takesPointer`: subject, colour, painted) turns
Pick / Paint on — a fresh painted layer now does too, where only a subject and
a colour did. Switching kind still STARTS the shape fresh (`defaultMask`).
Driven headless at 1440 and 390 px: add, change (the current kind marked),
combine with Subtract, Escape and a press outside close it.
