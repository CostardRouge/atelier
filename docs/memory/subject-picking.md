# Picking a subject, and taking it out

Read before touching `use-subject-masks.ts`, `subject-rasters.ts`,
`AdjustLayer.except`, the mask overlay (`maskOverlayPass`, `finish:
'outline'`) or the Layers tab's Pick / mask view. The engine under it is
`render-layers.md`.

## Segmented on the TAP, not when its layer first draws (2026-09-23)

The maintainer's report: a tap on a fresh Subject layer picked nothing until he
turned Pick off and moved a slider. `useSubjectMasks` asked the model only for
`drawingLayers`, and a new layer's develop is default, so it does not draw — the
markers went down, the status said "the model is loading" for ever, and the
raster arrived only once a slider made the layer draw. The same filter left
"show the mask" empty (`overlayOf` was looked up in the DRAWING stack). **Rule**:
what a layer WILL do (its mask, its segmentation, its overlay) is computed from
the whole list — `subjectLayersToSegment` (visible + points, drawing or not) and
the overlay resolved from `layers`, compared by value (`sameLayer`) in
`graderFrom`; only the passes that CHANGE pixels are filtered by `layerDraws`.

His second report — a Whole-picture layer "overriding" a Subject — was the same
bug seen from the other side (the Subject had no raster, so only Whole acted);
the render keeps each layer's program, cube and mask texture apart by
`layer:<id>`. Layers ADD, bottom to top, like Lightroom.

## Subtract, outline, blink — his three picks, built (2026-09-23)

