// The one colour conversion a hook's paint needs: a stored `#rrggbb` to an
// `rgba()` at some alpha. Port of `src/shared/roadtrip/hooks/colour.ts`.
//
// An unreadable value paints white rather than throwing mid-frame. The app's
// paint takes the channels (`hexRgb`) rather than the CSS string; the string
// is kept byte for byte so a value written by either client reads the same.

import Foundation

/// The 0–255 channels of a `#rrggbb` (either case), or white for anything else.
public func hexRgb(_ hex: String) -> (r: Int, g: Int, b: Int) {
    let bytes = Array(hex.utf8)
    func nibble(_ c: UInt8) -> Int? {
        switch c {
        case 48...57: return Int(c) - 48
        case 65...70: return Int(c) - 55
        case 97...102: return Int(c) - 87
        default: return nil
        }
    }
    guard bytes.count == 7, bytes[0] == UInt8(ascii: "#") else { return (255, 255, 255) }
    var channels: [Int] = []
    for i in stride(from: 1, to: 7, by: 2) {
        guard let hi = nibble(bytes[i]), let lo = nibble(bytes[i + 1]) else { return (255, 255, 255) }
        channels.append(hi * 16 + lo)
    }
    return (channels[0], channels[1], channels[2])
}

/// `rgba(r,g,b,a)` with the alpha clamped to 0..1 and written as JavaScript
/// writes a number (`0.5`, `1`).
public func hexToRgba(_ hex: String, _ alpha: Double) -> String {
    let c = hexRgb(hex)
    // `Math.max(0, Math.min(1, alpha))`: a NaN survives both and prints as `NaN`.
    let a = alpha.isNaN ? alpha : max(0, min(1, alpha))
    return "rgba(\(c.r),\(c.g),\(c.b),\(TripJS.number(a)))"
}
