// The EXIF block as BYTES — port of `src/shared/exif/exif-block.ts`.
//
// Taking the block out of a JPEG, correcting the few tags a development
// invalidates, and putting it back into another JPEG. This is the path that
// keeps EVERYTHING — the maker notes, the lens corrections a body writes, the
// fields no struct here models — because it never interprets the block, it
// moves it. `ExifBuild.swift` is the other path, for an original whose block
// cannot be moved (a DNG, whose TIFF stream is the whole file) or that has
// none (a WebP proxy).
//
// The rules it keeps from the web module:
// - `retagExifBlock` corrects these tags and only these: **Orientation** to 1
//   (the delivered picture is already the way up it was looked at — the one
//   correction that is not optional); the **pixel dimensions** to the
//   delivered ones where the entry can hold them; the **thumbnail** cut loose
//   by zeroing the next-IFD pointer (its bytes stay, unreferenced); and the
//   text tags — `Software`, `Artist`, `Copyright`, `ImageDescription` —
//   written over the camera's entry where it is wide enough, cleared to NULs
//   where the author asked for none, and otherwise ADDED by copying IFD0 to
//   the end of the block with the entry in tag order and the header repointed
//   at the copy. Every pointed value stays where it was, offsets being
//   absolute, so nothing else in the block moves.
// - A block the retagger cannot make sense of comes back unchanged rather
//   than half-written.
// - `withExifBlock` drops any EXIF `APP1` the JPEG had and puts the new one
//   right after the `SOI`, or after a leading JFIF `APP0`, which the format
//   keeps first; `withXmpPacket` keeps ONE packet, after the EXIF. Both throw
//   on a payload larger than a segment can hold (`u16` length) rather than
//   writing a file no reader can parse — the caller falls back to a block it
//   built itself, which is small by construction.
// - ASCII text is written as UTF-8 with its NUL (`ExifBuild.swift` says why).
//
// Bytes are `[UInt8]`; the JPEG-level functions also take and give `Data`.
// The reads go through `ByteView` (`ExifParser.swift`), the writes through
// the two little put helpers below.
//
// The segment walk is the web module's OWN (`headerSegments`), not
// `UltraHDR.swift`'s `jpegSegments`, deliberately: this one is LENIENT — it
// stops at the first thing that is not a marker, or a length that overruns
// the bytes, and keeps the segments it found before it — where the container's
// walk answers nil for the whole file. A head slice whose tail segment is cut
// short still gives its EXIF up here, as it does in the browser.

import Foundation

/// `Exif\0\0` — the six bytes an `APP1` segment opens with when it holds EXIF.
private let exifId: [UInt8] = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]

/// The most a block can be: a JPEG segment's length is a `u16` counting
/// itself, so 65535 minus the two length bytes and the six-byte identifier.
public let exifBlockMax = 0xffff - 2 - 6

/// `http://ns.adobe.com/xap/1.0/\0` — the identifier an `APP1` opens with when it holds an XMP packet.
private let xmpId: [UInt8] = Array("http://ns.adobe.com/xap/1.0/\0".utf8)

/// The most an XMP packet can be in one `APP1`: the segment's `u16` less its length bytes and the identifier.
public let xmpPacketMax = 0xffff - 2 - 29

private let markerSOI: UInt8 = 0xd8
private let markerSOS: UInt8 = 0xda
private let markerEOI: UInt8 = 0xd9
private let markerAPP0: UInt8 = 0xe0
private let markerAPP1: UInt8 = 0xe1

/// What the JPEG writers refuse — the web's two `throw`s, one type.
public enum JpegSegmentError: Error, Equatable, Sendable, CustomStringConvertible {
    /// The bytes do not open on a JPEG's `SOI`.
    case notAJpeg
    /// A payload larger than one segment holds: `what` is `bytes` long, over `max`.
    case oversized(what: String, bytes: Int, max: Int)

    public var description: String {
        switch self {
        case .notAJpeg:
            return "not a JPEG"
        case .oversized(let what, let bytes, let max):
            return "the \(what) is \(bytes) bytes, over the \(max) a segment holds"
        }
    }
}

/// The web's `string | null | undefined` on an author's text tag, as the
/// writers take it: a string WRITES it, null CLEARS what the capture carried,
/// undefined KEEPS it (`stamp-exif.ts`'s `AuthorTags`).
public enum AuthorTag: Equatable, Sendable {
    case keep
    case clear
    case write(String)

