// ULTRA HDR JPEG — the container: an ordinary JPEG (the SDR base every
// decoder shows) carrying a second, small JPEG (the gain map, `GainMap.swift`)
// after its own EOI, joined by two pieces of metadata a viewer reads. Port of
// `src/shared/hdr/ultra-hdr.ts`, byte for byte:
//
// - an XMP packet in the base's APP1 — a GContainer `Directory` naming the
//   two items (Primary, GainMap with its byte `Length`) and `hdrgm:Version`;
// - an MPF (CIPA DC-007, "Multi-Picture Format") APP2 segment in the base,
//   a tiny big-endian TIFF whose second MP entry gives the map's size and its
//   offset FROM THE MP HEADER'S ENDIAN FIELD, not from the file's start — how
//   a viewer finds the second image without walking the first's entropy data;
// - an XMP packet in the gain map's own APP1 with the `hdrgm:` numbers
//   (`GainMapMin/Max`, `Gamma`, the offsets, the capacities).
//
// Written by hand, in the repo's own tradition, and READ back by the same
// module — `readUltraHdr` is what lets an export claim "Ultra HDR" only after
// the file it wrote says so. A base that already carries an XMP packet (the
// stamp's, written BEFORE the container — `docs/memory/hdr.md`) is taken out
// and its `rdf:Description`s folded into the container's packet, so the file
// carries ONE. Bytes in, bytes out: `Data` at the seams, arrays inside.

import Foundation

private let markerAPP0: UInt8 = 0xe0
private let markerAPP1: UInt8 = 0xe1
private let markerAPP2: UInt8 = 0xe2
private let markerSOS: UInt8 = 0xda
private let markerEOI: UInt8 = 0xd9

private let xmpHeader = "http://ns.adobe.com/xap/1.0/\0"
private let mpfHeader = "MPF\0"
private let hdrgmNS = "http://ns.adobe.com/hdr-gain-map/1.0/"
private let containerNS = "http://ns.google.com/photos/1.0/container/"
private let itemNS = "http://ns.google.com/photos/1.0/container/item/"

/// One marker segment of a JPEG before its scan: where it starts, its marker, its payload.
public struct JpegSegment: Equatable, Sendable {
    public let marker: UInt8
    /// The byte offset of the 0xFF.
    public let start: Int
    /// Marker + length + payload.
    public let length: Int
    /// The payload (after the two length bytes).
    public let data: Data

    public init(marker: UInt8, start: Int, length: Int, data: Data) {
        self.marker = marker; self.start = start; self.length = length; self.data = data
    }
}

public enum UltraHdrError: Error, Equatable {
    /// The web's `throw new Error('Not a JPEG.')`.
    case notJpeg
    /// The web's `throw new Error('A JPEG segment holds at most 65533 bytes.')`.
    case segmentTooLong

    public var message: String {
        switch self {
        case .notJpeg: return "Not a JPEG."
        case .segmentTooLong: return "A JPEG segment holds at most 65533 bytes."
        }
    }
}

// MARK: - bytes

/// The web's `ascii()`: each UTF-16 unit's low byte.
private func ascii(_ s: String) -> [UInt8] {
    s.utf16.map { UInt8(truncatingIfNeeded: $0) }
}

private func utf8(_ s: String) -> [UInt8] {
    Array(s.utf8)
}

/// The web's `text()`: UTF-8, an invalid sequence replaced as `TextDecoder` replaces it.
private func text<C: Collection>(_ bytes: C) -> String where C.Element == UInt8 {
    String(decoding: bytes, as: UTF8.self)
}

private func startsWith<C: RandomAccessCollection>(_ bytes: C, _ head: String) -> Bool where C.Element == UInt8, C.Index == Int {
    let units = Array(head.utf16)
    if bytes.count < units.count { return false }
    var i = bytes.startIndex
    for unit in units {
        if bytes[i] != UInt8(truncatingIfNeeded: unit) { return false }
        i += 1
    }
    return true
}

