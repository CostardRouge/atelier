// A picture's BORDER — coloured bars or margins round the crop, decided
// 2026-09-19 with the maintainer over a prototype he accepted in full: the
// crop is what is kept, the border is the canvas it is delivered on. Port of
// `src/shared/develop/border-layout.ts`, plus the layout arithmetic of its
// painter `border-paint.ts` (the blur fill's small copy and its cover); the
// painting itself is the app's.
//
//  - nil is no border: the file is exactly the crop.
//  - `margin` is a fraction of the CROP's short side on each axis (x = left and
//    right, y = top and bottom), so a border reads the same at 1080 and 6000 px.
//  - `aspect` is the FILE's shape (a preset id or a free one, `CropAspect.swift`),
//    or nil for "the crop plus its margins". With one, the box the margins
//    make is widened (or heightened) until it has that shape — never cut.
//  - `fill` is a colour (`#rrggbb`, lower case) or `blur`: the delivered crop
//    itself, blurred on a tiny copy and scaled to cover the canvas, slightly
//    darkened — made on the device, never fetched.
//
// The picture is always centred (v1). A roll carries the record as
// `RollPicture.border`, read and written here through `carried`.

import Foundation

/// The fill that is not a colour: the crop itself, blurred.
public let borderBlurFill = "blur"

public struct RollBorder: Equatable, Sendable {
    public struct Margin: Equatable, Sendable {
        public var x: Double
        public var y: Double
        public init(x: Double, y: Double) { self.x = x; self.y = y }
    }

    /// The file's shape, or nil for the crop plus its margins.
    public var aspect: String?
    /// `#rrggbb`, or `blur` (`borderBlurFill`).
    public var fill: String
    /// Fractions of the crop's short side: x left and right, y top and bottom.
    public var margin: Margin

    public init(aspect: String? = nil, fill: String, margin: Margin) {
        self.aspect = aspect; self.fill = fill; self.margin = margin
    }

    /// What turning the border ON starts from: white margins, the crop's own shape.
    public static let `default` = RollBorder(aspect: nil, fill: "#ffffff", margin: Margin(x: 0.05, y: 0.05))

    public var isBlur: Bool { fill == borderBlurFill }

    /// The record as the web writes it.
    public var json: JSONValue {
        .object([
            "aspect": aspect.map { .string($0) } ?? .null,
            "fill": .string(fill),
            "margin": .object(["x": .number(margin.x), "y": .number(margin.y)]),
        ])
    }
}

/// The margin sliders' reach: a quarter of the crop's short side.
public let borderMarginMax = 0.25

public struct BorderSwatch: Equatable, Sendable {
    public var id: String
    public var label: String
    public var fill: String
}

/// The swatches the Borders section offers before its free colour.
public let borderSwatches: [BorderSwatch] = [
    BorderSwatch(id: "black", label: "Black", fill: "#000000"),
    BorderSwatch(id: "white", label: "White", fill: "#ffffff"),
    BorderSwatch(id: "paper", label: "Paper", fill: "#f4f0e7"),
    BorderSwatch(id: "vermilion", label: "Vermilion", fill: "#d9442a"),
]

private func marginOf(_ v: JSONValue?) -> Double {
    guard let n = v?.finiteNumber else { return 0 }
    return min(borderMarginMax, max(0, n))
}

/// `#` and six hex digits, already lower-cased.
private func isHexColour(_ s: String) -> Bool {
    let chars = Array(s.unicodeScalars)
    guard chars.count == 7, chars[0] == "#" else { return false }
    return chars.dropFirst().allSatisfy { ("0"..."9").contains($0) || ("a"..."f").contains($0) }
}

/// A stored border, or nil — the reader every roll goes through trusts nothing.
public func readBorder(_ raw: JSONValue?) -> RollBorder? {
    guard let r = raw?.objectValue else { return nil }
    let m = r["margin"]?.objectValue ?? [:]
    let fill: String
    if let f = r["fill"]?.stringValue {
        let lower = f.lowercased()
        fill = f == borderBlurFill ? borderBlurFill : (isHexColour(lower) ? lower : "#000000")
    } else {
        fill = "#000000"
    }
    var aspect: String? = nil
    if let a = r["aspect"]?.stringValue, a != "original", isStoredAspect(a) { aspect = a }
    return RollBorder(aspect: aspect, fill: fill, margin: RollBorder.Margin(x: marginOf(m["x"]), y: marginOf(m["y"])))
}

