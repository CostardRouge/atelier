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

## A stage is a LEG, and its places are an ordered list (2026-09-03)

**Decision, taken with the maintainer.** A stage carries `places: TripPlace[]` — a name, a region, optional `{lat, lon}` — **in the order they were lived**. He asked for "un lieu de début et un lieu de fin" and answered his own question in the asking: *"toujours une collection, mais on prendra le début et la fin en fonction du besoin"*. So `stageStart`/`stageEnd` are `places[0]` and the last (`trip-places.ts`), never two stored fields. **Why**: the same rule that keeps a trip's 310 days derived from two dates — a second copy of a fact is a second thing to migrate and a second thing to get wrong. With one place, start and end are the same place, which is the truth: you did not go anywhere.

**A place carries NO dates.** The stage is the dated unit; a place is a point inside it. "Uluru on the 12th" inside a nine-day leg means splitting the leg. A dated place would be a stage under another name, and `stageAt` would then have two things to listen to.

**`stage.name` empty = computed, never blank** — the `textOverrides` rule again. Empty derives "Perth → Cairns" from the two ends; a typed name always wins; clearing it gives the derived label back. `stageRegionLabel` derives only the region the places **agree** on: Perth and Cairns have no common region, and printing either would be a quiet lie about the other. The whole derivation is `trip-places.ts`, pure and tested; `day-badge.ts` reaches it in two lines and still refuses to invent a place when a stage names none.

**The separator is `→` (U+2192), not an emoji** — the same measured rule as the `◆` marker below: this string is drawn on a canvas through a font stack we do not control, and `📍` drew *nothing at all* where no colour-emoji font existed. A test pins the glyph.

**The New trip modal's "Destination" became "From" / "To"**, one row, so it did not grow — the maintainer said explicitly *"je ne veux pas alourdir la modale de départ"*, and the old free text was already trying to be a route ("Australia — Perth to Cairns") that nothing could read. Filled, they seed **one stage covering the whole trip**, unnamed so its label derives. **Know the side effect**: that stage makes `stageAt` answer for every day, so the default badge's caption goes from empty to "Perth → Cairns" and the stage counters stop falling back. Nothing is false — it is the trip's route — but it only happens to a trip whose author filled the fields, and empty fields seed **nothing**, keeping the old behaviour exactly. `trip.destination` survives as the prose subtitle, composed from the two ends at creation.

## A Winnow chapter and a stage are the same object — seed, never sync (2026-09-03)

**Anticipated, nothing built.** Winnow is growing a **timeline**: media grouped into chapters by place and by date, with exports taken on a segment. That is `TripStage` reached from the media side — a span plus its places in lived order — so the trip model needs no invention. The full brief, with the field-by-field mapping, the API Atelier needs the spec to answer, the traps and the phases, is **`docs/winnow-timeline.md`**; it is a companion to `docs/winnow-bridge.md` and every claim about Winnow's side in it is marked as an assumption.

**The four rules it fixes, so they are not re-litigated when the spec lands**: a timeline is a FACT about media and a trip is a DECISION about telling it, so **an import creates stages and never posts** — a pre-filled calendar destroys the holes the grid exists to show; re-running an import is a **diff the author accepts leg by leg**, never a sync (two moving documents with one shape is the sync engine `winnow-bridge.md` ruled out twice); Atelier writes back in **Winnow's nouns** (asset, chapter, place), never its own, so Winnow learns a chapter has been told by *receiving the finals*, not by being told about a trip; and a chapter id is a hint for the next reconcile, never a pointer the trip dereferences — a seeded trip must open with the instance switched off.

**The gap this uncovered**: phase 0.5 put `sourceId` on `ProjectDoc` (v14) and **not on `TripDoc`** — verified, there is none anywhere under `src/shared/roadtrip/`. Invariant 2 ("a document belongs to exactly one source") is half-enforced, on the document the timeline work is about to make remote-flavoured.

**The trap to carry into any date mapping**: take Winnow's `capture_date` as the day, **never recompute it from `captured_at`** in the browser. A clip shot at 07:00 in Perth is the 12th on the wall behind the photographer and the 11th in UTC, and `trip-days.ts` subtracts in UTC by design — recomputing walks a third of a trip back a day.

## Place search is online, opt-in, and never as-you-type (2026-09-03)

