# The signature — «Made with Atelier · Recap» in what the suite exports

Read before touching `src/shared/signature/`, a tool's `DocSignature` field, an
export that should (or should not) wear the mark, or the line at an Export's
foot.

## What it is, and his picks (2026-11-19)

His ask (2026-11-10): «an atelier logo or watermark to be inscribed in exports,
so people see the name of my project and tool … Made with Atelier / Recap, a
sticker logo». Lab https://claude.ai/artifact/Divt1R8MoTts4c97PTx6cF (two
versions: the faces, then «where you set it»); his answer «go with your
recommendations, build it». So the picks are the lab's recommended ones: the
STICKER on a still or a slide, the END CARD alone on a film, «Made with
Atelier · <tool>», on by default for Recap, Trips, Mosaic, Flight Atlas and
Storytelling and off for Develop and the Studio, bottom left above Instagram's
caption, a carousel's last slide only, set from a POPOVER on a line at the
Export's foot, the face and the words kept on the device for every tool.

**Built 2026-11-19: Recap, Mosaic, Flight Atlas.** Trips and Storytelling are
owed (Trips writes through several pipelines — badge, hook video, deck stills;
a Storytelling post's per-document switch would live in his private script);
Develop and the Studio stay unsigned until he asks. It is NOT Develop's roll
watermark (the author's name on his photograph, `export-targets.ts`).

## Two halves, two places

- **The style** (`SignatureStyle`: `face` line · sticker · stamp · corner,
  `words` made · tool · address) is ONE brand: `signature-pref.ts`, a
  `localPref` under `atelier.signature.v1`. The legal notice's «your
  preferences (… the choices each tool remembers)» already covers it — no new
  line there. His open alternative, asked in the lab: keep it with a house
  style instead (an iPhone's home-screen app has its own storage).
- **The document's** (`DocSignature`: `on`, `corner`, `slides`) is a field of
  each tool's document — required on `RecapDoc` (`readRecapDoc` defaults it),
  optional on `MosaicDoc` and `AtlasDoc` (`signatureOf(doc)` gives the tool's
  default: Recap bottom left, Mosaic bottom right, Flight Atlas TOP right —
  its statistics and clock hold both bottom corners, met on the first poster).
  No document version was bumped: an absent field is the default, so every
  existing document is signed from now on — his pick «on».

## The painter, and why sizes are what they are

`signature-paint.ts`: vectors and the suite's own faces at the FILE's size, no
image shipped. An em is 4.2 % of the frame's SHORT side (the lab's `--k: 4.2`
of a Reel's width, the same share of a 16:9 film's height). The mark is the app
icon's 32-unit drawing. `safe: REEL_SAFE` (12 % top, 16 % bottom, `RecapStage`'s
hatched bands) keeps it clear of Instagram on a 9:16 frame. A face with no
ground of its own (line, stamp, corner) reads its INK from the pixels under it
(`darkUnder`, one pixel in sixteen; a tainted canvas reads as dark → light
ink). `paintEndCard` is drawn for a 9:16 frame in hundredths of its width and
takes a wider frame at its height; its ground follows the film — `frameIsDark`
read off the canvas that still holds the film's LAST frame when the card
begins (`cardDark ??=`, so a second pass keeps the first's answer).
**Await `signatureFonts()` before a signed frame**: a canvas draws in whatever
face is loaded at that instant. Letter spacing is `ctx.letterSpacing` where it
exists.

**The end card is 1.2 s as the lab SAYS, its beats played in 0.6 of the time
the lab's CSS drew** (`endCardBeat`, pure, tested): the lab's animation ran
1.65 s under a caption that said 1.2 — everything has landed by 1.0 s. A signed
film's sound bed is the film's own length: the card is silent. Lengths said to
the person (Recap's verb, the foot's summary, what a post is told, an agent's
`seconds`) count the card.

## Where a mark falls

- **Recap** (`recap-signature.ts`, `recap-export.ts`): `exportPages(…, marked?)`
  — left out, the recap's rule over its PAGES (the stills' delivery); a
  carousel passes `carouselMarks(doc, order)`, which applies the rule to the
  carousel's SLIDES in their order, so a last slide that is the opener's still
  or a clip's MP4 wears it too (`exportOpenerSlide` / `exportClipSlide`'s
  `signed`). A film: the card only.
- **Mosaic** (`use-mosaic-export.ts`): the PNG is signed on a COPY — the
  builder's canvas is the scene's, and a scene is reused. A film: the card.
- **Flight Atlas** (`use-atlas-export.ts`, `run(…, sign)`): the frame and the
  poster; the video closes on the card AFTER the atlas's own outro.

## The stage is the preview

Recap paints the mark in its own paint loop (paused, on a page the rule
signs, never over the opener); opening the popover brings a signed page up
(`onSignPreview`). Mosaic and the atlas lay `SignatureOverlay` over their
frame — a canvas of its own, so a stage's loop learns nothing about marks —
shown while stopped (Mosaic, not zoomed) or while *Export* is the layer open
(the atlas, like its safe zones). The overlay reads its ink from the stage's
canvas where one is handed (`source`), else assumes a dark ground. A film's
end card is NOT previewed on any stage — the foot's summary says «end card
+1.2 s»; a preview of it is an open ask.

## The line and its popover (`SignatureLine.tsx`)

`DeliverBar`'s `head` (its first line; `above` was already taken by Recap's
Publish checks). The tick toggles `on`; the line opens `AnchoredPopover`
(dialog, above, start) beside the stage, and on a compact shell a panel IN the
drawer's flow above the line, brought into sight with `revealInScroller` —
it was under the fold on a 390 px phone before that. A pick of a face or a
corner turns the mark on. Rows say whose choice they are (*every tool* /
*this recap*). The face tiles are the real painter over a dusk, each face at
its own `TILE_SCALE` so it reads at 70 px.

## Verified, and not

Headless Chromium, 1360 and 390, on the dev server: Recap's popover, four
faces on the stage, a signed 1080 × 1920 still, a film encoded with its card
(9.97 s for an 8.77 s recap, frames cut out and looked at); Mosaic over the
stub Winnow (stage overlay, a signed 1620 × 1080 PNG); the atlas on the repo's
`tests/fixtures/sample.srt` (overlay, a signed poster). NOT seen: Mosaic's and
the atlas's films with their card, a carousel whose last slide is a clip, a
light film's paper card, anything on his devices.
