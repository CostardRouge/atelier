// The Winnow wire — every shape `src/shared/sources/winnow/client.ts` reads off
// an instance, and the pure decisions made on them. Port of the types and the
// module-level functions of `client.ts`; the requests themselves are
// `WinnowClient.swift`.
//
// Winnow (`CostardRouge/winnow`) is the maintainer's triage app: a Next.js API
// over Postgres that indexes every capture on his NAS, builds a proxy for each
// and knows a DJI clip's `.srt` as a first-class sidecar. What this reads was
// verified against Winnow's code and is recorded in `docs/winnow-bridge.md` §5
// and, for the timeline, in `docs/winnow-timeline.md`'s status block. The
// first timeline reader was written against a GUESS and was wrong in every key
// while its tests passed against the guess — so the keys below are the ones
// the web's specs pin, byte for byte, and nothing here is renamed on the wire.
//
// Every reader takes a `JSONValue` and is lenient the way the web's casts are:
// the web hands a row on as the instance sent it, so a reader here keeps what
// it can read and defaults the rest rather than dropping a row for a missing
// field. What a reader REQUIRES is only what makes a row a row (an asset's
// numeric id, a chapter's `key`, a day's date); what it cannot read is dropped
// at the list, never half-shown.

import Foundation

// MARK: - the connection

/// How a request proves who is asking.
public enum WinnowAuth: Equatable, Sendable {
    /// Same-site: the platform sends Winnow's session cookie.
    case cookie
    /// Foreign origin: a bearer token the user pasted. Seam only — no UI yet.
    case token(String)
}

public struct WinnowConfig: Equatable, Sendable {
    /// Origin of the instance, no path, no trailing slash.
    public var baseUrl: String
    public var auth: WinnowAuth

    public init(baseUrl: String, auth: WinnowAuth) { self.baseUrl = baseUrl; self.auth = auth }
}

/// Why an address was refused as an instance — the web's thrown `Error`.
public struct WinnowAddressError: Error, Equatable, Sendable, LocalizedError {
    public let message: String
    public init(_ message: String) { self.message = message }
    public var errorDescription: String? { message }
}

/// `https://Winnow.example/` → `https://winnow.example`; throws on a path.
public func normalizeBaseUrl(_ raw: String) throws -> String {
    guard let parts = winnowOrigin(raw.trimmingCharacters(in: .whitespacesAndNewlines)) else {
        throw WinnowAddressError("Invalid URL")
    }
    if parts.scheme != "https" && parts.hostname != "localhost" {
        throw WinnowAddressError("An instance must be reached over https.")
    }
    if !parts.rootOnly {
        throw WinnowAddressError("Give the instance origin only — no path, no query.")
    }
    return "\(parts.scheme)://\(parts.host)"
}

/// The id a source gets: its host (with a port it carries), which is also what
/// the gallery prints. Nil for something that is not an address.
public func sourceIdFor(_ baseUrl: String) -> String? {
    winnowOrigin(baseUrl)?.host
}

/// What `new URL()` gives of an address: its scheme, its host as `url.host`
/// writes it (lower-cased, a default port dropped), and whether it names the
/// origin alone.
private func winnowOrigin(_ text: String) -> (scheme: String, hostname: String, host: String, rootOnly: Bool)? {
    guard let c = URLComponents(string: text), let scheme = c.scheme?.lowercased(),
          let rawHost = c.host, !rawHost.isEmpty else { return nil }
    let hostname = rawHost.lowercased()
    let bracketed = hostname.contains(":") ? "[\(hostname)]" : hostname
    var host = bracketed
    if let port = c.port {
        let isDefault = (scheme == "https" && port == 443) || (scheme == "http" && port == 80)
        if !isDefault { host += ":\(port)" }
    }
    let path = c.percentEncodedPath
    let rootOnly = (path.isEmpty || path == "/") && (c.percentEncodedQuery ?? "").isEmpty
        && (c.percentEncodedFragment ?? "").isEmpty
    return (scheme, hostname, host, rootOnly)
}

// MARK: - errors

/// How a request failed, in the client's own vocabulary — the very cases the
/// sync reducer reads (`PushFailure`, declared in `DocSync.swift` as the web's
/// `WinnowErrorKind`), so a failure crosses into `reduceSync` untranslated.
public typealias WinnowErrorKind = PushFailure

/// What the server holds when it refuses a write with 412 — the reducer's
/// `TheirCopy`, the same two fields.
public typealias ConflictInfo = TheirCopy

public struct WinnowError: Error, Equatable, Sendable, LocalizedError, CustomStringConvertible {
    public let kind: WinnowErrorKind
    public let message: String
    public let status: Int?
    /// Set on a `conflict`: the server's current revision, so "keep mine" can re-PUT over it.
    public let theirs: ConflictInfo?

    public init(_ kind: WinnowErrorKind, _ message: String, status: Int? = nil, theirs: ConflictInfo? = nil) {
        self.kind = kind; self.message = message; self.status = status; self.theirs = theirs
    }

    public var errorDescription: String? { message }
    public var description: String { message }
}

// MARK: - an asset row

public enum WinnowMediaType: String, Equatable, Sendable, CaseIterable {
    case photo, video
}

public enum DerivativeStatus: String, Equatable, Sendable, CaseIterable {
    case pending, processing, ready, error, skipped
}