**A product decision the maintainer took deliberately**, against a codebase whose `TripStage.region` comment read *"never geocoded — nothing leaves the machine"* and whose README promised "one network exception". He was told that and chose the search anyway; the callout is now two exceptions and `local-first.md` carries the full terms. **Do not re-litigate it, and do not quietly widen it either.**

The shape it was given, which any future network feature should copy: the client lives in `shared/map/geocode.ts` beside the tile URL (one folder to audit); the consent flag lives in `localStorage`, **never on `TripDoc`** — an exported `.roadtrip.json` must not carry someone else's consent to another machine; URL-building and response-parsing are pure and tested (a test asserts the *entire* URL, so what would leave the machine is visible in the diff); and the search fires on **Enter or the button only**. That last is not an ergonomic choice: Nominatim caps callers at one request a second and a browser cannot send an identifying `User-Agent`, so one deliberate gesture per request is the only polite reading — and it keeps what leaves to what the author chose to send.

**The feature must stay a convenience.** Every place is typable by hand, `coords` is nullable everywhere, and no panel is disabled when the pref is off. If a future change makes the search load-bearing, the local-first claim quietly becomes false.

**Unverified against the live service, deliberately recorded.** This container's network policy cannot reach `nominatim.openstreetmap.org` (`curl` returns HTTP 000), so the round trip was never run for real. What *was* checked in the browser: the exact URL sent, that nothing leaves while the pref is off, that typing never fires a request even once it is on, and — through a stubbed route carrying a real `jsonv2` body — that the parsing, the result list and picking a candidate all work. The four failure paths (unreachable, 503, 429, empty) each report a sentence naming what happened and that typing by hand still works; a bare "Failed to fetch" reached the UI on the first cut and was fixed. **What a future agent should do on a machine with the network**: run one real search and confirm the shape still matches, since the fixture is built from the documented API rather than from a captured response.

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

## Scrubbing seeks the open clip; it never re-decodes it (2026-08-24)

**The trap, measured**: `BadgeStage`'s decode effect listed `videoTimeSeconds`, so every nudge of the frame picker tore the `<video>` down (`removeAttribute('src')`, `load()`, `revokeObjectURL`) and built a new one. Choosing a hook frame stuttered and flashed "decoding…" the whole way across. `BadgeSource` now carries an optional `seek(seconds)`; the decode effect depends on the FILE alone and a second effect seeks the element that is already open.

**The paint has to wait for the frame.** Repainting on `videoTimeSeconds` would draw the OLD frame, since the seek has not landed. A `frameSeq` counter is bumped when the seek resolves and the paint depends on that. **Always clamp a seek short of the end**: past the last frame `seeked` never fires, and the preview simply stops updating.

## The hook's frame is chosen on a filmstrip, not a number (2026-08-24)

A slider makes you scrub blind — nudge, look up, nudge again. `FrameStrip` draws the clip as a strip of stills and you point at the moment (`filmstrip.ts` is the pure half: how many cells, which moments, where a time sits).

**A cell is sampled at the MIDDLE of its slice**, never its left edge: the edge puts cell one on frame zero, which on a drone clip is the props spinning up, and leaves the last slice unrepresented. **Frames arrive through `onFrame` one at a time** so the strip fills in instead of staying blank until the last decode lands, and **one video element is seeked from moment to moment** — one element per thumbnail is how a dozen frames become a second of stutter. **The drag is throttled to one change per animation frame**, the rate the preview can repaint; per pointer event queues seeks the element never catches up with. Every thumbnail blob URL is revoked on unmount.

## Where you are lives in the ROUTE (2026-08-24)

`#/roadtrip/<trip>/<day>/<piece>`, any tail of which may be absent (`trip-route.ts`, pure and tested). It was component state, and coming back from a piece dropped you on the trip's FIRST day — a real loss on a 300-day trip, every time. The route also survives a reload and makes a day linkable.

The trip's part is `<slug>-<first 8 of its id>` (`australia-d1060760`): the slug is there to be read and is ignored on resolve, so renaming a trip cannot break a link and two trips called "Australia" stay distinguishable. A malformed day drops itself AND everything after it — half a route (a piece under a nonexistent day) is worse than none.

## A panel that belongs to the PIECE must not be hidden behind a slide (2026-08-24)

