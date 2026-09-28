// What a RAW decode becomes, in numbers — port of `src/shared/raw/raw-image.ts`,
// the pure half of the web's `raw-decoder.ts`.
//
// LibRaw hands back 16-bit RGB with dcraw's DEFAULT curve on it whatever its
// `gamm` option says (measured: 0.5 of sensor white came back as 0.7059 —
// BT.709's `1.099·x^0.45 − 0.099` to four places). So the curve is inverted
// here, exactly: sixteen bits carry it without loss, and a linear value is what
// a develop is defined on.
//
// From there: the picture's own exposure is MEASURED, not invented — the
// brightest percentile of the frame is taken as white, dcraw's auto-bright rule
// (1 % clipped) — and kept as a number the develop carries (`rawGain`), so the
// same gain is applied at export from a decode of another size. Then the linear
// values are sRGB-ENCODED into half-floats for the GPU, sensor white at 1.0.
//
// **Memory is the shape of this module (2026-09-23).** Every step is a pure
// function of ONE 16-bit code, or of a box of them, so nothing full-size has to
// exist in between:
// - **Box-averaged** (`boxLinearRows`): the target-size linear picture is
//   written straight from the 16-bit codes through the BT.709 table, a band of
//   rows at a time.
// - **Whole** (`halfTableFromLibRaw`, `byteTableFromLibRaw`): a 16-bit code
//   maps to exactly one half-float and, for a given gain, exactly one byte, so
//   a 65536-entry table each is the whole conversion.
// Both paths produce, BIT FOR BIT, what `boxDownscale(linearFromLibRaw(…))`
// followed by `halfImageFromLinear` and `bytesFromLinear` produce — the specs
// pin it. The arithmetic keeps the web's exactly: float32 storage, sums and
// products in doubles in the same order, a float32 rounding at each store.
//
// The decoder itself is not the kernel's: the web's is LibRaw in a worker, the
// app's is `CIRAWFilter`. Where the app hands this module a 16-bit plane (its
// own decode of a RAW, or LibRaw's), every number below applies unchanged.

import Foundation

/// The three floats per pixel a RAW becomes before it is packed.
public struct LinearRgb: Equatable, Sendable {
    public var width: Int
    public var height: Int
    /// Linear light, sensor white at 1, RGB, top row first.
    public var data: [Float]

    public init(width: Int, height: Int, data: [Float]) {
        self.width = width; self.height = height; self.data = data
    }
}

public enum RawImageError: Error, Equatable {
    /// A decode shorter than its stated size: `width × height × 3` samples were needed.
    case shortDecode(width: Int, height: Int, needed: Int, got: Int)
}

private let bt709Knee = 0.018
private let bt709A = 1.099
private let bt709B = 0.099
private let bt709Slope = 4.5
/// Where the two branches of the ENCODED curve meet, `4.5 × 0.018`.
private let bt709KneeEncoded = bt709Slope * bt709Knee

/// dcraw's default output curve (BT.709), decoded: an encoded code in [0,1] → linear light.
public func bt709ToLinear(_ encoded: Double) -> Double {
    if encoded <= 0 { return 0 }
    if encoded < bt709KneeEncoded { return encoded / bt709Slope }
    return pow((encoded + bt709B) / bt709A, 1 / 0.45)
}

/// The curve itself, for the spec that pins the inversion.
public func linearToBt709(_ linear: Double) -> Double {
    if linear <= 0 { return 0 }
    if linear < bt709Knee { return linear * bt709Slope }
    return bt709A * pow(linear, 0.45) - bt709B
}

/// JavaScript's `Math.round`: the nearest integer, a half going toward +∞
/// (`ExifText`'s, which never adds 0.5 first — that rounds 0.49999999999999994 up).
private func jsRound(_ x: Double) -> Double {
    ExifText.jsRound(x)
}

