# The making-of: a picture's edit steps replayed as a video

**Status (2026-10-01): BUILT, T1 → T7**, the maintainer's *"go ahead, build
T1 to T7"* on 2026-09-30, one commit each, on the brief's own working
answers to §6 (the journal on the picture; recording on with no switch; the
standard order shipped and said; the `-making-of` suffix; sound off by
default with the kits on request; the defaults as listed; English captions,
editable). What is verified and what is not is in `docs/memory/develop-roll.md`
(«The JOURNAL is on the picture» → «The export»): everything but the H.264
encode itself was driven headless, that one needs a real machine. §6 stays his
to overrule. The rest of this brief is the design as it was proposed; where
the build departed from it, the memory says so.

**Status (2026-09-30).** A PROPOSAL, nothing built. §1 is the maintainer's ask
in his words. §2 is FACT, read in this repository at `0bcbdae` (file:line).
§3 onwards is the design: the record it needs, the video's grammar, the
engine, the screen, and seven commits. §6 is what is his to decide, §7 what
was weighed and declined. The grammar, the rhythm and the options are drawn
as a working phone in the lab: <https://claude.ai/artifact/Xb3CsfT8sxXvYAEAKHdtpV>
(a synthetic picture, real timing — judge the feel there, the numbers here).

---

## 1. What was asked

> Élabore un plan pour que l'on puisse avoir un timelapse des changements
> appliqués sur un média, comme ça on peut exporter une vidéo montrant les
> étapes de changements sur un montage photo : on voit les zooms, le crop,
> les outils de sélection, les LUT appliquées, possibilité de voir des infos
> en overlay pour chaque étape. Le but c'est de faire des vidéos sympas pour
> les réseaux qui montrent le média avant/après et comment on a fait pour
> monter le média. Vidéo engageante, sympa, teasing, hook, dynamique.

So: a **record** of what was done to a picture, in order; a **video** that
replays it with a camera (the zooms), the tools drawn (the crop zone, a
mask's outline, a heal's ring), the look named when it lands, a caption per
step; and a **shape** built for a feed — a hook, a beat, a before/after at
the end. Three things, and the first one does not exist today.

## 2. What exists today

**Nothing records an edit's history past the session.** The suite's undo
(`shared/history/history.ts`) is a stack of whole `RollDoc`s: `past ·
present · future` (26–36), `HISTORY_LIMIT = 50` (39), `COALESCE_MS = 700`
(47), held in a `useRef` (`use-history.tsx:88`) and written nowhere — no
store, no `localStorage`. Only the PRESENT carries a time and a label (`at`,
`label`); the past entries are bare documents, and Develop's label is the
open picture (`DevelopTool.tsx:188–202`: `picture:<id>`), never the kind of
edit. A reload, fifty steps, or the second picture opened in a sitting is
where the story ends. Replaying the undo stack is therefore not the feature
(§7); it is the model for it — one snapshot per write, merged within 700 ms.

**Every write goes through one door, and that door can watch.**
`RollEditor.tsx:167–177` is the single updater: `update(change)` over a ref
that advances at once, `onChange(next)` when the roll moved. Every handler
ends there (`handleDevelop` 554–561 drops a write `sameDevelop` calls
nothing; `patchPicture`, `roll-types.ts:616`, replaces the picture it touches
and stamps `updatedAt`). Under it, `use-write-through.ts` rests a draft
200 ms before it reaches the roll, so a slider drag is a handful of writes,
not one per pixel. That funnel is where a journal is appended (§3.1) — the
undo engine's own lesson: watch the one funnel, intercept nothing.

**The vocabulary of "what changed" is already one list.** `PictureEdit`
(`roll-types.ts:712–722`): `develop · look · crop · border · perspective ·
lens · detail · vignette · repair · layers`; `pictureEdits(p)` (733–746) says
which are set; `picture-sections.ts` carries the labels (`PICTURE_SECTIONS`
27–38), reads and writes them (`withSections` 69, `applySections` 122,
`resetSections` 142) and compares them (`pictureSnapshot`, 112–114,
private). A journal step is a set of sections and their values after — no
new vocabulary.

