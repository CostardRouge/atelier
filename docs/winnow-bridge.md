# Atelier × Winnow — bridge brief

**Status**: phases 0, 0.5 and 1 built (2026-09-01), phase 1 not yet proven end to
end on the deployed pair — see `MEMORY.md` open items.
Written 2026-08-24 with only Atelier to hand · revised 2026-08-29 against the
Winnow repository · **rewritten 2026-08-31 around the source model.**

**What this is.** A self-contained brief for the conversation that will build the
bridge. Every claim about **Atelier** and about **Winnow** was checked against the
code, with the file path given so it can be re-verified rather than believed.

**Why it was rewritten.** The first two drafts framed the problem as *connecting
two apps*. The maintainer's ambition is wider — Atelier becomes a stateful
application, Road Trip eventually proposes and reminds, and a Winnow may one day
live on someone else's NAS. Framed that way the answer changes shape: what is
being designed is not a connector but a **source model**, of which "the files on
this machine" is the first instance. That reframing is §3, and it is the centre of
this document.

Two things are **deliberately not built now** and appear only so the seam does not
preclude them: **several Winnow instances** and **scheduled/proactive work**. Both
are marked *later* throughout.

---

## 1. The two projects

### Atelier — what it is today (verified)

A local-first suite of browser tools for photo/video captures. React 18 +
TypeScript 5.7 + Vite 6 + Tailwind v4. **No backend, no account, nothing
uploaded.** Deployed as a static site to GitHub Pages. Package manager: npm.

Nine tools, all driven by one registry (`src/app/tools.tsx`): `studio`,
`roadtrip`, `telemetry`, `overlay`, `map`, `composer`, `exif`, `compare`, `lut`.
The stated direction is that they converge into the single `studio` editor.

What matters here:

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
  (`#/studio/open/<id>`) that **rewrites itself on arrival**. One Studio export
  then carries grade + telemetry + hook. This is the precedent for how parts of
  this stack talk: **through a document and a route, never by reaching into each
  other's state.**

### Winnow — what it is (verified 2026-08-29)

One photographer's ingest → cull → export pipeline over a home NAS. **Next.js 16
(App Router) + React 19 + Postgres + Redis/BullMQ + ffmpeg/sharp/exiftool**,
TypeScript, npm, **no test suite and no linter** — the whole gate is
`typecheck` + `migrate` + `build`. Deployed push-to-`main` → ghcr image →
Watchtower on an Optiplex, behind Traefik + a Cloudflare Tunnel, at
`winnow.steeve.website`.

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
- It already runs **Redis + BullMQ with nine queues and a worker process** — which
  is why the *later* scheduling story (§3.5) has somewhere obvious to live.
- It carries a `sessions` concept (a shoot folder with triage progress), faces,
  people, places, gear, bursts — and **no trip/journey concept**.

The five properties that decide this bridge, each with its path:

| Property | Where | What it means here |
|---|---|---|
| **Range on the derivatives** | `src/lib/serve.ts` | 206 + `Content-Range` + `Accept-Ranges`, `ETag`/304 answered before any storage round-trip, signed redirect on S3. A `<video>` can seek a proxy properly. |
| **Sidecars are rows, not files on the side** | migrations `0015_video_sidecars.sql`, `0017_srt_sidecars.sql`, `src/lib/sidecars.ts` | `asset_sidecars`, `kind IN ('xml','thm','srt')`, detected **by shared base name** — the same rule as Atelier's `buildAssets` — and carried with the clip through import, export and purge. |
| **A content hash per asset** | `assets.content_hash` (UNIQUE), `src/lib/hash.ts` | `sha256(String(size) ‖ first 64 KiB ‖ last 64 KiB)`. Reproducible in a browser from a `File` with two `slice()`s and WebCrypto. |
| **Proxies for everything, already** | `src/lib/video.ts`, `src/lib/derivatives.ts` | Video: libx264 `yuv420p` + AAC 128k + `+faststart`, `VIDEO_PROXY_HEIGHT=720`, `CRF 24`. Photo: WebP, `PROXY_SIZE=2048`, quality 80. |
| **Cookie sessions, no Bearer** | `src/proxy.ts`, `src/lib/auth.ts`, `src/app/api/auth/login/route.ts` | 256-bit token; `httpOnly`, **`sameSite: 'lax'`**, `secure`, `path: '/'`, **no `domain`** → host-only. Sliding 30 days, only its SHA-256 in Postgres. No Bearer path anywhere, and **no CSRF token** — `SameSite` is the whole protection. |