    /// The value to write over `capture`'s own: kept, cleared, or replaced.
    public func resolved(over capture: String?) -> String? {
        switch self {
        case .keep: return capture
        case .clear: return nil
        case .write(let text): return text
        }
    }
}

// MARK: - the segment walk

/// One header segment — the web's `Segment`.
private struct HeaderSegment {
    var marker: UInt8
    /// Where the `FF xx` starts.
    var start: Int
    /// One past the segment's last byte.
    var end: Int
    /// Where the payload starts — past the marker and the length.
    var body: Int
}

private func isJpegBytes(_ bytes: [UInt8]) -> Bool {
    bytes.count > 4 && bytes[0] == 0xff && bytes[1] == markerSOI
}

/// The segments before the scan, in order. Stops at `SOS` (pixels follow, and
/// a `FF` inside them is not a marker) and on anything that is not a marker.
private func headerSegments(_ bytes: [UInt8]) -> [HeaderSegment] {
    var out: [HeaderSegment] = []
    var at = 2
    while at + 4 <= bytes.count && bytes[at] == 0xff {
        let marker = bytes[at + 1]
        if marker == markerSOS || marker == markerEOI { break }
        // Standalone markers carry no length (padding, restarts, SOI again).
        if marker == 0x01 || (marker >= 0xd0 && marker <= 0xd8) {
            at += 2
            continue
        }
        let length = (Int(bytes[at + 2]) << 8) | Int(bytes[at + 3])
        if length < 2 { break }
        let end = at + 2 + length
        if end > bytes.count { break }
        out.append(HeaderSegment(marker: marker, start: at, end: end, body: at + 4))
        at = end
    }
    return out
}

/// Whether an `APP1` segment opens with `id` (`Exif\0\0` or the XMP namespace).
private func holdsId(_ bytes: [UInt8], _ segment: HeaderSegment, _ id: [UInt8]) -> Bool {
    if segment.marker != markerAPP1 || segment.body + id.count > bytes.count { return false }
    for (i, b) in id.enumerated() where bytes[segment.body + i] != b { return false }
    return true
}

/// An `APP1` segment around `body`: marker, a `u16` length counting itself, the identifier, the payload.
private func app1Segment(id: [UInt8], body: [UInt8]) -> [UInt8] {
    let length = body.count + id.count + 2
    var segment: [UInt8] = [0xff, markerAPP1, UInt8((length >> 8) & 0xff), UInt8(length & 0xff)]
    segment.reserveCapacity(length + 2)
    segment += id
    segment += body
    return segment
}

// MARK: - the EXIF segment

/// The TIFF block inside a JPEG's EXIF `APP1`, or nil when it carries none.
public func readExifBlock(_ jpeg: [UInt8]) -> [UInt8]? {
    if !isJpegBytes(jpeg) { return nil }
    for segment in headerSegments(jpeg) where holdsId(jpeg, segment, exifId) {
        return Array(jpeg[(segment.body + exifId.count)..<segment.end])
    }
    return nil
}

public func readExifBlock(_ jpeg: Data) -> [UInt8]? { readExifBlock([UInt8](jpeg)) }

/// The same JPEG carrying `block` as its EXIF: any EXIF `APP1` it already had
/// is dropped, and the new one goes in right after the `SOI` — or after a
/// leading JFIF `APP0`, which the format says must come first.
///
/// Throws when the block is larger than a segment can hold, rather than
/// writing a file no reader can parse.
public func withExifBlock(_ jpeg: [UInt8], _ block: [UInt8]) throws -> [UInt8] {
    if !isJpegBytes(jpeg) { throw JpegSegmentError.notAJpeg }
    if block.count > exifBlockMax {
        throw JpegSegmentError.oversized(what: "EXIF block", bytes: block.count, max: exifBlockMax)
    }
    let segments = headerSegments(jpeg)
    let existing = segments.first { holdsId(jpeg, $0, exifId) }
    let leadingJfif = segments.first.flatMap { $0.marker == markerAPP0 ? $0 : nil }
    let insertAt = leadingJfif?.end ?? 2
    let segment = app1Segment(id: exifId, body: block)

    // Everything before the insertion point, the segment, then the rest minus
    // the EXIF segment that was there.
    var out: [UInt8] = []
    out.reserveCapacity(jpeg.count + segment.count)
    out += jpeg[0..<insertAt]
    out += segment
    if let existing, existing.start >= insertAt {
        out += jpeg[insertAt..<existing.start]
        out += jpeg[existing.end...]
    } else {
        out += jpeg[insertAt...]
    }
    return out
}

