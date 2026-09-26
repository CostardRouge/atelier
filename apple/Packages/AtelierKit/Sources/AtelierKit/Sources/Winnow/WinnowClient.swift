// The Winnow client — the only place Atelier speaks HTTP to a media source.
// Port of the `WinnowClient` class of `src/shared/sources/winnow/client.ts`.
//
// Split the way the web's specs already split it: the web injects `fetch`, so
// the request shapes and the error mapping are tested with no network; here
// the TRANSPORT is injected, `(WinnowRequest) async throws -> WinnowResponse`,
// and it is the only thing the app writes (URLSession, its cookie store, a
// Bearer header it was handed). Every method builds the request — route,
// query keys, headers, body — hands it over and maps the answer, so the specs
// run against a stub transport exactly as the web's run against a stub fetch.
// Routes and query keys are byte for byte the web's: a guessed key once made
// the timeline silently list the whole library.
//
// The rules this keeps (`architecture.md`, `docs/roadtrip-persistence.md`):
//
// - Auth is Winnow's own session cookie, same-SITE (`credentials: include`);
//   a foreign instance takes a Bearer token instead, and then no cookie.
// - It WRITES in exactly one kind of place: the document bucket (guarded by
//   `If-Match`), the file bucket (content-addressed), and the finals upload.
//   A write is NEVER replayed — it may have landed.
// - 404 is `notfound` — the bucket never reveals a foreign row — and 412 is
//   `conflict` carrying the server's revision; the caller decides, the client
//   never retries a write on its own.
// - A READ that throws (the web's `TypeError`: a CORS refusal, a DNS miss,
//   being offline, a cache entry this origin may not read) is asked once more
//   past the platform's cache (`reloadCache`), which also replaces the entry.
//   An ANSWER — a 401, a 500 — is never replayed.
// - A cancelled request is the person's own doing: a transport that throws
//   `CancellationError` has it rethrown untouched, never mapped to
//   `unreachable` and never asked again.

import Foundation

// MARK: - the transport's vocabulary

/// Whether the platform sends the instance's cookie with a request.
public enum WinnowCredentials: String, Equatable, Sendable {
    case include, omit
}

/// One part of a `multipart/form-data` body — the web's `FormData`, in order.
public enum WinnowFormPart: Equatable, Sendable {
    case field(name: String, value: String)
    case file(name: String, filename: String, contents: UploadContents)
}

public enum WinnowBody: Equatable, Sendable {
    /// A text body — the JSON of a document PUT, `{}` for a reconcile.
    case text(String)
    /// Raw bytes — a blob for the file bucket.
    case bytes(Data)
    /// Multipart — the finals upload.
    case form([WinnowFormPart])
}

public struct WinnowQueryItem: Equatable, Sendable {
    public var name: String
    public var value: String

    public init(_ name: String, _ value: String) { self.name = name; self.value = value }
}

/// A request, fully built: what the app's transport sends, verbatim.
public struct WinnowRequest: Equatable, Sendable {
    public var method: String
    /// The absolute URL, query included — what `fetch` was given on the web.
    public var url: String
    /// The path, percent-encoded as sent (`/api/apps/atelier/docs/t1`).
    public var path: String
    /// The query, decoded, in the order it is sent.
    public var query: [WinnowQueryItem]
    public var headers: [String: String]
    public var body: WinnowBody?
    public var credentials: WinnowCredentials
    /// The web's `cache: 'reload'`: go past the local cache and REPLACE what it
    /// holds for this URL — set only on the one replay of a failed read.
    public var reloadCache: Bool
    /// The caller needs only this many leading bytes (`fetchHead`): a
    /// transport may stop reading — and should cancel the body — once it
    /// holds them. What stops a transfer is the cancel; the `Range` header is
    /// asked politely and Winnow's download route ignores it.
    public var maxBodyBytes: Int?

    public init(method: String, url: String, path: String, query: [WinnowQueryItem], headers: [String: String] = [:],
                body: WinnowBody? = nil, credentials: WinnowCredentials = .include, reloadCache: Bool = false,
                maxBodyBytes: Int? = nil) {
        self.method = method; self.url = url; self.path = path; self.query = query; self.headers = headers
        self.body = body; self.credentials = credentials; self.reloadCache = reloadCache
        self.maxBodyBytes = maxBodyBytes
    }