private func segmentsOf(_ bytes: [UInt8]) -> [JpegSegment]? {
    if bytes.count < 4 || bytes[0] != 0xff || bytes[1] != 0xd8 { return nil }
    var out: [JpegSegment] = []
    var offset = 2
    while offset + 4 <= bytes.count {
        if bytes[offset] != 0xff { return nil }
        let marker = bytes[offset + 1]
        if marker == markerSOS || marker == markerEOI { break }
        // A stand-alone marker (RSTn, TEM) has no length; none precedes the scan
        // in a file a browser writes, but a walk must not misread one.
        if marker == 0x01 || (marker >= 0xd0 && marker <= 0xd7) {
            offset += 2
            continue
        }
        let len = Int(bytes[offset + 2]) << 8 | Int(bytes[offset + 3])
        if len < 2 || offset + 2 + len > bytes.count { return nil }
        let payload = Data(bytes[(offset + 4)..<(offset + 2 + len)])
        out.append(JpegSegment(marker: marker, start: offset, length: 2 + len, data: payload))
        offset += 2 + len
    }
    return out
}

/// The segments up to (not including) SOS, or nil when the bytes are not a JPEG.
public func jpegSegments(_ bytes: Data) -> [JpegSegment]? {
    segmentsOf([UInt8](bytes))
}

/// A marker segment: FF marker, big-endian length (payload + 2), payload.
private func segmentBytes(_ marker: UInt8, _ payload: [UInt8]) throws -> [UInt8] {
    let len = payload.count + 2
    if len > 0xffff { throw UltraHdrError.segmentTooLong }
    var out = [UInt8](repeating: 0, count: 2 + len)
    out[0] = 0xff
    out[1] = marker
    out[2] = UInt8(len >> 8)
    out[3] = UInt8(len & 0xff)
    out.replaceSubrange(4..<(4 + payload.count), with: payload)
    return out
}

/// A marker segment: FF marker, big-endian length (payload + 2), payload.
public func makeSegment(_ marker: UInt8, _ payload: Data) throws -> Data {
    Data(try segmentBytes(marker, [UInt8](payload)))
}

// MARK: - the XMP packets

private func xmpPacket(_ description: String) -> String {
    "<?xpacket begin=\"\u{FEFF}\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?>"
        + "<x:xmpmeta xmlns:x=\"adobe:ns:meta/\" x:xmptk=\"Atelier\">"
        + "<rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">"
        + description
        + "</rdf:RDF></x:xmpmeta><?xpacket end=\"w\"?>"
}

/// The base image's XMP: the container directory and the version, and —
/// folded in beside them — the `rdf:Description`s a packet already in the base
/// carried (`extra`): the signature and the author's words a delivered picture
/// is stamped with before the container is written. One packet, because two
/// in one file is what readers disagree about.
public func primaryXmp(_ gainMapLength: Int, extra: String = "") -> String {
    let open = "<rdf:Description rdf:about=\"\" xmlns:Container=\"\(containerNS)\" xmlns:Item=\"\(itemNS)\""
        + " xmlns:hdrgm=\"\(hdrgmNS)\" hdrgm:Version=\"1.0\">"
    let primary = "<rdf:li rdf:parseType=\"Resource\"><Container:Item Item:Semantic=\"Primary\" Item:Mime=\"image/jpeg\"/></rdf:li>"
    let gainMap = "<rdf:li rdf:parseType=\"Resource\"><Container:Item Item:Semantic=\"GainMap\" Item:Mime=\"image/jpeg\""
        + " Item:Length=\"\(gainMapLength)\"/></rdf:li>"
    return xmpPacket(
        extra + open
            + "<Container:Directory><rdf:Seq>" + primary + gainMap + "</rdf:Seq></Container:Directory>"
            + "</rdf:Description>"
    )
}

