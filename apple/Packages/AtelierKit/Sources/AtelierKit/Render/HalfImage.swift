// A picture the GPU takes at HALF-FLOAT precision — the source a RAW becomes.
// Port of `src/shared/render/half-image.ts`.
//
// Every other source is 8-bit. A RAW decodes to 16 bits of linear light, and
// squeezing it into eight before the develop runs would throw away exactly what
// the RAW was opened for. So the decoder hands the renderer three half-floats
// per pixel, sRGB-ENCODED (the domain the cube speaks), row-major from the TOP.
//
// The conversion is written out rather than taken from `Float16`: Swift's
// `Float16` is unavailable on Intel Macs, and the kernel must build everywhere
// the app does. `toHalf` rounds the value to a float32 FIRST, then to the
// nearest half (ties to even) — the web's own two steps, so the bits agree.

import Foundation

public struct HalfImage: Equatable, Sendable {
    public var width: Int
    public var height: Int
    /// `width × height × 3` half-float bit patterns, RGB, top row first.
    public var data: [UInt16]

    public init(width: Int, height: Int, data: [UInt16]) {
        self.width = width; self.height = height; self.data = data
    }
}

/// The web's type guard over the graph's source union — in Swift, a type test.
public func isHalfImage(_ source: Any?) -> Bool {
    source is HalfImage
}

/// IEEE 754 binary16 from a number, round-to-nearest-even; ±Infinity past the
/// half range, NaN kept NaN.
public func toHalf(_ value: Double) -> UInt16 {
    let x = Float(value).bitPattern
    let sign = (x >> 16) & 0x8000
    var exp = Int((x >> 23) & 0xff)
    var mant = x & 0x7f_ffff
    if exp == 0xff { return UInt16(sign | 0x7c00 | (mant != 0 ? 0x200 : 0)) } // inf / nan
    // Rebias 127 → 15.
    exp -= 112
    if exp >= 0x1f { return UInt16(sign | 0x7c00) } // overflow → inf
    if exp <= 0 {
        // Subnormal or zero in half: shift the mantissa (with its hidden bit) down.
        if exp < -10 { return UInt16(sign) }
        mant |= 0x80_0000
        let shift = UInt32(14 - exp)
        var half = mant >> shift
        let rem = mant & ((1 << shift) - 1)
        let halfway: UInt32 = 1 << (shift - 1)
        if rem > halfway || (rem == halfway && (half & 1) != 0) { half += 1 }
        return UInt16(sign | half)
    }
    var half = (UInt32(exp) << 10) | (mant >> 13)
    let rem = mant & 0x1fff
    if rem > 0x1000 || (rem == 0x1000 && (half & 1) != 0) { half += 1 } // may carry into exp: fine
    return UInt16(sign | half)
}

/// The number a half-float bit pattern holds — `toHalf`'s inverse.
public func fromHalf(_ bits: UInt16) -> Double {
    let sign: Double = bits & 0x8000 != 0 ? -1 : 1
    let exp = Int((bits >> 10) & 0x1f)
    let mant = Double(bits & 0x3ff)
    if exp == 0 { return sign * mant * pow(2, -24) }
    if exp == 0x1f { return mant != 0 ? .nan : sign * .infinity }
    return sign * (1 + mant / 1024) * pow(2, Double(exp - 15))
}

/// A half image from three floats per pixel, packed.
public func packHalfImage(_ rgb: [Double], _ width: Int, _ height: Int) -> HalfImage {
    let n = width * height * 3
    var data = [UInt16](repeating: 0, count: n)
    for i in 0..<n { data[i] = toHalf(rgb[i]) }
    return HalfImage(width: width, height: height, data: data)
}