    /// A header by name, case-insensitively — `Headers.get`.
    public func header(_ name: String) -> String? {
        let key = name.lowercased()
        return headers.first { $0.key.lowercased() == key }?.value
    }

    /// The first value of a query key — `searchParams.get`.
    public func queryValue(_ name: String) -> String? {
        query.first { $0.name == name }?.value
    }

    /// The query as a dictionary — `Object.fromEntries(searchParams)`.
    public var queryDictionary: [String: String] {
        var out: [String: String] = [:]
        for item in query { out[item.name] = item.value }
        return out
    }
}

public struct WinnowResponse: Equatable, Sendable {
    public var status: Int
    public var headers: [String: String]
    public var body: Data

    public init(status: Int, headers: [String: String] = [:], body: Data = Data()) {
        self.status = status; self.headers = headers; self.body = body
    }

    /// A text body, as UTF-8.
    public init(status: Int, headers: [String: String] = [:], text: String) {
        self.init(status: status, headers: headers, body: Data(text.utf8))
    }

    /// A JSON answer, typed as one — what a stub instance serves.
    public static func json(_ value: JSONValue, status: Int = 200, headers: [String: String] = [:]) -> WinnowResponse {
        var h = headers
        if !h.keys.contains(where: { $0.lowercased() == "content-type" }) { h["content-type"] = "application/json" }
        return WinnowResponse(status: status, headers: h, text: value.serialized())
    }

    /// A header by name, case-insensitively — `Headers.get`.
    public func header(_ name: String) -> String? {
        let key = name.lowercased()
        return headers.first { $0.key.lowercased() == key }?.value
    }

    /// `Response.ok`: a 2xx.
    public var ok: Bool { (200...299).contains(status) }
}

/// The one thing the app provides: send a request, hand back the answer. It
/// THROWS only when there is no answer at all (offline, a refused origin, a
/// DNS miss) — any status is an answer — and throws `CancellationError` when
/// the work was cancelled.
public typealias WinnowTransport = @Sendable (WinnowRequest) async throws -> WinnowResponse

/// A file fetched from an instance — the web's `File`: its bytes, the name and
/// type it was told, and the date it carries (the CAPTURE's, `captureMtime`).
public struct WinnowFile: Equatable, Sendable {
    public var name: String
    public var type: String
    public var lastModified: Double
    public var data: Data

    public init(name: String, type: String, lastModified: Double, data: Data) {
        self.name = name; self.type = type; self.lastModified = lastModified; self.data = data
    }

    public var size: Int { data.count }
}

// MARK: - the client

public struct WinnowClient: Sendable {
    public let config: WinnowConfig
    private let transport: WinnowTransport
    /// `Date.now()`, for the one stamp the client invents (a PUT whose answer
    /// carried no `updated_at`).
    private let now: @Sendable () -> Double

    public init(config: WinnowConfig, transport: @escaping WinnowTransport,
                now: @escaping @Sendable () -> Double = { nowMillis() }) {
        self.config = config; self.transport = transport; self.now = now
    }

    /// Absolute URL of an API path, with the query appended; a nil or empty
    /// value is dropped rather than sent as `undefined`.
    public func url(_ path: String, _ params: [(String, String?)] = []) -> String {
        makeRequest("GET", path, params).url
    }

    // --- the file routes, as URLs an image view or a fetch can take --------

    public func thumbUrl(_ id: Int) -> String { url("/api/assets/\(id)/thumb") }
    public func proxyUrl(_ id: Int) -> String { url("/api/assets/\(id)/proxy") }
    public func originalUrl(_ id: Int) -> String { url("/api/assets/\(id)/download") }
    public func sidecarUrl(_ id: Int) -> String { url("/api/sidecars/\(id)/download") }

