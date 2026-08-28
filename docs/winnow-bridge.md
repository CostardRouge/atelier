# Atelier × Winnow — bridge brief

**Status**: design agreed in conversation, nothing built. Written 2026-08-24.

**What this is.** A self-contained brief for a follow-up conversation that will
have *both* repositories to hand (this one and Winnow's). Everything here about
**Atelier** was verified against this repository at the time of writing, with
file paths given so it can be re-checked. Everything about **Winnow** is
second-hand — reported by the maintainer, never inspected — and is marked as
such: **verify it against the Winnow repo before building on it.**

---

## 1. The two projects

### Atelier — what it is today (verified)

A local-first suite of browser tools for photo/video captures. React 18 +
TypeScript 5.7 + Vite 6 + Tailwind v4. **No backend, no account, nothing
uploaded.** Deployed as a static site to GitHub Pages. Package manager: npm.

Nine tools, all driven by one registry (`src/app/tools.tsx`): `studio`,
`roadtrip`, `telemetry`, `overlay`, `map`, `composer`, `exif`, `compare`, `lut`.
The stated direction is that they converge into the single `studio` editor.

What matters for the bridge:

- **The rendering pipeline is mature and browser-shaped.** WebCodecs decode →
  per-frame processing on a canvas → WebCodecs encode → `mp4-muxer`, with the
  original AAC audio track **copied through, never re-encoded**
  (`src/shared/media/webcodecs-export.ts`). LUT grading runs on WebGL
  (`src/shared/lut/`). Overlays and the Road Trip badge are one shared element
  model drawn to canvas (`src/shared/overlay/`). This is the expensive, mature
  part of the project and it only exists because it is in a browser.
- **HEVC the browser cannot decode** is handled by an opt-in in-browser
  ffmpeg.wasm transcode to H.264 (`src/shared/media/transcode.ts`), cached per
  file in `transcode-store.ts`.
- **Two tools already bridge to each other**: a Road Trip piece can link a
  Studio project (`TripPost.projectId`), the day badge is injected into it as an
  intro scene (`src/shared/roadtrip/hook-scene.ts`), and the handover is a route
  (`#/studio/open/<id>`). One Studio export then carries grade + telemetry +
  hook. This is the precedent for how tools talk to each other here: **through a
  document and a route, never by reaching into each other's state.**

### Winnow — what the maintainer says it is (UNVERIFIED)

- A **media triage** project, mature, already doing its job.
- Holds **all** his captures across devices: drone, camera, phone. All the
  Australia media is already in it.
- Map-based: it is easy for him to find media geographically.
- It has an **HTTP API and can serve files** (confirmed by the maintainer in
  conversation; the exact endpoints, auth model and Range support are unknown).
- It is a single instance with its own database — the property Atelier lacks.

**To verify in the next conversation**: stack and framework; whether asset
bytes can be served with HTTP **Range** support; whether sidecar files (a DJI
`.srt` beside its `.mp4`) are modelled; whether a content hash exists per asset;
what auth it already has; whether it can generate/serve proxy renditions;
whether it has a place to store opaque third-party documents.

---

## 2. The maintainer's goals, in his words

- His media stack should be **modular**: `winnow` = triage, `atelier` = edit and
  export (today drone-oriented, could grow toward camera photo editing).
- Long term: *"my own little Adobe cloud"* — his own set of tools for his media.
- The point is **removing the friction of expensive desktop applications** by
  building simple tools tailored to his own workflow.
- Winnow should become an **official media source for Atelier**.
- He wants Atelier available in **several install flavours**: public / browser /
  local-first, and *also* a more persistent mode — a **unique deployed
  instance with auth and a database**, so that **projects are resumable from
  another device**, exactly as Winnow already is.
- On the file-rename fragility: he says he **amplified** it, it is *not* the
  real problem. What he actually values is *"a project that doesn't lose track
  of what was added, where we were"*.

Context on the immediate need: he has ~3.5 months of Australia drone footage
and roughly 2 500 shareable photos, has published almost nothing in over a year,
and wants to publish regularly. Road Trip exists to make that tractable.

---

## 3. Decisions already taken in this conversation

| Question | Answer |
|---|---|
| How do the two connect? | **Winnow becomes an official media source for Atelier.** Atelier is *not* absorbed into Winnow. |
| Can Winnow serve media today? | **Yes — HTTP API and it can serve files.** |
| Same origin or separate? | **Separate origin, token auth.** Atelier stays its own deployment; it talks to Winnow cross-origin with a personal token. |

Two further recommendations made and not yet ruled on by the maintainer:

- Phase 3's document storage should be a **generic opaque document bucket** in
  Winnow (`/apps/atelier/docs/:id`, JSON Atelier owns entirely, etag for
  conflict), so Winnow ships one endpoint pair instead of a model per Atelier
  feature. Cost: Winnow cannot *query* trips, so a trip timeline living in
  Winnow proper would be a later, real schema.
- The README's promise must be rewritten. Proposed replacement, true in every
  flavour: **"your media never leaves machines you own"**.

---

## 4. Atelier's anatomy that matters for the bridge

### 4.1 Two seams — this is the whole architecture of the change

Everything the maintainer wants turns on two adapters, and both are already
isolated behind narrow interfaces.

**Seam A — where media comes from.**
`src/shared/sources/file-sources.ts`, whose own header declares it *"the ONLY
brick that changes for a native shell"*. Four browser entry paths (Chromium
`showDirectoryPicker`, `<input webkitdirectory>`, a plain multi-file picker,
drag-and-drop) all converge on `Promise<File[]>`. Nothing downstream knows where
files came from. **A `WinnowSource` belongs here**, as a peer.

