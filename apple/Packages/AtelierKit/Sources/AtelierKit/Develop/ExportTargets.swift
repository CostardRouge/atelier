// Where a roll's export goes, and at what size: its TARGETS — the part of
// `src/shared/develop/export-targets.ts` that `Roll.swift` does not carry.
// The record (`SizeMode`, `ExportSize`, `OutputSharpen`, `ExportTarget`,
// `maxTargets`, `qualityLimits`, `sizeLimits`), the readers (`readSize`,
// `readTarget`, `readTargets`), `longEdgeFor`, `describeSize` and
// `targetFolder` are `Roll.swift`'s and are reused here, never re-ported.
//
// Rules kept (`develop-output.md`): names never change — the first target
// writes into the folder chosen at the click, every other one into a
// sub-folder named after it; a size is a CAP read against the picture's own
// delivered frame and never upscales; one run renders each picture ONCE and
// cuts every target from that render, so the decode and the original fetch
// are sized by the target that asks the most.

import Foundation

/// `OUTPUT_SHARPEN_LEVELS`: the screen sharpening a target may ask, weakest first.
public let outputSharpenLevels: [OutputSharpen] = OutputSharpen.allCases

/// The targets a run can start from — Lightroom's export presets, the ones a
/// photographer reaches for. A target added from one is an ordinary target
/// afterwards, every field its own.
public let targetPresets: [(id: String, label: String, target: ExportTarget)] = [
    ("full", "Full size", ExportTarget(name: "Full", size: nil, quality: 0.92, sharpen: .off, watermark: false)),
    ("web", "Web · 2048 px", ExportTarget(name: "Web", size: ExportSize(mode: .long, value: 2048), quality: 0.85, sharpen: .standard, watermark: false)),
    ("feed", "Feed · 1080 px across", ExportTarget(name: "Feed", size: ExportSize(mode: .short, value: 1080), quality: 0.9, sharpen: .standard, watermark: false)),
    ("mail", "Mail · 2 MP", ExportTarget(name: "Mail", size: ExportSize(mode: .megapixels, value: 2), quality: 0.8, sharpen: .low, watermark: false)),
    ("half", "Half · 50 %", ExportTarget(name: "Half", size: ExportSize(mode: .percent, value: 50), quality: 0.9, sharpen: .low, watermark: false)),
]

/// The long edge a decode must at least hold for these targets, known before
/// the picture is: the largest `long` asked, or nil (decode whole) as soon as
/// one target's size depends on the picture's own shape or size.
public func decodeEdgeFor(_ targets: [ExportTarget]) -> Double? {
    var edge = 0.0
    for t in targets {
        guard let size = t.size, size.mode == .long else { return nil }
        edge = max(edge, size.value)
    }
    return edge == 0 ? nil : edge
}

/// The size that asks the MOST of a picture among these targets, for the one
/// question a run asks before it renders — is the original worth fetching?
/// Full size wins outright; a percentage is as large as its share; between two
/// edges or areas, the one read against a 3:2 frame is larger.
public func largestSize(_ targets: [ExportTarget]) -> ExportSize? {
    if targets.isEmpty || targets.contains(where: { $0.size == nil }) { return nil }
    var best: ExportSize? = nil
    var edge = -1.0
    for t in targets {
        let e = longEdgeFor(t.size, width: 6000, height: 4000).map(Double.init) ?? .infinity
        if e > edge {
            edge = e
            best = t.size
        }
    }
    return edge == .infinity ? nil : best
}

/// `Web/ · 2048 px long edge · 85 % · standard screen sharpening` — one
/// target, as a line says it; the first writes into `this folder`.
public func describeTarget(_ t: ExportTarget, first: Bool) -> String {
    let place = first ? "this folder" : "\(targetFolder(t.name, index: 1))/"
    let sharp = t.sharpen == .off ? "" : " · \(t.sharpen.rawValue) screen sharpening"
    let mark = t.watermark ? " · watermarked" : ""
    let quality = Int((t.quality * 100 + 0.5).rounded(.down))
    return "\(place) · \(describeSize(t.size)) · \(quality) %\(sharp)\(mark)"
}

/// Two targets that write the same files.
public func sameTarget(_ a: ExportTarget, _ b: ExportTarget) -> Bool {
    a.name == b.name && a.quality == b.quality && a.sharpen == b.sharpen && a.watermark == b.watermark && a.size == b.size
}

/// The same size re-expressed in another mode for a frame of this shape, so a
/// mode switch keeps roughly the picture asked for rather than jumping to a
/// default — `2048 long` on a 3:2 becomes `1365 short`.
public func convertSize(_ size: ExportSize?, _ mode: SizeMode, frame: Size = Size(3, 2)) -> ExportSize {
    let long = max(frame.width, frame.height)
    let short = min(frame.width, frame.height)
    let ratio = long > 0 && short > 0 ? long / short : 1.5
    func fallback(_ m: SizeMode) -> Double {
        switch m {
        case .long: return 2048
        case .short: return 1080
        case .megapixels: return 12
        case .percent: return 50
        }
    }
    if mode == .percent {
        return ExportSize(mode: mode, value: size?.mode == .percent ? size?.value ?? fallback(.percent) : fallback(.percent))
    }
    var edge: Double? = nil
    if let size {
        switch size.mode {
        case .long: edge = size.value
        case .short: edge = size.value * ratio
        case .megapixels: edge = (size.value * 1e6 * ratio).squareRoot()
        case .percent: edge = nil
        }
    }
    guard let edge else { return ExportSize(mode: mode, value: fallback(mode)) }
    let value: Double
    switch mode {
    case .long: value = edge
    case .short: value = edge / ratio
    default: value = (edge * (edge / ratio)) / 1e6
    }
    return readSize(.object(["mode": .string(mode.rawValue), "value": .number(value)])) ?? ExportSize(mode: mode, value: fallback(mode))
}