// The four tables that depend on nothing but the maths are built ONCE per
// process and shared (a global `let` is initialised once, lazily and
// thread-safely): each is 64–256 KB and a few milliseconds of `pow`.

private let bt709Shared: [Float] = (0..<65536).map { Float(bt709ToLinear(Double($0) / 65535)) }

/// The decoder's curve inverted over every 16-bit code — 256 KB, built once.
/// The ONE table both decode paths read.
public func bt709Table() -> [Float] {
    bt709Shared
}

/// LibRaw's 16-bit output → linear light, whole, through the table. A
/// full-size Float32 picture: the decoder no longer builds one, but the spec
/// that pins the fused paths is defined against this.
public func linearFromLibRaw(_ rgb16: [UInt16], _ width: Int, _ height: Int,
                             _ table: [Float] = bt709Table()) throws -> LinearRgb {
    let n = width * height * 3
    if rgb16.count < n { throw RawImageError.shortDecode(width: width, height: height, needed: n, got: rgb16.count) }
    var data = [Float](repeating: 0, count: n)
    for i in 0..<n { data[i] = table[Int(rgb16[i])] }
    return LinearRgb(width: width, height: height, data: data)
}

/// Share of the frame allowed to clip when the exposure is measured — dcraw's `-W` default.
public let autoBrightClip = 0.01
/// The gain is never below 1 (the sensor's white is white) nor above this — 4 stops.
public let maxAutoGain = 16.0

/// The gain that puts `white` at 1: bounded, rounded to three decimals.
private func gainForWhite(_ white: Double) -> Double {
    let gain = min(maxAutoGain, max(1, 1 / white))
    return jsRound(gain * 1000) / 1000
}

/// The white the brightest `clip` share of `hist` sits above — the bin's UPPER edge.
private func whiteFromHistogram(_ hist: [UInt32], _ bins: Int, _ counted: Int, _ clip: Double) -> Double {
    if counted == 0 { return 1 }
    // Walk down from white until `clip` of the pixels are above.
    var above = 0.0
    var bin = bins
    let allowed = Double(counted) * clip
    while bin > 0 && above + Double(hist[bin]) <= allowed {
        above += Double(hist[bin])
        bin -= 1
    }
    // The bin's UPPER edge: a white a hair too bright clips a hair less.
    return min(1, Double(bin + 1) / Double(bins))
}

private let gainBins = 4096

/// `Math.max(a, b, c)`: NaN when any is.
private func max3(_ a: Double, _ b: Double, _ c: Double) -> Double {
    if a.isNaN || b.isNaN || c.isNaN { return .nan }
    return max(a, max(b, c))
}

/// One sample into the histogram, as the web's typed array takes it: a NaN
/// index is no index, and the pixel is counted all the same.
private func tally(_ hist: inout [UInt32], _ m: Double) {
    if m.isNaN { return }
    let bin = m >= 1 ? gainBins : max(0, Int((m * Double(gainBins)).rounded(.down)))
    hist[bin] &+= 1
}

/// The gain that puts the brightest `clip` share of the picture at white: the
/// picture's own exposure, measured, as dcraw's auto-bright measures it. Read
/// off the per-pixel maximum channel, over a sample of the frame (every
/// `stride`-th pixel). Rounded to three decimals: it is STORED on the develop,
/// and a number that differs in the tenth decimal between two decodes is two
/// documents.
public func autoBrightGain(_ picture: LinearRgb, _ clip: Double = autoBrightClip, _ stride: Int = 4) -> Double {
    let data = picture.data
    let pixels = picture.width * picture.height
    var hist = [UInt32](repeating: 0, count: gainBins + 1)
    var counted = 0
    var p = 0
    let step = max(1, stride)
    while p < pixels {
        let i = p * 3
        tally(&hist, max3(Double(data[i]), Double(data[i + 1]), Double(data[i + 2])))
        counted += 1
        p += step
    }
    if counted == 0 { return 1 }
    return gainForWhite(whiteFromHistogram(hist, gainBins, counted, clip))
}

