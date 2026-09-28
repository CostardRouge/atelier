// Writing EXIF, the other half of `ExifParser.swift` — port of
// `src/shared/exif/exif-build.ts`.
//
// A picture developed here leaves as an encoded JPEG, and an encoder writes
// PIXELS: no GPS, no camera, no capture time, nothing. The maintainer needs
// those back — his Gallery is where he looks a photograph up — so an export
// carries the original's metadata, and this module builds the block that
// holds it: a TIFF stream (the payload of a JPEG's `APP1`), little-endian,
// IFD0 + an Exif IFD + a GPS IFD, no thumbnail. This is the REBUILD path,
// used where the original's own block cannot be copied verbatim (a DNG, whose
// TIFF block is the whole file; a proxy whose only metadata is what its source
// vouched for). Where the original IS a JPEG, `ExifBlock.swift` copies its
// block instead and keeps what no struct models — the maker notes above all.
//
// The rules it keeps from the web module:
// - **Orientation is always written as 1**: a developed picture is delivered
//   the way up it was looked at, so carrying the original's orientation over
//   would turn it a second time. The pixel dimensions are the DELIVERED ones,
//   for the same reason. No thumbnail — a stale one is worse than none.
// - The ONE block that says otherwise is `buildOrientationBlock`: twenty-six
//   bytes holding the orientation alone, spliced into a RAW's embedded render
//   (a byte-exact slice out of the container, which left the camera's tag
//   behind) so the decoder can turn it — never a relaxation of the rule above.
// - A decimal is written as the fraction a camera wrote (`toRational`, by
//   continued fractions: 0.005 is 1/200, not 5/1000), a coordinate as three
//   rationals to a ten-thousandth of a second of arc.
// - An ASCII tag is UTF-8 plus its NUL: the format says seven bits, but a
//   copyright line opens with `©` and a caption is written in whatever
//   language its author speaks, and UTF-8 is what Lightroom, Capture One and
//   exiftool write and read there. `UNDEFINED` is byte for byte (an
//   `ExifVersion` is four bytes and exactly four).
// - What is not given is left out, never written as a zero.
// - Not written, deliberately: `relativeAltitude`, DJI's height above
//   take-off — an XMP property, not an EXIF tag.
//
// Every number here is a `Double`, as a JS number is, so the rounding is the
// web's (`ExifText.jsRound`, `Math.round`) and a value reaches the wire
// through `ToUint32`'s own arithmetic.

import Foundation

// MARK: - tag numbers, the writer's half of the parser's three maps

private enum Ifd0Tag {
    static let imageDescription = 0x010e
    static let make = 0x010f
    static let model = 0x0110
    static let orientation = 0x0112
    static let software = 0x0131
    static let artist = 0x013b
    static let copyright = 0x8298
    static let exifPointer = 0x8769
    static let gpsPointer = 0x8825
}

private enum ExifTag {
    static let exposureTime = 0x829a
    static let fNumber = 0x829d
    static let exposureProgram = 0x8822
    static let iso = 0x8827
    static let exifVersion = 0x9000
    static let dateTimeOriginal = 0x9003
    static let dateTimeDigitized = 0x9004
    static let exposureBias = 0x9204
    static let meteringMode = 0x9207
    static let flash = 0x9209
    static let focalLength = 0x920a
    static let colorSpace = 0xa001
    static let pixelWidth = 0xa002
    static let pixelHeight = 0xa003
    static let whiteBalance = 0xa403
    static let focalLength35 = 0xa405
    static let lensMake = 0xa433
    static let lensModel = 0xa434
}

private enum GpsTag {
    static let versionId = 0x0000
    static let latRef = 0x0001
    static let lat = 0x0002
    static let lonRef = 0x0003
    static let lon = 0x0004
    static let altRef = 0x0005
    static let alt = 0x0006
}

