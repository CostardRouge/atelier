# The hook engine — many openers over one badge

**Status (2026-09-14).** Design agreed with the maintainer; **every phase is
built** — the engine, the picker, **Défilé** everywhere a hook is drawn, **its
ticks** in every video a hook makes (mixed into a clip's own sound on request),
the **route trace**, which passed the contract test (§11, phase 7) and was
then RETIRED by the **Itinerary** (§13, 2026-09-15) — the first variant the
author composes rather than reads, and now the only one that draws a map.
What was phase 4 turned out to exist already (§8). What is left is judgement,
not construction: §12. The
exemplar that drove the design is the **scrub** («&nbsp;Défilé&nbsp;»): the
trip's measuring tape sweeps from day 1 to the day being told, flashing that
day's pictures as it passes, and ticking.

Read this before touching `shared/roadtrip/hooks/`, `badge-layout.ts`,
`badge-render.ts`, or anything that would add sound to an export.

---

## 1. The problem

A hook is one thing today: the six-piece text badge (`badge-layout.ts`). Every
idea worth having — a scrub, a route trace, a compass, a contact sheet — is a
*different drawing over the same document*, and none of them fits by adding
options to the badge. What is needed is the smallest engine that lets a variant
be **one file plus one registry line**, and that is honest about what it may and
may not do to the badge above it.

## 2. What is true today (checked in the code, 2026-09-13)

- `badgeElements(content, layout, aspect, styles, duration)` builds ordinary
  `text` elements; `drawOverlays` paints them with the theme, the glow, the
  `styleOverrides` and the `piece:<key>` ids the stage hit-tests.
- `renderBadge` paints in one order: background → picture (graded at source
  density, then framed) → **shades** → QR → overlays. `paintShades` is the only
  thing that has ever drawn between the picture and the badge.
- The clip path has the same seam under another name: `exportVariantVideo`'s
  `paintUnderOverlays`, which `hook-video-export.ts` already uses for shades.
- Two places build a badge's elements: `slide-render.ts` (PNG deck, thumbnails)
  and `PostEditor.tsx` (the stage). Elements are rebuilt every render and never
  stored, with deterministic ids.
- `webcodecs-export.ts` already configures the muxer with an AAC track and feeds
  it raw chunks (`addAudioChunkRaw`). `keepAudio = speed === 1 ? audioTrack :
  null` — **a re-timed export is already silent**.
- `export-tail.ts` (`{ seconds, draw(t) }`) proves generated frames encode and
  mux cleanly, appended after the footage.
- `encodeFrames` (`shared/media/render-video.ts`) paints a clip with **no source
  file**, and `exportHookStillVideo` delivers a hook over a photograph through it
  — `renderBadge` once per frame. Both landed before this brief (`78fc7f0`,
  `fc41dba`) and the first draft missed them. `encodeFrames` writes **no audio
  track**, by construction.
- `portablePost` in `trip-file.ts` deep-clones the whole post, so a new field on
  `PostBadge` travels in and out of `.roadtrip.json` **without** a fifth site to
  remember. The four-site rule bites fields on `TripDoc`, not on a post.

## 3. The contract

`shared/roadtrip/hooks/hook-variant.ts`. Same registry shape as
`src/app/tools.tsx`: one entry drives everything downstream.

```ts
interface HookVariant {
  id: string;                 // 'badge' | 'scrub' | 'route' …
  name: string;
  tagline: string;
  defaults: HookOptions;      // Readonly<Record<string, unknown>> — what is stored
  needs: HookNeeds;           // what the SHELL must resolve first
  owns: 'frame' | 'layer';    // see D2
  prepare(options: HookOptions, ctx: HookContext): HookRender;
  unmet?(ctx: HookContext): string | null;   // why it cannot run here
  Sketch?: ComponentType;                    // the picker card's drawing
  Panel?: ComponentType<HookPanelProps>;     // the variant's own options
}

interface HookRender {
  readonly seconds: number;                            // 0 = nothing to play
  content?(t: number): Partial<BadgeContent>;          // merged OVER the computed content
  paint?(g: Ctx2D, t: number, frame: FrameBox): void;  // under the overlays
  score?(): readonly SoundEvent[];                     // times and voices, never an AudioContext
}
```

**`prepare()` returns a closure, and that is the whole design.** The plan — a
stop list, a projection, timings — is computed once and captured; `content`,
`paint` and `score` read it by construction. Passing a plan around would let a
variant recompute it and drift; a closure cannot. It also removes every generic
from the registry.

`needs` (`coverage`, `stages`, `places`, `media: 'day' | 'deck' | 'stage'`)
declares what the shell resolves into `HookContext` — **a variant never fetches
and never reads the store**.

What two variants both wanted lives beside the contract rather than in either:
`easing.ts` (the curves a moving opener travels on, each with a closed-form
inverse), `tick-kits.ts` (the voices a landing, a leg's landing and the seat
play on, and the pitch drift) and `panel-ui.tsx` (the mono legend a panel
groups its rows under, since a panel mounts inside the picker's section and
cannot open sections of its own). Grown in Défilé, lifted out when the route
reached for them; Défilé re-exports the old names. That is what stops ten variants each querying a
day's pictures, and what tells an export pre-pass exactly what to prepare.

## 4. The three decisions (2026-09-13)

### D1 — A variant rewrites named pieces; it does not build elements

`content(t): Partial<BadgeContent>` merged over what `badgeContent()` computed;
`null` on a piece hides it. **Why**: the scrub needs its numeral to step through
the stop list (`1, 3, 5, … 27`). Letting a variant return its own
`OverlayElement[]` would give it that, but also let it silently replace what the
badge says, and leave the Content tab editing fields that no longer draw.
Letting it paint *only* underneath would force it to draw its own numeral on the
canvas — which then inherits no title style, is not selectable, and duplicates
the badge's own. Rewriting the **text** of a named piece keeps `badgeElements`
the single builder: ratios, theme, ids, hit-testing and the style cascade all
stay intact, and the Content tab can mark a piece "driven by the hook" instead
of pretending it is editable.

### D2 — `owns: 'frame' | 'layer'`, declared even while there is one layer

A `frame` owner replaces the picture (the scrub *is* the picture while it
sweeps); a `layer` draws over whatever is there (a route trace). Two `frame`
owners in one stack is the only real conflict, and it is worth being able to
name before the stack exists. **Last one wins**, the rule `stageAt` already
uses for overlapping legs.

### D3 — Stored as an array from day one, one entry for now

`PostBadge.hook: HookLayer[]`. The picker writes `hook[0]` and nothing else; the
stack arrives later as **UI only**, with no second migration on a document that
remote trips already carry. Storing a single object now would cost exactly that
migration later. An **unknown id is skipped** and, if nothing resolves, the
default `badge` layer is used — a trip file written by a newer build must
degrade, never fail to open.

## 5. Storage

```ts
// trip-types.ts
interface HookLayer { id: string; options: HookOptions }
interface PostBadge { …; hook: HookLayer[] }          // v15
interface HookDefaults { …; hook: HookLayer[] }        // a trip remembers the opener too
```

The migration block goes **at the end** of `migrateTripDoc` — those blocks run
in source order, and an early block writing onto a badge the v2 block has not
built yet leaves the rest of it undefined (measured, on a v1 document).

## 6. Picking one — built

Cards, never a dropdown — the rule already settled for title styles: *a style
you cannot see before adopting is a style you adopt by trial*. `HookPicker`
(`tools/roadtrip/panels/`) sits at the **top of the Look tab, above the title
style**, on the hook slide only: the opener decides what the hook IS, the style
only how its words are set — and the style belongs to every slide.

- **A card is a row in the title styles' own idiom**: the same dark 4.6×2.2rem
  box, name, tagline. The box holds the variant's `Sketch` — a drawing of what
  the variant DOES, **not a render of this piece**. That departs from the first
  draft of this brief on purpose: the stage beside the picker already shows the
  real thing, and a live render per card would cost a decode and a WebGL
  context each to repeat it worse. A variant with motion animates its sketch.
- **Selecting swaps the panel below** for that variant's `Panel`. The badge has
  no options, so nothing mounts — the honest face of a variant with nothing to
  set.
- **An unmet variant is disabled, with its reason in place of the tagline**, in
  the accent ink — never hidden.
- **Re-selecting the current card keeps its settings**; choosing another starts
  from that variant's `defaults`. Both writers (`setHookVariant`,
  `setHookOptions`) replace the FIRST layer only, so a stored stack keeps what
  sits behind it even though no UI builds one yet.
