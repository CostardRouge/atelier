# Briefs, audits and plans — read before new work

Moved out of the `MEMORY.md` index on 2026-10-22 (verbatim), where it had grown to ~290 lines. These are not memory files: they are the
repository's long-form briefs and audits under `docs/`, each with what it is, its status and when to read it. Keep an entry
current when its brief changes status; add one when a new brief is written.

Not memory files, but read them before starting new work, or before touching
anything about media sources or document storage:

- **`docs/audit-2026-10-02.md`** — the project audit (2026-10-02): the
  inventory (Phase 0), every finding with its location, impact, fix, effort,
  risk and verification (Phase 1, domains A–I plus Develop's own), the
  priority table, the batches, what is explicitly NOT done and the twelve
  decisions that are the maintainer's (Phase 2), and what was executed on its
  branch (Phase 3). Read it to pick the next piece of hygiene work, and
  before re-auditing anything: a finding there is verified, not a hunch.
- **`docs/audit-mobile-layout-2026-10-06.md`** — the phone layout audit:
  what holds after #234, every remaining cause of a page moved by code, a
  control past the edge or a missing bottom room (with lines), the guards
  that would stop the class, seven commits and three decisions. Read it
  before touching `PageBar`, `index.css`'s field rule, a `focus()` or a
  full-screen height.
- **`docs/roadmap.md`** — twelve proposed features (2026-09-07), each traced to
  the open item, deferred decision or stated direction it comes from, with its
  constraints, deliverables and size. **A proposal, not a set of decisions**:
  nothing in it has been agreed with the maintainer, so read it to find the next
  piece of work and its rules, never as an authority on what was chosen. It also
  carries a table of ideas deliberately left off, which duplicates no memory
  entry but points at them.
- **`docs/winnow-bridge.md`** — the agreed design for connecting Atelier to
  Winnow (the maintainer's media-triage project), the two adapter seams it rests
  on, and the phases. Verified 2026-08-29 against the Winnow repository itself
  (`~/Documents/GitHub/winnow`, `CostardRouge/winnow`), so its claims about both
  sides carry paths and can be re-checked; rewritten 2026-08-31 around the source
  model, with several instances and scheduling marked *later* but designed for.
  **Phases 0, 0.5 and 1 are built**; 2 (write-back) and 3 (remote documents) are
  not.
- **`docs/roadtrip-editor.md`** — the agreed plan (2026-09-06) to give the Road
  Trip piece editor the Studio's shape: six tabs instead of the 16-section
  accordion, click-to-select and block-drag on the badge stage, and **grading
  from Road Trip through the Studio's own engine** (`useLutStack` +
  `makeFrameGrader` + `exportVariantVideo` — no second exporter, which is what
  the earlier rejection was actually about). Four phases, one commit each.
  **All four phases are built (2026-09-06)**; the decisions they fixed are in
  `roadtrip.md`. Unverified in the container: the hook clip's graded encode
  (no H.264 encoder here) — the PNG deck and the preview were checked.
- **`docs/roadtrip-export.md`** — what a Road Trip piece can and cannot deliver
  (2026-09-09), and the plan to make an animated piece leave as a video from
  Road Trip itself. **A proposal, not a set of decisions**: §2–§3 are traced to
  files and are fact, §4 onwards awaits the maintainer, and §9 lists the four
  choices to make first. Read it before touching `use-post-exports.ts`,
  `deck-export.ts`, `hook-video*.ts` or anything that encodes frames without a
  source clip.
- **`docs/roadtrip-overview-mobile.md`** — what the trip overview measures on a
  phone (2026-09-22) and three directions out of it. §1–§2 are fact, traced to
  `day-grid.ts`, `ShortDayStrip.tsx` and `stage-ruler.ts` and measured at
  390px; §3 onwards is the design he chose (B) and §8 its full shape — **all
  of it built on 2026-09-22**, §9 being what is still his. Read it before
  touching `MonthCalendar.tsx`, `YearMap.tsx`, `DayStrip.tsx`,
  `LegsSheet.tsx`, `StageRuler.tsx` or `month-grid.ts`.
- **`docs/picture-motion-ui.md`** — the redesign (2026-09-24) of how a
  picture's motion is EDITED, from his report that the needle is not
  intuitive: §1–§2 are fact (the built feature and the six rules that make it
  hard to read, traced to files), §3–§6 the three faces and the proposal (A ·
  Cards as the face, four rule changes, six commits), §7 his four questions.
  **He picked A and §6.1–6.5 are BUILT (2026-09-24)**; §7 was answered by
  its own recommendations and is still his to overrule. Read it before
  touching `motion-cards.ts`, `MotionCards.tsx`, `PanZoomSection.tsx`,
  `TourMap.tsx`, the cards half of `PostEditor.tsx` or the band's marks.
- **`docs/hook-engine.md`** — the agreed design (2026-09-13) for many hook
  variants over one badge: the contract, the three decisions that shaped it,
  the picker, how a synthesised sound bed reaches the MP4 through the export
  that already exists (the `p5-templates` pattern minus the server), the
  missing `exportGeneratedClip` seam, and seven phases of one commit each.
  **Every phase is built** (engine, picker, Défilé and its ticks — mixed into a clip's own sound on request — and the route trace, which changed nothing in the contract but one optional context field and was then retired by the Itinerary); phase 4 turned out to exist already as `encodeFrames`. Read it before touching
  `shared/roadtrip/hooks/`, `badge-layout.ts` or anything that would add audio
  to an export.
- **`docs/winnow-timeline.md`** — what Winnow's forthcoming timeline (media
  grouped into chapters by place and date) means for Atelier: the chapter ↔ stage
  mapping, ingesting by chapter, seeding and completing a Road Trip, the finals
  going home, and the list of questions to check the spec against. Written
  2026-09-03 from Atelier's side alone, so its Winnow claims are assumptions and
  are marked as such. **All five phases are built on Atelier's side (2026-09-06)**,
  verified against a stubbed instance only. **Winnow's timeline shipped the same
  day** and its chapters turn out to be derived per request (ids are not stable)
  — the brief's status block and §7.1–7.2 record what that changes.
- **`docs/roadtrip-persistence.md`** — the agreed design (2026-09-06) for
  keeping a Road Trip on a connected Winnow so it resumes from another device:
  bridge phase 3 applied to `TripDoc`. Four decisions are fixed there (local
  write unchanged + remote flush on idle with a status pill; a generic
  `kind: trip | project` bucket with trips first; own docs for any signed-in
  role, scoped by `user_id`, foreign rows 404; thumbnails re-baked, never
  uploaded), plus the security answer, the Winnow migration `0041` + route
  pair, and five phases. **All of them shipped, and the maintainer confirmed
  trips persisting on the deployed pair on 2026-09-07** — read it now for the
  four decisions and the security answer, not for a plan. Projects (P4) ride
  the same bucket. Never exercised: a network drop and a 401 mid-edit.
- **`docs/photo-develop.md`** — the design (2026-09-13) of the photo editor
  the maintainer asked for: per-picture corrections (exposure, brightness,
  contrast, highlights/shadows/whites/blacks, temperature/tint, saturation,
  vibrance) as a **develop** distinct from the grade, applied as the FIRST
  stage of the one baked cube so all six renderers get it with no shader
  change; a RAW (DNG) developed at decode into the picture the cube then
  takes, behind one decoder seam; ONE sheet opened from the Trips Picture tab
  and the Studio Grade tab, no ninth tool; presets and apply-to verbs as the
  time-saver. **A proposal, not a set of decisions**: §2–§3 are traced to
  files and are fact, §4 onwards awaits the maintainer, §11 lists the seven
  choices (the decoder is the one real dependency decision). Read it before
  touching `lut-stack.ts`, `use-lut-stack.ts`, anything about RAW files, or
  before adding a tone/colour control anywhere.
- **`docs/develop-tool.md`** — the plan (2026-09-15) for the Develop tool, the
  third editor: what the modal already shares (§1), the maintainer's four
  decisions (§2), the roll document and the personal preset book (§3–§4), the
  screens, the seams still missing (a framing-aware still export, the finals
  panel in `shared/`, and extracting the document plumbing at this third
  consumer), phases D1–D10 and what is still open (§8). Read it before
  building anything in `shared/develop/` or a new document kind.
- **`docs/lut-packs.md`** — the agreed plan (2026-09-19) for purchased LUT
  packs: a private vault on Winnow (document index + a new file store +
  a local cache), the author-grouped tree picker, pre-baked thumbnails, and
  the fix for "Upload .cube" inlining lattices. **Decided, not built.** Read
  it before touching `GradePanel`, `LutGalleryModal`, `saved-grade.ts`,
  `restore-grade.ts`, "Upload .cube", or anything that stores a LUT.
- **`docs/slide-capacities.md`** — the evaluation (2026-09-16) of the maintainer's
  question: should a slide's POSITION still decide what it may hold? It separates
  position (first, last — structural) from capacity (a picture, an opener, a
  badge, shades, text — the slide's own), an additive v29 on `PostSlide`, and
  masked text and blend modes on `OverlayElement`. §1–§3 are traced to files and
  are fact; **all six commits of §11 are built (2026-09-28)** on the brief's own
  answers to §9, which still lists the five choices that are his to settle.
  Read it before touching `slide-render.ts`, `deck.ts`, `PostBadge`/`PostSlide`
  or before adding a field to `OverlayElement`. Interactive bench:
  https://claude.ai/artifact/Q8paemaSsDENij7Lck2ti4
- **`docs/develop-originals.md`** — the proposal (2026-09-15) for developing
  and delivering from the ORIGINAL rather than Winnow's proxy: two axes kept
  apart — *pixels* (proxy 2048 ↔ full size, exact, chosen at export per piece,
  `Auto` fetching an original only where the proxy crop would upscale) and
  *material* (8-bit render ↔ 16-bit RAW, NOT exact, a `base` on the develop
  chosen in the sheet and never switched by the export). **Decided
  2026-09-15** (§7), not built. Read it before touching `MediaOrigin`, the Develop
  sheet's fidelity chip, or any export that could fetch an original for a
  still. It refines P5–P7 of `photo-develop.md`.
- **`docs/capture-renditions.md`** — the proposal (2026-09-21) for reaching
  the RAW of a capture whose RAW is a SEPARATE FILE (Sony `.ARW` + `.HIF`,
  DJI `.DNG` + `.JPG`), and for saying which bytes a tool works from in ONE
  vocabulary — a capture's *renditions*, three roles (`proxy`, `delivered`,
  `sensor`), the four-rung ladder derived from them rather than parallel to
  them. §2 and §10 are fact, traced to files in this repo AND in Winnow's;
  §9 is what he decided, §11 the thirty questions still open. **Read it before touching
  `MediaOrigin`, `materialize.ts`, `AssetParts`, `PictureWorkbench`'s
  `rawOffer`, or anything that decides which file of a capture is opened.**
  It refines `develop-originals.md` §7 and P10 of `photo-editor.md`; it
  revises neither's decisions.
- **`docs/run-sheet.md`** — one line per commit across the renditions and
  progress plans (2026-09-21): what is built, what is next, what is blocked and
  which four questions are the maintainer's. An INDEX, not a plan — the
  reasoning stays in the two briefs. Read it to find the next piece of work;
  keep it current or delete it.
- **`docs/map-openers-next.md`** — the Itinerary's and Virée's next round,
  decided and BUILT 2026-10-07: the stops panel and its popover, a stop
  that knows its state (from the search, a trip place or the shipped town
  index), the camera module and its presets, grouping nearby places, the
  trip recap and the build order; only §5's «later» items are left. Read it before touching `stops-editor.tsx`, `StopsMapSheet.tsx`,
  `MapStop`, Virée's camera or its stops.
- **`docs/remaining-work.md`** — what is LEFT across the whole project
  (2026-10-07), one row per item in four tables: measurements never made on
  his devices, decisions that are his, work that needs no decision, and
  Winnow's side — each row naming the brief or memory file that holds the
  detail, and a suggested order for an agent left to choose. An INDEX like
  `run-sheet.md`, not a plan: read it to pick the next piece of work in a
  fresh session, keep it current when a row closes, delete it when stale.
- **`docs/slide-length.md`** — a slide's length in Trips (2026-10-13): the
  ten holes of rule D's controls traced to lines and measured, three faces in
  a lab, the model B asks for (`SlideLength`, the v32 migration keeping every
  stored length), six commits and four questions. Read it before touching
  `slide-timing.ts`, `SlideDelivery.tsx`, the band's grips, `fitRender` /
  `FitRow`, or anything that decides how long a slide lasts.
- **`docs/look-picker-redesign.md`** — the "Choose a look" dialog measured
  against its code (2026-10-01, from his screenshot: ten faults, each traced
  to a line), three faces drawn as working mocks (lab
  https://claude.ai/artifact/WcwvdZ5zD7Gbnoecdep17R, the old dialog beside
  them at four screen sizes), the measured table, and **his pick, A, built
  the same day**. §7 holds the two questions still his. Read it before
  touching `LutGalleryModal.tsx`, `LookScene.tsx` or `look-scene.ts`.
- **`docs/mask-ui-redesign.md`** — Develop's layers and masks measured
  against their code (2026-10-02: 22 mask-kind buttons on one screen, a layer
  row that cannot be renamed, the layer's sliders 857 px down, a subject that
  only adds, the model asked for its category mask only) and ONE proposed face
  (lab https://claude.ai/artifact/5jy9NnEg1SoRdUNjDcAMas): one `+ Layer`
  palette, rows with the real mask's thumbnail, Mask | Adjust, the mask as a
  recipe of terms, and a subject that ADDS and REMOVES with Tolerance,
  islands, Grow/Shrink and Edge; the model's four paths with ONNX Runtime
  measured. **Built, §5.1–5.7 (2026-10-02)**; §6 answered by its
  recommendations. Read it before touching
  `LayersPanel.tsx`, `MaskPanel.tsx`, `use-subject-masks.ts` or
  `segment/segmenter.ts`.
- **`docs/develop-roll-browser.md`** — Develop's filmstrip measured against
  its code (2026-10-02) and four faces to redraw it (band, column, contact
  sheet, their synthesis), with what each costs the picture on four screens,
  the cell's read/act split, seven commits and six questions. **A proposal:**
  read it before touching `Filmstrip.tsx`, the band half of `RollEditor.tsx`
  or the selection and key rules of `roll-editor.ts`.
- **`docs/winnow-day-sheet-verdicts.md`** — the Winnow PICKER (2026-10-01):
  §2 and §7.1 are fact read in both repos (the culling on every row,
  `collapse=1` folding bursts, what `WinnowBrowser`, `WinnowDaySheet` and
  `DayPicker` each do); §7 is his pick — the rail, one shared modal for the
  Library's *browse all* and Develop's *Add a day*, the `PickerHost` contract,
  nine commits, five questions. §1–§6 are the first round, kept as record.
  Read it before touching `shared/sources/winnow/picker/`, `LibraryPicker.tsx`,
  `RollPicker.tsx`, `DayPicker.tsx`, `use-scope-rows.ts`, `client.assets()`'s `collapse`, or any
  surface that lists an instance's day.
- **`docs/deduce-ux-laws.md`** — the Deduce window measured against his
  twenty UI/UX laws (2026-10-02): the list as he gave it (16 and 17 are the
  same law), what each one changed and what already held. Read it before
  touching `src/tools/roadtrip/deduce/`, and as the worked example of the
  measure for any other screen he calls cluttered.
- **`docs/press-feedback.md`** — why a press gets no answer on a touch screen
  (2026-10-03, six causes traced to lines), four axes and six faces for a
  verb's feedback (press, while it works, done, echo on the target), E
  chosen and built in five commits (§6). Read it
  before touching `Button.tsx`, `IconButton.tsx`, `Segmented.tsx`,
  `DevelopActionsGroup` or any verb that takes time.
- **`docs/slider-touch.md`** — why a slider was unusable under a finger
  (2026-10-13: a track sharing the label's line, a 16 px grab), the six rules,
  the three faces, his pick B and what is built (§6), with what is small
  elsewhere. Read it before touching `SliderBar`, `SliderRow`, `RangeSlider`
  or adding any `type="range"`.
- **`docs/slider-peek.md`** — seeing the picture WITHOUT one setting or one
  group (2026-10-24, picked, not built): lab 1's six faces, then his pick
  (§6) — the dot becomes a switch, a menu (reset · hide · show only ·
  invert), a reversible Show only, a pill on the stage; the HELD press
  refused as tiring. §7: hiding is an EDIT (the export follows the
  screen), built by PARKING the value in `DevelopSettings.parked` so the
  ~50 readers of a develop need no change. P1–P5 built (§6–§7). Read it before giving `SliderBar` or
  `DevelopFold` a new gesture, or adding an on/off to a Develop group.
- **`docs/touch-targets.md`** — the small targets under a finger (2026-10-14):
  what stayed at 28 px or less, three faces measured in a lab with a finger
  disc and an overlap check, the five rules (T1–T5), his pick C and what is
  built and measured (§6).
  Read it before touching a control's size, `useFingerSize`, `TrimBar`'s
  handles or the curve's grab radius.
- **`docs/progress-feedback.md`** — the proposal (2026-09-21) for saying that
  something is taking time, across the whole suite: one task registry
  (`shared/tasks/`), two surfaces (a hairline on a media's edge, a pill with a
  popover and a Cancel), five phases and five open questions. §2 is fact — the
  dozen `onProgress` callbacks already in place, the absence of any progress
  element in `shared/ui/`, and the absence of any `AbortSignal` anywhere. Read
  it before adding a spinner, a bar or a "please wait" anywhere.
- **`docs/photo-editor.md`** — the brief (2026-09-17) for what comes after the
  Develop tool's v1: the maintainer's ambition to replace Capture One, the
  **render core** that his list requires (a float16 multi-pass GPU graph in
  which today's cube survives as two nodes), the edit-stack model (layers whose
  adjustment IS a `DevelopSettings`, vector brush strokes, a segmentation raster
  cached and never stored) and fourteen phases. §1–§3 are traced to files and
  are fact; §4 records the four decisions AND the HDR reversal for stills; §10
  is what was weighed and declined, including four things a browser will not do.
  **Read it before touching `lut-gl.ts`, `frame-grader.ts`, `held-grader.ts`,
  `roll-types.ts`, or before adding any adjustment that needs to know WHERE a
  pixel is.** It supersedes neither `photo-develop.md` (the develop record) nor
  `develop-tool.md` (the roll), and it is a brief, not a built thing.
- **`docs/lightroom-gaps.md`** — the audit (2026-09-23) of what Develop
  still lacks against Lightroom Classic and Capture One: bugs, consistency
  gaps, tools, output, workflow, a proposed order and his five questions. Read
  it before picking the next piece of Develop work.
- **`docs/develop-timelapse.md`** — the proposal (2026-09-30) for a picture's
  MAKING-OF: a journal of the edit steps on the picture (roll v7), a pure
  script (chapters, captions, a camera per chapter, a hook and a reveal), one
  painter for the preview and the MP4, a storyboard sheet, seven commits.
  §2 is fact (the undo stack is in memory and unlabelled, `encodeFrames` is
  H.264 only, no export draws a before/after today); §3 onwards awaits the
  maintainer, §6 his eight questions. Read it before touching
  `RollEditor.update`, `roll-render.ts`'s pass chain, or before recording
  anything about HOW a picture was edited.
- **`docs/film-simulation.md`** — the brief (2026-09-16, adjusted 2026-09-17
  against the photo editor) for a Fujifilm-style film simulation: why its
  colour is a generated LOOK LAYER and not a stage (F2 — ordering against a
  conversion LUT), the emulsion model in stops (§5: per-channel softplus
  curves re-speeded to an exact mid grey, coupling, DIR inhibition, a paper
  stage), the texture design the future `FilmNode` builds to (§6), the lattice
  measurement that fixed 33³ (§8), and the three requirements it hands to
  `photo-editor.md` P4 (§10). Read it before touching `shared/film/`, before
  adding a look that is not a `.cube`, or before building grain, halation or
  any spatial effect anywhere.
- **`docs/auto-develop.md`** — the evaluation (2026-10-02) of automating a
  photograph's develop and the plan out of it: §2 is fact (the record is the
  contract, what already writes one), §3 the three approaches merged from his
  five, §4 the decisions, §5–§7 one plan per approach in commits, §8 what is
  his. Read it before adding any automatic verb to Develop, before storing
  anything of a picture "for training", and before any call to a language
  model anywhere in the suite.
- **`docs/opener-inspector-redesign.md`** — the openers' inspector measured
  (2026-10-12: 103 controls in Virée, 71 in the Itinerary, nothing folds, a
  phone sheet over the stage), six faces and the recommended one in seven
  commits, his four questions. Read it before adding a control to an opener's
  panel or touching `panel-ui.tsx`, `HookPicker.tsx` or the Look tab's host.
- **`docs/camera-profiles.md`** — camera colour profiles (2026-10-07): what
  LibRaw does with a RAW's colour, MEASURED (the D65 matrix alone, no
  interpolation, no forward matrix), the gap to the DNG spec in ΔE, what a
  DCP and an ICC input profile are, where one could come from without a
  network exception, what it costs in the head and how it meets the base
  tone curves, nine commits and his seven questions. Read it before touching
  `librawSettings`' colour, `linearDngColor`, the kelvin maths' matrices, or
  anything that would load a `.dcp` / `.icc`.