private let typeBYTE = 1
private let typeASCII = 2
private let typeSHORT = 3
private let typeLONG = 4
private let typeRATIONAL = 5
private let typeUNDEFINED = 7
private let typeSRATIONAL = 10

private let typeSizes: [Int: Int] = [1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 10: 8]

/// A field's values: numbers for every type but ASCII and UNDEFINED, which
/// carry a string. A RATIONAL's numbers are FLAT numerator/denominator pairs,
/// so a GPS coordinate is six numbers and a count of three.
private enum FieldValues {
    case numbers([Double])
    case text(String)
}

/// One tag to write: its number, its type, and its values.
private struct Field {
    var tag: Int
    var type: Int
    var values: FieldValues
}

// MARK: - the arithmetic

/// A decimal as the pair of integers EXIF stores.
///
/// Continued fractions, so 0.005 comes back as 1/200 — the shutter a camera
/// wrote and a reader expects — rather than as 5/1000. Bounded by a
/// denominator no larger than asked for; an exact match ends it early. The
/// pair is integral, held as `Double` the way the web holds its numbers.
public func toRational(_ value: Double, maxDenominator: Double = 1_000_000) -> (Double, Double) {
    if !value.isFinite || value == 0 { return (0, 1) }
    let sign: Double = value < 0 ? -1 : 1
    let target = value.magnitude
    if target == target.rounded(.down), target <= 4_294_967_295 { return (sign * target, 1) }
    var x = target
    var hPrev = 1.0
    var h = x.rounded(.down)
    var kPrev = 0.0
    var k = 1.0
    for _ in 0..<32 {
        let frac = x - x.rounded(.down)
        if frac < 1e-12 { break }
        x = 1 / frac
        let a = x.rounded(.down)
        let hNext = a * h + hPrev
        let kNext = a * k + kPrev
        if kNext > maxDenominator || !hNext.isFinite || hNext > 4_294_967_295 { break }
        hPrev = h
        h = hNext
        kPrev = k
        k = kNext
        if (h / k - target).magnitude < 1e-12 { break }
    }
    return (sign * h, k)
}

/// Degrees as the three rationals EXIF stores, flat — the seconds keep the
/// precision, at a ten-thousandth of a second of arc (about 3 µm).
public func toDegreesMinutesSeconds(_ degrees: Double) -> [Double] {
    let abs = degrees.magnitude
    let d = abs.rounded(.down)
    let m = ((abs - d) * 60).rounded(.down)
    let s = (abs - d - m / 60) * 3600
    return [d, 1, m, 1, ExifText.jsRound(s * 10_000), 10_000]
}

/// JS `ToUint32`: the value truncated, modulo 2³², as `>>> 0` and `| 0` both
/// leave the low bits — NaN and the infinities are 0.
private func jsUint32Bits(_ value: Double) -> UInt32 {
    guard value.isFinite else { return 0 }
    let truncated = value.rounded(.towardZero)
    let modulo = truncated.truncatingRemainder(dividingBy: 4_294_967_296)
    let positive = modulo < 0 ? modulo + 4_294_967_296 : modulo
    return UInt32(positive)
}

// MARK: - the fields

private func ascii(_ tag: Int, _ value: String?) -> Field? {
    guard let text = value?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
    return Field(tag: tag, type: typeASCII, values: .text(text))
}

private func short(_ tag: Int, _ value: Double?) -> Field? {
    guard let value, value.isFinite else { return nil }
    let v = ExifText.jsRound(value)
    return v >= 0 && v <= 0xffff ? Field(tag: tag, type: typeSHORT, values: .numbers([v])) : nil
}

private func long(_ tag: Int, _ value: Double?) -> Field? {
    guard let value, value.isFinite, value >= 0 else { return nil }
    return Field(tag: tag, type: typeLONG, values: .numbers([ExifText.jsRound(value)]))
}

private func rational(_ tag: Int, _ value: Double?) -> Field? {
    guard let value, value.isFinite, value >= 0 else { return nil }
    let (n, d) = toRational(value)
    return Field(tag: tag, type: typeRATIONAL, values: .numbers([n, d]))
}