And the DJI case, which is Atelier's founding one, is already understood
server-side: `src/lib/srt.ts` parses the flight log, and migrations `0024` /
`0027` / `0028` materialise a representative GPS fix, peak altitude, sample count,
gimbal attitude, peak speed and the clip's exposure onto the sidecar row (the
photo equivalent lands on `assets` directly, from `drone-dji:*` EXIF). **The full
cue stream stays in the `.srt` file** — Winnow summarises, it does not replace the
log, which is exactly what Atelier needs: fetch the sidecar, parse it with the
parser it already has.

---

## 2. The ambition this has to serve

In the maintainer's words:

- The stack is **modular**: `winnow` = triage, `atelier` = edit and export. Long
  term, *"my own little Adobe cloud"* — his own tools for his own captures,
  removing the friction of expensive desktop applications.
- Winnow becomes an **official media source** for Atelier.
- Atelier should exist in several flavours: public / browser / local-first, **and**
  a persistent one where **projects are resumable from another device**.
- **Atelier will grow into a full stateful application.** Road Trip in particular
  deserves autonomous behaviour eventually — proposing a project or an edit,
  reminding him to publish.
- **A Winnow may one day sit on another photographer's NAS.** He grants this may
  never actually be needed — a photographer rarely asks someone else to cut their
  footage — but the architecture must not forbid it.
- On the file-rename fragility: he **amplified** it; it is not the real problem.
  What he values is *"a project that doesn't lose track of what was added, where
  we were"*.

Immediate need, and the reason any of this exists: ~3.5 months of Australia drone
footage and ~2 500 shareable photos, almost nothing published in over a year, and
a wish to publish regularly. Road Trip exists to make that tractable.

**Design consequence.** Two of these — several instances, and proactive/scheduled
work — are *later*. They are not phases in §7. They appear in this document only
as constraints on the seam being built now, because both become expensive
refactors if the seam ignores them and nearly free if it does not.

---

## 3. The architecture — sources

### 3.1 A source is not a media pool

The earlier drafts had two independent seams: where media comes from, and where
documents live. The ambition merges them.

> A **source** is a place where **projects, state and (later) scheduled work**
> live. `local` is one — browser storage, no scheduler. A Winnow instance is
> another — its Postgres, its worker, its notifications.

The move that makes everything else fall out: **`local` stops being the special
case and becomes source #1.** Its media adapter is the File System Access API, its
document adapter is IndexedDB, its `scheduling` capability is `false`. Everything
else is uniform behind the same contract.

```ts
interface Source {
  id: string;                 // stable, local-only; the user may rename the label
  label: string;              // the origin as-is: "local" | "winnow.steeve.website"
  kind: 'local' | 'winnow';
  capabilities: SourceCapabilities;   // §3.5
  media: MediaAdapter;        // list / query / bytes / sidecars
  documents: DocumentStore;   // list / get / put / delete — today's 4 signatures
}
```

The maintainer's own sketch of the finished gallery is then not decoration, it is
the data model showing through:

```
source: local                          3 projects
source: winnow.steeve.website (remote) 18 projects
source: mika.dm-consulting.tech (remote) 4 projects
```

Grouping is `groupBy(source.id)`. **Build the grouping while there is one group** —
that is the cheap half of the whole idea.

House rule, applied here: a source that cannot be reached shows its projects
**greyed with the reason**, never hidden — the same honesty as the battery gauge
drawing `—` rather than inventing a level.

### 3.2 The four invariants

1. **Atelier is a client, never a host.** It ships as a static app with no
   database and no server state. Everything persistent lives either in the user's
   browser or on a server the user owns. This is what makes "resumable from
   another device", and later the proactive features, possible **without Atelier
   becoming a cloud** — no custody of anyone's media, no storage bill, no account
   system.
2. **A project belongs to exactly one source**, and its media live in that same
   source. No cross-source project, ever. This is the limit that makes several
   instances tractable: it removes sync, merge and conflict resolution entirely.
   Crossing sources is an explicit export/import through the portable file
   (`.atelier.json`, already built in `src/shared/projects/project-file.ts`; the
   Road Trip twin `.roadtrip.json` is still missing).
3. **A source id is never the only identity.** A document must stay openable with
   plain local files, or the public flavour dies. §4.2's `content_hash` is what
   makes that cheap — the same media resolves from a folder or from any instance
   holding it.
4. **Statefulness never introduces a second writer.** Invariant 2 is what enforces
   it. Where a stale write is still possible (the same project open on two
   devices), the answer is an etag that **refuses** and says so — not a sync
   engine.

### 3.3 Topology is configuration, not a decision

This is where the two earlier drafts each got it half-wrong, so the facts first.
`SameSite` is judged on the **site** (the registrable domain), not the origin. The
cookie is host-only for `winnow.steeve.website`, so what matters is whether the
*caller's* site matches.

