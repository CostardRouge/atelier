// DETAIL — what is next to a pixel matters: denoise, defringe, sharpen. Port
// of `src/shared/render/detail.ts` (the record, the terms, and the per-pixel
// maths that is the pure twin of each GLSL pass), plus the pure half of
// `detail-pass.ts` — WHICH passes run and in what order (`detailPassPlan`),
// never their shaders: the app holds those as Core Image kernels and checks
// them against the functions here, as the web's render gate holds its GLSL.
//
// Four operations, classic and deliberately not learned:
// - Colour noise: a Gaussian blur of the CHROMA alone (a BT.709 split on the
//   encoded values), separable, luma untouched to the bit.
// - Luminance noise: a bilateral on the luma over a 7×7 window — a wall
//   smooths, a step edge stays where it is; the slider is the range sigma.
// - Defringe: purple chroma (Cb > 0 and Cr > 0) at a STEEP luma edge, pulled
//   toward neutral; a purple wall away from any edge is left alone.
// - Sharpen: an unsharp mask on the LUMA, the high-pass damped by Detail and
//   weighted by Masking, applied to RGB as ONE ratio so no hue rotates.
//
// Rules kept: kernels are in SOURCE pixels (`pixelScale` ≤ 1 scales a preview's
// kernels; the loupe judges them); noise and fringe run BEFORE the cube on the
// source, sharpen LAST after every warp; a record written before a field
// existed reads back as what it rendered with (`sharpenDetail` absent → 100,
// the plain mask), not the default a new picture starts from (25).

import Foundation

/// The numeric fields, in the order a panel draws them.
public enum DetailKey: String, CaseIterable, Sendable {
    case luminance, colour, defringe, sharpen, sharpenRadius, sharpenDetail, sharpenMasking, texture, clarity, dehaze
}

/// A slider's bounds and step — the web's `DETAIL_RANGES`.
public struct DetailRange: Sendable {
    public let min: Double
    public let max: Double
    public let step: Double

    public static func of(_ key: DetailKey) -> DetailRange {
        switch key {
        case .sharpenRadius: return DetailRange(min: 0.5, max: 3, step: 0.1)
        case .texture, .clarity, .dehaze: return DetailRange(min: -100, max: 100, step: 1)
        case .luminance, .colour, .defringe, .sharpen, .sharpenDetail, .sharpenMasking:
            return DetailRange(min: 0, max: 100, step: 1)
        }
    }
}

public struct DetailSettings: Equatable, Sendable {
    /// 0..100. Luminance noise reduction — the bilateral's range.
    public var luminance: Double = 0
    /// 0..100. Colour noise reduction — the chroma blur's radius.
    public var colour: Double = 0
    /// 0..100. Purple fringing removed at high-contrast edges.
    public var defringe: Double = 0
    /// 0..100. Unsharp mask amount.
    public var sharpen: Double = 0
    /// 0.5..3 source pixels. The unsharp mask's Gaussian sigma.
    public var sharpenRadius: Double = 1
    /// 0..100, Lightroom's DETAIL: how much of a strong edge's high-pass is let
    /// through. 100 is the plain unsharp mask; lower damps the large differences
    /// (a halo's cause) while the small ones (texture) keep most of their gain.
    public var sharpenDetail: Double = 25
    /// 0..100, Lightroom's MASKING: 0 sharpens everywhere; higher, only where
    /// the luma changes steeply.
    public var sharpenMasking: Double = 0
    /// −100..100 each: PRESENCE (`Presence.swift`) — local contrast at a small
    /// scale, at a large one weighted to the midtones, and the haze. They ride
    /// the same record and the same passes.
    public var texture: Double = 0
    public var clarity: Double = 0
    public var dehaze: Double = 0

    public init(luminance: Double = 0, colour: Double = 0, defringe: Double = 0, sharpen: Double = 0,
                sharpenRadius: Double = 1, sharpenDetail: Double = 25, sharpenMasking: Double = 0,
                texture: Double = 0, clarity: Double = 0, dehaze: Double = 0) {
        self.luminance = luminance
        self.colour = colour
        self.defringe = defringe
        self.sharpen = sharpen
        self.sharpenRadius = sharpenRadius
        self.sharpenDetail = sharpenDetail
        self.sharpenMasking = sharpenMasking
        self.texture = texture
        self.clarity = clarity
        self.dehaze = dehaze
    }

    /// The web's `DEFAULT_DETAIL`: every amount 0, radius 1, Detail 25.
    public static let `default` = DetailSettings()