Designed in a lab (https://claude.ai/artifact/KCLj3s4AAt1oeWGpCDV184) and all
three accepted as drawn.

- **A subject is SUBTRACTED, never a second mask kind.** `AdjustLayer.except`
  names a SUBJECT layer whose raster the shader takes out on unit 3 —
  `layerWeight` in `layer.ts` is the pure twin, and the hole comes AFTER the
  invert so it stays a hole either way round. Only a subject: its mask is
  already a raster on the GPU, so this is one texture and one multiply, where
  subtracting a gradient would mean a second `maskValue` per pass. A subject
  another layer cuts is segmented even hidden (hiding the subject's own
  adjustment must not fill the hole); a deleted subject clears the reference
  (`removeLayer`); a raster not arrived yet subtracts nothing, so the layer
  applies whole for the seconds the model thinks rather than vanishing.
- **The outline is the SAME pass with another `main`** (`finish: 'outline'`,
  id `mask-outline:<id>`): it evaluates `coverage` at the texel and 1.5 texels
  either side and draws ink/paper dashes where they straddle one half — the
  very line a gradient panel draws. The view is Hidden · Outline · Fill, on
  the picture bar's glyph and **M** (ON THE LAYERS TAB: off it, `P` and `M`
  are the delivery state's, send/hold and ignore, the rule fixed when #183 and
  #185 met, `EditorKeyPress.layersTab`); Hidden by default with the OUTLINE
  shown by itself while Pick or Paint is on, Outline or Fill kept shown
  (since 2026-10-02, `mask-ui.md` — the pin checkbox is gone); **P** toggles
  Pick/Paint; a new Subject layer starts with Pick on.
- **The blink is what the tap ADDED**: `useSubjectMasks.fresh` is one point's
  raster, reported only for a point new against the points KNOWN at the last
  commit on this picture — so re-opening a picture (every point segmented
  again) blinks nothing. The host toggles a `mask-flash` pass on/off at 90 ms,
  twice, and skips it under reduced motion. **The FIRST tap of all never
  blinked** (his report, 2026-09-30): the model's view (`segmentSource`) is
  only made once a subject HAS a point, so that tap met no view, the mask
  effect returned early, and the known-points record advanced in the same
  commit — the point was "known" by the time the view arrived. Rule
  (`subject-known.ts`, pure, tested, rev. 2026-10-02): while there is no
  view, a point GAINED by a layer the record already held is not recorded; a
  layer that ARRIVES with its points (a picture just opened, an undo, a
  paste) is recorded whole, view or not. **The first version of that rule
  made EVERY landing blink** (his report, 2026-10-02: *«tous les masques
  flashent dès qu'on atterrit sur une photo»*): it told a picture just opened
  by a null record, but `PictureWorkbench` is MOUNTED per picture
  (`key={open.id}`) and the hook's record starts as THIS picture, empty — so
  every subject was recorded with no points and its region blinked as a
  fresh tap when the model's view arrived. The blink never served the
  re-segmentation: it was the classifier, nothing else. With two subjects
  only ONE region was seen blinking on a landing — the layer listed FIRST in
  the panel, which lists the stack top-down, so the last one segmented; why
  the other's 90 ms blink never reached the screen was not pinned down, and no
  longer matters. Driven headless both ways (testing.md, «The subject model
  runs headless»).

**The export dropped every Subject layer, and nobody had noticed.**
`renderRollPicture` built its layers with no rasters, and a subject with no
raster covers nothing — the file lost what the stage showed. `subject-rasters.ts`
now segments, per delivery, the subjects something drawing uses
(`subjectLayersForRender`); a RAW is shown to the model through its own cube,
rendered once apart, since a half-float image is nothing the model can read.
**Rule**: anything the stage resolves asynchronously (a raster, a model's
answer) needs its own path in the export, or preview = export is broken in
silence.

`scripts/check-render.mjs` gained three rows (subtract plain/inverted within
0.0019 of `layerWeight`; the outline drawn exactly on `maskAt`'s half line, 0
stray, 0 missed of 672). To run it here without a dev server left behind: Vite
`createServer().listen()` in one process and the gate as an ASYNC child —
`spawnSync` blocks the loop serving the page and every `goto` times out.
Not driven in the UI then — since 2026-10-02 the model is known to run
headless here (testing.md).

## The model is shown the WARPED frame (2026-09-24)

His report: a subject picked fine, then a lens correction bent the mask away
from it, and a new tap picked "based on the old coordinates". The cause was a
split frame: a tap and the layer pass both live in the WARPED frame (the
grader's order is `[cube, …geometry, …layers]`, `render-layers.md`), but
`useSubjectMasks` and `resolveSubjectRasters` were handed the UNWARPED source.
**Rule**: whatever a mask is computed FROM must be the frame it is sampled IN.
`segment-view.ts` renders the source through `geometryPasses` alone (camera
warp, lens + profile, keystone) at the model's 1024 px, and all three readers
use it — the stage (`useDevelopPicture.segmentView`, made at once the first
time and SETTLED 300 ms after a geometry change so a slider drag does not
re-ask the model per step), the JPEG export and the RAW export (through its
cube, `withCalibration` so the DNG's own warp is in it). Stored points are
screen positions in that frame: after a geometry change the subject is
re-segmented from the same spot on the new picture, like every other mask kind
stays where it was drawn. Measured: a line at 0.8950 of the source lands at
0.8725 in both the model's view and the stage under distortion 60.

**The stage did not re-segment until 2026-10-02**: `useSubjectMasks` cached
per POINT alone, so a new view hit the cache and the old frame's mask stayed
up until the picture was opened again — the remount, not the geometry, was
what refreshed it, and the EXPORT (its own view) disagreed with the stage
meanwhile. Measured headless at distortion 100 on an off-centre disc: 14.5 %
of grey covered and 0 model calls, against 1.3 % (the edge) and 1 call now.
**Rule**: a cache of anything computed from a FRAME is keyed on the frame's
VALUE. `SegmentView` carries the image AND its key, set in one call — the
decoded file (recorded with the source, since `file` and `source` change in
different commits), its size and `placementKey(geometry)`, which names where
GREEN lands: CA and a vignette move no point, so their sliders cost no
inference (0 calls at vignetting 60). And the cache is MODULE state, not the
hook's: the workbench is mounted per picture, so the per-hook cache re-asked
the model for every point on every landing (2 calls → 0 measured). Bounded:
64 masks (~50 MB), 16 on a constrained device.

What the model's answer is turned into — Remove, Refine — is `subject-model.md`.