| Atelier is served from | Origin | Site | Cookie travels? | Cost |
|---|---|---|---|---|
| `winnow.steeve.website/atelier` | same | same | **yes**, free | the build must land inside Winnow's image or a mounted volume |
| **`atelier.steeve.website`** (custom domain, even on GitHub Pages) | cross | **same** | **yes**, with CORS | a CORS header block on Winnow; **no credential system at all** |
| `*.github.io`, or any foreign instance | cross | **cross** | no | a Bearer credential (§3.6) |

Consequences, in order of usefulness:

- **Near term, the auth work can be deferred entirely.** Point
  `atelier.steeve.website` at the existing GitHub Pages build (a CNAME; `BASE_PATH=/`
  is already supported by `vite.config.ts`) and Winnow needs *only* a CORS
  allowlist. No token, no table, no branch in `src/proxy.ts`. That is the
  recommended first move.
- Same-origin serving stays valid and is the cheapest of all — but it is an
  optimisation **for a single owner**, not the architecture: it cannot serve one
  public Atelier against N instances.
- The client must therefore treat base URL and auth mode as **configuration**, and
  support all three shapes. That costs a few lines now and keeps every option open.

The CORS block itself, once, and precisely: an **explicitly allowlisted origin**
(never a `*.steeve.website` pattern), `Vary: Origin`,
`Access-Control-Allow-Credentials: true`, preflight handling, and
`Access-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges` —
**omit that last one and Range fails silently**, the worst failure mode available.

Security note to state rather than discover: Winnow has **no CSRF protection** and
relies entirely on `SameSite=Lax`. Allowing credentialed cross-origin requests does
not let a third-party site *read* responses (CORS blocks that), but it widens the
surface. The single-exact-origin allowlist is what holds; a subdomain wildcard is
not acceptable.

### 3.4 Connecting — no boot ping, ever

Atelier boots with **zero network**. That is correct by default, it keeps the
product promise (§9) literally true, and it is the only sane behaviour for a public
app that must not phone anywhere.

Connection is an explicit, one-time user act:

```
1. Winnow's app rail links to
   atelier.steeve.website/#/connect?instance=https://winnow.steeve.website
2. Atelier shows: "winnow.steeve.website wants to connect. Allow?"
   ← nothing has been sent yet
3. On confirm: store the source, fetch /api/capabilities ONCE, cache it.
4. Afterwards deep-links address an ALREADY-TRUSTED source:
   #/studio/new?source=<id>&assets=1234,1235
   An unknown instance falls back to the confirmation screen — never a silent fetch.
```

This also resolves the rule that would otherwise be violated — *the URL may say
**what** to open, never **where** to fetch from*. In a multi-instance world the URL
must name a server, so it **proposes** one and the user's confirmation turns an
injection vector into a decision. It is the "enter your instance" flow every
federated client uses.

Network cost: one fetch on connect, one on explicit refresh. None at boot.

The reverse direction is where the real value sits: **contextual deep-links from
Winnow's own surfaces** — "Edit in Atelier" on an asset, on a selection, on a day
in the calendar — not a generic launcher. That is a verb attached to media the user
is already looking at, and it mirrors the existing Road Trip → Studio hop exactly.

**Not an iframe.** Embedding is technically possible but `showDirectoryPicker` is
refused in a cross-origin iframe, which kills Atelier's front door for local files;
downloads, fullscreen and permissions all then need negotiating too. Atelier could
detect `window.self !== window.top` and hide its own chrome — cheap, and worth
keeping in reserve for a small *panel* inside Winnow one day — but it is cosmetics
over a structural cost. A link does 95 % of the work with none of it.

### 3.5 What a source declares — and where *later* is bounded

`GET /api/capabilities` is the contract, not the documentation. It is what lets
instances on different versions coexist, and what lets Atelier degrade with a
sentence instead of guessing.

```
{ api: { version },
  auth: { methods: ['cookie'] },        // later: 'token', 'oauth2'
  media:     { sidecars, rangeOnOriginals, proxies: { video, photo } },
  documents: { bucket },                 // phase 3
  scheduling:{ reminders },              // LATER — false today, and that is fine
  limits:    { maxUploadBytes },         // matters behind a tunnel
  viewer:    { role } }                  // can this caller even write back?
```

**Scheduling — later, and the shape it must keep.** A browser cannot do reminders
reliably: Periodic Background Sync is Chromium-only, needs an installed PWA and is
throttled to the point of no guarantee; Web Push needs a server that pushes. So
proactive Road Trip behaviour cannot live in the tab — but it does not require
Atelier to host anything either. The rule that keeps modularity intact:

> **Winnow stays ignorant.** It stores JSON it does not understand (the phase-3
> document bucket) and offers a *generic* "notify me at T with payload P". It never
> learns what a Road Trip is. Winnow already runs Redis + BullMQ + a worker, and
> would hold the VAPID keys as the push sender — generic infrastructure, useful to
> any tool in the stack.

Its honest limit, worth stating before it is discovered: **the reminder fires from
the server, the proposal is computed when Atelier opens.** For the actual need —
not letting months pass unpublished — that is enough.

Nothing of this is built now. It appears here so that `capabilities` has the field
and `local` can answer `scheduling: false` with a reason, instead of a broken
button appearing later.

### 3.6 Auth in three additive steps

| When | What | Cost |
|---|---|---|
| **Now** | Same-site cookie + CORS allowlist (§3.3) | A header block on Winnow. **No credential system.** |
| When a foreign instance appears | **Personal token**: scoped, revocable, read-only until write-back | One table, one settings page, one `Authorization: Bearer` branch in `src/proxy.ts` |
| Later still | **OAuth 2.0 authorization code + PKCE** | Winnow already has sessions, login and roles, so the authorize page reuses the session: "atelier.steeve.website requests read access — Allow?" No password ever touches Atelier; revocable per app. Where Nextcloud, Immich and Home Assistant all land. |

The point of the ordering: **the guard accepts `Authorization: Bearer` regardless
of how the token was minted**, so OAuth later adds a *minting path*, not a second
auth system. Building an authorization server today for an audience of one is the
over-engineering that kills projects.

If a token flavour does ship: it lives in browser storage and is XSS-exposed. Say
so in the UI rather than letting it be discovered, and keep it read-only until
write-back genuinely needs more.

---

## 4. Atelier's anatomy that matters

### 4.1 The two adapters behind a source

**Media** — `src/shared/sources/file-sources.ts`, whose own header declares it
*"the ONLY brick that changes for a native shell"*. Four browser entry paths
(Chromium `showDirectoryPicker`, `<input webkitdirectory>`, a multi-file picker,
drag-and-drop) all converge on `Promise<File[]>`. Nothing downstream knows where
files came from. This becomes the `local` source's media adapter; a Winnow adapter
is its peer.

**Documents** — two hand-rolled IndexedDB stores, ~100 lines each, identical in
shape:

| Store | Database | API |
|---|---|---|
| `src/shared/projects/project-store.ts` | `atelier-studio` | `listProjects` · `getProject` · `putProject` · `deleteProject` · `requestPersistentStorage` |
| `src/shared/roadtrip/trip-store.ts` | `atelier-roadtrip` | `listTrips` · `getTrip` · `putTrip` · `deleteTrip` + `putThumb` · `getThumbs` · `deleteThumbs` |

Both **degrade instead of throwing**: a failed read returns `[]`/`null`, a failed
write returns `false`, and the UI says so out loud. A remote implementation is four
HTTP calls behind the same four signatures — which is exactly why the `Source`
contract costs so little to introduce.

### 4.2 Media identity — the weak point, and the hash that fixes it

```ts
// src/shared/projects/project-types.ts
export interface SavedMediaRef {
  name: string;
  size: number;
  lastModified: number;
}
```

- `src/shared/projects/reconcile.ts` matches saved refs against what a folder holds
  *now*, **by lowercased file name**. Same name + different size/mtime → `changed`;
  no name match → `missing`.
- `src/shared/library/assets.ts` groups files into *assets* keyed by **lowercased
  base name**, so `DJI_0001.MP4` + `DJI_0001.SRT` become one `video+telemetry`
  asset — the same rule Winnow's `sidecars.ts` uses.
- Road Trip refuses to key on names at all: a post records the **day** it tells,
  because exports get renamed and re-graded between tools.

**Phase 0**: `SavedMediaRef` gains an optional `assetId` and an optional `hash`;
resolution becomes **id → hash → name**. The hash is **not invented — it is
Winnow's own `content_hash`**:

```
sha256( utf8(String(size))            // the decimal size, as text
      ‖ bytes[0 .. min(65536, size))  // head window
      ‖ tail )                        // only when size > 65536
tail = bytes[size - min(65536, size - 65536) .. size)
```

`src/lib/hash.ts` in Winnow is the reference; a browser reproduces it byte-for-byte
with two `file.slice()`s and `crypto.subtle.digest('SHA-256')`. It reads **128 KiB
whatever the file weighs**, so the laziness of §4.5 survives.

Consequences: a file dragged from a folder and the same file fetched from an
instance resolve to **one identity** — which is what stops a project being welded
to a single NAS (invariant 3). And because it is a *partial* hash, a collision is
improbable but possible: Winnow itself arbitrates suspected duplicates with a
full-content compare (`sameContent()`), so Atelier should treat a hash match as
strong evidence and keep the name as the tiebreak it already is.

