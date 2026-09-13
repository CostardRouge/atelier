# The hook engine — many openers over one badge

**Status (2026-09-13).** Design agreed with the maintainer; **phase 1 is built**
(the contract, the registry, the `badge` variant, the resolution and the paint
seam). Phases 2–7 are not. The exemplar that drove the design is the **scrub**
(«&nbsp;Défilé&nbsp;»): the trip's measuring tape sweeps from day 1 to the day
being told, flashing that day's pictures as it passes, and ticking.

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

## 6. Picking one

Cards, never a dropdown — the rule already settled for title styles: *a style
you cannot see before adopting is a style you adopt by trial*. On the **Look**
tab, above the style; each card draws the variant's own preview on this piece's
real picture, static, animating on hover or focus. Selecting one swaps the panel
below for that variant's options. A variant whose `unmet()` answers is greyed
**with the reason on the card**, never hidden. Scope: per piece; the trip-wide
default joins ⚙&nbsp;Trip → New pieces, beside the look a new piece inherits.

## 7. Sound

The lineage is the maintainer's own `p5-templates`: events → offline render →
mux. Two differences, one of them a simplification.

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
| a **still** | no video path at all | the bed is the only track — no conflict |
| a **clip delivered silent** (`keepAudio = null`) | already silent | bed encoded alone — free lane |
| a **clip keeping its sound** | AAC copied bit-for-bit, deliberately | decode → sum → re-encode. **The one rule that bends** — opt-in, "keep the original audio untouched" stays the default |

Guard `AudioEncoder` the way `pickAvcCodec` guards the video codec: where it
cannot encode, the export ships **silent with a stated reason**, never failed.
In the editor the score plays through one `AudioContext` created on a user
gesture, muted by default behind a speaker toggle — a panel that ticks while a
slider is dragged is unusable.

## 8. The missing seam: `exportGeneratedClip`

A scrub over a photograph has no footage to burn into, and `exportHookVideo`
needs a `File`. What is missing is a head with no body — *easier* than the
deferred pre-roll, because nothing already encoded has to move:

```ts
exportGeneratedClip(opts: {
  seconds: number; fps: number; width: number; height: number;
  draw: (tSeconds: number) => CanvasImageSource;   // ExportTail's own shape
  audio?: AudioBuffer | null;
}): Promise<Blob>
```

It unlocks three things at once: every variant **on a still**, a photo piece
deliverable as a reel at all (the 2026-09-09 open item), and later the pre-roll.

## 9. Phases — one commit each

1. **The contract, and the badge inside it.** Types, registry, `badge` variant,
   `resolveHook`, tests, and the paint seam threaded into `renderBadge` /
   `slide-render`. Storage (`PostBadge.hook`, v15) rides along so the engine
   reads the document from the first commit. No visible change. **Built.**
2. **The picker.** Cards on the Look tab, the variant's `Panel`, the trip-wide
   default. With one variant the row is one card — the honest way to prove it.
3. **Défilé, on a clip, silent.** Stop list from `tripCoverage`, the paint, the
   `content()` rewrite of the numeral, the options panel. Rides
   `exportHookVideo` unchanged.
4. **`exportGeneratedClip`.** Défilé on a still; photo pieces exportable as
   video.
5. **The voices and the bed.** Preset table, `score()` on Défilé, offline
   render, `AudioEncoder`, live playback muted by default. Stills first — no
   mixing anywhere.
6. **Mixing**, for clips that keep their sound. Opt-in.
7. **Route trace.** A second real variant, deliberately unlike the first: needs
   located places, no media, no sound, no stop list. If it fits the contract
   without changing it, the contract is right.

## 10. Open points

- **`content()` is unwired.** Phase 1 threads the *paint* (cheap, already
  per-frame) but not the content rewrite: both call sites `useMemo` the elements
  on a stable `content`, and making that depend on the transport's clock would
  rebuild every element every frame for a variant that rewrites nothing. The
  answer when Défilé needs it (phase 3) is to move the element build into the
  render — `renderBadge` taking `content` + `layout` rather than finished
  `elements` — not to add a time dependency to the React memo.
- **Sound in the editor's transport** is designed but unbuilt; the toggle's home
  (transport vs Look tab) is not decided.
- **The stack UI** (more than one layer) has no design. The storage is ready for
  it; the picker is not, and ordering + two `frame` owners need a screen before
  it can exist.
