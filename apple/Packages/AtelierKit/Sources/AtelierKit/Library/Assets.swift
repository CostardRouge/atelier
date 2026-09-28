// The asset library model — port of `src/shared/library/assets.ts`.
//
// A single drop/folder can mix videos, their telemetry sidecars, and photos.
// `buildAssets` groups raw files into logical ASSETS keyed by base name, so a
// `DJI_0001.MP4` + `DJI_0001.SRT` become one `video+telemetry` asset, and
// `IMG_8801.RAF` + `IMG_8801.JPG` one `photo` asset. Each tool then reads the
// parts (and kinds) it cares about.
//
// The web holds `File` handles here — lazy references to bytes on disk, never
// read. The kernel's handle is `SavedMediaRef` (name · size · lastModified,
// exactly the three fields the web reads off a `File`): the app lists a
// folder into refs and nothing here opens one.
//
// Rules kept from `architecture.md`: the first file to claim a slot wins so
// grouping is deterministic — except the image slot, which goes by RANK
// (drawable beats a RAW beats a HEIF/TIFF) so the listing order never decides
// which half of a pair is shown; the half that loses the slot is KEPT in
// `siblings`, it being one of the capture's renditions; and the asset's size
// counts them all.

import Foundation

/// What a tool can do with an asset, derived from which parts it holds.
public enum AssetKind: String, Codable, Sendable, CaseIterable {
    case videoTelemetry = "video+telemetry"
    case video
    case telemetry
    case photo
    case other
}

/// The concrete files that make up one asset (any combination).
public struct AssetParts: Equatable, Sendable {
    public var video: SavedMediaRef?
    public var srt: SavedMediaRef?
    public var image: SavedMediaRef?
    /// The capture's OTHER image files — the ones that did not take the
    /// `image` slot: the `.DNG` beside a DJI's `.JPG`, the `.HIF` beside a
    /// Sony's `.ARW`. Kept because they are the capture's renditions
    /// (`Media/Renditions.swift`) and a folder is the only place a card-only
    /// workflow can find them. In listing order; a tool that wants ONE picture
    /// keeps reading `image` and never these. Nil until a second image lands.
    public var siblings: [SavedMediaRef]?

    public init(video: SavedMediaRef? = nil, srt: SavedMediaRef? = nil, image: SavedMediaRef? = nil, siblings: [SavedMediaRef]? = nil) {
        self.video = video; self.srt = srt; self.image = image; self.siblings = siblings
    }
}

public struct Asset: Equatable, Sendable {
    /// Stable identity (lowercased base name) — keys, selection.
    public var id: String
    /// Base name without extension, e.g. `DJI_0001`, for display.
    public var baseName: String
    public var parts: AssetParts
    public var kind: AssetKind
    /// Sum of the parts' sizes, in bytes.
    public var size: Int

    public init(id: String, baseName: String, parts: AssetParts, kind: AssetKind, size: Int) {
        self.id = id; self.baseName = baseName; self.parts = parts; self.kind = kind; self.size = size
    }
}

/// The part slot a file fills.
public enum PartKind: String, Sendable {
    case video, srt, image, other
}

private let videoExtensions: Set<String> = ["mp4", "mov", "m4v", "webm"]

/// Formats a browser can normally decode and draw — `heic`/`heif`/`hif` being
/// the honest exception the list has always carried: only WebKit decodes them,
/// and a source's proxy is what every other browser draws instead. `hif` is
/// Sony's and Canon's spelling of the same thing (an A7C II shoots `.HIF`
/// beside its `.ARW`), so leaving it out classified those stills as junk and
/// dropped them at the library's door.
private let encodedImageExtensions: Set<String> = [
    "jpg", "jpeg", "png", "heic", "heif", "hif", "webp", "tif", "tiff", "avif", "gif",
]

