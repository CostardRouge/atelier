# Road Trip gets the Studio's editor shape

Agreed plan, written 2026-09-06 with the maintainer, **not yet built**. It is a
brief for the session that implements it, in the same spirit as
`winnow-bridge.md`: every claim about the current code carries a path and a line
so it can be re-checked rather than trusted.

Read `docs/memory/roadtrip.md` and `docs/memory/studio.md` before acting on this
— the constraints quoted below are drawn from them and are not repeated in full.

## Why

Road Trip works, but composing a piece is painful. `PostEditor.tsx` is 1444 lines
feeding a single 22rem column of **16 stacked sections** behind a one-at-a-time
accordion (`Fold`, `PostEditor.tsx:115`, one `openFold` state at `:173`): to
change a colour you close the picture, to change the picture you close the
colour. And `BadgeStage` (`BadgeStage.tsx:173`) is a display-only `<canvas>` —
you cannot point at the thing you want to change, you hunt for the fold that owns
it.

The Studio solved both already: a tab bar over the inspector (`PanelTab` union at
`StudioEditor.tsx:127`, `TABS` at `:137`), and a stage where clicking an element
selects it and dragging moves it (`use-overlay-stage.ts:410` → `hitTest`).

Outcome: the piece editor gains **six tabs** (Content · Style · Picture · Grade ·
Deck · Export), **click-to-select on the canvas**, **drag to place the badge**,
and **grading** — the last built as a *facade over the Studio's engine*, never a
second implementation.

## Decisions taken with the maintainer, 2026-09-06

- **Road Trip grades.** His words: *"i really want to be able to grade from
  roadtrip, preview only is ok but if it does not work for png deck we must find
  another way, maybe roadtrip must become a facade of the studio, like we pilot
  everything from roadtrip ui but underneath we use the studio rendering
  engine"*. The facade turns out to be free — see the next section.
- **Drag moves the BLOCK**, not one piece. Click any piece to select and inspect
  it; dragging anywhere on the badge moves the whole stack. The `RATIOS`
  hierarchy in `badge-layout.ts:79` (asserted by a test) and the block model
  survive untouched. Per-piece free placement was offered and declined.
- **Six tabs**, named for Road Trip's own nouns rather than mirroring the
  Studio's five.

## On the grade, and the memory entry it appears to contradict

`docs/memory/roadtrip.md` records: *"Rejected: … having Road Trip's own exporter
borrow the project's LUT (two exporters doing one job, guaranteed to drift)."*

That entry is honoured, not reversed. The concern was **two exporters**; this
change adds none, because Road Trip's video export already *is* the Studio's:

- `useLutStack()` is **already** in `src/shared/lut/use-lut-stack.ts:82`,
  tool-agnostic and DOM-free apart from `fetch`/file-picking. Road Trip calls it
  as-is. (Note `useLutSelection` is the *legacy* single-look hook, documented at
  `use-lut-stack.ts:5-8` as not to be grown — do not use it.)
