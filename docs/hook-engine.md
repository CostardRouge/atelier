# The hook engine — many openers over one badge

**Status (2026-09-13).** Design agreed with the maintainer; **every phase is
built** — the engine, the picker, **Défilé** everywhere a hook is drawn, **its
ticks** in every video a hook makes (mixed into a clip's own sound on request),
and the **route trace**, which passed the contract test (§11, phase 7). What
was phase 4 turned out to exist already (§8). What is left is judgement, not
construction: §12. The
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
and never reads the store**. That is what stops ten variants each querying a
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
- **Flashes come from the thumbs store**, one JPEG per day (`hookDayPosts`: the
  published piece stands for its day over a draft). Local, already graded and
  framed, one read a day; a flash lasts a few frames, so a 640px picture
  stretched over it is not what anyone sees. Only the pictures `wantsPictures`
  names are decoded — a day each, and the PIECE the author chose for a day told
  several times — and a replaced set is closed late, since an export may still
  be drawing it.
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
  the numeral, the transport, `hookMoves` — agrees where rest is. And
  `days: 'chosen'` + `chosenDays` + `pieceByDay`: the author names the days
  and, for a day told twice, which piece flashes; the calendar the shell hands
  over (`HookDay.pieces`) is what lets the panel offer that choice without the
  variant reading the store, and a named piece that no longer tells its day
  falls back to the shell's own rule rather than to a blank. The panel shows
  the sweep's days as TILES drawing the picture the shell decoded — only the
  days in the sweep are decoded, the rule that keeps a 250-piece trip from
  decoding 250 thumbnails, so a day taken out of the sweep shows its number on
  a dark tile.
- **Three places had to learn that a hook can move without an animated piece**,
  each a real bug the first render showed: the badge clock (it never started,
  so the stage sat on the sweep's first, dark frame), the thumbnail capture
  (never while the transport plays, or another day's picture stands for this
  piece everywhere), and `deckSlides`' `auto` medium (`hookMoves`, measured by
  preparing the hook — a scrub on day 1 plays nothing and stays an image).

## 10. Route trace — what it refuses to claim (2026-09-13)

- **It marks a LEG, never a point.** A place has no dates of its own, and the
  badge's caption names the leg (`stageLabel`), not a spot on it — so the trace
  paints the day's leg in the accent and pins nothing, except a leg of ONE
  located place, which is that place and is ringed. Checked through the real
  renderer: the accent leg and the caption under it name the same thing.
- **Past solid, current accent, future faint and dashed.** The pen draws the
  trip so far, then the legs still ahead fade in; the projection fits ALL of
  them from the first frame, so nothing jumps when they arrive.
- **A place without coordinates is simply not on the line** (typed by hand is
  the normal case), and the panel says why a leg may be missing. Coordinates
  come only from the opt-in place lookup — nothing here reaches the network.
- **Equirectangular with the longitude scaled by cos(mean latitude)**: honest at
  the scale of a country, no tiles, no map library. A route across the
  antimeridian would split — untested, and no trip of the maintainer's does.
- A dark underlay under every stroke keeps a white line legible over a pale
  sky without a per-frame shadow blur.

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

## 12. Open points

- **The three scrub voices have not been heard by a human.** Their energy is in
  the right place in the file (measured); whether `detent`, `leg` and `seat`
  sound like a ratchet coming to rest is the maintainer's ear to judge — the
  gains and frequencies are one table in `voices.ts`.
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
  and the shades. A strong scrim at the bottom dims it. Acceptable so far; if it
  is not, a variant needs a second seam above the shades, not a hack in the
  paint.
- **The hook's screen time does not grow to fit the sweep.** The panel says so
  when `hookSeconds` would cut it; the document is never changed behind the
  author's back.
- **Sound in the editor's transport** is designed but unbuilt; the toggle's home
  (transport vs Look tab) is not decided.
- **The stack UI** (more than one layer) has no design. The storage is ready for
  it; the picker is not, and ordering + two `frame` owners need a screen before
  it can exist.
