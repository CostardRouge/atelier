# Road Trip persistence on a Winnow instance — the brief

**Status**: designed 2026-09-06; **P-doc and P0 landed** (see §9 for the rest).
Written to be resumed by a cloud session: every claim carries a path and was
verified on disk that day. Phases and what each can verify are in §9.

**Read first**: `docs/winnow-bridge.md` (§3 source model, §3.2 invariants, §7
phase 3) and `docs/winnow-timeline.md` §5.4 (the `TripDoc.sourceId` gap). This
brief is bridge **phase 3 applied to trips**, plus the answers to three
questions the maintainer asked:

1. What is the workflow to *resume* a trip on another device, with sources kept
   apart in the UI?
2. Is the save to Winnow a manual button or automatic like today?
3. Is "a connected Winnow instance" enough security?

## 0. Decisions already taken (2026-09-06, by the maintainer)

Do not re-open these; design inside them.

| # | Question | Decision |
|---|---|---|
| D1 | Save cadence | **Local now, remote on idle.** The 800 ms IndexedDB write stays exactly as is. A second, slower flush pushes to Winnow after ~5 s idle, on tab hide, on leaving the trip, plus an explicit "Save now". A status pill says saved / saving / offline-kept-here / refused. |
| D2 | Scope | **Generic bucket, trips first.** The Winnow store is `kind: 'trip' \| 'project'` from day one; only trips ship. A `TripPost.projectId` on another source renders as "on local", never a dead button. |
| D3 | Winnow authz | **Own docs, any signed-in role.** `/api/apps/` joins the self-service prefixes; rows are scoped by `user_id`; another user's doc **404s** (never 403 — do not reveal existence). |
| D4 | Thumbnails | **Do not cross.** Re-baked locally from the preview canvas; the other device shows a placeholder until a post is opened. No blob upload, no second endpoint. |

## 1. Verified facts this design rests on

### Atelier (this repo)

- `src/shared/sources/source.ts` — `SourceInfo`, `SourceCapabilities {media, documents, scheduling}`, `LOCAL_SOURCE` (`id: 'local'`), `DEFAULT_SOURCE_ID`, `listSources()`, `sourceById()`, and a **generic** `groupBySource<T extends {sourceId?: string}>()` at `:100`. No `DocumentStore` interface exists; the file's own comment (`:20-24`) says adapters are typed only once a second implementation exists. Keep that rule.
- `src/shared/sources/winnow/store.ts` — connections in `localStorage['atelier.sources.winnow.v1']`; `toSourceInfo` at `:86-94` **already** maps `documents: caps?.documents.bucket ?? false`. Capabilities are a snapshot from connect time; nothing refreshes them. `removeWinnowConnection` has no UI caller.
- `src/shared/sources/winnow/client.ts` — `WinnowClient`, `fetch` injected (`FetchLike`, `:214`), `init()` `:270-281` (`credentials: 'include'` in cookie mode), error mapping `:283-305` → `WinnowError` `kind: 'unauthenticated' | 'forbidden' | 'unreachable' | 'protocol'`. **Read-only today**: no PUT/DELETE helper, no `If-Match`. `sourceIdFor(baseUrl)` `:210` = `new URL(baseUrl).host`. `WinnowCapabilities` already types `documents.bucket`.
- `src/shared/roadtrip/trip-types.ts` — `TRIP_DOC_VERSION = 9`; **no `sourceId`** anywhere under `src/shared/roadtrip/` or `src/tools/roadtrip/` (grep 2026-09-06). `migrateTripDoc` `:517` early-returns at current version, shallow-copies, stamps version at `:649`.
- `src/shared/roadtrip/trip-file.ts` — `TripPortable = Omit<TripDoc, 'version'|'id'|'createdAt'|'updatedAt'>` at `:51`. **Trap**: a new `TripDoc` field lands in `.roadtrip.json` automatically unless the `Omit` is widened. `portablePost` `:64` nulls `projectId`. `tripDocFromFile` `:204` always mints a fresh id.
- `src/shared/roadtrip/trip-store.ts` — DB `atelier-roadtrip` v2, stores `trips` + `thumbs`; `listTrips/getTrip/putTrip/deleteTrip/putThumb/getThumbs/deleteThumbs`; every call swallows and degrades. Migration runs on **read**; the IDB version only changes when an object store is added.
- `src/tools/roadtrip/RoadTripTool.tsx` — the save machine is `:85-116`: `pending` ref + `saveTimer` + `flush()` (`:89-95`, `putTrip`, `setStorageFailed(!ok)`) + unmount flush (`:97-103`) + `handleChange` (`:105-116`), `SAVE_DEBOUNCE_MS = 800` (`:23`). Trip load `:72-82` does a full `listTrips()` per route-ref change. `storageFailed` banner `:153-162`.
- `src/tools/roadtrip/TripGallery.tsx` — flat grid `:261-272`, not grouped. Two direct `putTrip` calls bypass the shell: create `:159`, import `:190`. Delete `:194` also prunes thumbs.
- `src/tools/roadtrip/NewTripModal.tsx` — where a trip is created (From/To dates, places).
- `src/tools/studio/ProjectGallery.tsx:319-355` — the precedent for a source-grouped gallery: `groupBySource(projects).map(...)`, label falls back to the raw id, "· not connected — media may be unreachable" when `sourceById(id) === null`.
- `src/app/ConnectScreen.tsx` — `#/connect?instance=…`, one `capabilities()` call on the user's Allow, stores the connection, navigates to `/studio/home`.
- `src/app/WinnowBrowser.tsx:104-109` — `explain(err, client)` maps `unauthenticated` to "Not signed in to … " + a login link. Reuse it for the gallery.

