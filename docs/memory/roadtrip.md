# Road Trip — telling a journey, not editing a clip

Read before touching `src/tools/roadtrip/` or `src/shared/roadtrip/`, and before adding anything about publishing cadence, day badges or trip persistence.

## What the tool is for (2026-08-23)

**Decision.** The Studio answers "make this clip look right"; Road Trip answers "which day have I never told, and what goes out next". The maintainer came back from Australia in February 2026 and is telling that trip through 2026 from ~2 500 usable photos and about three and a half months of drone footage. The scarce resource is not editing time, it is **knowing what is left**. So the tool is a planning surface over a calendar, not a second editor. **How to apply**: a feature that helps produce a piece belongs in the Studio; a feature that helps decide *which* piece belongs here.

## The sharing strategy this encodes (2026-08-23)

**Decisions taken with the maintainer, so they are not re-litigated:**

- **Publishing out of chronological order is fine, and is the plan.** Reels are pushed by interest, not by profile order, and the profile grid is no longer the front door it was. Coherence comes from the **badge being visually constant**, not from posts arriving in sequence — which is what lets Australia, Brittany and current life alternate freely in one feed.
- **Re-telling the same day with different media is not penalised.** Nothing on the platform knows a day was already shown; only a near-identical *piece* posted twice close together is a real risk. Hence: vary the angle and format between two posts of one day, and space them out. This is why the grid counts and colours by intensity rather than flipping a day to "done".
- **Cadence: three to five pieces a week**, not daily — 2 500 candidates over a year does not need daily output, and daily output is what burns the run out before the trip is finished.
- **The "one year ago today" calendar is the editorial spine**, because it supplies a ready-made schedule; the grid exists to catch the days that spine skips.

## The model: trip → days → posts (2026-08-23)

**Decision.** A trip holds STAGES (places, each with their own span) and POSTS. There is deliberately **no stored day record**: a day is a calendar date inside the trip's span, derived on read (`tripCoverage`). Storing 310 empty rows to answer "which days have nothing" would be a second source of truth for something two subtractions already know, and it would have to be migrated every time a trip's dates are edited.

**A post is keyed by the DATE it tells, never by a file name.** The maintainer re-exports through Capture One and the Studio, so names, sizes and mtimes all change under him; the day a photo was shot does not. This was his explicit instruction and it is the load-bearing choice of the whole model. A post DOES carry a media reference (`TripPost.media`, a `SavedMediaRef`), but only as a hint for re-finding the file in the library: losing it costs the picture, never the post or its place in the trip, and the missing case is stated plainly rather than treated as an error. **How to apply**: any new tracking field hangs off the day or the post's date, never off a filename.

**A multi-day post occupies every day it spans** (`postDays`, clamped to the trip). "Days 27–29" tells three days, and the grid must show three days told — the grid's question is "has this day been told", not "how many posts start here".

**Stage overlap resolves to the LAST match** (`stageAt`): stages are kept in the order the trip was lived, so on a travel day the later stage is where you ended up, which is what a badge should name.

## Dates are calendar days, and the arithmetic runs in UTC (2026-08-23)

**Decision.** `IsoDate` is a plain `YYYY-MM-DD` string and every subtraction in `trip-days.ts` goes through `Date.UTC` / `getUTC*`, never a local `Date`. **Why**: the same rule `telemetry/time-format.ts` follows — parsing locally lets the *reading* machine's timezone move a value, so a trip planned in France and reviewed in Australia would disagree about which day a photo belongs to. UTC also has no DST, so stepping a day is one constant; a local-`Date` implementation lands on 30 March 2025 twice or skips it (both cases are tested). The one place a LOCAL reading is correct is `todayIso()` — "today" is the date on the wall behind the person, not an instant — and it is frozen into an `IsoDate` immediately.

**`parseIsoDate` refuses calendar impossibilities** (`2025-02-30`, `2025-02-29`) rather than letting `Date.UTC` roll them over. A trip whose end date silently moved by two days is worse than one that refuses to be created.

