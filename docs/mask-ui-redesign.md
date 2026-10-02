# Develop's layers and masks, measured, and a subject that can be taken back

**Status: proposed on 2026-10-02; §5 being built the same day** on his *«vas-y
avec tes recommandations, construis-le»*, §6 answered by its recommendations
(the lab's face, ⌥ beside the switch, SAM after steps 1–3 on his pictures,
Refine shown at once). Built: §5.1 Remove, §5.2 Refine — `docs/memory/subject-model.md`.
This brief comes from his
report. The lab that carries the proposal as a working mock is
<https://claude.ai/artifact/5jy9NnEg1SoRdUNjDcAMas>. It holds the stage, the
proposed inspector, today's inspector as measured, and the model's four paths.
The scene and the model's answers in the lab are scripted: an object touching
the subject comes along, a look-alike far away comes too, and thin parts fall
away at a soft edge. §1 is fact, traced to `main` `f6ee666`. §2 is his report,
§3 to §5 are the proposal, and §6 is his to decide. Read this brief before
touching `LayersPanel.tsx`, `MaskPanel.tsx`, `use-subject-masks.ts` or
`segment/segmenter.ts`.

His words: *«l'interface sur tout ce qui est masque… les boutons peut-être
qu'ils peuvent être mieux faits… la liste des calques et aussi l'ajout des
calques… j'aimerais pouvoir passer en soustraction. Le modèle ne fait que de
l'addition… parfois ça en rajoute trop… soit on change de modèle, soit on
donne plus de réglages au modèle, soit on fait ce système de soustraction…
ou un modèle heuristique, un algo maison»*.

## 1. What is there (fact)

- **The mask kinds are drawn three times on one screen.**
  - `LayersPanel.tsx` `KINDS`: eight `+ Kind` ghost buttons to add a layer.
  - `MaskPanel.tsx` `KIND_OPTIONS`: an eight-way `Segmented` to change the open
    layer's kind.
  - The Combine block's `PART_KIND_OPTIONS`: six more buttons, one per part
    kind.

  That makes 22 kind buttons with a Subject layer open, measured in the app at
  1440 × 1500.
- **A layer row says little.**
  - It shows `layerLabel` (`subject · 1 point`) and the opacity only when it is
    below 1.
  - It carries three icon verbs (↑, ↓, delete) and no picture of the mask.
  - `AdjustLayer.name` exists, but no control writes it: a layer cannot be
    renamed.
- **The mask view takes three controls for one idea.** There is a
  Hidden/Outline/Fill `Segmented`, a checkbox "keep it shown once Pick / Paint
  is off · M", and a "Done" link.
- **The layer's own adjustments come last.** The Develop sliders follow the
  mask, Combine and opacity. Measured at a 1500 px window, the layer's Exposure
  sits 857 px down the screen.
- **A subject only adds.**
  - `SubjectMask.points` is a list of positive taps.
  - `useSubjectMasks` unions one raster per point (`unionMasks`), and a tap on
    a marker removes it.
  - A subject cannot be a part (`PART_KINDS` leaves it out). A Subject layer
    can carry parts, so a Painted part set to Subtract fixes an over-reach
    today. That is buried under Combine at the foot of the panel.
- **The model's own options are left unused.**
  - `loadSegmenter` asks `magic_touch` for `outputCategoryMask: true,
    outputConfidenceMasks: false`, so the answer comes back already cut at the
    model's own threshold.
  - The region of interest is a `keypoint`. The shipped `vision_bundle.js` also
    accepts a `scribble`, a stroke, and refuses both at once.
  - There is no negative prompt in this API.

## 2. His report, in the code's terms

- The list and the add are hard to read: that is the triple grid and the thin
  row above.
- Changing the type after adding is a repetition he accepts. The
  `KIND_OPTIONS` switch stays, as one entry point among the three.
- The model "adds too much". Two different faults produce that:
  - a neighbour touching the subject is returned with it (a bench, a bag);
  - a disjoint look-alike is returned as well (a second person).

  Both stand at the model's fixed threshold, and today the only cure is to
  delete the point.

## 3. The proposal (the lab's face)

1. **One `+ Layer`.** It opens a grouped palette:
   - *Point at it*: Subject, Colour, Brightness.
   - *Draw it*: Linear, Radial, Shade, Painted.
   - *Everywhere*: Whole picture.

   Each kind gets its glyph and one line of use. The SAME palette changes a
   layer's kind (from a chip beside its name) and adds a term to the recipe
   (with Add / Subtract / Intersect at its head). A phone gets it as a sheet.