/// The same measurement straight off the 16-bit decode, through the table —
/// the whole-picture path, where no linear picture exists to measure. Equal to
/// `autoBrightGain(linearFromLibRaw(rgb16, …))` sample for sample: the table
/// holds the very float32 the linear picture would.
public func autoBrightGainFromLibRaw(_ rgb16: [UInt16], _ width: Int, _ height: Int, _ table: [Float],
                                     _ clip: Double = autoBrightClip, _ stride: Int = 4) -> Double {
    let pixels = width * height
    var hist = [UInt32](repeating: 0, count: gainBins + 1)
    var counted = 0
    var p = 0
    let step = max(1, stride)
    while p < pixels {
        let i = p * 3
        let r = Double(table[Int(rgb16[i])])
        let g = Double(table[Int(rgb16[i + 1])])
        let b = Double(table[Int(rgb16[i + 2])])
        tally(&hist, max3(r, g, b))
        counted += 1
        p += step
    }
    if counted == 0 { return 1 }
    return gainForWhite(whiteFromHistogram(hist, gainBins, counted, clip))
}

/// The size a decode is brought to for a pixel budget: whole when it fits,
/// else the integer box factor that first fits — a box average of linear light
/// is the right resample for a preview, and an integer factor keeps it exact
/// and cheap.
public func rawBoxFactor(_ width: Int, _ height: Int, _ budgetPixels: Double) -> Int {
    if !(budgetPixels > 0) { return 1 }
    var factor = 1
    while (Double(width) / Double(factor)) * (Double(height) / Double(factor)) > budgetPixels { factor += 1 }
    return factor
}

/// A box average of linear light by an integer factor; the edge rows and
/// columns that do not fill a box are dropped.
public func boxDownscale(_ picture: LinearRgb, _ factor: Int) -> LinearRgb {
    if factor <= 1 { return picture }
    let w = picture.width / factor
    let h = picture.height / factor
    var out = [Float](repeating: 0, count: w * h * 3)
    let src = picture.data
    let sw = picture.width
    let inv = 1 / Double(factor * factor)
    for y in 0..<h {
        for x in 0..<w {
            var r = 0.0
            var g = 0.0
            var b = 0.0
            for dy in 0..<factor {
                var i = ((y * factor + dy) * sw + x * factor) * 3
                for _ in 0..<factor {
                    r += Double(src[i])
                    g += Double(src[i + 1])
                    b += Double(src[i + 2])
                    i += 3
                }
            }
            let o = (y * w + x) * 3
            out[o] = Float(r * inv)
            out[o + 1] = Float(g * inv)
            out[o + 2] = Float(b * inv)
        }
    }
    return LinearRgb(width: w, height: h, data: out)
}

/// The size `boxLinearRows` writes for a decode of `width`×`height` at `factor`.
public func boxedSize(_ width: Int, _ height: Int, _ factor: Int) -> (width: Int, height: Int) {
    (width / factor, height / factor)
}

/// Rows `[y0, y1)` of the box-averaged linear picture, written into `out`
/// (sized by `boxedSize`) straight from the 16-bit codes through `table` — the
/// fused twin of `boxDownscale(linearFromLibRaw(…))`, summing the same float32
/// values in the same order, so the two agree to the bit. A band at a time is
/// what lets the decoder yield between rows and stop on a cancel with nothing
/// full-size ever allocated.
public func boxLinearRows(_ rgb16: [UInt16], _ srcWidth: Int, _ factor: Int, _ table: [Float],
                          _ out: inout [Float], _ outWidth: Int, _ y0: Int, _ y1: Int) {
    let inv = 1 / Double(factor * factor)
    var y = y0
    while y < y1 {
        for x in 0..<outWidth {
            var r = 0.0
            var g = 0.0
            var b = 0.0
            for dy in 0..<factor {
                var i = ((y * factor + dy) * srcWidth + x * factor) * 3
                for _ in 0..<factor {
                    r += Double(table[Int(rgb16[i])])
                    g += Double(table[Int(rgb16[i + 1])])
                    b += Double(table[Int(rgb16[i + 2])])
                    i += 3
                }
            }
            let o = (y * outWidth + x) * 3
            out[o] = Float(r * inv)
            out[o + 1] = Float(g * inv)
            out[o + 2] = Float(b * inv)
        }
        y += 1
    }
}

