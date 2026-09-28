// LENSFUN — measured lens profiles. Port of `src/shared/lens/lensfun.ts`
// (audit item 20, his YES of 2026-09-23: *fetched on demand per lens, kept
// locally, never the whole database shipped*). This is the pure half: it READS
// a Lensfun database file, FINDS the camera and the lens a picture's EXIF
// names, INTERPOLATES the calibration at the picture's focal length and
// aperture exactly as `libs/lensfun/lens.cpp` does, and CONVERTS it to the
// units `Render/Lens.swift` works in. The fetching and the cache are the app's.
//
// Why this clears the bar P6 set (no invented coefficients): a Lensfun profile
// is MEASURED — someone photographed a target with that lens on a body of
// known crop factor — so applying it is applying data, not guessing.
//
// **Three coordinate systems, and the conversion is the whole trap.**
// Lensfun's distortion and TCA models (`ptlens`, `poly3`, `poly5`, `linear`)
// are the Hugin ones: r = 1 at HALF THE SHORT SIDE of the CALIBRATION sensor.
// Its vignetting model (`pa`) has r = 1 at the calibration sensor's CORNER.
// This suite's lens pass has r = 1 at the corner of the picture being
// corrected (half the diagonal). One of our units is
//
//     s = hypot(calAspect, 1) · calCrop / imageCrop   Hugin units
//     q = calCrop / imageCrop                          `pa` units
//
// The real focal length cancels out of that conversion, so it is read and not
// needed.
//
// Refused rather than approximated: a fisheye or any non-rectilinear lens, the
// `acm` models, and a calibration made on a SMALLER sensor than the picture's
// (Lensfun's own rule: `imageCrop / calCrop ≥ 0.96`).
//
// The XML is read by a small hand-written scanner over the database's own
// simple, attribute-only shape — the byte-for-byte twin of the web's regular
// expressions (comments stripped FIRST, `lang`-less values first, the first
// `<focal …>` only), so it runs on Linux with no XML dependency.

import Foundation

public struct LensfunCamera: Equatable, Sendable {
    public var maker: String
    /// Every name the model goes by — the EXIF one and its `lang` variants.
    public var models: [String]
    public var mount: String
    public var crop: Double

    public init(maker: String, models: [String], mount: String, crop: Double) {
        self.maker = maker; self.models = models; self.mount = mount; self.crop = crop
    }
}

public enum DistortionModel: String, Sendable, CaseIterable {
    case ptlens, poly3, poly5
}

public enum TcaModel: String, Sendable, CaseIterable {
    case linear, poly3
}

public struct DistortionEntry: Equatable, Sendable {
    public var model: DistortionModel
    public var focal: Double
    /// ptlens [a, b, c], poly3 [k1], poly5 [k1, k2].
    public var terms: [Double]

    public init(model: DistortionModel, focal: Double, terms: [Double]) {
        self.model = model; self.focal = focal; self.terms = terms
    }
}

public struct TcaEntry: Equatable, Sendable {
    public var model: TcaModel
    public var focal: Double
    /// Lensfun's own order: linear [kr, kb]; poly3 [vr, vb, cr, cb, br, bb].
    public var terms: [Double]

    public init(model: TcaModel, focal: Double, terms: [Double]) {
        self.model = model; self.focal = focal; self.terms = terms
    }
}

public struct VignettingEntry: Equatable, Sendable {
    public var focal: Double
    public var aperture: Double
    public var distance: Double
    /// `pa`: [k1, k2, k3].
    public var terms: [Double]

    public init(focal: Double, aperture: Double, distance: Double, terms: [Double]) {
        self.focal = focal; self.aperture = aperture; self.distance = distance; self.terms = terms
    }
}

public struct LensfunLens: Equatable, Sendable {
    public var maker: String
    public var models: [String]
    public var mounts: [String]
    /// The crop factor of the sensor the calibration was MADE on.
    public var crop: Double
    /// Its aspect ratio, long over short — 3:2 unless said.
    public var aspect: Double
    /// `rectilinear` unless the database says otherwise.
    public var type: String
    public var focalMin: Double?
    public var focalMax: Double?
    public var distortion: [DistortionEntry]
    public var tca: [TcaEntry]
    public var vignetting: [VignettingEntry]