public enum WinnowSidecarKind: String, Equatable, Sendable, CaseIterable {
    case xml, thm, srt
}

public struct WinnowSidecar: Equatable, Sendable {
    public var id: Int
    public var kind: WinnowSidecarKind
    public var filename: String

    public init(id: Int, kind: WinnowSidecarKind, filename: String) {
        self.id = id; self.kind = kind; self.filename = filename
    }
}

/// The subset of a `/api/assets` row this app reads. `a.*` carries far more.
public struct WinnowAssetRow: Equatable, Sendable {
    public var id: Int
    public var filename: String
    /// The shoot session this media was ingested in — one folder, in practice.
    /// `NOT NULL` in Winnow's schema, typed optional all the same: a link is
    /// the only thing that depends on it, and it falls back rather than
    /// pointing nowhere.
    public var sessionId: Int?
    public var ext: String
    /// Nil when the row does not say — which the web reads as "not a video"
    /// and "not a photo" both, exactly as its `===` comparisons do.
    public var mediaType: WinnowMediaType?
    public var capturedAt: String?
    public var captureDate: String?
    public var width: Int?
    public var height: Int?
    public var durationS: Double?
    public var fileSize: Int?
    /// Winnow's partial content hash — the identity Atelier recomputes locally.
    public var contentHash: String?
    public var gpsLat: Double?
    public var gpsLon: Double?
    public var cameraModel: String?
    /// The lens, as the file named it — often absent (fixed-lens, most video).
    public var lens: String?
    /// Exposure, as Winnow read it at ingest. `shutter` is the camera's own
    /// text (`1/240`), not seconds — see `ExifFromRow.swift`.
    public var iso: Double?
    public var shutter: String?
    public var aperture: Double?
    public var focalLength: Double?
    /// Drone stills only (migration 0028): DJI writes these as XMP.
    public var relativeAltitude: Double?
    public var absoluteAltitude: Double?
    public var derivativeStatus: DerivativeStatus?
    /// True when a DJI `.srt` flight log rides with this clip.
    public var hasTelemetry: Bool
    public var sidecars: [WinnowSidecar]
    /// Winnow's CULLING, as the row carries it (`GRID_SELECT` joins `ratings`).
    /// Kept as the wire value on purpose: ABSENT (nil) and `null` differ —
    /// an older instance sends none of the three keys, and `cullingFromRow`
    /// reads that as "said nothing", never as unrated.
    public var verdict: JSONValue?
    public var star: JSONValue?
    public var colorLabel: JSONValue?
    /// THE CAPTURE'S OTHER FILE, when Winnow paired two into one media —
    /// `raw_jpeg` or `live_photo`. Kept as text: `companionOf` refuses ANY
    /// kind that is not `raw_jpeg`, a word this build does not know included.
    /// A companion is in NO collapsed list and is reached by its id; and it is
    /// not always a RAW.
    public var groupKind: String?
    public var companionId: Int?
    public var companionExt: String?
    /// Text for the same reason as `groupKind`.
    public var companionMediaType: String?
    public var companionFilename: String?
    public var companionFileSize: Int?
    public var companionWidth: Int?
    public var companionHeight: Int?

    public init(
        id: Int, filename: String = "", sessionId: Int? = nil, ext: String = "", mediaType: WinnowMediaType? = nil,
        capturedAt: String? = nil, captureDate: String? = nil, width: Int? = nil, height: Int? = nil,
        durationS: Double? = nil, fileSize: Int? = nil, contentHash: String? = nil,
        gpsLat: Double? = nil, gpsLon: Double? = nil, cameraModel: String? = nil, lens: String? = nil,
        iso: Double? = nil, shutter: String? = nil, aperture: Double? = nil, focalLength: Double? = nil,
        relativeAltitude: Double? = nil, absoluteAltitude: Double? = nil, derivativeStatus: DerivativeStatus? = nil,
        hasTelemetry: Bool = false, sidecars: [WinnowSidecar] = [],
        verdict: JSONValue? = nil, star: JSONValue? = nil, colorLabel: JSONValue? = nil,
        groupKind: String? = nil, companionId: Int? = nil, companionExt: String? = nil,
        companionMediaType: String? = nil, companionFilename: String? = nil, companionFileSize: Int? = nil,
        companionWidth: Int? = nil, companionHeight: Int? = nil
    ) {
        self.id = id; self.filename = filename; self.sessionId = sessionId; self.ext = ext; self.mediaType = mediaType
        self.capturedAt = capturedAt; self.captureDate = captureDate; self.width = width; self.height = height
        self.durationS = durationS; self.fileSize = fileSize; self.contentHash = contentHash
        self.gpsLat = gpsLat; self.gpsLon = gpsLon; self.cameraModel = cameraModel; self.lens = lens
        self.iso = iso; self.shutter = shutter; self.aperture = aperture; self.focalLength = focalLength
        self.relativeAltitude = relativeAltitude; self.absoluteAltitude = absoluteAltitude
        self.derivativeStatus = derivativeStatus; self.hasTelemetry = hasTelemetry; self.sidecars = sidecars
        self.verdict = verdict; self.star = star; self.colorLabel = colorLabel
        self.groupKind = groupKind; self.companionId = companionId; self.companionExt = companionExt
        self.companionMediaType = companionMediaType; self.companionFilename = companionFilename
        self.companionFileSize = companionFileSize; self.companionWidth = companionWidth
        self.companionHeight = companionHeight
    }
}