- **The trip-wide default needed no second picker.** ⚙&nbsp;Trip → New pieces
  already saves the whole look through `hookDefaultsFrom`, which carries `hook`
  since phase 1 — a second place to choose the same thing is the fault this
  tool keeps removing. Only its legend changed, to name the opener.

## 7. Sound — built for stills (phase 5)

The lineage is the maintainer's own `p5-templates`: events → offline render →
mux. Two differences, one of them a simplification. Built as
`shared/audio/voices.ts` (the ported presets + `detent`, `leg`, `seat`),
`shared/audio/render-bed.ts` and `shared/media/audio-encode.ts`; `encodeFrames`
takes `audio`.

- **No capture log.** p5 logs every `trigger()` during a deterministic frame
  loop because a sketch is imperative. A variant's `score()` is known *before a
  frame is drawn*, so there is no bridge, no capture mode, no `endCapture()` to
  remember — and the score is unit-testable, which a log never is.
- **No ffmpeg.** The path is `score()` → `OfflineAudioContext` → `AudioEncoder`
  (`mp4a.40.2`) → `muxer.addAudioChunk()`. The muxer already accepts an AAC
  track; nothing about the muxing changes.
- **The rule that ports verbatim** is `clickSynth.ts`'s: *a voice only ever
  touches the `ctx` and `destination` it is handed*, which is what lets one
  preset table serve a live `AudioContext` in the editor and an offline one in
  the export. Copy the preset idea too — a variant asks for `'wood'` at a gain
  and a rate, it does not build oscillators.

