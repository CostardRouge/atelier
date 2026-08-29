# Atelier × Winnow — bridge brief

**Status**: design agreed, nothing built. Written 2026-08-24 with only Atelier to
hand; **revised 2026-08-29 with both repositories read.**

**What this is.** A self-contained brief for the conversation that will build the
bridge. Every claim about **Atelier** and, since the revision, every claim about
**Winnow** was checked against the code, with the file path given so it can be
re-verified rather than believed.

**What the revision changed.** The first draft had to guess about Winnow and ended
on seven open questions. Six are now answered by the code, and the answers move the
design:

- Two of the four technical risks are **already solved** in Winnow (Range on the
  derivatives, sidecars as first-class rows).
- The API contract §5 proposed is **largely already built**, and richer.
- Phase 2's `POST /publications` is **redundant** — Winnow already models the
  finals → source lineage.
- One decision is **reversed**: "separate origin, token auth" rested on the
  assumption that Winnow's auth could travel cross-origin. It cannot (`SameSite=Lax`
  cookie sessions, no Bearer anywhere).

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

### Winnow — what it is (verified 2026-08-29)

One photographer's ingest → cull → export pipeline over a home NAS. **Next.js 16
(App Router) + React 19 + Postgres + Redis/BullMQ + ffmpeg/sharp/exiftool**,
TypeScript, npm, no test suite and no linter — the whole gate is
`typecheck` + `migrate` + `build`. Deployed push-to-`main` → ghcr image →
Watchtower on an Optiplex, behind Traefik + a Cloudflare Tunnel.

Shape (`docs/memory/architecture.md` in that repo):

- **The originals are touched once.** Everything afterwards reads Postgres and a
  derivative cache; deletes are soft, purge is a separate explicit verb.
- Logic lives in `src/lib/`; the API routes (`src/app/api/**`, ~90 of them), the
  worker and the CLI scripts are thin wrappers over it.
- Derivatives sit on disk behind an **S3-shaped driver** (`src/lib/storage/`), so
  MinIO is one env flip away — and on S3 the file routes answer with a **signed
  redirect** instead of bytes.
- Identity lives in the app, not the reverse proxy (`src/proxy.ts` +
  `src/lib/authz.ts`): roles are viewer < editor < admin, every GET is
  viewer-visible, mutations need editor, infrastructure needs admin.
- It carries a `sessions` concept (a shoot folder with triage progress), faces,
  people, places, gear, bursts — and **no trip/journey concept**.

Scale target, per its own `docs/ARCHITECTURE-REVIEW.md`: comfortable at ~100k
assets.

The five properties that decide this bridge, each with its path:

| Property | Where | What it means here |
|---|---|---|
| **Range on the derivatives** | `src/lib/serve.ts` | 206 + `Content-Range` + `Accept-Ranges`, `ETag`/304 answered before any storage round-trip, signed redirect on S3. A `<video>` can seek a proxy properly. |
| **Sidecars are rows, not files on the side** | migrations `0015_video_sidecars.sql`, `0017_srt_sidecars.sql`, `src/lib/sidecars.ts` | `asset_sidecars`, `kind IN ('xml','thm','srt')`, detected **by shared base name** — the same rule as Atelier's `buildAssets` — and carried with the clip through import, export and purge. |
| **A content hash per asset** | `assets.content_hash` (UNIQUE), `src/lib/hash.ts` | `sha256(String(size) ‖ first 64 KiB ‖ last 64 KiB)`. Reproducible in a browser from a `File` with two `slice()`s and WebCrypto. |
| **Proxies for everything, already** | `src/lib/video.ts`, `src/lib/derivatives.ts` | Video: libx264 `yuv420p` + AAC 128k + `+faststart`, `VIDEO_PROXY_HEIGHT=720`, `CRF 24`. Photo: WebP, `PROXY_SIZE=2048`, quality 80. |
| **Cookie sessions, no Bearer** | `src/proxy.ts`, `src/lib/auth.ts` | 256-bit token, `httpOnly`, **`SameSite=Lax`**, sliding 30 days, only its SHA-256 in Postgres. Nothing cross-origin exists. |