## The grid draws holes, so empty is a real cell (2026-08-23)

**Decision.** Every day of the trip is drawn whether or not anything came out of it, and the first and last weeks keep their real weekday shape (leading/trailing `null` padding in `heatmapWeeks`). **Why**: a trip starting on a Thursday must start three cells down, or the whole grid reads as the wrong weekday and the "I never post on Sundays" pattern the grid exists to reveal would be a lie.

**Five rungs, and they are the maintainer's question in order**: nothing here · drafted but never sent · sent once · twice · more. A drafted day must be visibly **not** an empty one (there is work sitting there) and just as visibly not a published one. Measured in the browser: the first pass used `#f6e6df` (the accent-wash token) for the drafted rung and it was indistinguishable from bare paper at 14 px — the ramp is now `#efe9dd · #f4cdbd · #eb9878 · #e26a45 · #d9442a`. Do not flatten it back toward the wash token for palette tidiness; the rung has to survive at cell size.

**The grid scrolls inside its own container.** 310 days is 45 columns, wider than most screens; the page itself must never scroll sideways (verified 0 px document overflow at 390 px and 1440 px).

## Storage: the studio's hand-rolled store, not Dexie, not SQLite (2026-08-23)

**Decision.** `trip-store.ts` mirrors `projects/project-store.ts` — hand-rolled IndexedDB, one database, one object store, migrate on read, degrade to no-op on failure. **Rejected in conversation, with reasons, so they are not re-proposed:** *SQLite* (wasm/OPFS) would embed a relational engine for a model that is one document per trip with no joins and no queries; *Dexie* was floated and the maintainer leaned toward it, but at implementation time the existing store turned out to be 100 lines and directly reusable, so a dependency would have bought ergonomics for schema work that does not exist here. If the model ever grows genuine cross-trip queries, revisit Dexie — not before.

**Its own database (`atelier-roadtrip`), not a second store beside the studio's**: the two documents have separate versions and separate migrations, and a schema bump on one must not force an upgrade transaction on the other.

`requestPersistentStorage()` stays exported from `project-store.ts` and is called by both tools — the grant is **origin-wide**, so whichever tool mounts first serves both.

## The badge is overlay ELEMENTS, not a second renderer (2026-08-23)

**Decision.** `badge-layout.ts` turns the badge's text into ordinary `text` `OverlayElement`s and hands them to `drawOverlays`. **Why**: `shared/overlay/` already places, styles, themes, glows and burns in text, in the preview and both export paths — so the badge inherits the four title-style presets for free and the engine never learns that trips exist. Same lesson as the studio's intro (`studio.md`): extend the element model, never add a parallel class of thing. `shared/roadtrip/` importing `shared/overlay/` is shared→shared and fine; the tool imports both.

**The content has FIVE pieces and the numeral is alone in one of them** (`day-badge.ts`): kicker · label · headline · counter · caption. The word ("Jour") is its own piece precisely so it can be set at a fifth of the numeral's size — folded into the headline it would be drawn at the same size and the badge would read as a phrase, which is the opposite of the maintainer's "one dominant number". `RATIOS` in `badge-layout.ts` keeps every other piece under a third of the headline, and a test asserts it.

**"Il y a 1 an" is a KICKER OVERRIDE, not a counter mode.** It answers "why is this going out now", a different question from "where in the trip is this"; as a mode it would have cost the day number its place as the headline. The two compose. It falls back to the trip's name under a year rather than announcing "0 ans" — `yearsBetween` counts on the calendar, so a 29 February anniversary lands on 1 March in common years (dividing by 365.25 lands either side by turns).

**A stage counter over a date outside every stage falls back to the day of the trip**, never invents a place. Same anti-fabrication line as the overlay palette and the battery gauge.

**The layout needs the frame's ASPECT**, because element `y` is a fraction of the height while `sizeFrac` is a fraction of the *shorter side*: on 9:16 a line of 0.17 covers 0.17 × 9/16 of the height. Stacking in raw `sizeFrac` spaces correctly on a square and pulls apart on a portrait frame — `heightFractionOf` is the one conversion, tested both ways.

