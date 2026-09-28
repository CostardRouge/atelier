// A LUT lattice as BYTES — the form a purchased look travels and is kept in.
// Port of `src/shared/lut/pack-codec.ts`, byte for byte: a lattice encoded
// here decodes in the browser and the reverse, and hashes to the same `blob`.
//
// 16-bit samples over the lattice's OWN measured value range: 1.65 MB for a
// 65³ look (a quarter of its `.cube` text), a step of `(max − min) / 65535`,
// and highlights past 1 survive because the range is written into the header
// rather than assumed. Half floats were weighed and are worse: their step at
// 1.0 is 1/1024, twenty times coarser for the same bytes.
//
// The layout, 40-byte header then samples:
//   magic "ATL1" (u32) · version (u8) · flags (u8) · size (u16) ·
//   domainMin (3 × f32) · domainMax (3 × f32) · valueMin (f32) · valueMax (f32)
// The header is BIG-endian (a `DataView`'s default on the web); the samples
// are LITTLE-endian, explicitly, on both sides. Quantisation is done against
// the header's f32 range as the decoder will read it, so the endpoints come
// back exact. A look carries TWO hashes (`media-pipeline.md`): the source
// `.cube`'s and this encoding's — `sha256Hex` is how either is taken.

import Foundation

/// `ATL1` — magic, so a truncated or foreign file is refused, not mis-read.
private let packMagic: UInt32 = 0x4154_4C31
private let packVersion: UInt8 = 1
/// magic(4) version(1) flags(1) size(2) domainMin(12) domainMax(12) valueMin(4) valueMax(4).
public let packHeaderBytes = 40
/// Sizes a `.cube` can declare; anything else is a file we refuse to invent a reading for.
private let minLatticeSize = 2
private let maxLatticeSize = 256

/// Why a lattice could not be encoded — the web's thrown message, verbatim.
public struct LatticeEncodeError: Error, Equatable, Sendable, CustomStringConvertible {
    public let message: String
    public var description: String { message }
}

/// Bytes an encoded lattice of this grid size takes, header included.
public func encodedBytes(_ size: Int) -> Int {
    packHeaderBytes + size * size * size * 3 * 2
}

// MARK: - byte writing and reading

private func putU16BE(_ out: inout [UInt8], _ at: Int, _ v: UInt16) {
    out[at] = UInt8(truncatingIfNeeded: v >> 8)
    out[at + 1] = UInt8(truncatingIfNeeded: v)
}

private func putU32BE(_ out: inout [UInt8], _ at: Int, _ v: UInt32) {
    out[at] = UInt8(truncatingIfNeeded: v >> 24)
    out[at + 1] = UInt8(truncatingIfNeeded: v >> 16)
    out[at + 2] = UInt8(truncatingIfNeeded: v >> 8)
    out[at + 3] = UInt8(truncatingIfNeeded: v)
}

private func putF32BE(_ out: inout [UInt8], _ at: Int, _ v: Double) {
    putU32BE(&out, at, Float(v).bitPattern)
}

private func u16BE(_ b: [UInt8], _ at: Int) -> UInt16 {
    (UInt16(b[at]) << 8) | UInt16(b[at + 1])
}

private func u16LE(_ b: [UInt8], _ at: Int) -> UInt16 {
    UInt16(b[at]) | (UInt16(b[at + 1]) << 8)
}

private func u32BE(_ b: [UInt8], _ at: Int) -> UInt32 {
    let b0 = UInt32(b[at]) << 24
    let b1 = UInt32(b[at + 1]) << 16
    let b2 = UInt32(b[at + 2]) << 8
    return b0 | b1 | b2 | UInt32(b[at + 3])
}

private func f32BE(_ b: [UInt8], _ at: Int) -> Double {
    Double(Float(bitPattern: u32BE(b, at)))
}

// MARK: - encode / decode

