// A film's TEXTURE — grain and halation — as a record, and the arithmetic
// that makes it the same picture at every size. Port of
// `src/shared/film/film-texture.ts`.
//
// Nothing here draws. The texture is spatial (a neighbour, a noise field) and
// so it cannot ride the cube every renderer takes; on the web it is ONE node
// of the render graph, drawn LAST (`render-film.md`), and on Apple it is the
// Core Image side's to draw from these numbers. What is ported is what no
// renderer can change: the record, its reader, and the two proofs of
// resolution independence below.
//
// UNITS. Every size is a fraction of the frame's HEIGHT, never pixels: every
// resampling step in the suite is height-anchored or close (the stage budget
// scales uniformly, a height-preserving cover crop scales by out.h/src.h, a
// framing's zoom magnifies grain with the picture as enlarging a negative
// does), so a grain cell of `f · renderH` pixels lands in the delivered file
// as `f · outH` pixels whatever the chain. The residual is an aspect-changing
// crop (3:2 → 16:9, 19 %), under the just-noticeable threshold for grain and
// with no correct answer — two crops are two enlargements of one negative.
//
// The texture belongs to the GRADE, not to the film layer whose stock it came
// from (`RollGrade.film` carries it as JSON; `filmTextureOrNull` is the ONE
// reader every document goes through).

import Foundation

/// The noise tile's side, in texels — one texel is one grain cell.
public let noiseSize = 256

/// The dials a range is declared for — every field but the tint and the seed.
public enum FilmTextureKey: String, CaseIterable, Sendable {
    case grain, grainSize, grainChroma, grainFps, halation, halationRadius, halationThreshold
}

public struct FilmTexture: Equatable, Sendable {
    /// 0..1. Grain amount. 0 draws none.
    public var grain: Double
    /// A grain cell as a fraction of the frame height.
    public var grainSize: Double
    /// 0..1. 0 is fully luma-correlated grain; 1 is independent per channel (digital chroma noise).
    public var grainChroma: Double
    /// How often the field re-rolls on a clip, per second of SOURCE time; 0 freezes it (a still, a Ken-Burns move).
    public var grainFps: Double
    /// 0..1. Halation amount. 0 runs no blur at all.
    public var halation: Double
    /// The bleed's radius as a fraction of the frame height.
    public var halationRadius: Double
    /// Linear luminance above which a highlight bleeds.
    public var halationThreshold: Double
    /// The bleed's colour, r/g/b in 0..1 — a print's own orange by default.
    public var halationTint: (Double, Double, Double)
    /// The noise field's seed. Stored, so a re-export a year later is byte-identical.
    /// A JSON number on the web (`Math.round`ed), kept as one here.
    public var seed: Double

    public init(grain: Double, grainSize: Double, grainChroma: Double, grainFps: Double,
                halation: Double, halationRadius: Double, halationThreshold: Double,
                halationTint: (Double, Double, Double), seed: Double) {
        self.grain = grain; self.grainSize = grainSize; self.grainChroma = grainChroma; self.grainFps = grainFps
        self.halation = halation; self.halationRadius = halationRadius; self.halationThreshold = halationThreshold
        self.halationTint = halationTint; self.seed = seed
    }

    public static func == (a: FilmTexture, b: FilmTexture) -> Bool {
        a.grain == b.grain && a.grainSize == b.grainSize && a.grainChroma == b.grainChroma
            && a.grainFps == b.grainFps && a.halation == b.halation && a.halationRadius == b.halationRadius
            && a.halationThreshold == b.halationThreshold && a.halationTint == b.halationTint && a.seed == b.seed
    }

    public subscript(key: FilmTextureKey) -> Double {
        get {
            switch key {
            case .grain: return grain
            case .grainSize: return grainSize
            case .grainChroma: return grainChroma
            case .grainFps: return grainFps
            case .halation: return halation
            case .halationRadius: return halationRadius
            case .halationThreshold: return halationThreshold
            }
        }
        set {
            switch key {
            case .grain: grain = newValue
            case .grainSize: grainSize = newValue
            case .grainChroma: grainChroma = newValue
            case .grainFps: grainFps = newValue
            case .halation: halation = newValue
            case .halationRadius: halationRadius = newValue
            case .halationThreshold: halationThreshold = newValue
            }
        }
    }
}

