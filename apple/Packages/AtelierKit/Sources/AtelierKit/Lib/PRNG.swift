// The suite's ONE seeded generator — port of `src/shared/lib/prng.ts`.
//
// mulberry32: 32-bit state, good enough spread, and the same seed draws the
// same sequence here as in every browser and in node — which is what a STORED
// seed needs (a stagger's order, a film's grain field): a document written on
// the web and opened on the phone must roll the same field. `Math.random()` /
// `Double.random` have no place on a path whose output is stored or exported
// (`roadtrip.md`, the seeded voices).
//
// The arithmetic is JavaScript's, bit for bit: the state is the unsigned
// pattern its `| 0`, `>>>` and `Math.imul` leave behind, so every operation
// below is a wrapping UInt32 one. The spec pins draws measured in node.

import Foundation

/// JavaScript's `ToInt32` (`seed | 0`), kept as the unsigned 32-bit pattern:
/// truncate toward zero, wrap modulo 2³²; NaN and ±∞ are 0.
private func int32Bits(_ v: Double) -> UInt32 {
    guard v.isFinite else { return 0 }
    let whole = v.rounded(.towardZero)
    var m = whole.truncatingRemainder(dividingBy: 4294967296)
    if m < 0 { m += 4294967296 }
    return UInt32(m)
}

/// A generator of uniform draws in [0, 1), deterministic per seed. The seed is
/// a `Double` because the web's is a JSON number (`FilmTexture.seed`,
/// `Stagger.seed`); a fractional seed truncates as `| 0` does.
public func mulberry32(_ seed: Double) -> () -> Double {
    var s = int32Bits(seed)
    return {
        s = s &+ 0x6d2b_79f5
        var t = (s ^ (s >> 15)) &* (1 | s)
        t = (t &+ ((t ^ (t >> 7)) &* (61 | t))) ^ t
        return Double(t ^ (t >> 14)) / 4294967296
    }
}
