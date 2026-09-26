// The colour space a delivered JPEG is IN, said inside it — port of
// `src/shared/exif/icc-srgb.ts`.
//
// A compact ICC v4 sRGB profile, and the `APP2` segment that carries it
// (`docs/lightroom-gaps.md` §4, item 25). Every export used to be untagged
// sRGB; most readers assume sRGB for an untagged file, but a colour-managed
// one need not — Lightroom, Capture One, Preview on a P3 screen, a print lab —
// and "untagged" is a guess the reader is free to make otherwise. The pixels
// this suite writes ARE sRGB, so the tag changes no pixel and removes the
// guess.
//
// The rules it keeps from the web module:
// - Built from its numbers rather than shipped as a blob: 520 bytes, the
//   shape of the well-known compact v4 sRGB profiles — the Bradford-adapted
//   primaries, a D50 white, the `chad` a v4 profile requires, and ONE
//   parametric curve (the sRGB function, type 3) shared by the three
//   channels. The creation date is fixed, so the bytes are the same every
//   time they are built. The web checked it against LittleCMS as an identity
//   to IEC 61966-2.1; a change to the numbers is checked the same way.
// - `withIccProfile` keeps ONE profile, in an `APP2` placed after the leading
//   `APP0`/`APP1` segments (JFIF, EXIF, XMP) — where readers and the Ultra HDR
//   container expect it. A profile already there is replaced.
//
// The JPEG-level functions take `[UInt8]` and `Data`; the errors are
// `ExifBlock.swift`'s `JpegSegmentError`.

import Foundation

/// `ICC_PROFILE\0` — the identifier an `APP2` opens with when it holds a profile.
private let iccId: [UInt8] = Array("ICC_PROFILE\0".utf8)

private let markerAPP2: UInt8 = 0xe2

/// JS `ToUint32`, for a `s15Fixed16` written as `>>> 0`.
private func jsUint32Bits(_ value: Double) -> UInt32 {
    guard value.isFinite else { return 0 }
    let truncated = value.rounded(.towardZero)
    let modulo = truncated.truncatingRemainder(dividingBy: 4_294_967_296)
    let positive = modulo < 0 ? modulo + 4_294_967_296 : modulo
    return UInt32(positive)
}

/// `s15Fixed16Number`: the value times 65536, rounded as JS rounds.
private func s15(_ v: Double) -> Double {
    ExifText.jsRound(v * 65536)
}

/// The web's `Writer`: big-endian, as ICC is.
private struct IccWriter {
    var bytes: [UInt8] = []

    mutating func u8(_ v: Int) { bytes.append(UInt8(truncatingIfNeeded: v)) }

    mutating func u16(_ v: Int) {
        u8(v >> 8)
        u8(v)
    }

    mutating func u32(_ v: UInt32) {
        u16(Int((v >> 16) & 0xffff))
        u16(Int(v & 0xffff))
    }

    mutating func s15f16(_ v: Double) { u32(jsUint32Bits(s15(v))) }

    mutating func tag(_ sig: String) {
        for c in sig.utf8 { u8(Int(c)) }
    }
}

private func xyz(_ x: Double, _ y: Double, _ z: Double) -> [UInt8] {
    var w = IccWriter()
    w.tag("XYZ ")
    w.u32(0)
    w.s15f16(x)
    w.s15f16(y)
    w.s15f16(z)
    return w.bytes
}

/// A multi-localised string with one English record.
private func mluc(_ text: String) -> [UInt8] {
    var w = IccWriter()
    w.tag("mluc")
    w.u32(0)
    w.u32(1) // one record
    w.u32(12) // record size
    w.tag("en")
    w.tag("US")
    w.u32(UInt32(text.utf16.count * 2))
    w.u32(28) // offset from the tag's start to the string
    for c in text.utf16 { w.u16(Int(c)) }
    return w.bytes
}

/// The sRGB transfer function as a parametric curve, type 3.
private func srgbCurve() -> [UInt8] {
    var w = IccWriter()
    w.tag("para")
    w.u32(0)
    w.u16(3)
    w.u16(0)
    w.s15f16(2.4) // g
    w.s15f16(1 / 1.055) // a
    w.s15f16(0.055 / 1.055) // b
    w.s15f16(1 / 12.92) // c
    w.s15f16(0.04045) // d
    return w.bytes
}