The Studio bridge and the per-kind defaults were rendered inside the hook-only branch, so opening a carousel's second slide made them vanish — and the maintainer reported both features as missing. **How to apply**: before putting a control inside `isHook`, ask whether it is about the SLIDE (its picture, its caption, the badge's own styling) or about the PIECE (its name, its link, the trip's defaults). Only the first belongs there.

## The whole row opens the piece (2026-08-24, rev. 2026-08-25)

A list you sweep through should not make you aim at a 38px thumbnail or a small button. The row is a `div` with `role="button"` (a real `<button>` cannot contain the buttons the row already holds), and **every control inside it stops propagation and prevents default** — without that, marking a piece published also opened the editor and the action was lost behind the screen change. Duplicating carries the look and the slides but never the publication, the Studio link, or any id (piece, slide or shade): two documents sharing an id is how a list starts editing the wrong row.

**The secondary actions are ICON buttons, opening is a filled pill** (maintainer ask, 2026-08-25): ⧉ duplicate · ✓ publish-toggle (accent-washed while published) · × delete, each a small round glyph button carrying its full name in `title`/`aria-label`, plus an ink "Open" pill — three words of button chrome per row drowned the titles the list exists to scan. Delete keeps its inline two-step confirm; only the trigger shrank. The pill does not replace the whole-row gesture, it makes it visible — and it stops propagation like everything else, or `onOpen` fires twice through the bubble. Glyphs are DOM text (full font-fallback chain), so the canvas glyph rule above does not bind here.

## The bridge to the Studio: the hook is sent as an intro SCENE (2026-08-24)

**Decision, taken with the maintainer after weighing three options.** His real workflow was: grade + telemetry in the Studio, badge in Road Trip, two files joined on a phone. Rejected: concatenating a hook clip and the footage (a multi-source export, an audio-timeline problem, and the pre-roll he had already deferred), and having Road Trip's own exporter borrow the project's LUT (two exporters doing one job, guaranteed to drift). **Chosen: Road Trip briefs the Studio.** A post carries `projectId`; `hook-scene.ts` translates the badge into a `roadtrip-hook` scene plus its elements; ONE Studio export then carries grade, telemetry and hook. This also answers "can Road Trip pick a LUT" — it does not need to, the Studio already grades.

**Two rules make sending repeatable**: everything injected is prefixed `roadtrip:` and belongs to the one scene, so a send REPLACES the last one instead of stacking a second badge; and nothing else in the project is touched — grade, trim, telemetry elements and the author's own intro all survive. Unlinking removes the hook again rather than leaving one nobody can edit.

**The shades do not cross over, and that is said in the panel.** A scene scrim is one flat colour at one opacity; a gradient's *shape* cannot be expressed. `scrimFromShades` takes the strongest shade's colour and 60% of its strength (a full-frame veil reads far heavier than the same number in a gradient that clears half the frame). Turning a bottom gradient into a full veil silently would be a different picture.

**The closing card crosses the same bridge, as the project's OUTRO (2026-08-25).** When the piece closes with the CTA (`post.includeCta`), a send translates `TripDoc.cta` through the same `ctaLayout` the carousel's last slide uses into the Studio's `ProjectDoc.outro` (`ctaOutro`/`withCtaOutro` in `hook-scene.ts`), laid out for the piece's own frame — so the reel's appended end card and the carousel's PNG are the same card. Same discipline as the hook: `roadtrip:`-prefixed elements, resend replaces, unlink removes, unticking the CTA takes a sent card back out. **An outro the author composed THEMSELVES in the Studio is never overwritten** — "nothing else in the project is touched" covers their outro; `withCtaOutro` returns null and the panel says the card stayed here. The QR crosses as its URL (re-encoded Studio-side), the inks as the CTA's own.

**Handover route**: `#/studio/open/<id>` opens a project and rewrites itself to `/studio` on arrival, so a reload does not re-run the open and Back does not bounce. It exists so neither tool reaches into the other's state.

**Trap**: creating a project with a media ref but no directory handle greets a brand-new project with "1 media file not in this folder" — `reconcileMedia` runs whenever `media.files` is non-empty and finds nothing. A project created from Road Trip records NO media; the clip is already in the shared Library, which is where the Studio picks it up.

## A trip remembers the look it gives a new piece (2026-08-24)

`TripDoc.hookDefaults` keeps, per post kind, everything about how a hook is composed — frame, placement, shades, per-piece styling, counter mode, temporal mode. Saved from a piece by hand, never inferred, and empty until asked for: a default nobody chose is another factory setting. What belongs to one day is never inherited (reference day, the clip's frame, the author's own text overrides) — that distinction is the whole point of the feature, and `defaultPostBadge` enforces it.

## One stack of SHADES, not a vignette control and a scrim control (2026-08-24)

**Decision, with the maintainer.** The two were the same thing seen twice — a gradient of some colour, anchored somewhere, reaching some distance — and keeping them apart cost every combination that actually comes up (a wash from the left AND a vignette; a band clear at the top edge and dark at mid-frame) and left the vignette locked to black. `shades.ts` replaces both: up to four layers, each a DIRECTION (four edges, two middle bands, radial), a reach, a strength, a colour, an `invert` flag, and `followHook`.

**`invert` is not "pick the opposite edge".** `top` reaching 0.5 inverted is clear at the top and dark at mid-frame; no un-inverted shade draws that. It is the case the maintainer asked for by name — a portrait frame whose text sits in the middle.

**`followHook` keeps the old "under the hook" behaviour**: a linear shade lands on the badge block's own edge (with a margin of the block's height, so the fade clears the first line), a radial centres on the block. A scrim that moves with the text it protects beats one placed by eye, which is why it survived the merge.