### Winnow (`~/Documents/GitHub/winnow`, `CostardRouge/winnow`)

- `src/app/api/capabilities/route.ts` already answers `documents: { bucket: false }` and `viewer: {id, username, role} | null`. Its header says: add fields freely, bump `API_VERSION` only when a meaning changes.
- `src/lib/authz.ts` — `requiredRole(method, pathname)`: **every GET is viewer-visible**, mutations default to `editor`; `SELF_SERVICE_PREFIXES = ['/api/auth/logout', '/api/auth/me']` (any signed-in role, mutations included).
- `src/proxy.ts` — CORS preflight answered **before** the session check; then `validateSession`, `requiredRole`, then strips and re-injects `HDR_USER_ID/NAME/ROLE` so a client cannot forge identity; a route reads them with `identityFromHeaders(req.headers)` (`src/lib/auth.ts:74`).
- `src/lib/cors.ts` — exact-origin allowlist, `Allow-Credentials: true`, `Vary: Origin`; **`Expose-Headers` already includes `ETag`**. Preflight echoes the requested headers (so `If-Match` / `If-None-Match` pass). Check `corsPreflightHeaders` lists `PUT` and `DELETE` before relying on it.
- `db/migrations/` — append-only, uniquely numbered. **`0040` is taken** (`0040_timeline_chapters.sql`, the timeline shipped). Next free: **`0041`**. The bridge doc still says 0040 — fix it (§9).
- `users` (migration 0032): roles admin/editor/viewer, invites exist — multi-user is real.
- Gate: `typecheck` + `migrate` + `build`. No tests, no linter. Every Winnow diff stays tiny.

## 2. The model

**A trip belongs to exactly one source** (bridge invariant 2). `TripDoc` gains
the field `ProjectDoc` got at v14:

```ts
// trip-types.ts — TRIP_DOC_VERSION = 10
interface TripDoc { sourceId: string; /* … */ }   // bound half, default 'local'
// migrateTripDoc: if (version < 10) sourceId ??= DEFAULT_SOURCE_ID
```

- `trip-file.ts`: `TripPortable = Omit<TripDoc, … | 'sourceId'>`; `tripDocFromFile(file, now, sourceId = DEFAULT_SOURCE_ID)` — an imported trip belongs to the source that imports it. Test: the serialized file has no `sourceId` key; a v9 file still parses.
- `createTripDoc(...)` gains `sourceId` (default local).
- `TripStage.origin` (timeline brief T0) may ride in the same v10 bump **only if done in the same commit**; otherwise it is v11 later. Not required here.

**The remote copy is authoritative; the IndexedDB copy is the working mirror.**
A remote trip always has a local mirror once opened on a device. This is what
makes the tunnel's latency invisible, lets an offline edit continue, and keeps
"one writer" true: the mirror is a cache of one document, never a second
truth. Not a sync engine — one document, last-write-wins, an etag that
**refuses** a stale write and says so.

Sync bookkeeping is **not** on the document (it would leak into the file and
onto the wire). It is a sibling record in the same database:

```ts
// trip-store.ts — DB_VERSION 3 adds object store 'sync' (keyPath 'id')
interface SyncRecord {
  id: string;            // trip id
  sourceId: string;      // the host, as sourceIdFor() mints it
  etag: string | null;   // what the server last acknowledged; null = never pushed
  syncedAt: number | null;
  dirtyAt: number | null;   // local edit newer than etag; SURVIVES a reload
  status: SyncStatus;
  error: string | null;     // last failure, for the pill
}
type SyncStatus =
  | 'synced' | 'dirty' | 'saving'
  | 'offline'          // unreachable; kept here, will retry
  | 'unauthenticated'  // 401: sign in there
  | 'forbidden'        // 403: cannot write on this account
  | 'conflict'         // 412: changed elsewhere since our etag
  | 'gone';            // 404 on push: deleted elsewhere
```

`dirtyAt` persisting in IndexedDB is the whole crash story: a tab closed
mid-edit leaves the record dirty, and the next open on that device pushes it.
No `keepalive` fetch on unload (64 KB body cap; a trip can exceed it).

## 3. Pure logic first (DOM-free, `.test.ts` beside)

- **`src/shared/roadtrip/trip-sync.ts`** — the reducer.
  `reduceSync(record, event) → record` with events `edited(now)`,
  `pushStarted`, `pushOk(etag, now)`, `pushFailed(kind)`, `pulled(etag, now)`,
  `resolvedKeepMine`, `resolvedTakeTheirs(etag, now)`.
  `shouldFlush(record, now, idleMs = 5000)`; `pillText(record, sourceLabel, now)`
  — every status yields the sentence the UI prints ("saved to
  winnow.steeve.website · 2 min ago", "offline — kept on this device, will
  retry", "refused: changed on another device at 14:02", "sign in to
  winnow.steeve.website to keep saving"). Same honesty rule as the badge
  panels: every state shows the line it really means.
- **`WinnowClient` document methods** (`client.ts`, fetch-injected, tested with a
  fake fetch): `listDocs(app, kind)`, `getDoc(app, id, ifNoneMatch?)` →
  `{ doc, etag } | 'not-modified'`, `putDoc(app, id, body, ifMatch)` →
  `{ etag }`, `deleteDoc(app, id, ifMatch)`. New `WinnowErrorKind`s:
  `'conflict'` (412, carries the server's `etag` + `updatedAt`) and
  `'notfound'` (404). Body cap from capabilities checked **before** the PUT.
- **`src/shared/roadtrip/trip-remote.ts`** — the thin impure driver (no DOM,
  just `WinnowClient` + `trip-store`): `pushTrip(client, doc, record)`,
  `pullTrip(client, id)`, `listRemoteTrips(client)`, `moveTrip(...)` (§5).
  Composes the reducer; owns no policy.

## 4. Where it plugs in

**`RoadTripTool.tsx:85-116`** — do not duplicate the save machine. After
`flush()`'s `putTrip` succeeds and `doc.sourceId !== 'local'`: reduce
`edited(now)` into the sync record, persist it, arm a 5 s remote timer.
`remoteFlush()` → `pushTrip`. Also fire `remoteFlush()` on
`document.visibilitychange === 'hidden'` and in the existing unmount effect
(best effort; the dirty record covers the rest). A "Save now" button and the
pill live in the trip header (`TripOverview`) and the piece editor's top bar —
both read the same record.

**Opening a trip** (`RoadTripTool.tsx:72-82`) — for a remote trip: open the
mirror immediately, then `GET` with `If-None-Match`. 304 → nothing. 200 and the
mirror is clean → replace the mirror silently. 200 and the mirror is dirty →
`conflict`, and the pill offers the two buttons (§6). Unreachable → open the
mirror, pill says offline. This **is** the resume workflow.

**`TripGallery.tsx`** — group with `groupBySource(trips)` exactly like
`ProjectGallery.tsx:319-355`. The list is the union of `listTrips()` (local +
mirrored) and, per connected source with `capabilities.documents`,
`listRemoteTrips()` merged by id. A remote trip not yet mirrored shows greyed
"on winnow.steeve.website · not yet on this device"; opening it pulls, mirrors,
then opens. While the remote list loads: the mirrored ones, with "checking…".
Unreachable: "unreachable — showing what this device holds". 401: the
`explain()` sentence + login link. Never hidden.

The two direct `putTrip` calls: **create** (`:159`) — `NewTripModal` gains a
"Keep on" picker listing sources with `documents: true`, **shown only when more
than one exists**; a remote creation pushes at once (one explicit gesture, one
request, the result said). **Import** (`:190`) — same picker; import still
always mints a new trip.

## 5. Crossing sources — the move verb

Gallery card: "Move to <source>…". Implementation reuses the portable half:
`toTripFile(trip)` → `tripDocFromFile(file, now, targetSourceId)` **keeping the
same id** (a move, not a copy — `tripRef` slugs the id, so links survive), push
to the target and wait for the acknowledgement, then delete here (`deleteTrip`
+ sync record; **thumbs stay** — they are keyed by post id, unchanged).
`projectId` is nulled by `portablePost`, which is correct: projects do not cross
(D2). A move that fails leaves everything where it was and says why.
`.roadtrip.json` export/import stays the offline way to cross.

## 6. Conflicts and failures — said, never swallowed

| Situation | What happens | What the user sees |
|---|---|---|
| Offline mid-edit | local mirror keeps every edit; record `offline`, retry on next flush trigger | "offline — kept on this device, will retry" |
| 401 mid-edit | same as offline, status `unauthenticated` | "sign in to <host> to keep saving" + link (`client.loginUrl()`) |
| 403 | `forbidden`; stop retrying until the next open | "this account cannot save here" |
| 412 on push | `conflict`; nothing overwritten | "refused: changed on another device at HH:MM" + **Keep mine** (re-PUT with the server's etag) / **Take theirs** (pull, replace mirror, drop local edits — confirm first) |
| 404 on push | `gone` | "deleted on <host>" + **Keep here as local** (sourceId → local) / **Delete here** |
| Two tabs, one device | both write the mirror; the second push 412s | same conflict UX; acceptable for one person |
| Local quota | existing `storageFailed` banner, unchanged | as today |
| Delete a remote trip | `DELETE` with `If-Match`; refuse while offline | "connect to delete" — no tombstones |

## 7. Winnow side — one migration, one route file, two one-liners

**Migration `0041_app_documents.sql`** (state retention, as that repo's
`docs/memory/database.md` requires):

```sql
CREATE TABLE IF NOT EXISTS app_documents (
  app        TEXT   NOT NULL,   -- 'atelier'; opaque to Winnow
  id         TEXT   NOT NULL,   -- client-minted
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT   NOT NULL,   -- 'trip' | 'project'; listed by, never read
  version    INTEGER NOT NULL,  -- the client's own document version
  doc        JSONB  NOT NULL,
  etag       TEXT   NOT NULL,   -- opaque revision, regenerated on every write
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (app, id)
);
CREATE INDEX IF NOT EXISTS app_documents_owner_idx
  ON app_documents (user_id, app, kind, updated_at DESC);
-- Retention: rows exist only by the owner's explicit gestures (create, move,
-- delete) and go with the user (CASCADE). No automatic writer, no janitor.
```

**Routes** `src/app/api/apps/[app]/docs/route.ts` (list) and
`…/docs/[id]/route.ts` (get/put/delete). Every query carries
`AND user_id = $me` from `identityFromHeaders`.

- `GET …/docs?kind=trip` → `{ docs: [{ id, kind, version, updated_at, etag, doc }] }` (own rows only; trips are tens of KB, a handful per person — no summary column needed).
- `GET …/docs/:id` → 200 + `ETag` header; `If-None-Match` → 304; **404** for a row that is not the caller's.
- `PUT …/docs/:id` body `{ kind, version, doc }`, `Content-Type: application/json` required (forces a preflight). Row exists and `If-Match` missing or stale → **412** with `{ error, etag, updated_at }`. Body over the cap → 413. OK → 200 `{ etag, updated_at }`. Cap: 1 MiB.
- `DELETE …/docs/:id` with `If-Match` → 204; 404 when not owned.

**`authz.ts`**: add `'/api/apps/'` to `SELF_SERVICE_PREFIXES` (D3).
**`capabilities`**: `documents: { bucket: true, kinds: ['trip', 'project'], maxBytes: 1048576 }` — fields added, no `API_VERSION` bump.

## 8. Security — the honest answer to question 3

Normal prose on purpose.

A connected instance is enough for **reading media**, because every GET on Winnow was already viewer-visible: the bridge exposed nothing new. It is **not** enough for **storing documents** unless three things are explicit, and none of them is automatic:

1. **Ownership is enforced by the route, not by the role.** Without `user_id` scoping, the default "every GET is viewer-visible" rule would make each trip readable by every account on the instance. The migration makes `user_id` NOT NULL, every query filters on it, and a foreign row answers 404 so its existence is not revealed.
2. **Writes are self-service, not editor writes.** A document bucket is not a library mutation; with D3 a viewer account still owns its trips. Winnow's `viewer.role` in capabilities lets Atelier say what will happen before the first PUT.
3. **Cross-site request forgery stays covered by what already exists.** Winnow has no CSRF token and relies on `SameSite=Lax`, which blocks a third-party site from sending the cookie on any cross-site POST/PUT. The CORS allowlist is a single exact origin, and the route requiring `application/json` forces a preflight that only the allowlisted origin passes. This is the first **mutating** cross-origin route Atelier uses, so it widens the surface relative to today; the mitigations above are what hold it, and a subdomain wildcard in the allowlist would break them.

Nothing new is stored in the browser: no token, the session stays Winnow's cookie, so there is no new XSS exposure. What this deliberately does **not** cover: a foreign instance (cross-site, cookie cannot travel — needs the deferred Bearer path), and the instance's own admin reading Postgres, which is the user's own server and consistent with "your media never leaves machines you own". A trip document holds place names, dates and editorial text; it is the same class of data as the library it sits beside.

## 9. Phases — each shippable alone, one commit each

| Phase | What | Where | Verifiable in a cloud container? |
|---|---|---|---|
| **P-doc** | Land this file as `docs/roadtrip-persistence.md`; `MEMORY.md` pointer (the "not memory files" list); fix `winnow-bridge.md` "next free is 0040" → 0041 and mark the timeline as shipped | Atelier | yes |
| **P0** | `TripDoc.sourceId` v10 + migration + `trip-file.ts` Omit widening + tests; `TripGallery` grouped by source via `groupBySource`; `NewTripModal` "Keep on" picker (hidden with one source) | Atelier only | yes |
| **P1** | `trip-sync.ts` reducer + tests; `WinnowClient` doc methods + `conflict`/`notfound` kinds + fake-fetch tests; `trip-store.ts` v3 `sync` store | Atelier only | yes — dead until P2 |
| **P2** | Migration 0041, the route pair, `authz.ts`, capabilities; check `corsPreflightHeaders` lists PUT/DELETE | **Winnow repo** — a separate session on `CostardRouge/winnow` | typecheck+migrate+build only |
| **P3** | `trip-remote.ts` driver; `RoadTripTool` wiring; gallery remote list + states; pill + Save now; conflict/gone UX; move verb; remote delete | Atelier | **no** — needs the deployed pair (§10) |
| **P4** *later* | Projects in the same bucket (`kind: 'project'`; dirHandles and baked thumbnails stay local); `TripStage.origin` | both | — |

Memory updates per phase (CLAUDE.md rule 2): `roadtrip.md` (the decisions D1–D4 and the mirror/etag rule), `local-first.md` (the network list gains "documents to a connected Winnow, own account, on idle"), `architecture.md` "Remote sources" (the client now writes), README's network callout.

## 10. Verification

- `npm run typecheck && npm run lint && npm test && npm run build` on every phase.
- Unit: `trip-types.test.ts` (v9 → v10 migration, default `local`), `trip-file.test.ts` (no `sourceId` in the file; import sets the target), `trip-sync.test.ts` (every event × status, `shouldFlush` idle arithmetic, every `pillText` line), `client.test.ts` (headers `If-Match`/`If-None-Match`, 304/412/404/413 mapping, body cap).
- Browser (P0): `npm run dev`, gallery shows "source: local", NewTripModal shows no picker with one source.
- **P3 only on the deployed pair** (`atelier.steeve.website` ↔ `winnow.steeve.website`): `localhost` is cross-SITE, the cookie cannot travel. Script: create remote trip on A → open on B (pull, mirror) → edit on B → edit on A without reload → A's push 412s → Keep mine / Take theirs → delete on B → A's next push says "gone". Then: sign out on Winnow, edit → pill says sign in; airplane mode, edit, reload → dirty survives and pushes on reconnect.

## 11. Also learned on the way (not this task's scope)

- Winnow's timeline **shipped** (`ed48a22`): chapters are **derived on every request**; only human corrections are stored (`timeline_chapters` named spans, `timeline_breaks`). So a chapter has **no stable id across recomputation** — `winnow-timeline.md` §7.1/§7.2 are answered: derived by default, authored only as a correction, and `TripStage.origin.chapterId` must be the weak key §8.3 anticipated (match by span + place first). Update that brief when T-work resumes.
- `RoadTripTool.tsx:72-82` loads with a full `listTrips()` scan per route change though `getTrip(id)` exists; P3 should switch to `getTrip` since the ref carries the id's tail.
- `AssetSidebar.tsx:210-232` is hard-wired to `connections[0]`; no UI removes a connection. Not needed for this plan, worth an open item.
