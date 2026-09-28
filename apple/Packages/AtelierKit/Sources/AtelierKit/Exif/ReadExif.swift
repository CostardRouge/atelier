// One photograph's EXIF, from wherever it can be had — port of
// `src/shared/exif/read-exif.ts`.
//
// Two accounts exist and both are worth reading: the bytes in hand, and what
// the source that handed the file over parsed at ingest (the web's
// `MediaOrigin.exif`). A source's editing rendition is a re-encode, and a
// re-encode drops the metadata — Winnow's photo proxy is a WebP with none —
// so a picture read from its own bytes alone answers `—` on every field while
// the camera's own record sits one property away.
//
// The rules it keeps from the web module:
// - This is the ONE place that combination is made: the file's own EXIF, then
//   the source's account merged UNDER it (`mergeExif` — the file always wins,
//   field by field). Every reader that shows or draws a still's EXIF goes
//   through here, so no two panels disagree on what a picture says.
// - Reading never fails: a head that could not be read (a revoked
//   permission, a file that vanished) is `nil`, and the source's account then
//   stands on its own — the honest answer rather than an error.
// - `via` names the instance that vouched, so a panel can say "read from
//   winnow.example" instead of presenting a column as the file's own.
//
// The kernel's `MediaOrigin` deliberately carries only the source's FACTS
// (`Media/MediaOrigin.swift`), so the EXIF the source parsed at ingest is
// handed in beside it rather than read off it. Left to the app: reading the
// file's first `exifSliceBytes` (the web slices a `File`) — never the whole
// picture, and never decoding it.

import Foundation

/// What a source knows about a file's capture, and which instance said so.
public struct VouchedExif: Equatable, Sendable {
    public var exif: ExifData
    public var via: String
    public init(exif: ExifData, via: String) { self.exif = exif; self.via = via }
}

public struct EffectiveExif: Equatable, Sendable {
    /// File over source, field by field. Empty when neither said anything.
    public var exif: ExifData
    /// What the bytes in hand said on their own — empty for a re-encode.
    public var file: ExifData
    /// The instance that vouched for the rest, when one did.
    public var via: String?

    public init(exif: ExifData, file: ExifData, via: String?) {
        self.exif = exif; self.file = file; self.via = via
    }
}

/// What a source knows about a file's capture, or nil: no source handed the
/// file over, or it vouched for nothing readable. `exif` is the record the
/// source parsed at ingest, kept beside `origin`.
public func vouchedExif(_ origin: MediaOrigin?, _ exif: ExifData?) -> VouchedExif? {
    guard let origin, let exif, !isEmptyExif(exif) else { return nil }
    return VouchedExif(exif: exif, via: origin.sourceId)
}

/// The EXIF of a picture from its head bytes (the first `exifSliceBytes` of
/// the file, or nil when they could not be read) and what its source vouched for.
public func readEffectiveExif(_ head: [UInt8]?, _ vouched: VouchedExif?) -> EffectiveExif {
    let fileExif = head.map { parseExif($0) }
    return EffectiveExif(
        exif: mergeExif(fileExif, vouched?.exif) ?? ExifData(),
        file: fileExif ?? ExifData(),
        via: vouched?.via
    )
}

public func readEffectiveExif(_ head: Data?, _ vouched: VouchedExif?) -> EffectiveExif {
    readEffectiveExif(head.map { [UInt8]($0) }, vouched)
}