**Trap, measured in the browser**: a middle band drawn as centre→edge blacks out the whole far half — a canvas gradient holds its end colour past its endpoints. A band must run EDGE TO EDGE with the peak at 0.5 (`stopsFor(..., mirrored)`). The unit tests assert the stop shape, and the browser check samples five points of the real canvas per direction; the pure geometry alone would not have caught it.

`shadeGradient` returns the gradient in FRACTIONS of the frame (radii against the SHORTER side, so a radial stays a circle on 9:16) and `paintShades` is a dumb translation into pixels — the same split that keeps the burn-in and the PNG identical.

## Never read a canvas's size before an await and draw after it (2026-08-24)

**Measured**: a miniature badge stayed burnt into the corner of the stage. `renderBadge` read `canvas.width/height`, awaited the fonts, and drew — while a newer render had resized the canvas in between. The stale call painted at the OLD scale over the new frame. The trigger was `BadgeStage`'s decode effect painting an empty frame into a canvas it never sized (300×150, the element default), but any caller could have caused it.

**How to apply**: the font wait is now the FIRST thing `renderBadge` does; everything after it is synchronous, so two overlapping renders each draw a complete, self-consistent frame and the last one simply wins. The general rule: in an async paint, read the surface's dimensions AFTER the last await, never before.

## The grid's hover card, the panel's own scroll, the day's thumbnails (2026-08-24)

Three asks from the same session, one theme — the tool has to be readable at a glance.

**The hover card is ours, not `title`.** The native tooltip waits about a second on the first cell, which is useless on a grid meant to be *swept*, and it cannot show the kinds. `DayCard` is `position: fixed` with coordinates from the cell's `getBoundingClientRect()`, clamped to the viewport and `pointer-events: none`. Fixed rather than absolute on purpose: the grid scrolls sideways inside its own `overflow-x-auto` box, so an absolutely-positioned card would be clipped by it or drift with its scroll. `aria-label` still carries the same sentence — the card is decoration, the label is the accessible name.

**The stage takes the height it is given** (`flex-1 min-h-0` down the column, `max-h-full` on the canvas — both max constraints apply, and a replaced element honours them proportionally, so it fills the box without distorting). The 62vh cap is kept only for the STACKED layout, where the page scrolls and an unbounded picture would push the transport off a phone. **The editor's panel scrolls by itself above 860px** (`overflow-y-auto` + `min-h-0` on the column, `overflow-hidden` on the section) so the badge stays in view while the folds are worked through — the studio's layout, same reason. **Below 860px the page scrolls as one**: a panel with its own scrollbar inside a scrolling page is a trap on a phone. Both breakpoints are CONTAINER queries (`@min-[860px]`), never viewport ones — the Library sidebar eats 288px the viewport cannot see.

**Each post keeps a thumbnail of its hook**, in a second object store (`thumbs`) of the roadtrip database, keyed by post id — apart from the documents because they are the only heavy values and a trip doc is read on every gallery render. It is a picture of the BADGE, not of the raw media: what you need to recognise a day you last touched in March is what you already made of it. **It is drawn at the piece's own orientation** — fixed height, natural width, no letterbox and no crop — because the shape of a piece is half of what identifies it in the list; a fixed box cropping 16:9 and 9:16 to the same rectangle hid the one thing the picture was for. The stage takes it (`BadgeStage.onRendered` → `canvasThumbnail`), debounced 700ms — the stage repaints on every animation frame of the badge's transport, and writing each one would be an IndexedDB write per frame. It is a cache: losing it costs a row its picture, never the post. **Prune on delete** (`deleteThumbs`), for a post and for a whole trip; nothing else ever will.