No new endpoint needed: `/api/assets` selects `a.*`, so `content_hash` is already
in the list response.

### 4.3 The `File` assumption — smaller than it looked

Atelier's pipeline is built on `File` end to end: `buildAssets(files: File[])`,
`exportVariantVideo(file, …)`, `loadBadgeSource(file, …)`, `useTranscode(file)`,
`transcode-store` keyed *by the `File` object itself*. A remote asset is a URL, and
a `File` cannot be virtualised. The split is favourable, and Winnow's proxies make
it more so:

- **Preview, scrubbing, the filmstrip and seeking need no fetch and no `File`.**
  `<video src={url}>` seeks with Range; `src/shared/roadtrip/video-frames.ts` and
  `BadgeStage` already work by seeking one open element. Winnow's video proxy is
  **H.264 `yuv420p` + AAC with `moov` at the front** — the exact shape WebCodecs
  decodes.
- **ffmpeg.wasm is not needed for remote media at all.** An HEVC rush the browser
  refuses already has an H.264 proxy on the server; the 31 MB `unpkg` download
  stays a local-files-only path.
- **A RAW gets an answer for free.** Atelier's rule is that a RAW yields its image
  slot to a decodable companion; from a Winnow the decodable half is the **WebP
  proxy**, which exists even for an ARW with no JPEG beside it.
- **Only the export needs bytes.** `fetch` → `Blob` → `new File([blob], name,
  {type})` requires no downstream change. Demux-by-range later, only if a rush
  demands it.

**Fidelity — two switches, opposite defaults.** Winnow's proxies are made for
culling, not delivery (720p CRF 24 video; 2048 px WebP photo):

