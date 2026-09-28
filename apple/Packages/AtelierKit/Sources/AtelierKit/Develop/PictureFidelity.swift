// What a picture IS, for the Develop sheet's chip — and the sentence about
// what it can give back. Port of `src/shared/develop/picture-fidelity.ts`.
//
// An 8-bit picture clips at white; only a RAW keeps what the sensor saw above
// it, and a RAW that has not been opened on its sensor is on screen through
// the render its camera wrote inside it. The chip names the BITS and the
// PIXELS both (`develop.md`, 2026-09-20): a DJI `dji_fly_*.DNG` carries a
// 960 × 540 render against an 8064 × 4536 sensor plane — 8.4× short on the
// long edge — and the number is the answer. Nothing is claimed that was not
// measured: a host that has not decoded yet hands no pixels and gets no size.
//
// The web reads a `File` (its name, its media type), whether it is a working
// preview (`working-preview.ts`) and the source's `mediaOrigin(file)`; the
// kernel is handed those four facts as a `FidelityFile`.

import Foundation

public struct PictureFidelity: Equatable, Sendable {
    /// The chip beside the sheet's title, or nil with no picture.
    public var chip: String?
    /// One line under the picture, or nil when there is nothing to warn about.
    public var note: String?
    public init(chip: String?, note: String?) { self.chip = chip; self.note = note }
}

/// The file a host is showing, as far as the chip cares.
public struct FidelityFile: Equatable, Sendable {
    public var name: String
    /// The media type the file declares — `""` when it declares none, as a RAW
    /// off a disk and an original fetched from an instance both do.
    public var type: String
    /// True when a stored working preview stands in for the file.
    public var workingPreview: Bool
    /// Where a source says it came from; nil for a file opened from a disk.
    public var origin: MediaOrigin?

    public init(name: String, type: String = "", workingPreview: Bool = false, origin: MediaOrigin? = nil) {
        self.name = name; self.type = type; self.workingPreview = workingPreview; self.origin = origin
    }
}

/// The pixels a host has actually measured for the picture it is showing.
public struct FidelityPixels: Equatable, Sendable {
    /// What was decoded, and is on screen.
    public var width: Int
    public var height: Int
    /// True when those pixels are the JPEG a camera wrote INSIDE a RAW rather
    /// than the file's own (`DecodedPhoto.viaRawPreview` on the web).
    public var viaRawPreview: Bool
    /// The pixels the FILE itself holds, when a source or a probe knows them
    /// and they are larger: a proxy's original, a RAW's sensor plane.
    public var full: PixelSize?

    public init(width: Int, height: Int, viaRawPreview: Bool = false, full: PixelSize? = nil) {
        self.width = width; self.height = height; self.viaRawPreview = viaRawPreview; self.full = full
    }

    public var size: PixelSize { PixelSize(width: width, height: height) }
}

/// The long edge a working preview holds at most — `working-preview.ts`'s
/// `WORKING_PREVIEW_EDGE`, whose port owns the name.
private let fidelityPreviewEdge = 2048

/// Megapixels of a plane: `36.58` for 8064 × 4536.
public func megapixels(_ width: Double, _ height: Double) -> Double {
    (width * height) / 1e6
}

/// `8064 × 4536 · 36.6 MP`, or nil when nothing was measured.
public func pixelsLabel(_ pixels: PixelSize?) -> String? {
    guard let pixels, pixels.width > 0, pixels.height > 0 else { return nil }
    let mp = megapixels(Double(pixels.width), Double(pixels.height))
    return "\(pixels.width) × \(pixels.height) · \(fidelityFixed1(mp)) MP"
}

/// How far what is on screen falls short of what the file holds:
/// `8.4× short on the long edge of its 8064 × 4536`. Nil when the two are the
/// same picture — or when the shown pixels already reach it, which is the
/// ordinary case and deserves no sentence at all (a percent of rounding is
/// not a shortfall).
public func shortfallLabel(_ shown: PixelSize, _ full: PixelSize?) -> String? {
    guard let full, full.width > 0, full.height > 0, shown.width > 0 else { return nil }
    let shownLong = Double(max(shown.width, shown.height))
    let fullLong = Double(max(full.width, full.height))
    if fullLong <= shownLong * 1.02 { return nil }
    return "\(fidelityFixed1(fullLong / shownLong))× short on the long edge of its \(full.width) × \(full.height)"
}

/// `· 960 × 540`, for a chip; empty when nothing was measured.
private func chipPixels(_ pixels: FidelityPixels?) -> String {
    guard let pixels, pixels.width > 0, pixels.height > 0 else { return "" }
    return " · \(pixels.width) × \(pixels.height)"
}