/// The gain map's XMP: the numbers a viewer applies it with.
public func gainMapXmp(_ meta: GainMapMeta) -> String {
    let num = HdrNumberFormat.xmpNumber
    let range = " hdrgm:GainMapMin=\"\(num(meta.gainMapMin))\" hdrgm:GainMapMax=\"\(num(meta.gainMapMax))\""
    let shape = " hdrgm:Gamma=\"\(num(meta.gamma))\" hdrgm:OffsetSDR=\"\(num(meta.offsetSdr))\" hdrgm:OffsetHDR=\"\(num(meta.offsetHdr))\""
    let capacity = " hdrgm:HDRCapacityMin=\"\(num(meta.hdrCapacityMin))\" hdrgm:HDRCapacityMax=\"\(num(meta.hdrCapacityMax))\""
    return xmpPacket(
        "<rdf:Description rdf:about=\"\" xmlns:hdrgm=\"\(hdrgmNS)\" hdrgm:Version=\"1.0\""
            + range + shape + capacity + " hdrgm:BaseRenditionIsHDR=\"False\"/>"
    )
}

private func xmpSegment(_ packet: String) throws -> [UInt8] {
    try segmentBytes(markerAPP1, ascii(xmpHeader) + utf8(packet))
}

// MARK: - the MPF segment

/// Where the MP entries' offsets are counted from: the endian field, past "MPF\0".
private let mpHeaderInSegment = 2 + 2 + 4
/// The MPF payload: "MPF\0" + TIFF header (8) + IFD (2 + 3×12 + 4) + two 16-byte entries.
private let mpfPayloadLength = 4 + 8 + 2 + 3 * 12 + 4 + 2 * 16
public let mpfSegmentLength = 4 + mpfPayloadLength

private func put16(_ buffer: inout [UInt8], _ at: Int, _ v: Int) {
    buffer[at] = UInt8((v >> 8) & 0xff)
    buffer[at + 1] = UInt8(v & 0xff)
}

private func put32(_ buffer: inout [UInt8], _ at: Int, _ v: Int) {
    buffer[at] = UInt8((v >> 24) & 0xff)
    buffer[at + 1] = UInt8((v >> 16) & 0xff)
    buffer[at + 2] = UInt8((v >> 8) & 0xff)
    buffer[at + 3] = UInt8(v & 0xff)
}

private func putAscii(_ buffer: inout [UInt8], _ at: Int, _ s: String) {
    let bytes = ascii(s)
    buffer.replaceSubrange(at..<(at + bytes.count), with: bytes)
}

/// The MPF APP2 segment for a base image and one secondary: big-endian, three
/// IFD entries (version, count, the entry table), the two entries.
/// `secondaryOffset` is the secondary's distance from the MP header's endian
/// field; the primary's is 0 by definition.
public func mpfSegment(primarySize: Int, secondarySize: Int, secondaryOffset: Int) -> Data {
    var payload = [UInt8](repeating: 0, count: mpfPayloadLength)
    putAscii(&payload, 0, mpfHeader)
    var at = 4
    // TIFF header: "MM", 42, first IFD at 8.
    putAscii(&payload, at, "MM")
    put16(&payload, at + 2, 0x002a)
    put32(&payload, at + 4, 8)
    at += 8
    put16(&payload, at, 3)
    at += 2
    // MPFVersion, UNDEFINED ×4, "0100".
    put16(&payload, at, 0xb000)
    put16(&payload, at + 2, 7)
    put32(&payload, at + 4, 4)
    putAscii(&payload, at + 8, "0100")
    at += 12
    // NumberOfImages, LONG ×1.
    put16(&payload, at, 0xb001)
    put16(&payload, at + 2, 4)
    put32(&payload, at + 4, 1)
    put32(&payload, at + 8, 2)
    at += 12
    // MPEntry, UNDEFINED ×32, at the offset right after this IFD.
    let entriesAt = 8 + 2 + 3 * 12 + 4
    put16(&payload, at, 0xb002)
    put16(&payload, at + 2, 7)
    put32(&payload, at + 4, 32)
    put32(&payload, at + 8, entriesAt)
    at += 12
    put32(&payload, at, 0) // no next IFD
    at += 4
    // Entry 1: the primary — "Baseline MP Primary Image", JPEG.
    put32(&payload, at, 0x030000)
    put32(&payload, at + 4, primarySize)
    put32(&payload, at + 8, 0)
    put16(&payload, at + 12, 0)
    put16(&payload, at + 14, 0)
    at += 16
    // Entry 2: the gain map — an undefined type, JPEG.
    put32(&payload, at, 0x000000)
    put32(&payload, at + 4, secondarySize)
    put32(&payload, at + 8, secondaryOffset)
    put16(&payload, at + 12, 0)
    put16(&payload, at + 14, 0)
    // The payload is 86 bytes by construction: the length check cannot fail.
    return Data((try? segmentBytes(markerAPP2, payload)) ?? [])
}