    /// What a record written before Detail existed was sharpened with: the
    /// plain unsharp mask — the web's `LEGACY_SHARPEN_DETAIL`.
    public static let legacySharpenDetail = 100.0

    public subscript(_ key: DetailKey) -> Double {
        get {
            switch key {
            case .luminance: return luminance
            case .colour: return colour
            case .defringe: return defringe
            case .sharpen: return sharpen
            case .sharpenRadius: return sharpenRadius
            case .sharpenDetail: return sharpenDetail
            case .sharpenMasking: return sharpenMasking
            case .texture: return texture
            case .clarity: return clarity
            case .dehaze: return dehaze
            }
        }
        set {
            switch key {
            case .luminance: luminance = newValue
            case .colour: colour = newValue
            case .defringe: defringe = newValue
            case .sharpen: sharpen = newValue
            case .sharpenRadius: sharpenRadius = newValue
            case .sharpenDetail: sharpenDetail = newValue
            case .sharpenMasking: sharpenMasking = newValue
            case .texture: texture = newValue
            case .clarity: clarity = newValue
            case .dehaze: dehaze = newValue
            }
        }
    }

    /// The record as the web writes it: the ten numbers, nothing else.
    public var json: JSONValue {
        var o: [String: JSONValue] = [:]
        for k in DetailKey.allCases { o[k.rawValue] = .number(self[k]) }
        return .object(o)
    }
}

/// Nothing here changes the picture: every amount at 0 (the radius, Detail and
/// Masking alone are not an operation).
public func isDefaultDetail(_ d: DetailSettings?) -> Bool {
    guard let d else { return true }
    return d.luminance == 0 && d.colour == 0 && d.defringe == 0 && d.sharpen == 0
        && d.texture == 0 && d.clarity == 0 && d.dehaze == 0
}

/// Field for field; nil reads as the default.
public func sameDetail(_ a: DetailSettings?, _ b: DetailSettings?) -> Bool {
    (a ?? .default) == (b ?? .default)
}

/// A stored record read back: junk to its fallback, every number held to its
/// range. ABSENT `sharpenDetail` reads as 100 — the plain unsharp mask every
/// record written before the field was sharpened with — not the 25 a new
/// picture starts from, or every sharpened picture would change under its
/// author.
public func normaliseDetail(_ raw: JSONValue?) -> DetailSettings {
    let src = raw?.objectValue ?? [:]
    func num(_ key: DetailKey, _ fallback: Double) -> Double {
        let r = DetailRange.of(key)
        return clamp(src[key.rawValue]?.finiteNumber ?? fallback, r.min, r.max)
    }
    return DetailSettings(
        luminance: num(.luminance, 0),
        colour: num(.colour, 0),
        defringe: num(.defringe, 0),
        sharpen: num(.sharpen, 0),
        sharpenRadius: num(.sharpenRadius, DetailSettings.default.sharpenRadius),
        sharpenDetail: num(.sharpenDetail, DetailSettings.legacySharpenDetail),
        sharpenMasking: num(.sharpenMasking, 0),
        texture: num(.texture, 0),
        clarity: num(.clarity, 0),
        dehaze: num(.dehaze, 0)
    )
}

/// The record, or nil when it is absent or changes nothing.
public func detailOrNull(_ raw: JSONValue?) -> DetailSettings? {
    guard let raw, !raw.isNull else { return nil }
    let d = normaliseDetail(raw)
    return isDefaultDetail(d) ? nil : d
}

/// A number the way JavaScript prints it: `40`, `1.2`, never `40.0`.
private func jsNumber(_ n: Double) -> String {
    if n.isFinite, n == n.rounded(), abs(n) < 1e15 { return String(Int64(n)) }
    return String(n)
}

/// `+40`, `−30` — a typographic minus, as the web's `signed`.
private func signedText(_ n: Double) -> String {
    n > 0 ? "+\(jsNumber(n))" : "−\(jsNumber(abs(n)))"
}