public func sameBorder(_ a: RollBorder?, _ b: RollBorder?) -> Bool {
    guard let a, let b else { return a == nil && b == nil }
    return a.aspect == b.aspect && a.fill == b.fill && a.margin.x == b.margin.x && a.margin.y == b.margin.y
}

/// The delivered canvas and where the crop sits in it, in the crop's own units.
public struct BorderLayout: Equatable, Sendable {
    /// The canvas.
    public var w: Double
    public var h: Double
    /// The crop's rectangle inside it — always centred.
    public var x: Double
    public var y: Double
    public var pw: Double
    public var ph: Double

    public init(w: Double, h: Double, x: Double, y: Double, pw: Double, ph: Double) {
        self.w = w; self.h = h; self.x = x; self.y = y; self.pw = pw; self.ph = ph
    }
}

/// The canvas a crop of `zoneW × zoneH` is delivered on. Margins are fractions
/// of the crop's short side; the box is `(w + 2·mx) × (h + 2·my)`; with a file
/// aspect A, `W = max(box.w, box.h·A)` and `H = W / A` — the box grown to the
/// shape, never cut; without one, the box itself.
public func borderLayout(_ zoneW: Double, _ zoneH: Double, _ border: RollBorder?) -> BorderLayout {
    guard let border, zoneW > 0 && zoneH > 0 else {
        return BorderLayout(w: zoneW, h: zoneH, x: 0, y: 0, pw: zoneW, ph: zoneH)
    }
    let short = min(zoneW, zoneH)
    let bw = zoneW + 2 * border.margin.x * short
    let bh = zoneH + 2 * border.margin.y * short
    var w = bw
    var h = bh
    if let aspect = border.aspect, !aspect.isEmpty {
        let a = pictureAspectRatio(aspect, zoneW, zoneH)
        w = max(bw, bh * a)
        h = w / a
    }
    return BorderLayout(w: w, h: h, x: (w - zoneW) / 2, y: (h - zoneH) / 2, pw: zoneW, ph: zoneH)
}

/// A layout scaled by `k` — the export's cap, a thumbnail's size, the viewport's budget.
public func scaleLayout(_ l: BorderLayout, _ k: Double) -> BorderLayout {
    BorderLayout(w: l.w * k, h: l.h * k, x: l.x * k, y: l.y * k, pw: l.pw * k, ph: l.ph * k)
}

/// A legacy Whole framing read as a crop and a border.
public struct LegacyWholeCrop: Equatable, Sendable {
    public var aspect: String
    public var framing: Framing
    public var border: RollBorder?
}

/// A legacy Whole framing (`fit: .contain`, the D8 crop's) read as a zone and a
/// border — when it is EXACTLY one: the whole picture at scale 1, turned by a
/// half turn at most, not panned. Anything else — a quarter turn (whose shape
/// needs the picture's size), a zoom, a pan, a tilt — stays `contain` and keeps
/// rendering through the legacy path until the crop is next touched.
public func legacyWholeBorder(_ aspect: String, _ framing: Framing) -> LegacyWholeCrop? {
    if framing.fit != .contain { return nil }
    let halfTurn = framing.rotation == 0 || framing.rotation == 180
    let panned = framing.x != 0 || framing.y != 0
    if !halfTurn || framing.scale != 1 || (panned && aspect != "original") { return nil }
    var cover = framing
    cover.x = 0
    cover.y = 0
    cover.fit = .cover
    let border = aspect == "original" ? nil : RollBorder(aspect: aspect, fill: "#000000", margin: RollBorder.Margin(x: 0, y: 0))
    return LegacyWholeCrop(aspect: "original", framing: cover, border: border)
}

