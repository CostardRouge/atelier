# Atelier × Winnow — the timeline brief

**Status**: written **2026-09-03**, before Winnow's timeline specification
exists, so that the questions are ready when it lands and Atelier's side does
not close a door in the meantime. **Phases T0 and T1 are built** (2026-09-06:
`TripDoc.sourceId`, `TripStage.origin`, the `.roadtrip.json` split of §5.4, and
`shared/roadtrip/timeline-import.ts` with its spec). **T2 is built on Atelier's
side** against an assumed wire shape: `GET /api/timeline?<filters>` →
`{ chapters: [{ id, title, start_date, end_date, places[{name, region, lat,
lon}], revision, asset_count, photo_count, video_count, cover_id }] }`,
`chapter_id` as an `/api/assets` filter, and `capabilities.media.timeline`.
All of it is read in ONE function, `chapterFromWire` (`client.ts`); when the
spec lands, that function changes and nothing else does.

**What this is.** A companion to `docs/winnow-bridge.md` — read that first: it
carries the source model, the four invariants, the API inventory and the phases
this document extends. The bridge answers *where media comes from*. This one
answers what happens when that source stops being a flat pool and starts
carrying **structure**.

**How to read the two kinds of claim here.** Everything about **Atelier** was
checked in the code, with the path, and can be re-verified. Everything about
**Winnow's timeline** is an assumption — the feature is in progress and its
spec is not written — and is marked ⚠. An assumption that turns out false costs
one paragraph of this document; an assumption made silently in code costs a
migration.

---

## 1. What is coming

In the maintainer's words (2026-09-03): Winnow gains a **timeline** that groups
media into **chapters** — by place, by date — so a journey can be seen before it
is edited, and so an export can be taken **on a segment, on a place, on a
chapter** rather than on a hand-made selection. Work is under way; the
specification follows.

Three consequences he asked to have anticipated, and they are the three
directions of §4–§6:

1. **Ingesting into Atelier from a timeline** rather than from a day or a folder.
2. **Creating and completing a Road Trip from one**, with links both ways
   between the two apps.
3. **Pushing Atelier's finals back into Winnow**, landed where they belong.

---

## 2. The structural fact this all turns on

A Winnow chapter ⚠ and a Road Trip **stage** are the same object, reached from
opposite ends.

`TripStage` (`src/shared/roadtrip/trip-types.ts`, `TRIP_DOC_VERSION = 9`) is a
**leg**: a span, and the places it went through **in the order they were lived**;
its start and end are `places[0]` and the last, derived and never stored
(`trip-places.ts`). Road Trip arrived there editorially on 2026-09-03
(`docs/memory/roadtrip.md`, "A stage is a LEG"). "Media grouped by place and by
date" is the same statement made from the media side.

That is a gift and a trap in one. The gift: no model has to be invented. The
trap: two models that resemble each other get merged, and then the editorial
half acquires a server.

| Winnow chapter ⚠ | Road Trip | Note |
|---|---|---|
| `id` | `TripStage.origin.chapterId` | **never** `TripStage.id` — §5.4 |
| title | `TripStage.name` | leave it **empty** when the title is only the route: an empty name derives "Perth → Cairns" and keeps deriving when a place is edited (`trip-places.ts`) |
| first / last capture date | `startDate` / `endDate` | the camera's local date, taken as given, never recomputed — §8.1 |
| place, or places in order | `places: TripPlace[]` | `{lat, lon}`, EXIF-ordered — **not** GeoJSON's `{lon, lat}`, which is what `TrackPoint` uses two directories away |
| region / country | `TripPlace.region` | empty when the places disagree; `stageRegionLabel` already refuses to print one they do not share |
| asset counts, cover asset | **nothing stored** | shown live from the source; never written into the trip — §3.1 |

**One pure module owns that table**: `shared/roadtrip/timeline-import.ts`
(built 2026-09-06), `importTimeline(chapters, options) → { stages, span,
uncovered, destination, warnings }`, DOM-free and unit-tested beside its source,
like every other piece of Road Trip's arithmetic. Its input, `TimelineChapter`,
is **Atelier's own shape**, not the wire's: when the spec lands, the client
normalises whatever arrives into it at the boundary. The mapping must not be
re-derived inside a panel, and `shared/` must not learn to fetch — the client
stays `shared/sources/winnow/client.ts`.