/// One sidecar, or nil when it has no id or is of a kind nothing here reads.
public func readWinnowSidecar(_ raw: JSONValue?) -> WinnowSidecar? {
    guard let o = raw?.objectValue, let id = winnowInt(o["id"]),
          let kind = o["kind"]?.stringValue.flatMap(WinnowSidecarKind.init(rawValue:)) else { return nil }
    return WinnowSidecar(id: id, kind: kind, filename: o["filename"]?.stringValue ?? "")
}

/// A row of `/api/assets` (or `/api/assets/{id}`'s `asset`), or nil when it
/// carries no numeric id. Everything else defaults: the web casts the row
/// and reads what is there.
public func readWinnowAssetRow(_ raw: JSONValue?) -> WinnowAssetRow? {
    guard let o = raw?.objectValue, let id = winnowInt(o["id"]) else { return nil }
    return WinnowAssetRow(
        id: id,
        filename: o["filename"]?.stringValue ?? "",
        sessionId: winnowInt(o["session_id"]),
        ext: o["ext"]?.stringValue ?? "",
        mediaType: o["media_type"]?.stringValue.flatMap(WinnowMediaType.init(rawValue:)),
        capturedAt: o["captured_at"]?.stringValue,
        captureDate: o["capture_date"]?.stringValue,
        width: winnowInt(o["width"]),
        height: winnowInt(o["height"]),
        durationS: winnowNumber(o["duration_s"]),
        fileSize: winnowInt(o["file_size"]),
        contentHash: o["content_hash"]?.stringValue,
        gpsLat: winnowNumber(o["gps_lat"]),
        gpsLon: winnowNumber(o["gps_lon"]),
        cameraModel: o["camera_model"]?.stringValue,
        lens: o["lens"]?.stringValue,
        iso: winnowNumber(o["iso"]),
        shutter: o["shutter"]?.stringValue,
        aperture: winnowNumber(o["aperture"]),
        focalLength: winnowNumber(o["focal_length"]),
        relativeAltitude: winnowNumber(o["relative_altitude"]),
        absoluteAltitude: winnowNumber(o["absolute_altitude"]),
        derivativeStatus: o["derivative_status"]?.stringValue.flatMap(DerivativeStatus.init(rawValue:)),
        hasTelemetry: o["has_telemetry"]?.boolValue ?? false,
        sidecars: o["sidecars"]?.arrayValue?.compactMap(readWinnowSidecar) ?? [],
        verdict: o["verdict"],
        star: o["star"],
        colorLabel: o["color_label"],
        groupKind: o["group_kind"]?.stringValue,
        companionId: winnowInt(o["companion_id"]),
        companionExt: o["companion_ext"]?.stringValue,
        companionMediaType: o["companion_media_type"]?.stringValue,
        companionFilename: o["companion_filename"]?.stringValue,
        companionFileSize: winnowInt(o["companion_file_size"]),
        companionWidth: winnowInt(o["companion_width"]),
        companionHeight: winnowInt(o["companion_height"])
    )
}

// MARK: - the calendar, the facets, the sessions

public struct WinnowCalendarDay: Equatable, Sendable {
    public var date: String
    public var count: Int
    public var coverId: Int?

    public init(date: String, count: Int, coverId: Int? = nil) {
        self.date = date; self.count = count; self.coverId = coverId
    }
}

public func readWinnowCalendarDay(_ raw: JSONValue?) -> WinnowCalendarDay? {
    guard let o = raw?.objectValue, let date = o["date"]?.stringValue else { return nil }
    return WinnowCalendarDay(date: date, count: winnowInt(o["count"]) ?? 0, coverId: winnowInt(o["cover_id"]))
}

/// The span a library's dated media covers — two real dates, `YYYY-MM-DD`.
public struct CalendarBounds: Equatable, Sendable {
    public var min: String
    public var max: String

    public init(min: String, max: String) { self.min = min; self.max = max }
}

public struct WinnowCalendar: Equatable, Sendable {
    public var days: [WinnowCalendarDay]
    /// The full filtered span, or nil when nothing dated matches. **Winnow
    /// never sends null here**: its `min()`/`max()` over no rows yield a row
    /// of NULLs, so the wire carries `{ min: null, max: null }` — the client
    /// collapses that to nil, once, so every reader treats a non-nil `bounds`
    /// as two real dates.
    public var bounds: CalendarBounds?

    public init(days: [WinnowCalendarDay], bounds: CalendarBounds?) { self.days = days; self.bounds = bounds }
}

/// One value a filter picker offers — `string | number` on the wire.
public struct ValueCount: Equatable, Sendable {
    public var value: JSONValue
    public var count: Int

    public init(value: JSONValue, count: Int) { self.value = value; self.count = count }
}

public func readValueCount(_ raw: JSONValue?) -> ValueCount? {
    guard let o = raw?.objectValue, let value = o["value"] else { return nil }
    switch value {
    case .string, .number: return ValueCount(value: value, count: winnowInt(o["count"]) ?? 0)
    default: return nil
    }
}