And the DJI case, which is Atelier's founding one, is already understood
server-side: `src/lib/srt.ts` parses the flight log, and migrations `0024` /
`0027` / `0028` materialise a representative GPS fix, peak altitude, sample count,
gimbal attitude, peak speed and the clip's exposure onto the sidecar row (the
photo equivalent lands on `assets` directly, from `drone-dji:*` EXIF). **The full
cue stream stays in the `.srt` file** — Winnow summarises, it does not replace the
log, which is exactly what Atelier needs: fetch the sidecar, parse it with the
parser it already has.

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

## 3. Decisions taken

| Question | Answer |
|---|---|
| How do the two connect? | **Winnow becomes an official media source for Atelier.** Atelier is *not* absorbed into Winnow. |
| Can Winnow serve media today? | **Yes**, and better than assumed: originals, sidecars, and Range-served proxies for every asset. |
| Same origin or separate? | **The client is written agnostic; same-origin ships first.** *(2026-08-29, reverses the earlier answer.)* |
| What does the preview read? | **Always the proxies**, with an opt-in switch to pull the real files. |
| What does the export read? | **The originals by default**, with a switch to render from the proxies. |

### 3.1 Origin and auth — why the earlier answer was wrong

The first draft chose **separate origins with token auth**, on the belief that
Winnow's existing auth would carry cross-origin. It will not: sessions are an
`httpOnly`, **`SameSite=Lax`** cookie, so a `fetch` from a GitHub Pages origin
sends nothing. Choosing separate origins therefore means *building a second
credential system* — a token table, a migration, a branch inside `src/proxy.ts`,
a mint/revoke UI — in a repository with **no tests and no linter**, in the one
file where a mistake is a security bug. Plus CORS on every route touched, with
`Access-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges`
(omit it and Range fails *silently*), plus a credential sitting in `localStorage`
on a third-party origin.

Same-origin costs, on Atelier's side, **one environment variable**:
`vite.config.ts` already honours a `BASE_PATH` override, so `BASE_PATH=/atelier
npm run build` produces a build Winnow can serve under `/atelier`. The router is
hash-based, so nothing else moves. Everything then comes for free: the existing
cookie, no CORS, Range as it already works, and Winnow's role system applied
unchanged (a `viewer` reads the library, an `editor` can write back).

**How to apply**: the Winnow client takes the base URL and the auth mode as
*configuration* — `same-origin` (empty base URL, `credentials: 'include'`) or
`token` (`Authorization: Bearer`). Same-origin is what gets built and shipped; the
token flavour stays a later, optional addition for the day the GitHub Pages build
should reach a Winnow instance. Writing both shapes into the client from day one
costs a few lines and keeps the decision reversible.

### 3.2 Fidelity — two switches, opposite defaults

Winnow's proxies are made for culling, not for delivery: **720p CRF 24** for video,
**2048 px WebP** for a photo. That asymmetry sets the defaults.

- **Preview, scrubbing, the filmstrip and the stage always read the proxy.** It is
  fast, it is Range-served, and for a video it is already H.264/`yuv420p`/AAC —
  no transcode, ever. A switch ("use the real files — this costs bandwidth")
  opts into the original when the author wants to judge true quality.
- **The export reads the original by default**, with a switch to render from the
  proxy instead — for a quick test, or to avoid dragging a multi-GB rush through
  the tunnel. For a **photo** the question barely arises: 2048 px already exceeds
  a 1080×1920 post.

Both switches must be visible and stateful, not hidden defaults: an export
rendered from a 720p proxy has to *say* so, the way the rest of the codebase makes
a degraded path announce itself.

### 3.3 Still open for the maintainer

- Phase 3's document storage as a **generic opaque document bucket** in Winnow
  (`/api/apps/atelier/docs/:id`, JSON Atelier owns entirely, etag for conflict),
  so Winnow ships one endpoint pair instead of a model per Atelier feature. Cost:
  Winnow cannot *query* trips, so a trip timeline living in Winnow proper would be
  a later, real schema.
- The README's promise must be rewritten (§9). Proposed replacement, true in every
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

### 4.2 Media identity — the weak point, and the hash that fixes it

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