## The hook burns in through the Studio's pipeline, not a second exporter (2026-08-24)

**Decision.** "Export hook video" hands the badge's own `OverlayElement[]` to `exportVariantVideo` — the Studio's WebCodecs export — with no LUT and no cues. Nothing about decoding, cover-cropping, cadence or muxing is re-implemented; `shared/roadtrip/hook-video.ts` only decides WHICH slice goes out and under what name, and `hook-video-export.ts` makes the call (same pure/DOM split as `deck.ts` / `deck-export.ts`).

**The clip starts on the frame the author scrubbed to**, as a trim in point. That is not a convenience: `DrawOptions.originSeconds` is the trim's start, so the badge's windows count from the first EXPORTED frame and the entrance lands on frame one. Export the whole rush instead and the entrance has already happened somewhere in the middle. `hookRange` returns null when the whole clip goes out, which the pipeline reads as "no trim" and origin 0 — correct, not a fallback.

**The scrim and vignette needed a hook in the shared pipeline.** They are painted between the picture and the overlays, and `exportVariantVideo` had nowhere to do that, so `VariantRenderOptions` gained `paintUnderOverlays?(ctx, w, h)` (unset by the Studio) and `paintBackdrop` was exported from `badge-render.ts` with a context type widened to include `OffscreenCanvasRenderingContext2D`. A gradient that showed in the PNG and vanished in the reel would be a different picture.

**The hook's LENGTH is session state, not part of the document.** It is derived from the badge's own hold (`defaultHookSeconds` = duration + a beat) and clamped to the clip in hand by `hookSecondsWithin`, so the read-out never claims 5s over a 3s clip. A length is an export choice; storing it would have cost a document version for nothing.

**MP4 and MOV only, said in words.** The pipeline demuxes MP4 boxes; a WebM produced mp4box's own "Invalid data found while parsing box of type…", accurate and unreadable. `hookSourceProblem` refuses first with a sentence naming the file and reminding that the PNG export still works. **Unverified end to end**: this container's Chromium reports `avc1.*` unsupported by `VideoEncoder` (vp8/vp9 only), so no H.264 encode can be driven here — the UI, the guard and the arithmetic were checked in the browser, the encode was not.

## Only the middle of a deck reorders (2026-08-24)

Dragging a slide moves it within `post.slides` (`moveItem` in `deck.ts`, pure and clamped: a drop past the end plainly means "put it last"). The hook and the call to action are not draggable — their positions are structural, and a CTA that came third would not be one. The strip carries deck indices while `post.slides` is content-only, so the handler translates (`ci = i - 1`); getting that wrong silently reorders the wrong slide. Drag is paired with Earlier / Later buttons in the slide panel: HTML5 drag is unreachable by keyboard and undiscoverable on a first look.

## The trip file is a BACKUP, not a template (2026-08-31)

**Decision.** `shared/roadtrip/trip-file.ts` writes a whole trip to `.roadtrip.json`, and it deliberately does **not** copy the studio's split. A project file carries a *portable half* — a template you can mail. A trip has no such half: its stages, the days it has told, the words its badges say and the look they wear ARE the trip. So the file carries everything except what is meaningless in another browser: the trip `id` (a fresh one is minted, so importing the same file twice gives two trips instead of silently overwriting one), the timestamps, and each post's `projectId`, which addresses a Studio project in *this* store and would otherwise dangle as an "Open in Studio" that opens nothing. Post thumbnails live in their own IndexedDB store and are re-baked from the preview, so they never travel.

**Media refs DO travel**, and that is the point: since they carry a content hash (`studio.md`, «Media identity»), a trip opened elsewhere finds its pictures again in a folder whose files have been renamed or re-graded. This is how a trip crosses from one source to another (`docs/winnow-bridge.md`, invariant 2).

**How to apply.**
- Everything else follows `projects/project-file.ts` exactly: a `kind` marker so a stray `.json` is rejected, `{ ok: false, error }` parsing that never throws and always says something actionable, and a file from a **newer** version refused rather than half-read.
- Reading replays `migrateTripDoc` over a document built from `createTripDoc`, so an older file lands on the current shape exactly as an older stored trip does, and anything a past version never wrote gets the same default a new trip gets. Add a field to `TripDoc` → it is carried and defaulted by that path, with nothing to edit here.
- `projectId` is stripped **twice** — writing and reading — because a hand-edited file could smuggle one in.
- Import always creates a NEW trip. Merging two trips is not offered, on purpose.
- Export sits on the gallery card, import in the gallery header — the same places the studio puts them.