/// The slice of `/api/facets` the browser offers as filters.
public struct WinnowFacets: Equatable, Sendable {
    public var mediaTypes: [ValueCount]
    public var extensions: [ValueCount]
    public var devices: [ValueCount]

    public init(mediaTypes: [ValueCount] = [], extensions: [ValueCount] = [], devices: [ValueCount] = []) {
        self.mediaTypes = mediaTypes; self.extensions = extensions; self.devices = devices
    }
}

public enum WinnowSessionStatus: String, Equatable, Sendable, CaseIterable {
    case empty
    case toSort = "to_sort"
    case done
}

/// A Winnow session: one shoot folder as it was ingested, with its span.
public struct WinnowSession: Equatable, Sendable {
    public var id: Int
    public var name: String
    public var sourcePath: String
    public var deviceHint: String?
    public var capturedAtMin: String?
    public var capturedAtMax: String?
    public var assetCount: Int
    public var status: WinnowSessionStatus?
    public var rootKind: String

    public init(id: Int, name: String, sourcePath: String = "", deviceHint: String? = nil, capturedAtMin: String? = nil,
                capturedAtMax: String? = nil, assetCount: Int = 0, status: WinnowSessionStatus? = nil, rootKind: String = "") {
        self.id = id; self.name = name; self.sourcePath = sourcePath; self.deviceHint = deviceHint
        self.capturedAtMin = capturedAtMin; self.capturedAtMax = capturedAtMax; self.assetCount = assetCount
        self.status = status; self.rootKind = rootKind
    }
}

public func readWinnowSession(_ raw: JSONValue?) -> WinnowSession? {
    guard let o = raw?.objectValue, let id = winnowInt(o["id"]) else { return nil }
    return WinnowSession(
        id: id,
        name: o["name"]?.stringValue ?? "",
        sourcePath: o["source_path"]?.stringValue ?? "",
        deviceHint: o["device_hint"]?.stringValue,
        capturedAtMin: o["captured_at_min"]?.stringValue,
        capturedAtMax: o["captured_at_max"]?.stringValue,
        assetCount: winnowInt(o["asset_count"]) ?? 0,
        status: o["status"]?.stringValue.flatMap(WinnowSessionStatus.init(rawValue:)),
        rootKind: o["root_kind"]?.stringValue ?? ""
    )
}

// MARK: - the capabilities sheet

/// `GET /api/capabilities` — facts about the instance, read on connect.
///
/// Every part is optional: the web casts the answer and reads it through
/// optional chains, and the specs hand it half-sheets (`{ media: { timeline:
/// true } }`). `raw` is the sheet as it arrived, so a store can keep it and a
/// later build can read a key this one does not.
public struct WinnowCapabilities: Equatable, Sendable {
    public struct Api: Equatable, Sendable {
        public var version: Double?
    }

    public struct Auth: Equatable, Sendable {
        public var methods: [String]
        public var corsEnabled: Bool?
    }

    public struct VideoProxy: Equatable, Sendable {
        public var container: String?
        public var codec: String?
        public var height: Double?
    }

    public struct PhotoProxy: Equatable, Sendable {
        public var format: String?
        public var size: Double?
    }

    public struct Media: Equatable, Sendable {
        public var sidecars: Bool?
        public var rangeOnDerivatives: Bool?
        public var rangeOnOriginals: Bool?
        public var videoProxy: VideoProxy?
        public var photoProxy: PhotoProxy?
        public var contentHash: String?
        /// Whether the instance serves a timeline. **Winnow does not send this
        /// today** and its timeline shipped all the same — absence means "ask
        /// and see"; only an explicit `false` hides it (`hasTimeline`).
        public var timeline: Bool?
    }

    public struct Documents: Equatable, Sendable {
        public var bucket: Bool
        /// The kinds the bucket lists by; nil on a bucket that predates the list.
        public var kinds: [String]?
        /// The body cap per document, in bytes; checked BEFORE a PUT.
        public var maxBytes: Int?
    }

    /// The BINARY bucket beside the documents (Winnow's migration 0044).
    /// Absent on an instance that predates it — "no", unlike the timeline.
    public struct Files: Equatable, Sendable {
        public var bucket: Bool
        public var maxBytes: Int?
        public var quotaBytes: Int?
    }

    public struct Scheduling: Equatable, Sendable {
        public var reminders: Bool
    }

    public struct Limits: Equatable, Sendable {
        public var maxUploadBytes: Int?
    }

    public struct Storage: Equatable, Sendable {
        public var driver: String?
        public var signedRedirects: Bool?
    }

    public struct Viewer: Equatable, Sendable {
        public var id: Int?
        public var username: String?
        /// `admin` · `editor` · `viewer`, as text: a role this build does not
        /// know is simply not one that may write back.
        public var role: String?
    }

    public var api: Api?
    public var auth: Auth?
    public var media: Media?
    public var documents: Documents?
    public var files: Files?
    public var scheduling: Scheduling?
    public var limits: Limits?
    public var storage: Storage?
    public var viewer: Viewer?
    /// The sheet as the instance sent it.
    public var raw: JSONValue
}