**Words for a step exist for the develop only.** `developLines` /
`describeDevelop` (`develop.ts:740, 775`) say a whole record (`+0.7 EV ·
highlights −40 · vibrance +15`); `Filmstrip.tsx:306–308` adds `· look ·
crop`. Nothing describes a DIFFERENCE (what this step changed), nor a look
(its layers' names and strength), a crop (its aspect, straighten, flip), a
repair (how many patches, heal or clone), a layer (its mask kind and its
adjustment), the detail. §3.2 adds the describers.

**Painting frames and encoding them is built.** `encodeFrames`
(`shared/media/render-video.ts:109`): `{width, height, seconds, fps = 30,
draw(tSeconds) → CanvasImageSource, audio?: AudioBuffer, signal, onProgress,
grained}` → an MP4 (mp4-muxer, `avc`, `fastStart: 'in-memory'`, 138–152;
`pickAvcCodec` `webcodecs-export.ts:485`, `deriveBitrate` 528, a keyframe
every two seconds, 196). H.264 ONLY — no VP9, no WebM; without an H.264
encoder it refuses with a sentence naming the size (170–177), and
`useAvcEncodeSupport()` (`use-encode-support.ts`) probes once per page so a
panel can say so before the click. Silent unless `audio` is given; the bed
is encoded to AAC before the muxer exists (`audio-encode.ts:87`,
`aacPrimingSeconds` 39–44). Its one caller today is Trips'
`exportHookStillVideo` (`hook-video-export.ts:223`): grade the photograph
once (`gradedOnce`, 209), then `draw` runs `renderBadge` at `t` (254). That
is the shape of a making-of: one bitmap per STATE, painted per frame.

**A picture is rendered AS DELIVERED by one function, and it returns
bytes.** `renderRollPicture(file, opts)` (`shared/develop/roll-render.ts:225`)
decodes whole (16–18), builds the pass chain — repair first (262), denoise
before the cube (261), lens then keystone (`geometryPasses`), layers with
their subject rasters (268–269), sharpen after (269), the post-crop vignette
(391–395), the film node last through `makeFrameGrader(..., opts.film)`
(271) — then `deliverOne` (432–484) draws `drawDelivered` (452,
`border-paint.ts:77`) and ends in `canvas.toBlob('image/jpeg')` (480). The
canvas is never handed out, and the chain is assembled inline. A making-of
needs the same chain over several STATES of one picture, held as rasters —
so the chain becomes a function (§3.4), which is also the seam the stage
(`use-develop-picture.ts`, `graderFrom` 153, private) duplicates today.

**The stage's zoom is a CSS transform, and its split never leaves the
screen.** `View {scale, x, y}` (`shared/ui/pan-zoom.ts:47–53`) lands on the
canvas as `translate3d(...) scale(...)` (`use-picture-zoom.ts:202`,
`DevelopViewport.tsx:282`): nothing is painted differently at a zoom. The
before/after split is drawn by `paintStage` (`use-develop-picture.ts:1033`)
and by nothing that exports — no export in the suite draws two pictures
across a divider (the Studio's `use-overlay-stage.ts:359–393` is marked
editor-only; the LUT shader's `u_split`, `lut-gl.ts:43–53`, is the stage's).
The nearest export-side figure is `clipReveal` (`cell-paint.ts:153`, a
collage cell growing from an edge) and the text `wipe` (`draw-overlays.ts:
1529–1574`). The reveal of §3.3 is new and small.

**The pieces of the video's grammar exist, in Trips.** Text over a picture:
`OverlayElement` (`overlay-types.ts:122–324`; `createTextElement` 409; anchor
+ `x, y` in frame fractions, `sizeFrac`, `legibility`, `window`,
`animation`, `blend`, `knockout`), drawn by `drawOverlays(ctx, elements, cue,
w, h, opts)` (`draw-overlays.ts:1684`) in the four title styles
(`TITLE_STYLE_PRESETS`, `title-styles.ts:282`: neutral · Or ciné · pixel-crt
· Rouge plein cadre). Entrances: `AnimPreset` `none · fade · slide · scale ·
typewriter · wipe` (`animation.ts:28`), `phasesFor` (156), `transformAt`
(220); delays from boxes (`stagger.ts`). One curve registry
(`motion/easing.ts:21–32`, `easeAt` 138). A picture moving in its frame:
`framing-motion.ts` (`FramingKey` 51, `framingAt` 242, the six presets 429:
push-in, pull-out, the pans). A crop zone ↔ the stored aspect + `Framing`:
`crop-rect.ts` (both ways, `develop-roll.md`). A sound bed: `renderBed(events,
seconds, {leadSeconds})` (`shared/audio/render-bed.ts:67`) over seeded
voices (`voices.ts:231`, `VOICE_NAMES` 26: click, tick, blip, pop, beep, wood,
typewriter, detent, leg, seat), a kit per score (`tick-kits.ts:23`). A QR
(`lib/qr.ts:454`, `draw-qr.ts:35`). A frame's camera plate (`captureLine`,
`develop-roll.md`) and the author's identity on the preset book
(`PresetBook.identity`). None of it is reached from Develop today, and all of
it is `shared/`.