    /// The same thumbnail, asked for again after a failed load: the plain URL
    /// for attempts 0 and 1 (the first so the ordinary case stays cacheable —
    /// Winnow serves these `immutable` for a year — the second once the app
    /// has REPLACED the cache entry, the one cure that also fixes the next
    /// launch), a discriminated URL past that, for a request merely shed
    /// under load.
    public func thumbRetryUrl(_ id: Int, _ attempt: Int) -> String {
        attempt <= 1 ? thumbUrl(id) : url("/api/assets/\(id)/thumb", [("retry", String(attempt))])
    }

    /// Where to send someone who is not signed in — Winnow's own login page.
    public func loginUrl() -> String { url("/login") }

    /// The instance's own page for a shoot session — its grid of media. The
    /// nearest thing Winnow has to a page for ONE media: its viewer is local
    /// state everywhere, so a link can land in the grid but not on the frame.
    /// Do not invent a parameter for that here.
    public func sessionUrl(_ sessionId: Int) -> String { url("/sessions/\(sessionId)") }

    /// Where a paired capture's other file is fetched from, when it lives on
    /// THIS instance (`<host>/<id>` split by `splitAssetId`).
    public func originalUrl(of companion: CaptureCompanion) -> String? {
        guard let split = splitAssetId(companion.assetId) else { return nil }
        return originalUrl(split.id)
    }

    // MARK: reads

    public func capabilities() async throws -> WinnowCapabilities {
        readWinnowCapabilities(try await json(makeRequest("GET", "/api/capabilities")))
    }

    /// Per-day counts + cover in `[from, to]`, one logical media per RAW+JPEG
    /// pair — the same collapse the day list uses, so the numbers agree.
    public func calendar(_ from: String, _ to: String, _ filter: FilterQuery = FilterQuery()) async throws -> WinnowCalendar {
        let params: [(String, String?)] = [("from", from), ("to", to), ("collapse", "1")] + filterParams(filter)
        let raw = try await json(makeRequest("GET", "/api/assets/calendar", params)).objectValue
        let days = raw?["days"]?.arrayValue?.compactMap(readWinnowCalendarDay) ?? []
        // A filter that matches nothing still answers with a bounds OBJECT
        // whose fields are null: collapse it here, once.
        let b = raw?["bounds"]?.objectValue
        var bounds: CalendarBounds?
        if let min = winnowText(b?["min"]), let max = winnowText(b?["max"]) { bounds = CalendarBounds(min: min, max: max) }
        return WinnowCalendar(days: days, bounds: bounds)
    }

    /// Values + counts for the filter pickers. Library-wide, one request.
    public func facets() async throws -> WinnowFacets {
        let raw = try await json(makeRequest("GET", "/api/facets")).objectValue
        func list(_ key: String) -> [ValueCount] { raw?[key]?.arrayValue?.compactMap(readValueCount) ?? [] }
        return WinnowFacets(mediaTypes: list("media_types"), extensions: list("extensions"), devices: list("devices"))
    }

    /// The shoot sessions, newest capture first, narrowed by the same filters
    /// as the calendar.
    public func sessions(_ filter: FilterQuery = FilterQuery()) async throws -> [WinnowSession] {
        let params: [(String, String?)] = [("sort", "captured"), ("sort_dir", "desc")] + filterParams(filter)
        let raw = try await json(makeRequest("GET", "/api/sessions", params)).objectValue
        return raw?["sessions"]?.arrayValue?.compactMap(readWinnowSession) ?? []
    }

    /// `GET /api/assets/timeline?<filters>` — chapters in lived order. **Derived
    /// on every request**: an id holds only for that answer. An instance too
    /// old to serve one answers 404 (`notfound`); a chapter the normaliser
    /// cannot read is dropped rather than half-shown.
    public func timeline(_ filter: FilterQuery = FilterQuery(), timeZone: TimeZone = .current) async throws -> [WinnowChapter] {
        let raw = try await json(makeRequest("GET", "/api/assets/timeline", filterParams(filter))).objectValue
        return (raw?["chapters"]?.arrayValue ?? []).compactMap { chapterFromWire($0, timeZone: timeZone) }
    }

