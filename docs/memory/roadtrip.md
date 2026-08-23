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

## The default badge look is `neutral`, and that was measured (2026-08-23)

**Decision.** A new trip adopts the `neutral` preset (white, drop shadow). The first cut adopted `plein-cadre` on the reasoning that a badge is a signature — **wrong in the browser**: flat vermilion over warm footage all but vanishes, and warm footage is most of a desert road trip. A badge lands on a photograph nobody has vetted, unlike a studio overlay whose author is watching the clip; the default has to survive that.

**The signature comes from the theme being per TRIP, not from which preset it is.** Pick Or ciné or Pixel CRT once and every badge of the trip wears it — that is what makes a post recognisable in a feed out of order, which is the whole strategy. Per-post styling was rejected for exactly that reason.

**Preview and export are the same code at two sizes** (`badge-render.ts`): everything the render needs is a fraction of the frame, so only the canvas differs. Do not let them diverge — a badge that looks right at 480 px and lands differently at 1920 px is worse than no preview.

## `pickFiles` accepts photos now (2026-08-23)

The Library's "Add files" button filtered to `video/*,.srt` only, so a photo could reach the library through the folder picker or a drag but never through the button — with Photo EXIF, Compare and now Road Trip being photo-first, that was a dead end for half the suite. The accept list now covers every kind `classifyPart` recognises, camera RAW included (the OS dialog greys RAW out otherwise, and the library deliberately keeps handles the browser cannot decode).

## Open, and decided but not built (2026-08-23)

- **The `.roadtrip.json` export is the safety net the maintainer asked for by name** — he expects to pull a JSON out weekly so a cleared IndexedDB cannot cost him a year of tracking. Follow `projects/project-file.ts` exactly (portable half only, `{ok:false, error}` parsing, refuse a file from a newer version). Agreed shape of the reminder: a **discreet banner** ("last export 12 days ago"), never a blocking prompt. Not built.
- **The three visual directions drawn in the design pass were never formally chosen.** They now exist as the four title-style presets in the Style picker (the studio's own `StylePanel`, moved to `shared/overlay/` when Road Trip became its second consumer), so the choice is one click rather than a code change — but he has not said which one is the signature.
- **A badge can be animated but only exports as a still.** The PNG renders at the preview's current time. Burning a moving hook into a clip means handing the same elements to the studio's WebCodecs export, which is the natural next chantier now that the animation model is shared.
- **Carousels are a later phase**: a post becomes an ordered list of slides with a role (intro / content / CTA), and the closing call-to-action slide is a **single global template edited once** (his choice), reinjected automatically — not re-authored per post. For a reel the hook rides the Studio's existing intro *scene* rather than a new mechanism, and the CTA stays a separate end card rather than being baked into the export.
- **Time Machine** (an animated counter winding back to the media's day) and an API into his own geolocated media-triage system are wanted but explicitly last: both were discussed as "after the rest works".
- Element positioning is **not** fixed to a corner — he rejected a pinned top/side badge; placement is free, which is what the shared overlay engine already gives.