Three cases, one of them hard:

| The hook is built on | Audio today | With a bed |
| --- | --- | --- |
| a **still** | painted by `encodeFrames`, silent | the bed is the only track — `encodeFrames` gains an audio track it never had, nothing to preserve |
| a **clip recorded without sound** (most drone footage), or **re-timed** | no track | the bed becomes the track — no decoding at all |
| a **clip keeping its sound** | AAC copied bit-for-bit, deliberately | copied untouched and the ticks left out (said in the export note) — **unless** the author asks to mix: decode → sum → re-encode (phase 6) |

Guard `AudioEncoder` the way `pickAvcCodec` guards the video codec: where it
cannot encode, the export ships **silent with a stated reason**, never failed.
In the editor the score plays through one `AudioContext` created on a user
gesture, muted by default behind a speaker toggle — a panel that ticks while a
slider is dragged is unusable.

**What building it taught, measured and not guessed:**

- **The AAC encoder primes by 2112 samples and mp4-muxer writes no edit list.**
  Rendered ticks at 0.10 / 0.60 / 1.50s decoded out of the MP4 at 0.144 / 0.644
  / 1.544 — 44ms after their frames. Stamping the audio early is refused (no
  negative timestamps); stamping the video late is silently undone (no edit
  list, both tracks start at 0). The bed is instead rendered AHEAD by the
  priming (`leadSeconds`): **0.0ms** drift on every tick, ≤0.3ms through the
  whole `exportHookStillVideo` path with a real scrub. A sound in the first
  44ms still lands up to 44ms late — the scrub's opening tick only.
- **The whole bed is encoded before the muxer exists**, so "is there an audio
  track" is decided by "are there chunks", never by a half-written track.
- **The noise is seeded** per hit, so the same piece exports the same bed.
- Verified by decoding, not by ear: the agent can prove where the energy is in
  the file, not that it sounds good. The voices' design is the maintainer's
  from `p5-templates`, plus the three scrub voices, which have not yet been
  listened to by a human.

## 8. The still → video seam — already built

The first draft of this brief proposed an `exportGeneratedClip` for a hook with
no footage. **It exists**, under the name `encodeFrames`, with
`exportHookStillVideo` as Road Trip's caller (§2). Défilé on a still rides it
unchanged: the painter calls `renderBadge` per frame, which paints the opener
and asks `elementsAt` for the numeral like every other surface. The only thing
sound will add there is an audio track, since it writes none today.

## 9. Défilé — decisions built into it (2026-09-13)

- **One driver** (`scrub-plan.ts`, pure): stops placed on the inverse of a cubic
  ease-out, the head gliding on the same curve so it sits exactly on a stop at
  that stop's time. The paint, the numeral and (later) the score read it.
- **Only told days flash; an untold day goes DARK.** Not a stand-in, and not the
  hero shown early — an empty day looks empty, which is the honest reading of
  the calendar and what makes the hero land. A trip with nothing told still
  sweeps, through evenly spaced dark days, so a first piece reads the length.
  The piece being composed never counts as telling its own day.