    /// `GET /api/assets/geo?date_from&date_to&by=day` — ONE row per capture
    /// day, a cross-repo contract. **Never send `has_gps` here**: it is a legal
    /// filter and would drop the declared gaps, leaving a trip looking placed.
    public func geoDays(_ span: DaySpan, _ filter: FilterQuery = FilterQuery()) async throws -> [WinnowGeoDay] {
        let params: [(String, String?)] = [("date_from", span.from), ("date_to", span.to), ("by", "day")]
            + filterParams(filter)
        let raw = try await json(makeRequest("GET", "/api/assets/geo", params)).objectValue
        return raw?["days"]?.arrayValue?.compactMap(readWinnowGeoDay) ?? []
    }

    /// One page of assets, oldest first inside the window so a day reads in
    /// shooting order. Collapsed: a RAW+JPEG pair is one row.
    public func assets(_ query: AssetQuery) async throws -> AssetPage {
        let ids = query.ids.flatMap { $0.isEmpty ? nil : $0.map(String.init).joined(separator: ",") }
        var params: [(String, String?)] = [
            ("date_from", query.dateFrom),
            ("date_to", query.dateTo),
            ("session_id", query.sessionId.map(String.init)),
            // Winnow's `intList`: comma-separated.
            ("ids", ids),
        ]
        params += filterParams(query.filter)
        params += [
            ("cursor", query.cursor),
            ("limit", String(query.limit ?? 200)),
            ("collapse", "1"),
            ("sort_dir", "asc"),
        ]
        let raw = try await json(makeRequest("GET", "/api/assets", params)).objectValue
        return AssetPage(assets: raw?["assets"]?.arrayValue?.compactMap(readWinnowAssetRow) ?? [],
                         nextCursor: raw?["next_cursor"]?.stringValue)
    }

    /// Every row of a query, following `next_cursor` until the page is short —
    /// a busy day is 300 media and one page is 200. `cap` bounds a runaway.
    public func allAssets(_ query: AssetQuery, cap: Int = 2000) async throws -> [WinnowAssetRow] {
        var rows: [WinnowAssetRow] = []
        var cursor: String?
        repeat {
            var q = query
            q.cursor = cursor
            let page = try await assets(q)
            rows += page.assets
            cursor = page.nextCursor
        } while !(cursor ?? "").isEmpty && rows.count < cap
        return rows
    }

    /// One asset's row, or nil when it is gone — a purged or soft-deleted
    /// asset is a 404, "gone", not a failure of the instance.
    public func asset(_ id: Int) async throws -> WinnowAssetRow? {
        do {
            let raw = try await json(makeRequest("GET", "/api/assets/\(id)"))
            return readWinnowAssetRow(raw.objectValue?["asset"])
        } catch let error as WinnowError where error.kind == .notfound {
            return nil
        }
    }

    /// The rows for an explicit set of ids, in the order asked, absent ones
    /// skipped; an id the collapsed list did not return (the RAW half of a
    /// pair) is asked for on its own.
    public func assetsByIds(_ ids: [Int]) async throws -> [WinnowAssetRow] {
        if ids.isEmpty { return [] }
        var found: [Int: WinnowAssetRow] = [:]
        for row in try await allAssets(AssetQuery(ids: ids)) { found[row.id] = row }
        for id in ids where found[id] == nil {
            if let row = try await asset(id) { found[id] = row }
        }
        return ids.compactMap { found[$0] }
    }

    // MARK: finals

    /// `POST /api/upload` — multipart `files[]` with a parallel `paths[]`. One
    /// request per call: the body limit is per request. The answer's shape is
    /// not relied on; it is handed back for a status line.
    public func upload(_ items: [UploadItem], _ options: UploadOptions = UploadOptions()) async throws -> JSONValue? {
        var parts: [WinnowFormPart] = []
        for item in items {
            parts.append(.file(name: "files", filename: item.name, contents: item.contents))
            parts.append(.field(name: "paths", value: item.path))
        }
        if let id = options.originalAssetId { parts.append(.field(name: "original_asset_id", value: String(id))) }
        if let chapter = options.chapterId, !chapter.isEmpty { parts.append(.field(name: "chapter_id", value: chapter)) }
        var req = makeRequest("POST", "/api/upload")
        req.body = .form(parts)
        return bodyOf(try await send(req))
    }