**Seam B — where documents live.**
Two hand-rolled IndexedDB stores, ~100 lines each, with an identical shape:

| Store | Database | API |
|---|---|---|
| `src/shared/projects/project-store.ts` | `atelier-studio` | `listProjects` · `getProject` · `putProject` · `deleteProject` · `requestPersistentStorage` |
| `src/shared/roadtrip/trip-store.ts` | `atelier-roadtrip` | `listTrips` · `getTrip` · `putTrip` · `deleteTrip` + `putThumb` · `getThumbs` · `deleteThumbs` |

Both **degrade instead of throwing**: a failed read returns `[]`/`null`, a
failed write returns `false`, and the UI says so out loud. A remote
implementation is four HTTP calls behind the same four function signatures.

### 4.2 Media identity today — the weak point

```ts
// src/shared/projects/project-types.ts
export interface SavedMediaRef {
  name: string;
  size: number;
  lastModified: number;
}
```

- `src/shared/projects/reconcile.ts` matches saved refs against what a folder
  holds *now*, **by lowercased file name**. Same name + different size/mtime →
  `changed` (usable, but the export may differ); no name match → `missing`.
- `src/shared/library/assets.ts` groups files into *assets* keyed by
  **lowercased base name**, so `DJI_0001.MP4` + `DJI_0001.SRT` become one
  `video+telemetry` asset. `fileIdentity(file)` is
  `` `${name}__${size}__${lastModified}` ``.
- Road Trip deliberately refuses to key on names at all: a post records the
  **day** it tells, never a filename, because exports get renamed and re-graded
  between tools.