private func sf32(_ values: [Double]) -> [UInt8] {
    var w = IccWriter()
    w.tag("sf32")
    w.u32(0)
    for v in values { w.s15f16(v) }
    return w.bytes
}

/// One tag's body, and whether it is the curve the three channels share.
private struct IccTag {
    var sig: String
    var body: [UInt8]
    var isCurve: Bool
}

/// The profile. Primaries are sRGB's D65 primaries adapted to D50 by Bradford,
/// as ICC requires of a display profile's colorants; `chad` is that same
/// adaptation, so a reader can undo it.
public func srgbProfile() -> [UInt8] {
    let curve = srgbCurve()
    // Bradford D65 → D50, the matrix every compact v4 sRGB profile carries.
    let chad: [Double] = [1.0479, 0.0229, -0.0502, 0.0296, 0.9904, -0.0171, -0.0092, 0.0151, 0.7519]
    let tags: [IccTag] = [
        IccTag(sig: "desc", body: mluc("sRGB"), isCurve: false),
        IccTag(sig: "cprt", body: mluc("No copyright, use freely"), isCurve: false),
        IccTag(sig: "wtpt", body: xyz(0.9642, 1, 0.8249), isCurve: false),
        IccTag(sig: "chad", body: sf32(chad), isCurve: false),
        IccTag(sig: "rXYZ", body: xyz(0.4361, 0.2225, 0.0139), isCurve: false),
        IccTag(sig: "gXYZ", body: xyz(0.3851, 0.7169, 0.0971), isCurve: false),
        IccTag(sig: "bXYZ", body: xyz(0.1431, 0.0606, 0.7141), isCurve: false),
        IccTag(sig: "rTRC", body: curve, isCurve: true),
        IccTag(sig: "gTRC", body: curve, isCurve: true),
        IccTag(sig: "bTRC", body: curve, isCurve: true),
    ]

    // Lay out the data: the three curves are one block, shared.
    let tableSize = 4 + tags.count * 12
    let offset = 128 + tableSize
    var placed: [(sig: String, offset: Int, size: Int)] = []
    var data: [UInt8] = []
    var curveAt = -1
    for tag in tags {
        if tag.isCurve && curveAt >= 0 {
            placed.append((tag.sig, curveAt, tag.body.count))
            continue
        }
        let at = offset + data.count
        if tag.isCurve { curveAt = at }
        placed.append((tag.sig, at, tag.body.count))
        data += tag.body
        while data.count % 4 != 0 { data.append(0) }
    }
    let size = offset + data.count

    var w = IccWriter()
    // --- header, 128 bytes ---
    w.u32(UInt32(size))
    w.u32(0) // preferred CMM: none
    w.u32(0x0430_0000) // version 4.3
    w.tag("mntr")
    w.tag("RGB ")
    w.tag("XYZ ")
    // Creation date: fixed, so the bytes are the same every time they are built.
    for v in [2026, 9, 23, 0, 0, 0] { w.u16(v) }
    w.tag("acsp")
    w.u32(0) // platform
    w.u32(0) // flags
    w.u32(0) // manufacturer
    w.u32(0) // model
    w.u32(0) // attributes (8 bytes)
    w.u32(0)
    w.u32(0) // rendering intent: perceptual
    w.s15f16(0.9642) // PCS illuminant, D50
    w.s15f16(1)
    w.s15f16(0.8249)
    w.u32(0) // creator
    for _ in 0..<16 { w.u8(0) } // profile ID: optional, left zero
    while w.bytes.count < 128 { w.u8(0) }
    // --- tag table ---
    w.u32(UInt32(placed.count))
    for p in placed {
        w.tag(p.sig)
        w.u32(UInt32(p.offset))
        w.u32(UInt32(p.size))
    }
    w.bytes += data
    precondition(w.bytes.count == size, "ICC profile laid out as \(w.bytes.count) bytes, declared \(size)")
    return w.bytes
}

private let cachedSrgbIcc: [UInt8] = srgbProfile()

/// The one profile, built once.
public func srgbIcc() -> [UInt8] { cachedSrgbIcc }

private func isJpegBytes(_ bytes: [UInt8]) -> Bool {
    bytes.count > 4 && bytes[0] == 0xff && bytes[1] == 0xd8
}