- `GradePanel.tsx` has exactly one prop, `{ stack: LutStack }`, and imports
  nothing from `tools/`. It moves to `shared/lut/` — the `StylePanel` precedent
  verbatim (`architecture.md`: *"a second tool needing an editing component means
  moving the generic half out, never reaching across tools"*).
- The one grading primitive, `makeFrameGrader(lut, w, h, intensity)`
  (`src/shared/lut/frame-grader.ts:23`), is **synchronous** and already used by
  every other still and video surface.
- `hook-video-export.ts:40` calls `exportVariantVideo` and hard-codes `lut: null`
  at `:46`. Passing a real LUT there is a one-line change to an argument, with no
  type change (`VariantRenderOptions.lut: CubeLut | null`,
  `export-variant.ts:43`).

So there remains exactly one exporter and one grading shader. **The memory entry
gets revised to say this, not deleted.**

---

## Phase 1 — Stable element ids (prerequisite, small)

Road Trip's `OverlayElement[]` are **derived on every render**, and each line is
built by `createTextElement`, which mints `id: uid()`
(`overlay-types.ts:395`). A hit-test that returns an id is useless when the id
changes on the next repaint.

- `badgeElements` (`src/shared/roadtrip/badge-layout.ts:266`) assigns
  `el.id = ` `` `piece:${piece.key}` `` — deterministic, and it round-trips to a
  `BadgePiece` by stripping the prefix.
- `contentSlideElements` (`src/shared/roadtrip/deck.ts:131`) assigns
  `caption:<i>`.
- `ctaLayout` (`src/shared/roadtrip/cta-slide.ts:112`, through the `line` helper
  at `:87`) assigns `cta:<role>`.

Safe: these elements are never persisted — the badge is derived from
`BadgeWords` + `textOverrides` + `pieceStyles` — so no document sees an id.

Tests beside each module: calling twice yields identical ids; every id parses
back to its piece; ids stay unique when a piece is absent.

## Phase 2 — Tabbed inspector, and split `PostEditor`

Copy the Studio's shape, keep Road Trip's nouns.

```ts
type PanelTab = 'content' | 'style' | 'picture' | 'grade' | 'deck' | 'export';
const TABS = [ /* id + label, flat array, mirroring StudioEditor.tsx:137 */ ];
```

Six tabs in a 22rem column: `flex-wrap` into two rows of three, not `flex-1` (the
Studio's five at 340px is already tight). Tab state is `useState`, **not** in the
route — the Studio doesn't route its tab either, and `trip-route.ts`'s grammar
(`#/roadtrip/<trip>/<day>/<piece>`) stays as it is.

Sections move out of `PostEditor.tsx` into `src/tools/roadtrip/panels/`, one file
per tab body (`ContentTab`, `StyleTab`, `PictureTab`, `GradeTab`, `DeckTab`,
`ExportTab`). `PostEditor` keeps state, the stage, the transport and the tab bar
— target well under 500 lines. The `Fold` component and `openFold` state are
deleted.

Allocation of today's 16 sections (line refs are into the current
`PostEditor.tsx`):

| Tab | Holds |
| --- | --- |
| **Content** | piece picker + text field (`:1327-1371`), the day this piece tells (`:1040-1109`), counter (`:1111-1171`), time (`:1217-1296`), caption (`:995-1036`) |
| **Style** | `StylePanel` (trip theme, `:1373`), `PieceStylePanel` (`:1369`), words (`:1380-1428`) |
| **Picture** | library pick + `FrameStrip` (`:941-993`), `ShadesPanel` (`:1298-1325`), placement (`:1173-1215`), frame/aspect (`:909-928`), duration |
| **Grade** | new — see phase 4 |
| **Deck** | slide strip + reorder + include-CTA (`:744-823`), `CtaPanel` (`:930-938`), per-kind defaults (`:843-907`) |
| **Export** | PNG deck, hook clip (`:983-990`), `StudioLink` (`:831-841`), export note |

**Two invariants to enforce while moving things**, both from `roadtrip.md`:

1. *"before putting a control inside `isHook`, ask whether it is about the SLIDE
   … or about the PIECE"* — the Studio bridge and the per-kind defaults were once
   rendered inside the hook-only branch and vanished on a carousel's second
   slide; the maintainer reported them as missing. Re-classify each moved control
   as you go; do not carry the current branching over on faith.
2. Every option renders the real line it would draw, or the reason it cannot
   (`counterPreviews`, `timeAgoPreviews`). Moving a control must not lose its
   preview.

Keep the container query at `@min-[860px]` (`:651, 692, 743`) — never a viewport
one, the Library sidebar eats 288px the viewport cannot see. Any full-screen
overlay stays outside the `@container` wrapper (`container-type: inline-size`
implies containment and would break `position: fixed`).

## Phase 3 — Click to select, drag to place

`BadgeStage` keeps `renderBadge` (preview and export must stay the same code at
two sizes) and keeps its decode / `seek` / `frameSeq` structure untouched — that
structure exists because re-decoding per nudge made frame-picking stutter. It
gains only pointer handling, built on the **pure** helpers already in the engine:

- `measureOverlays(ctx, elements, cue, w, h, opts)` — `draw-overlays.ts:1710`
- `hitTest(boxes, px, py)` — `:1803`
- `boxForId(boxes, id)` — `:1814`

(`draw-overlays.ts` is detected as binary by `grep` — use `grep -a`.)

Flow:

- New props `selectedId: string | null`, `onSelect(id)`, `onMoveBlock(dx, dy)`.
- After `renderBadge` resolves, measure with the same `ctx` / elements /
  `DrawOptions` the paint used, and stroke the dashed `#d9442a` outline for
  `selectedId`. Drawn **in the stage, after the shared render** — `badgeToPng`
  and `renderDeck` never pass a selection, so an export cannot grow a selection
  rectangle.
- `RenderBadgeOptions` forwards `ghostId` to `drawOverlays`
  (`DrawOptions.ghostId` already exists, `draw-overlays.ts:70`), so a piece that
  has exited its window stays visible and selectable while chosen. Editor-only,
  never set by an export.
- `onPointerDown`: client → canvas pixels, `measureOverlays` → `hitTest` →
  `onSelect`.
- **Drag moves the whole block**: a normalized delta added to
  `post.badge.layout.x/y`, clamped 0..1, soft-snapped to 0/0.5/1 with `Alt` to
  bypass. `snap` is currently private at `use-overlay-stage.ts:89`; export it
  from the engine rather than copying five lines. The 3×3 anchor grid stays as
  the coarse tool (`positionFor`, `PostEditor.tsx:105`); drag is the fine one.
- Drag is **hook-only**. A caption block and the CTA are derived from fixed
  positions with nothing to write back to, so on those slides a click selects and
  focuses the field but moves nothing — and the cursor says so (`cursor-pointer`,
  not `cursor-grab`).

Selection routes through one `selectPiece(id)` in `PostEditor` that also
`setTab('content')` and focuses the piece's field — the Studio's lesson, recorded
in `studio.md`: *"picking an element switches the inspector back to the Overlay
tab … route every selection through `selectElement`, never
`setSelectedElementId` directly, or the tab stays put."* Its scroll-into-view
effect is keyed on `[selection, tab]`, not the id alone, for the same reason.

Hit-box caveats inherited from the engine, worth re-checking here: boxes are
measured **untransformed** so an animated piece does not squirm away from the
pointer, an element outside its window gets **no box** unless it is the ghosted
selection, and an outline or panel widens the box by half its stroke.

## Phase 4 — Grade, as a facade over the Studio's engine

**Storage** — `TRIP_DOC_VERSION` 9 → 10, migration in `trip-types.ts:518-649`:

- `TripDoc.grade: { layers: SavedLutLayer[]; output: OutputTransform }` — the
  trip's look, mirroring `theme` being per-trip. Default empty.
- `TripPost.grade: { layers; output } | null` — `null` means *follow the trip*,
  the established "empty means computed, never blank" rule. A picture needing its
  own correction departs; everything else inherits.
- `interpolation` is **not** stored — it is a localStorage render pref by design
  (`use-lut-interpolation.ts:5`).
- `trip-file.ts`: the grade is portable and travels in `.roadtrip.json` (a custom
  `.cube` rides as text inside `SavedLutLayer`).

**Rendering — one insertion point covers preview and PNG deck.** In `renderBadge`
(`badge-render.ts:271-274`), between measuring `coverRect` and `drawImage`, grade
the source at its own density and draw the returned canvas with the same
rectangle — byte for byte the `photo-frame.ts:90-101` pattern: *"Grade at the
source's own density, then crop: grading the cropped frame would give a different
result at every output size."* Shades, QR and `drawOverlays` all correctly stay
after the grade. `renderDeck` (`deck-export.ts:92`) goes through `badgeToPng` →
`renderBadge`, so the PNG deck is covered by the same edit.

The font-wait invariant survives (`badge-render.ts:257`, *"the fonts are waited
for FIRST, and everything after is synchronous"*): `makeFrameGrader` and the
whole `lut-gl` chain are synchronous, and the cube is parsed far upstream in
`useLutStack`. `renderBadge` keeps exactly one `await`, still first.

**Context lifetime — the one real trap.** A `makeFrameGrader` / `dispose()` pair
per call would build and lose a WebGL2 context on every repaint, and
`BadgeStage`'s paint effect has 11 deps (`BadgeStage.tsx:149-161`);
`lut-gl.ts:395` documents that contexts are only reclaimed on GC or a forced
loss. So `RenderBadgeOptions` takes a caller-owned `grader?: FrameGrader | null`
rather than a LUT: the stage keeps one in a ref, re-made only when the LUT,
intensity or size changes (the `use-overlay-stage.ts:157-175` precedent), while
`badgeToPng` makes and disposes one per slide, which is correct there.

**Video export** — `hook-video-export.ts:46`, `lut: null` becomes
`lut: opts.lut ?? null`. Still `exportVariantVideo`. No new export code anywhere.

**Panel** — `GradePanel.tsx` moves `tools/studio/` → `shared/lut/`, unchanged but
for three import paths; both tools import it from there. It carries the global
interpolation toggle, so Road Trip inherits that switch.

**The bridge conflict, and its rule.** A post linked to a project (`projectId`)
now has two grades. They never double-apply — the Studio export uses the
project's own `lutStack`, and the badge crossing the bridge carries no grade —
but they can *disagree*, and the author must not discover that in the delivered
file. So `StudioLink` states which grade the video export will use, and offers to
push Road Trip's into a project that has none. **A project that already carries a
grade is never overwritten** — the rule `withCtaOutro` already follows for an
author-composed outro.

Deferred, and said in the panel rather than hidden: a **per-slide** grade. v1 is
trip default + per-post override; a carousel whose slides need different
corrections is a real case, but it is not this change.

---

## Critical files

- `src/tools/roadtrip/PostEditor.tsx` — tab bar, split into `panels/`, selection routing
- `src/tools/roadtrip/BadgeStage.tsx` — pointer handling, selection outline
- `src/shared/roadtrip/badge-layout.ts` — stable piece ids
- `src/shared/roadtrip/badge-render.ts` — the grade insertion point, `ghostId` forwarding
- `src/shared/roadtrip/trip-types.ts` — v10, the grade fields, migration
- `src/shared/roadtrip/hook-video-export.ts:46` — pass the LUT through
- `src/shared/roadtrip/deck-export.ts` — thread the grade to each slide
- `src/tools/studio/GradePanel.tsx` → `src/shared/lut/GradePanel.tsx` (move)
- `src/shared/overlay/use-overlay-stage.ts:89` — export `snap`
- `src/tools/roadtrip/StudioLink.tsx` — say which grade the export uses

## Reused, not rebuilt

`useLutStack` · `makeFrameGrader` · `exportVariantVideo` · `measureOverlays` /
`hitTest` / `boxForId` / `DrawOptions.ghostId` · `StylePanel` ·
`PieceStylePanel` · `ShadesPanel` · `FrameStrip` · `renderBadge` (still the one
paint for preview and PNG).

## Verification

- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` — the four CI
  gates.
- New unit tests: stable ids (phase 1); trip v9→v10 migration round-trip,
  including a document with no grade and one with a custom `.cube` (phase 4).
- `node scripts/check-shader.mjs` — no shader edit is planned, but Road Trip
  newly exercises the LUT path and nothing in CI can see a broken shader.
- In `npm run dev`, on a real trip:
  - click each of the six pieces on the canvas → the right piece selects, the
    Content tab comes forward, the field focuses; drag → the block moves and the
    anchor grid agrees; select an exited piece → it ghosts rather than vanishing.
  - pick a LUT → the preview changes; export the PNG deck and confirm the file
    matches the preview; export the hook clip and confirm the same; check a
    linked project's grade is not silently overwritten.
  - narrow below 860px → the page scrolls as one, the panel has no inner
    scrollbar, no sideways document overflow at 390px.
- Memory: revise the `roadtrip.md` grade entry to say Road Trip now grades
  *through* the Studio's engine and why that is not the rejected second exporter;
  add entries for the tab shape, the derived-element id rule and the block-drag
  decision; update the matching line in `MEMORY.md`.

## Commits

One per phase, in order (ids → tabs → selection → grade), per `CLAUDE.md` rule 1.