/// A capabilities sheet read leniently: a part the answer lacks is nil, and a
/// non-object answer is a sheet that says nothing (every part nil).
public func readWinnowCapabilities(_ raw: JSONValue?) -> WinnowCapabilities {
    let o = raw?.objectValue ?? [:]
    func object(_ key: String) -> [String: JSONValue]? { o[key]?.objectValue }

    let api = object("api").map { WinnowCapabilities.Api(version: winnowNumber($0["version"])) }
    let auth = object("auth").map {
        WinnowCapabilities.Auth(methods: $0["methods"]?.arrayValue?.compactMap(\.stringValue) ?? [],
                                corsEnabled: $0["corsEnabled"]?.boolValue)
    }
    let media = object("media").map { m -> WinnowCapabilities.Media in
        let proxies = m["proxies"]?.objectValue
        let video = proxies?["video"]?.objectValue.map {
            WinnowCapabilities.VideoProxy(container: $0["container"]?.stringValue, codec: $0["codec"]?.stringValue,
                                          height: winnowNumber($0["height"]))
        }
        let photo = proxies?["photo"]?.objectValue.map {
            WinnowCapabilities.PhotoProxy(format: $0["format"]?.stringValue, size: winnowNumber($0["size"]))
        }
        return WinnowCapabilities.Media(
            sidecars: m["sidecars"]?.boolValue, rangeOnDerivatives: m["rangeOnDerivatives"]?.boolValue,
            rangeOnOriginals: m["rangeOnOriginals"]?.boolValue, videoProxy: video, photoProxy: photo,
            contentHash: m["contentHash"]?.stringValue, timeline: m["timeline"]?.boolValue
        )
    }
    let documents = object("documents").map {
        WinnowCapabilities.Documents(bucket: $0["bucket"]?.boolValue ?? false,
                                     kinds: $0["kinds"]?.arrayValue?.compactMap(\.stringValue),
                                     maxBytes: winnowInt($0["maxBytes"]))
    }
    let files = object("files").map {
        WinnowCapabilities.Files(bucket: $0["bucket"]?.boolValue ?? false, maxBytes: winnowInt($0["maxBytes"]),
                                 quotaBytes: winnowInt($0["quotaBytes"]))
    }
    let scheduling = object("scheduling").map {
        WinnowCapabilities.Scheduling(reminders: $0["reminders"]?.boolValue ?? false)
    }
    let limits = object("limits").map { WinnowCapabilities.Limits(maxUploadBytes: winnowInt($0["maxUploadBytes"])) }
    let storage = object("storage").map {
        WinnowCapabilities.Storage(driver: $0["driver"]?.stringValue, signedRedirects: $0["signedRedirects"]?.boolValue)
    }
    let viewer = object("viewer").map {
        WinnowCapabilities.Viewer(id: winnowInt($0["id"]), username: $0["username"]?.stringValue,
                                  role: $0["role"]?.stringValue)
    }
    return WinnowCapabilities(api: api, auth: auth, media: media, documents: documents, files: files,
                              scheduling: scheduling, limits: limits, storage: storage, viewer: viewer,
                              raw: raw ?? .null)
}

/// Whether browsing by leg is worth offering.
///
/// **`timelineSyncEnabled` decides first, and it is off** — Winnow's
/// timeline is young and Atelier does not lean on it (`WinnowFeatures.swift`).
/// Every caller is an entry point, so one switch closes them all. Were it on,
/// the rule would be "offer unless the instance says no": no shipped Winnow
/// sends this capability, and a `notfound` from `timeline()` is what an
/// instance without one says.
public func hasTimeline(_ caps: WinnowCapabilities?) -> Bool {
    guard timelineSyncEnabled else { return false }
    return caps?.media?.timeline != false
}

/// Whether an instance's document bucket keeps documents of `kind`. The bucket
/// refuses a kind it does not know (400), so a roll must not be offered to an
/// instance that only knows trips and projects. A bucket with no `kinds`
/// predates the list and knew exactly the first two kinds.
public func bucketHolds(_ caps: WinnowCapabilities?, _ kind: String) -> Bool {
    guard let documents = caps?.documents, documents.bucket else { return false }
    guard let kinds = documents.kinds else { return kind == "trip" || kind == "project" }
    return kinds.contains(kind)
}

/// Whether this instance keeps a client app's BINARY files. Absence is "no":
/// an instance that does not name it would answer a PUT with a 404 found only
/// after uploading.
public func hasFileBucket(_ caps: WinnowCapabilities?) -> Bool {
    caps?.files?.bucket == true
}

/// Whether the signed-in account may send files back. Winnow's `viewer` role
/// is read-only; a button that would answer 403 is worse than a sentence.
public func canWriteBack(_ caps: WinnowCapabilities?) -> Bool {
    let role = caps?.viewer?.role
    return role == "admin" || role == "editor"
}

// MARK: - the narrowing

/// Which half of a Winnow's library a listing is about — its own split:
/// `incoming` (still to cull) or `final` (the Gallery), absent for both.
public enum LibraryHalf: String, Equatable, Sendable, CaseIterable {
    case incoming, final
}

/// The narrowing every listing honours — the calendar, a day, the sessions.
public struct FilterQuery: Equatable, Sendable {
    public var mediaType: WinnowMediaType?
    /// Lowercase, no dot — as Winnow stores it (`hif`, `mp4`, `arw`).
    public var ext: String?
    /// `make model`, as Winnow derives it from EXIF ("DJI Mini 4 Pro").
    public var device: String?
    public var half: LibraryHalf?