/// A separable box blur over RGBA pixels, `passes` times — three passes of a
/// box are a close Gaussian. Run on a thumbnail-sized copy of the crop (the
/// blur fill), so it costs nothing and gives the SAME result at every output
/// size. The web's buffers exactly: 32-bit float between passes, rounded half
/// up into bytes at the end.
public func boxBlurRGBA(_ data: inout [UInt8], _ w: Int, _ h: Int, _ radius: Int, passes: Int = 3) {
    if w <= 0 || h <= 0 || radius <= 0 { return }
    var src = data.map { Float($0) }
    var tmp = [Float](repeating: 0, count: data.count)
    func blur1(_ from: [Float], _ to: inout [Float], _ horizontal: Bool) {
        let len = horizontal ? w : h
        let lines = horizontal ? h : w
        for line in 0..<lines {
            for i in 0..<len {
                var a0 = 0.0, a1 = 0.0, a2 = 0.0, a3 = 0.0
                var n = 0.0
                for d in -radius...radius {
                    let j = min(len - 1, max(0, i + d))
                    let idx = horizontal ? (line * w + j) * 4 : (j * w + line) * 4
                    a0 += Double(from[idx])
                    a1 += Double(from[idx + 1])
                    a2 += Double(from[idx + 2])
                    a3 += Double(from[idx + 3])
                    n += 1
                }
                let out = horizontal ? (line * w + i) * 4 : (i * w + line) * 4
                to[out] = Float(a0 / n)
                to[out + 1] = Float(a1 / n)
                to[out + 2] = Float(a2 / n)
                to[out + 3] = Float(a3 / n)
            }
        }
    }
    for _ in 0..<max(0, passes) {
        blur1(src, &tmp, true)
        blur1(tmp, &src, false)
    }
    for i in 0..<data.count {
        let v = Double(src[i])
        let f = v.rounded(.down)
        let rounded = v - f >= 0.5 ? f + 1 : f
        data[i] = UInt8(min(255, max(0, rounded)))
    }
}

// MARK: - the blur fill's layout (`border-paint.ts`)

/// The blur fill is made from a copy this small, whatever the output: preview
/// and file blur the same picture.
public let borderBlurEdge = 48.0
/// The box blur's radius on that copy, in its pixels.
public let borderBlurRadius = 2
/// How dark the blurred fill is pulled (black at this alpha over it), so the crop stands off it.
public let borderBlurDarken = 0.18

/// Where the blurred copy is drawn: its own size, and the rectangle it covers
/// the canvas with (centred, cropping the overflow).
public struct BlurFillLayout: Equatable, Sendable {
    /// The small copy's size, whole pixels, at least 1.
    public var sw: Int
    public var sh: Int
    /// The copy scaled to cover the canvas, in the canvas's units.
    public var x: Double
    public var y: Double
    public var w: Double
    public var h: Double
}

/// The web's `drawBlurFill` arithmetic: the crop drawn into a copy of
/// `borderBlurEdge` on its long side, blurred there, then scaled by
/// `max(W / sw, H / sh)` and centred over the whole canvas.
public func blurFillLayout(_ layout: BorderLayout) -> BlurFillLayout {
    let ratio = layout.pw / layout.ph
    func roundUp(_ v: Double) -> Double {
        let f = v.rounded(.down)
        return v - f >= 0.5 ? f + 1 : f
    }
    let sw = max(1, Int(roundUp(ratio >= 1 ? borderBlurEdge : borderBlurEdge * ratio)))
    let sh = max(1, Int(roundUp(ratio >= 1 ? borderBlurEdge / ratio : borderBlurEdge)))
    let k = max(layout.w / Double(sw), layout.h / Double(sh))
    let dw = Double(sw) * k
    let dh = Double(sh) * k
    return BlurFillLayout(sw: sw, sh: sh, x: (layout.w - dw) / 2, y: (layout.h - dh) / 2, w: dw, h: dh)
}

// MARK: - the roll's field

extension RollPicture {
    /// The picture's border (`RollPicture.border`, roll v2), read through
    /// `readBorder` from what the roll carries; nil is none. Setting nil takes
    /// it off, which the roll then writes as the web's null.
    public var border: RollBorder? {
        get { readBorder(carried["border"]) }
        set { carried["border"] = newValue?.json }
    }
}