public func withExifBlock(_ jpeg: Data, _ block: [UInt8]) throws -> Data {
    Data(try withExifBlock([UInt8](jpeg), block))
}

// MARK: - retagging a copied block

/// The web's `RetagOptions`: what `retagExifBlock` corrects on the way.
public struct RetagOptions: Equatable, Sendable {
    /// The delivered picture's own size; left alone when not given (both are needed).
    public var pixelWidth: Double?
    public var pixelHeight: Double?
    /// What wrote the delivered file — its `Software`; left alone when nil, cleared when empty.
    public var software: String?
    /// The author's words over the capture's (`delivery-meta.ts`).
    public var artist: AuthorTag
    public var copyright: AuthorTag
    public var description: AuthorTag

    public init(
        pixelWidth: Double? = nil, pixelHeight: Double? = nil, software: String? = nil,
        artist: AuthorTag = .keep, copyright: AuthorTag = .keep, description: AuthorTag = .keep
    ) {
        self.pixelWidth = pixelWidth; self.pixelHeight = pixelHeight; self.software = software
        self.artist = artist; self.copyright = copyright; self.description = description
    }
}

private enum RetagTag {
    static let imageDescription = 0x010e
    static let orientation = 0x0112
    static let software = 0x0131
    static let artist = 0x013b
    static let copyright = 0x8298
    static let exifPointer = 0x8769
    static let pixelWidth = 0xa002
    static let pixelHeight = 0xa003
}

private let asciiType = 2

/// The web's `DataView.setUint16`: the low 16 bits, in the block's own order.
private func put16(_ bytes: inout [UInt8], _ at: Int, _ value: Int, little: Bool) {
    let u = UInt16(truncatingIfNeeded: value)
    let lo = UInt8(u & 0xff)
    let hi = UInt8(u >> 8)
    if little { bytes[at] = lo; bytes[at + 1] = hi } else { bytes[at] = hi; bytes[at + 1] = lo }
}

/// The web's `DataView.setUint32`: the low 32 bits, in the block's own order.
private func put32(_ bytes: inout [UInt8], _ at: Int, _ value: Int, little: Bool) {
    let u = UInt32(truncatingIfNeeded: value)
    for i in 0..<4 {
        let byte = UInt8((u >> (8 * UInt32(i))) & 0xff)
        bytes[at + (little ? i : 3 - i)] = byte
    }
}

/// JS `Math.round(x)` as the integer a `DataView` setter takes: NaN and the
/// infinities become 0, as `ToUint32` makes them.
private func roundedInt(_ value: Double) -> Int {
    let rounded = ExifText.jsRound(value)
    guard rounded.isFinite, rounded.magnitude < 1e15 else { return 0 }
    return Int(rounded)
}

/// Write `value` over an entry's own inline slot, when its type can hold it.
private func overwrite(_ out: inout [UInt8], _ entry: IfdEntry, _ value: Int, little: Bool) {
    if entry.type == 3, value <= 0xffff, entry.valueOffset >= 0, entry.valueOffset + 2 <= out.count {
        put16(&out, entry.valueOffset, value, little: little)
    } else if entry.type == 4, entry.valueOffset >= 0, entry.valueOffset + 4 <= out.count {
        put32(&out, entry.valueOffset, value, little: little)
    }
}

/// `text` as the bytes an ASCII entry holds: UTF-8, NUL-terminated — `ExifBuild.swift` says why.
private func asciiBytes(_ text: String) -> [UInt8] {
    Array(text.utf8) + [0]
}

/// Write `text` over an ASCII entry's own bytes, NUL-padded to the entry's
/// count, when the entry is an ASCII one wide enough to hold it. False when it
/// is not — the caller then has to add an entry instead. An empty `text`
/// leaves nothing but NULs, which every reader takes for no value.
private func overwriteAscii(_ out: inout [UInt8], _ entry: IfdEntry?, _ text: String) -> Bool {
    guard let entry, entry.type == asciiType else { return false }
    let bytes = asciiBytes(text)
    if entry.count < bytes.count || entry.valueOffset < 0 || entry.valueOffset + entry.count > out.count { return false }
    for i in 0..<entry.count { out[entry.valueOffset + i] = 0 }
    for (i, b) in bytes.enumerated() { out[entry.valueOffset + i] = b }
    return true
}