    /// `POST /api/reconcile` — idempotent and retroactive on Winnow's side.
    public func reconcile() async throws -> JSONValue? {
        var req = makeRequest("POST", "/api/reconcile")
        req.headers["Content-Type"] = "application/json"
        req.body = .text("{}")
        return bodyOf(try await send(req))
    }

    // MARK: bytes

    /// The bytes at `url`, as a file the rest of the kernel can hold. The
    /// whole body; progress and cancelling a body mid-stream are the
    /// transport's.
    public func fetchFile(_ url: String, name: String, type: String, lastModified: Double) async throws -> WinnowFile {
        let res = try await send(absoluteRequest("GET", url))
        return WinnowFile(name: name, type: type, lastModified: lastModified, data: res.body)
    }

    /// The first `bytes` at `url`, without paying for the rest — what reading
    /// an original's EXIF costs. A `Range` is asked politely; `maxBodyBytes`
    /// tells the transport to stop, which is what really saves the transfer.
    public func fetchHead(_ url: String, bytes: Int) async throws -> Data {
        var req = absoluteRequest("GET", url)
        req.headers["Range"] = "bytes=0-\(max(0, bytes - 1))"
        req.maxBodyBytes = bytes
        let res = try await send(req)
        return Data(res.body.prefix(max(0, bytes)))
    }

    // MARK: the document bucket
    //
    // `GET /api/apps/:app/docs?kind=` lists the caller's OWN rows; a row of
    // another account answers 404, never 403. Every write is guarded by
    // `If-Match`: a stale etag is a 412 carrying the server's revision.

    /// Every document of one kind this account holds there, body included.
    public func listDocs(_ app: String, _ kind: String) async throws -> [WinnowDocRow] {
        let raw = try await json(makeRequest("GET", docsPath(app), [("kind", kind)])).objectValue
        return raw?["docs"]?.arrayValue?.compactMap(readWinnowDocRow) ?? []
    }

    /// One document. With `ifNoneMatch` — the etag we hold — a 304 means ours
    /// is still the server's, and nothing is downloaded. The ETag HEADER is
    /// the authority on the revision; the body echoes it.
    public func getDoc(_ app: String, _ id: String, ifNoneMatch: String? = nil) async throws -> GetDocResult {
        var req = makeRequest("GET", docsPath(app, id))
        req.headers["Accept"] = "application/json"
        if let tag = ifNoneMatch, !tag.isEmpty { req.headers["If-None-Match"] = tag }
        let res = try await send(req)
        if res.status == 304 { return .notModified }
        guard let parsed = JSONValue.parse(res.body) else {
            throw WinnowError(.protocol, "\(req.url) did not return JSON.", status: res.status)
        }
        var row = readWinnowDocRow(parsed)
            ?? WinnowDocRow(id: id, kind: "", version: 0, updatedAt: "", etag: "", doc: .null)
        if let etag = res.header("etag") { row.etag = etag }
        return .row(row)
    }

    /// Create or replace. `ifMatch` is the etag we hold — nil for a document
    /// never pushed, in which case the server refuses if a row already exists
    /// (412), which is what stops two devices creating one trip. `maxBytes` is
    /// the instance's cap, checked HERE so an oversize document is refused
    /// with a sentence before any bytes travel.
    public func putDoc(_ app: String, _ id: String, _ body: DocBody, ifMatch: String?,
                       maxBytes: Int? = nil) async throws -> PutDocResult {
        let text = body.json.serialized()
        let size = text.utf8.count
        if let cap = maxBytes, size > cap {
            throw WinnowError(.protocol, "This document is \(binaryBytes(size)), over the instance’s cap of \(binaryBytes(cap)).",
                              status: 413)
        }
        var req = makeRequest("PUT", docsPath(app, id))
        req.headers["Accept"] = "application/json"
        // Required by the route: forces a CORS preflight only the allowlisted
        // origin passes, which is what keeps a cross-site form from writing.
        req.headers["Content-Type"] = "application/json"
        if let tag = ifMatch, !tag.isEmpty { req.headers["If-Match"] = tag }
        req.body = .text(text)
        let res = try await send(req)
        guard let parsed = JSONValue.parse(res.body) else {
            throw WinnowError(.protocol, "\(req.url) did not return JSON.", status: res.status)
        }
        let raw = parsed.objectValue
        guard let etag = res.header("etag") ?? raw?["etag"]?.stringValue, !etag.isEmpty else {
            throw WinnowError(.protocol, "\(req.url) acknowledged without an etag.", status: res.status)
        }
        return PutDocResult(etag: etag, updatedAt: raw?["updated_at"]?.stringValue ?? winnowIsoString(now()))
    }