/// `denoise 40 · colour noise 60 · defringe 30 · sharpen 50 @ 1.2 px`, or an empty string.
public func describeDetail(_ d: DetailSettings?) -> String {
    guard let d, !isDefaultDetail(d) else { return "" }
    var parts: [String] = []
    if d.dehaze != 0 { parts.append("dehaze \(signedText(d.dehaze))") }
    if d.clarity != 0 { parts.append("clarity \(signedText(d.clarity))") }
    if d.texture != 0 { parts.append("texture \(signedText(d.texture))") }
    if d.luminance != 0 { parts.append("denoise \(jsNumber(d.luminance))") }
    if d.colour != 0 { parts.append("colour noise \(jsNumber(d.colour))") }
    if d.defringe != 0 { parts.append("defringe \(jsNumber(d.defringe))") }
    if d.sharpen != 0 {
        var extra: [String] = []
        if d.sharpenDetail != DetailSettings.default.sharpenDetail { extra.append("detail \(jsNumber(d.sharpenDetail))") }
        if d.sharpenMasking != 0 { extra.append("masking \(jsNumber(d.sharpenMasking))") }
        let tail = extra.isEmpty ? "" : ", \(extra.joined(separator: ", "))"
        parts.append("sharpen \(jsNumber(d.sharpen)) @ \(jsNumber(d.sharpenRadius)) px\(tail)")
    }
    return parts.joined(separator: " · ")
}

// MARK: - the numbers the passes take

/// Detail 0 damps a high-pass `h` to `h / (1 + 20|h|)`: a 0.1 edge keeps a
/// third of its gain, a 0.02 grain three quarters. Squared on the slider so the
/// top half (the plain mask's neighbourhood) moves gently. The web's `SHARPEN_DAMP`.
public let sharpenDamp = 20.0
/// Masking 100 sharpens fully only where the edge steepness (`edgeSobel`) reaches 0.1.
public let sharpenMaskReach = 0.1

/// The largest half-window any pass walks; a GPU loop needs a constant bound.
public let chromaMaxRadius = 12
public let bilateralRadius = 3
public let sharpenMaxRadius = 6

/// The edge steepness at which defringing begins and is fully on, in encoded luma.
public let defringeEdge = (from: 0.06, to: 0.25)
/// How purple a chroma must be (the smaller of Cb, Cr) to count.
public let defringePurple = (from: 0.0, to: 0.04)

/// How the sliders turn into sigmas and strengths — ONE place, read by the
/// kernels and the pure maths alike.
public struct DetailTerms: Equatable, Sendable {
    /// The chroma blur's sigma in the picture's own pixels; 0 = no pass.
    public var chromaSigma: Double
    /// Its half-window, ≤ `chromaMaxRadius`.
    public var chromaRadius: Int
    /// The bilateral's range sigma in encoded luma units; 0 = no pass.
    public var rangeSigma: Double
    /// Its spatial sigma in pixels.
    public var spatialSigma: Double
    /// 0..1, how far purple chroma at an edge is pulled to neutral; 0 = no pass.
    public var defringe: Double
    /// The unsharp gain on the high-pass; 0 = no pass.
    public var sharpenGain: Double
    /// The unsharp Gaussian's sigma in pixels, and its half-window ≤ `sharpenMaxRadius`.
    public var sharpenSigma: Double
    public var sharpenRadius: Int
    /// How hard a large high-pass is damped: 0 = the plain unsharp mask.
    public var sharpenDamp: Double
    /// The edge steepness at which sharpening is fully on; 0 = everywhere (no mask).
    public var sharpenMask: Double

    public init(chromaSigma: Double, chromaRadius: Int, rangeSigma: Double, spatialSigma: Double, defringe: Double,
                sharpenGain: Double, sharpenSigma: Double, sharpenRadius: Int, sharpenDamp: Double, sharpenMask: Double) {
        self.chromaSigma = chromaSigma
        self.chromaRadius = chromaRadius
        self.rangeSigma = rangeSigma
        self.spatialSigma = spatialSigma
        self.defringe = defringe
        self.sharpenGain = sharpenGain
        self.sharpenSigma = sharpenSigma
        self.sharpenRadius = sharpenRadius
        self.sharpenDamp = sharpenDamp
        self.sharpenMask = sharpenMask
    }
}

