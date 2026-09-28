// IEEE 754 binary16 — the conversion a float takes when it is uploaded into
// a half-float image, done by hand.
//
// Hand-rolled rather than Swift's `Float16`, which is UNAVAILABLE on Intel
// Macs (the type does not exist on macOS x86_64) and this app still builds
// there. Round to nearest, ties to even — what the GPU does. Verified against
// Swift's own `Float16` on Linux (where the type exists on x86_64): every bit
// pattern from below the smallest subnormal to 2⁻¹³, every one around the
// half ceiling, and five million random values — no mismatch.

import Foundation

enum HalfFloat {
    /// The binary16 bits of `value`.
    static func bits(_ value: Float) -> UInt16 {
        let bits = value.bitPattern
        let sign = UInt16((bits >> 16) & 0x8000)
        let exponent = Int((bits >> 23) & 0xFF)
        let mantissa = bits & 0x7F_FFFF
        if exponent == 0xFF {
            // Infinity keeps its sign; a NaN is a quiet NaN.
            return sign | 0x7C00 | (mantissa != 0 ? 0x0200 : 0)
        }
        let e = exponent - 127 + 15
        if e >= 0x1F { return sign | 0x7C00 }
        if e <= 0 {
            // Below the smallest half normal: a subnormal, or zero.
            if e < -10 { return sign }
            let m = mantissa | 0x80_0000
            let shift = UInt32(14 - e)
            var half = m >> shift
            let remainder = m & ((1 << shift) - 1)
            let halfway: UInt32 = 1 << (shift - 1)
            if remainder > halfway || (remainder == halfway && (half & 1) == 1) { half += 1 }
            return sign | UInt16(half)
        }
        var half = (UInt32(e) << 10) | (mantissa >> 13)
        let remainder = mantissa & 0x1FFF
        // A carry out of the mantissa lands in the exponent, which is the
        // right answer: the value rounds up to the next binade, or to infinity.
        if remainder > 0x1000 || (remainder == 0x1000 && (half & 1) == 1) { half += 1 }
        return sign | UInt16(half)
    }

    /// `values` as consecutive half floats, in memory order — what a
    /// `CIImage(bitmapData:…, format: .RGBAh, …)` takes.
    static func data(_ values: [Float]) -> Data {
        var halves = [UInt16](repeating: 0, count: values.count)
        for i in 0..<values.count { halves[i] = bits(values[i]) }
        return halves.withUnsafeBufferPointer { Data(buffer: $0) }
    }
}