    public init(mediaType: WinnowMediaType? = nil, ext: String? = nil, device: String? = nil, half: LibraryHalf? = nil) {
        self.mediaType = mediaType; self.ext = ext; self.device = device; self.half = half
    }
}

public struct AssetQuery: Equatable, Sendable {
    public var dateFrom: String?
    public var dateTo: String?
    /// A Winnow shoot session — one folder, in practice.
    public var sessionId: Int?
    /// An explicit set of assets — how a document's refs are re-resolved.
    public var ids: [Int]?
    public var cursor: String?
    public var limit: Int?
    /// The web's `AssetQuery extends FilterQuery`, as a member.
    public var filter: FilterQuery

    public init(dateFrom: String? = nil, dateTo: String? = nil, sessionId: Int? = nil, ids: [Int]? = nil,
                cursor: String? = nil, limit: Int? = nil, filter: FilterQuery = FilterQuery()) {
        self.dateFrom = dateFrom; self.dateTo = dateTo; self.sessionId = sessionId; self.ids = ids
        self.cursor = cursor; self.limit = limit; self.filter = filter
    }
}

public struct AssetPage: Equatable, Sendable {
    public var assets: [WinnowAssetRow]
    public var nextCursor: String?

    public init(assets: [WinnowAssetRow], nextCursor: String?) { self.assets = assets; self.nextCursor = nextCursor }
}

// MARK: - the timeline

/// A place as a chapter names it — `lat`/`lon` in decimal degrees, or nil.
public struct WinnowChapterPlace: Equatable, Sendable {
    public var name: String
    public var region: String?
    public var lat: Double?
    public var lon: Double?

    public init(name: String, region: String? = nil, lat: Double? = nil, lon: Double? = nil) {
        self.name = name; self.region = region; self.lat = lat; self.lon = lon
    }
}

/// One chapter of the instance's timeline, normalised at the boundary by
/// `chapterFromWire`. Its field names match the Road Trip import's
/// `TimelineChapter` so a list can be handed over unchanged. `startDate` /
/// `endDate` are the days the instance's own offset reads its instants as.
public struct WinnowChapter: Equatable, Sendable {
    public var id: String
    public var title: String?
    public var startDate: String?
    public var endDate: String?
    public var places: [WinnowChapterPlace]
    /// A fingerprint of the chapter's extent (`started_at|ended_at|count`),
    /// computed HERE — Winnow offers no revision and re-derives chapters on
    /// every request.
    public var revision: String?
    public var assetCount: Int
    public var photoCount: Int?
    public var videoCount: Int?
    public var coverId: Int?
    /// Hours to add to UTC to read this chapter's days as they were lived;
    /// nil when nothing in it carries a position (the days were read at UTC,
    /// and a UI must say so).
    public var tzOffsetHours: Double?
    /// The place was inferred from the neighbours in time.
    public var placeInferred: Bool
    /// A human named, merged or located this chapter (Winnow's `override_id`).
    public var authored: Bool

    public init(id: String, title: String?, startDate: String?, endDate: String?, places: [WinnowChapterPlace],
                revision: String?, assetCount: Int, photoCount: Int? = nil, videoCount: Int? = nil, coverId: Int?,
                tzOffsetHours: Double?, placeInferred: Bool, authored: Bool) {
        self.id = id; self.title = title; self.startDate = startDate; self.endDate = endDate; self.places = places
        self.revision = revision; self.assetCount = assetCount; self.photoCount = photoCount
        self.videoCount = videoCount; self.coverId = coverId; self.tzOffsetHours = tzOffsetHours
        self.placeInferred = placeInferred; self.authored = authored
    }
}

private let hourMs = 3_600_000.0

/// A capture instant read as the calendar day it was lived: shift by the
/// chapter's own offset, then take the UTC parts — Winnow's `localDay`
/// (`app/timeline/ChapterCard.tsx`) reproduced exactly, and the ONE place an
/// instant becomes a day. Converting anywhere else, or ignoring the offset,
/// walks a third of an Australian trip back a day.
///
/// `timeZone` is only what JavaScript's `Date.parse` reads an offset-less
/// date-TIME in; Winnow always sends one.
public func localDayOf(_ instant: JSONValue?, _ offsetHours: Double?, timeZone: TimeZone = .current) -> String? {
    guard let raw = winnowString(instant), let t = winnowParseInstant(raw, timeZone: timeZone) else { return nil }
    let shifted = t + (offsetHours ?? 0) * hourMs
    guard shifted.isFinite else { return nil }
    let p = winnowUtcParts(shifted)
    return "\(p.year)-\(winnowPad2(p.month))-\(winnowPad2(p.day))"
}