**A run is seen and cancelled the suite's way.** `startTask`
(`shared/tasks/tasks.ts:80`), `run-progress.ts` (`startRun` 58, `atStep` 86),
`DeliverBar` (`shared/ui/`) as the run itself, `pickDeliveryTarget()` before
a pixel is rendered, `deliverFilesTo` last, a picker asked AT the click
(`frontend.md`). An export of a making-of is one more run of that shape.

## 3. The proposal

Three layers, each a module: the **journal** (what was done, on the
picture), the **script** (what the video shows, pure), the **painter** (one
`draw(t)` for the preview and the export alike). Then a sheet and a run.

### 3.1 The journal — a step is a write, on the picture, in the same write

`RollPicture.journal?: JournalStep[]` (roll **v7**; absent = no steps, read
as `[]` by `readRollDoc`, so nothing migrates and a v6 roll opens unchanged).

```ts
interface JournalStep {
  at: number;                          // when the write landed (ms)
  sections: PictureEdit[];             // what this write changed
  after: Partial<PictureSections>;     // those sections' values AFTER — nothing else
  via?: 'apply' | 'paste' | 'preset' | 'reset' | 'auto';   // absent = the author's own gesture
}
```

- **Written by the one updater and nowhere else.** `RollEditor.update`
  diffs `latest.current` against `next` picture by picture — every write
  replaces the picture it touches and keeps the others, so identity finds
  the changed ones for free (the rule `pictureAfterRestore` already relies
  on) — and `sectionsChanged(a, b)` (the private `pictureSnapshot` made
  public, per section) names what moved. A step is appended to THAT picture,
  inside the same `next`, so **the journal and the edit are one undo step**:
  ⌘Z restores the roll the step is not in, ⇧⌘Z brings both back. No second
  funnel, no listener, nothing to keep in sync.