/// Camera RAW — handles are kept even though a browser cannot decode them.
private let rawExtensions: Set<String> = [
    "raf", "arw", "cr2", "cr3", "nef", "dng", "orf", "rw2", "raw", "srw", "pef",
]

/// The narrower list inside `encodedImageExtensions`: what a browser really
/// draws ON ITS OWN, in every browser. HEIF and TIFF are pictures WebKit alone
/// decodes, so they are recognised as images and never counted on to DRAW one.
/// `bmp` is here and not above on purpose: nobody shoots one, but an original
/// may be one, and this list is also what says an export can deliver from a
/// file rather than from the render.
private let drawableImageExtensions: Set<String> = ["jpg", "jpeg", "png", "webp", "avif", "gif", "bmp"]

/// Split a filename into `(base, ext)`; ext is lowercased, no leading dot.
private func splitBaseExt(_ name: String) -> (base: String, ext: String) {
    guard let dot = name.lastIndex(of: "."), dot != name.startIndex else { return (name, "") }
    return (String(name[..<dot]), name[name.index(after: dot)...].lowercased())
}

/// The base name (without extension) of a file, for display/comparison.
public func fileBaseName(_ name: String) -> String {
    splitBaseExt(name).base
}

/// True for a camera RAW. Public because "can this be decoded and drawn?" is
/// a question the library, the metadata reader and the studio all ask, and
/// one list of extensions must answer it for all three.
public func isRawImage(_ name: String) -> Bool {
    rawExtensions.contains(splitBaseExt(name).ext)
}

/// True where any browser draws this file without a decoder of our own.
public func isDrawableImage(_ name: String) -> Bool {
    drawableImageExtensions.contains(splitBaseExt(name).ext)
}

/// Which file of one capture fills the image slot, when several could.
///
/// Not "the one that is not a RAW": a Sony shoots `.ARW` + `.HIF`, and the
/// HEIF is the half MOST browsers cannot draw at all, while the RAW draws
/// through the render its camera wrote inside it. Ranking rather than
/// yielding is also what makes the answer independent of the order the
/// directory listed the two files in.
private func imageRank(_ name: String) -> Int {
    if isDrawableImage(name) { return 2 }
    if isRawImage(name) { return 1 }
    return 0
}

/// Classify a file by extension into the part slot it fills.
public func classifyPart(_ name: String) -> PartKind {
    let ext = splitBaseExt(name).ext
    if videoExtensions.contains(ext) { return .video }
    if ext == "srt" { return .srt }
    if encodedImageExtensions.contains(ext) || rawExtensions.contains(ext) { return .image }
    return .other
}

/// Derive an asset's kind from which parts it holds.
private func kindOf(_ parts: AssetParts) -> AssetKind {
    if parts.video != nil && parts.srt != nil { return .videoTelemetry }
    if parts.video != nil { return .video }
    if parts.image != nil { return .photo }
    if parts.srt != nil { return .telemetry }
    return .other
}

/// The type a capture's file is known by on screen: its extension upper-cased, `JPEG` for both spellings.
public func captureFileType(_ name: String) -> String {
    let ext = splitBaseExt(name).ext
    if ext == "jpg" || ext == "jpeg" { return "JPEG" }
    return ext.isEmpty ? "file" : ext.uppercased()
}

/// The types of the capture's OTHER image files — the `DNG` beside a DJI's
/// JPEG, the `ARW` beside a Sony's JPEG — once each, in the order they came.
/// This is what the row says, so a RAW filed as a sibling is never silent.
public func siblingTypes(_ parts: AssetParts) -> [String] {
    var out: [String] = []
    for file in parts.siblings ?? [] {
        let type = captureFileType(file.name)
        if !out.contains(type) { out.append(type) }
    }
    return out
}

/// True when one of the capture's other files is a camera RAW.
public func hasRawSibling(_ parts: AssetParts) -> Bool {
    (parts.siblings ?? []).contains { isRawImage($0.name) }
}

