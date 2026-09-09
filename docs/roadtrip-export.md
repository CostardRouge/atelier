# Road Trip exports: what leaves the tool, what cannot, and the plan

**Status (2026-09-09): analysis + proposal. Nothing here is built, and nothing
here has been agreed with the maintainer beyond the direction he stated —
"exporter la vidéo du hook plus les autres éléments… un raccourci, qu'on
importe et qu'on utilise ce que l'on a déjà dans le studio… générer des vidéos
à partir du road trip".** Read §2 and §3 as fact (they are traced to files),
§4 onwards as a proposal. The style loss across the Studio bridge (§8) is the
maintainer's explicit "second temps": diagnosed here, deliberately not phased
in with the rest.

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

## 5. The model: an export PLAN, computed and shown

The smart export the maintainer asked for is one pure function away. Given the
trip, the post and what is known about each slide's media, `exportPlan()`
answers what the piece delivers and why:

```ts
type SlideDelivery =
  | { medium: 'png' }
  | { medium: 'video'; seconds: number;
      reason: 'the badge animates' | 'the picture moves' | 'both' };

interface PieceExportPlan {
  items: { position: number; kind: DeckSlideKind; name: string;
           delivery: SlideDelivery; note: string | null }[];
  medium: 'stills' | 'video' | 'mixed';
  /** What stops an item being delivered as planned, in a sentence each. */
  blockers: string[];
}
```

Rules, all decidable without touching the DOM:

- a slide is **animated** when a badge piece carries an `animation` (hook only,
  today);
- a slide **moves** when its media is a video the pipeline can read
  (`hookSourceProblem` is already that predicate);
- animated or moving → `video`; everything else → `png`;
- one slide, video → the piece is a **reel** (`medium: 'video'`);
- several slides with any video → **mixed**, and the deck ships PNGs and MP4s
  side by side under the existing `NN-hook / NN / NN-cta` names, which are
  already padded so a listing is in swipe order (`deck.ts`);
- blockers are stated up front, never discovered at encode time: no H.264
  encoder in this browser (F4), a hook clip the demuxer cannot read (WebM),
  a picture the Library has lost.

The panel draws that list — one line per slide, saying the format and the
reason — which is the anti-fabrication rule applied to the export: show what
will really come out, or why it cannot.

## 6. Phases (one commit each)

### P1 — the encoder brick: frames in, MP4 out

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

### P2 — the hook is a clip whatever its picture

`exportHookClip` in `use-post-exports.ts` routes on the source:

- **video** → `exportHookVideo`, exactly as today, untouched;
- **photo** → the new path: decode once with `loadBadgeSource`, grade **once**
  into a bitmap with `makeFrameGrader` (the picture never changes, so grading
  per frame would be 150 WebGL renders for one result — and the grader is
  caller-owned by the memory rule), then `encodeFrames` painting `renderBadge`
  at each `tSeconds` with the trip's theme, the shades, the framing and the
  badge's own elements.

Everything else stays: `hookVariant` for the frame and the 1080 cap,
`hookVideoName` for the file name, `hookSecondsWithin` for the length (with no
clip to clamp against, the ceiling is `MAX_HOOK_SECONDS`). Cadence is a
delivery choice with no source to inherit from: 30 fps, stated in the panel.

The one invariant to hold: **the still video and the PNG must be the same
composition at two clocks.** Both go through `renderBadge`; the PNG is that
render settled, the video is it at t. If a future change gives one of them a
path the other does not have, the preview stops being a preview.

### P3 — the smart export, and the general button back

- `shared/roadtrip/export-plan.ts` — §5, pure, tested.
- `ExportTab` leads with the plan (one line per slide) and one primary
  **Export the piece** that runs it, PNGs and MP4s together, through the
  existing folder-picker path (`writeItems`) so a mixed deck lands in one
  folder in swipe order. The current PNG-deck and hook-clip buttons stay as
  named escapes underneath.
- **The header gets its button back**, and it is the piece's primary export,
  not a duplicate of a tab's button — which amends, rather than breaks, the
  rule `5d11245` recorded ("a header action row is navigation and status,
  never a second trigger for a tab's own button"). The amendment to record:
  *the header carries the piece's ONE primary action; a tab's buttons are the
  escapes from it.* Pressing it still switches to the Export tab, where the
  report is (`onStart`).
- F4 is fixed here: `isEncodeSupported()` becomes a blocker in the plan, so the
  video lines say why they cannot be delivered instead of failing late.

### P4 — the deck as one video (a reel from a carousel)

Optional, and only worth it if the maintainer wants a carousel to be able to go
out as a single reel. With P1 in place it is a painter over the deck's own
timeline: each slide held for its own seconds, the hook playing its animation,
the closing card as the tail the Studio already knows (`outroTail`).

The honest limit to decide before building it: **a content slide that is a clip
cannot be inlined** without decoding a second source into the same timeline,
which is a multi-source export — the thing `roadtrip.md` says was rejected. The
two acceptable answers are (a) refuse, naming the slide, or (b) hold that
slide's chosen frame as a still and say so. Freezing without saying so is not
one of them.

### P5 — the Studio bridge keeps the trip's look

§8. Separate from the export work, and the maintainer's own second step.

## 7. Verifying this, given the container

**This container's Chromium cannot encode H.264** (`avc1.*` unsupported by
`VideoEncoder`; vp8/vp9 only) — the limit already recorded against the hook
clip in `roadtrip.md`, and the reason that feature shipped "unverified end to
end". So P1 and P2 cannot be proven here the way they will run for the
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

## 9. Decisions to confirm before P3/P4

1. **The header button**: primary export of the piece (recommended), or leave
   the header to navigation and mark the Export tab instead?
2. **A mixed deck**: PNGs and MP4s in one folder (recommended — platforms take
   mixed carousels), or force the whole deck to one medium?
3. **P4 at all**: is "the whole carousel as one reel" wanted, and if so which
   answer for a clip slide (refuse, or hold its frame and say so)?
4. **Still-video length and cadence**: the badge's hold + a beat at 30 fps
   (recommended, and it is what `defaultHookSeconds` already computes), or an
   author-set length as the clip path offers?
