# Sources — parity with the web app

The web's sources layer (`src/app/SourcesScreen.tsx`, `src/shared/sources/*`,
`src/shared/sources/winnow/{store,refresh-capabilities,cache-heal,use-connection,use-source-health}.ts`)
against this folder. ✅ built · ⏳ deferred (why, and what it waits on) ·
≠ built differently on purpose (why).

The native app is a genuinely FOREIGN client of an instance
(`docs/winnow-bridge.md` §3.3): no same-site cookie reaches it, so its
credential is a Bearer token the person pastes, kept in the Keychain. Every
row marked ≠ follows from that one fact.

## The transport (`WinnowTransport.swift`, `Keychain.swift`)

| Web | Native | |
|---|---|---|
| `fetch` injected into the client | `URLSessionWinnowTransport.transport`, the kernel's `WinnowTransport` | ✅ |
| JSON bodies, `Accept`, `Content-Type`, `If-Match` / `If-None-Match` sent verbatim | the kernel builds them, the transport sends them untouched | ✅ |
| 304 is an answer | conditional and document requests never consult the URL cache, so a 304 reaches the client | ✅ |
| `FormData` for the finals upload | `MultipartForm`, written to a temp file part by part, a file part streamed from disk in 1 MiB chunks, sent as `httpBodyStream` | ✅ |
| upload / download progress (`onProgress`) | `WinnowTransfer.$progress` task-local, both directions | ✅ |
| `fetchHead` asks `Range` and stops reading | `maxBodyBytes` cancels the task once the bytes are in, the body truncated | ✅ |
| `cache: 'reload'` replay of a failed READ (`cache-heal.ts`) | `.reloadIgnoringLocalCacheData`; a write is never replayed (the kernel's rule) | ✅ |
| the CORS-poisoned cache entry and its per-session heal memo | ≠ URLSession has no CORS: the bug cannot occur, only the replay is kept | ≠ |
| `AbortSignal` | Swift task cancellation cancels the URLSession task; `CancellationError`, never "unreachable" | ✅ |
| same-site cookie (`credentials: include`) | ≠ Bearer token from the Keychain, `credentials: omit` sends no cookie | ≠ |
| a token "lives in browser storage and is XSS-exposed — say so" (bridge §3.6) | Keychain, `ThisDeviceOnly` on iOS, one item per host; the connect form says where it is kept | ✅ |
| macOS sandbox | `com.apple.security.network.client` added to the entitlements | ✅ |
| a local instance over `http://localhost` (`testing.md`'s two-localhost recipe) | ⏳ `normalizeBaseUrl` accepts it, but App Transport Security needs `NSAllowsLocalNetworking` in `project.yml` — add it when the recipe is wanted on a Mac | ⏳ |

## The connections (`ConnectionStore.swift`)

| Web | Native | |
|---|---|---|
| `localStorage['atelier.sources.winnow.v1']` | `Application Support/Atelier/sources/winnow.v1.json`, the same shape minus the secret | ✅ |
| `isConnection` leniency (no id, no base URL, no auth mode → dropped) | `readStoredConnections`, plus `local` and duplicates refused | ✅ |
| `putWinnowConnection` replaces by id | ✅ — ≠ it keeps the row's PLACE; the web appends, so its sources screen can swap which instance is first | ≠ |
| `removeWinnowConnection` | `forget` — the token leaves the Keychain too | ✅ |
| `forgetBrowseState(id)` on remove | `forget` calls `WinnowBrowserMemory.forget(id)` — the kernel's `forgetBrowseState` over the Library browser's remembered place | ✅ |
| `setRemoteSources` mirror | `registry` computed from the list | ✅ |
| `useWinnowConnection` — the FIRST connection | `first`, `firstClient` (multi-instance deferred by the maintainer) | ✅ |
| `useSourceHealth` — the probe IS the refresh, `refreshedAt` stamped | `check(id)`, `checkAll()` | ✅ |
| nothing at boot | loading reads a file and the Keychain, never the network | ✅ |
| `refreshCapabilitiesOnce` — once a session, only where the sheet hides something | `refreshCapabilitiesOnce`, `probeHidden(kind:)`, `probes` | ✅ |
| `forgetCapabilityProbes` for a connection re-made | a connect clears that host's probe | ✅ |
| a restored backup keeps a connection without its token | says so on the row ("holds no token… Reconnect"), no request made | ✅ (native only) |
| an instance that answered without naming an account (Winnow's token support missing) | a warn note on the row | ✅ (native only) |

## The Sources screen (`SourcesView.swift`, `ConnectView.swift`)

| Web | Native | |
|---|---|---|
| `#/sources` and `#/connect` | the Sources tab (iPhone) / sidebar item (iPad, Mac) | ✅ |
| eyebrow + "Where your work lives" + the one-source paragraph | nav title + the same words | ✅ |
| local row: FS glyph, "always on", projects · trips · rolls · media · documents · scheduling | ✅ — media "Files · Photos", documents "Application Support" | ✅ |
| a row per instance: glyph, host, `username · role` or "read … ago" | ✅ | ✅ |
| health pill: reachable · N ms / sign-in needed / unreachable / asking… | ✅ | ✅ |
| facts: api, proxies, sidecars, documents kinds, here, read; "capabilities never read" | ✅ | ✅ |
| a down row is greyed with the reason, never hidden | ✅, and "N came from it — the copies on this device still open, they just cannot save back" | ✅ |
| Sign in there (→ the instance's `/login`) | ≠ Reconnect: the address prefilled, the token field focused — a refused token is fixed by a new token | ≠ |
| Refresh / Retry, disabled while asking | ✅, plus pull-to-refresh, ⌘R and a row context menu | ✅ |
| Forget → inline confirm with `forgetWarning`, "Forget it" / "Keep" | `.confirmationDialog` with the same words | ✅ |
| the ledger counted before a forget asks (`countBySource`) | `DocumentLedger.counts` reads all three kinds off disk, trips and projects included before their tools exist | ✅ |
| connect form: "Connect a Winnow" / "Connect another", placeholder, problem, "Will be listed as source “…”", "Already connected — allowing again refreshes…", the empty-state help | ✅ (the help names rolls too) | ✅ |
| Allow / Allow again / Asking…, Enter submits | ✅ (Return; the default action on the Mac) | ✅ |
| "One request is made — /api/capabilities — and nothing is stored unless it answers." | ✅ | ✅ |
| "That Winnow does not know you yet. Sign in there…" | ≠ "did not accept this token… Open <host>" | ≠ |
| the token field | ✅ (native only), with where the token is kept | ✅ |
| `?instance=` — a link PROPOSES a host, "A link asked to connect … Check the address" | `atelier://connect?instance=…` / `atelier://sources?…` (`App/AppLinks.swift`, the kernel's `parseAppLink`): the address filled in, the form's line says a link asked; nothing is sent until Allow. The Library's `reconnect` proposes its host the same way | ✅ |
| `?return=` landing + "Not now" | Allow and Not now land on `?return=` — a path of ours only (`sourcesLanding`: never `//…` nor an absolute URL) — else the Studio, the web's `AFTER_CONNECT`; Not now drawn only for a link | ✅ |

## Documents kept on an instance (`DocumentStore.swift`, `DocumentSync.swift`, `DocumentGalleryModel.swift`)

| Web | Native | |
|---|---|---|
| three IndexedDB stores + a `sync` store per kind | ONE generic `DocumentStore<D>`: `<kind folder>/<id>.json` + `<id>.sync.json` + `<id>.thumb.jpg` | ✅ |
| the record never on the document; `dirtyAt` survives a crash | the sidecar, written on every record change | ✅ |
| `trip-remote` / `project-remote` / `roll-remote` | `DocumentRemote<D>` over `StoredDocument` (wire mapping per kind); `RollDoc` and `ProjectDoc` conform | ✅ |
| `TripDoc` | conforms in one extension (`Trips/Store/TripDocument.swift`), kind `trip` | ✅ |
| `useDocumentSync`: edited → dirty, push after `REMOTE_IDLE_MS`, forced "Save now", held states wait, outcome onto the LIVE record | `DocumentSync<D>` | ✅ |
| push on unmount and on a hidden tab | `documentSyncLifecycle` — on leaving the screen or the foreground, inside an iOS background task | ✅ |
| `resume` (`afterPull`), `adopt`, `clear` | ✅ | ✅ |
| keep mine, take theirs, keep as local, delete here | ✅ | ✅ |
| `beforeFlush`, `onDiscardPending`, `onReplace`, `onDeleted` | ✅ | ✅ |
| `SyncPill`: dot + one word only where the state waits on the author; the sentence (`pillText`) and its verbs in a popover; two-step "Take theirs" / "Delete here"; a 30 s clock; the sentence announced | ✅ (a popover on the phone too; the accessibility label carries the sentence) | ✅ |
| the panel opens on HOVER with a mouse | ≠ the Mac shows the sentence as a tooltip (`.help`); a click opens the popover | ≠ |
| "Sign in" link when signed out | ✅ + "A new token goes in Sources → Reconnect." | ✅ |
| `useDocumentGallery`: groups, remote lists, busy, notice, create there first, delete with the revision held (refused while unreachable), move (target first), fetch-then-open, `absent` | `DocumentGalleryModel<D>` | ✅ |
| `AbsentSourceNotes` | ✅ | ✅ |

## Wired into the tools

| | |
|---|---|
| ✅ Develop's rolls | `Develop/Store/RollDocuments.swift`: a `DocumentSync<RollDoc>` over `RollStore`'s own files (`rolls/<id>.json`), the open roll its `current`, every write `RollStore` lands marking it dirty (`onWritten`), resumed on open, `.documentSyncLifecycle` and `DocumentSyncPill` in the editor's bar; `DocumentGalleryModel<RollDoc>` behind `RollGallery` for the groups, create-on, delete-there (the sync record removed with the roll) and move |
| ✅ Trips, Studio | `TripsStore` + `TripsShell.gallery`, `StudioStore` — each a `DocumentStore` + `DocumentSync` + `DocumentGalleryModel` of its kind |
| ✅ the Winnow browser (`WinnowBrowser.tsx`, the Library's instance tab), `WinnowThumb`, `resolve-media.ts`'s re-fetch by asset id, `SendFinalsPanel` | media surfaces over this layer: `Library/WinnowBrowserSheet` + `LibraryInstanceModel`, `Library/WinnowThumbView`, the re-fetch in `StudioStore+Recovery` and a piece's Library (`PieceLibrary`), the finals in `Studio/Export/StudioFinalsPanel` — each calling the client, the transport and `ConnectionStore.firstClient` |
| ✅ the task pill for a transfer | `TaskCenter.tracked(label, scope:, bytes:) { try await client… }` — the web's `trackedFetch`: `WinnowTransfer.$progress` set around the call, the bar against the answer's length else the known weight else a sweep, its Cancel cancelling the request (`../Tasks/`). Every media surface that fetches calls it (`../Tasks/PARITY.md`, «Fetches») |

**Counts**: 62 rows — 55 ✅ (4 of them native-only), 1 ⏳, 6 ≠ (built differently on purpose) — the "Wired into the tools" table carries its mark in its first cell.