/// The block with IFD0 COPIED to its end, the given ASCII entries replaced or
/// added (kept in tag order, as the format asks), no IFD1, and the header
/// pointed at the copy. Entries are copied byte for byte, so an inline value
/// stays inline and a pointed one still points where it did. A directory that
/// runs past the block is left alone.
private func withIfd0Ascii(_ block: [UInt8], little: Bool, adds: [(tag: Int, text: String)]) -> [UInt8] {
    let view = ByteView(block)
    let ifd0At = Int(view.uint32(4, little: little))
    let count = Int(view.uint16(ifd0At, little: little))
    if ifd0At + 2 + count * 12 > block.count { return block }

    let added = Set(adds.map { $0.tag })
    var kept: [Int] = []
    for i in 0..<count {
        let at = ifd0At + 2 + i * 12
        if !added.contains(Int(view.uint16(at, little: little))) { kept.append(at) }
    }
    let values = adds.sorted { $0.tag < $1.tag }.map { (tag: $0.tag, bytes: asciiBytes($0.text)) }
    let total = kept.count + values.count
    // Word-aligned, as TIFF asks of every offset.
    let dirAt = block.count + (block.count & 1)
    var valueAt = dirAt + 2 + total * 12 + 4
    let outOf = values.reduce(0) { sum, v in
        sum + (v.bytes.count > 4 ? v.bytes.count + (v.bytes.count & 1) : 0)
    }
    var out = [UInt8](repeating: 0, count: valueAt + outOf)
    out.replaceSubrange(0..<block.count, with: block)
    put32(&out, 4, dirAt, little: little)
    put16(&out, dirAt, total, little: little)

    var at = dirAt + 2
    var next = 0
    func place(_ v: (tag: Int, bytes: [UInt8])) {
        put16(&out, at, v.tag, little: little)
        put16(&out, at + 2, asciiType, little: little)
        put32(&out, at + 4, v.bytes.count, little: little)
        if v.bytes.count <= 4 {
            for (i, b) in v.bytes.enumerated() { out[at + 8 + i] = b }
        } else {
            put32(&out, at + 8, valueAt, little: little)
            for (i, b) in v.bytes.enumerated() { out[valueAt + i] = b }
            valueAt += v.bytes.count + (v.bytes.count & 1)
        }
        at += 12
    }
    for src in kept {
        let tag = Int(view.uint16(src, little: little))
        while next < values.count && values[next].tag < tag {
            place(values[next])
            next += 1
        }
        for i in 0..<12 { out[at + i] = block[src + i] }
        at += 12
    }
    while next < values.count {
        place(values[next])
        next += 1
    }
    put32(&out, at, 0, little: little)
    return out
}