- **Flashes are SOURCE pictures, never the thumbs store (rev. 2026-09-14).**
  The first build flashed each told day's hook thumbnail — "local, already
  graded" — and the maintainer's first look at it found soft 640px pictures with
  OTHER pieces' badges burned in. A want is now a media ref under a key
  (`HookPictureWant {key, ref, atSeconds?}`, `hookPictureKey`): on the pieces'
  days it is the ref the standing piece is composed over (`standingPiece`: a
  published piece with a picture, then any piece with one), on picked pictures
  it is the author's own. The shell (`use-hook-pictures.ts`) finds it in the
  Library by name then hash, else fetches the connected instance's editing
  rendition directly (`fetchPreviewStill` — one request, NOT added to the pool),
  a clip's frame from a video element at the piece's in point; crops it to the
  frame's shape AT decode, sized to a delivered frame (long edge 1920) inside
  ONE 32 MP budget the set shares (`picture-budget.ts`, split in count steps so
  one more picture decodes one more picture); and grades it with the piece's
  grade minus any slide's develop, so the flashes and the frame they land on
  wear one look. What cannot be drawn comes back per key with one line
  (`HookPictureStatus`), and a replaced bitmap is still closed late.
- **The numeral steps only under the `day` counter**, and only while the head
  moves; at rest the badge says its own value, a range post's "27–29" too.
  Stepping trip days into a numeral labelled as a day at a place would be a
  fabricated reading.
- **`content()` reaches the renderer as `elementsAt(t)`**, not by moving the
  element build into `renderBadge` as the first draft proposed: `renderBadge`,
  `measureBadge`, `exportVariantVideo` and the still painter all accept an
  optional function of the clock and fall back to `elements`. Built only when
  `ResolvedHook.rewrites` — every other piece keeps elements built once per
  edit. Hit-testing reads the same function, so a click lands on the numeral
  it is showing.
- **The sweep is authored in three more ways (2026-09-13).** An `easing`
  (`EASINGS`: settle / brake / even / wind up / glide) — every curve ships with
  a CLOSED-FORM inverse, because the stops sit on the inverse and the head
  glides on the curve, and a numeric inverse would put a stop near its time
  rather than on it; the round-trip is a test, and it caught a wrong `ease-in-
  out` inverse on the first run. A `delaySeconds` hold on the first stop, with
  `endSeconds` (hold + sweep) as the opener's life so every reader — the paint,
  the numeral, the transport, `hookMoves` — agrees where rest is. The stops
  themselves are `stopsOn: 'pieces' | 'picked'` (rev. 2026-09-14 — it replaced
  `days: 'chosen'` + `chosenDays` + `pieceByDay`, which the maintainer could not
  read: two unlabelled "Day 1 / Day 21" selects, tiles that toggled in one mode
  and not the other, and no way to see a picture before it flashed). `picked`
  stores `HookPickedPicture {ref, date, takenAt?}` in the options and stops once
  a picture in shot order, three on one day holding the head on that tick
  while the frame changes (a leg's voice only on the day's first); a picture
  after the piece's day or outside the trip is left out and COUNTED in the
  panel (`partitionPicked`), and past `PICKED_MAX_STOPS` (40) the list is
  thinned evenly. The panel's strip shows exactly the stops before the hero,
  read-only, each tile the decoded picture or its day number on dark.
- **The chooser is the shell's, reached through `HookPanelHost` (2026-09-14).**
  A panel may not open the Library or ask an instance, so `HookPanelProps.host`
  carries what the shell does for it — `choosePictures(selected)` resolving the
  kept list or null, and `pictureStatus` — and `HookPicker` draws the sheet
  (`HookPicturesModal`, through a portal: the inspector is itself a sheet on a
  phone). It is the maintainer's gesture: a span (trip so far · this leg · last
  7 days · this day, or two dates), every photo SHOT in it from the Library
  (dated by EXIF) and the connected instance, grouped by trip day, ALL ticked;
  untick, look large from a tile's corner, "Use N pictures". Reopened, the held
  list is what is ticked; a widened span is new ground and comes in ticked. The
  rules are pure (`picture-pool.ts`: one picture in both places is offered once,
  from the Library). Photos only — a clip would mean downloading the clip to
  pick a frame.