- **Preview always reads the proxy**, with a switch to pull the real file ("this
  costs bandwidth") when true quality must be judged.
- **Export reads the original by default**, with a switch to render from the proxy
  — for a fast test, or to avoid dragging a multi-GB rush through the tunnel. For a
  photo the question barely arises: 2048 px already exceeds a 1080×1920 post.

Both switches must be visible and stateful: an export rendered from a 720p proxy
has to *say* so.

### 4.4 Document models

- `ProjectDoc` — `PROJECT_DOC_VERSION = 13`. Settings, overlay elements, guides,
  LUT + LUT stack, output transform, theme, scenes, the outro card, export prefs,
  and `media: { dirHandle, files: SavedMediaRef[], activeId, trims }`.
  **Phase 0.5 adds `sourceId`.**
- `TripDoc` — `TRIP_DOC_VERSION = 8`. Stages, posts, badge words, theme, the CTA
  template, per-kind hook defaults. A `TripPost` holds its day, its badge, its deck
  slides, `projectId` and `publishedAt`.

Both are **versioned JSON with client-side migrations** run on every read. That is
what makes a remote store nearly free: the table is `(id, kind, version,
updated_at, json)` plus a blob column for thumbnails. No relational modelling of
overlays, ever.

A project's portable half already round-trips through `.atelier.json`
(`src/shared/projects/project-file.ts`, with its test). **Road Trip has no
equivalent** — `.roadtrip.json` is unbuilt, and it is the half of phase 0 that is a
backup rather than an identity fix. Invariant 2 makes it load-bearing: it is how a
project crosses sources.

### 4.5 The asset library

`src/shared/library/` holds one app-wide pool of `File` handles;
`AssetLibraryContext` exposes `assets`, `addFiles(files)`, `setActive(id)`,
`remove`, `clear`. Each tool declares the `AssetKind`s it `accepts`
(`'video+telemetry' | 'video' | 'telemetry' | 'photo' | 'other'`) and
`capabilities.ts` projects the pool down to those. **Only handles are held; nothing
is read eagerly** — listing 50 multi-GB videos is instant. A remote adapter must
preserve that: list metadata, fetch bytes only when something is opened.

---

## 5. Winnow's API — what exists, and the additions

The first draft proposed a REST contract to be built. Most of it exists, under
different names and with more dimensions. **Do not build it; consume what is
there.**

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
GET /api/assets/:id/download   → the original, streamed (NO Range — see §5.2)
GET /api/sidecars/:id/download → one sidecar file (the DJI .srt)
GET /api/assets/calendar ?<filters>&from&to → per-day { date, count, cover_id } + bounds
GET /api/assets/geo      ?<filters>        → { id, lat, lon, video? }, capped at 10k
GET /api/facets                            → values + counts, to build filter UI
POST /api/upload  (multipart `files` + parallel `paths`) → staged import
POST /api/reconcile { root_id? }           → link finals back to their source
```

Filters (`src/lib/filter.ts`, cumulative, all on indexed columns): `ids`,
`session_id`, `root_id`, `kind`, `media_type`, `ext`, `device`, `camera_model`,
`lens`, `verdict`, `star_min`, `tags`/`not_tags`, `derivative_status`,
`processing_state`, `paired`, `group_kind`, `stacked`, `burst_id`, `burst_kind`,
`is_edit`, `has_edit`, `place_*`, `has_place`, `person`, `has_faces`, `has_text`,
`ml_status`, `near_dup`, **`date_from` / `date_to`**, `year`/`month`/`day`,
`iso_*`, `aperture_*`, `focal_*`, `size_*`, `sharpness_*`, **`has_gps`**,
**`bbox`** (antimeridian-aware), `q` (free-text path search).

Pagination is **keyset on `(captured_at, id)`**, never `OFFSET`.

Date-range-first is already satisfied: Road Trip is day-keyed, and
`/api/assets/calendar` returns *exactly* the per-day count + cover the Road Trip
grid draws.

### 5.2 The additions, in the order they are needed

1. **CORS** (§3.3) — the only thing phase 1 requires.
2. **`GET /api/capabilities`** (§3.5) — small, and it is what makes every later
   step discoverable instead of hardcoded.
3. **Range on `/api/assets/:id/download`.** The derivatives already do it; the
   originals do not (`src/app/api/assets/[id]/download/route.ts` streams whole,
   `Content-Disposition: attachment`). Copying the 206 branch of `src/lib/serve.ts`
   is a small, boring diff — the kind a test-free gate can absorb.
4. **The opaque document bucket** (phase 3): migration **0040** and one route pair,
   `GET`/`PUT /api/apps/atelier/docs/:id`, JSON Atelier owns entirely, an etag that
   **refuses** a stale write, scoped to the authenticated user.
5. **A versioned public surface — `/api/v1/…` — before any foreign instance
   exists.** Today the API is internal and unversioned, and `GRID_SELECT` is
   `a.*`, so `/api/assets` returns **`abs_path`, the absolute NAS path**, to any
   viewer. Acceptable internally. Unacceptable as a published contract: it leaks,
   and it breaks the moment a column is added. An explicit projection is the
   boundary, and changing it later breaks other people's Atelier — which is why it
   is listed here even though it is *later* work.

---

## 6. Risks, in the order they bite

1. **Winnow has no tests and no linter.** The gate is `typecheck` + `migrate` +
   `build`. Every Winnow-side diff must stay tiny and boring, and should avoid
   `src/proxy.ts` / `src/lib/auth*.ts` while an alternative exists — which is a
   second reason the same-site + CORS route (§3.3) is the right first move: it
   touches no credential path at all. Housekeeping for whoever writes SQL: **two
   duplicate migration prefixes already sit on Winnow's `main`** (`0010_*` ×2,
   `0013_*` ×2), migrations are append-only and uniquely numbered, and the next
   free number is **0040** — read `db/migrations/README.md` first.
2. **CORS with credentials widens a surface with no CSRF protection.** Single
   exact origin, never a wildcard. And the expose-header omission that makes Range
   fail *silently* is the single most likely mistake in this whole project.
3. **The tunnel is the pipe for everything.** Originals live on a NAS behind
   Traefik + a Cloudflare Tunnel. Per-export multi-GB pulls are felt — that is what
   the proxy switch exists for. On write-back, check the deployment's **request
   body limit** before assuming a render will POST; a reel is tens of MB and fine,
   a rush is not. `capabilities.limits.maxUploadBytes` is how Atelier learns this
   instead of failing at 90 %.
4. **Range on originals is missing** — nothing in phases 0–2 breaks without it, but
   the "real files" switch and any later demux want it.
5. **A source id must never become the only identity** (invariant 3). The most
   important line in this document, and `content_hash` is what makes obeying it
   cheap.
6. **Statefulness is where local-first projects die.** Invariant 2 is the guard;
   an etag that refuses is the fallback. Do not build a sync engine.

**No longer risks**: sidecars (first-class rows), Range on the derivatives (done,
with `ETag`/304), and the token-in-`localStorage` problem — deferred out of the
near term entirely by §3.3.

---

## 7. The phases

| Phase | What | Where | Value if you stop there |
|---|---|---|---|
| **0** | `SavedMediaRef` gains `assetId?`/`hash?`; resolve **id → hash → name**; the hash is Winnow's `content_hash` (§4.2) in a small pure module with a test. Plus the missing `.roadtrip.json` portable export | Atelier only | Projects stop losing media on a rename; both flavours already speak one identity, and a project can cross sources |
| **0.5** | Introduce `Source` with **exactly one implementation (`local`)**: the contract, `ProjectDoc.sourceId`, and a gallery that **groups by source even with one group** | Atelier only | The seam that makes everything below a data question instead of a refactor. Cheap now, expensive later |
| **1** | **Built.** `src/shared/sources/winnow/` — client (base URL + auth mode as config), the `#/connect` flow, "from <host>" in the library sidebar, a day browser over `/api/assets/calendar`. A picked asset is **fetched and wrapped as a `File`** (proxy by default, original on request, `.srt` alongside) rather than previewed by URL — see `docs/memory/architecture.md`, «Remote sources», for why. Winnow side: `CORS_ALLOWED_ORIGINS` + `GET /api/capabilities`. | Atelier + **CORS only** on Winnow | The triage → edit hop stops being manual, with no credential system built |
| **2** | **Built on Atelier's side (2026-09-06)**: after a Studio export of media that came from a Winnow, `SendFinalsPanel` sends the rendered files into the **finals** root (`POST /api/upload`, one request per file, `original_asset_id` alongside — the field this row proposed) and calls `/api/reconcile` once. Refuses up front on a viewer account, a clip from another instance, or a file over `limits.maxUploadBytes` (`sources/winnow/finals.ts`). Winnow side still to do: read `original_asset_id` on upload. | Atelier + optionally one field on `/api/upload` | Winnow's map, calendar and before/after lineage show which captures have been told |
| **3** | `remote-store.ts` behind the existing four document signatures; boot-time capabilities; stale-write etag guard | Atelier + migration 0040 + one route pair | Projects resumable from another device |
| *later* | Foreign instances (token, then OAuth+PKCE; `/api/v1` first) · scheduling and proactive Road Trip · an edit-grade proxy | Both | The "little Adobe cloud" |

**Phase 0 and 0.5 are the ones to start regardless of everything else**: both are
client-only, both are wins under every scenario, and together they make phases 1–3
cheap. Phase 1 has one prerequisite outside the code: **`atelier.steeve.website`
must exist** (a CNAME onto the current Pages build, `BASE_PATH=/`).

**Phase 2 has no model to design.** Winnow already carries the lineage the first
draft was going to invent: `assets.original_asset_id`, finals roots walked
view-only, `/api/reconcile` (idempotent, retroactive, tool-agnostic),
`has_edit`/`is_edit`, and `/api/assets/:id/exports`. One caveat decides the
implementation: **reconcile matches on basename + capture time**
(`src/lib/reconcile.ts`) and refuses to guess when several captures are plausible.
So either Atelier's export keeps the source basename, or `/api/upload` gains an
optional explicit `original_asset_id` — the second is more honest and is a
three-line change. `POST /api/upload` already preserves a relative path per file,
so a render and its own sidecar stay together.

**Conflict handling (phase 3)**: last-write-wins with a version/etag check that
**refuses** a stale write and says so. Enough for one person on two devices, and it
matches the honesty of the rest of the codebase.

---

## 8. Options considered and rejected

### A — Atelier becomes a module inside Winnow

*Pros*: one app, one auth, one database.

*Rejected*: it ports the mature, **browser-shaped** render pipeline (WebCodecs,
WebGL, canvas) to solve an *asset-resolution* problem — moving the expensive thing
to fix the cheap one. It drags Compare, Photo EXIF, Telemetry and Composer into a
triage tool where they do not belong, kills the public flavour, and contradicts the
modular stack the maintainer wants. It also cannot survive the ambition: one
Atelier against several Winnow instances is impossible if Atelier *is* a Winnow
module.

Rejecting A is **not** the same as rejecting same-origin *serving*, which leaves
the two codebases and repositories entirely separate.

### B — Atelier just gets more robust locally, nothing connects

*Pros*: free. *Cons*: no query, no map, no multi-device resumability. Kept as the
fallback baseline — and phases 0/0.5 deliver its useful half anyway.

### C — Embedding Atelier in an iframe inside Winnow

*Rejected*: `showDirectoryPicker` is refused in a cross-origin iframe, so the local
file path — Atelier's front door — degrades to drag-and-drop. Downloads, fullscreen
and permissions each need negotiating. An embedded-chrome mode
(`window.self !== window.top`) is cheap and worth keeping in reserve for a small
*panel* one day, but not for the editor. A link does 95 % of the work with none of
the cost.

### D — Deciding the topology once and hardcoding it

*Rejected across two drafts, in both directions.* The first draft fixed "separate
origin + token" believing the cookie could not travel; the second fixed
"same-origin" believing `SameSite` was judged on the origin. Both were wrong
because **topology is deployment, not architecture** (§3.3). The client carries base
URL and auth mode as configuration, and the question stops needing an answer.

---

## 9. The product promise that has to change

`README.md` currently opens with *"Everything runs in your browser; files never
leave your machine — no upload, no account, no server"*, and documents exactly one
network exception (opt-in OpenStreetMap tiles). That stops being true in the
connected flavour.

For the record, the network calls that **already** exist (from
`docs/memory/local-first.md`, all verified in code):

- OpenStreetMap raster tiles — the documented exception, opt-in, off by default.
- ffmpeg.wasm core from `unpkg.com`, ~31 MB, on first transcode only, opt-in.
- **Google Fonts on every page load, unconditionally — not mentioned in the
  README's callout.** An open item predating this discussion.
- An OpenStreetMap `href` built for a photo's GPS position, opened on click.

Proposed replacement, true in every flavour and now provable by invariant 1 and
§3.4: **"your media never leaves machines you own"** — no cloud, no third-party
account, no telemetry, and no request to any server you did not name yourself.
This is a product statement and therefore the maintainer's call; it should be
decided deliberately rather than quietly eroded.

---

## 10. Questions answered, and what remains

Answered by reading Winnow (paths in §1 and §5): Range exists on the derivatives
and not on the originals · sidecars are first-class and already inlined in the list
response · `assets.content_hash` exists and phase 0 adopts it verbatim · auth is a
`SameSite=Lax` cookie with roles and no Bearer · proxies are already generated for
every asset, in the codec shape Atelier wants · there is nowhere for opaque
documents, so phase 3 needs migration 0040 · Winnow has no trip concept, so Road
Trip keeps the calendar and phase 2's write-back is what makes it visible from the
media side.

Still open:

- **Does `atelier.steeve.website` get created now?** It is the prerequisite for
  phase 1's zero-credential path, and it is a DNS record plus a `CNAME` file.
- **Which Winnow surfaces get "Edit in Atelier"** — asset, selection, calendar
  day? This decides how the hop actually feels, and it is the cheap half of the
  integration.
- **Later**: whether an edit-grade proxy is worth a rendition of its own (1080p,
  low CRF) rather than "original by default, 720p on demand"; and what the generic
  scheduling primitive looks like when it is finally needed.

---

## 11. Path cheat-sheet

**Atelier** (this repository)

```
src/app/tools.tsx                       the tool registry (nav + routes)
src/app/use-hash-route.ts               hash router + isWithinRoute guard
vite.config.ts                          BASE_PATH override (custom domain → '/')
src/shared/sources/file-sources.ts      the `local` source's media adapter
src/shared/sources/write-files.ts       export-to-folder (File System Access)
src/shared/library/assets.ts            File[] → grouped Assets, by base name
src/shared/library/AssetLibraryContext  the app-wide pool, addFiles/setActive
src/shared/projects/project-types.ts    ProjectDoc (v13), SavedMediaRef
src/shared/projects/project-file.ts     the .atelier.json portable half
src/shared/projects/project-store.ts    the `local` source's document adapter
src/shared/projects/reconcile.ts        name-based media reconciliation
src/shared/roadtrip/trip-types.ts       TripDoc (v8), TripPost, migrations
src/shared/roadtrip/trip-store.ts       the `local` source's trip documents
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
src/app/api/auth/login/route.ts         where the cookie's attributes are set
src/lib/serve.ts                        derivative serving: Range, ETag, S3 redirect
src/lib/hash.ts                         partialHash — the shared identity
src/lib/video.ts                        ffmpeg proxy: H.264 yuv420p + AAC + faststart
src/lib/derivatives.ts                  photo thumb/proxy (WebP), job chaining
src/lib/sidecars.ts                     base-name sidecar detection (xml/thm/srt)
src/lib/srt.ts                          DJI flight-log parsing
src/lib/filter.ts                       every query dimension, as Zod + SQL
src/lib/assetQuery.ts                   GRID_SELECT — `a.*`, incl. abs_path (§5.2.5)
src/lib/reconcile.ts                    finals → sources lineage
src/lib/queue.ts                        BullMQ queues — where scheduling would live
src/lib/storage/                        the S3-shaped driver (disk | s3)
src/app/api/**                          ~90 routes; README.md tabulates them all
db/migrations/                          append-only, uniquely numbered (next: 0040)
docs/memory/                            that repo's long-term memory
docs/ARCHITECTURE-REVIEW.md             its own graded weaknesses + P1 backlog
```

**Verification note for whoever builds this**: the cloud container used for this
work has **no H.264 encoder** (`VideoEncoder.isConfigSupported` reports vp8/vp9
only), so an end-to-end export cannot be driven there. UI, arithmetic and wiring
can be verified in headless Chromium; the encode itself must be checked on a real
machine.