- **Coalesced like the history**: a write within `COALESCE_MS` (700, the
  history's own constant, exported and shared) of the last step, touching
  the same sections, REPLACES that step's `after` and moves its `at`. A
  slider drag (a write per 200 ms rest) is one step; the next different
  thing is another. Measured against the stack: one saved document, one
  undo step, one journal step.
- **Bounded**: `JOURNAL_MAX_STEPS` (400) and a byte guard on the serialised
  journal (a painted mask's strokes or a hundred patches are the heavy
  ones); past either, the two OLDEST adjacent steps sharing a section
  merge (the story keeps its shape, loses its finest grain). The roll on a
  Winnow has a 16 MiB file cap (`docs/lut-packs.md` §10's numbers) — a
  journal can never be what breaks it.
- **Not an edit.** `pictureEdits` ignores it; the export mark's fingerprint
  (`export-marks.ts`) never reads it; `withSections` / `applySections` /
  `resetSections` never carry it — so an Apply-to, a paste or a preset
  lands on the target as a step OF THE TARGET, `via` said (the making-of
  then reads *Develop from DJI_0100*, which is true). A `clone` variant
  takes the journal so far (its story includes the parent's), a `fresh` one
  none. The `.roll.json` backup carries it (it is the picture's).
- **The stage's VIEW is not recorded in v1.** Where the author was looking
  (`usePictureZoom.view`) lives two components below the updater and is a
  way of looking, not a change. The camera of §3.2 is DERIVED from the
  edit's own geometry, which is what a viewer expects to see anyway; a
  `view?: {cx, cy, scale}` hint on the step is the recorded v2 (§5, later).
- **What has no journal is RECONSTRUCTED, and said.** A picture edited
  before v7 has settings and no steps. `reconstructedJournal(picture)`
  builds one step per edited section in a fixed order — crop · perspective ·
  lens · develop · detail · repair · layers · look · border · vignette —
  with no `at`; the sheet says *steps in a standard order (not recorded)*
  and the video draws exactly those values. The values are real; only the
  chronology is a convention, and it is labelled as one. His call whether
  it ships (§6).

### 3.2 The script — a chapter per tool, a camera per chapter, a caption that says the difference

`shared/develop/timelapse-chapters.ts` (pure):

- **Chapters**: consecutive steps sharing a section fold into ONE chapter;
  its `before` is the picture before the first, its `after` the picture
  after the last (the fold: as shot, then each step's `after` applied
  through `withSections`). Five exposure nudges read *+0.7 EV*, not five
  cards.
- **Captions say the DIFFERENCE**, never the whole state: `describeChange
  (section, before, after)` — develop: the sliders that moved, curves /
  levels / mixer / grading named (`developDiff`, over the same `DEVELOP_KEYS`
  and the same `signed()`); look: the layers' names and strength (*Look ·
  Portra 400 · 80 %*, a film stock by its stock name); crop: the aspect,
  *straighten 2°*, *flip*; repair: *Heal ×3 · Clone ×1*; layers: the mask's
  kind and its adjustment's first line (*Sky · −0.6 EV*, from the layer's
  name where it has one, its kind otherwise); detail: *Sharpen +30 ·
  Denoise 20*; lens: the profile's name or *Lens*; perspective: *Keystone*;
  border, vignette. English, like `developLines`; editable per chapter,
  an emptied caption returning the computed one (the badge rule).
- **The camera is read in the step**, never invented: repair → the union of
  the patches' destination discs (picture fractions), zoomed to fill 60 %
  of the frame, capped at 3×; layers → a painted mask's strokes' box, a
  subject's points' box, a linear/radial mask's extent, a colour range or
  brightness the whole picture; crop → the whole picture (the zone
  animates over it), then the delivered frame; everything else → the whole
  picture. `Camera {cx, cy, z}`, tweened between chapters on `out-cubic`,
  zoom geometric (`framingAtProgress`'s rule).
- **Weights and the keep count**: a section has a weight (crop, layers,
  repair, look 1.2–1.4; develop 1; detail, lens, vignette, border 0.5); the
  asked duration minus the hook and the reveal is shared by weight; a
  video keeps at most `N(seconds)` chapters (15 s → 5, 30 s → 8, 60 s →
  14) and the rest — the smallest by weight × size of change — FOLD into
  their neighbour's transition, captioned *· finishing* on the last kept
  one. A folded chapter's change still HAPPENS on the picture (the fold is
  chronological); it just gets no card.

`shared/develop/timelapse-script.ts` (pure): `TimelapseOptions` → `TimelapseScript`.

```ts
interface TimelapseOptions {
  format: '9:16' | '4:5' | '1:1' | '16:9';   // 1080×1920 · 1080×1350 · 1080×1080 · 1920×1080
  seconds: 15 | 30 | 60 | number;
  hook: 'result-first' | 'raw-first' | 'flash';
  reveal: 'wipe' | 'split' | 'flicker';
  camera: 'follow' | 'still';
  beat: number | null;                        // BPM; cuts land on a half-note grid
  overlays: { captions; counter; plate; credit; tools };
  ground: 'blur' | 'paper' | 'ink';           // what fills the frame round a fitted picture
  sound: 'none' | TickKit;
}
interface TimelapseScript {
  seconds: number; width: number; height: number; fps: 30;
  hook:   { start; dur; kind };                // 1.8 s at 15, 2.4 at 30, 3 at 60
  chapters: Chapter[];                         // { id, start, dur, section, before, after, camera: {from, to}, caption, region }
  reveal: { start; dur; kind };                // 3 s · 4 s · 5 s
  overlays: OverlayElement[];                  // built once: captions windowed per chapter, the counter, the plate, the credit
}
```

- **Three moments.** The hook: `result-first` shows the AFTER for 62 % of
  its time with *Ça, c'est après.*, then cuts to the as-shot with *Comment ?*
  — the tease; `raw-first` the inverse; `flash` alternates the two on
  eighths. The steps. The reveal: a `wipe` sweeps the as-shot off the
  after left to right over 55 % of its time (the maintainer's BEFORE →
  AFTER rule, left to right, `develop.md`), `split` holds the divider on the
  middle then drops it, `flicker` alternates then settles — then the camera
  plate (`captureLine`'s `ƒ · shutter · ISO`, the body, the lens, from the
  EXIF of the file the picture is developed from) and the credit
  (`PresetBook.identity.creator`; no identity, no credit — never a default
  name, the site is public).
- **The beat** (`beat: 120` → a 0.5 s grid): every chapter's start and the
  hook's and reveal's ends are rounded to the grid, so a track dropped on
  the file in the socials app lands its downbeats on the cuts. Off by
  default; the file carries no music (§7).
- **The captions are `OverlayElement`s**, `createTextElement` in the
  neutral title style, `anchor` bottom-centre, a `window` per chapter, `in:
  slide up + fade 350 ms out-expo`, `out: fade`, and the counter `3/7`
  top-right in JetBrains Mono — so `drawOverlays` draws them, the four
  presets are a pill away, `blend` and `knockout` come free, and the
  Studio's overlay panel could edit them one day without a second text
  engine. The tools drawn (the crop zone's veil and thirds, a heal's dashed
  ring, a mask's accent outline) are not elements: they are the painter's,
  from the chapter's `region` (§3.3).

### 3.3 The painter — one `draw(t)` over held rasters, preview and export alike

`shared/develop/timelapse-paint.ts` (DOM): `prepareTimelapse(script, source,
opts) → { draw(t), dispose() }`.

- **A raster per STATE, graded once.** A chapter's `before` and `after`
  are two `RollPicture`-shaped states; each is rendered ONCE through the
  export's own pass chain (§3.4) into an `ImageBitmap` held for the run —
  the hook-video's `gradedOnce` rule, and `holdGrades`' (a preview grades a
  picture once, never per repaint). N chapters → N + 1 rasters, at the
  VIDEO's density: the frame's long edge times the deepest camera zoom
  (1920 × 3 = 5760 for a 9:16 heal close-up; capped by the device's pixel
  budget, a phone at its `stage 2560`, the loupe's honesty rule — the
  close-up is then softer and the panel says so). Released on `dispose`,
  one commit late where a stage draws them (`studio.md`'s bitmap rule).
- **A transition is a CROSSFADE of two rasters** over the chapter's first
  45 % (alpha, `in-out cubic`): cheap, exact at both ends, and what a
  viewer reads as "the exposure came up". A per-frame re-bake of the cube
  (33³ per frame, 600 bakes for 20 s) is not paid in v1; a QUANTISED tween
  (eight intermediate bakes, the sliders visibly climbing) is the measured
  v2 (§5). What a crossfade cannot fake is geometry: a **crop** chapter
  draws the whole before-raster with the zone growing over it (the veil,
  the outline, the thirds — the crop stage's own figure, from `crop-rect`'s
  zone at `u`), then CUTS to the after-raster framed; a keystone or lens
  chapter crossfades (the warp is baked into the after-raster).
- **The tools drawn**: repair → the patches' rings, dashed and fading
  through the crossfade; layers → the mask's alpha (the raster the export
  already builds, `subject-rasters.ts` / the painted-mask rasteriser) filled
  with the accent at 18 % for 0.5 s then fading, then the crossfade; crop →
  above. `overlays.tools` turns them off together.
- **The frame**: the delivered picture (`drawDelivered`, aspect + framing +
  border) FITTED in the video frame — the picture is never cover-cropped
  by the format, a photograph's making-of shows the photograph — over a
  `ground`: its own raster blurred and darkened (the feed's idiom), or
  flat paper or ink. The camera is a transform about `(cx, cy)` on that
  fitted rect, clipped to it. The progress hairline along the bottom edge
  is drawn by the painter (the `TaskEdge` idiom as the video's own clock).
- **The reveal draws TWO rasters across a divider** — the first export in
  the suite to; a clip on the as-shot over the after, the divider a 4 px
  `on-media` line, `AVANT` / `APRÈS` labels in the corners.
- **Grain is frozen.** The film node re-rolls per source frame in a clip;
  here every state is graded once, so a grained look holds one field —
  the limit a painted hook clip already has (`render-film.md`), recorded
  here rather than found.

The preview is the same `draw(t)` on a canvas driven by a small rAF clock
(play, pause, scrub, a chapter list to jump), so preview = export by
construction; the sheet's canvas is the phone's own shape for 9:16.

### 3.4 The seam — the pass chain becomes a function

`roll-render.ts:225–271` assembles the passes inline for one picture.
Extract `picturePasses(state, ctx) → { grader, passes, dispose }` (repair ·
denoise · geometry · layers with rasters · sharpen · vignette · film), called
by `renderRollPicture` as before and by the painter per state; the stage's
`graderFrom` is the third copy and the same function later. Verified as a
NULL result: the export's bytes identical before and after (the render
gate's rule, `render-core.md`), `scripts/check-render.mjs` and
`check-bands.mjs` unchanged.

### 3.5 The screen — a storyboard over one preview

`tools/develop/TimelapseSheet.tsx`, opened from two doors: the Export tab's
**Making-of** section (one settled row — *7 steps recorded · 15 s · 9:16*,
or *steps in a standard order (not recorded)* — and `Timelapse…`) and the
`DeliverBar`'s menu (*Export a making-of…*). A sheet, not a drawer: a
surface you pick from, its wash lies about nothing (`frontend.md`). One
pane on a phone.

- The preview canvas with its transport; the options as pills (format ·
  duration · hook · reveal · camera · beat · ground · sound · the five
  overlay switches); the **chapter list** — each row its kind, its caption
  (editable), its duration, an eye to fold it into its neighbour, a click
  to jump the preview there. The order is the record's and is never
  reordered: a making-of that lies about the order is the fabrication the
  suite refuses.
- **What is stored where**: the options on the ROLL (`RollExport.timelapse`,
  v7 — one social format per roll, a second device draws the same); the
  per-picture edits (hidden chapter ids, caption overrides) on the picture
  (`RollPicture.makingOf`), chapter ids being the first step's `at`, so a
  journal that grows keeps them. Both are document writes: one undo step
  each, synced like the rest.
- The row and the sheet say the H.264 verdict before the click
  (`useAvcEncodeSupport()`), the pixel cap on a phone, and the frozen grain
  where the look has one.

### 3.6 The run — `encodeFrames` in a task, named apart

`tools/develop/use-timelapse-export.ts`: `pickDeliveryTarget()` AT the click;
`prepareTimelapse` (its rasters a `Fetch · Develop` phase in the bar,
picture-sized, with the source fetched through `deliveredSourceFor` exactly
as the JPEG run does); `encodeFrames({width, height, seconds, fps: 30, draw,
signal, onProgress, audio})` as the `Encode` phase; `deliverFilesTo` last.
One task in the registry, the `DeliverBar` its run, the Export tab locked
meanwhile like the JPEG run (L2), retouching free.

- **The name**: `DJI_0101-making-of.mp4`. The exact-name rule
  (`develop-roll.md`) exists so a delivered PICTURE pairs with its capture
  by name in his Gallery and in Winnow's `reconcile`; a video is not a
  rendition of the picture, and `DJI_0101.mp4` beside `DJI_0101.jpg` would
  be paired as a final of the capture. The suffix is the rule's own reason
  applied the other way. His call (§6).
- **Sound**: `none` by default — the socials app lays the music, and the
  beat grid is what makes that land. On request, a tick bed from the
  existing kits: a `tick` at each chapter's start, a `detent` at the
  reveal's sweep, rendered by `renderBed` with `aacPrimingSeconds` as its
  lead, encoded by `encodeFrames` itself.
- **The file lands in the Library like any clip**, so a making-of is a
  Trips clip slide or a Studio rush today with no bridge built: the bridge
  is the file.

## 4. Rules the suite should keep

- The journal is written by the ONE updater, in the same write as the
  edit, so undo is right by construction; never a listener, never a second
  funnel, never beside the roll (the export marks are beside it because an
  export is not an edit — a step IS the edit).
- The sections list is the journal's vocabulary: a section added tomorrow
  is journaled the day it is added, like it is undoable the day it is added.
- The journal is never copied by Apply-to, paste, preset or a fresh
  variant, never counted as an edit, never in an export mark's key.
- Nothing invented: a caption is a difference read in the record, a camera
  is the edit's own geometry, a plate is the EXIF on screen, a credit is
  the identity or nothing, an unrecorded order is labelled as one.
- One painter for the preview and the file; one pass chain for the file,
  the states and (later) the stage.
- The export's constraints are said before the click: H.264, the phone's
  pixel cap, the frozen grain.

## 5. Phases — one commit each

| # | Delivers | Verified by |
|---|---|---|
| T1 | `journal.ts` (pure: `appendStep`, coalescing, the ceiling, `foldJournal`, `reconstructedJournal`, `sectionsChanged`), `RollPicture.journal`, roll v7, `.roll.json`, the updater appending, `readRollDoc` normalising | specs: a fold equals the picture; a drag is one step; the ceiling merges the oldest; apply-to appends `via` on the target; headless: an edit → a step, ⌘Z → gone, ⇧⌘Z → back, a reload keeps it |
| T2 | `timelapse-chapters.ts` (chapters, `describeChange` per section, the camera per region, weights, the keep count) | specs on a synthetic journal: five nudges → one chapter; captions per section; the heal's camera; folding at 15 s |
| T3 | `timelapse-script.ts` (options → script: the three moments, the beat, the overlay elements) | specs: durations sum, grid landing, windows per chapter |
| T4 | `picturePasses()` extracted from `roll-render.ts`, called by the export | the export byte-identical (measured on the gate's pictures), both gates unchanged |
| T5 | `timelapse-paint.ts` (rasters, crossfade, crop figure, tools, frame, reveal), `useTimelapsePreview`, `TimelapseSheet`, the Export tab row and the bar's verb | headless: the canvas at t reads the states (pixels sampled), the reveal's two halves, the sheet's pills writing the roll, at 390 px one pane |
| T6 | `use-timelapse-export.ts`: the task, the picker first, `encodeFrames`, the name, the lock; README's Develop section | `render-video.test.ts`'s stub proving the frame plan and a real MP4 out of the muxer; the encode itself on a real machine or the desktop app's Browser pane (the container's Chromium has no H.264 encoder, `studio.md`): a file decoded back, frame-accurate at the chapter starts |
| T7 | the tick bed, the plate and the credit, `ground`, the hook/reveal variants beyond the first | headless: the bed's ticks on the chapter starts after decoding the MP4 back (`media-pipeline.md`'s sync rule) |

Later, unscheduled: the quantised numeric tween (measured first); the
recorded view hint (`view` on the step, the workbench publishing its zoom
through a ref); a per-chapter *as I saw it* camera; a Trips slide MEDIUM
that references the roll rather than the file (so a re-edit updates the
piece); the stage's `graderFrom` over `picturePasses`.

## 6. His to decide

1. **The journal on the document** (recommended: on the picture, in the
   write — undo-exact, travels, backed up) or beside the roll like the
   export marks (device-bound, never synced, never undone).
2. **Recording on by default** for every roll (recommended: yes, it costs
   nothing visible and stops nothing; a per-roll *Record the steps* switch
   for a roll he does not want to grow).
3. **The reconstructed making-of** for pictures edited before v7: ship it
   labelled *standard order*, or refuse a video where nothing was recorded.
4. **Hesitations**: an undone step is out of the journal by construction.
   A *director's cut* keeping them (a second, append-only log the undo
   does not touch) is possible and NOT recommended for v1 — a feed video
   wants the clean take.
5. **The name**: `-making-of` suffix (recommended) or the picture's exact
   name with `.mp4`.
6. **Sound**: none by default and a tick kit on request (recommended), or
   a bed always.
7. **Defaults**: 9:16 · 15 s · result-first · wipe · camera follows · no
   beat · captions + counter + plate + credit + tools on · blur ground.
8. **The captions' language**: computed in English like every line the
   suite writes, editable per chapter (recommended), or a French set.

## 7. Weighed and declined

- **Screen recording** (the stage captured as it is used): records the
  interface and the author's hesitations, at the screen's density and
  aspect, with no caption and no camera; not composable, not re-exportable
  at another format. The journal is the recording.
- **Replaying the undo stack**: in memory, fifty steps, no time on the
  past, gone on reload and on the next picture (§2). It stays the model.
- **A second text engine** for the captions: `drawOverlays` and its four
  styles are the one; the captions are elements.
- **Music in the file**: a licence question the suite cannot answer and the
  socials app answers per post; the beat grid is the bridge.
- **A per-frame cube bake** for the tweens: unmeasured and likely dear;
  the crossfade first, the quantised tween when a measurement asks.
- **Recording the stage's view as the camera** in v1: a way of looking,
  two components below the funnel; the edit's geometry is what the viewer
  expects to see, and the hint can come later without a migration.