## A trip belongs to exactly one source, and the file never says which (2026-09-06)

**Decision.** `TripDoc.sourceId` (v10) names where a trip is KEPT — `'local'` or a connected Winnow's host — closing the gap phase 0.5 left when only `ProjectDoc` got the field. The migration files every older trip under `local`, the only place it could have been. It is the **bound half**: `TripPortable` lists it in its `Omit`, `tripDocFromFile(file, now, sourceId)` gives an imported trip to the source that imports it, and a `sourceId` smuggled into a file is ignored (tested). **Trap**: `TripPortable` is `Omit<TripDoc, …>`, so a new `TripDoc` field lands in `.roadtrip.json` automatically unless the `Omit` is widened — list anything bound to one browser or one instance.

**The gallery groups by source even with one group** (`groupBySource`, the studio's shape), and the New-trip modal's "Keep on" picker is rendered **only when more than one source can hold documents** — the maintainer does not want that modal to grow, and a picker with one option is a question with no choice. `documents` comes from the instance's capabilities snapshot, so a Winnow without the bucket (P2 not deployed) never appears in it. The full design — remote flush on idle, the mirror/etag rule, the Winnow side — is `docs/roadtrip-persistence.md`.

## The mirror's bookkeeping is a reducer beside the document, never on it (2026-09-06)

**Decision.** A remote trip's distance from the authority lives in a `SyncRecord` (`trip-sync.ts`, IndexedDB store `sync`, DB v3) — etag, `dirtyAt`, status, the server's copy behind a conflict — and every transition is `reduceSync(record, event)`, pure and tested state by state. **Why beside**: on `TripDoc` it would leak into `.roadtrip.json` and onto the wire; a sibling row keyed by the trip id costs nothing. **Why durable**: `dirtyAt` surviving a closed tab is the entire crash story — the next open on that device pushes the edit; there is no `keepalive` fetch on unload (64 KB body cap, a trip can exceed it).

**Rules the reducer encodes, so a driver never re-decides them**: the idle clock counts from the LAST edit; an edit during an in-flight push leaves the record dirty after `pushOk` (`pushStartedAt` is what tells); `offline` and `unauthenticated` retry on every trigger (only trying can tell the network or the session is back); `forbidden`, `conflict` and `gone` HOLD until a person acts and an edit does not move them; a `protocol` failure keeps the edit dirty with the message. `pillText` is the honesty rule again — every status yields the sentence the pill prints, with the conflict's time in the reader's own clock. The client side is `WinnowClient.listDocs/getDoc/putDoc/deleteDoc` (`architecture.md`, «Remote sources»): 304 is an answer, 404 is `notfound` (never forbidden — a foreign row's existence is not revealed), 412 is `conflict` carrying the server's etag, and the body cap is checked BEFORE a PUT so an oversize trip is refused with a sentence rather than a 413.

## Open, and decided but not built (2026-08-23)

- **The export-reminder banner is still unbuilt.** The `.roadtrip.json` file itself now exists (see below); what is missing is the nudge the maintainer asked for — a **discreet banner** ("last export 12 days ago"), never a blocking prompt, so a cleared IndexedDB cannot cost him a year of tracking.
- **The three visual directions drawn in the design pass were never formally chosen.** They now exist as the four title-style presets in the Style picker (the studio's own `StylePanel`, moved to `shared/overlay/` when Road Trip became its second consumer), so the choice is one click rather than a code change — but he has not said which one is the signature.
- **Carousels are a later phase**: a post becomes an ordered list of slides with a role (intro / content / CTA), and the closing call-to-action slide is a **single global template edited once** (his choice), reinjected automatically — not re-authored per post. For a reel the hook rides the Studio's existing intro *scene* rather than a new mechanism. ("The CTA stays a separate end card" was revisited 2026-08-25: on a reel it now crosses the bridge as the Studio's appended outro — see the bridge entry.)
- **Time Machine** (an animated counter winding back to the media's day) and an API into his own geolocated media-triage system are wanted but explicitly last: both were discussed as "after the rest works".
- Element positioning is **not** fixed to a corner — he rejected a pinned top/side badge; placement is free, which is what the shared overlay engine already gives.