---

## 3. The four rules

### 3.1 A timeline is a FACT about media; a trip is a DECISION about telling it

Winnow can compute a chapter from what the camera recorded. It cannot compute
that Kalbarri is worth three posts and the drive out of Perth none. Road Trip
exists for the second question — *"which day have I never told, and what goes
out next"* — and the grid's value is its **holes** (`trip-coverage.ts`).

So the line is: **an import creates stages; it never creates posts.** A trip
seeded with 310 pre-filled posts has no holes left, and the one signal the tool
carries is gone. This is the same refusal as the stored day record: days are
derived from two dates, and nothing is written to say a day exists.

### 3.2 Seed, then reconcile by proposal — never sync

The timeline will move: chapters get recomputed when media is added, re-clustered
when a threshold changes, renamed when the author edits them ⚠. The trip will
move too, editorially. Two moving documents with one shared shape is a sync
engine, and the bridge already ruled that out twice (invariant 4, risk 6).

What replaces it, and it is much smaller: an import is a **one-way seed**, and
re-running it is a **diff the author accepts or rejects, chapter by chapter** —
"Winnow's timeline has a leg your trip does not (Kalbarri, 12–15 Feb): add it?",
"the leg you renamed 'The Red Centre' is now called 'Uluru' there: keep yours?".
Nothing the author touched is ever overwritten silently. This is `reconcile.ts`'s
posture for media (`changed` / `missing`, stated, never repaired behind the
user's back) applied to structure.

### 3.3 Winnow stays ignorant of Road Trip

The bridge's modularity rule (§3.5), and it binds harder here because the
timeline is the first Winnow concept with editorial *shape*. When Atelier writes
back it speaks **Winnow's nouns** — asset, sidecar, session, chapter, place —
and never its own: no trip, no post, no badge, no piece kind, no publication
date. The single exception is the phase-3 document bucket, which is opaque by
contract (`GET`/`PUT /api/apps/atelier/docs/:id`, JSON Winnow stores and does not
read).

The corollary is the honest answer to "can Winnow show that a chapter has been
told?": **not by being told — by receiving the finals** (§6). Lineage it already
models beats a status field it would have to be kept in sync with.

### 3.4 A chapter id is never the only identity

Bridge invariant 3, verbatim, one level up. A trip seeded from a timeline must
stay fully usable with the instance switched off, deleted, or never connected on
this machine: every stage keeps its own name, span and places as plain values,
and `origin` is a **hint for the next reconcile**, never a pointer the reader
dereferences. Media identity already obeys this — `id → hash → name`, the hash
being Winnow's own `content_hash` (`shared/lib/partial-hash.ts`).

---

## 4. Direction one — ingesting from a timeline

`WinnowBrowser` (`src/app/WinnowBrowser.tsx`) has two ways in today: **by day**
(`/api/assets/calendar`, because Road Trip is day-keyed) and **by folder**
(`/api/sessions`). A timeline is the third, and it is the cheapest of the three
to add: same modal, same filter row, same tiles, a different list on the left.

Rules the existing two established and this one inherits
(`docs/memory/architecture.md`, "Remote sources"):

- **Filter parity or nothing.** Type / extension / device are sent to the
  calendar, the day, the sessions and the rows alike, so one choice narrows the
  whole modal and every count agrees. A chapter list that ignores the active
  filters, or counts assets the day list would not show, reads as a bug. If
  Winnow cannot apply the standard filters to the timeline, Atelier must not
  offer them there rather than display two disagreeing numbers.
- **Follow `next_cursor`** (a page is 200 rows; a chapter can be thousands),
  and keep the 2 000-row cap `allAssets` already enforces — with the count said
  out loud when it bites.
- **A chapter is a prefilled selection, never an automatic download.** Media
  crosses the wire as real `File`s (`materialize.ts`): "add this chapter" can be
  40 GB down a Cloudflare tunnel. Show the count and the estimated bytes at the
  chosen fidelity, tick nothing by default beyond what the user asked for, and
  keep the proxy default. The same honesty as "Add 12 to library".
- **Remember the place, not the selection** (`browse-state.ts`): the open
  chapter joins view/filters/month/day/fidelity in `localStorage`; a tick list
  never does.
- **No request at boot**, and thumbnails need `crossOrigin="use-credentials"`.

What a chapter buys over a day: a leg is the unit a piece is actually cut from —
"the three days at Kalbarri" — and it is one click instead of three days picked
by hand across a month boundary.

---

## 5. Direction two — seeding and completing a trip

### 5.1 What the import fills, and what it must never touch

Fills: the trip's **span** (the first and last capture dates of the imported
chapters), its **stages** and their **places**, and — only when the trip is being
created — a proposed `name` and the `destination` subtitle composed from the two
ends, exactly as `NewTripModal` composes it from From/To today.