- **The ticks are tuned in the score too (2026-09-13): a kit, a pitch, a
  drift.** `SCRUB_KITS` names, per kit, the ordinary landing's voice, how a
  leg's landing departs from it (lower, a little louder — the one sound that
  carries meaning stays the one that is different in every kit) and the seat,
  which stays the seat everywhere because it is the phrase's end and not a
  tick. `tickPitch` transposes every event (×0.5–×2, read out in semitones);
  `pitchDrift` climbs or falls about three semitones across the landings
  (`DRIFT_SPAN`) and leaves the seat at the plain pitch. All three are event
  `rate`s in the score, so nothing downstream changed. Measured by zero-
  crossing rate on the rendered bed: ×0.5 / ×1 / ×2 gave 1639 / 2739 /
  4821 Hz (a coarse estimator on band-passed noise, hence ≈×0.6 and ≈×1.76
  rather than exact octaves), the woodblock kit sits near 880 Hz, a falling
  drift descends monotonically and a rising one spans ×1.39 across a sweep.
- **The tape's look is authored (2026-09-13)** — its width and distance from
  the edge, two colours (the ticks ahead; the head and the days passed), tick
  opacity, height and spacing, the track on or off, a dark band behind it, a
  fade over both ends, three head shapes and the glow. Two rules in how it is
  drawn: the geometry and the fade curve are PURE (`tapeGeometry`,
  `edgeFadeAt`, `hexToRgba` in `scrub-plan.ts`, tested) and the paint only
  reads them; and the fade is a per-tick alpha and a gradient FILL for the
  band and the track — never a mask or a composite mode, since a shadow is
  dropped under `destination-*` and the head's glow is one. The spacing slider
  is the `minGapPx` `tapeTicks` already thinned a long trip by, so a coarse
  tape on a long trip and a fine one on a short trip are the same rule; a
  leg's start and the trip's two ends always draw. Colours are validated
  `#rrggbb` (anything else falls back, never throws) and reset together.
- **Three places had to learn that a hook can move without an animated piece**,
  each a real bug the first render showed: the badge clock (it never started,
  so the stage sat on the sweep's first, dark frame), the thumbnail capture
  (never while the transport plays, or another day's picture stands for this
  piece everywhere), and `deckSlides`' `auto` medium (`hookMoves`, measured by
  preparing the hook — a scrub on day 1 plays nothing and stays an image).

## 10. Route trace — retired (2026-09-13 → 2026-09-15)

The engine's second variant derived its line from the trip's legs. **The
Itinerary replaced it** on the maintainer's call, and the files are gone
(`route.tsx`, `route-paint.ts`, `route-plan.ts`); a stored `route` layer is
converted rather than dropped, by `mapFromRoute` in the v19 trip migration.
`git show 3c7bfb6 -- src/shared/roadtrip/hooks/route.tsx` is where it lives
now.

What it proved, and what carried over:

- **It marked a LEG, never a point.** A place has no dates of its own and the
  badge's caption names the leg, so a "you are here" pin would have been a
  claim the document cannot back. That refusal is the whole reason the
  Itinerary is ALLOWED to pin one: there the stop is the author's own
  assertion, not a reading of the calendar (§13).
- **Equirectangular with the longitude scaled by cos(mean latitude)**, no
  tiles and no map library — honest at the scale of a country. The Itinerary
  draws on the same projection and runs it backwards to pick.
- **Every text is the place's own name, a distance the pen actually covered,
  or the letter N.** The distance is great-circle and says so.
- Its option groups, its label placer (now `label-place.ts`) and its tick
  scoring were the second consumer that made `easing.ts`, `tick-kits.ts`,
  `panel-ui.tsx` and `colour.ts` shared — which is what made the Itinerary a
  file plus a registry line rather than a third copy of all of it.

## 11. Phases — one commit each

1. **The contract, and the badge inside it.** Types, registry, `badge` variant,
   `resolveHook`, tests, and the paint seam threaded into `renderBadge` /
   `slide-render`. Storage (`PostBadge.hook`, v15) rides along so the engine
   reads the document from the first commit. No visible change. **Built.**
2. **The picker.** Cards on the Look tab, the variant's `Panel`, the two pure
   writers. With one variant the row is one card — the honest way to prove it.
   **Built.**