    /// Delete, guarded like a write. A row already gone is a 404 (`notfound`).
    public func deleteDoc(_ app: String, _ id: String, ifMatch: String?) async throws {
        var req = makeRequest("DELETE", docsPath(app, id))
        if let tag = ifMatch, !tag.isEmpty { req.headers["If-Match"] = tag }
        _ = try await send(req)
    }

    // MARK: the file bucket
    //
    // Content-addressed: the id IS the SHA-256 of the bytes, so no etag and no
    // `If-Match` — the same id can only ever mean the same bytes.

    /// Which blobs this account already holds for the app — ids and sizes.
    public func listAppFiles(_ app: String) async throws -> AppFileList {
        let raw = try await json(makeRequest("GET", filesPath(app))).objectValue
        return AppFileList(
            files: raw?["files"]?.arrayValue?.compactMap(readAppFileRow) ?? [],
            used: winnowInt(raw?["used"]) ?? 0,
            quota: winnowInt(raw?["quota"]),
            maxBytes: winnowInt(raw?["maxBytes"])
        )
    }

    /// One blob's bytes, or nil when this account does not hold that hash —
    /// an ordinary answer here, not a failure.
    public func getAppFile(_ app: String, _ hash: String) async throws -> Data? {
        do {
            return try await send(makeRequest("GET", filesPath(app, hash))).body
        } catch let error as WinnowError where error.kind == .notfound {
            return nil
        }
    }

    /// Store a blob under its own hash; true when the instance created it. The
    /// instance verifies the hash and refuses a body that does not match.
    public func putAppFile(_ app: String, _ hash: String, _ bytes: Data, mediaType: String = "application/octet-stream",
                           maxBytes: Int? = nil) async throws -> Bool {
        if let cap = maxBytes, bytes.count > cap {
            throw WinnowError(.protocol, "This look is \(binaryBytes(bytes.count)), over the instance’s cap of \(binaryBytes(cap)).",
                              status: 413)
        }
        var req = makeRequest("PUT", filesPath(app, hash))
        // Not a safelisted type, so a browser preflights — the document PUT's
        // CSRF story; kept identical here.
        req.headers["Content-Type"] = mediaType
        req.headers["Accept"] = "application/json"
        req.body = .bytes(Data(bytes))
        let res = try await send(req)
        return JSONValue.parse(res.body)?.objectValue?["created"] == .bool(true)
    }

    /// Forget a blob there.
    public func deleteAppFile(_ app: String, _ hash: String) async throws {
        _ = try await send(makeRequest("DELETE", filesPath(app, hash)))
    }

    // MARK: - building

    private func makeRequest(_ method: String, _ path: String, _ params: [(String, String?)] = []) -> WinnowRequest {
        let query = params.compactMap { name, value -> WinnowQueryItem? in
            guard let value, !value.isEmpty else { return nil }
            return WinnowQueryItem(name, value)
        }
        var url = config.baseUrl + path
        if !query.isEmpty { url += "?" + query.map { "\(formEncode($0.name))=\(formEncode($0.value))" }.joined(separator: "&") }
        return WinnowRequest(method: method, url: url, path: path, query: query)
    }