**Proposed change (phase 0):** `SavedMediaRef` gains an optional `assetId`
(Winnow's) and an optional content `hash`. Resolution order becomes
**id → hash → name**. This is additive, breaks nothing, and means documents
already speak in stable identifiers before the bridge exists.

### 4.3 The `File` assumption — the largest single piece of work

Atelier's pipeline is built on `File` objects end to end:
`buildAssets(files: File[])`, `exportVariantVideo(file, …)`,
`loadBadgeSource(file, …)`, `useTranscode(file)`, `transcode-store` keyed *by
the `File` object itself*. A remote asset is a URL, not a `File`, and a `File`
cannot be virtualised.

The natural split, and it is favourable:

- **Preview, scrubbing, the filmstrip and seeking need no fetch at all** —
  `<video src={url}>` takes a URL natively and uses Range under the hood.
  `src/shared/roadtrip/video-frames.ts` and `BadgeStage` already work by seeking
  one open video element.
- **Only the export path needs the bytes.** Start with fetch-to-Blob →
  `new File([blob], name, {type})`, which requires no downstream change at all.
  Stream/demux-by-range later only if a 4 GB rush demands it.
- **Winnow serving proxy renditions** (a 1080p H.264 rendition made at ingest)
  would make editing snappy and confine the full download to the final export.
  Atelier already has a proxy-shaped concept in `transcode-store.ts`.

### 4.4 Document models

- `ProjectDoc` — `PROJECT_DOC_VERSION = 12`. Holds settings, overlay elements,
  guides, LUT + LUT stack, output transform, theme, scenes, export prefs, and
  `media: { dirHandle, files: SavedMediaRef[], activeId, trims }`.
- `TripDoc` — `TRIP_DOC_VERSION = 8`. Holds stages, posts, badge words, theme,
  the CTA template and per-kind hook defaults. A `TripPost` holds its day, its
  badge, its deck slides, `projectId` and `publishedAt`.

Both are **versioned JSON with client-side migration functions** run on every
read. That is what makes a server-side store nearly free: the table is
`(id, kind, version, updated_at, json)` plus a blob column for thumbnails. No
relational modelling of overlays, ever.

### 4.5 The asset library

`src/shared/library/` holds one app-wide pool of `File` handles;
`AssetLibraryContext` exposes `assets`, `addFiles(files)`, `setActive(id)`,
`remove`, `clear`. Each tool declares the `AssetKind`s it `accepts`
(`'video+telemetry' | 'video' | 'telemetry' | 'photo' | 'other'`) and
`capabilities.ts` projects the pool down to those. **Only handles are held;
nothing is read eagerly** — a `File` is a lazy reference, so listing 50 multi-GB
videos is instant. A Winnow source must preserve that property: list metadata,
fetch bytes only when something is actually opened.

---

## 5. The proposed API contract

REST + JSON under `/api/v1`, `Authorization: Bearer <token>`, cross-origin.

```
GET  /assets?from=&to=&bbox=&kind=&q=&cursor=
     → { items: [ { id, filename, capturedAt, kind, width, height,
                    duration, gps, hash, thumbUrl, sidecars: [...] } ],
         nextCursor }
GET  /assets/:id/file            → bytes, Range-capable
GET  /assets/:id/thumb           → small JPEG
GET  /assets/:id/sidecar/:kind   → the .srt for a DJI clip
GET  /capabilities               → what this instance supports
POST /publications               → (phase 2) what was published, from which asset
GET/PUT /apps/atelier/docs/:id   → (phase 3) opaque JSON + etag
```

**Query priority**: build **date-range first**, not map-first. Road Trip is
day-keyed, so "everything from 9 July 2025" is the question the grid actually
asks. Bounding-box/map second.

**`/capabilities` matters**: it lets Atelier degrade with a sentence
("this Winnow does not serve sidecars") instead of guessing — the same rule the
rest of the codebase follows, where a feature that cannot work says why.

---

## 6. The four technical risks, in order of how badly they bite

1. **HTTP Range support is make-or-break.** Video preview, the filmstrip and
   mp4box's container probe all seek, and a camera file's `moov` atom often sits
   at the *end* of the file. Without `Accept-Ranges` and 206 responses, seeking
   a 4 GB clip means transferring 4 GB. Cross-origin this also needs
   `Access-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges`
   — **omit that header and it fails silently**, which is the worst failure mode
   available.
2. **Sidecars must be first-class.** A DJI `.srt` beside its `.mp4` is Atelier's
   founding case (telemetry overlays, flight path, the Composer). If the API
   cannot serve them, `video+telemetry` degrades to `video` and half the suite
   goes blind.
3. **CORS with credentials cannot use `*`.** Explicit origin, `Vary: Origin`,
   allow the `Authorization` header, handle preflight.
4. **The token lives in the browser.** `localStorage`, pasted once, XSS-exposed.
   Acceptable for a personal tool on a domain he controls, but it should be
   **scoped, revocable, and read-only until phase 2** — and stated, not
   discovered.

A fifth, softer one: **Winnow ids must never become the *only* identity.** A
document has to stay openable with plain local files, or the public flavour
dies.

---

## 7. The phased plan

| Phase | What | Where | Value if you stop there |
|---|---|---|---|
| **0** | `SavedMediaRef` gains `assetId?`/`hash?`; resolve id → hash → name. Plus the `.atelier.json` / `.roadtrip.json` portable export | Atelier only, no Winnow needed | Projects stop losing media on a rename; the backup the maintainer asked for by name and which is still unbuilt |
| **1** | `src/shared/sources/winnow/` — client, settings panel (base URL, token, "test connection"), "Add from Winnow" beside "Add files", date-range browser. Preview by URL, export by fetch-to-Blob | Atelier + read-only Winnow endpoints | The triage → edit hop stops being manual |
| **2** | Write-back: what was published, from which asset, when | Atelier + `POST /publications` | Winnow's map/timeline shows which days have been told — the Road Trip grid seen from the media side |
| **3** | Extract `ProjectStore`/`TripStore` interfaces; `remote-store.ts`; boot-time capability discovery; stale-write guard | Atelier + document bucket | Projects resumable from another device |
| **4** | Optional: proxies at ingest, a trip timeline in Winnow proper, background exports | Both | The "little Adobe cloud" |

**Phase 0 is the one to start regardless of everything else**: it is client-only,
it is a win under every scenario, and it makes phases 1–3 cheap.

**Conflict handling (phase 3)**: do not build a sync engine. Last-write-wins
with a version/etag check that **refuses** a stale write and says so is enough
for one person on two devices, and it matches the honesty of the rest of the
codebase.

---

## 8. Options considered and rejected

### A — Atelier becomes a module inside Winnow

*Pros*: one app, one auth, one database; a trip timeline living where the media
lives.

*Cons, and why it was rejected*: it ports the mature, **browser-shaped** render
pipeline (WebCodecs, WebGL, canvas) in order to solve an *asset-resolution*
problem — moving the expensive thing to fix the cheap one. It also drags
Compare, Photo EXIF, Telemetry and Composer into a triage tool where they do not
belong, kills the public flavour, and contradicts the maintainer's own stated
goal of a **modular** stack.

### B — Winnow borrows nothing; Atelier just gets more robust locally

*Pros*: free.

*Cons*: does not give him the query, the map, the single instance or the
multi-device resumability he asked for. Kept only as the fallback baseline —
and phase 0 delivers its useful half anyway.

### C — Same origin (Winnow serves Atelier's build at `/atelier`)

Recommended in conversation for removing CORS, token handling and the
double-launch, at the cost of a build/deploy step on Winnow's side.
**The maintainer chose separate origins with token auth instead**, keeping the
two deployments fully independent. The client should be written so the base URL
and auth header are configuration, which keeps the same-origin option open.

---

## 9. The product promise that has to change

`README.md` currently opens with *"Everything runs in your browser; files never
leave your machine — no upload, no account, no server"*, and documents exactly
one network exception (opt-in OpenStreetMap tiles). That statement stops being
true in the connected flavour.

For the record, the network calls that **already** exist (from
`docs/memory/local-first.md`, all verified in code):

- OpenStreetMap raster tiles — the documented exception, opt-in, off by default.
- ffmpeg.wasm core from `unpkg.com`, ~31 MB, on first transcode only, opt-in.
- **Google Fonts on every page load, unconditionally — not mentioned in the
  README's callout.** An open item predating this discussion.
- An OpenStreetMap `href` built for a photo's GPS position, opened on click.

Proposed replacement promise, true in all three flavours: **"your media never
leaves machines you own"** — no cloud, no third-party account, no telemetry.
This is a product statement and therefore the maintainer's call; it should be
decided deliberately rather than quietly eroded.

---

## 10. Open questions for the next conversation

With the Winnow repo in hand:

1. **Does `/assets/:id/file` support Range?** If not, what would it take?
2. **Are sidecars modelled at all?** How is a DJI `.mp4` + `.srt` pair stored?
3. **Is there a content hash per asset?** If yes, phase 0 should adopt *that*
   hash rather than inventing one.
4. **What auth exists?** Sessions, tokens, something else — and can a scoped,
   revocable, read-only token be issued?
5. **Can Winnow generate proxy renditions?** This decides whether phase 1 is
   pleasant or merely usable.
6. **Is there anywhere to put opaque third-party documents**, or does phase 3
   need a new table?
7. **What does Winnow's own trip/timeline concept look like today**, if any? The
   maintainer described wanting one; Road Trip already has the calendar, the
   coverage grid and the published-state model, so the question is which side
   owns it — and phase 2's write-back may make the question moot.

---

## 11. Path cheat-sheet (Atelier)

```
src/app/tools.tsx                       the tool registry (nav + routes)
src/app/use-hash-route.ts               hash router + isWithinRoute guard
src/shared/sources/file-sources.ts      SEAM A — the only file-access brick
src/shared/sources/write-files.ts       export-to-folder (File System Access)
src/shared/library/assets.ts            File[] → grouped Assets, by base name
src/shared/library/AssetLibraryContext  the app-wide pool, addFiles/setActive
src/shared/projects/project-types.ts    ProjectDoc (v12), SavedMediaRef
src/shared/projects/project-store.ts    SEAM B — IndexedDB `atelier-studio`
src/shared/projects/reconcile.ts        name-based media reconciliation
src/shared/roadtrip/trip-types.ts       TripDoc (v8), TripPost, migrations
src/shared/roadtrip/trip-store.ts       SEAM B — IndexedDB `atelier-roadtrip`
src/shared/roadtrip/hook-scene.ts       Road Trip → Studio injection
src/shared/media/webcodecs-export.ts    the export pipeline (audio copied)
src/shared/media/export-variant.ts      one variant: crop, overlays, cadence
src/shared/media/transcode.ts           ffmpeg.wasm HEVC → H.264, opt-in
src/shared/overlay/                     the element model + drawing + scenes
src/shared/lut/                         WebGL grading
docs/memory/                            the project's long-term memory
```

**Verification note for whoever builds this**: the cloud container used for this
work has **no H.264 encoder** (`VideoEncoder.isConfigSupported` reports vp8/vp9
only), so an end-to-end export cannot be driven there. UI, arithmetic and
wiring can be verified in headless Chromium; the encode itself must be checked
on a real machine.