3. **Défilé, silent.** Stop list, paint, `content()` through `elementsAt`,
   options panel — on the stage, the PNG deck, the rail, and BOTH video paths
   (the clip's and the still's). **Built.** Not verified in a browser: an actual
   encode of a scrub (the test profile's pieces carry no picture).
4. ~~`exportGeneratedClip`~~ — **already built** as `encodeFrames` (§8).
5. **The voices and the bed.** Preset table, `score()` on Défilé, offline
   render, `AudioEncoder`, an audio track in `encodeFrames`, live playback
   muted by default. Stills only — no mixing anywhere. **Built.**
6. **Mixing**, for clips that keep their sound. Opt-in. **Built** — and
   wider than planned: the plan (`audio-plan.ts`) also gives the ticks to a
   clip with NO sound of its own, which needs no decoding and is the common
   case for drone footage. Measured by decoding the MP4s back: silent clip,
   copy, mix, and a trimmed mix that lands the clip's own sound sample-exact
   where the copy is off by up to one AAC frame (`media-pipeline.md`).
7. **Route trace.** A second real variant, deliberately unlike the first: needs
   located places, no media, no sound, no stop list. If it fits the contract
   without changing it, the contract is right. **Built — and the verdict:**
   the `HookVariant` interface, `resolveHook`, the picker, the renderer and
   both exports did not change by a line. `HookContext` gained ONE optional
   field (`stages`, filled by `hookContextFor`), which is exactly the growth
   `needs.places` announced in phase 1 rather than a reshape. Its first real
   `unmet()` also proved the picker's disabled-with-a-reason card, which no
   variant had exercised.
8. **Itinerary** (2026-09-14, unplanned — the maintainer asked for a map hook).
   The first variant whose subject is AUTHORED rather than read, and the first
   to combine a stop list, picked pictures, a paint, a score and a content
   rewrite in one file. §13.

## 12. Open points

- **The scrub voices have not been heard by a human.** Their energy is in the
  right place in the file (measured); whether `detent`, `leg` and `seat` sound
  like a ratchet coming to rest — and whether the three other kits (woodblock,
  typewriter, shutter) read as instruments rather than as UI sounds — is the
  maintainer's ear to judge. The gains and frequencies are one table in
  `voices.ts`, the kits one table in `scrub-plan.ts`.
- **The ticks' level is one slider** (Défilé → "Ticks volume", 0–200%, built
  2026-09-13, raised to 200% the same day), applied inside `scrubScore`, so
  live playback, a still's video, a silent clip's track and a mix all follow
  it. Linear up to where `BED_CEILING` starts pulling it back — measured on a
  worst-case dense sweep (16 stops, a leg start almost every stop): 50% →
  ×0.52 RMS, 150% → ×1.47, 200% → the guard engages and the bed's peak sits
  exactly on the ceiling (0.98) rather than climbing further; the decoded MP4
  peaks at 0.992, under full scale. Whether 200% is enough over real wind
  noise is the maintainer's ear to judge.
- **An HE-AAC source** (rare in cameras and phones) would need its real
  AudioSpecificConfig, which `decodeAacWindow` reads from the sample entry and
  only falls back to a built LC one; if a decode fails, the export copies the
  clip untouched and says so rather than producing garbage.
- **The priming constant is one platform's measurement.** Another browser's AAC
  encoder may prime differently; the round trip in `media-pipeline.md` is how
  to check before claiming sync there.

- **The tape paints UNDER the shades**, because the seam is between the picture
  and the shades. A strong scrim at the bottom dims it — the tape's own dark
  band (built 2026-09-13) is the answer for a bright picture, not for a
  scrim; if a tape must sit over the shades, a variant needs a second seam
  above them, not a hack in the paint.
- **The hook's screen time does not grow to fit the sweep.** The panel says so
  when `hookSeconds` would cut it; the document is never changed behind the
  author's back.
- **Sound in the editor's transport** is designed but unbuilt; the toggle's home
  (transport vs Look tab) is not decided.
- **The stack UI** (more than one layer) has no design. The storage is ready for
  it; the picker is not, and ordering + two `frame` owners need a screen before
  it can exist.

## 13. Virée — the car on the map (2026-09-14)

The third real variant, and the first that OWNS the frame with a drawing of
its own rather than with pictures: a paper map, the road as a curve through
the stops, and a cartoon Land Cruiser Prado driving it, halting at stops to
show pictures. The maintainer's brief: *"une carte avec un tracé… des points
que je choisis ou déterminés automatiquement en fonction des photos
sélectionnées… une petite voiture en 3D, une Toyota Prado noire, cartoonish,
élégante, optimisée, fluide… des moments d'arrêt pour montrer les photos…
autour du point approché, en temps réel, en fond d'écran, ou pas du tout…
surprends-moi"*. What it took, and what it changed in the contract: **one
optional field again** — `HookPictureWant.shape` (`frame` | `own`, since a
print wants the whole picture at its own aspect and a flash wants the frame's
crop) — and `HookPickedPicture.coords`, so the chooser hands a variant WHERE a
picture was shot. Nothing else in `HookVariant`, the resolver, the picker, the
renderer or either export moved.