    /// A request for a URL this client handed out (`proxyUrl`, …), read back
    /// into its path and query.
    private func absoluteRequest(_ method: String, _ url: String) -> WinnowRequest {
        var rest = Substring(url)
        if let scheme = rest.range(of: "://") { rest = rest[scheme.upperBound...] }
        let pathStart = rest.firstIndex(where: { $0 == "/" || $0 == "?" || $0 == "#" }) ?? rest.endIndex
        var tail = rest[pathStart...]
        if let hash = tail.firstIndex(of: "#") { tail = tail[..<hash] }
        var path = String(tail)
        var query: [WinnowQueryItem] = []
        if let mark = tail.firstIndex(of: "?") {
            path = String(tail[..<mark])
            for pair in tail[tail.index(after: mark)...].split(separator: "&", omittingEmptySubsequences: true) {
                let bits = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
                let name = formDecode(String(bits[0]))
                let value = bits.count > 1 ? formDecode(String(bits[1])) : ""
                query.append(WinnowQueryItem(name, value))
            }
        }
        return WinnowRequest(method: method, url: url, path: path.isEmpty ? "/" : path, query: query)
    }

    private func docsPath(_ app: String, _ id: String? = nil) -> String {
        let base = "/api/apps/\(encodeURIComponent(app))/docs"
        return id.map { "\(base)/\(encodeURIComponent($0))" } ?? base
    }

    private func filesPath(_ app: String, _ id: String? = nil) -> String {
        let base = "/api/apps/\(encodeURIComponent(app))/files"
        return id.map { "\(base)/\(encodeURIComponent($0))" } ?? base
    }

    /// The cumulative narrowing, in Winnow's own query names. `half` goes out
    /// as `kind` — Winnow's word for the incoming/final split, which is not the
    /// `kind` a root carries in its table; renamed on this side only, so
    /// nothing here reads `kind` and means two things.
    private func filterParams(_ f: FilterQuery) -> [(String, String?)] {
        [("media_type", f.mediaType?.rawValue), ("ext", f.ext), ("device", f.device), ("kind", f.half?.rawValue)]
    }

    // MARK: - sending

    private func authorised(_ base: WinnowRequest) -> WinnowRequest {
        var req = base
        switch config.auth {
        case .cookie:
            // The cookie only travels when asked for, and only same-site.
            req.credentials = .include
        case .token(let token):
            req.headers["Authorization"] = "Bearer \(token)"
            req.credentials = .omit
        }
        return req
    }

    /// What a thrown transport is reported as, once there is nothing left to try.
    private func unreachable(_ pastTheCache: Bool) -> WinnowError {
        let asked = pastTheCache ? ", even asked again past this browser’s cache" : ""
        return WinnowError(.unreachable,
                           "\(config.baseUrl) did not answer\(asked) (offline, wrong address, or this origin is not allowed there).")
    }

    private func send(_ base: WinnowRequest) async throws -> WinnowResponse {
        let req = authorised(base)
        let res: WinnowResponse
        do {
            res = try await transport(req)
        } catch let cancelled as CancellationError {
            throw cancelled
        } catch {
            // A WRITE is never replayed: it may have landed.
            let method = req.method.uppercased()
            if method != "GET" && method != "HEAD" { throw unreachable(false) }
            var again = req
            again.reloadCache = true
            do {
                res = try await transport(again)
            } catch let cancelled as CancellationError {
                throw cancelled
            } catch {
                throw unreachable(true)
            }
        }
        switch res.status {
        case 401: throw WinnowError(.unauthenticated, "Not signed in to this Winnow.", status: 401)
        case 403: throw WinnowError(.forbidden, "This account is not allowed to do that.", status: 403)
        case 404: throw WinnowError(.notfound, "Not there — or not this account’s.", status: 404)
        case 412:
            throw WinnowError(.conflict, "Changed there since this device last saw it; nothing was written.",
                              status: 412, theirs: conflictInfo(res))
        default:
            // 304 is an answer, not a failure: "what you hold is still current".
            if !res.ok && res.status != 304 {
                throw WinnowError(.protocol, "\(req.url) answered \(res.status)\(refusalReason(res)).", status: res.status)
            }
            return res
        }
    }

