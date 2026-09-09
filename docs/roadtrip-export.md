# Road Trip exports: what leaves the tool, what cannot, and the plan

**Status (2026-09-09): P1 and P2 are BUILT; P3 onwards is the plan.**

The direction is the maintainer's — "exporter la vidéo du hook
plus les autres éléments… un raccourci, qu'on importe et qu'on utilise ce que
l'on a déjà dans le studio… générer des vidéos à partir du road trip" — and so
is the model in §5: **a slide carries its own medium and its own duration,
decided where the piece is composed, and the export only delivers what the
deck says**. That decision arrived after, and replaces, an export-mode picker
agreed earlier the same day; §9 records both so the reversal is legible. Read
§2 and §3 as fact (they are traced to files), §4 onwards as the plan. The
style loss across the Studio bridge (§8) is his explicit "second temps":
diagnosed here, last in the phase list and callable forward whenever he wants
it.

---

## 1. The report, and what it turns out to be

*"Je crois que j'ai accidentellement supprimé le bouton d'export général. Quand
je crée un réel avec un hook animé, lorsque j'exporte je ne peux que les
exporter en mode slide, ce qui fait qu'on n'exporte pas l'animation."*

Two separate things, and only one of them is a deletion:

- **The removed button was the PNG deck's, not a video's.** Commit `5d11245`
  ("Clean up the piece editor's header: no more wrap, no duplicate export")
  removed a header button whose handler was `exports.exportDeck()` and whose
  label was the Export tab's own (`↓ Export PNG` / `↓ Export N slides`). It
  never encoded anything. Removing it cost the shortcut, not the capability.
- **The capability genuinely absent is a video of an animated hook that sits
  on a PHOTOGRAPH.** That is not a regression — it has never existed anywhere
  in the suite. It is finding F1 below, and it is the whole of the report.

## 2. Every exit a piece has today

| Exit | Code | Delivers | Requires |
| --- | --- | --- | --- |
| PNG deck | `use-post-exports.ts` → `deck-export.ts` → `badgeToPng` | one PNG per slide, 1920 long edge, badge **settled** | nothing |
| Hook clip | `use-post-exports.ts` → `hook-video-export.ts` → `exportVariantVideo` | one MP4, badge animated, audio copied | the hook's picture is an **MP4/MOV video** |
| Studio bridge | `StudioLink.tsx` → `hook-scene.ts` | writes the badge into a `ProjectDoc` as the `roadtrip-hook` scene; the Studio exports | a linked project, and a **clip** in it |

The pipeline underneath all three: `exportVariantVideo` (`shared/media/export-variant.ts`)
→ `exportProcessedVideo` (`shared/media/webcodecs-export.ts`), which demuxes an
MP4 with mp4box, decodes, hands each frame to a `FrameProcessor`, re-encodes
H.264 and muxes with the audio copied through. Stills go the other way entirely:
`exportPhotoVariant` (`shared/media/photo-frame.ts`) composes one frame and
`toBlob`s a JPEG.

## 3. Findings

**F1 — an animated badge over a photo has no video path, anywhere.**
`exportProcessedVideo` opens with `if (videoSamples.length === 0) throw new
Error('No video frames found.')` and then needs the sample's codec description;
there is no way in. The Studio is not a way round it either: with a photo
active it takes the `isPhoto` branch (`StudioEditor.tsx:1024`, `:1216`) and
delivers a JPEG through `exportPhotoVariant`. So the entrance, the hold and the
exit the author composed on the badge are visible **only** in the editor's
transport. This is the reported bug, and it is one missing brick, not a broken
one: nothing can encode frames that did not come out of a decoder.