public let textureRanges: [FilmTextureKey: FilmRange] = [
    .grain: FilmRange(min: 0, max: 1, step: 0.01),
    .grainSize: FilmRange(min: 0.0004, max: 0.01, step: 0.0001),
    .grainChroma: FilmRange(min: 0, max: 1, step: 0.01),
    .grainFps: FilmRange(min: 0, max: 120, step: 1),
    .halation: FilmRange(min: 0, max: 1, step: 0.01),
    .halationRadius: FilmRange(min: 0.005, max: 0.2, step: 0.001),
    .halationThreshold: FilmRange(min: 0, max: 1, step: 0.01),
]

/// No texture at all — a stock that has none, and what a reader falls back to.
public let defaultFilmTexture = FilmTexture(
    grain: 0, grainSize: 0.0015, grainChroma: 0.2, grainFps: 24,
    halation: 0, halationRadius: 0.04, halationThreshold: 0.8,
    halationTint: (1, 0.45, 0.2), seed: 1
)

/// True when nothing would be drawn — the node is skipped entirely.
public func isSilentTexture(_ t: FilmTexture?) -> Bool {
    guard let t else { return true }
    return t.grain <= 0 && t.halation <= 0
}

private func clampTo(_ v: JSONValue?, _ r: FilmRange, _ fallback: Double) -> Double {
    let n = v?.finiteNumber ?? fallback
    return min(r.max, max(r.min, n))
}

/// JavaScript's `Math.round`: half rounds toward +∞, never away from zero.
private func jsRound(_ v: Double) -> Double {
    (v + 0.5).rounded(.down)
}

/// A texture read defensively: every number clamped, junk → the default.
public func normaliseFilmTexture(_ raw: JSONValue?) -> FilmTexture {
    let r = raw?.objectValue ?? [:]
    let d = defaultFilmTexture
    var rawTint: [JSONValue] = []
    if let a = r["halationTint"]?.arrayValue, a.count == 3 { rawTint = a }
    func channel(_ i: Int, _ fallback: Double) -> Double {
        guard i < rawTint.count, let v = rawTint[i].finiteNumber else { return fallback }
        return min(1, max(0, v))
    }
    let tint = (channel(0, d.halationTint.0), channel(1, d.halationTint.1), channel(2, d.halationTint.2))
    var seed = d.seed
    if let s = r["seed"]?.finiteNumber { seed = jsRound(s) }
    return FilmTexture(
        grain: clampTo(r["grain"], textureRanges[.grain]!, d.grain),
        grainSize: clampTo(r["grainSize"], textureRanges[.grainSize]!, d.grainSize),
        grainChroma: clampTo(r["grainChroma"], textureRanges[.grainChroma]!, d.grainChroma),
        grainFps: clampTo(r["grainFps"], textureRanges[.grainFps]!, d.grainFps),
        halation: clampTo(r["halation"], textureRanges[.halation]!, d.halation),
        halationRadius: clampTo(r["halationRadius"], textureRanges[.halationRadius]!, d.halationRadius),
        halationThreshold: clampTo(r["halationThreshold"], textureRanges[.halationThreshold]!, d.halationThreshold),
        halationTint: tint,
        seed: seed
    )
}

/// A stored texture, or nil where a document holds none — the ONE reader every
/// document goes through (`SavedGrade.film`, `ProjectDoc.lutFilm`,
/// `RollGrade.film`).
///
/// Junk that is an OBJECT still goes through `normaliseFilmTexture`, which
/// clamps every number: a hand edit or a value from a newer build should land
/// as a sound texture where it can, the way a layer does. Anything else — and
/// a document written before the texture existed — is no texture at all.
public func filmTextureOrNull(_ raw: JSONValue?) -> FilmTexture? {
    guard let raw, raw.objectValue != nil else { return nil }
    return normaliseFilmTexture(raw)
}

/// A stable identity — what a grade's key and a held grader's key fold in.
/// Canonical order, the numbers spelled as JavaScript spells them.
public func filmTextureKey(_ t: FilmTexture?) -> String {
    guard let t else { return "-" }
    func n(_ v: Double) -> String { JSONValue.number(v).serialized() }
    let tint = [n(t.halationTint.0), n(t.halationTint.1), n(t.halationTint.2)].joined(separator: ",")
    return [n(t.grain), n(t.grainSize), n(t.grainChroma), n(t.grainFps), n(t.halation),
            n(t.halationRadius), n(t.halationThreshold), tint, n(t.seed)].joined(separator: "|")
}