## The badge's words are DATA, and English is only their default (2026-08-23)

**Decision.** The maintainer's instruction: "english by default, no need for french actually, give option to override text". So the fr/en enum is gone. The trip carries a `BadgeWords` record — six fields, English out of the box — and any single piece can additionally be replaced with free text per post (`PostBadge.textOverrides`). **Why this scope split**: the vocabulary is trip-wide (typing "Jour" 250 times is not an option), while "THE RED CENTRE" instead of the trip's name is a property of one post. A one-click Français button fills the six fields; it is a convenience, not a second built-in language.

**An empty override means "computed", never "blank".** Clearing the field has to give the derived value back, or an override would be a one-way door with no way to see the real number again. Tested.

**The v2 → v3 migration translates the retired enum into the vocabulary it stood for** rather than dropping it: a trip that was set to French keeps saying exactly what it said. A migration must never silently re-language published copy.

## A piece may depart from the trip's style, and departure is two moves (2026-08-23)

**Decision.** `BadgePieceStyle` (casing, ink, panel fill/radius/outline, animation) is applied in `badge-layout.ts` by writing the element's own value **and pinning exactly that key in `styleOverrides`**. Anything left unset stays fully themed, which is what keeps one preset change restyling the whole deck — the cascade in `title-styles.ts` already does the work, nothing new was invented.

**Casing is applied to the STRING, then `uppercase` is pinned off.** Setting the element's `uppercase` flag would let a theme that uppercases undo a deliberate lowercase; transforming the text and pinning the key is the only way round that survives a theme change. Tested both ways.

**An outline with no fill is a real look** — a hairline frame around the trip's name — so `borderColor` alone builds a `box` with a transparent fill rather than requiring a background first.

**Animation is the engine's own model, with no translation layer** (`shared/overlay/animation.ts`): the same fade / slide / scale / typewriter / wipe the studio's intro titles use, so a look authored on a badge means the same thing there. An animated piece is given `window = {start: 0, end: null}` — an animation needs a life to play inside, and a badge lives for the whole shot. `badgeSettleSeconds` is what a still defaults to, so a PNG is never caught mid-slide; it ignores exits deliberately (a still wants the badge settled, not gone).

## The engine's legibility box gained a radius and an outline (2026-08-23)

**Decision.** `LegibilityStyle` grew optional `radiusFrac`, `borderColor` and `borderWidthFrac`, and all four draw sites now go through one `paintLegibilityBox` helper. Before this each site hard-coded `pad * 0.5` and none could stroke. `radiusFrac` is a fraction of the PADDING and defaults to 0.5 precisely so every stored document keeps the exact shape it had. **How to apply**: the memory rule about `measureOverlays` still holds — the stroke sits on the box's own path, so half of it lies outside, and the grab box was widened by that half.

## The picture follows the Library selection (2026-08-23)

**Decision.** The badge composes over whatever is active in the shared Library sidebar (`useActiveAsset`), and the two stay in step both ways: opening a post activates its stored picture, and picking another asset in the sidebar re-points the post. **Why**: the maintainer asked for it by name to cut friction — a dropdown duplicating the sidebar is a second list to keep in sync by hand. **The trap to respect**: the restore must run only once and only after the library has loaded, and the record-back effect must be gated on it having run — otherwise the first render writes whatever happened to be active over the post's own choice.

## The temporal line replaced the anniversary boolean (2026-08-24)

**The complaint that caused it**: "one year ago today" fired on any date a year or more after the shot, so it announced an anniversary on days that were not one. That is the one thing this tool must not do. **Decision**: the boolean became a MODE (`time-ago.ts`) — off · auto · anniversary · years+months · months · weeks · days · since — and `anniversary` now fires only when the month AND day match. Every other mode says something true on any day, and `auto` picks the truest striking line for the gap on the day it is read. When a mode has nothing true to say it returns null and the trip's name comes back; the panel shows the ACTUAL line rather than describing it, so a mode that is silent is visible as silent.