private let encodeSteps = 4096

/// The sRGB encode over the 0..1 range at 12 bits, exact enough (the half-float
/// itself holds ~11 bits) and far faster than the curve per sample.
private let srgbEncodeShared: [Float] = (0...encodeSteps).map {
    Float(fromLinear(Double($0) / Double(encodeSteps), .srgb))
}

/// ONE linear sample sRGB-encoded as the GPU picture has it: the table inside
/// 0..1, the exact curve past white.
private func encodeLinearSample(_ v: Double, _ table: [Float]) -> Double {
    if v <= 0 { return 0 }
    if v >= 1 { return v == 1 ? 1 : 1.055 * pow(v, 1 / 2.4) - 0.055 }
    let t = v * Double(encodeSteps)
    let k = Int(t.rounded(.down))
    let f = t - Double(k)
    let lo = Double(table[k])
    let hi = Double(table[k + 1])
    return lo + (hi - lo) * f
}

private let srgbByteShared: [UInt8] = (0...encodeSteps).map {
    let v = jsRound(fromLinear(Double($0) / Double(encodeSteps), .srgb) * 255)
    return UInt8(min(255, max(0, v)))
}

/// The table index of a linear sample at `gain` — clamped, a NaN reading as 0
/// (the byte a typed array stores for `undefined`).
private func byteStep(_ linear: Double, _ gain: Double) -> Int {
    let v = jsRound(linear * gain * Double(encodeSteps))
    if v.isNaN { return 0 }
    return Int(min(Double(encodeSteps), max(0, v)))
}

/// Linear light → the GPU's source: sRGB-encoded half-floats, sensor white at
/// 1.0 — no gain applied here, the develop stage applies it, so one texture
/// serves every setting of the sliders. Above 1 the encode continues past white.
public func halfImageFromLinear(_ picture: LinearRgb) -> HalfImage {
    var out = [UInt16](repeating: 0, count: picture.data.count)
    encodeLinearRows(picture, 1, &out, 0, picture.width * picture.height)
    return HalfImage(width: picture.width, height: picture.height, data: out)
}

private func encodeRows(_ picture: LinearRgb, _ gain: Double, _ half: inout [UInt16], _ bytes: inout [UInt8],
                        _ writeBytes: Bool, _ p0: Int, _ p1: Int) {
    let data = picture.data
    let encode = srgbEncodeShared
    let byteOf = srgbByteShared
    var p = p0
    var i = p0 * 3
    var o = p0 * 4
    while p < p1 {
        let r = Double(data[i])
        let g = Double(data[i + 1])
        let b = Double(data[i + 2])
        half[i] = toHalf(encodeLinearSample(r, encode))
        half[i + 1] = toHalf(encodeLinearSample(g, encode))
        half[i + 2] = toHalf(encodeLinearSample(b, encode))
        if writeBytes {
            bytes[o] = byteOf[byteStep(r, gain)]
            bytes[o + 1] = byteOf[byteStep(g, gain)]
            bytes[o + 2] = byteOf[byteStep(b, gain)]
            bytes[o + 3] = 255
        }
        p += 1
        i += 3
        o += 4
    }
}

