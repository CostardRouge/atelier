// Export variants — one press of Export can produce several deliverables of
// the same composition: reframed to another destination aspect, capped to a
// delivery resolution, with or without the overlays. Port of
// `src/shared/projects/export-variants.ts`, pure; the video work is the app's
// (`Media/WebcodecsExport.swift` has the arithmetic, AVFoundation the rest).
//
// Conventions kept:
// - `aspectId: "source"` keeps the clip's own frame; a preset id (9:16, …)
//   cover-crops into that frame at the source's pixel density. The presets
//   are the ONE table in `Develop/AspectTable.swift`.
// - `resolution` is the SHORT side (how delivery platforms speak: 1080p
//   vertical = 1080×1920). `source` keeps the source density. Never upscales.
// - `frameRate` is the delivery cadence; `source` keeps the clip's own and is
//   the only exact pass-through (`Media/FrameRate.swift`).
// - `speed` is the delivered speed (1 = as shot). It changes the DURATION,
//   not the cadence — and a re-timed variant ships silent, because the audio
//   is copied, never re-encoded.
// - File names are `<base>[-9x16][-1080p][-30fps][-clean].mp4` — suffixes
//   only where a variant departs from the source, so the plain export keeps a
//   plain name. A number is spelled as JavaScript spells it (`1080`, `0.5`).
//
// A stored variant is read as the web's renderer would take it: an absent
// field reads as the value the web's code gives `undefined` (`overlays`
// absent is falsy — CLEAN — exactly as `variantSuffix` reads it), and a key
// this build does not know is carried back verbatim.

import Foundation

/// The web's `VariantResolution`: `'source' | 1080 | 720` — kept open to any
/// short side a newer build stores.
public enum VariantResolution: Equatable, Sendable {
    case source
    /// The delivered SHORT side, in pixels.
    case shortSide(Double)
}

public struct ExportVariant: Equatable, Sendable {
    public var id: String
    /// `source`, or an aspect preset id.
    public var aspectId: String
    public var resolution: VariantResolution
    /// Delivery frame rate; `source` keeps the clip's own cadence.
    public var frameRate: ExportFrameRate
    /// Delivered speed; 1 keeps the clip's own. Re-timed variants have no audio.
    public var speed: Double
    /// Burn the overlay elements (and their theme) in, or deliver clean.
    public var overlays: Bool
    /// Keys this build does not interpret, written back verbatim.
    public var carried: [String: JSONValue] = [:]

    public init(id: String, aspectId: String = "source", resolution: VariantResolution = .source,
                frameRate: ExportFrameRate = .source, speed: Double = 1, overlays: Bool = true) {
        self.id = id; self.aspectId = aspectId; self.resolution = resolution; self.frameRate = frameRate
        self.speed = speed; self.overlays = overlays
    }
}

/// A fresh variant — the web's `crypto.randomUUID()` id, lowercase.
public func createVariant(_ aspectId: String = "source", id: String = UUID().uuidString.lowercased()) -> ExportVariant {
    ExportVariant(id: id, aspectId: aspectId, resolution: .source, frameRate: .source, speed: 1, overlays: true)
}

/// The out-of-the-box export: source frame, density and cadence, overlays in.
public func defaultVariants() -> [ExportVariant] {
    [createVariant("source")]
}

/// The gap between what a variant ASKS for and what the source can give.
public struct ResolutionShortfall: Equatable, Sendable {
    public var asked: Double
    public var delivered: Double

    public init(asked: Double, delivered: Double) { self.asked = asked; self.delivered = delivered }
}

/// The gap between what a variant asks for and what the source can give, or
/// nil when it gets what it asked for.
///
/// `variantOutputSize` never upscales, so a variant set to 1080 over a 720p
/// source quietly delivers 720. Quietly is the problem: the row says 1080p,
/// the file is not, and nothing on screen admits it. This is the fact the
/// export panel states, and — for a source that is a remote proxy — the
/// reason it offers the capture instead.
public func resolutionShortfall(_ variant: ExportVariant, _ srcW: Double, _ srcH: Double) -> ResolutionShortfall? {
    guard case .shortSide(let asked) = variant.resolution, srcW != 0, srcH != 0, !srcW.isNaN, !srcH.isNaN else {
        return nil
    }
    let out = variantOutputSize(variant, srcW, srcH)
    let delivered = min(out.width, out.height)
    return delivered < asked ? ResolutionShortfall(asked: asked, delivered: delivered) : nil
}

/// JavaScript's `Math.round`: halves toward +∞.
private func roundHalfUpForVariant(_ x: Double) -> Double {
    let down = x.rounded(.down)
    return x - down >= 0.5 ? down + 1 : down
}

/// Output dimensions for a variant over a `srcW`×`srcH` source (display
/// orientation). Preset aspects cover-crop at the source's pixel density; the
/// resolution caps the short side (never upscaling); both dimensions are
/// forced even for H.264.
public func variantOutputSize(_ variant: ExportVariant, _ srcW: Double, _ srcH: Double) -> Size {
    var baseW = srcW
    var baseH = srcH
    if variant.aspectId != "source", let preset = aspectPreset(variant.aspectId) {
        let ratio = preset.w / preset.h
        let short = min(srcW, srcH)
        if ratio >= 1 {
            baseH = short
            baseW = short * ratio
        } else {
            baseW = short
            baseH = short / ratio
        }
    }
    if case .shortSide(let lines) = variant.resolution {
        let shortSide = min(baseW, baseH)
        let scale = min(1, lines / shortSide)
        baseW *= scale
        baseH *= scale
    }
    return Size(even(roundHalfUpForVariant(baseW)), even(roundHalfUpForVariant(baseH)))
}