Never touches: `badgeWords`, `theme`, `cta`, `hookDefaults`, `posts`. Those are
the trip's voice and its editorial record; a source has no opinion about them and
an import that resets a theme is a data-loss bug wearing a feature's clothes.

### 5.2 Two entry points, one module

- **Create a trip from a timeline** — the modal's second tab beside From/To,
  or arrival from a Winnow link (§5.5). It shows what it *will* create (N legs,
  the span, the places, the days with no chapter) and creates nothing until the
  user says so.
- **Complete an existing trip** — the same screen in diff form (§3.2), reachable
  from the trip overview. This is the one that matters six months in, and it is
  why `origin` exists.

Both call `timeline-import.ts`; the panels differ, the arithmetic does not.

### 5.3 It costs no bytes

A timeline is metadata: a few kilobytes for a three-month trip. Seeding a trip
from an instance is one JSON fetch and no media at all — which makes it the
fastest useful thing this bridge can do over a home tunnel, and a good first
phase for that reason alone.

### 5.4 The document changes, and one gap phase 0.5 left

Two additions, one `TripDoc` version (**v10**, with the usual client-side
migration on read):

```ts
interface TripDoc  { sourceId: string; /* … */ }        // NEW — see below
interface TripStage {
  origin?: {            // NEW — a hint, never a pointer (§3.4)
    sourceId: string;   // the host, as `sourceIdFor()` mints it
    chapterId: string;
    revision?: string;  // ⚠ whatever Winnow offers to detect re-clustering
    importedAt: number;
  };
}
```

**The gap, now closed**: phase 0.5 put `sourceId` on `ProjectDoc` (v14) and
**not on `TripDoc`** — found 2026-09-03, fixed 2026-09-06 by T0. It carries the
same default (`'local'`) and the same rule: **bound half, never in the portable
file.** `StageOrigin` is the exported name of the `origin` shape above.

`trip-file.ts` (`.roadtrip.json`) strips what addresses *this browser*: the id,
the timestamps, and `TripPost.projectId`. The new fields split:

- `sourceId` — **stripped**, like the project file's. An imported trip belongs to
  the source that imports it.
- `TripStage.origin` — **kept**. It does not address this browser: `sourceId` is
  the instance's *host* and `chapterId` is that instance's own, so on another
  machine connected to the same Winnow the next reconcile still works, and where
  the instance is unknown it dangles harmlessly — greyed with a reason, the house
  rule for an unreachable source. This is the one place the trip file departs from
  "strip anything that points outside", and it departs on purpose.

### 5.5 The links, both ways

Atelier's side of the hash is already the pattern (`use-hash-route.ts`,
`trip-route.ts`, and the `#/studio/open/<id>` hop that **rewrites itself on
arrival**). Two new routes, both **proposals that a person confirms**:

```
#/roadtrip/new?source=<host>&timeline=<id>        seed a new trip
#/roadtrip/<tripRef>/import?source=<host>&timeline=<id>   reconcile into one
```

The bridge's rule holds unchanged: **the URL may say what to open, never where to
fetch from.** A `source` naming an instance that is not already connected falls
through to `#/connect?instance=…` and its confirmation, never a silent fetch.
`isWithinRoute` guards any redirect, or a mounted tool hijacks another's hash.

