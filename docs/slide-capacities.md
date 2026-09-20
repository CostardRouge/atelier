# Slide capacities — an opener, a badge and masked text on any slide

**A proposal, not a set of decisions.** §1–§3 are traced to files and are fact;
§4 onwards awaits the maintainer, and §9 lists what to settle first.

Read it before touching `shared/roadtrip/slide-render.ts`, `deck.ts`,
`trip-types.ts`'s `PostBadge` / `PostSlide`, or before adding anything to
`OverlayElement`.

Interactive bench for the whole design (six worked decks, live compositing):
https://claude.ai/artifact/Q8paemaSsDENij7Lck2ti4

## 1. Where this comes from

The maintainer's note, 2026-09-16:

> on other slides we should be able to add a hook/opener and also text that can
> be mask on/off the media, with option blending modes etc

and, in conversation, the reason: one piece may hold **several drives** (a day
with three legs wants three itineraries), **several openers** (a Défilé and a
Virée are different animations and different reasons to keep swiping), and he no
longer believes the founding "a piece has exactly one hook, and it is slide 1"
is a rule of the work rather than an accident of how the tool grew.

He is right that it is an accident. It is also the load-bearing assumption of
about twenty branches. This brief separates the two things it bundles.

## 2. What the code actually assumes today (fact)

**The renderer is already agnostic.** `renderBadge` (`badge-render.ts`) paints
in one fixed order and never asks which slide it is drawing:

    background → picture (or collage) → hook.paint(t) → shades → qr → drawOverlays(elements)

`RenderBadgeOptions.hook`, `.shades`, `.elements` and `.framing` are plain
inputs. Nothing in that file knows the word "first".

**The wall is one pure function.** `slide-render.ts` (160 lines) branches on
`DeckSlide.kind` and hands back four different `SlideRender`s:

| kind | elements | theme | shades | hook | qr |
| --- | --- | --- | --- | --- | --- |
| `hook` | the badge's five pieces | trip's | `post.badge.shades` | resolved | — |
| `content` | one caption, wrapped | trip's | — | — | — |
| `cta` | the trip's card | none (flat) | — | — | the QR |

Everything downstream reads that record: the stage, `deck-export.ts`,
`use-rail-thumbs.ts`, and — through its own `isHook ?` ternaries —
`renderSlideVideo` in `use-post-exports.ts`, whose own comment already says
"ONE video for one slide, whatever it is made of".

**The hook context barely binds to the badge.** `hookContextFor` reads exactly
three fields off `post.badge` — `durationSeconds`, `hookSeconds`, `mode` — and
fills the rest from the trip and the post (`calendar`, `stages`, `car`, `date`,
`aspect`, `content`, `pictures`).

**A `DeckSlide` already carries the picture half for every slide**: `framing`,
`develop`, `grade`, `collage`, `videoTimeSeconds`, `speed`, `medium`, `seconds`,
`caption`. `PostBadge` and `PostSlide` hold those same fields under slightly
different names (`hookSeconds` vs `seconds`, `videoSpeed` on both). What a
`PostSlide` does **not** have is `hook`, `shades`, a badge, and more than one
line of text.

**`drawOverlays` wraps every element in `save()/restore()`** and draws with the
default `source-over`. It already composes in its own buffer where it has to:
the glow's grain is masked with `destination-in` into a scratch canvas, with a
comment recording why — *drawing shadowed text straight into a `destination-in`
context loses the shadow, measured in Chromium*.

**The hook is named in seven more places** that are not rendering:
`slideFileName`'s `-hook` suffix, `HOOK_PICTURE = 'hook'` (the picture key
`post-grade.ts` and `develop-apply.ts` share), `HOOK_SCENE_ID` in
`hook-scene.ts` ("One per project: a clip has one hook"), the thumbs store,
`hookDefaultsFrom`, `export-plan.ts`, and the editor's own labels.

## 3. The two things `PostBadge` bundles

`PostBadge` is not "the opener". It is four unrelated things that share a record
because slide 1 was the only slide that could hold any of them:

1. **the picture** — `media`, `framing`, `develop`, `grade`, `collage`,
   `videoTimeSeconds`, `videoSpeed`, `medium`, `hookSeconds`. `PostSlide` has
   every one of these already.
2. **the badge** — `mode`, `timeAgo`, `referenceDate`, `showPin`, `showExif`,
   `layout`, `pieceStyles`, `cascade`, `durationSeconds`, `textOverrides`.
3. **the opener** — `hook: HookLayer[]`.
4. **the shades**.

Only (2), (3) and (4) are withheld from a content slide. (1) is duplication that
already exists and that this brief deliberately does not touch (§8).

## 4. The proposal: position and capacity are different questions

**Position** is what the deck's order says, and stays structural:

- the **first** slide is what a grid or a feed shows as the piece;
- the **last** slide is the closing card, because a call to action that came
  third would not be one.

**Capacity** is what a slide holds, and becomes a property of the slide:

| capacity | today | proposed |
| --- | --- | --- |
| a picture (framing, develop, grade, collage) | any slide | unchanged |
| an **opener** | slide 1 only | any slide |
| a **badge** | slide 1 only | any slide, off by default |
| **shades** | slide 1 only | any slide |
| **text** | one caption, content slides only | any number, any slide |

Nothing about the trip's editorial rules changes: the badge still defaults to
the first slide and nowhere else, a new slide still arrives bare, and
`hookDefaultsFrom` still carries a look and never a picture.

## 5. The model change (v26, additive)

The collage precedent is the template — v24 added several pictures per slide by
making **cell 1 be the slide**, so every one-picture reader kept working. Same
move here: `PostBadge` stays exactly what the first slide holds, and `PostSlide`
gains four optional fields that start null.

```ts
interface PostSlide {
  // …everything it has today…
  /** An opener on this slide. Null draws the picture and nothing over it. */
  hook: HookLayer[] | null;
  /** Darkening over the picture, under the overlays. Empty by default. */
  shades: Shade[];
  /** This slide's own day signature, or null — see §6. */
  badge: SlideBadge | null;
  /** Free text over the picture. `caption` stays, drawn as element zero. */
  texts: OverlayElement[];
}
```

`SlideBadge` is deliberately **not** a second `PostBadge`: the picture half is
the slide's own already, and the placement half (`layout`, `pieceStyles`,
`cascade`) is the piece's signature. It is the words and the scale:

```ts
interface SlideBadge {
  mode: CounterMode;
  textOverrides: Partial<Record<BadgePiece, string>>;
  /** 1 is the piece's own badge; a chapter mark is ~0.36. */
  scale: number;
  durationSeconds: number;
}
```

On `OverlayElement`, two optional fields, absent meaning exactly what every
stored element means today:

```ts
/** One curated composite mode; absent is `source-over`. */
blend?: BlendMode;
/** A masked look; absent draws the letters normally. See §7. */
knockout?: { mode: 'wash' | 'punch'; color: string; alpha: number };
```

**Migration v25 → v26 changes nothing a stored trip draws**: every new field is
absent or null, and `slideRender` reading "no opener, no shades, no badge" for a
content slide produces byte-identical output to the branch it replaces. That
matters more than usual — a migration runs on trips living on a Winnow.

## 6. What `slide-render.ts` becomes

The branch stops being on `kind` and starts being on what the slide holds. Only
the closing card keeps a branch of its own, because it is a drawn card and not a
photograph:

```ts
if (slide.kind === 'cta') return ctaRender(trip, slide, aspect);

const badge = badgeFor(trip, post, slide);        // the piece's on slide 1, the slide's elsewhere, null when off
const hook  = slide.hook ? resolveHook(slide.hook, ctxFor(slide)) : null;
return {
  elements: [...badgeElements(badge), ...captionElements(slide), ...slide.texts],
  theme: trip.theme,
  shades: slide.shades,
  block: badge ? badgeBlockExtent(...) : null,
  hook,
  elementsAt: hookElementsAt(hook, ...),
  framing: slide.framing,
  …
};
```

Three consequences worth naming before they are met:

- **`hookContextFor` takes its timing from the slide**, not from `post.badge`:
  `durationSeconds` and `screenSeconds` become the slide's. `counterMode` comes
  from whichever badge the slide draws, and is `undefined` where it draws none —
  which the contract already allows, and which a variant that steps the numeral
  must already handle.
- **`deck-export.ts`'s settle line generalises.** It reads
  `slide.kind === 'hook' ? opts.timeSeconds : 0` today; it becomes "past this
  slide's own opener and its own collage", the rule
  `use-rail-thumbs.ts` already applies per cell.
- **`hookMoves` becomes per slide**, so `resolveSlideMedium` in `deck.ts` asks
  it for every slide instead of only the hook. An opener on slide 4 makes slide
  4 a video, and the export plan says so before the run — which is exactly what
  `export-plan.ts` exists for.

## 7. Masked text and blend modes

Two independent additions, both in `shared/overlay/`.

**Blend** is three lines in `drawOverlays`'s existing per-element
`save()/restore()`: `ctx.globalCompositeOperation = el.blend ?? 'source-over'`.
Because every surface goes through that one function, it reaches the stage, the
PNG deck, the burned-in clip and the Studio bridge at once. A curated list, not
the browser's full set — the ones that read over a photograph:

    multiply · screen · overlay · soft-light · difference · luminosity

**Knockout** cannot go on the main context, and this is the part that has to be
designed rather than discovered:

- `wash` — a colour over the frame with the letters removed from it, so the
  photograph reads only inside the type. Built in its **own buffer**: fill,
  `destination-out` the glyphs, composite the buffer over the frame. This is the
  pattern `drawGlowedText` already uses, and the reason is the same one recorded
  in that function's comment: a shadow is dropped under a `destination-*` mode.
- `punch` — the letters erased from the picture itself, down to the slide's
  ground. `destination-out` straight on the frame erases to **transparency**,
  which ships a PNG with holes in it and an MP4 with black ones. So the picture,
  the opener and the shades are painted into a buffer, the glyphs are erased
  from *that*, and the buffer is composited over the background fill
  `renderBadge` already lays down.

Both need `measureOverlays` to keep returning the glyphs' own boxes, so a click
on the stage still lands on masked type.

**What it costs**: one full-frame buffer per masked element per paint. The stage
repaints 60×/s while the transport plays, so the buffer is kept across frames
and keyed on (text, font, size, frame size) — the `maskCache` in
`draw-overlays.ts` is the existing shape for that.

## 8. What this deliberately does NOT do

**It does not merge `PostBadge` into `PostSlide`.** They are already near-twins
and the merge is the right long-term model — but it moves stored fields, touches
sixteen files, and would have to be judged on its own. Doing it inside this
change would mean a migration that *moves* data landing on remote trips at the
same time as a feature. One commit = one task.

**It does not add a stack of openers on ONE slide.** `HookLayer[]` was shaped
for it from the first version and `resolveHook` already resolves competing
frame-owners to the last one — but there is still no UI, and several openers in
one *piece* (the maintainer's actual ask) is served by several slides each
holding one. Nothing here forecloses the stack.

**It does not make a badge inherit.** A slide that gains a badge is a deliberate
act; `createPostSlide` starts it null, exactly as the develop and the grade do.

## 9. Open questions — the maintainer's, not the code's

1. **Does a badge belong on more than one slide at all?** The decision on record
   is that the badge's value is being *one* signature (`roadtrip.md`, "A badge's
   look belongs to the TRIP"), and a deck wearing five day-numbers would dissolve
   the dominant-numeral rule `day-badge.ts` is built on. The proposal's answer is
   a second rung — a **chapter mark**, the same elements at ~0.36 scale, opt-in
   per slide. It can also simply be refused, and the rest of this brief stands.
2. **Does the first slide keep the name "hook"?** If any slide can open, "hook"
   becomes a role rather than a place. The file names (`…-01-hook.png`), the
   picture key `'hook'`, the thumbs store and the editor's labels all say it
   today. Renaming is cheap in the UI and expensive in `develop-apply.ts` /
   `post-grade.ts`, whose keys are stored.
3. **Two masked modes or five?** `wash` and `punch` cover the looks; a longer
   list is a longer panel, not a better one.
4. **Do the trip's new-piece defaults carry a deck SHAPE?** "My carousels open,
   break at 4 and recap at 8" is a bigger habit than a look, and `HookDefaults`
   holds looks only.
5. **Which opener crosses the Studio bridge?** `hook-scene.ts` sends one scene
   per project. A piece with three openers has to name one, or the bridge has to
   grow — and its own comment ("a clip has one hook") stops being true.

## 10. Two constraints any implementation must respect

**The picture budget is per PIECE, not per opener.** `use-hook-pictures.ts`
gathers wants from one `layers` list and splits one budget across them
(`perPicturePixels(budgetCount(n))`). With openers on several slides the wants
have to be gathered **across the whole deck** and the budget split across all of
them, or three itineraries of twelve stops each decode thirty-six pictures at a
delivered frame's size. The hook already proves what that costs on a phone
(`media-pipeline.md`, the stage pixel budget).

**A sound bed belongs to the slide that plays it.** `HookRender.score()` is
offset from the opener's own zero, and each slide encodes separately today, so
nothing breaks. The **combined reel** (still open, `docs/roadtrip-export.md` §4)
would have to offset every bed by its slide's start — worth knowing before that
is built, not after.

## 11. Size

Five commits, one task each, in this order:

1. `PostSlide` gains the four fields + v26 + `trip-file.ts`'s four places; no UI.
2. `slide-render.ts` branches on capacity; `hookContextFor` takes slide timing;
   `hookMoves` per slide; `deck-export.ts`'s settle generalises. No UI, and the
   output of every existing trip is byte-identical.
3. The editor: the Opener, Shades and Badge sections stop being hook-only; the
   deck band's cells show which capacities a slide holds.
4. `OverlayElement.blend` + the curated list, in `drawOverlays` and `ElementPanel`.
5. `OverlayElement.knockout`, both modes, with the buffer and the mask cache.

Commits 1–3 deliver the maintainer's "several openers, several maps"; 4–5
deliver the note's second half. Either half can ship without the other.