/// What a variant is rendering. A still uses the same `ExportVariant` — an
/// aspect to reframe into, a resolution to cap at, overlays on or off — but
/// cadence and speed are meaningless over one frame, so they take no part in
/// its name and no part in its render.
public enum VariantMedium: String, CaseIterable, Sendable {
    case video
    case photo

    /// File extension a medium delivers in (the web's `MEDIUM_EXTENSION`).
    public var fileExtension: String {
        switch self {
        case .video: return "mp4"
        case .photo: return "jpg"
        }
    }
}

/// The web's `MEDIUM_EXTENSION`.
public let mediumExtension: [VariantMedium: String] = [.video: "mp4", .photo: "jpg"]

/// JavaScript's `${n}`: an integer-valued number prints without `.0`.
private func variantNumberText(_ x: Double) -> String {
    if x.isFinite, x == x.rounded(), abs(x) < 1e15 { return String(Int64(x)) }
    return "\(x)"
}

/// The name parts a variant appends: only where it departs from the source.
public func variantSuffix(_ variant: ExportVariant, _ medium: VariantMedium = .video) -> String {
    var parts: [String] = []
    if variant.aspectId != "source" {
        // `String.replace(':', 'x')` replaces the FIRST colon only.
        var aspect = variant.aspectId
        if let colon = aspect.firstIndex(of: ":") { aspect.replaceSubrange(colon...colon, with: "x") }
        parts.append(aspect)
    }
    if case .shortSide(let lines) = variant.resolution { parts.append("\(variantNumberText(lines))p") }
    if medium == .video {
        if case .fps(let fps) = variant.frameRate { parts.append("\(variantNumberText(fps))fps") }
        if let speed = speedSuffix(variant.speed) { parts.append(speed) }
    }
    if !variant.overlays { parts.append("clean") }
    return parts.joined(separator: "-")
}

/// Final download name: the (custom or project) base plus the suffix.
public func variantFileName(_ base: String, _ variant: ExportVariant, _ medium: VariantMedium = .video) -> String {
    // Strip any delivery extension the base already carries, whichever medium
    // it named: the file name is a project setting, and stepping from a clip
    // to a still inside one project must not produce `shot.mp4.jpg`.
    var cleanBase = base.trimmingCharacters(in: .whitespacesAndNewlines)
    if let range = cleanBase.range(of: #"\.(mp4|jpe?g)$"#, options: [.regularExpression, .caseInsensitive]) {
        cleanBase.removeSubrange(range)
    }
    if cleanBase.isEmpty { cleanBase = "export" }
    let suffix = variantSuffix(variant, medium)
    return suffix.isEmpty ? "\(cleanBase).\(medium.fileExtension)" : "\(cleanBase)-\(suffix).\(medium.fileExtension)"
}

/// True when this variant re-times, and therefore delivers without audio.
public func variantIsRetimed(_ variant: ExportVariant) -> Bool {
    resolveSpeed(variant.speed) != 1
}

// MARK: - JSON

private let variantKeys: Set<String> = ["id", "aspectId", "resolution", "frameRate", "speed", "overlays"]

/// A stored variant read back — nil when it is not a record. What is absent
/// reads as the web's code reads `undefined`: the source frame, density and
/// cadence, normal speed, and NO overlays (a falsy `overlays` is a clean
/// variant there). A missing id is minted, as a list needs one per row.
public func readExportVariant(_ raw: JSONValue?, makeId: () -> String = { UUID().uuidString.lowercased() }) -> ExportVariant? {
    guard let o = raw?.objectValue else { return nil }
    var resolution = VariantResolution.source
    if let lines = o["resolution"]?.finiteNumber { resolution = .shortSide(lines) }
    var frameRate = ExportFrameRate.source
    if let fps = o["frameRate"]?.finiteNumber { frameRate = .fps(fps) }
    var variant = ExportVariant(
        id: (o["id"]?.stringValue).flatMap { $0.isEmpty ? nil : $0 } ?? makeId(),
        aspectId: o["aspectId"]?.stringValue ?? "source",
        resolution: resolution,
        frameRate: frameRate,
        speed: o["speed"]?.finiteNumber ?? 1,
        overlays: o["overlays"]?.boolValue ?? false
    )
    variant.carried = o.filter { !variantKeys.contains($0.key) }
    return variant
}

extension VariantResolution {
    public var json: JSONValue {
        switch self {
        case .source: return .string("source")
        case .shortSide(let lines): return .number(lines)
        }
    }
}

extension ExportVariant {
    public var json: JSONValue {
        var o = carried
        o["id"] = .string(id)
        o["aspectId"] = .string(aspectId)
        o["resolution"] = resolution.json
        switch frameRate {
        case .source: o["frameRate"] = .string("source")
        case .fps(let fps): o["frameRate"] = .number(fps)
        }
        o["speed"] = .number(speed)
        o["overlays"] = .bool(overlays)
        return .object(o)
    }
}