/// Encode a parsed cube. The value range is MEASURED, so a lattice that never
/// leaves [0,1] gets the whole 16-bit scale over [0,1] and one that overshoots
/// keeps its highlights. Throws for a lattice this format cannot hold.
public func encodeLattice(_ lut: CubeLut) throws -> [UInt8] {
    let size = lut.size
    let data = lut.data
    if size < minLatticeSize || size > maxLatticeSize {
        throw LatticeEncodeError(message: "A lattice of \(size) points is not one this format can hold.")
    }
    if data.count != size * size * size * 3 {
        throw LatticeEncodeError(message: "The lattice does not hold size³ triplets.")
    }

    var minValue = Double.infinity
    var maxValue = -Double.infinity
    for sample in data {
        let v = Double(sample)
        if !v.isFinite { throw LatticeEncodeError(message: "The lattice holds a value that is not a number.") }
        if v < minValue { minValue = v }
        if v > maxValue { maxValue = v }
    }
    // A flat lattice has no range to spread over: widening it by one keeps the
    // arithmetic free of a zero division and still reproduces the value
    // exactly, since every sample encodes to 0.
    if maxValue == minValue { maxValue = minValue + 1 }

    var out = [UInt8](repeating: 0, count: encodedBytes(size))
    putU32BE(&out, 0, packMagic)
    out[4] = packVersion
    out[5] = 0
    putU16BE(&out, 6, UInt16(size))
    putF32BE(&out, 8, lut.domainMin.0)
    putF32BE(&out, 12, lut.domainMin.1)
    putF32BE(&out, 16, lut.domainMin.2)
    putF32BE(&out, 20, lut.domainMax.0)
    putF32BE(&out, 24, lut.domainMax.1)
    putF32BE(&out, 28, lut.domainMax.2)
    putF32BE(&out, 32, minValue)
    putF32BE(&out, 36, maxValue)

    // Quantise against the values the DECODER will see (the header's f32s), or
    // the endpoints drift by the f32 rounding and min/max stop round-tripping.
    let lo = f32BE(out, 32)
    let hi = f32BE(out, 36)
    let scale = 65535 / (hi - lo)
    for i in 0..<data.count {
        // JavaScript's `Math.round`: a half goes toward +∞.
        let q = ((Double(data[i]) - lo) * scale + 0.5).rounded(.down)
        let clamped = q < 0 ? 0 : (q > 65535 ? 65535 : q)
        let v = UInt16(clamped)
        let at = packHeaderBytes + i * 2
        out[at] = UInt8(truncatingIfNeeded: v)
        out[at + 1] = UInt8(truncatingIfNeeded: v >> 8)
    }
    return out
}

/// Decode a lattice, or nil for anything this format cannot answer for — a
/// foreign file, a version from the future, a truncated body — because a cube
/// read wrong would grade every picture silently and wrongly. The title is
/// the caller's, never the bytes'.
public func decodeLattice(_ bytes: [UInt8], title: String? = nil) -> CubeLut? {
    if bytes.count < packHeaderBytes { return nil }
    if u32BE(bytes, 0) != packMagic { return nil }
    if bytes[4] != packVersion { return nil }

    let size = Int(u16BE(bytes, 6))
    if size < minLatticeSize || size > maxLatticeSize { return nil }
    let count = size * size * size * 3
    if bytes.count < packHeaderBytes + count * 2 { return nil }

    let domainMin = (f32BE(bytes, 8), f32BE(bytes, 12), f32BE(bytes, 16))
    let domainMax = (f32BE(bytes, 20), f32BE(bytes, 24), f32BE(bytes, 28))
    let lo = f32BE(bytes, 32)
    let hi = f32BE(bytes, 36)
    if !lo.isFinite || !hi.isFinite || hi <= lo { return nil }

    let step = (hi - lo) / 65535
    var data = [Float](repeating: 0, count: count)
    for i in 0..<count {
        let q = Double(u16LE(bytes, packHeaderBytes + i * 2))
        data[i] = Float(lo + q * step)
    }
    return CubeLut(size: size, data: data, title: title, domainMin: domainMin, domainMax: domainMax)
}

/// The same, from a `Data` — a slice of a larger body included, whose indices
/// need not start at zero.
public func decodeLattice(_ bytes: Data, title: String? = nil) -> CubeLut? {
    decodeLattice([UInt8](bytes), title: title)
}

/// The SHA-256 of some bytes, lowercase hex — what a look is keyed on in the
/// vault (the SOURCE file's bytes, never its name) and in the file store (the
/// ENCODED lattice's bytes, `PackLook.blob`).
public func sha256Hex(_ bytes: [UInt8]) -> String {
    SHA256.hex(SHA256.digest(bytes))
}

public func sha256Hex(_ bytes: Data) -> String {
    sha256Hex([UInt8](bytes))
}