/// One chapter of `GET /api/assets/timeline`, normalised into Atelier's shape
/// — verified against Winnow's own `src/lib/timeline.ts`: `key`, `name`,
/// `started_at` / `ended_at` read by `tz_offset_hours`, `places` as bare
/// strings, the authored `place_label` / `place_lat` / `place_lon`, `count`,
/// `override_id`, `place_inferred`, `cover_id`.
///
/// Two judgement calls, both refusing to fabricate: a DERIVED name is only the
/// dominant place, so only an authored chapter gets a title; and ONE place,
/// never a route — Winnow orders places by weight, not by the order they were
/// lived, so the list would invent a leg (and possibly a reversed one).
public func chapterFromWire(_ raw: JSONValue?, timeZone: TimeZone = .current) -> WinnowChapter? {
    guard let r = raw?.objectValue, let id = winnowString(r["key"]) else { return nil }

    let tzOffsetHours = winnowNumber(r["tz_offset_hours"])
    let startDate = localDayOf(r["started_at"], tzOffsetHours, timeZone: timeZone)
    let endDate = localDayOf(r["ended_at"], tzOffsetHours, timeZone: timeZone)
    let authored = winnowNumber(r["override_id"]) != nil

    let blank = CharacterSet.whitespacesAndNewlines
    let named = r["places"]?.arrayValue?
        .compactMap { winnowString($0) }
        .first { !$0.trimmingCharacters(in: blank).isEmpty }
    let labelText = winnowString(r["place_label"])?.trimmingCharacters(in: blank)
    let label = (labelText?.isEmpty ?? true) ? nil : labelText
    let name = label ?? named?.trimmingCharacters(in: blank)
    var places: [WinnowChapterPlace] = []
    if let name, !name.isEmpty {
        places = [WinnowChapterPlace(
            name: name,
            // Winnow reverse-geocodes to one level and sends no second label.
            region: nil,
            lat: label != nil ? winnowNumber(r["place_lat"]) : nil,
            lon: label != nil ? winnowNumber(r["place_lon"]) : nil
        )]
    }

    let count = winnowNumber(r["count"]) ?? 0
    let started = winnowString(r["started_at"]) ?? ""
    let ended = winnowString(r["ended_at"]) ?? ""
    return WinnowChapter(
        id: id,
        title: authored ? winnowString(r["name"]) : nil,
        startDate: startDate,
        endDate: endDate,
        places: places,
        revision: "\(started)|\(ended)|\(winnowJsNumber(count))",
        assetCount: abs(count) < 9_007_199_254_740_992 ? Int(count) : 0,
        // Winnow counts a chapter's media as one number; a split would be invented.
        photoCount: nil,
        videoCount: nil,
        coverId: winnowInt(r["cover_id"]),
        tzOffsetHours: tzOffsetHours,
        placeInferred: r["place_inferred"] == .bool(true),
        authored: authored
    )
}

/// The day range a leg's media is asked for. **Winnow has no `chapter_id`
/// filter** (its `lib/filter.ts` strips unknown keys, so sending one listed
/// the whole library) and no instant filter: `date_from` / `date_to` over
/// `capture_date` is what exists — a slightly WIDER net than the chapter on a
/// travel day shared with the next leg.
public func chapterDays(_ chapter: WinnowChapter) -> (dateFrom: String, dateTo: String)? {
    guard let start = chapter.startDate, !start.isEmpty, let end = chapter.endDate, !end.isEmpty else { return nil }
    return start <= end ? (start, end) : (end, start)
}

// MARK: - one position per day

public enum GeoDaySource: String, Equatable, Sendable, CaseIterable {
    case measured, inferred
}

/// One row of `GET /api/assets/geo?by=day`, **as the instance sends it** — a
/// cross-repo contract read against Winnow's own route (2026-09-20). `date` is
/// `capture_date` verbatim; `lat`/`lon` the day's median (of its trustworthy
/// rows when it has any); `source` is nil on a DECLARED GAP, a day holding
/// media and no position at all, which is still sent.
public struct WinnowGeoDay: Equatable, Sendable {
    public var date: String
    public var lat: Double?
    public var lon: Double?
    public var count: Int
    public var measured: Int
    public var source: GeoDaySource?

    public init(date: String, lat: Double?, lon: Double?, count: Int, measured: Int, source: GeoDaySource?) {
        self.date = date; self.lat = lat; self.lon = lon; self.count = count; self.measured = measured
        self.source = source
    }
}

public func readWinnowGeoDay(_ raw: JSONValue?) -> WinnowGeoDay? {
    guard let o = raw?.objectValue, let date = o["date"]?.stringValue else { return nil }
    return WinnowGeoDay(
        date: date, lat: winnowNumber(o["lat"]), lon: winnowNumber(o["lon"]),
        count: winnowInt(o["count"]) ?? 0, measured: winnowInt(o["measured"]) ?? 0,
        source: o["source"]?.stringValue.flatMap(GeoDaySource.init(rawValue:))
    )
}

// MARK: - sending finals

/// What an upload hands the transport: the bytes in hand, or a file on disk
/// the transport streams — a 4K master is never read into memory to be sent.
/// A path rather than a `URL`, which is not `Sendable` on Linux's Foundation.
public enum UploadContents: Equatable, Sendable {
    case data(Data)
    case file(path: String)
}

/// One file to upload, and where it lands inside the finals root.
public struct UploadItem: Equatable, Sendable {
    /// The file's own name — the web's `File.name`.
    public var name: String
    public var contents: UploadContents
    /// Relative path — `POST /api/upload`'s `paths[]`, parallel to `files[]`.
    public var path: String

    public init(name: String, contents: UploadContents, path: String) {
        self.name = name; self.contents = contents; self.path = path
    }
}