**F2 — the Export tab hides the video rather than explaining it.**
`ExportTab.tsx:90` branches on `hookIsVideo && duration > 0`; on a photo the
whole section collapses to one grey line ("The hook sits on a photo; a clip is
what gets the badge burned in"). The author who just spent ten minutes
animating a badge is told, in passing, that the animation has nowhere to go.
The tool's own rule (`roadtrip.md`, «Never offer a fabricated example») is that
an option says the real thing it would do or the reason it cannot — a collapsed
section says neither.

**F3 — nothing in the export layer knows a slide is animated.**
`renderDeck` renders every slide with `badgeToPng` at the stage's clock, and
`deckSlides` carries no notion of movement. `useBadgeClock` computes `animated`
(any piece with an `animation`) but it is UI state, used to show a transport —
the exporter never sees it. There is no object anywhere that says "this piece
needs a video".

**F4 — the hook clip is not guarded by encoder support.**
The Studio gates its export on `isEncodeSupported()` (`StudioEditor.tsx:1224`);
Road Trip does not. On a browser with no H.264 `VideoEncoder` the button is
offered and fails at encode time with the pipeline's own message.

**F5 — a content slide that is a clip exports as one frozen frame.**
`DeckSlide.videoTimeSeconds` exists for every slide, and `renderDeck` seeks to
it and takes a PNG. That is correct for a carousel; it silently loses the
motion when the deck is meant to be a reel.

**F6 — the three exits have no common surface.**
Two buttons and a bridge, each with its own preconditions, none of them saying
what the piece as a whole would deliver. "Robuste" in the maintainer's sense
means one place that answers "what comes out of this piece, and in what
format" — that object does not exist (F3), so the panel cannot draw it.

**F7 — the Studio bridge loses the trip's look.** Diagnosed in §8; it is the
maintainer's second-time topic and is not phased in with the rest.

## 4. The decision the plan rests on

**Road Trip renders its own video, through the Studio's engine, and the Studio
stays the place for a graded clip with telemetry.**

This is not the option rejected in 2026-08-24 (`roadtrip.md`, «The bridge to the
Studio»). What was rejected there was **a second exporter** — Road Trip
borrowing a project's LUT and re-implementing decode/crop/mux. What is proposed
here is the same move that was already made for the grade in 2026-09-06: use
the suite's one pipeline from a second entry point. Concretely the new brick is
*below* both tools — an encoder that takes painted frames — and the Studio gets
it for free (a pre-roll, a photo project delivered as a held card, are the same
brick).

The rule to carry: **one video pipeline, several entry points; never a second
exporter.** A change to cadence, colour tagging or muxing must keep landing in
`shared/media/`.

## 5. The model: the SLIDE says what it is, the export only delivers it

**The maintainer's design (2026-09-09), and it replaces the export-mode picker
proposed earlier the same day.** His argument, kept because it is the reason:
*"si j'ai l'ambition de gérer des types vidéo dans les slides, c'est un choix
qu'on doit plutôt faire en amont, à la création du contenu du post… plutôt que
de l'imposer à la dernière étape d'export qui va faire un choix à notre
place"*. A deck is composed, not guessed at the door.

So **a slide is a timed unit with a medium**, and both are stored:

```ts
type SlideMedium = 'auto' | 'image' | 'video';

interface PostSlide {          // + the fields it already has
  medium: SlideMedium;         // 'auto' by default
  seconds: number;             // screen time; for a clip, also its length
}

interface PostBadge {          // the hook is a slide too
  medium: SlideMedium;
  hookSeconds: number;         // screen time of the hook slide
  durationSeconds: number;     // UNCHANGED: the badge's own hold
}
```

`hookSeconds` and `durationSeconds` are two different numbers on purpose and
the doc comments must say so: the badge may settle at 4s inside a hook that
stays on screen for 6. `defaultHookSeconds` already computes one from the
other, and stays the default.

**`auto` resolves in `deckSlides()`**, which is already the one function that
assembles hook · content · closing card, so the rail, the export and the
renderer read ONE answer:

```ts
interface DeckSlide {          // + the fields it already has
  medium: 'image' | 'video';   // resolved — no 'auto' survives this function
  seconds: number;
  /** Why it came out video, for the line the panel prints. */
  reason: 'forced' | 'the badge animates' | 'the picture moves' | null;
}
```

The rules, pure and tested:

- `video` when the author forced it, when anything on the slide is animated
  (today a badge piece with an `animation`; tomorrow a caption or a free
  element, §P6), or when its media is a clip the pipeline can read
  (`hookSourceProblem` is already that predicate);
- `image` otherwise, and `image` also wins when the author forces it over an
  animated slide — that is a legitimate choice (a still for the grid), so the
  panel says what it costs, *"this slide is animated; as an image it goes out
  settled"*, rather than refusing or obeying in silence;
- a clip slide forced to `image` is its chosen frame — which is what the deck
  export already does today (F5), now said out loud instead of implied.

**What is left at export time is delivery, not format**: whether the deck
leaves as one file or as one per slide, and one override. `exportPlan` becomes
the reading of the deck rather than a decision over it:

```ts
interface PieceExportPlan {
  items: { position; kind; name; medium; seconds; reason; note }[];
  files: number;               // 1 when combined, else one per item
  blockers: string[];          // stated up front, never at encode time
}
```

- **Combine** makes ONE file of the whole deck, and a combined deck is a video
  by definition — offered whenever the deck has more than one slide, including
  an all-image deck, which is then a slideshow the author asked for.
- **"Everything as images"** stays as an escape and is labelled as an
  override: a browser with no H.264 encoder must still deliver something (F4),
  and a contact sheet of a reel is sometimes exactly what is wanted.
- Blockers keep their job: no encoder here, a clip the demuxer cannot read
  (WebM), a picture the Library has lost.

**Why this is better than the mode picker it replaces**, beyond being what was
asked for: the shape of the piece becomes visible where the piece is composed
(the rail shows a glyph and a duration per cell), the export stops being a
place where a decision hides, and the two features the maintainer wants next —
clip slides and animated content slides — need **no further model change**,
only renderers. That is the test a model should pass.

## 6. Phases (one commit each)

### P1 — the encoder brick: frames in, MP4 out — **BUILT**

`shared/media/render-video.ts`: encode a sequence of painted canvases to an MP4
with no source file — no demux, no decoder, no audio track.

- Reuses everything that already exists: `pickAvcCodec`, `deriveBitrate`,
  `makeExportCanvas`, `safeChunkMetadata`, the `ExportProgress` shape, and
  `tailFrames()` from `export-tail.ts` as the frame plan (it is already exactly
  "N seconds at F fps from an origin"; its doc comment gains a line saying it is
  now the shared plan, rather than being copied).
- Shape, deliberately the twin of `ExportTail`:
  ```ts
  encodeFrames({ width, height, fps, seconds,
                 draw(tSeconds): CanvasImageSource | Promise<…>,
                 onProgress, signal }): Promise<Blob>
  ```
- Even dimensions (H.264), keyframe every ~2s, `encodeQueueSize` back-pressure
  through the existing `awaitQueue`, encoder closed on every exit path — the
  comment at `webcodecs-export.ts:551` about leaked encode sessions applies
  here word for word.
- Silent by construction: no audio track is declared. Said in the UI, not
  discovered.
- Tests: the frame plan is pure and already covered; add specs for size
  evening, the fps clamp and the "zero seconds delivers nothing" case. The
  encode itself is browser work (see §7).

It comes first because it is the one risky brick and everything after it
depends on it. P2 could equally go first (it is model and UI only); what must
not happen is P2 shipping alone for long, with a rail promising a video the
tool cannot yet deliver.

### P2 — the slide model: a medium and a duration, chosen where the piece is composed — **BUILT**

Document **v14**, and the whole of §5's stored half.

- `PostSlide.medium` / `PostSlide.seconds`, `PostBadge.medium` /
  `PostBadge.hookSeconds`; `deckSlides()` resolves `auto` and hands back
  `medium`, `seconds` and `reason`.
- **The migration writes them at the END of `migrateTripDoc`** — the trap
  `roadtrip.md` already records: its blocks run in source order, so a v14 block
  placed high writes onto a badge the v2 block has not built yet.
- **This revises a memory decision, and the revision must be recorded**: «The
  hook's LENGTH is session state, not part of the document» (2026-08-24) rested
  on "a length is an export choice". Once every slide carries a screen time,
  the hook's screen time is part of the composition, so the reason no longer
  holds and `hookSeconds` moves into the document. The Export tab's slider
  moves with it.
- **Where the controls live**: a *This slide* section at the top of the Content
  tab, showing the medium as three choices and the resolved answer in words
  ("Auto · video, the badge animates"), plus the duration. It shows for
  whichever slide is open — the allocation rule from `roadtrip.md` («A panel
  that belongs to the PIECE»): the medium and the screen time are about the
  SLIDE, so they must never sit in the hook-only branch. The badge's own hold
  stays on the Look tab, where it belongs to the animation.
- **The rail shows the deck's shape**: each cell wears its medium glyph and its
  seconds. That is the payoff — a carousel that mixes a video hook and three
  stills reads as such at a glance, which is the thing the maintainer said he
  wants to decide up front.
- `HookDefaults` gains the hook's medium and screen time, so a trip keeps the
  habit; a new content slide takes a plain default (recommendation: 3s, `auto`)
  until there is a reason for a trip-wide number.
- Nothing renders differently yet: an image slide is still the PNG it was.

### P3 — the hook leaves as a video whatever its picture

The old P2, now driven by the slide's resolved medium rather than by the file
type. `exportHookClip` routes on the source:

- **clip** → `exportHookVideo`, exactly as today, untouched;
- **photo** → the new path: decode once with `loadBadgeSource`, grade **once**
  into a bitmap with `makeFrameGrader` (the picture never changes, so grading
  per frame would be 150 WebGL renders for one result — and the grader is
  caller-owned by the memory rule), then `encodeFrames` painting `renderBadge`
  at each `tSeconds` with the trip's theme, the shades, the framing and the
  badge's own elements.

Everything else stays: `hookVariant` for the frame and the 1080 cap,
`hookVideoName` for the file name. The length is now `badge.hookSeconds`,
clamped to the clip when there is one. Cadence has no source to inherit from
on a photo: 30 fps, stated in the panel.

The one invariant to hold: **the still video and the PNG must be the same
composition at two clocks.** Both go through `renderBadge`; the PNG is that
render settled, the video is it at t. If a future change gives one of them a
path the other does not have, the preview stops being a preview.

### P4 — the export executes the deck, and the general button comes back

- `shared/roadtrip/export-plan.ts` — §5's reading half, pure, tested.
- `ExportTab` leads with the plan (one line per slide: format, seconds,
  reason), then the delivery row (combine, and the images override), then one
  primary **Export the piece**. Delivery goes through the existing
  folder-picker path (`writeItems`) so a mixed deck lands in one folder in
  swipe order. The PNG-deck and hook-clip buttons stay underneath as escapes.
- **The header gets its button back**, and it is the piece's primary export,
  not a duplicate of a tab's button — which amends, rather than breaks, the
  rule `5d11245` recorded ("a header action row is navigation and status,
  never a second trigger for a tab's own button"). The amendment to record:
  *the header carries the piece's ONE primary action; a tab's buttons are the
  escapes from it.* Pressing it still switches to the Export tab, where the
  plan and the report are (`onStart`).
- F4 is fixed here: `isEncodeSupported()` becomes a blocker in the plan, so a
  video slide says why it cannot be delivered instead of failing late.
- **The combined reel** rides the same commit or the next one: a painter over
  the deck's own timeline, each slide held for its own seconds, the hook
  playing its animation, the closing card as the tail the Studio already knows
  (`outroTail`). Two limits it must state before running: it is **silent**
  (audio is copied and never re-encoded, and a painted timeline has nothing to
  copy — un-ticking combine gives the hook its own clip with its sound), and
  until P5 a clip slide inside it is **held on its chosen frame**, named, with
  the same escape offered.

### P5 — a content slide can be a clip

The maintainer's own third phase. **The model already describes it**:
`videoTimeSeconds` is the in point and `seconds` is the length, which is
exactly what `hookRange(start, length, duration)` computes for the hook today.
So the work is renderers and one picker, not a document change:

- the Picture tab offers `FrameStrip` on a content slide, as the hook already
  has it;
- a clip slide exported on its own goes through `exportVariantVideo` like the
  hook's, with the slide's caption as its overlay;
- inside a combined reel it stops being held: with the painted encoder, playing
  it means decoding that clip into the shared timeline, which is a decode job
  rather than the multi-source MUX `roadtrip.md` rejected. Silent by
  construction, which the combined reel already is.

### P6 — a content slide can animate

Also the maintainer's, stated as the reason the model must be right now: *"il y
aura quand même des animations, peut-être du texte animé, peut-être un élément
visuel qui se déplace"*. The engine has carried this since the intro scenes —
`shared/overlay/animation.ts`, the same fade / slide / scale / typewriter /
wipe a badge piece uses. So the work is to let a content slide carry a style
and an animation the way `BadgePieceStyle` does, and `auto` picks it up with no
rule change. This is the phase that makes "a slide is often a video because it
is animated" true for the whole deck rather than for the hook alone.

### P7 — the Studio bridge keeps the trip's look

§8. Separate from the export work, and the maintainer's own second step. It is
last in the list and not in the queue: he can call it forward whenever the
style loss costs him more than the missing video does.

## 7. Verifying this, given the container

**This container's Chromium cannot encode H.264** (`avc1.*` unsupported by
`VideoEncoder`; vp8/vp9 only) — the limit already recorded against the hook
clip in `roadtrip.md`, and the reason that feature shipped "unverified end to
end". So P1 and P3 cannot be proven here the way they will run for the
maintainer. What *can* be done, and should be:

- drive the encoder loop in headless Chromium with a **vp9** codec into
  mp4-muxer (which accepts it) to prove the plan, the timestamps, the
  back-pressure and the muxed duration — then note in the commit that the
  delivered path is `avc` and was not run;
- render the badge painter frame by frame and check a handful of frames
  against `badgeToPng` at the same `t` — that is the invariant that matters
  (preview = export) and it needs no encoder at all;
- the maintainer's own machine is what finally confirms an MP4 plays.

Do not let a green test suite read as a working encode: nothing in CI can see
either (the same class of gap as the shader, `media-pipeline.md`).

## 8. Why the style is lost across the Studio bridge (F7)

Not a bug in one field — it is structural, and it has one clean fix.

`hookInjection` sends **elements only**. The trip's `StyleTheme` (`TripDoc.theme`:
the font, the colour, the glow, the panel — the four title-style presets) does
not cross. In Road Trip the badge is drawn with `theme: trip.theme`, so
`resolveElementStyle` fills every key the element did not deliberately pin. In
the Studio the same elements are resolved against the **project's** theme —
and a project created by `StudioLink.create()` is `createProjectDoc(...)`,
whose theme is `null`, which means "the element's own concrete values". The
badge therefore lands in its unthemed base style, and only the keys
`BadgePieceStyle` pinned in `styleOverrides` survive. That pinning is not a
bug: it is exactly the mechanism that lets one preset change restyle a whole
trip (`roadtrip.md`, «A piece may depart from the trip's style»).

Two fixes, and they compose:

- **(a) freeze the resolved style at send time** — for each element run
  `resolveElementStyle(el, trip.theme)`, write the resolved values back onto
  the element (including `sizeFrac`, which the theme multiplies) and pin every
  `ThemableKey` in `styleOverrides`. The badge then looks identical in any
  project, whatever its theme. It is the tool's own idiom (write the value AND
  pin the key), and a resend re-freezes, so editing in Road Trip stays the way
  to restyle. Cost: the badge stops following a theme change made in the
  Studio — which is arguably right, since the trip owns that look.