**The reference day is an input, not `Date.now()`** (`PostBadge.referenceDate`, null = the real today). A post is composed before it goes out, and the line has to read correctly on the day it is published. This is also what makes the whole module testable without freezing a clock.

**Units are counted on the calendar, never by division** (`monthsBetween` beside `yearsBetween`): a month is not 30.44 days, and "1 month ago" turning over on the 30th of a 31-day month reads as wrong to the person who took the photograph. `quantity()` picks the noun by the number from a table, so a language whose plural is the same word ("mois") is a data problem, not a rule.

## The hook has a duration, and that is what makes exits work (2026-08-24)

**The bug**: out animations did nothing. Cause — `badge-layout` gave every animated piece `window = {start: 0, end: null}`, and the engine lays an OUT step against the window's END, so a null end left it nowhere to play. **Decision**: `PostBadge.durationSeconds` (default 4) is the hook's own life; a piece that EXITS gets `{0, duration}`, a piece that only enters keeps `{0, null}` so it does not vanish for no reason, and an unanimated piece gets no window at all. The transport loops over the duration when anything exits — you have to watch it leave.

## The picture gets treated, not the typography (2026-08-24)

**Decision.** `BadgeBackdrop` (vignette + scrim) is painted in `badge-render.ts` between the picture and the badge, never as overlay elements: it is full-frame, the engine has no such concept, and a scrim is a property of THIS picture rather than of the composition. The scrim runs either across the whole frame from the badge's own edge or confined to the hook zone (`gradientBand`, pure and tested), and the confined band is derived from `badgeBlockExtent` — the same numbers the layout uses — because a gradient that does not line up with the text it exists to lift is worse than none. **Why darken the picture rather than panel every line**: a bright sky exactly where the hook sits is the normal case, and doing it optically keeps the typography clean.

## Stages needed an editor before the place field meant anything (2026-08-24)

`stages` existed in the model from phase 1 but nothing could create one, so the place piece was always null, both stage counter modes always fell back, and the marker had nothing to mark. Adding the option without the editor would have shipped a control that could not do anything. **How to apply**: before adding an option that reads a field, check something can write it.

## The place marker is a geometric glyph, not an emoji (2026-08-24)

**Measured**: with "📍" as the default, the marker drew **nothing at all** in a Chromium with no colour-emoji font — it vanished silently. The default is `◆` (U+25C6): in every font, monochrome, so it takes the badge's own ink and glow, and it suits the house typography. It is a field, so anyone who wants the emoji types it. **The general rule**: a glyph the badge draws must survive a font stack we do not control — canvas text has no fallback chain we can see failing.

## A post is a DECK, and a reel is a deck of one (2026-08-24)

**Decision.** `TripPost.slides` holds the pictures after the hook; `deckSlides()` assembles hook → content → call to action. Nothing branches on `post.kind`: a single photo and a reel are the same model with one slide, which is what lets a piece be re-cut into a carousel without being rebuilt. The CTA is **not stored on the post** — it is appended at render time from `TripDoc.cta`, which is the whole point of editing it once.

**A CTA that says nothing is not appended**, even when the post asks for it: a blank last slide is worse than none.

**File names are `NN-hook / NN / NN-cta`, zero-padded to at least two digits** so a file listing is already in swipe order — tested, because `10` sorting before `2` would silently reorder a carousel on upload.

**Content slides carry no badge.** The counter has done its work on slide one; repeating it would stop the hook being a hook. A caption keeps the trip's font but pins `glow` and `legibility` off — the glow is the badge's signature.

## The QR is generated here, and it is verified by decoding (2026-08-24)

**Decision.** `shared/lib/qr.ts` is a hand-rolled encoder (byte mode, EC level M, versions 1–10). **Why not a library**: a card that fetched its own QR from a service would be the single place this suite phoned home, and the local-first line is the product. It is ~250 lines against a spec that has not moved since 2000 — unlike Dexie, it earns the code it costs.