/// Every file of an asset, the siblings included — what leaves when it does.
public func assetFiles(_ parts: AssetParts) -> [SavedMediaRef] {
    var out: [SavedMediaRef] = []
    if let v = parts.video { out.append(v) }
    if let s = parts.srt { out.append(s) }
    if let i = parts.image { out.append(i) }
    out.append(contentsOf: parts.siblings ?? [])
    return out
}

private func sizeOf(_ parts: AssetParts) -> Int {
    assetFiles(parts).reduce(0) { $0 + $1.size }
}

/// `localeCompare`, near enough for file names: letters compared without
/// their case first, the raw text deciding a tie — so `a` sorts before `B`
/// as it does in the web's list.
private func baseNameOrder(_ a: String, _ b: String) -> Bool {
    let la = a.lowercased(), lb = b.lowercased()
    if la != lb { return la < lb }
    return a < b
}

/// Group raw files into logical assets, keyed by base name (case-insensitive).
///
/// - Recognised videos, SRTs and images fill an asset's parts; anything else
///   (`.LRF` proxies, `.THM`, hidden dotfiles) is ignored.
/// - First file to claim a slot wins, so the result is deterministic. An image
///   that loses the slot is kept in `siblings` rather than dropped.
/// - Sorted by base name for stable ordering.
public func buildAssets(_ files: [SavedMediaRef]) -> [Asset] {
    var order: [String] = []
    var groups: [String: (baseName: String, parts: AssetParts)] = [:]

    for file in files {
        let name = file.name
        if name.hasPrefix(".") { continue } // hidden / junk

        let part = classifyPart(name)
        if part == .other { continue }

        let base = fileBaseName(name)
        let key = base.lowercased()
        if groups[key] == nil {
            groups[key] = (base, AssetParts())
            order.append(key)
        }
        guard var group = groups[key] else { continue }

        switch part {
        case .video:
            if group.parts.video == nil { group.parts.video = file }
        case .srt:
            if group.parts.srt == nil { group.parts.srt = file }
        case .image:
            // First to claim the slot wins among equals — but a file the
            // browser can really DRAW always outranks one it cannot. An
            // `IMG_8801.RAF` + `IMG_8801.JPG` pair is one photo and the JPEG
            // is the half every tool wants to show, grade and export; a
            // `DSC00123.ARW` + `DSC00123.HIF` pair is one photo too, and there
            // the RAW is the better half, since only WebKit draws a HEIF while
            // the RAW draws through its own render.
            if let current = group.parts.image {
                if imageRank(name) > imageRank(current.name) {
                    group.parts.image = file
                    group.parts.siblings = (group.parts.siblings ?? []) + [current]
                } else {
                    group.parts.siblings = (group.parts.siblings ?? []) + [file]
                }
            } else {
                group.parts.image = file
            }
        case .other:
            break
        }
        groups[key] = group
    }

    var assets: [Asset] = []
    for key in order {
        guard let group = groups[key] else { continue }
        assets.append(Asset(id: key, baseName: group.baseName, parts: group.parts, kind: kindOf(group.parts), size: sizeOf(group.parts)))
    }
    // A stable sort, as `Array.prototype.sort` is: equal names keep their order.
    let indexed = assets.enumerated().map { ($0.offset, $0.element) }
    return indexed.sorted { a, b in
        if a.1.baseName != b.1.baseName { return baseNameOrder(a.1.baseName, b.1.baseName) }
        return a.0 < b.0
    }.map { $0.1 }
}

/// A stable identity for a file handle, used to dedupe across repeated drops —
/// `name__size__lastModified`, the number written as JavaScript writes it.
public func fileIdentity(_ file: SavedMediaRef) -> String {
    let modified = file.lastModified
    let stamp: String
    if modified.isFinite, modified == modified.rounded(), abs(modified) < 1e15 {
        stamp = String(Int64(modified))
    } else {
        stamp = "\(modified)"
    }
    return "\(file.name)__\(file.size)__\(stamp)"
}