- **Files.** `mesh3d.ts` (the renderer), `car-model.ts` (the Prado),
  `drive-plan.ts` (stops, road, schedule, camera, furniture, score),
  `drive-paint.ts` (the frame), `drive.tsx` (sketch, panel, entry). Shared,
  lifted out of the route and Défilé when the drive wanted them: `geo.ts`
  (projection, great-circle, distance format, name placement, and a
  re-centrable `projectionFor`), `picked.ts` (the picked list's reading,
  shot order, `partitionPicked`, `sampleEvenly`).
- **The car is a software renderer of our own, not a 3D library.** ~180
  flat-shaded faces meeting at an inked edge, every part CONVEX, so a
  painter's algorithm (back-face culling within a part, nearer centre drawn
  later between parts) is exact without a depth buffer; `outward()` winds
  every face away from its centre at build time so no hand-typed order can
  turn a face inside out. A 2.5D orthographic camera looks north and down at
  a tilt; two lights and a highlight from the key let a BLACK car (the
  maintainer's default) read as a shape. Wheels and spokes spin from the
  distance travelled; the shadow is three ellipses, no blur. Why not
  Three.js: a dependency the size of the rest of the tool, a WebGL context
  per stage that is never reclaimed, and a copy per frame into the 2D
  context every opener paints in.
- **Stops, two sources, one refusal.** `places`: the legs' located places,
  the trip so far, arriving where this day's leg ends — the leg, never a
  spot the dates cannot justify, the route trace's rule. `pictures`: each
  picked picture shot with a position is a stop in shot order (a run within
  150 m is one stop). A picture WITHOUT a position rides with the stop shot
  before it (pictures) or with the end of the leg its day belongs to
  (places — the leg is dated, the place is not); one that fits nowhere is
  counted (`LeftOut`) and said in the panel, never guessed onto the map.
  The told days' pictures ride along on places (`includePieces`), at the
  end of their leg.
- **The clock is closed-form** (`buildSchedule`): a hold, runs between
  halting stops sharing the driving time by length with a floor, a halt of
  one beat per picture (a beat everywhere when asked), the arrival, a
  0.7 s reveal. `plan.at(t)` is a function of `t` alone; the arrivals are the
  easing's inverse at each stop's share of its run, so a tick lands on the
  frame its dot fills. The path is measured in plan units (a 1000-box), the
  camera one similarity transform (`viewAt`): whole route fitted, or zoomed
  by a share with the car held at the centre.
- **Pictures, four ways**, the maintainer's own list: `cards` (prints
  popping beside the car, piled to one side of the stop — a pile, not a
  spread, so a stop's pictures cover one patch and not the road; the car is
  drawn OVER them, a toy standing on the map), `fill` (the picture takes the
  frame while the car halts), `backdrop` (it takes the PAPER's place behind
  the road and the car), `none`. The reveal at the end fades the whole map
  off the piece's picture through one buffer canvas, so a fade of a hundred
  strokes is one `drawImage`.
- **Verified in headless Chromium**: the car at eight headings and three
  tilts in four colours; eight frames of five option sets through the
  variant itself (`prepare` → `paint`) on a three-leg fixture with generated
  pictures; the panel mounted standalone, choosing pictures and switching the
  stops' source updating its summary and its left-out line. NOT exercised: a
  real export, the chooser reading GPS from real files, memory on a phone.

### The garage — the car is the trip's (2026-09-15)

- **`TripDoc.car` (v19), portable.** `CarSpec { model, color, finish, gear }`
  (`shared/roadtrip/car-spec.ts`, pure, tested), read through `readCarSpec`
  by the migration and by `parseTripFile`; junk or nothing lands on the
  default — the maintainer's Prado J120 in Raptor black, fully geared, which
  is what the opener drew before the field existed. `DriveOptions` keeps only
  what is about the PIECE's view of the car (`carSize`, `tilt`); `carColor`,
  `spare`, `rack` and `mirrors` are read and ignored.
- **`HookContext.car`** (optional, filled by `hookContextFor` from `trip.car`)
  is what `prepare` reads, `DEFAULT_CAR` when absent (`hookMoves`' four-argument
  context only asks for the seconds). `driveScratch(spec)` resolves the model
  from `car-registry.ts` and builds the parts LAZILY on the first paint, so
  preparing every deck slide stays cheap.