private func srational(_ tag: Int, _ value: Double?) -> Field? {
    guard let value, value.isFinite else { return nil }
    let (n, d) = toRational(value)
    return Field(tag: tag, type: typeSRATIONAL, values: .numbers([n, d]))
}

/// A string field's bytes: ASCII as UTF-8 plus its NUL, UNDEFINED byte for byte.
private func stringBytes(_ type: Int, _ text: String) -> [UInt8] {
    if type == typeUNDEFINED { return text.utf16.map { UInt8($0 & 0xff) } }
    return Array(text.utf8) + [0]
}

/// How many VALUES a field holds, in the sense the entry's count means.
private func fieldCount(_ field: Field) -> Int {
    switch field.values {
    case .text(let text):
        return stringBytes(field.type, text).count
    case .numbers(let numbers):
        return field.type == typeRATIONAL || field.type == typeSRATIONAL ? numbers.count / 2 : numbers.count
    }
}

private func fieldBytes(_ field: Field) -> Int {
    (typeSizes[field.type] ?? 1) * fieldCount(field)
}

/// An IFD's own size on the wire: its count, its entries, and the next-IFD pointer.
private func ifdSize(_ entries: Int) -> Int {
    2 + entries * 12 + 4
}

/// One field's value bytes, little-endian, pushed one at a time.
private func writeValue(_ field: Field, _ push: (UInt8) -> Void) {
    switch field.values {
    case .text(let text):
        for b in stringBytes(field.type, text) { push(b) }
    case .numbers(let numbers):
        // A rational's two halves are 4-byte words, so every number here fits one.
        let width = field.type == typeRATIONAL || field.type == typeSRATIONAL ? 4 : (typeSizes[field.type] ?? 1)
        for value in numbers {
            let v = jsUint32Bits(value)
            for b in 0..<width { push(UInt8((v >> (8 * UInt32(b))) & 0xff)) }
        }
    }
}

private func putLE16(_ bytes: inout [UInt8], _ at: Int, _ value: Int) {
    let u = UInt16(truncatingIfNeeded: value)
    bytes[at] = UInt8(u & 0xff)
    bytes[at + 1] = UInt8(u >> 8)
}

private func putLE32(_ bytes: inout [UInt8], _ at: Int, _ value: Int) {
    let u = UInt32(truncatingIfNeeded: value)
    for i in 0..<4 { bytes[at + i] = UInt8((u >> (8 * UInt32(i))) & 0xff) }
}

/// Write one IFD at `at`, its long values appended to `data` (which will land
/// at `dataStart`). Entries are sorted by tag, as the format asks.
private func writeIfd(_ bytes: inout [UInt8], _ at: Int, _ fields: [Field], _ dataStart: Int, _ data: inout [UInt8]) {
    let sorted = fields.sorted { $0.tag < $1.tag }
    putLE16(&bytes, at, sorted.count)
    for (i, field) in sorted.enumerated() {
        let entry = at + 2 + i * 12
        putLE16(&bytes, entry, field.tag)
        putLE16(&bytes, entry + 2, field.type)
        putLE32(&bytes, entry + 4, fieldCount(field))
        if fieldBytes(field) > 4 {
            putLE32(&bytes, entry + 8, dataStart + data.count)
            writeValue(field) { data.append($0) }
            // A value area starts on an even offset, as TIFF asks.
            if data.count % 2 == 1 { data.append(0) }
        } else {
            var k = 0
            writeValue(field) { b in
                bytes[entry + 8 + k] = b
                k += 1
            }
        }
    }
    putLE32(&bytes, at + 2 + sorted.count * 12, 0)
}

/// `II`, 42, then IFD0's offset: the header every TIFF stream opens with.
private func writeTiffHeader(_ bytes: inout [UInt8], ifd0Offset: Int) {
    putLE16(&bytes, 0, 0x4949)
    putLE16(&bytes, 2, 42)
    putLE32(&bytes, 4, ifd0Offset)
}

