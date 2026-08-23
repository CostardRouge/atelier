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

**A post is keyed by the DATE it tells, never by a file name.** The maintainer re-exports through Capture One and the Studio, so names, sizes and mtimes all change under him; the day a photo was shot does not. This was his explicit instruction and it is the load-bearing choice of the whole model — media references will *join* a post in a later phase, they will never become its key. **How to apply**: any new tracking field hangs off the day or the post's date, never off a filename.

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

## Open, and decided but not built (2026-08-23)

- **The `.roadtrip.json` export is the safety net the maintainer asked for by name** — he expects to pull a JSON out weekly so a cleared IndexedDB cannot cost him a year of tracking. Follow `projects/project-file.ts` exactly (portable half only, `{ok:false, error}` parsing, refuse a file from a newer version). Agreed shape of the reminder: a **discreet banner** ("last export 12 days ago"), never a blocking prompt. Not built.
- **The day badge** ("Jour 27 / 310") is the next phase and the reason the counters exist: `postDayRange` and `stageDayNumber` already return the numbers with no formatting decided, deliberately. Three visual directions were drawn with the maintainer (rouge plein cadre / carnet de bord / data readout, reusing the `or-cine` and `pixel-crt` presets) and none is chosen yet. The layout rule he gave: **one dominant central number**, context (place, total) clearly subordinate — not everything at equal weight.
- **Carousels are a later phase**: a post becomes an ordered list of slides with a role (intro / content / CTA), and the closing call-to-action slide is a **single global template edited once** (his choice), reinjected automatically — not re-authored per post. For a reel the hook rides the Studio's existing intro *scene* rather than a new mechanism, and the CTA stays a separate end card rather than being baked into the export.
- **Time Machine** (an animated counter winding back to the media's day) and an API into his own geolocated media-triage system are wanted but explicitly last: both were discussed as "after the rest works".
- Element positioning is **not** fixed to a corner — he rejected a pinned top/side badge; placement is free, which is what the shared overlay engine already gives.