    private func json(_ base: WinnowRequest) async throws -> JSONValue {
        var req = base
        req.headers["Accept"] = "application/json"
        let res = try await send(req)
        guard let value = JSONValue.parse(res.body) else {
            throw WinnowError(.protocol, "\(req.url) did not return JSON.", status: res.status)
        }
        return value
    }

    /// A JSON body when there is one; nil for an empty or non-JSON answer.
    private func bodyOf(_ res: WinnowResponse) -> JSONValue? {
        guard res.header("content-type")?.contains("json") == true else { return nil }
        return JSONValue.parse(res.body)
    }
}

// MARK: - reading a refusal

/// The instance's own words for a refusal, as ` — <reason>`, or nothing.
/// Winnow answers `{ "error": "…" }` and that sentence is usually the whole
/// diagnosis — a pack push refused every look with *the body does not hash to
/// that id* while the panel said only "answered 400". Deliberately narrow:
/// JSON only, so a proxy's HTML page never reaches a sentence, and clamped,
/// the body being a remote's text pasted into a message a person reads.
private func refusalReason(_ res: WinnowResponse) -> String {
    guard let text = String(data: res.body, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
          text.hasPrefix("{"), let raw = JSONValue.parse(text)?.objectValue else { return "" }
    let said: JSONValue? = raw["error"]?.stringValue != nil ? raw["error"] : raw["message"]
    guard let reason = said?.stringValue else { return "" }
    let words = reason.split(whereSeparator: { $0.isWhitespace })
    guard !words.isEmpty else { return "" }
    let one = words.joined(separator: " ")
    return " — " + (one.count > 160 ? String(one.prefix(159)) + "…" : one)
}

/// What a 412 carries: `{ error, etag, updated_at }`, read leniently, the
/// header standing in for an etag the body does not name.
private func conflictInfo(_ res: WinnowResponse) -> ConflictInfo? {
    let raw = JSONValue.parse(res.body)?.objectValue
    let etag = raw?["etag"]?.stringValue ?? res.header("etag")
    guard let etag, !etag.isEmpty else { return nil }
    return ConflictInfo(etag: etag, updatedAt: raw?["updated_at"]?.stringValue)
}

/// The client's own byte wording — binary, unlike `formatBytes`: `n B`,
/// `n KB` rounded, `n.n MB`.
private func binaryBytes(_ n: Int) -> String {
    if n < 1024 { return "\(n) B" }
    if n < 1024 * 1024 { return "\(Int((Double(n) / 1024 + 0.5).rounded(.down))) KB" }
    let mb = Double(n) / (1024 * 1024)
    let tenths = (mb * 10).rounded(.toNearestOrAwayFromZero) / 10
    return String(format: "%.1f MB", tenths)
}

// MARK: - URL text

/// `URLSearchParams`' serializer (`application/x-www-form-urlencoded`):
/// ASCII alphanumerics and `*-._` as they are, a space as `+`, every other
/// UTF-8 byte percent-encoded.
private func formEncode(_ s: String) -> String {
    var out = ""
    for byte in s.utf8 {
        switch byte {
        case 0x30...0x39, 0x41...0x5A, 0x61...0x7A, 0x2A, 0x2D, 0x2E, 0x5F:
            out.append(Character(UnicodeScalar(byte)))
        case 0x20:
            out.append("+")
        default:
            out += String(format: "%%%02X", byte)
        }
    }
    return out
}

private func formDecode(_ s: String) -> String {
    let spaced = s.replacingOccurrences(of: "+", with: " ")
    return spaced.removingPercentEncoding ?? spaced
}

/// `encodeURIComponent`: everything but `A–Z a–z 0–9 - _ . ! ~ * ' ( )`.
private func encodeURIComponent(_ s: String) -> String {
    var out = ""
    for byte in s.utf8 {
        switch byte {
        case 0x30...0x39, 0x41...0x5A, 0x61...0x7A, 0x2D, 0x5F, 0x2E, 0x21, 0x7E, 0x2A, 0x27, 0x28, 0x29:
            out.append(Character(UnicodeScalar(byte)))
        default:
            out += String(format: "%%%02X", byte)
        }
    }
    return out
}