/// Pixels `[p0, p1)` of a linear picture, encoded in ONE pass into what the
/// stage takes: the half-floats and the as-shot RGBA at `gain`. One read of
/// each sample serves both. `halfImageFromLinear` and `bytesFromLinear` are
/// this over the whole picture, one output each — so the three can never
/// disagree about a sample.
public func encodeLinearRows(_ picture: LinearRgb, _ gain: Double, _ half: inout [UInt16], _ bytes: inout [UInt8],
                             _ p0: Int, _ p1: Int) {
    encodeRows(picture, gain, &half, &bytes, true, p0, p1)
}

/// The same with the half-floats alone (the web's `bytes: null`): no byte is touched.
public func encodeLinearRows(_ picture: LinearRgb, _ gain: Double, _ half: inout [UInt16], _ p0: Int, _ p1: Int) {
    var none: [UInt8] = []
    encodeRows(picture, gain, &half, &none, false, p0, p1)
}

private func buildHalfTable(_ table: [Float]) -> [UInt16] {
    let encode = srgbEncodeShared
    var out = [UInt16](repeating: 0, count: 65536)
    for i in 0..<65536 { out[i] = toHalf(encodeLinearSample(Double(table[i]), encode)) }
    return out
}

private let halfOfCodeShared: [UInt16] = buildHalfTable(bt709Shared)

/// Every 16-bit code's half-float — what `halfImageFromLinear` would make of
/// `linearFromLibRaw`'s value for it — so a whole decode is packed by one
/// lookup per sample and no float picture is ever built. 128 KB; the one for
/// the shared BT.709 table is built once and handed out every time (Swift's
/// array equality answers at once for the same buffer).
public func halfTableFromLibRaw(_ table: [Float]) -> [UInt16] {
    if table == bt709Shared { return halfOfCodeShared }
    return buildHalfTable(table)
}

/// Samples `[from, to)` of a whole decode, packed through `halfTable` into `out`.
public func packHalfSamples(_ rgb16: [UInt16], _ halfTable: [UInt16], _ out: inout [UInt16], _ from: Int, _ to: Int) {
    var i = from
    while i < to {
        out[i] = halfTable[Int(rgb16[i])]
        i += 1
    }
}

/// The 8-bit picture of the decode AS SHOT — with its measured gain, clipped at
/// white — RGBA, for a 2D surface.
public func bytesFromLinear(_ picture: LinearRgb, _ gain: Double) -> [UInt8] {
    let data = picture.data
    let pixels = picture.width * picture.height
    var out = [UInt8](repeating: 0, count: pixels * 4)
    let table = srgbByteShared
    var i = 0
    var o = 0
    for _ in 0..<pixels {
        out[o] = table[byteStep(Double(data[i]), gain)]
        out[o + 1] = table[byteStep(Double(data[i + 1]), gain)]
        out[o + 2] = table[byteStep(Double(data[i + 2]), gain)]
        out[o + 3] = 255
        i += 3
        o += 4
    }
    return out
}

/// Every 16-bit code's as-shot byte at `gain` — `bytesFromLinear`'s value for
/// `linearFromLibRaw`'s value for it — for the whole-decode path. 64 KB.
public func byteTableFromLibRaw(_ table: [Float], _ gain: Double) -> [UInt8] {
    let bytes = srgbByteShared
    var out = [UInt8](repeating: 0, count: 65536)
    for i in 0..<65536 { out[i] = bytes[byteStep(Double(table[i]), gain)] }
    return out
}

/// Pixels `[from, to)` of a whole decode as RGBA bytes through `byteTable`, into `out`.
public func packBytePixels(_ rgb16: [UInt16], _ byteTable: [UInt8], _ out: inout [UInt8], _ from: Int, _ to: Int) {
    var p = from
    var i = from * 3
    var o = from * 4
    while p < to {
        out[o] = byteTable[Int(rgb16[i])]
        out[o + 1] = byteTable[Int(rgb16[i + 1])]
        out[o + 2] = byteTable[Int(rgb16[i + 2])]
        out[o + 3] = 255
        p += 1
        i += 3
        o += 4
    }
}