// MARK: - the block

/// The web's `BuildExifOptions`.
public struct BuildExifOptions: Equatable, Sendable {
    /// What wrote the file — `Software`, a courtesy to whoever reads it later.
    public var software: String?
    /// The author's own words, written OVER what the capture carried:
    /// `Artist`, `Copyright` and `ImageDescription` (`delivery-meta.ts`).
    public var artist: AuthorTag
    public var copyright: AuthorTag
    public var description: AuthorTag
    /// The delivered picture's own size, which is never the original's.
    public var pixelWidth: Double?
    public var pixelHeight: Double?

    public init(
        software: String? = nil, artist: AuthorTag = .keep, copyright: AuthorTag = .keep,
        description: AuthorTag = .keep, pixelWidth: Double? = nil, pixelHeight: Double? = nil
    ) {
        self.software = software; self.artist = artist; self.copyright = copyright
        self.description = description; self.pixelWidth = pixelWidth; self.pixelHeight = pixelHeight
    }
}

/// An EXIF block (a TIFF stream) holding everything `exif` says.
///
/// Orientation is always written as 1 and the pixel dimensions are the
/// DELIVERED ones — the header comment says why. No thumbnail is written.
public func buildExifBlock(_ exif: ExifData, _ options: BuildExifOptions = BuildExifOptions()) -> [UInt8] {
    var ifd0: [Field] = [
        ascii(Ifd0Tag.make, exif.make),
        ascii(Ifd0Tag.model, exif.model),
        ascii(Ifd0Tag.artist, options.artist.resolved(over: exif.artist)),
        ascii(Ifd0Tag.copyright, options.copyright.resolved(over: exif.copyright)),
        ascii(Ifd0Tag.imageDescription, options.description.resolved(over: exif.imageDescription)),
        ascii(Ifd0Tag.software, options.software ?? exif.software),
        Field(tag: Ifd0Tag.orientation, type: typeSHORT, values: .numbers([1])),
    ].compactMap { $0 }

    let exifIfd: [Field] = [
        Field(tag: ExifTag.exifVersion, type: typeUNDEFINED, values: .text("0232")),
        Field(tag: ExifTag.colorSpace, type: typeSHORT, values: .numbers([1])),
        rational(ExifTag.exposureTime, exif.exposureTime),
        rational(ExifTag.fNumber, exif.fNumber),
        short(ExifTag.exposureProgram, exif.exposureProgram),
        short(ExifTag.iso, exif.iso),
        ascii(ExifTag.dateTimeOriginal, exif.dateTimeOriginal),
        ascii(ExifTag.dateTimeDigitized, exif.dateTimeOriginal),
        srational(ExifTag.exposureBias, exif.exposureBias),
        short(ExifTag.meteringMode, exif.meteringMode),
        short(ExifTag.flash, exif.flash),
        rational(ExifTag.focalLength, exif.focalLength),
        short(ExifTag.whiteBalance, exif.whiteBalance),
        short(ExifTag.focalLength35, exif.focalLength35),
        ascii(ExifTag.lensMake, exif.lensMake),
        ascii(ExifTag.lensModel, exif.lensModel),
        long(ExifTag.pixelWidth, options.pixelWidth ?? exif.pixelWidth),
        long(ExifTag.pixelHeight, options.pixelHeight ?? exif.pixelHeight),
    ].compactMap { $0 }

    var gpsIfd: [Field] = []
    if let gps = exif.gps, gps.lat.isFinite, gps.lon.isFinite {
        gpsIfd.append(Field(tag: GpsTag.versionId, type: typeBYTE, values: .numbers([2, 3, 0, 0])))
        gpsIfd.append(Field(tag: GpsTag.latRef, type: typeASCII, values: .text(gps.lat < 0 ? "S" : "N")))
        gpsIfd.append(Field(tag: GpsTag.lat, type: typeRATIONAL, values: .numbers(toDegreesMinutesSeconds(gps.lat))))
        gpsIfd.append(Field(tag: GpsTag.lonRef, type: typeASCII, values: .text(gps.lon < 0 ? "W" : "E")))
        gpsIfd.append(Field(tag: GpsTag.lon, type: typeRATIONAL, values: .numbers(toDegreesMinutesSeconds(gps.lon))))
    }
    if let altitude = exif.gpsAltitude, altitude.isFinite {
        let (n, d) = toRational(altitude.magnitude)
        gpsIfd.append(Field(tag: GpsTag.altRef, type: typeBYTE, values: .numbers([altitude < 0 ? 1 : 0])))
        gpsIfd.append(Field(tag: GpsTag.alt, type: typeRATIONAL, values: .numbers([n, d])))
    }

    // Every IFD's length is known before anything is written — a field's size
    // does not depend on where it lands — so the pointers can be filled in now.
    let hasGps = !gpsIfd.isEmpty
    let ifd0Offset = 8
    let exifOffset = ifd0Offset + ifdSize(ifd0.count + 1 + (hasGps ? 1 : 0))
    let gpsOffset = exifOffset + ifdSize(exifIfd.count)
    ifd0.append(Field(tag: Ifd0Tag.exifPointer, type: typeLONG, values: .numbers([Double(exifOffset)])))
    if hasGps { ifd0.append(Field(tag: Ifd0Tag.gpsPointer, type: typeLONG, values: .numbers([Double(gpsOffset)]))) }
    let dataStart = gpsOffset + (hasGps ? ifdSize(gpsIfd.count) : 0)

    // Each long value is padded to an even length, so the slack is one byte per
    // field; the block is cut to what was really written.
    let slack = (ifd0 + exifIfd + gpsIfd).reduce(0) { sum, f in
        let size = fieldBytes(f)
        return sum + (size > 4 ? size + 1 : 0)
    }
    var bytes = [UInt8](repeating: 0, count: dataStart + slack)
    writeTiffHeader(&bytes, ifd0Offset: ifd0Offset)

    var data: [UInt8] = []
    writeIfd(&bytes, ifd0Offset, ifd0, dataStart, &data)
    writeIfd(&bytes, exifOffset, exifIfd, dataStart, &data)
    if hasGps { writeIfd(&bytes, gpsOffset, gpsIfd, dataStart, &data) }
    bytes.replaceSubrange(dataStart..<(dataStart + data.count), with: data)
    return Array(bytes.prefix(dataStart + data.count))
}