private func holdsIcc(_ bytes: [UInt8], _ at: Int, _ end: Int) -> Bool {
    if bytes[at + 1] != markerAPP2 || at + 4 + iccId.count > end { return false }
    for (i, b) in iccId.enumerated() where bytes[at + 4 + i] != b { return false }
    return true
}

/// The web's `subarray(from, to)`: a slice that clamps rather than traps.
private func slice(_ bytes: [UInt8], _ from: Int, _ to: Int) -> ArraySlice<UInt8> {
    let lo = min(max(from, 0), bytes.count)
    let hi = min(max(to, lo), bytes.count)
    return bytes[lo..<hi]
}

/// The same JPEG carrying `profile` as its ONE ICC profile, in an `APP2` placed
/// after the leading `APP0`/`APP1` segments (JFIF, EXIF, XMP) — where readers
/// and the Ultra HDR container expect it. A profile already there is replaced.
public func withIccProfile(_ jpeg: [UInt8], _ profile: [UInt8] = srgbIcc()) throws -> [UInt8] {
    if !isJpegBytes(jpeg) { throw JpegSegmentError.notAJpeg }
    if profile.count + iccId.count + 4 > 0xffff {
        throw JpegSegmentError.oversized(what: "ICC profile", bytes: profile.count, max: 0xffff - 4 - iccId.count)
    }
    var keep: [(start: Int, end: Int)] = []
    var insertAt = 2
    var at = 2
    var leading = true
    while at + 4 <= jpeg.count && jpeg[at] == 0xff {
        let marker = jpeg[at + 1]
        if marker == 0xda || marker == 0xd9 { break }
        let length = (Int(jpeg[at + 2]) << 8) | Int(jpeg[at + 3])
        let end = at + 2 + length
        if length < 2 || end > jpeg.count { break }
        if holdsIcc(jpeg, at, end) {
            keep.append((at, end))
        } else if leading && (marker == 0xe0 || marker == 0xe1) {
            insertAt = end
        } else {
            leading = false
        }
        at = end
    }
    let body = iccId.count + 2 + profile.count
    var segment: [UInt8] = [0xff, markerAPP2, UInt8(((body + 2) >> 8) & 0xff), UInt8((body + 2) & 0xff)]
    segment.reserveCapacity(4 + body)
    segment += iccId
    segment.append(1) // sequence number
    segment.append(1) // of one
    segment += profile

    // The file without any old profile, the new one spliced at the insertion point.
    var out: [UInt8] = []
    out.reserveCapacity(jpeg.count + segment.count)
    var cursor = 0
    var placed = false
    let cuts = keep.sorted { $0.start < $1.start }
    for cut in cuts {
        if !placed && insertAt <= cut.start {
            out += slice(jpeg, cursor, insertAt)
            out += segment
            cursor = insertAt
            placed = true
        }
        out += slice(jpeg, cursor, cut.start)
        cursor = cut.end
    }
    if !placed {
        out += slice(jpeg, cursor, max(cursor, insertAt))
        out += segment
        cursor = max(cursor, insertAt)
    }
    out += slice(jpeg, cursor, jpeg.count)
    return out
}

public func withIccProfile(_ jpeg: Data, _ profile: [UInt8] = srgbIcc()) throws -> Data {
    Data(try withIccProfile([UInt8](jpeg), profile))
}

/// The ICC profile inside a JPEG, or nil — for a check that the file says what was written.
public func readIccProfile(_ jpeg: [UInt8]) -> [UInt8]? {
    if !isJpegBytes(jpeg) { return nil }
    var at = 2
    while at + 4 <= jpeg.count && jpeg[at] == 0xff {
        let marker = jpeg[at + 1]
        if marker == 0xda || marker == 0xd9 { break }
        let length = (Int(jpeg[at + 2]) << 8) | Int(jpeg[at + 3])
        let end = at + 2 + length
        if length < 2 || end > jpeg.count { break }
        if holdsIcc(jpeg, at, end) { return Array(slice(jpeg, at + 4 + iccId.count + 2, end)) }
        at = end
    }
    return nil
}

public func readIccProfile(_ jpeg: Data) -> [UInt8]? { readIccProfile([UInt8](jpeg)) }