/// The second image's size and offset (from the MP header) out of an MPF segment.
public struct MpfSecondary: Equatable, Sendable {
    public let size: Int
    public let offset: Int
    /// Where the MP header (the endian field) sits in the payload.
    public let headerAt: Int

    public init(size: Int, offset: Int, headerAt: Int) {
        self.size = size; self.offset = offset; self.headerAt = headerAt
    }
}

/// The second image's size and offset (from the MP header) out of an MPF segment's payload, or nil.
public func parseMpf(_ payload: Data) -> MpfSecondary? {
    let p = [UInt8](payload)
    if !startsWith(p, mpfHeader) { return nil }
    let headerAt = 4
    let n = p.count - headerAt
    if n < 8 { return nil }
    func u16(_ at: Int, _ little: Bool) -> Int {
        let a = Int(p[headerAt + at])
        let b = Int(p[headerAt + at + 1])
        return little ? (b << 8 | a) : (a << 8 | b)
    }
    func u32(_ at: Int, _ little: Bool) -> Int {
        let lo = u16(at, little)
        let hi = u16(at + 2, little)
        return little ? (hi << 16 | lo) : (lo << 16 | hi)
    }
    let order = u16(0, false)
    let little = order == 0x4949
    if !little && order != 0x4d4d { return nil }
    let ifd = u32(4, little)
    if ifd + 2 > n { return nil }
    let count = u16(ifd, little)
    var entriesAt = -1
    var images = 0
    for i in 0..<count {
        let e = ifd + 2 + i * 12
        if e + 12 > n { return nil }
        let tag = u16(e, little)
        if tag == 0xb001 { images = u32(e + 8, little) }
        if tag == 0xb002 { entriesAt = u32(e + 8, little) }
    }
    if entriesAt < 0 || images < 2 { return nil }
    for i in 0..<images {
        let e = entriesAt + i * 16
        if e + 16 > n { return nil }
        let offset = u32(e + 8, little)
        if offset == 0 { continue } // the primary
        return MpfSecondary(size: u32(e + 4, little), offset: offset, headerAt: headerAt)
    }
    return nil
}

// MARK: - writing the file

/// Where new APP segments go: after SOI and the leading APP0/APP1 a browser or a camera wrote.
private func insertionPoint(_ bytes: [UInt8]) throws -> Int {
    guard let segments = segmentsOf(bytes) else { throw UltraHdrError.notJpeg }
    var at = 2
    for s in segments {
        if s.marker != markerAPP0 && s.marker != markerAPP1 { break }
        at = s.start + s.length
    }
    return at
}

/// A JavaScript `\b` after a word: the next character is not `[A-Za-z0-9_]`.
private func isWordChar(_ c: Character) -> Bool {
    c.isASCII && (c.isLetter || c.isNumber || c == "_")
}