From Winnow's side these are the "Edit in Atelier" verbs the bridge left open
(§10, still open): on a chapter, "Make a Road Trip from this leg"; on a day
inside one, the existing `#/roadtrip/<trip>/<day>` deep link. The timeline is
what finally makes that menu obvious — it is a surface with the right nouns on
it, which a flat asset grid never was.

---

## 6. Direction three — the finals go back

Bridge phase 2 unchanged in substance: `POST /api/upload` into a **finals** root,
then `/api/reconcile` links the render to its source. The timeline adds one field
and one path convention.

- **`original_asset_id` is already in Atelier's hand.** A Winnow-materialised
  file is vouched for with `assetId = "<host>/<id>"` (`materialize.ts`,
  `identityFor`), which survives into `SavedMediaRef.assetId` on both
  `ProjectDoc.media` and `TripPost.media`. The write-back splits the host off,
  checks it matches the target instance, and sends the numeric id — which is more
  honest than reconcile's basename + capture-time match, and is the three-line
  Winnow change the bridge already proposed.
- **`chapter_id` ⚠, if the timeline offers one**, so a final lands in the leg it
  was cut from. This is Winnow's own noun, so it does not violate §3.3 — and it
  is what makes "export on a segment" symmetric: the segment is where the pieces
  come back to.
- **Path shape**: `POST /api/upload` preserves a relative path per file, so a
  render and its sidecar stay together. Derive it from Winnow's nouns
  (`<chapter>/<basename>-<variant>.mp4`), not from Road Trip's — a path is a
  contract with a filesystem, and a trip's slug is an editorial value that
  changes when a trip is renamed.
- **Check `capabilities.limits.maxUploadBytes` before rendering**, not at 90 %
  of the upload. A reel is tens of megabytes and fine; a 4K master is not.

What the maintainer actually gets from this, and it is the answer to "how does
Winnow know a chapter has been told": `has_edit` / `is_edit`,
`assets.original_asset_id` and `/api/assets/:id/exports` already exist. Once
finals come home, the timeline can colour a chapter by how much of it has been
published — computed from lineage Winnow owns, with no Road Trip vocabulary
anywhere near it (§3.3).

---

## 7. What Atelier needs the timeline API to answer

The specification is not written; this is the list to check it against. Ordered
by what breaks without it.

1. **A chapter id that survives recomputation** — or an explicit revision/hash so
   Atelier can *detect* that a chapter it stored was re-clustered. §5.4 stores the
   id; if ids are regenerated on every recompute, `origin` matches nothing and
   the reconcile diff proposes to re-add every leg the author already has.
2. **Derived or authored?** A chapter the author drew by hand is stable and can
   be trusted; one produced by clustering can change under the trip. The reconcile
   screen wants to say which it is looking at, and to weight the two differently.
3. **Dates as capture dates** (`YYYY-MM-DD`, camera-local), not instants — §8.1.
4. **Ordering**: chapters returned in lived order, and whether two chapters may
   overlap. Road Trip resolves overlap to the **last** match (`stageAt`, `trip-coverage.ts`), so an
   import that produces overlaps silently changes which place a badge names.
5. **Gaps**: can a day inside the timeline's span belong to no chapter? Road Trip
   is fine with it (a stage-less day falls back to the day of the trip, never
   inventing a place), but the import screen should say "11 days belong to no
   leg" rather than quietly producing a trip with holes in its stage list.
6. **Nesting.** If a timeline is trip → segment → chapter ⚠, Road Trip's stages
   are **flat** and one level has to be chosen. Default to the level that carries
   a span *and* a place; offer the other as a choice; never flatten two levels
   into one list of stages, which loses the ordering that makes `places[]` mean
   anything.
7. **A place with coordinates**, decimal degrees, south/west negative, and
   explicitly named as `lat`/`lon` on the wire. Null coordinates are the normal
   case, not an error.
8. **`chapter_id` as a filter** on `/api/assets`, `/api/assets/calendar`,
   `/api/facets` and `/api/assets/geo` — cumulative with the existing ones, like
   every other Winnow filter. Without it §4's parity rule cannot be honoured.