- **(b) offer the trip's theme to a project that has none** — `withHook` sets
  `doc.theme = trip.theme` when the project's is `null`, and when the project
  has one of its own it is never overwritten, it is reported (the
  `withCtaOutro` rule). This is the free case: a project created from Road Trip
  has no titles of its own to restyle.

Recommendation: **(a) as the default, (b) as an offer on a project created from
Road Trip.** Either way the panel must say which look the Studio export will
use — the same discipline `StudioLink` already applies to the grade.

## 9. Decisions

**Taken by the maintainer, 2026-09-09** — do not re-litigate:

1. **The header button comes back as the piece's primary export.** Not a
   duplicate of a tab button: the tab's buttons become the escapes from it.
2. **A mixed deck ships PNGs and MP4s together**, in one folder, in swipe
   order, and platforms take mixed carousels.
3. **A slide carries its own medium and its own duration, chosen where the
   piece is composed** (§5). This SUPERSEDES the export-mode picker agreed
   earlier the same day: the export no longer decides a format, it reads the
   deck and delivers it. What survives at export time is delivery — combine
   into one file or not, plus an "everything as images" override.
4. **Video content slides and animated content slides are coming** (§P5, §P6),
   and the model is shaped now so that neither needs a document change later.
   That is the reason the medium moved upstream in the first place.

**Still open, small, and settled when the phase that needs them is written:**

5. **A new content slide's default duration** — a constant (recommended: 3s,
   `auto`), or a trip-wide number beside the other per-kind defaults. Nothing
   blocks P2 either way; the constant is one line to replace.
6. **Cadence for a painted slide**: 30 fps (recommended, and stated in the
   panel), or offered as a choice. A clip slide keeps its source cadence
   regardless — that is `hookVariant`'s existing rule.
7. **Whether a combined reel should carry the hook's audio** over its own span
   (§P4). Not in the first cut either way; `copyAudio` already takes raw
   chunks, so it stays cheap to add.