public struct UploadOptions: Equatable, Sendable {
    /// ⚠ ASSUMED addition (bridge §7): the capture this final was cut from, so
    /// the link is exact. Winnow's upload route does not read it yet.
    public var originalAssetId: Int?
    /// ⚠ ASSUMED (timeline §6): the chapter the final belongs to, if any.
    public var chapterId: String?

    public init(originalAssetId: Int? = nil, chapterId: String? = nil) {
        self.originalAssetId = originalAssetId; self.chapterId = chapterId
    }
}

// MARK: - the document bucket

/// The app namespace this client writes under — opaque to Winnow.
public let docsApp = "atelier"

/// One row of the document bucket, as the list and the get return it.
public struct WinnowDocRow: Equatable, Sendable {
    public var id: String
    public var kind: String
    /// The client's own document version, stored beside the body.
    public var version: Int
    public var updatedAt: String
    public var etag: String
    public var doc: JSONValue

    public init(id: String, kind: String, version: Int, updatedAt: String, etag: String, doc: JSONValue) {
        self.id = id; self.kind = kind; self.version = version; self.updatedAt = updatedAt; self.etag = etag
        self.doc = doc
    }
}

public func readWinnowDocRow(_ raw: JSONValue?) -> WinnowDocRow? {
    guard let o = raw?.objectValue, let id = winnowString(o["id"]) else { return nil }
    return WinnowDocRow(
        id: id,
        kind: o["kind"]?.stringValue ?? "",
        version: winnowInt(o["version"]) ?? 0,
        updatedAt: o["updated_at"]?.stringValue ?? "",
        etag: o["etag"]?.stringValue ?? "",
        doc: o["doc"] ?? .null
    )
}

public struct DocBody: Equatable, Sendable {
    public var kind: String
    public var version: Int
    public var doc: JSONValue

    public init(kind: String, version: Int, doc: JSONValue) { self.kind = kind; self.version = version; self.doc = doc }

    /// The body as it is PUT.
    public var json: JSONValue {
        .object(["kind": .string(kind), "version": .number(Double(version)), "doc": doc])
    }
}

/// What a GET hands back: the row, or word that ours is still current.
public enum GetDocResult: Equatable, Sendable {
    case row(WinnowDocRow)
    case notModified
}

public struct PutDocResult: Equatable, Sendable {
    public var etag: String
    public var updatedAt: String

    public init(etag: String, updatedAt: String) { self.etag = etag; self.updatedAt = updatedAt }
}

// MARK: - the file bucket

/// One row of the file bucket's listing.
public struct AppFileRow: Equatable, Sendable {
    public var id: String
    public var bytes: Int
    public var mediaType: String
    public var createdAt: String

    public init(id: String, bytes: Int, mediaType: String, createdAt: String) {
        self.id = id; self.bytes = bytes; self.mediaType = mediaType; self.createdAt = createdAt
    }
}

public func readAppFileRow(_ raw: JSONValue?) -> AppFileRow? {
    guard let o = raw?.objectValue, let id = o["id"]?.stringValue else { return nil }
    return AppFileRow(id: id, bytes: winnowInt(o["bytes"]) ?? 0, mediaType: o["mediaType"]?.stringValue ?? "",
                      createdAt: o["createdAt"]?.stringValue ?? "")
}

/// Which blobs this account holds for an app — ids and sizes, never bytes.
public struct AppFileList: Equatable, Sendable {
    public var files: [AppFileRow]
    public var used: Int
    public var quota: Int?
    public var maxBytes: Int?

    public init(files: [AppFileRow], used: Int, quota: Int?, maxBytes: Int?) {
        self.files = files; self.used = used; self.quota = quota; self.maxBytes = maxBytes
    }
}

// MARK: - a connection, as the app keeps it

/// A Winnow instance this device has connected — the web's `WinnowConnection`
/// (`winnow/store.ts`). A base URL and an auth mode, nothing more; what IS
/// kept beside them is the capabilities sheet read at connect time, a
/// SNAPSHOT (`refreshedAt` says how old). Where the app stores the list is
/// the app's; this is only its shape.
public struct WinnowConnection: Equatable, Sendable {
    /// The host — also the source id documents carry.
    public var id: String
    public var baseUrl: String
    public var auth: WinnowAuth
    public var capabilities: WinnowCapabilities?
    public var connectedAt: Double
    /// When the sheet was last read; nil on a connection stored before the
    /// field existed — read it as `connectedAt`.
    public var refreshedAt: Double?

    public init(id: String, baseUrl: String, auth: WinnowAuth = .cookie, capabilities: WinnowCapabilities? = nil,
                connectedAt: Double, refreshedAt: Double? = nil) {
        self.id = id; self.baseUrl = baseUrl; self.auth = auth; self.capabilities = capabilities
        self.connectedAt = connectedAt; self.refreshedAt = refreshedAt
    }
}

/// The source a connection is, for `SourceRegistry.setRemoteSources`.
public func toSourceInfo(_ c: WinnowConnection) -> SourceInfo {
    SourceInfo(
        id: c.id,
        label: c.id,
        kind: .winnow,
        capabilities: SourceCapabilities(
            media: true,
            documents: c.capabilities?.documents?.bucket ?? false,
            scheduling: c.capabilities?.scheduling?.reminders ?? false
        )
    )
}