/// A COPY of `block` with the orientation reset, the dimensions corrected, the
/// thumbnail cut loose and the software named. A block it cannot make sense
/// of comes back unchanged rather than half-written.
public func retagExifBlock(_ block: [UInt8], _ options: RetagOptions = RetagOptions()) -> [UInt8] {
    var out = block
    if out.count < 8 { return out }
    let view = ByteView(out)
    let order = view.uint16(0)
    if order != 0x4949 && order != 0x4d4d { return out }
    let little = order == 0x4949
    if view.uint16(2, little: little) != 42 { return out }
    let ifd0At = Int(view.uint32(4, little: little))
    if ifd0At + 2 > out.count { return out }

    let ifd0 = view.parseIfd(tiffStart: 0, ifdOffset: ifd0At, little: little)
    if let orientation = ifd0[RetagTag.orientation] { overwrite(&out, orientation, 1, little: little) }

    if let pixelWidth = options.pixelWidth, let pixelHeight = options.pixelHeight {
        if let pointer = view.num(ifd0[RetagTag.exifPointer], little: little),
           pointer >= 0, pointer + 2 <= Double(out.count) {
            let exifIfd = view.parseIfd(tiffStart: 0, ifdOffset: Int(pointer), little: little)
            if let w = exifIfd[RetagTag.pixelWidth] { overwrite(&out, w, roundedInt(pixelWidth), little: little) }
            if let h = exifIfd[RetagTag.pixelHeight] { overwrite(&out, h, roundedInt(pixelHeight), little: little) }
        }
    }

    // IFD1 is the thumbnail's directory: cutting the link is what drops it.
    let count = Int(view.uint16(ifd0At, little: little))
    let nextAt = ifd0At + 2 + count * 12
    if nextAt + 4 <= out.count { put32(&out, nextAt, 0, little: little) }

    // The text tags: overwritten where the camera's entry can hold the new
    // words, cleared to NULs where the author asked for none, and ADDED — one
    // copy of IFD0 for all of them — where there was no entry or too small a one.
    var adds: [(tag: Int, text: String)] = []
    let software: AuthorTag = options.software.map { .write($0) } ?? .keep
    let texts: [(tag: Int, text: AuthorTag)] = [
        (RetagTag.software, software),
        (RetagTag.artist, options.artist),
        (RetagTag.copyright, options.copyright),
        (RetagTag.imageDescription, options.description),
    ]
    for (tag, text) in texts {
        let entry = ifd0[tag]
        switch text {
        case .keep:
            continue
        case .clear:
            _ = overwriteAscii(&out, entry, "")
        case .write(let value):
            if value.isEmpty {
                _ = overwriteAscii(&out, entry, "")
            } else if !overwriteAscii(&out, entry, value) {
                adds.append((tag, value))
            }
        }
    }
    return adds.isEmpty ? out : withIfd0Ascii(out, little: little, adds: adds)
}

// MARK: - the XMP segment

/// The XMP packet of a JPEG's main `APP1`, as text, or nil when it carries none.
public func readXmpPacket(_ jpeg: [UInt8]) -> String? {
    if !isJpegBytes(jpeg) { return nil }
    for segment in headerSegments(jpeg) where holdsId(jpeg, segment, xmpId) {
        var body = jpeg[(segment.body + xmpId.count)..<segment.end]
        // `TextDecoder` strips a leading byte-order mark; so does this.
        if body.count >= 3, body[body.startIndex] == 0xef, body[body.startIndex + 1] == 0xbb, body[body.startIndex + 2] == 0xbf {
            body = body.dropFirst(3)
        }
        return String(decoding: body, as: UTF8.self)
    }
    return nil
}

public func readXmpPacket(_ jpeg: Data) -> String? { readXmpPacket([UInt8](jpeg)) }

/// The same JPEG carrying `packet` as its ONE XMP: a packet already there is
/// dropped, and the new one goes right after the EXIF `APP1` (else after a
/// leading JFIF `APP0`, else after the `SOI`) — the order cameras write and
/// readers expect. Throws on a packet larger than a segment holds.
public func withXmpPacket(_ jpeg: [UInt8], _ packet: String) throws -> [UInt8] {
    if !isJpegBytes(jpeg) { throw JpegSegmentError.notAJpeg }
    let body = Array(packet.utf8)
    if body.count > xmpPacketMax {
        throw JpegSegmentError.oversized(what: "XMP packet", bytes: body.count, max: xmpPacketMax)
    }
    let segments = headerSegments(jpeg)
    let existing = segments.first { holdsId(jpeg, $0, xmpId) }
    let exif = segments.first { holdsId(jpeg, $0, exifId) }
    let afterJfif = segments.first.flatMap { $0.marker == markerAPP0 ? $0.end : nil }
    let insertAt = exif?.end ?? afterJfif ?? 2
    let segment = app1Segment(id: xmpId, body: body)

    // Cut the old packet out wherever it sat, then splice the new one in.
    var flat: [UInt8] = []
    flat.reserveCapacity(jpeg.count)
    if let existing {
        flat += jpeg[0..<existing.start]
        flat += jpeg[existing.end...]
    } else {
        flat = jpeg
    }
    var shift = 0
    if let existing, existing.start < insertAt { shift = existing.end - existing.start }
    let cut = min(max(insertAt - shift, 0), flat.count)
    var out: [UInt8] = []
    out.reserveCapacity(flat.count + segment.count)
    out += flat[0..<cut]
    out += segment
    out += flat[cut...]
    return out
}

public func withXmpPacket(_ jpeg: Data, _ packet: String) throws -> Data {
    Data(try withXmpPacket([UInt8](jpeg), packet))
}