/// A block holding ONE tag: the orientation, and nothing else.
///
/// Twenty-six bytes — `II`, 42, IFD0 at 8, one SHORT entry whose value is
/// inline, no next IFD — meant to be spliced into a JPEG by `withExifBlock`,
/// so that a decoder asked to honour the file's orientation finally has
/// something to read. It exists beside `buildExifBlock`, which writes 1 and
/// only 1, because the two answer opposite questions: an EXPORT is delivered
/// the way up it was looked at; a RAW's embedded render, sliced out of the
/// middle of its TIFF, was never turned by anyone and has to be told.
public func buildOrientationBlock(_ orientation: Double) -> [UInt8] {
    let field = Field(tag: Ifd0Tag.orientation, type: typeSHORT, values: .numbers([ExifText.jsRound(orientation)]))
    let ifd0Offset = 8
    var bytes = [UInt8](repeating: 0, count: ifd0Offset + ifdSize(1))
    writeTiffHeader(&bytes, ifd0Offset: ifd0Offset)
    // A SHORT's two bytes fit an entry's own slot, so nothing is appended and
    // the data area stays empty — `dataStart` is past the end and never read.
    var data: [UInt8] = []
    writeIfd(&bytes, ifd0Offset, [field], bytes.count, &data)
    return bytes
}