/// The sliders as bounded kernels, scaled to a preview's pixels per source
/// pixel (`pixelScale` ≤ 1; anything else reads as 1).
public func detailTerms(_ d: DetailSettings?, pixelScale: Double = 1) -> DetailTerms {
    let s = d ?? .default
    let scale = pixelScale.isFinite && pixelScale > 0 ? min(1, pixelScale) : 1
    // Colour: 0.5 px at a touch, 6 px at full — a coloured speckle is wider
    // than a luma grain, and a large chroma blur costs no edge the eye reads.
    let chromaSigma = s.colour > 0 ? max(0.5, (0.5 + (s.colour / 100) * 5.5) * scale) : 0
    let chromaRadius = chromaSigma != 0 ? min(chromaMaxRadius, max(1, Int((chromaSigma * 3).rounded(.up)))) : 0
    // Luminance: the range sigma spans the noise of a clean ISO 800 (~0.02 of
    // the encoded range) to a very rough high ISO (~0.12).
    let rangeSigma = s.luminance > 0 ? 0.02 + (s.luminance / 100) * 0.1 : 0
    let spatialSigma = max(0.5, 1.5 * scale)
    let defringe = s.defringe / 100
    let sharpenGain = (s.sharpen / 100) * 1.5
    let sharpenSigma = max(0.3, s.sharpenRadius * scale)
    let sharpenRadius = min(sharpenMaxRadius, max(1, Int((sharpenSigma * 2).rounded(.up))))
    let detailShare = 1 - s.sharpenDetail / 100
    let damp = sharpenDamp * detailShare * detailShare
    let mask = sharpenMaskReach * (s.sharpenMasking / 100)
    return DetailTerms(
        chromaSigma: chromaSigma, chromaRadius: chromaRadius,
        rangeSigma: rangeSigma, spatialSigma: spatialSigma,
        defringe: defringe,
        sharpenGain: sharpenGain, sharpenSigma: sharpenSigma, sharpenRadius: sharpenRadius,
        sharpenDamp: damp, sharpenMask: mask
    )
}

// MARK: - the pass plan (the pure half of `detail-pass.ts`)

/// The passes the detail record asks for, by the ids the web's graph keys
/// its programs on.
public enum DetailPassId: String, Sendable {
    case chromaX = "chroma-x"
    case chromaY = "chroma-y"
    case denoise
    case defringe
    case presenceBlur = "presence-blur"
    case presenceApply = "presence-apply"
    case sharpen
}

/// Both lists for a picture's settings; both empty when nothing is set.
public struct DetailPassPlan: Equatable, Sendable {
    /// Before the cube, on the source: colour noise (two passes), luminance noise, defringe.
    public var pre: [DetailPassId]
    /// After every warp and layer: dehaze, clarity, texture (a blur and an apply each), then sharpen.
    public var post: [DetailPassId]

    public init(pre: [DetailPassId], post: [DetailPassId]) {
        self.pre = pre
        self.post = post
    }
}

/// Which passes run, in which list, in which order — the web's `detailPasses`
/// without its shaders. `showSharpenMask` is the stage's view of the Masking
/// weight, drawn whatever the rest of the record says.
public func detailPassPlan(_ detail: DetailSettings?, pixelScale: Double = 1, showSharpenMask: Bool = false) -> DetailPassPlan {
    if isDefaultDetail(detail) && !showSharpenMask { return DetailPassPlan(pre: [], post: []) }
    let terms = detailTerms(detail, pixelScale: pixelScale)
    var pre: [DetailPassId] = []
    if terms.chromaSigma > 0 { pre.append(.chromaX); pre.append(.chromaY) }
    if terms.rangeSigma > 0 { pre.append(.denoise) }
    if terms.defringe > 0 { pre.append(.defringe) }
    let s = detail ?? .default
    var post: [DetailPassId] = []
    for op in PresenceOp.allCases {
        let amount: Double
        switch op {
        case .dehaze: amount = s.dehaze / 100
        case .clarity: amount = s.clarity / 100
        case .texture: amount = s.texture / 100
        }
        if amount != 0 { post.append(.presenceBlur); post.append(.presenceApply) }
    }
    if showSharpenMask || terms.sharpenGain > 0 { post.append(.sharpen) }
    return DetailPassPlan(pre: pre, post: post)
}

// MARK: - the maths, per pixel, on an IMAGE

/// A picture the pure maths reads: RGB floats, top row first, clamped at its
/// edges like CLAMP_TO_EDGE. `data` is `width × height × 3`.
public struct DetailImage: Sendable {
    public var width: Int
    public var height: Int
    public var data: [Float]

    public init(width: Int, height: Int, data: [Float]) {
        self.width = width
        self.height = height
        self.data = data
    }

    /// A picture painted by a function of (x, y), top row first.
    public init(width: Int, height: Int, fill: (Int, Int) -> (Double, Double, Double)) {
        var data = [Float](repeating: 0, count: width * height * 3)
        data.withUnsafeMutableBufferPointer { buf in
            for y in 0..<height {
                for x in 0..<width {
                    let (r, g, b) = fill(x, y)
                    let i = (y * width + x) * 3
                    buf[i] = Float(r)
                    buf[i + 1] = Float(g)
                    buf[i + 2] = Float(b)
                }
            }
        }
        self.init(width: width, height: height, data: data)
    }
}