2. **A list that reads.** Each row carries:
   - a grip to drag (⌥↑ / ⌥↓, or the ⋯ menu, for keyboard and touch);
   - the eye;
   - a thumbnail of the layer's REAL combined mask;
   - its name, which can be edited, beside its kind;
   - chips of what it changes (`+0.5 EV`, `Warm +14`), or "no change yet";
   - its opacity as a slim bar under the row;
   - `⋯` for Duplicate, Move up and down, Invert, Change type… and Delete.
3. **Mask · where | Adjust · what.** The open layer splits the place from the
   effect, so its sliders are one tap away instead of 857 px down.
4. **The recipe.** The mask reads as an equation of thumbnails, for example
   `Subject − Painted ∩ Radial`. A term opens on a click, an operator cycles on
   a click, and `+` adds a term through the palette. It is today's Combine,
   made the structure of the panel instead of its footer.
5. **The subject adds AND removes.**
   - `+ Add | − Remove`, with ⌥ flipping it for one click, as in Lightroom and
     Photoshop.
   - Two kinds of pin, and a pin under the pointer shows ×.
   - A HUD on the picture while picking, because the eye is on the picture.
   - The removed region blinks hatched, an added one in the accent.

   Under it, **Refine what the model found**:
   - **Tolerance**, the cut on the model's confidence map.
   - **Only what touches my + points**, which drops the islands no positive
     point is in.
   - **Grow / Shrink**, in pixels.
   - **Edge**: as found · soft · snap to edges.
6. **The mask view moves to the picture's bar:** three states and `M`, shown by
   itself while picking or painting. The checkbox and the "Done" link go.

## 4. The model: four paths

| Path | Removing | Added weight | What it buys | Limit |
| --- | --- | --- | --- | --- |
| **MediaPipe + our tools** (recommended first) | region arithmetic: `subject = ∪(+) × (1 − ∪(−))`, one inference per negative point, cached like the rest | 0 MB | a real Tolerance (confidence masks), island cleanup, Grow / Shrink, an edge refined on the image (a guided filter on the 1024 view), a stroke as a prompt (`scribble`) | if the model returns the object to remove WITH the subject, removing it takes both, and the Painted subtract stays the cure |
| **SAM family** (SlimSAM, MobileSAM, EfficientSAM) on ONNX Runtime | native positive and negative points, and a box | +14.2 MB (CPU, SIMD) to +28.3 MB (WebGPU) of runtime, measured from onnxruntime-web 1.30.0's wasm files, plus the weights | the image is encoded once, then each click is near-instant, so the mask can preview under the pointer before the click | weights and speed unmeasured (Hugging Face is unreachable from the cloud container). Its threaded wasm needs cross-origin isolation, which GitHub Pages cannot grant, so it runs single-threaded |
| **Our own algorithm** (GrabCut, edge-guided fill) | native | 0 MB | fast, deterministic, good at an edge | knows nothing of what a person is, so it can refine but cannot replace the model |
| **All three** | — | the sum | the most control | too many knobs for one question: is this the subject? |

The recommendation is to build the first path, measure it on his own pictures,
and reach for SAM only if Tolerance plus Remove does not hold there. The
`segmenter.ts` seam is narrow (`segmentPoint`, `prepareSegmentSource`), so a
second model goes behind it without touching the hook's rules.

Three rules carry over from `subject-picking.md` and bind every path:
- a negative point is cached per point and per VIEW like a positive one;
- `subject-rasters.ts` must remove exactly what the stage removes, or
  preview ≠ export;
- the blink stays reserved for what a tap changed.

## 5. Order of work, one commit each

1. **Remove.**
   - An optional `minus` list on `SubjectMask`, so no document migrates.
   - The ± mode and ⌥, and the − pins.
   - The union and the subtraction in a pure module with its test, used by the
     stage hook AND `subject-rasters.ts`.
2. **Confidence.**
   - `outputConfidenceMasks` instead of the category mask.
   - Tolerance, Only what touches my + points, and Grow / Shrink, in a pure
     module (`subject-refine.ts`) with its test.
   - The stored settings on `SubjectMask`, optional.
3. **The edge.** A guided filter on the model's view, as a pure module with a
   row in `scripts/check-render.mjs`.
4. **The one palette**, for add, change type and combine.
5. **The list.** Mask thumbnails, the effect summary, the opacity bar, drag,
   `⋯`, and a name that can be edited.
6. **Mask | Adjust, and the recipe.**
7. **The mask view in the picture's bar.**

## 6. His to decide

1. This face, or changes to it (the list, the recipe, the palette).
2. ⌥ to remove beside the switch, or the switch alone.
3. A SAM model: now, after trying steps 1–3 on his pictures, or never.
4. The subject's Refine settings: shown at once, or folded under "Refine".