- **`HookPanelHost.configureCar?()`** is the one new host verb. The picker sets
  it from `onConfigureCar`, one prop through `LookTab` from `PostEditor`; a
  panel whose host has none says the car is set in the trip's settings. The
  picker's contract stays the PIECE's opener: it never receives the trip or a
  trip writer.
- **Two homes, one panel.** `CarGaragePanel` is controlled and has no shell
  (the `CoverPanel` rule): the trip settings sheet's Car section writes on
  every switch; `CarGarageModal`, opened from the piece, holds a DRAFT and
  writes on Done — the map is being composed behind it, and a stage that
  redraws on every flag is a distraction. `CarTurntable` paints with the
  drive's own `renderOrder` / `paintMesh`, `carLight(finish)` and
  `carPalette(color)`, so the garage shows what the map gets; its angle is a
  look, never stored, never the piece's Camera row.
- **`Light.sheen`.** A matte black car is a silhouette under the renderer's
  pure multiplier, so `lighting()` gained an additive term from the key
  (`sheen × k`, default 0, so `DEFAULT_LIGHT` and every test stand);
  `carLight('matte')` is gloss 0.04, sheen 0.12, ambient 0.48. Check the black
  car first after any change to the light or the palette.
- **Convexity recipes for gear.** A hoop is two uprights and a top tube; a
  basket is a floor and four rails; a can's handle is its own box; a spot
  light is a `cylinder` with a `lamp` decal on the FRONT cap only; a visor is
  a decal pushed 0.012 along the cabin's side normal; a chamfer decal states
  its chamfer's normal or `decal()` turns it away. The load sits where the
  photographs have it — solar left, box front right, three cans across the
  rear, water · petrol · water — without overlaps, pinned by
  `car-model.test.ts`; his placement is the authority, the geometry an
  approximation of it.

## 14. Itinerary — an authored map (2026-09-14, rev. 2026-09-15)

The variant that answers "which of these can the author compose themselves?".
Its decisions and its traps live in `roadtrip.md` («The Itinerary opener»);
what belongs to the ENGINE is what it asked of the contract, and what it
proves about it.

**What the contract did not need.** `HookVariant`, `HookRender`, `resolveHook`,
`foldHook`, the picker, `renderBadge` and both video exports are unchanged. A
variant that owns a stop list, decodes pictures, paints, scores AND rewrites a
badge piece fits the shape as written — which is the strongest reading it has
had, since Défilé and the Route each exercised only part of it.

**What it did need**, both optional and both filled by the shell:

- `HookPanelHost.choosePictures` takes a `HookPictureChoice`
  (`includeThisDay`), because the chooser's default span was Défilé's reading
  of "pictures for a hook" — the days BEFORE the piece. `defaultSpan` carries
  the flag; `reachSpan` still bounds both, so nothing shot after the piece is
  ever offered.
- `slideRender` takes the decoded pictures, because "a still is drawn settled,
  so it needs no pictures" was Défilé's truth and not the engine's: an
  itinerary shows its stops' photographs AT REST. The PNG deck and the rail's
  thumbnails pass them; the video paths already read them through the
  `ResolvedHook` the stage prepared.

**What it needed SECOND (2026-09-15), and the line it drew.** The opener had
to be draggable on the stage "like any other content", so `HookVariant` gained
`frameBox` and `moveBy` — both optional, both pure, both **editor-only**. They
are on the VARIANT and not on `HookRender` on purpose: the closure `prepare()`
returns is what the stage, the PNG deck, the rail and both exports share, and
none of them has any business knowing where a pointer is. A variant that
offers neither is not grabbable, which is the right answer for the badge and
for a scrub whose tape spans the frame. The stage's order of claim is
elements → opener → picture, unchanged in spirit: the badge is composed far
more often than the opener is placed.

**What it says about `owns`.** It declares `frame`, though only its backdrop
mode replaces the picture — the reading the scrub already used (it covers the
frame only while it sweeps). `owns` is what a variant MAY do, not what it does
on a given piece; nothing consumes the flag yet, and the conservative
direction is the safe one for the stack arbiter that eventually will.

**What two variants both wanted, again.** The Itinerary and the drive
reached for the same four things on the same day and, independently, lifted
them out the same way: the projection, the great-circle distance, its
formatting and the name placer now live in `geo.ts` (§13), which is the fourth
time the §3 rule has fired after `easing.ts`, `tick-kits.ts` and
`panel-ui.tsx`. `placeLabels` there takes `reserved` boxes, so a name never
lands on a pinned photograph.