/// The pixel at (x, y), the edges held — CLAMP_TO_EDGE.
@inline(__always)
public func pixelAt(_ img: DetailImage, _ x: Int, _ y: Int) -> (Double, Double, Double) {
    let cx = x < 0 ? 0 : (x >= img.width ? img.width - 1 : x)
    let cy = y < 0 ? 0 : (y >= img.height ? img.height - 1 : y)
    let i = (cy * img.width + cx) * 3
    return (Double(img.data[i]), Double(img.data[i + 1]), Double(img.data[i + 2]))
}

// `lumaOf` (BT.709 luma of encoded RGB) is Mask.swift's — the web keeps an
// identical copy in detail.ts and mask.ts; the kernel keeps one.

/// Encoded RGB → (Y, Cb, Cr), BT.709; Cb and Cr are centred on 0.
public func toYcc(_ r: Double, _ g: Double, _ b: Double) -> (Double, Double, Double) {
    let y = lumaOf(r, g, b)
    return (y, (b - y) / 1.8556, (r - y) / 1.5748)
}

public func fromYcc(_ y: Double, _ cb: Double, _ cr: Double) -> (Double, Double, Double) {
    let r = y + 1.5748 * cr
    let b = y + 1.8556 * cb
    let g = (y - 0.2126 * r - 0.0722 * b) / 0.7152
    return (r, g, b)
}

@inline(__always)
private func gaussian(_ x: Double, _ sigma: Double) -> Double {
    exp(-(x * x) / (2 * sigma * sigma))
}

/// The axis ONE step of a separable blur walks.
public enum BlurAxis: Sendable {
    case x, y
}

/// ONE step of the chroma blur along an axis — the H pass reads the source,
/// the V pass reads the H pass's output. Luma is copied through untouched.
public func chromaBlurAt(_ img: DetailImage, _ x: Int, _ y: Int, _ terms: DetailTerms, _ axis: BlurAxis) -> (Double, Double, Double) {
    let (r, g, b) = pixelAt(img, x, y)
    let (Y, _, _) = toYcc(r, g, b)
    var cb = 0.0
    var cr = 0.0
    var sum = 0.0
    let radius = terms.chromaRadius
    if radius >= 0 {
        for k in -radius...radius {
            let w = gaussian(Double(k), terms.chromaSigma)
            let (nr, ng, nb) = axis == .x ? pixelAt(img, x + k, y) : pixelAt(img, x, y + k)
            let (_, ncb, ncr) = toYcc(nr, ng, nb)
            cb += ncb * w
            cr += ncr * w
            sum += w
        }
    }
    return fromYcc(Y, cb / sum, cr / sum)
}

/// The bilateral on luma over the 7×7 window; RGB follows the luma as one ratio.
public func bilateralAt(_ img: DetailImage, _ x: Int, _ y: Int, _ terms: DetailTerms) -> (Double, Double, Double) {
    let (r, g, b) = pixelAt(img, x, y)
    let Y = lumaOf(r, g, b)
    var acc = 0.0
    var sum = 0.0
    let R = bilateralRadius
    for dy in -R...R {
        for dx in -R...R {
            let (nr, ng, nb) = pixelAt(img, x + dx, y + dy)
            let nY = lumaOf(nr, ng, nb)
            let w = gaussian(hypot(Double(dx), Double(dy)), terms.spatialSigma) * gaussian(nY - Y, terms.rangeSigma)
            acc += nY * w
            sum += w
        }
    }
    let out = acc / sum
    return scaleToLuma(r, g, b, Y, out)
}

/// RGB brought to a new luma by one ratio — hue and saturation kept; black stays black.
@inline(__always)
public func scaleToLuma(_ r: Double, _ g: Double, _ b: Double, _ Y: Double, _ target: Double) -> (Double, Double, Double) {
    if Y <= 1e-6 { return (target, target, target) }
    let k = target / Y
    return (max(0, r * k), max(0, g * k), max(0, b * k))
}