/// The `rdf:Description`s of an XMP packet, verbatim, or "" — what is folded
/// into the container's own. The web's `/<rdf:RDF\b[^>]*>/` + the LAST `</rdf:RDF>`.
private func descriptionsOf(_ packet: String) -> String {
    var searchFrom = packet.startIndex
    var open: Range<String.Index>? = nil
    while let found = packet.range(of: "<rdf:RDF", range: searchFrom..<packet.endIndex) {
        let after = found.upperBound
        let boundary = after == packet.endIndex || !isWordChar(packet[after])
        if boundary, let close = packet[after...].firstIndex(of: ">") {
            open = found.lowerBound..<packet.index(after: close)
            break
        }
        searchFrom = packet.index(after: found.lowerBound)
    }
    guard let open, let close = packet.range(of: "</rdf:RDF>", options: .backwards), close.lowerBound >= open.lowerBound else { return "" }
    if close.lowerBound < open.upperBound { return "" }
    return String(packet[open.upperBound..<close.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines)
}

/// The file: the base with its XMP and MPF inserted, then the gain map with
/// its own XMP, back to back. A base that already carries an XMP packet — the
/// stamp's, written before the container — is TAKEN OUT and its descriptions
/// folded into the container's packet, so the file carries one.
public func wrapUltraHdr(_ primaryIn: Data, _ gainMap: Data, _ meta: GainMapMeta) throws -> Data {
    let map = [UInt8](gainMap)
    let mapAt = try insertionPoint(map)
    let mapOut = Array(map[0..<mapAt]) + (try xmpSegment(gainMapXmp(meta))) + Array(map[mapAt...])
    let given = [UInt8](primaryIn)
    let own = (segmentsOf(given) ?? []).first { $0.marker == markerAPP1 && startsWith($0.data, xmpHeader) }
    let primary: [UInt8]
    let extra: String
    if let own {
        primary = Array(given[0..<own.start]) + Array(given[(own.start + own.length)...])
        extra = descriptionsOf(text(own.data.dropFirst(xmpHeader.utf16.count)))
    } else {
        primary = given
        extra = ""
    }
    let at = try insertionPoint(primary)
    let xmp = try xmpSegment(primaryXmp(mapOut.count, extra: extra))
    // The MPF offset is counted from its own endian field, so the base's final
    // length is known before the segment is written.
    let primaryLength = primary.count + xmp.count + mpfSegmentLength
    let mpHeaderAt = at + xmp.count + mpHeaderInSegment
    let mpf = [UInt8](mpfSegment(primarySize: primaryLength, secondarySize: mapOut.count, secondaryOffset: primaryLength - mpHeaderAt))
    let head = Array(primary[0..<at]) + xmp + mpf
    return Data(head + Array(primary[at...]) + mapOut)
}

// MARK: - reading it back

/// How the gain map was found: by the MPF entry, or by the directory's Length from the end.
public enum UltraHdrFoundBy: String, Sendable {
    case mpf, length
}

public struct UltraHdrParts: Equatable, Sendable {
    /// The base image alone — what every decoder shows.
    public let primary: Data
    public let gainMap: Data
    public let meta: GainMapMeta
    public let foundBy: UltraHdrFoundBy

    public init(primary: Data, gainMap: Data, meta: GainMapMeta, foundBy: UltraHdrFoundBy) {
        self.primary = primary; self.gainMap = gainMap; self.meta = meta; self.foundBy = foundBy
    }
}

/// `hdrgm:<name>="…"` read as JavaScript's `Number()` would: blank is 0, junk is nil.
private func attr(_ xmp: String, _ name: String) -> Double? {
    let key = "hdrgm:\(name)=\""
    var searchFrom = xmp.startIndex
    while let found = xmp.range(of: key, range: searchFrom..<xmp.endIndex) {
        let rest = xmp[found.upperBound...]
        if let quote = rest.firstIndex(of: "\"") {
            let raw = String(rest[rest.startIndex..<quote]).trimmingCharacters(in: .whitespacesAndNewlines)
            if raw.isEmpty { return 0 }
            guard let v = Double(raw), v.isFinite else { return nil }
            return v
        }
        searchFrom = xmp.index(after: found.lowerBound)
    }
    return nil
}

/// The `hdrgm:` numbers out of an XMP packet, or nil when one is missing.
public func parseGainMapMeta(_ xmp: String) -> GainMapMeta? {
    let gainMapMin = attr(xmp, "GainMapMin")
    guard let gainMapMax = attr(xmp, "GainMapMax") else { return nil }
    return GainMapMeta(
        gainMapMin: gainMapMin ?? 0,
        gainMapMax: gainMapMax,
        gamma: attr(xmp, "Gamma") ?? 1,
        offsetSdr: attr(xmp, "OffsetSDR") ?? 1.0 / 64,
        offsetHdr: attr(xmp, "OffsetHDR") ?? 1.0 / 64,
        hdrCapacityMin: attr(xmp, "HDRCapacityMin") ?? 0,
        hdrCapacityMax: attr(xmp, "HDRCapacityMax") ?? gainMapMax
    )
}

private func xmpOf(_ segments: [JpegSegment]) -> [String] {
    segments
        .filter { $0.marker == markerAPP1 && startsWith($0.data, xmpHeader) }
        .map { text($0.data.dropFirst(xmpHeader.utf16.count)) }
}

/// The web's `/Item:Semantic="GainMap"[^>]*Item:Length="(\d+)"/` — the map's
/// byte length out of the directory, or 0.
private func directoryGainMapLength(_ directory: String) -> Int {
    let semantic = "Item:Semantic=\"GainMap\""
    let lengthKey = "Item:Length=\""
    var searchFrom = directory.startIndex
    while let found = directory.range(of: semantic, range: searchFrom..<directory.endIndex) {
        let tail = directory[found.upperBound...]
        let stop = tail.firstIndex(of: ">") ?? tail.endIndex
        let window = tail[tail.startIndex..<stop]
        var keyFrom = window.startIndex
        while let key = window.range(of: lengthKey, range: keyFrom..<window.endIndex) {
            let digits = window[key.upperBound...].prefix { $0.isASCII && $0.isNumber }
            let end = window.index(key.upperBound, offsetBy: digits.count)
            if !digits.isEmpty, end < window.endIndex, window[end] == "\"" {
                return Int(String(digits)) ?? 0
            }
            keyFrom = window.index(after: key.lowerBound)
        }
        searchFrom = directory.index(after: found.lowerBound)
    }
    return 0
}

/// Read an Ultra HDR JPEG back: the base, the gain map and its numbers — or
/// nil for a plain JPEG. The gain map is found by the MPF entry, else by the
/// directory's `Length` counted from the end of the file (how the container
/// spec says to fall back), and its own XMP must carry the numbers.
public func readUltraHdr(_ bytes: Data) -> UltraHdrParts? {
    let file = [UInt8](bytes)
    guard let segments = segmentsOf(file) else { return nil }
    let xmps = xmpOf(segments)
    guard let directory = xmps.first(where: { $0.contains(containerNS) && $0.contains("GainMap") }) else { return nil }
    var gainMap: [UInt8]? = nil
    var foundBy = UltraHdrFoundBy.mpf
    let mpfSeg = segments.first { $0.marker == markerAPP2 && startsWith($0.data, mpfHeader) }
    if let mpfSeg, let mpf = parseMpf(mpfSeg.data) {
        let headerPos = mpfSeg.start + 4 + mpf.headerAt
        let from = headerPos + mpf.offset
        if from >= 0, from + mpf.size <= file.count, from + 1 < file.count, file[from] == 0xff, file[from + 1] == 0xd8 {
            gainMap = Array(file[from..<(from + mpf.size)])
        }
    }
    if gainMap == nil {
        let length = directoryGainMapLength(directory)
        if length > 0 && length < file.count {
            let from = file.count - length
            if file[from] == 0xff && file[from + 1] == 0xd8 {
                gainMap = Array(file[from...])
                foundBy = .length
            }
        }
    }
    guard let gainMap, let mapSegments = segmentsOf(gainMap) else { return nil }
    guard let metaXmp = xmpOf(mapSegments).first(where: { $0.contains(hdrgmNS) }), let meta = parseGainMapMeta(metaXmp) else { return nil }
    let primaryEnd = file.count - gainMap.count
    return UltraHdrParts(primary: Data(file[0..<primaryEnd]), gainMap: Data(gainMap), meta: meta, foundBy: foundBy)
}

/// Whether these bytes start like a JPEG at all.
public func isJpeg(_ bytes: Data) -> Bool {
    bytes.count >= 2 && bytes[bytes.startIndex] == 0xff && bytes[bytes.startIndex + 1] == 0xd8
}
