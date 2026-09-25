// Where a file CAME FROM, when a source handed it over — the minimal port of
// `MediaOrigin` and `CaptureCompanion` from `src/shared/projects/media-identity.ts`,
// with the web's field names, so the renditions vocabulary
// (`Media/Renditions.swift`) and the capture readers built on it can be fed
// from a source's facts. A file the person opened themselves has no origin.
//
// Deliberately only the FACTS: the web's origin also carries the closures
// that fetch the original, its head and the companion (`fetchOriginal`,
// `fetchOriginalHead`, `fetchFile`, `fetchHead`) and the EXIF the source
// parsed at ingest (`exif`). Those are I/O and another module's record; the
// Sources port adds them beside this struct rather than inside it.

import Foundation

/// What a fetched file is: the source's editing rendition, or the capture itself.
public enum Fidelity: String, Codable, Sendable {
    case proxy, original
}

/// The other half of a paired capture — a Sony `.ARW` beside its `.HIF`, a DJI
/// `.DNG` beside its `.JPG` — as the source describes it, at no request. Never
/// assume it is a RAW: the web's `companionOf` refuses a Live Photo's `.mov`
/// on the kind AND the media type before one of these is ever built.
public struct CaptureCompanion: Equatable, Sendable {
    /// `<host>/<id>`, so it is held and re-found exactly like any other asset.
    public var assetId: String
    public var name: String
    public var bytes: Int?
    public var width: Int?
    public var height: Int?

    public init(assetId: String, name: String, bytes: Int? = nil, width: Int? = nil, height: Int? = nil) {
        self.assetId = assetId; self.name = name; self.bytes = bytes; self.width = width; self.height = height
    }
}

public struct MediaOrigin: Equatable, Sendable {
    /// The source that handed it over, e.g. `winnow.steeve.website`.
    public var sourceId: String
    public var fidelity: Fidelity
    /// The ORIGINAL's pixel size, when the source knows it — the sensor's, for
    /// a RAW, which says nothing about the render inside it.
    public var width: Int?
    public var height: Int?
    /// The ORIGINAL's own file name and weight: its extension says whether a
    /// decoder could draw it at all, and the bytes say what a fetch would cost.
    /// Absent when the source does not say.
    public var name: String?
    public var bytes: Int?
    /// The capture's OTHER file, where the source paired two into one media.
    public var companion: CaptureCompanion?

    public init(sourceId: String, fidelity: Fidelity, width: Int? = nil, height: Int? = nil,
                name: String? = nil, bytes: Int? = nil, companion: CaptureCompanion? = nil) {
        self.sourceId = sourceId; self.fidelity = fidelity; self.width = width; self.height = height
        self.name = name; self.bytes = bytes; self.companion = companion
    }
}