**How it was made trustworthy, and how to keep it so**: the matrices are dumped from a throwaway vitest spec and decoded by `jsqr` installed in the SCRATCHPAD, never in the repo. 15 payloads across versions 1–10, UTF-8 accents and the 213-byte ceiling all round-trip, and the rendered CTA canvas itself is scanned back. Re-run that loop after any change to the encoder — unit tests alone cannot tell you a QR scans.

**The structural tests caught what decoding could not.** Reserving the format strip wrote over `(6,8)` and `(8,6)`, punching two holes in the timing lines a decoder uses to find the module grid; error correction hid it and jsqr still read the code. Index 6 is skipped on purpose now. **The lesson**: for a format with redundancy, a passing round trip is not proof of correctness.

**Refusing is part of the contract**: a link past 213 bytes returns null with a reason rather than a code that scans to half a URL. **Drawing**: modules are snapped to whole pixels and a four-module quiet zone is painted, because a QR on half pixels antialiases grey and one without a quiet zone is unreadable against a dark photograph.

## The overlay engine never wraps, so a sentence must be wrapped for it (2026-08-24)

**Measured**: the CTA's body ran off both edges of the frame. `drawOverlays` draws a text element as ONE line by design — right for a readout, wrong for a sentence. `shared/lib/wrap-text.ts` wraps onto a character BUDGET rather than a measured width, so it stays pure and testable; `charBudget` deliberately assumes 0.55 em per character against a real average nearer 0.5, because wrapping a word early is invisible and wrapping one late loses the words. Explicit newlines are kept, an over-long single word is left whole. **How to apply**: any new roadtrip text that is a sentence rather than a value goes through it, and the caption block grows UPWARD from its foot so two lines do not fall off the bottom.

## The default badge look is `neutral`, and that was measured (2026-08-23)

**Decision.** A new trip adopts the `neutral` preset (white, drop shadow). The first cut adopted `plein-cadre` on the reasoning that a badge is a signature — **wrong in the browser**: flat vermilion over warm footage all but vanishes, and warm footage is most of a desert road trip. A badge lands on a photograph nobody has vetted, unlike a studio overlay whose author is watching the clip; the default has to survive that.

**The signature comes from the theme being per TRIP, not from which preset it is.** Pick Or ciné or Pixel CRT once and every badge of the trip wears it — that is what makes a post recognisable in a feed out of order, which is the whole strategy. Per-post styling was rejected for exactly that reason.

**Preview and export are the same code at two sizes** (`badge-render.ts`): everything the render needs is a fraction of the frame, so only the canvas differs. Do not let them diverge — a badge that looks right at 480 px and lands differently at 1920 px is worse than no preview.

## `pickFiles` accepts photos now (2026-08-23)

The Library's "Add files" button filtered to `video/*,.srt` only, so a photo could reach the library through the folder picker or a drag but never through the button — with Photo EXIF, Compare and now Road Trip being photo-first, that was a dead end for half the suite. The accept list now covers every kind `classifyPart` recognises, camera RAW included (the OS dialog greys RAW out otherwise, and the library deliberately keeps handles the browser cannot decode).

## The trip's name is never displaced, and the WHEN line is its own piece (2026-08-24)

**Decision, from the maintainer directly.** The temporal line used to REPLACE the kicker, so switching the time panel on cost the badge the word "AUSTRALIA" — the one thing that makes a post recognisable in a feed out of order, which is the entire publishing strategy. `timing` is now a sixth `BadgePiece`, drawn last, under the place, at the smallest ratio (0.16): it explains why the post is going out today, which nobody has to read to recognise the post. The kicker is the trip's name, full stop. Adding the piece needed no document version — `pieceStyles` and `textOverrides` are `Partial` records.

## Never offer a fabricated example — show the real line or the reason (2026-08-24)

