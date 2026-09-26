// Turning a Winnow asset into files the kernel can hold — port of
// `src/shared/sources/winnow/materialize.ts`.
//
// Phase 1 of the bridge does the honest, simple thing: it FETCHES what it
// needs and wraps it. Two fidelities: the **proxy** (the default, and what a
// preview should always use — H.264 + AAC with `moov` first for a clip, a WebP
// for a photo, which is also the answer to a RAW nothing could draw) and the
// **original** (the full file, for a final render; the caller shows its cost).
// A DJI clip's `.srt` comes along whichever fidelity: the flight log is the
// suite's founding case.
//
// Naming keeps the ORIGINAL base name so the library pairs a clip with its
// sidecar exactly as from a folder (`DJI_0001.mp4` + `DJI_0001.SRT`); only the
// extension follows the rendition. Every file is VOUCHED FOR with the
// original's `content_hash` and Winnow id — a proxy's own bytes are nobody's
// identity — and dated at the CAPTURE's instant, never the moment it was
// copied (`captureMtime`): every date fallback in the suite reads that date.
//
// The web registers that identity in a module-level map keyed by the `File`
// and wraps the fetch in a progress task; here `materialize` RETURNS each file
// with its identity, and the registry and the task are the app's.

import Foundation

/// `DJI_0001.MP4` → `DJI_0001`.
private func winnowBaseName(_ filename: String) -> String {
    guard let dot = filename.lastIndex(of: "."), dot != filename.startIndex else { return filename }
    return String(filename[..<dot])
}

/// What to fetch, and what to call it, for one rendition of one asset.
public struct PlannedFile: Equatable, Sendable {
    public var url: String
    public var name: String
    /// The media type the file is told; empty for an original, whose type is its own.
    public var type: String

    public init(url: String, name: String, type: String) { self.url = url; self.name = name; self.type = type }
}

/// The main file of `row` at `fidelity`, then its `.srt` sidecars — Sony's
/// `xml`/`thm` companions are left behind, nothing here reads them.
public func plannedFiles(_ client: WinnowClient, _ row: WinnowAssetRow, _ fidelity: Fidelity) -> [PlannedFile] {
    let base = winnowBaseName(row.filename)
    let main: PlannedFile
    if fidelity == .original {
        main = PlannedFile(url: client.originalUrl(row.id), name: row.filename, type: "")
    } else if row.mediaType == .video {
        main = PlannedFile(url: client.proxyUrl(row.id), name: "\(base).mp4", type: "video/mp4")
    } else {
        main = PlannedFile(url: client.proxyUrl(row.id), name: "\(base).webp", type: "image/webp")
    }
    let srt = row.sidecars.filter { $0.kind == .srt }.map {
        PlannedFile(url: client.sidecarUrl($0.id), name: $0.filename, type: "text/plain")
    }
    return [main] + srt
}

/// What a file fetched from an instance is vouched for with — the web's
/// `KnownIdentity` as `materialize` registers it. The EXIF Winnow parsed at
/// ingest (the web's `origin.exif`) and the capture's own URL (what the web's
/// `origin.fetchOriginal` / `fetchOriginalHead` closures fetch) are carried
/// BESIDE the origin, whose kernel struct holds facts only.
public struct WinnowIdentity: Equatable, Sendable {
    /// `<host>/<id>`.
    public var assetId: String
    /// The ORIGINAL's partial content hash; nil where Winnow has none.
    public var hash: String?
    /// Where the file came from — only on the MAIN file: "the original" of a
    /// `.srt` would be the video.
    public var origin: MediaOrigin?
    /// What Winnow parsed at ingest, for a STILL's main file only (a clip's
    /// telemetry is its `.srt`, which says far more). Merged UNDER the file's
    /// own EXIF by `mergeExif`.
    public var exif: ExifData?
    /// Where the capture's own bytes are, when this file is its proxy; nil when
    /// the file already IS the original — there is nothing better to fetch.
    public var originalUrl: String?

    public init(assetId: String, hash: String? = nil, origin: MediaOrigin? = nil, exif: ExifData? = nil,
                originalUrl: String? = nil) {
        self.assetId = assetId; self.hash = hash; self.origin = origin; self.exif = exif
        self.originalUrl = originalUrl
    }
}

/// The identity every file of `row` is vouched for with: the asset id scoped
/// to its source, and the content hash when Winnow has one.
public func identityFor(_ sourceId: String, _ row: WinnowAssetRow) -> WinnowIdentity {
    let hash = (row.contentHash?.isEmpty ?? true) ? nil : row.contentHash
    return WinnowIdentity(assetId: "\(sourceId)/\(row.id)", hash: hash)
}

/// The mtime a fetched file carries: the CAPTURE's instant, never the moment
/// it was copied — `now` would file a 2025 photograph under today.
///
/// `captured_at` whenever the instance has one. With only a `capture_date`
/// (EXIF held a day and no clock), the day at LOCAL NOON in `timeZone`:
/// midnight would land on the day before in any zone west of the reader. Only
/// a row that knows neither falls through to `now`, the honest last resort.
public func captureMtime(_ row: WinnowAssetRow, now: Double, timeZone: TimeZone = .current) -> Double {
    if let at = row.capturedAt, let instant = winnowParseInstant(at, timeZone: timeZone) { return instant }
    if let day = row.captureDate, let (y, m, d) = leadingDay(day) {
        return winnowLocalMs(year: y, monthIndex: m - 1, day: d, hour: 12, timeZone: timeZone)
    }
    return now
}