/// One line for a settled row: `grain 30 % · halation 25 %`, or `No texture`.
public func describeFilmTexture(_ t: FilmTexture?) -> String {
    guard let t, !isSilentTexture(t) else { return "No texture" }
    var parts: [String] = []
    if t.grain > 0 { parts.append("grain \(Int(jsRound(t.grain * 100))) %") }
    if t.halation > 0 { parts.append("halation \(Int(jsRound(t.halation * 100))) %") }
    return parts.joined(separator: " · ")
}

// MARK: - resolution independence

/// A grain cell, in the pixels of a render this tall.
public func grainCellPixels(_ t: FilmTexture, _ renderH: Double) -> Double {
    t.grainSize * renderH
}

/// Below this many pixels a cell cannot be resolved and the grain fades out rather than aliasing.
public let minCellPx = 1.5
/// From here up the grain is drawn at full strength.
public let fadeCellPx = 3.0

private func smoothstep(_ a: Double, _ b: Double, _ x: Double) -> Double {
    let t = min(1, max(0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)
}

public struct GrainUniforms: Equatable, Sendable {
    /// (renderW / renderH, 1): the noise UV is the frame's normalised coordinate stretched by this.
    public var aspect: (Double, Double)
    /// Noise texture units per unit of frame HEIGHT: `1 / (grainSize · noiseSize)`, one texel per cell.
    public var scale: Double
    /// 0..1, how much of the grain this render can honestly show.
    public var fade: Double
    public var amount: Double
    public var chroma: Double

    public static func == (a: GrainUniforms, b: GrainUniforms) -> Bool {
        a.aspect == b.aspect && a.scale == b.scale && a.fade == b.fade && a.amount == b.amount && a.chroma == b.chroma
    }
}

/// What the node hands its shader for a render of this size. The UV it
/// implies — `screenUv · aspect · scale + phase` — puts exactly `1 / grainSize`
/// cells down the frame's height at EVERY render size, so the preview samples
/// the same field at the same positions as the export: the same grain pattern,
/// resampled, not merely the same statistics.
public func grainUniforms(_ t: FilmTexture, _ renderW: Double, _ renderH: Double) -> GrainUniforms {
    GrainUniforms(
        aspect: (renderW / renderH, 1),
        scale: 1 / (t.grainSize * Double(noiseSize)),
        fade: smoothstep(minCellPx, fadeCellPx, grainCellPixels(t, renderH)),
        amount: t.grain,
        chroma: t.grainChroma
    )
}

/// Whether a preview this tall can show the grain at all — what drives the
/// panel's badge (*finer than this preview can show — it will be there in the
/// export*), a visible state and never a tooltip.
public func grainShowable(_ t: FilmTexture, _ previewH: Double) -> (showable: Bool, cellPixels: Double) {
    let cellPixels = grainCellPixels(t, previewH)
    return (cellPixels >= minCellPx, cellPixels)
}

/// Sigma in texels of the blur buffer — fixes the buffer's height from the radius alone.
private let sigmaTexels = 4.0
private let minBuffer = 64.0
private let maxBuffer = 512.0

public struct HalationBuffer: Equatable, Sendable {
    public var w: Int
    public var h: Int
    /// The Gaussian's sigma, in texels of this buffer.
    public var sigma: Double

    public init(w: Int, h: Int, sigma: Double) { self.w = w; self.h = h; self.sigma = sigma }
}

/// The size of the small buffer the highlights are extracted and blurred in,
/// and the kernel's sigma over it. Both depend on the RADIUS and the aspect
/// only — never on the render size — so a preview and an export blur the same
/// texels with the same sigma over the same buffer: halation is resolution-
/// independent by construction, with no arithmetic left to get wrong. Nil
/// when there is no halation to draw.
public func halationBuffer(_ t: FilmTexture, _ renderW: Double, _ renderH: Double) -> HalationBuffer? {
    if t.halation <= 0 { return nil }
    let h = min(maxBuffer, max(minBuffer, jsRound(sigmaTexels / t.halationRadius)))
    let w = max(1, jsRound(h * (renderW / renderH)))
    return HalationBuffer(w: Int(w), h: Int(h), sigma: t.halationRadius * h)
}

// MARK: - as JSON, the shape a grade's `film` holds

extension FilmTexture {
    public var json: JSONValue {
        .object([
            "grain": .number(grain), "grainSize": .number(grainSize), "grainChroma": .number(grainChroma),
            "grainFps": .number(grainFps), "halation": .number(halation), "halationRadius": .number(halationRadius),
            "halationThreshold": .number(halationThreshold),
            "halationTint": .array([.number(halationTint.0), .number(halationTint.1), .number(halationTint.2)]),
            "seed": .number(seed),
        ])
    }
}