/// How steep the luma is here: the largest luma difference to a 3×3 neighbour.
public func edgeAt(_ img: DetailImage, _ x: Int, _ y: Int) -> Double {
    let (r, g, b) = pixelAt(img, x, y)
    let Y = lumaOf(r, g, b)
    var edge = 0.0
    for dy in -1...1 {
        for dx in -1...1 {
            if dx == 0 && dy == 0 { continue }
            let (nr, ng, nb) = pixelAt(img, x + dx, y + dy)
            edge = max(edge, abs(lumaOf(nr, ng, nb) - Y))
        }
    }
    return edge
}

/// GLSL's `smoothstep(a, b, x)`.
@inline(__always)
private func smoothstep(_ a: Double, _ b: Double, _ x: Double) -> Double {
    let t = clamp((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)
}

/// Purple chroma at a steep luma edge, pulled toward neutral by `terms.defringe`.
public func defringeAt(_ img: DetailImage, _ x: Int, _ y: Int, _ terms: DetailTerms) -> (Double, Double, Double) {
    let (r, g, b) = pixelAt(img, x, y)
    let (Y, cb, cr) = toYcc(r, g, b)
    let purple = smoothstep(defringePurple.from, defringePurple.to, min(cb, cr))
    let edge = smoothstep(defringeEdge.from, defringeEdge.to, edgeAt(img, x, y))
    let keep = 1 - terms.defringe * purple * edge
    return fromYcc(Y, cb * keep, cr * keep)
}

/// How steep the luma is here, as a Sobel magnitude over 3×3 divided by 8 — a
/// step of height `h` reads `h / 2` on its edge. What Masking thresholds.
public func edgeSobel(_ img: DetailImage, _ x: Int, _ y: Int) -> Double {
    func l(_ dx: Int, _ dy: Int) -> Double {
        let (r, g, b) = pixelAt(img, x + dx, y + dy)
        return lumaOf(r, g, b)
    }
    let right = l(1, -1) + 2 * l(1, 0) + l(1, 1)
    let left = l(-1, -1) + 2 * l(-1, 0) + l(-1, 1)
    let below = l(-1, 1) + 2 * l(0, 1) + l(1, 1)
    let above = l(-1, -1) + 2 * l(0, -1) + l(1, -1)
    let gx = (right - left) / 8
    let gy = (below - above) / 8
    return hypot(gx, gy)
}

/// The Masking weight of a pixel: 1 everywhere with no mask, else rising to 1
/// at the edge steepness asked for.
public func sharpenMaskAt(_ img: DetailImage, _ x: Int, _ y: Int, _ terms: DetailTerms) -> Double {
    if terms.sharpenMask <= 0 { return 1 }
    return smoothstep(0.25 * terms.sharpenMask, terms.sharpenMask, edgeSobel(img, x, y))
}

/// The unsharp mask on luma: a 2D Gaussian blur of the luma, the high-pass
/// damped by Detail and weighted by Masking, gained, RGB following as one ratio.
public func sharpenAt(_ img: DetailImage, _ x: Int, _ y: Int, _ terms: DetailTerms) -> (Double, Double, Double) {
    let (r, g, b) = pixelAt(img, x, y)
    let Y = lumaOf(r, g, b)
    var acc = 0.0
    var sum = 0.0
    let R = terms.sharpenRadius
    if R >= 0 {
        for dy in -R...R {
            for dx in -R...R {
                let (nr, ng, nb) = pixelAt(img, x + dx, y + dy)
                let w = gaussian(hypot(Double(dx), Double(dy)), terms.sharpenSigma)
                acc += lumaOf(nr, ng, nb) * w
                sum += w
            }
        }
    }
    let blurred = acc / sum
    let h = Y - blurred
    let damped = h / (1 + terms.sharpenDamp * abs(h))
    let out = max(0, Y + terms.sharpenGain * damped * sharpenMaskAt(img, x, y, terms))
    return scaleToLuma(r, g, b, Y, out)
}

/// The whole picture through one operation — for a spec, or for a small gate picture.
public func applyDetail(_ img: DetailImage, _ op: (DetailImage, Int, Int) -> (Double, Double, Double)) -> DetailImage {
    var out = [Float](repeating: 0, count: img.data.count)
    out.withUnsafeMutableBufferPointer { buf in
        for y in 0..<img.height {
            for x in 0..<img.width {
                let (r, g, b) = op(img, x, y)
                let i = (y * img.width + x) * 3
                buf[i] = Float(r)
                buf[i + 1] = Float(g)
                buf[i + 2] = Float(b)
            }
        }
    }
    return DetailImage(width: img.width, height: img.height, data: out)
}