    public init(maker: String, models: [String], mounts: [String], crop: Double, aspect: Double, type: String,
                focalMin: Double?, focalMax: Double?, distortion: [DistortionEntry] = [], tca: [TcaEntry] = [],
                vignetting: [VignettingEntry] = []) {
        self.maker = maker; self.models = models; self.mounts = mounts; self.crop = crop; self.aspect = aspect
        self.type = type; self.focalMin = focalMin; self.focalMax = focalMax
        self.distortion = distortion; self.tca = tca; self.vignetting = vignetting
    }
}

public struct LensfunDb: Equatable, Sendable {
    public var cameras: [LensfunCamera]
    public var lenses: [LensfunLens]

    public init(cameras: [LensfunCamera] = [], lenses: [LensfunLens] = []) {
        self.cameras = cameras; self.lenses = lenses
    }
}

/// What the database had for a lens: a part it lacked is the identity in the
/// terms. The web's `{ distortion, tca, vignette }`, shared by `profileTerms`
/// and `LensProfileApplied.has`.
public struct LensProfileHas: Equatable, Sendable {
    public var distortion: Bool
    public var tca: Bool
    public var vignette: Bool

    public init(distortion: Bool, tca: Bool, vignette: Bool) {
        self.distortion = distortion; self.tca = tca; self.vignette = vignette
    }
}

// MARK: - the scanner (the web's regular expressions, byte for byte)

private typealias Bytes = [UInt8]

private func isSpace(_ b: UInt8) -> Bool {
    b == 0x20 || b == 0x09 || b == 0x0A || b == 0x0D || b == 0x0B || b == 0x0C
}

/// `[\w-]` — letters, digits, the underscore and the hyphen.
private func isWordOrHyphen(_ b: UInt8) -> Bool {
    (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5A) || (b >= 0x61 && b <= 0x7A) || b == 0x5F || b == 0x2D
}

/// The first index of `needle` in `hay[from...]`, or nil.
private func find(_ hay: Bytes, _ needle: Bytes, from: Int) -> Int? {
    let n = needle.count
    if n == 0 { return from }
    var i = max(0, from)
    let last = hay.count - n
    while i <= last {
        if hay[i] == needle[0] {
            var j = 1
            while j < n && hay[i + j] == needle[j] { j += 1 }
            if j == n { return i }
        }
        i += 1
    }
    return nil
}

private func has(_ hay: Bytes, _ needle: Bytes, at: Int) -> Bool {
    if at < 0 || at + needle.count > hay.count { return false }
    for k in 0..<needle.count where hay[at + k] != needle[k] { return false }
    return true
}

private func bytes(_ s: String) -> Bytes { Array(s.utf8) }

private func string(_ b: ArraySlice<UInt8>) -> String { String(decoding: b, as: UTF8.self) }

/// `/<!--[\s\S]*?-->/g` removed.
private func stripComments(_ src: Bytes) -> Bytes {
    let open = bytes("<!--")
    let close = bytes("-->")
    var out = Bytes()
    out.reserveCapacity(src.count)
    var i = 0
    while i < src.count {
        guard let start = find(src, open, from: i), let end = find(src, close, from: start + 4) else {
            out.append(contentsOf: src[i...])
            break
        }
        out.append(contentsOf: src[i..<start])
        i = end + 3
    }
    return out
}

/// Every `<tag>…</tag>` block's inside, `/<tag>([\s\S]*?)<\/tag>/g`.
private func blocks(_ src: Bytes, _ tag: String) -> [ArraySlice<UInt8>] {
    let open = bytes("<\(tag)>")
    let close = bytes("</\(tag)>")
    var out: [ArraySlice<UInt8>] = []
    var i = 0
    while let start = find(src, open, from: i) {
        let inside = start + open.count
        guard let end = find(src, close, from: inside) else { break }
        out.append(src[inside..<end])
        i = end + close.count
    }
    return out
}

private let entities: [(name: Bytes, value: UInt8)] = [
    (bytes("amp;"), UInt8(ascii: "&")),
    (bytes("lt;"), UInt8(ascii: "<")),
    (bytes("gt;"), UInt8(ascii: ">")),
    (bytes("quot;"), UInt8(ascii: "\"")),
    (bytes("apos;"), UInt8(ascii: "'")),
]