/// `^(\d{4})-(\d{2})-(\d{2})` — the day a `capture_date` starts with.
private func leadingDay(_ text: String) -> (Int, Int, Int)? {
    let b = Array(text.utf8)
    guard b.count >= 10, b[4] == UInt8(ascii: "-"), b[7] == UInt8(ascii: "-") else { return nil }
    func number(_ r: Range<Int>) -> Int? {
        var v = 0
        for i in r {
            guard b[i] >= 48, b[i] <= 57 else { return nil }
            v = v * 10 + Int(b[i] - 48)
        }
        return v
    }
    guard let y = number(0..<4), let m = number(5..<7), let d = number(8..<10) else { return nil }
    return (y, m, d)
}

/// The ref a document would store for `row`'s PROXY, without fetching it —
/// the name `materialize` gives the file, the capture's instant, and the
/// identity it is vouched for with. `size` is 0, unknown until fetched, which
/// is harmless where it is read: a ref with an asset id is matched by that id.
public func rowMediaRef(_ sourceId: String, _ row: WinnowAssetRow, now: Double, timeZone: TimeZone = .current) -> SavedMediaRef {
    let identity = identityFor(sourceId, row)
    let ext = row.mediaType == .video ? "mp4" : "webp"
    return SavedMediaRef(name: "\(winnowBaseName(row.filename)).\(ext)", size: 0,
                         lastModified: captureMtime(row, now: now, timeZone: timeZone),
                         assetId: identity.assetId, hash: identity.hash)
}

/// The capture's other file, when this row is half of a paired media —
/// everything it needs is on the row, so it costs no request.
///
/// **Only `raw_jpeg`.** A `live_photo` companion is a `.mov` — motion, not
/// material. Checked on the KIND, the field Winnow decides with, and on the
/// companion's media type too, so a row whose kind an older instance left out
/// still cannot mislead. Its bytes are fetched from `client.originalUrl(of:)`.
public func companionOf(_ sourceId: String, _ row: WinnowAssetRow) -> CaptureCompanion? {
    guard let id = row.companionId, id != 0, let name = row.companionFilename, !name.isEmpty else { return nil }
    if let kind = row.groupKind, !kind.isEmpty, kind != "raw_jpeg" { return nil }
    if let type = row.companionMediaType, !type.isEmpty, type != "photo" { return nil }
    return CaptureCompanion(assetId: "\(sourceId)/\(id)", name: name, bytes: row.companionFileSize,
                            width: row.companionWidth, height: row.companionHeight)
}

extension MediaOrigin {
    /// Where a file fetched from an instance came from — the CAPTURE's pixel
    /// size, file name and weight (never the proxy's), and its companion.
    public init(winnow row: WinnowAssetRow, sourceId: String, fidelity: Fidelity) {
        self.init(sourceId: sourceId, fidelity: fidelity, width: row.width, height: row.height,
                  name: row.filename, bytes: row.fileSize, companion: companionOf(sourceId, row))
    }
}

/// The identity the MAIN file of `row` is vouched for with, at `fidelity`:
/// the asset's, plus its origin, the EXIF Winnow parsed (stills only) and,
/// for a proxy, where the original is.
public func vouchedIdentity(_ client: WinnowClient, _ sourceId: String, _ row: WinnowAssetRow, _ fidelity: Fidelity,
                            timeZone: TimeZone = .current) -> WinnowIdentity {
    var identity = identityFor(sourceId, row)
    identity.origin = MediaOrigin(winnow: row, sourceId: sourceId, fidelity: fidelity)
    if fidelity == .proxy { identity.originalUrl = client.originalUrl(row.id) }
    // A photo's proxy is a WebP re-encode with no EXIF, so carry what Winnow
    // parsed at ingest. Only for stills.
    if row.mediaType == .photo { identity.exif = exifFromRow(row, timeZone: timeZone) }
    return identity
}

/// One fetched file and what it is vouched for with.
public struct MaterializedFile: Equatable, Sendable {
    public var file: WinnowFile
    public var identity: WinnowIdentity

    public init(file: WinnowFile, identity: WinnowIdentity) { self.file = file; self.identity = identity }
}

/// Fetch `row` at `fidelity` — the main file, then its logs — each dated at
/// the capture and vouched for with the ORIGINAL's identity; the origin rides
/// the main file only. A missing rendition is the client's error (`notfound`),
/// never a silent gap. `onFile` is told each file as it lands, with its
/// 1-based index and the total.
public func materialize(_ client: WinnowClient, _ sourceId: String, _ row: WinnowAssetRow, fidelity: Fidelity,
                        now: Double, timeZone: TimeZone = .current,
                        onFile: ((WinnowFile, Int, Int) -> Void)? = nil) async throws -> [MaterializedFile] {
    let plan = plannedFiles(client, row, fidelity)
    let lastModified = captureMtime(row, now: now, timeZone: timeZone)
    let shared = identityFor(sourceId, row)
    let main = vouchedIdentity(client, sourceId, row, fidelity, timeZone: timeZone)
    var files: [MaterializedFile] = []
    for (i, item) in plan.enumerated() {
        let file = try await client.fetchFile(item.url, name: item.name, type: item.type, lastModified: lastModified)
        // The clip and its log share one identity: they are one asset in
        // Winnow as in the library, and the hash is the clip's.
        files.append(MaterializedFile(file: file, identity: i == 0 ? main : shared))
        onFile?(file, i + 1, plan.count)
    }
    return files
}