/// The size and the shortfall as one clause, for a note; empty when neither is known.
private func sizeClause(_ pixels: FidelityPixels?) -> String {
    guard let pixels, let label = pixelsLabel(pixels.size) else { return "" }
    if let short = shortfallLabel(pixels.size, pixels.full) { return " — \(label), \(short)" }
    return " — \(label)"
}

/// `RAW`, `JPEG`, or the bare extension — `media/image-meta.ts`'s `imageTypeLabel`.
private func fidelityTypeLabel(_ name: String) -> String {
    if isRawImage(name) { return "RAW" }
    guard let dot = name.lastIndex(of: ".") else { return "image" }
    let ext = name[name.index(after: dot)...].lowercased()
    if ext == "jpg" || ext == "jpeg" { return "JPEG" }
    return ext.isEmpty ? "image" : ext.uppercased()
}

/// `base` is the RUNG of the material ladder the develop stands on: above
/// `proxy` the picture on screen is the SENSOR's data decoded to linear light,
/// whatever the file in hand is, and the higher rungs add the camera's own
/// calibration on top. `pixels` is what the host measured, and is optional on
/// purpose: the sentence never invents a size it was not given.
public func pictureFidelity(_ file: FidelityFile?, _ base: DevelopBase? = nil, _ pixels: FidelityPixels? = nil) -> PictureFidelity {
    guard let file else { return PictureFidelity(chip: nil, note: nil) }
    if let base, base.rung > 0 {
        let adds: String
        let applied: String
        switch base {
        case .gainMapWarp:
            adds = " · gain map + warp"
            applied = ", with the shading and the rectilinear warp its file was calibrated for"
        case .gainMap:
            adds = " · gain map"
            applied = ", with the shading its file was calibrated for"
        default:
            adds = ""
            applied = ", with none of the calibration its file carries"
        }
        return PictureFidelity(
            chip: "RAW · 16-bit linear\(adds)\(chipPixels(pixels))",
            note: "the sensor’s own data, decoded to linear light\(applied): what it kept above the displayed white is here to bring back\(sizeClause(pixels))"
        )
    }
    if file.workingPreview {
        return PictureFidelity(
            chip: "working preview · \(fidelityPreviewEdge)\(chipPixels(pixels))",
            note: "its working preview, \(fidelityPreviewEdge) px at most — reopen its folder to develop and export the file itself\(sizeClause(pixels))"
        )
    }
    if let origin = file.origin, origin.fidelity == .proxy {
        return PictureFidelity(
            chip: "proxy · 8-bit\(chipPixels(pixels))",
            note: "an 8-bit proxy from \(origin.sourceId): highlights above white are already gone here\(sizeClause(pixels))"
        )
    }
    // BEFORE the media-type test: a RAW off a disk usually carries an empty
    // type, so asking the type first called every DNG a clip. It is on screen
    // at all only through the render its camera wrote inside it, and "8-bit"
    // alone would let that pass for the file's own pixels.
    if isRawImage(file.name) || pixels?.viaRawPreview == true {
        let size = pixels.flatMap { pixelsLabel($0.size) }
        let short = pixels.flatMap { shortfallLabel($0.size, $0.full) }
        let measured = size.map { "\($0)\(short.map { ", \($0)" } ?? "") — and 8-bit" } ?? "8-bit"
        return PictureFidelity(
            chip: "\(fidelityTypeLabel(file.name)) · camera render\(chipPixels(pixels))",
            note: "the JPEG your camera wrote inside the RAW, not the sensor data: \(measured), so highlights above white are already gone from it"
        )
    }
    // By NAME before by type: a file fetched from an instance carries an empty
    // type, and calling a JPEG a clip on that account is the one sentence this
    // must never say.
    if classifyPart(file.name) != .image && !file.type.hasPrefix("image/") {
        return PictureFidelity(chip: "clip · 8-bit\(chipPixels(pixels))", note: nil)
    }
    return PictureFidelity(
        chip: "\(fidelityTypeLabel(file.name)) · 8-bit\(chipPixels(pixels))",
        note: "an 8-bit picture: highlights above white are already gone\(sizeClause(pixels))"
    )
}

/// `toFixed(1)` on a non-negative value, a half going UP as JavaScript's does.
private func fidelityFixed1(_ x: Double) -> String {
    guard x.isFinite else { return "Infinity" }
    let tenths = Int64((x * 10).rounded(.toNearestOrAwayFromZero))
    return "\(tenths / 10).\(tenths % 10)"
}