/// The five XML entities decoded in one left-to-right pass, then trimmed.
private func text(_ s: ArraySlice<UInt8>) -> String {
    let src = Bytes(s)
    var out = Bytes()
    out.reserveCapacity(src.count)
    var i = 0
    outer: while i < src.count {
        if src[i] == UInt8(ascii: "&") {
            for e in entities where has(src, e.name, at: i + 1) {
                out.append(e.value)
                i += 1 + e.name.count
                continue outer
            }
        }
        out.append(src[i])
        i += 1
    }
    return String(decoding: out, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
}

/// Every value of `<tag …>value</tag>` in a block, the untagged (`lang`-less)
/// one first — `/<tag(\s+lang="[^"]*")?\s*>([^<]*)<\/tag>/g`.
private func values(_ block: ArraySlice<UInt8>, _ tag: String) -> [String] {
    let src = Bytes(block)
    let open = bytes("<\(tag)")
    let close = bytes("</\(tag)>")
    let lang = bytes("lang=\"")
    var plain: [String] = []
    var langed: [String] = []
    var i = 0
    while let start = find(src, open, from: i) {
        var p = start + open.count
        // The optional `\s+lang="…"`.
        var tagged = false
        var q = p
        while q < src.count && isSpace(src[q]) { q += 1 }
        if q > p, has(src, lang, at: q) {
            var r = q + lang.count
            while r < src.count && src[r] != UInt8(ascii: "\"") { r += 1 }
            if r < src.count {
                tagged = true
                p = r + 1
            }
        }
        while p < src.count && isSpace(src[p]) { p += 1 }
        guard p < src.count, src[p] == UInt8(ascii: ">") else { i = start + 1; continue }
        let from = p + 1
        var to = from
        while to < src.count && src[to] != UInt8(ascii: "<") { to += 1 }
        guard has(src, close, at: to) else { i = start + 1; continue }
        let value = text(src[from..<to])
        if tagged { langed.append(value) } else { plain.append(value) }
        i = to + close.count
    }
    return plain + langed
}

/// `name="value"` pairs, `/([\w-]+)="([^"]*)"/g`.
private func attrs(_ s: ArraySlice<UInt8>) -> [String: String] {
    let src = Bytes(s)
    var out: [String: String] = [:]
    var i = 0
    while i < src.count {
        guard isWordOrHyphen(src[i]) else { i += 1; continue }
        var j = i
        while j < src.count && isWordOrHyphen(src[j]) { j += 1 }
        if j + 1 < src.count, src[j] == UInt8(ascii: "="), src[j + 1] == UInt8(ascii: "\"") {
            var k = j + 2
            while k < src.count && src[k] != UInt8(ascii: "\"") { k += 1 }
            if k < src.count {
                out[string(src[i..<j])] = string(src[(j + 2)..<k])
                i = k + 1
                continue
            }
        }
        i = j
    }
    return out
}

/// The inside of each `<name …>` / `<name …/>` element for the names given,
/// in document order — `/<(a|b)\s+([^>]*?)\/?>/g`, the name matched with it.
private func elements(_ block: ArraySlice<UInt8>, _ names: [String]) -> [(name: String, inside: ArraySlice<UInt8>)] {
    let src = Bytes(block)
    let opens = names.map { (name: $0, open: bytes("<\($0)")) }
    var out: [(name: String, inside: ArraySlice<UInt8>)] = []
    var i = 0
    while i < src.count {
        guard src[i] == UInt8(ascii: "<") else { i += 1; continue }
        var matched = false
        for o in opens where has(src, o.open, at: i) {
            var p = i + o.open.count
            guard p < src.count, isSpace(src[p]) else { continue }
            while p < src.count && isSpace(src[p]) { p += 1 }
            var gt = p
            while gt < src.count && src[gt] != UInt8(ascii: ">") { gt += 1 }
            guard gt < src.count else { continue }
            let end = gt > p && src[gt - 1] == UInt8(ascii: "/") ? gt - 1 : gt
            out.append((o.name, src[p..<end]))
            i = gt + 1
            matched = true
            break
        }
        if !matched { i += 1 }
    }
    return out
}

/// JavaScript's `Number(string)`: whitespace trimmed, the empty string 0,
/// `Infinity`, `0x`/`0o`/`0b`, a decimal literal — anything else NaN.
private func jsNumber(_ s: String) -> Double {
    let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
    if t.isEmpty { return 0 }
    switch t {
    case "Infinity", "+Infinity": return .infinity
    case "-Infinity": return -.infinity
    default: break
    }
    let lower = t.lowercased()
    for (prefix, radix) in [("0x", 16), ("0o", 8), ("0b", 2)] where lower.hasPrefix(prefix) {
        let digits = String(t.dropFirst(2))
        if digits.isEmpty { return .nan }
        var value = 0.0
        for c in digits {
            guard let d = c.hexDigitValue, d < radix else { return .nan }
            value = value * Double(radix) + Double(d)
        }
        return value
    }
    let b = Array(t.utf8)
    var i = 0
    if i < b.count, b[i] == UInt8(ascii: "+") || b[i] == UInt8(ascii: "-") { i += 1 }
    var digits = 0
    while i < b.count, b[i] >= 0x30, b[i] <= 0x39 { i += 1; digits += 1 }
    if i < b.count, b[i] == UInt8(ascii: ".") {
        i += 1
        while i < b.count, b[i] >= 0x30, b[i] <= 0x39 { i += 1; digits += 1 }
    }
    if digits == 0 { return .nan }
    if i < b.count, b[i] == UInt8(ascii: "e") || b[i] == UInt8(ascii: "E") {
        i += 1
        if i < b.count, b[i] == UInt8(ascii: "+") || b[i] == UInt8(ascii: "-") { i += 1 }
        var exponent = 0
        while i < b.count, b[i] >= 0x30, b[i] <= 0x39 { i += 1; exponent += 1 }
        if exponent == 0 { return .nan }
    }
    if i != b.count { return .nan }
    // A literal `strtod` reads the same way JavaScript does once the grammar is
    // checked; `1.` and `.5` are spelled out for it.
    var literal = t
    if literal.hasSuffix(".") { literal += "0" }
    return Double(literal) ?? Double("0" + literal) ?? .nan
}

private func num(_ v: String?, _ fallback: Double = .nan) -> Double {
    guard let v else { return fallback }
    let n = jsNumber(v)
    return n.isFinite ? n : fallback
}

/// `3:2` → 1.5, `1.778` → 1.778; always long over short.
private func aspectOf(_ v: String?) -> Double {
    guard let v, !v.isEmpty else { return 1.5 }
    var a: Double
    let t = v.trimmingCharacters(in: .whitespaces)
    let halves = t.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
    let isRatioDigit: (Character) -> Bool = { $0 == "." || ($0.isASCII && $0.isNumber) }
    if halves.count == 2 {
        let left = halves[0].trimmingCharacters(in: .whitespaces)
        let right = halves[1].trimmingCharacters(in: .whitespaces)
        if !left.isEmpty, !right.isEmpty, left.allSatisfy(isRatioDigit), right.allSatisfy(isRatioDigit) {
            a = jsNumber(left) / jsNumber(right)
        } else {
            a = jsNumber(v)
        }
    } else {
        a = jsNumber(v)
    }
    return a.isFinite && a > 0 ? max(a, 1 / a) : 1.5
}

// MARK: - reading

/// One database file read. Comments go first: the files hold commented-out
/// entries (an older calibration kept for reference), which a reader that
/// skipped this step would apply.
public func parseLensfunXml(_ xml: String) -> LensfunDb {
    let src = stripComments(Array(xml.utf8))
    var cameras: [LensfunCamera] = []
    var lenses: [LensfunLens] = []
    for b in blocks(src, "camera") {
        let maker = values(b, "maker").first
        let models = values(b, "model")
        let mount = values(b, "mount").first
        let crop = num(values(b, "cropfactor").first)
        if let maker, !maker.isEmpty, !models.isEmpty, let mount, !mount.isEmpty, crop > 0 {
            cameras.append(LensfunCamera(maker: maker, models: models, mount: mount, crop: crop))
        }
    }
    for b in blocks(src, "lens") {
        let maker = values(b, "maker").first ?? ""
        let models = values(b, "model")
        if models.isEmpty { continue }
        let f = elements(b, ["focal"]).first.map { attrs($0.inside) } ?? [:]
        let focalMin = num(f["min"] ?? f["value"])
        let focalMax = num(f["max"] ?? f["value"])
        var lens = LensfunLens(
            maker: maker,
            models: models,
            mounts: values(b, "mount"),
            crop: num(values(b, "cropfactor").first, 1),
            aspect: aspectOf(values(b, "aspect-ratio").first),
            type: values(b, "type").first ?? "rectilinear",
            focalMin: focalMin.isFinite ? focalMin : nil,
            focalMax: focalMax.isFinite ? focalMax : nil
        )
        for e in elements(b, ["distortion", "tca", "vignetting"]) {
            let a = attrs(e.inside)
            let at = num(a["focal"])
            if !(at > 0) { continue }
            switch e.name {
            case "distortion":
                if a["model"] == "ptlens" {
                    lens.distortion.append(DistortionEntry(model: .ptlens, focal: at,
                                                           terms: [num(a["a"], 0), num(a["b"], 0), num(a["c"], 0)]))
                } else if a["model"] == "poly3" {
                    lens.distortion.append(DistortionEntry(model: .poly3, focal: at, terms: [num(a["k1"], 0)]))
                } else if a["model"] == "poly5" {
                    lens.distortion.append(DistortionEntry(model: .poly5, focal: at,
                                                           terms: [num(a["k1"], 0), num(a["k2"], 0)]))
                }
            case "tca":
                if a["model"] == "linear" {
                    lens.tca.append(TcaEntry(model: .linear, focal: at, terms: [num(a["kr"], 1), num(a["kb"], 1)]))
                } else if a["model"] == "poly3" {
                    let scale = [num(a["vr"], 1), num(a["vb"], 1)]
                    let rest = [num(a["cr"], 0), num(a["cb"], 0), num(a["br"], 0), num(a["bb"], 0)]
                    lens.tca.append(TcaEntry(model: .poly3, focal: at, terms: scale + rest))
                }
            default:
                if a["model"] == "pa" {
                    lens.vignetting.append(VignettingEntry(
                        focal: at,
                        aperture: num(a["aperture"], .nan),
                        distance: num(a["distance"], 1000),
                        terms: [num(a["k1"], 0), num(a["k2"], 0), num(a["k3"], 0)]
                    ))
                }
            }
        }
        lens.vignetting = lens.vignetting.filter { $0.aperture > 0 }
        lenses.append(lens)
    }
    return LensfunDb(cameras: cameras, lenses: lenses)
}

// MARK: - finding

/// The two helpers whose web names are too generic for the module's scope.
public enum Lensfun {
    /// Lower case, letters and digits only — how a maker or a model is compared.
    public static func squash(_ s: String) -> String {
        String(String.UnicodeScalarView(s.lowercased().unicodeScalars.filter {
            ($0.value >= 0x61 && $0.value <= 0x7A) || ($0.value >= 0x30 && $0.value <= 0x39)
        }))
    }

    /// Lensfun's `_lf_interpolate`: a Hermite spline through y2 → y3, its
    /// tangents from the outer two when they exist.
    public static func hermite(_ y1: Double?, _ y2: Double, _ y3: Double, _ y4: Double?, _ t: Double) -> Double {
        let tg2 = y1.map { (y3 - $0) * 0.5 } ?? (y3 - y2)
        let tg3 = y4.map { ($0 - y2) * 0.5 } ?? (y3 - y2)
        let t2 = t * t
        let t3 = t2 * t
        let a = (2 * t3 - 3 * t2 + 1) * y2
        let b = (t3 - 2 * t2 + t) * tg2
        let c = (-2 * t3 + 3 * t2) * y3
        let d = (t3 - t2) * tg3
        return a + b + c + d
    }
}

/// EXIF makers that are not spelled as Lensfun spells them.
private let makerAliases: [String: String] = [
    "nikoncorporation": "nikon",
    "olympusimagingcorp": "olympus",
    "olympuscorporation": "olympus",
    "omdigitalsolutions": "omdigitalsolutions",
    "ricohimaging": "ricoh",
    "pentaxcorporation": "pentax",
    "eastmankodakcompany": "kodak",
    "fujiphotofilmcoltd": "fujifilm",
    "samsungtechwin": "samsung",
    "leicacameraag": "leica",
]

public func makerKey(_ make: String) -> String {
    let k = Lensfun.squash(make)
    return makerAliases[k] ?? k
}

/// The camera an EXIF `Make` + `Model` name. Lensfun spells the model the way
/// the camera writes it (`ILCE-7CM2`), so the comparison is exact once
/// squashed — with the maker's name taken off the model where the body repeats
/// it (`Canon EOS R5`).
public func findCamera(_ dbs: [LensfunDb], _ make: String, _ model: String) -> LensfunCamera? {
    let maker = makerKey(make)
    let m = Lensfun.squash(model)
    let bare = m.hasPrefix(maker) ? String(m.dropFirst(maker.count)) : m
    for db in dbs {
        for c in db.cameras {
            if makerKey(c.maker) != maker { continue }
            if c.models.contains(where: { Lensfun.squash($0) == m || Lensfun.squash($0) == bare }) { return c }
        }
    }
    return nil
}

/// A lens name as words: runs of letters and runs of numbers apart, so
/// `FE 24-70mm F2.8 GM II` and Lensfun's `FE 24-70mm f/2.8 GM II` read alike.
public func lensWords(_ name: String) -> [String] {
    let lower = name.lowercased().replacingOccurrences(of: "f/", with: "f")
    let s = Array(lower.utf8)
    func digit(_ b: UInt8) -> Bool { b >= 0x30 && b <= 0x39 }
    func letter(_ b: UInt8) -> Bool { b >= 0x61 && b <= 0x7A }
    var out: [String] = []
    var i = 0
    while i < s.count {
        if digit(s[i]) {
            var j = i
            while j < s.count && digit(s[j]) { j += 1 }
            if j + 1 < s.count, s[j] == UInt8(ascii: "."), digit(s[j + 1]) {
                j += 1
                while j < s.count && digit(s[j]) { j += 1 }
            }
            out.append(string(s[i..<j]))
            i = j
        } else if letter(s[i]) {
            var j = i
            while j < s.count && letter(s[j]) { j += 1 }
            out.append(string(s[i..<j]))
            i = j
        } else {
            i += 1
        }
    }
    return out
}

/// How well two lens names agree, 0..1: shared words over all words (so `GM`
/// and `GM II` are told apart), and 0 outright when their NUMBERS differ — a
/// 24-70 is never a 24-105, however many words the two share.
public func lensNameScore(_ a: String, _ b: String) -> Double {
    let x = lensWords(a)
    let y = lensWords(b)
    if x.isEmpty || y.isEmpty { return 0 }
    func numbers(_ w: [String]) -> String {
        w.filter { $0.first.map { $0 >= "0" && $0 <= "9" } ?? false }
            .sorted { Array($0.utf16).lexicographicallyPrecedes(Array($1.utf16)) }
            .joined(separator: ",")
    }
    if numbers(x) != numbers(y) { return 0 }
    let xs = Set(x)
    let ys = Set(y)
    let both = xs.filter { ys.contains($0) }.count
    return Double(both) / Double(xs.union(ys).count)
}

/// Below this, two names are not the same lens.
public let lensMatchFloor = 0.6

public struct LensMatch: Equatable, Sendable {
    public var lens: LensfunLens
    public var score: Double
    public init(lens: LensfunLens, score: Double) { self.lens = lens; self.score = score }
}

/// The lens a picture was taken with, among the database's, for this camera:
/// on its mount (or, for a fixed-lens camera, its own), calibrated on a sensor
/// no smaller than the picture's (`imageCrop / lens.crop ≥ 0.96`, the closest
/// such), rectilinear, with a name that agrees with the EXIF `LensModel`. A
/// fixed-lens camera needs no name: its mount holds one lens.
public func findLens(_ dbs: [LensfunDb], _ camera: LensfunCamera, _ lensModel: String?) -> LensMatch? {
    let named = (lensModel ?? "").isEmpty ? nil : lensModel
    var candidates: [LensMatch] = []
    for db in dbs {
        for lens in db.lenses {
            if !lens.mounts.contains(camera.mount) { continue }
            if lens.type != "rectilinear" { continue }
            if camera.crop / lens.crop < 0.96 { continue }
            let score: Double
            if let named {
                score = lens.models.map { lensNameScore(named, $0) }.max() ?? -.infinity
            } else {
                score = 1
            }
            if score >= lensMatchFloor || (named == nil && lens.mounts.count == 1) {
                candidates.append(LensMatch(lens: lens, score: score))
            }
        }
    }
    if candidates.isEmpty { return nil }
    // The web's stable sort: the best score first, then the calibration made on
    // the sensor closest to the picture's, from above; ties keep their order.
    let ranked = candidates.enumerated().sorted { a, b in
        let byScore = b.element.score - a.element.score
        if byScore != 0, !byScore.isNaN { return byScore < 0 }
        let byCrop = camera.crop / a.element.lens.crop - camera.crop / b.element.lens.crop
        if byCrop != 0, !byCrop.isNaN { return byCrop < 0 }
        return a.offset < b.offset
    }
    return ranked[0].element
}

// MARK: - interpolating, as lens.cpp does

/// The entries of one model at `focal`: an exact focal as it is, else the
/// Hermite spline over the two nearest below and the two above, else the
/// nearest one alone. `scaled(i)` says whether term i is interpolated as
/// `term × focal` — Lensfun's `__parameter_scales`, which does that for every
/// distortion term and for the TCA's radius terms.
private func interpolate<T>(_ entries: [T], _ focal: Double, focalOf: (T) -> Double, termsOf: (T) -> [Double],
                            modelOf: (T) -> String, scaled: (Int) -> Bool) -> (model: T, terms: [Double])? {
    guard let first = entries.first else { return nil }
    let same = entries.filter { modelOf($0) == modelOf(first) }
    if let exact = same.first(where: { focalOf($0) == focal }) { return (exact, termsOf(exact)) }
    func stable(_ list: [T], _ before: (Double, Double) -> Bool) -> [T] {
        list.enumerated().sorted { a, b in
            let fa = focalOf(a.element)
            let fb = focalOf(b.element)
            if fa != fb { return before(fa, fb) }
            return a.offset < b.offset
        }.map { $0.element }
    }
    let below = stable(same.filter { focalOf($0) < focal }, { $0 > $1 })
    let above = stable(same.filter { focalOf($0) > focal }, { $0 < $1 })
    if below.isEmpty || above.isEmpty {
        let only = below.first ?? above[0]
        return (only, termsOf(only))
    }
    let p1 = below[0]
    let p0: T? = below.count > 1 ? below[1] : nil
    let p2 = above[0]
    let p3: T? = above.count > 1 ? above[1] : nil
    let t = (focal - focalOf(p1)) / (focalOf(p2) - focalOf(p1))
    let terms = termsOf(p1).indices.map { i -> Double in
        let s = scaled(i)
        func w(_ e: T) -> Double { s ? focalOf(e) : 1 }
        let y1 = p0.map { termsOf($0)[i] * w($0) }
        let y2 = termsOf(p1)[i] * w(p1)
        let y3 = termsOf(p2)[i] * w(p2)
        let y4 = p3.map { termsOf($0)[i] * w($0) }
        return Lensfun.hermite(y1, y2, y3, y4, t) / (s ? focal : 1)
    }
    return (p1, terms)
}

public func interpolateDistortion(_ lens: LensfunLens, _ focal: Double) -> DistortionEntry? {
    guard let r = interpolate(lens.distortion, focal, focalOf: { $0.focal }, termsOf: { $0.terms },
                              modelOf: { $0.model.rawValue }, scaled: { _ in true }) else { return nil }
    return DistortionEntry(model: r.model.model, focal: focal, terms: r.terms)
}

public func interpolateTca(_ lens: LensfunLens, _ focal: Double) -> TcaEntry? {
    guard let r = interpolate(lens.tca, focal, focalOf: { $0.focal }, termsOf: { $0.terms },
                              modelOf: { $0.model.rawValue }, scaled: { $0 >= 2 }) else { return nil }
    return TcaEntry(model: r.model.model, focal: focal, terms: r.terms)
}

/// The vignetting at a focal length, an aperture and a distance: Lensfun's
/// inverse-distance weighting (power 3.5) over every entry, in a space where
/// the focal range, `4 / aperture` and `0.1 / distance` each span about one —
/// and nothing when the nearest entry is further than 1 away, which is
/// Lensfun's own refusal to extrapolate.
public func interpolateVignetting(_ lens: LensfunLens, _ focal: Double, _ aperture: Double,
                                  _ distance: Double = 1000) -> [Double]? {
    let entries = lens.vignetting
    if entries.isEmpty || !(aperture > 0) { return nil }
    let fMin = lens.focalMin ?? entries.map { $0.focal }.min()!
    let fMax = lens.focalMax ?? entries.map { $0.focal }.max()!
    let span = fMax - fMin
    func norm(_ f: Double) -> Double { span != 0 && !span.isNaN ? (f - fMin) / span : f - fMin }
    var total = 0.0
    var acc = [0.0, 0.0, 0.0]
    var nearest = Double.infinity
    for e in entries {
        let df = norm(e.focal) - norm(focal)
        let da = 4 / e.aperture - 4 / aperture
        let dd = 0.1 / e.distance - 0.1 / distance
        let d = (df * df + da * da + dd * dd).squareRoot()
        if d < 0.0001 { return e.terms }
        nearest = min(nearest, d)
        let w = abs(1 / pow(d, 3.5))
        for i in 0..<3 { acc[i] += w * e.terms[i] }
        total += w
    }
    if nearest > 1 || !(total > 0) { return nil }
    return [acc[0] / total, acc[1] / total, acc[2] / total]
}

// MARK: - into this suite's units

/// What a picture was taken at: its focal length, its aperture (nil when the
/// EXIF has none), the crop factor of the sensor area it used, and a focus
/// distance where one is known (Lensfun's 1000 m otherwise, as darktable).
public struct LensShot: Equatable, Sendable {
    public var focal: Double
    public var aperture: Double?
    public var imageCrop: Double
    public var distance: Double?

    public init(focal: Double, aperture: Double?, imageCrop: Double, distance: Double? = nil) {
        self.focal = focal; self.aperture = aperture; self.imageCrop = imageCrop; self.distance = distance
    }
}

/// The three corrections of `lens` at this focal length and aperture, for a
/// picture taken on a sensor of `imageCrop` — each absent where the database
/// has no data for it, in which case that part of the terms is the identity.
public func profileTerms(_ lens: LensfunLens, _ shot: LensShot) -> (terms: LensProfileTerms, has: LensProfileHas) {
    let s = (lens.aspect * lens.aspect + 1).squareRoot() * (lens.crop / shot.imageCrop)
    let q = lens.crop / shot.imageCrop
    var terms = noProfileTerms
    let dist = interpolateDistortion(lens, shot.focal)
    if let dist {
        switch dist.model {
        case .ptlens:
            // Lensfun's centre-preserving rescale (mod-coord.cpp): a' = a/d⁴,
            // b' = b/d³, c' = c/d², so the middle of the picture keeps its scale.
            let a = dist.terms[0]
            let b = dist.terms[1]
            let c = dist.terms[2]
            let d = 1 - a - b - c
            let d1 = (c / pow(d, 2)) * s
            let d2 = (b / pow(d, 3)) * pow(s, 2)
            let d3 = (a / pow(d, 4)) * pow(s, 3)
            terms.distortion = [d1, d2, d3, 0]
        case .poly3:
            let k1 = dist.terms[0]
            terms.distortion = [0, (k1 / pow(1 - k1, 3)) * pow(s, 2), 0, 0]
        case .poly5:
            let k1 = dist.terms[0]
            let k2 = dist.terms[1]
            terms.distortion = [0, k1 * pow(s, 2), 0, k2 * pow(s, 4)]
        }
    }
    let tca = interpolateTca(lens, shot.focal)
    if let tca {
        switch tca.model {
        case .linear:
            terms.tcaRed = [tca.terms[0], 0, 0]
            terms.tcaBlue = [tca.terms[1], 0, 0]
        case .poly3:
            let t = tca.terms
            terms.tcaRed = [t[0], t[2] * s, t[4] * pow(s, 2)]
            terms.tcaBlue = [t[1], t[3] * s, t[5] * pow(s, 2)]
        }
    }
    var vig: [Double]? = nil
    if let aperture = shot.aperture, aperture != 0, !aperture.isNaN {
        vig = interpolateVignetting(lens, shot.focal, aperture, shot.distance ?? 1000)
    }
    if let vig {
        terms.vignette = [vig[0] * pow(q, 2), vig[1] * pow(q, 4), vig[2] * pow(q, 6)]
    }
    return (terms, LensProfileHas(distortion: dist != nil, tca: tca != nil, vignette: vig != nil))
}