9. **`capabilities.media.timeline: boolean`** on `/api/capabilities`, so an older
   instance degrades to a sentence instead of a broken tab. This is exactly what
   the capabilities document was introduced for (bridge §3.5).
10. **Counts per chapter, by media type, and a cover asset id** — enough to draw
    the list without fetching a page of rows per chapter.

---

## 8. Traps, before they are discovered

### 8.1 The timezone one, which is the expensive one

Road Trip's `IsoDate` arithmetic goes through `Date.UTC`/`getUTC*` throughout
(`trip-days.ts`), on purpose: parsing locally lets the *reading* machine's zone
move a value, so a trip lived in Australia and reviewed in France would disagree
about which day a photo belongs to. The one deliberately local reading is
`todayIso()`.

Winnow stores both an instant (`captured_at`) and a date (`capture_date`). **Take
the date. Never recompute it from the instant in the browser.** A clip shot at
07:00 in Perth is `2026-02-12` on the wall behind the photographer and
`2026-02-11T23:00Z` in UTC; recomputing walks it back a day for a third of a
trip. Which zone Winnow computed it in is question §7.3, and the import must say
what it assumed rather than average two answers.

### 8.2 Stage overlap resolves to the last match

`stageAt` returns the **last** stage covering a date, because on a travel day the
later leg is where you ended up. An import that emits overlapping chapters is
therefore not neutral: it silently changes what a badge says. Order the stages as
lived and surface overlaps in the diff.

### 8.3 A stored id against a moving clustering

§7.1 again, from the other end: if chapters are re-clustered nightly, `origin` is
a weak key and the reconcile screen must fall back to matching **by span and
place**, presenting near-matches rather than duplicates. Design the diff to be
right when the ids are useless; treat matching ids as the fast path.

### 8.4 Empty means derived, everywhere

`stage.name` and `TripPlace.region` empty are *computed*, not blank. An import
that helpfully writes "Perth → Cairns" into the name field pins a value that was
alive: rename a place afterwards and the label lies. **Write nothing where the
derivation already says the right thing** — the same rule as a badge's text
overrides, where clearing a field returns the computed value.

### 8.5 Never invent a place

A chapter with no GPS and no name yields a stage with a span and no place, and
the badge falls back to the day of the trip. That is the whole anti-fabrication
line the tool holds (the battery gauge drawing `—`, the counter falling back
rather than naming a place it does not have). An import is not an exception.

### 8.6 The library sidebar needs its own error boundary

Already true and already fixed (`App.tsx`), but a third pane in `WinnowBrowser`
is exactly the kind of change that reaches for a shortcut: anything the shell
renders outside the tool crashes the suite without its own guard.

---

## 9. Phases

These slot **beside** the bridge's, and depend on its phase 1 (built) plus
whatever Winnow ships.

| Phase | What | Where | Value if you stop there |
|---|---|---|---|
| **T0** ✅ 2026-09-06 | `TripDoc.sourceId` (v10) + `TripStage.origin`, with the migration and the `trip-file.ts` split of §5.4. Nothing remote. | Atelier only | Invariant 2 is finally enforced on both documents, and a trip can *record* where it was seeded from before anything can seed it |
| **T1** ✅ 2026-09-06 | `timeline-import.ts` — the pure mapping, the span derivation, the diff (`add` / `unchanged` / `changed` with the fields that moved / `dropped`, matched id → span → first place), and `applyTimelineDiff` over accepted entries only; 42 specs | Atelier only | The whole feature's arithmetic, testable with no server and no spec risk beyond the shape of a chapter |
| **T2** ✅ 2026-09-06 (client side, against the ASSUMED wire of `chapterFromWire`) | Browse by chapter in `WinnowBrowser`; add a chapter's media as a prefilled selection | Atelier + `chapter_id` filter + `capabilities.media.timeline` | Ingestion stops being day-by-day for footage that is a leg |
| **T3** | Seed / complete a trip: the two screens, the two routes, "Make a Road Trip from this leg" on Winnow's side | Atelier + one link on Winnow | The journey structure crosses once, and the trip is a decision surface from day one |
| **T4** | Finals home with `original_asset_id` (+ `chapter_id` ⚠) — bridge phase 2, scoped by chapter | Atelier + `/api/upload` fields | The timeline can colour what has been told, from lineage it owns |
| *later* | The trip document in the phase-3 opaque bucket, which is what makes the backlink real rather than inferred; a leg's route drawn from `/api/assets/geo` on the existing MapLibre pane | Both | Multi-device Road Trip |