**Measured complaint**: three of the four counter modes "didn't work". They worked; they fell back to the day of the trip **in silence**, so clicking one changed nothing and said nothing — and the hints beside them ("Kalbarri · 2 · of 3") were invented values for a trip with no such stage. Same for the temporal hints ("1 year 4 months ago") and for "marker before the place", which appeared dead because no stage covered the day so there was no place to mark.

**The rule** (the overlay palette's, `studio.md`): a preview shows the REAL value or nothing. `counterPieces` now returns an `unavailable` sentence beside the pieces it fell back to; `counterPreviews` and `timeAgoPreviews` give each mode's actual line for the post in hand, or the reason there is none. Every option in the panel renders that line under its label. **How to apply**: any new mode, preset or option that can silently do nothing must say what it would do and why it cannot — a fallback the author cannot see reads as a bug in the tool.

`post.endDate` had no editor at all, which is why "Range of days" could never differ from "Day of trip". Before adding an option that reads a field, check something can WRITE it (the same lesson the stages editor taught).

## The day a piece tells is measured from the picture (2026-08-24)

Every number the badge draws is a subtraction from `post.date`, so a picture filed under the wrong day reads confidently wrong — a Brittany 2026 photo dropped into an Australia 2025 trip renders "day 261 of 310" and "9 months ago", both correct arithmetic about a day the picture has nothing to do with. `media-date.ts` reads EXIF `DateTimeOriginal` (falling back to `File.lastModified`, **labelled as the weaker source** because a copy or an export rewrites it), the editor shows it, offers to file the piece under it and calls out a date outside the trip's span. **It never rewrites a post on its own** — measuring is the tool's job, filing is the author's.

The EXIF date is read as written, never converted: EXIF has no timezone and the day a photo belongs to is the day it was where it was taken. That is the one deliberate exception to the trip's UTC rule.

**`exif-parser.ts` moved to `shared/exif/`** when Road Trip became its second consumer — a tool never reaches into another tool (the same move `StylePanel` made).

## The grid's hover card, the panel's own scroll, the day's thumbnails (2026-08-24)

Three asks from the same session, one theme — the tool has to be readable at a glance.

**The hover card is ours, not `title`.** The native tooltip waits about a second on the first cell, which is useless on a grid meant to be *swept*, and it cannot show the kinds. `DayCard` is `position: fixed` with coordinates from the cell's `getBoundingClientRect()`, clamped to the viewport and `pointer-events: none`. Fixed rather than absolute on purpose: the grid scrolls sideways inside its own `overflow-x-auto` box, so an absolutely-positioned card would be clipped by it or drift with its scroll. `aria-label` still carries the same sentence — the card is decoration, the label is the accessible name.

**The editor's panel scrolls by itself above 860px** (`overflow-y-auto` + `min-h-0` on the column, `overflow-hidden` on the section) so the badge stays in view while the folds are worked through — the studio's layout, same reason. **Below 860px the page scrolls as one**: a panel with its own scrollbar inside a scrolling page is a trap on a phone. Both breakpoints are CONTAINER queries (`@min-[860px]`), never viewport ones — the Library sidebar eats 288px the viewport cannot see.

**Each post keeps a thumbnail of its hook**, in a second object store (`thumbs`) of the roadtrip database, keyed by post id — apart from the documents because they are the only heavy values and a trip doc is read on every gallery render. It is a picture of the BADGE, not of the raw media: what you need to recognise a day you last touched in March is what you already made of it. **It is drawn at the piece's own orientation** — fixed height, natural width, no letterbox and no crop — because the shape of a piece is half of what identifies it in the list; a fixed box cropping 16:9 and 9:16 to the same rectangle hid the one thing the picture was for. The stage takes it (`BadgeStage.onRendered` → `canvasThumbnail`), debounced 700ms — the stage repaints on every animation frame of the badge's transport, and writing each one would be an IndexedDB write per frame. It is a cache: losing it costs a row its picture, never the post. **Prune on delete** (`deleteThumbs`), for a post and for a whole trip; nothing else ever will.

## The hook burns in through the Studio's pipeline, not a second exporter (2026-08-24)

**Decision.** "Export hook video" hands the badge's own `OverlayElement[]` to `exportVariantVideo` — the Studio's WebCodecs export — with no LUT and no cues. Nothing about decoding, cover-cropping, cadence or muxing is re-implemented; `shared/roadtrip/hook-video.ts` only decides WHICH slice goes out and under what name, and `hook-video-export.ts` makes the call (same pure/DOM split as `deck.ts` / `deck-export.ts`).

**The clip starts on the frame the author scrubbed to**, as a trim in point. That is not a convenience: `DrawOptions.originSeconds` is the trim's start, so the badge's windows count from the first EXPORTED frame and the entrance lands on frame one. Export the whole rush instead and the entrance has already happened somewhere in the middle. `hookRange` returns null when the whole clip goes out, which the pipeline reads as "no trim" and origin 0 — correct, not a fallback.

**The scrim and vignette needed a hook in the shared pipeline.** They are painted between the picture and the overlays, and `exportVariantVideo` had nowhere to do that, so `VariantRenderOptions` gained `paintUnderOverlays?(ctx, w, h)` (unset by the Studio) and `paintBackdrop` was exported from `badge-render.ts` with a context type widened to include `OffscreenCanvasRenderingContext2D`. A gradient that showed in the PNG and vanished in the reel would be a different picture.

**The hook's LENGTH is session state, not part of the document.** It is derived from the badge's own hold (`defaultHookSeconds` = duration + a beat) and clamped to the clip in hand by `hookSecondsWithin`, so the read-out never claims 5s over a 3s clip. A length is an export choice; storing it would have cost a document version for nothing.

**MP4 and MOV only, said in words.** The pipeline demuxes MP4 boxes; a WebM produced mp4box's own "Invalid data found while parsing box of type…", accurate and unreadable. `hookSourceProblem` refuses first with a sentence naming the file and reminding that the PNG export still works. **Unverified end to end**: this container's Chromium reports `avc1.*` unsupported by `VideoEncoder` (vp8/vp9 only), so no H.264 encode can be driven here — the UI, the guard and the arithmetic were checked in the browser, the encode was not.

## Only the middle of a deck reorders (2026-08-24)

Dragging a slide moves it within `post.slides` (`moveItem` in `deck.ts`, pure and clamped: a drop past the end plainly means "put it last"). The hook and the call to action are not draggable — their positions are structural, and a CTA that came third would not be one. The strip carries deck indices while `post.slides` is content-only, so the handler translates (`ci = i - 1`); getting that wrong silently reorders the wrong slide. Drag is paired with Earlier / Later buttons in the slide panel: HTML5 drag is unreachable by keyboard and undiscoverable on a first look.

## Open, and decided but not built (2026-08-23)

- **The `.roadtrip.json` export is the safety net the maintainer asked for by name** — he expects to pull a JSON out weekly so a cleared IndexedDB cannot cost him a year of tracking. Follow `projects/project-file.ts` exactly (portable half only, `{ok:false, error}` parsing, refuse a file from a newer version). Agreed shape of the reminder: a **discreet banner** ("last export 12 days ago"), never a blocking prompt. Not built.
- **The three visual directions drawn in the design pass were never formally chosen.** They now exist as the four title-style presets in the Style picker (the studio's own `StylePanel`, moved to `shared/overlay/` when Road Trip became its second consumer), so the choice is one click rather than a code change — but he has not said which one is the signature.
- **Carousels are a later phase**: a post becomes an ordered list of slides with a role (intro / content / CTA), and the closing call-to-action slide is a **single global template edited once** (his choice), reinjected automatically — not re-authored per post. For a reel the hook rides the Studio's existing intro *scene* rather than a new mechanism, and the CTA stays a separate end card rather than being baked into the export.
- **Time Machine** (an animated counter winding back to the media's day) and an API into his own geolocated media-triage system are wanted but explicitly last: both were discussed as "after the rest works".
- Element positioning is **not** fixed to a corner — he rejected a pinned top/side badge; placement is free, which is what the shared overlay engine already gives.