**Phase 0**: `SavedMediaRef` gains an optional `assetId` (Winnow's) and an optional
`hash`; resolution becomes **id → hash → name**.

The revision settles what that hash is: **not a new invention — Winnow's own
`content_hash`**, so both sides speak one identity.

```
sha256( utf8(String(size))            // the decimal size, as text
      ‖ bytes[0 .. min(65536, size))  // head window
      ‖ tail )                        // only when size > 65536
tail = bytes[size - min(65536, size - 65536) .. size)
```

`src/lib/hash.ts` in Winnow is the reference implementation; a browser reproduces
it byte-for-byte with `file.slice()` twice and `crypto.subtle.digest('SHA-256')`.
It reads **128 KiB whatever the file weighs**, so hashing a folder of multi-GB
rushes stays instant and the "listing is lazy" property of §4.5 survives.

Two consequences worth stating plainly:

- A file dragged in from a local folder and the same file fetched from Winnow
  resolve to **the same identity**, so a project moves between the two flavours
  without losing its media.
- The hash is a *partial* hash: a collision (same size, same first and last
  64 KiB, different middle) is improbable but possible — Winnow itself arbitrates
  suspected duplicates with a full-content compare (`sameContent()`), and Atelier
  should treat a hash match as strong evidence, never as proof, keeping the name
  as the tiebreak it already is.

`content_hash` needs no new endpoint: `/api/assets` selects `a.*`, so it is already
in the list response.

### 4.3 The `File` assumption — smaller than it looked

Atelier's pipeline is built on `File` objects end to end:
`buildAssets(files: File[])`, `exportVariantVideo(file, …)`,
`loadBadgeSource(file, …)`, `useTranscode(file)`, `transcode-store` keyed *by
the `File` object itself*. A remote asset is a URL, not a `File`, and a `File`
cannot be virtualised.

The split is favourable, and Winnow's existing proxies make it more so:

- **Preview, scrubbing, the filmstrip and seeking need no fetch and no `File`.**
  `<video src={url}>` takes a URL natively and seeks with Range;
  `src/shared/roadtrip/video-frames.ts` and `BadgeStage` already work by seeking
  one open video element. Winnow's video proxy is **H.264 `yuv420p` + AAC with
  `moov` at the front** (`+faststart`) — the exact shape WebCodecs decodes and
  Range seeking wants.
- **The ffmpeg.wasm transcode is not needed for Winnow media at all.** An HEVC
  rush that the browser refuses today already has an H.264 proxy on the server. The
  31 MB `unpkg` download stays a local-files-only path.
- **A RAW gets an answer for free.** Atelier's rule is that a RAW yields its image
  slot to a decodable sidecar JPEG; from Winnow, the decodable half is the **WebP
  proxy**, which exists for every asset including an ARW or a DNG with no JPEG
  beside it.
- **Only the export needs bytes.** `fetch` → `Blob` → `new File([blob], name,
  {type})` requires no downstream change at all. Stream/demux-by-range later only
  if a rush demands it — and per §3.2 the proxy switch is the cheap escape hatch
  in the meantime.

### 4.4 Document models

- `ProjectDoc` — `PROJECT_DOC_VERSION = 13`. Holds settings, overlay elements,
  guides, LUT + LUT stack, output transform, theme, scenes, the outro card, export
  prefs, and `media: { dirHandle, files: SavedMediaRef[], activeId, trims }`.
- `TripDoc` — `TRIP_DOC_VERSION = 8`. Holds stages, posts, badge words, theme,
  the CTA template and per-kind hook defaults. A `TripPost` holds its day, its
  badge, its deck slides, `projectId` and `publishedAt`.

Both are **versioned JSON with client-side migration functions** run on every
read. That is what makes a server-side store nearly free: the table is
`(id, kind, version, updated_at, json)` plus a blob column for thumbnails. No
relational modelling of overlays, ever.

A project's portable half already round-trips through `.atelier.json`
(`src/shared/projects/project-file.ts`, with its test). **Road Trip has no
equivalent** — a `.roadtrip.json` is still unbuilt, and it is the half of phase 0
that is a backup rather than an identity fix.

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

## 5. The API — what already exists, and the three small additions

The first draft proposed a REST contract to be built. Most of it exists, under
different names and with more dimensions. **Do not build §5 as it was written;
consume what is there.**

### 5.1 What Winnow already serves

```
GET /api/assets ?<filters>&cursor&limit&sort&sort_dir&collapse=1
    → { assets: [ … ], next_cursor }
      each row is `a.*` (id, filename, ext, media_type, captured_at,
      capture_date, width, height, duration_s, file_size, content_hash,
      gps_lat/gps_lon, camera_model, lens, iso/shutter/aperture/focal_length,
      gimbal_*, relative_altitude, thumb_key/proxy_key, derivative_status…)
      + verdict/star/color_label, tags[], companion/group/burst fields,
      + sidecars: [ { id, kind, filename, maxAltitude, sampleCount,
                      gimbalPitch/Yaw/Roll, maxSpeed, iso, shutter,
                      fnumber, focalLength } ]
      + has_telemetry, sidecar_count
GET /api/assets/:id            → the same row for one asset
GET /api/assets/:id/thumb      → grid thumbnail  (Range, ETag/304, S3 redirect)
GET /api/assets/:id/proxy      → culling proxy   (Range, ETag/304, S3 redirect)
GET /api/assets/:id/download   → the original, streamed (NO Range — see §6.2)
GET /api/sidecars/:id/download → one sidecar file (the DJI .srt)
GET /api/assets/calendar ?<filters>&from&to → per-day { date, count, cover_id } + bounds
GET /api/assets/geo      ?<filters>        → { id, lat, lon, video? }, capped at 10k
GET /api/facets                            → values + counts, to build filter UI
POST /api/upload  (multipart `files` + parallel `paths`) → staged import
POST /api/reconcile { root_id? }           → link finals back to their source
```

Filters (`src/lib/filter.ts`, all cumulative, all on indexed columns):
`ids`, `session_id`, `root_id`, `kind`, `media_type`, `ext`, `device`,
`camera_model`, `lens`, `verdict`, `star_min`, `tags`/`not_tags`,
`derivative_status`, `processing_state`, `paired`, `group_kind`, `stacked`,
`burst_id`, `burst_kind`, `is_edit`, `has_edit`, `place_*`, `has_place`,
`person`, `has_faces`, `has_text`, `ml_status`, `near_dup`,
**`date_from` / `date_to`**, `year`/`month`/`day`, `iso_*`, `aperture_*`,
`focal_*`, `size_*`, `sharpness_*`, **`has_gps`**, **`bbox`** (antimeridian-aware),
`q` (free-text path search).

Pagination is **keyset on `(captured_at, id)`**, never `OFFSET`.

The date-range-first priority from the first draft holds and is already satisfied:
Road Trip is day-keyed, and `/api/assets/calendar` returns *exactly* the per-day
count + cover that the Road Trip grid draws.

### 5.2 The three additions

1. **Range on `/api/assets/:id/download`.** The derivatives already do it; the
   originals do not (`src/app/api/assets/[id]/download/route.ts` streams the whole
   file with `Content-Disposition: attachment`). Copying the 206 branch of
   `src/lib/serve.ts` is a small, boring diff — the kind Winnow's test-free gate
   can absorb. Wanted for: a real-quality preview (§3.2's switch), and any future
   demux-by-range on export.
2. **`GET /api/capabilities`.** A tiny probe: which of these exist on *this*
   deployment (sidecar serving, Range on originals, the doc bucket, the storage
   driver), plus the role of the caller. It lets Atelier degrade with a sentence
   ("this Winnow does not serve sidecars") instead of guessing — the same rule the
   rest of the codebase follows, where a feature that cannot work says why.
3. **The opaque document bucket** (phase 3): one migration and one route pair,
   `GET`/`PUT /api/apps/atelier/docs/:id`, JSON Atelier owns entirely, an etag that
   **refuses** a stale write. Scoped to the authenticated user, since Winnow is
   already multi-user.

---

## 6. The technical risks, re-ordered against what is now known

### 6.1 Winnow has no tests and no linter

The whole verification gate is `typecheck` + `migrate` + `build`. Every Winnow-side
diff in this bridge must stay **tiny and boring**, and must not land in
`src/proxy.ts` or `src/lib/auth*.ts` unless there is no alternative — which is a
second reason to prefer same-origin (§3.1), where the answer is *no Winnow auth
change at all*.

Two housekeeping facts for whoever writes a migration: **two duplicate migration
prefixes already sit on Winnow's `main`** (`0010_*` ×2, `0013_*` ×2) and are a
known open item there; the next free number is **0040**. Migrations are
append-only and uniquely numbered — read `db/migrations/README.md` first.

### 6.2 Range on the originals is missing

Solved for the derivatives, absent for `/api/assets/:id/download`. Nothing in the
first phases *breaks* without it — preview reads proxies, export fetches the whole
file — but the "use the real files" switch of §3.2 and any later demux-by-range
both want it. See §5.2.1.

### 6.3 The tunnel is the pipe for everything

Originals live on a NAS reached through Traefik + a Cloudflare Tunnel. Pulling a
multi-GB rush per export is bandwidth, not architecture, but it is felt — that is
what the proxy switch of §3.2 exists for. On the write-back side (§7 phase 2),
check the deployment's **request body limit** before assuming a rendered file will
POST: a Road Trip reel is typically tens of MB and fine, an ungraded rush is not.

### 6.4 The token flavour, if it is ever built

It drops a credential into `localStorage` on a third-party origin, XSS-exposed. If
it happens: **scoped, revocable, read-only until phase 2** — and stated in the UI,
not discovered. This is the reason same-origin ships first.

### 6.5 Winnow ids must never become the *only* identity

Unchanged from the first draft, and the most important line in it. A document has
to stay openable with plain local files, or the public flavour dies. The
`content_hash` of §4.2 is what makes that cheap: the same media resolves either
way.

**No longer risks**: sidecars (first-class rows, §1), and Range on the derivatives
(done, with `ETag`/304 on top).

---

## 7. The phased plan

| Phase | What | Where | Value if you stop there |
|---|---|---|---|
| **0** | `SavedMediaRef` gains `assetId?`/`hash?`; resolve **id → hash → name**; the hash is Winnow's `content_hash`, computed client-side (§4.2) in a small pure module with a test. Plus the missing `.roadtrip.json` portable export | Atelier only, no Winnow needed | Projects stop losing media on a rename; both flavours already speak one identity before any bridge exists |
| **1** | `src/shared/sources/winnow/` — client (base URL + auth mode as config), settings panel with "test connection", "Add from Winnow" beside "Add files", a date-range browser over `/api/assets/calendar`. Preview on proxies, export by fetch-to-Blob, the two switches of §3.2 | Atelier only — **no new Winnow read endpoints** | The triage → edit hop stops being manual |
| **2** | Write-back: `POST /api/upload` the render into a **finals** root, then let `/api/reconcile` link it to its source | Atelier + (optionally) one field on `/api/upload` | Winnow's map, calendar and before/after lineage show which captures have been told |
| **3** | Extract `ProjectStore`/`TripStore` interfaces; `remote-store.ts`; boot-time `/api/capabilities`; stale-write guard | Atelier + migration 0040 + one route pair | Projects resumable from another device |
| **4** | Optional: an edit-grade proxy rendition, a trip timeline in Winnow proper, background exports | Both | The "little Adobe cloud" |

**Phase 0 stays the one to start regardless of everything else**: client-only, a
win under every scenario, and it makes phases 1–3 cheap.

**Phase 2 has no new model to design.** Winnow already carries the lineage the
first draft was going to invent: `assets.original_asset_id`, finals roots walked
view-only, `/api/reconcile` (idempotent, retroactive, tool-agnostic),
`has_edit`/`is_edit` filters, and `/api/assets/:id/exports`. One caveat decides the
implementation: **reconcile matches on basename + capture time**
(`src/lib/reconcile.ts`), refusing to guess when several captures are plausible. So
either Atelier's export keeps the source basename, or `/api/upload` gains an
optional explicit `original_asset_id` — the second is more honest and is a
three-line change. `POST /api/upload` already preserves a relative path per file,
so a render and its own sidecar would stay together.

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

*Note*: rejecting A is **not** the same as rejecting same-origin serving (C).
Winnow serving Atelier's built assets under a path leaves the two codebases,
deployments and repositories entirely separate.

### B — Winnow borrows nothing; Atelier just gets more robust locally

*Pros*: free.

*Cons*: does not give him the query, the map, the single instance or the
multi-device resumability he asked for. Kept only as the fallback baseline —
and phase 0 delivers its useful half anyway.

### C — Same origin (Winnow serves Atelier's build at `/atelier`) — **now the chosen one**

Rejected in the first conversation in favour of separate origins with token auth.
**Reversed on 2026-08-29**: that choice assumed Winnow had, or could cheaply have,
a cross-origin credential. It has `SameSite=Lax` cookie sessions and nothing else,
so "separate origins" quietly meant "write a second auth system in a repo with no
tests". Same-origin costs one `BASE_PATH` env var on Atelier's side and a serving
step on Winnow's, and hands back the cookie, CORS, Range and the role model for
free. See §3.1. The client is still written so base URL and auth mode are
configuration, so the token flavour remains one adapter away.

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

## 10. Questions answered, and the two that remain

Answered by reading Winnow (details and paths in §1 and §5):

1. **Range on the original bytes?** Yes on the derivatives, no on the originals.
2. **Sidecars modelled?** First-class, base-name matched, DJI `.srt` included, and
   already inlined in the list response.
3. **A content hash?** `assets.content_hash`, and phase 0 adopts it verbatim.
4. **What auth?** `SameSite=Lax` cookie sessions with viewer/editor/admin roles;
   no Bearer — which is what reversed the origin decision.
5. **Proxies?** Already generated for every asset, and the video one is exactly
   the codec shape Atelier wants.
6. **Anywhere for opaque documents?** No — phase 3 needs migration 0040 and one
   route pair.
7. **Winnow's own trip/timeline concept?** None. It has shoot *sessions* and a
   calendar aggregate. Road Trip keeps the calendar, the coverage grid and the
   published state; phase 2's write-back is what makes them visible from the media
   side, which is the cheap answer to "which side owns it".

Still open:

- **How does the `/atelier` build reach Winnow?** A step in Winnow's `Dockerfile`,
  a mounted volume, or a release artefact fetched at build time. This is a
  deployment decision for the Winnow repo, and the only real cost of §3.1.
- **Does phase 4 want an edit-grade proxy of its own** (1080p, low CRF), or is
  "original by default, 720p proxy on demand" enough? Raising
  `VIDEO_PROXY_HEIGHT` is one env var but re-encodes the whole library for a
  purpose that is not culling; a second rendition is a column, a migration and a
  worker job. Not needed before phase 4.

---

## 11. Path cheat-sheet

**Atelier** (this repository)

```
src/app/tools.tsx                       the tool registry (nav + routes)
src/app/use-hash-route.ts               hash router + isWithinRoute guard
vite.config.ts                          BASE_PATH override — the /atelier build
src/shared/sources/file-sources.ts      SEAM A — the only file-access brick
src/shared/sources/write-files.ts       export-to-folder (File System Access)
src/shared/library/assets.ts            File[] → grouped Assets, by base name
src/shared/library/AssetLibraryContext  the app-wide pool, addFiles/setActive
src/shared/projects/project-types.ts    ProjectDoc (v13), SavedMediaRef
src/shared/projects/project-file.ts     the .atelier.json portable half
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

**Winnow** (`~/Documents/GitHub/winnow`, repo `CostardRouge/winnow`)

```
src/proxy.ts                            the request guard — session → role
src/lib/authz.ts                        the (method, path) → minimum role map
src/lib/auth.ts                         sessions, invites, scrypt hashing
src/lib/serve.ts                        derivative serving: Range, ETag, S3 redirect
src/lib/hash.ts                         partialHash — the shared identity
src/lib/video.ts                        ffmpeg proxy: H.264 yuv420p + AAC + faststart
src/lib/derivatives.ts                  photo thumb/proxy (WebP), job chaining
src/lib/sidecars.ts                     base-name sidecar detection (xml/thm/srt)
src/lib/srt.ts                          DJI flight-log parsing
src/lib/filter.ts                       every query dimension, as Zod + SQL
src/lib/assetQuery.ts                   GRID_SELECT — what an asset row carries
src/lib/reconcile.ts                    finals → sources lineage
src/lib/storage/                        the S3-shaped driver (disk | s3)
src/app/api/**                          ~90 routes; README.md tabulates them all
db/migrations/                          append-only, uniquely numbered (next: 0040)
docs/memory/                            that repo's long-term memory
docs/ARCHITECTURE-REVIEW.md             its own graded weaknesses + P1 backlog
```

**Verification note for whoever builds this**: the cloud container used for this
work has **no H.264 encoder** (`VideoEncoder.isConfigSupported` reports vp8/vp9
only), so an end-to-end export cannot be driven there. UI, arithmetic and
wiring can be verified in headless Chromium; the encode itself must be checked
on a real machine.