**T0 and T1 are worth doing before the spec lands**: both are client-only, both
are correct under every version of the timeline, and together they turn T2–T4
into wiring. That is the same reasoning that made the bridge's phases 0 and 0.5
the right first move, and it held.

---

## 10. Options considered and rejected

**A — a trip becomes a first-class Winnow table.** Tempting: Winnow already has
places, sessions and now chapters, and it has a database. Rejected: it makes
Winnow learn what a Road Trip is (§3.3), it moves an *editorial* document to the
one machine that must not be required (invariant 1: Atelier is a client, never a
host; a trip must open with no instance at all), and it kills the local/public
flavour of Road Trip outright. The opaque document bucket already gives the
useful half — persistence — without any of that.

**B — a stage becomes a live view over a remote chapter (nothing stored).**
Rejected: a stage carries editorial fields with no home in Winnow (the derived
name the author overrode, the region they typed), the trip stops opening offline,
and every badge render would depend on a tunnel to a NAS.

**C — continuous two-way sync between stages and chapters.** Rejected on the
bridge's own grounds (invariant 4, risk 6): it is a sync engine, it is where
local-first projects die, and the need it serves — "the timeline gained a leg" —
is met by a diff the author accepts in two clicks.

**D — the import creates a post per day with media.** Rejected: §3.1. It fills
the calendar the tool exists to keep empty.

**E — flattening a nested timeline into one stage list.** Rejected: §7.6. Two
levels merged lose the lived ordering, and `places[0]`/last stop meaning start
and end.

---

## 11. Open questions

For the maintainer, when the spec is ready:

- **Is a chapter authored, derived, or both?** (§7.2) It decides the whole
  posture of the reconcile screen, and it is the one answer that cannot be worked
  around client-side.
- **Does a timeline nest?** (§7.6) If it does, which level is a leg?
- **What is a chapter's identity across a recompute?** (§7.1)
- **Do finals land in a chapter** (`chapter_id` on upload), or only in a finals
  root that reconcile then walks? The first is one field and makes "export on a
  segment" round-trip.
- **Which Winnow surfaces get the Atelier verbs** — still open from the bridge
  (§10 there), and the timeline is the surface that finally makes the answer
  obvious.

Not a question but a note: a local dev server cannot exercise any of this —
`localhost` is cross-**site** to `winnow.steeve.website`, so the session cookie
cannot travel. Testing needs the deployed pair, or a `winnow.localhost`-style
same-site setup.

---

## 12. Path cheat-sheet (what this brief touches)

```
src/shared/roadtrip/trip-types.ts      TripDoc (v9) · TripStage · TripPlace
src/shared/roadtrip/trip-places.ts     derived start/end/region — do not pin them
src/shared/roadtrip/trip-days.ts       IsoDate, every subtraction in UTC
src/shared/roadtrip/trip-coverage.ts   the grid's holes — what an import must not fill
src/shared/roadtrip/trip-file.ts       .roadtrip.json — what travels and what is stripped
src/shared/roadtrip/trip-route.ts      #/roadtrip/<tripRef>/<day>/<piece>
src/shared/sources/source.ts           SourceInfo, listSources()
src/shared/sources/winnow/client.ts    the only place Atelier speaks HTTP to a source
src/shared/sources/winnow/materialize.ts  asset → File[], and the identity it vouches with
src/shared/sources/winnow/browse-state.ts what the browser remembers between sittings
src/app/WinnowBrowser.tsx              by day · by folder · (by chapter)
src/app/ConnectScreen.tsx              #/connect — the confirmation an instance link lands on
src/shared/projects/project-types.ts   SavedMediaRef {assetId, hash} — the write-back's key
docs/winnow-bridge.md                  the source model this extends
```
