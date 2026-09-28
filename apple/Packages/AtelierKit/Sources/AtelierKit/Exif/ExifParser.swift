// The EXIF reader — port of `src/shared/exif/exif-parser.ts`.
//
// Reads the standard tags a photographer cares about — camera, lens, exposure
// and GPS — out of a JPEG (its EXIF block lives in the `APP1` marker) or a
// TIFF-based file (a DNG and most camera RAWs begin with a TIFF header, so the
// same IFD walk works directly on them). Anything else, or a malformed block,
// yields an EMPTY record rather than an error — callers treat "no EXIF" and
// "couldn't read it" the same way.
//
// The rules it keeps from the web module:
// - Every offset is bounds-checked against the buffer, so a truncated slice
//   simply drops the fields that fall outside it. The web's `DataView` throws
//   on a read past the end and `parseExif` catches it into `{}`; here a
//   `ByteView` read past the end answers 0, and every guard the web has is
//   kept, so no field is ever read from that 0.
// - The byte order is the TIFF's own (`II` little, `MM` big), read per value.
// - An ASCII tag is read as UTF-8 where the bytes ARE UTF-8 (what this suite
//   and Lightroom write), else byte for byte as Latin-1, as an older body's
//   was always read.
// - `ExifData` keeps the web's field names and its `number` type (`Double?`)
//   for every numeric tag, ISO and orientation included: `num` reads whatever
//   type the entry carries, and the writer side (`exif-build.ts`, a later
//   port) consumes this record as it is.
//
// `ByteView`, `IfdEntry`, `parseIfd`, `num` and `nums` are public because
// `raw-probe.ts` walks a RAW's IFDs through this SAME TIFF reader.

import Foundation

public struct GpsCoord: Equatable, Sendable {
    /// Decimal degrees, signed (south/west negative).
    public var lat: Double
    public var lon: Double
    public init(lat: Double, lon: Double) { self.lat = lat; self.lon = lon }
}

/// The web's `ExifData`: every field optional, absent when the file does not say.
public struct ExifData: Equatable, Sendable {
    public var make: String?
    public var model: String?
    public var lensMake: String?
    public var lensModel: String?
    public var software: String?
    public var artist: String?
    /// The capture's `Copyright` line — the camera's owner setting, or an earlier export's.
    public var copyright: String?
    /// `ImageDescription` — a caption, or whatever a body writes there.
    public var imageDescription: String?
    // Exposure
    public var iso: Double?
    /// Seconds, e.g. `0.005` for 1/200 s.
    public var exposureTime: Double?
    public var fNumber: Double?
    /// Millimetres.
    public var focalLength: Double?
    /// Millimetres, 35 mm-equivalent.
    public var focalLength35: Double?
    /// Exposure compensation, in EV.
    public var exposureBias: Double?
    public var exposureProgram: Double?
    public var meteringMode: Double?
    public var whiteBalance: Double?
    public var flash: Double?
    // Image
    public var pixelWidth: Double?
    public var pixelHeight: Double?
    public var orientation: Double?
    public var dateTimeOriginal: String?
    // GPS
    public var gps: GpsCoord?
    /// Metres above sea level (negative below).
    public var gpsAltitude: Double?
    /// Metres above the take-off point — a DRONE fact, written by DJI as the
    /// XMP tag `drone-dji:RelativeAltitude`. This reader does not walk XMP, so
    /// it arrives from a source that already parsed it (`MediaOrigin.exif`);
    /// the field lives here because it belongs to the same record.
    public var relativeAltitude: Double?

    public init(
        make: String? = nil, model: String? = nil, lensMake: String? = nil, lensModel: String? = nil,
        software: String? = nil, artist: String? = nil, copyright: String? = nil, imageDescription: String? = nil,
        iso: Double? = nil, exposureTime: Double? = nil, fNumber: Double? = nil, focalLength: Double? = nil,
        focalLength35: Double? = nil, exposureBias: Double? = nil, exposureProgram: Double? = nil,
        meteringMode: Double? = nil, whiteBalance: Double? = nil, flash: Double? = nil,
        pixelWidth: Double? = nil, pixelHeight: Double? = nil, orientation: Double? = nil,
        dateTimeOriginal: String? = nil, gps: GpsCoord? = nil, gpsAltitude: Double? = nil,
        relativeAltitude: Double? = nil
    ) {
        self.make = make; self.model = model; self.lensMake = lensMake; self.lensModel = lensModel
        self.software = software; self.artist = artist; self.copyright = copyright; self.imageDescription = imageDescription
        self.iso = iso; self.exposureTime = exposureTime; self.fNumber = fNumber; self.focalLength = focalLength
        self.focalLength35 = focalLength35; self.exposureBias = exposureBias; self.exposureProgram = exposureProgram
        self.meteringMode = meteringMode; self.whiteBalance = whiteBalance; self.flash = flash
        self.pixelWidth = pixelWidth; self.pixelHeight = pixelHeight; self.orientation = orientation
        self.dateTimeOriginal = dateTimeOriginal; self.gps = gps; self.gpsAltitude = gpsAltitude
        self.relativeAltitude = relativeAltitude
    }

    /// The web's `isEmptyExif`: no usable field at all.
    public var isEmpty: Bool { self == ExifData() }
}

/// True when an ExifData carries no usable field.
public func isEmptyExif(_ data: ExifData) -> Bool { data.isEmpty }

/// How many leading bytes of a file to read for EXIF. A JPEG's `APP1` segment
/// is capped at ~64 KB and sits near the front; TIFF/RAW front-load their IFDs
/// too. 256 KB is a generous cushion that stays cheap to read per photo.
public let exifSliceBytes = 256 * 1024

// MARK: - the byte view

/// The web's `DataView` over a file's leading bytes: reads in either byte
/// order, bounds-checked. A read past the end answers 0 rather than trapping;
/// every reader here guards its offsets first, as the web's do, so the 0 is
/// only ever what a truncated slice degrades to, never a value a field reads.
public struct ByteView: Sendable {
    public let bytes: [UInt8]

    public init(_ bytes: [UInt8]) { self.bytes = bytes }
    /// A `Data` slice's start index is not 0; copying to an array makes every
    /// offset below absolute, as a `DataView`'s are.
    public init(_ data: Data) { self.bytes = [UInt8](data) }

    public var byteLength: Int { bytes.count }

    public func uint8(_ at: Int) -> UInt8 {
        at >= 0 && at < bytes.count ? bytes[at] : 0
    }

    public func int8(_ at: Int) -> Int8 { Int8(bitPattern: uint8(at)) }

    public func uint16(_ at: Int, little: Bool = false) -> UInt16 {
        guard at >= 0, at + 2 <= bytes.count else { return 0 }
        let a = UInt16(bytes[at])
        let b = UInt16(bytes[at + 1])
        return little ? (b << 8) | a : (a << 8) | b
    }

    public func int16(_ at: Int, little: Bool = false) -> Int16 { Int16(bitPattern: uint16(at, little: little)) }

    public func uint32(_ at: Int, little: Bool = false) -> UInt32 {
        guard at >= 0, at + 4 <= bytes.count else { return 0 }
        var value: UInt32 = 0
        for i in 0..<4 {
            let byte = bytes[at + (little ? 3 - i : i)]
            value = (value << 8) | UInt32(byte)
        }
        return value
    }

    public func int32(_ at: Int, little: Bool = false) -> Int32 { Int32(bitPattern: uint32(at, little: little)) }

    public func uint64(_ at: Int, little: Bool = false) -> UInt64 {
        guard at >= 0, at + 8 <= bytes.count else { return 0 }
        var value: UInt64 = 0
        for i in 0..<8 {
            let byte = bytes[at + (little ? 7 - i : i)]
            value = (value << 8) | UInt64(byte)
        }
        return value
    }

    /// IEEE 754 single, as the web's `getFloat32` reads it.
    public func float32(_ at: Int, little: Bool = false) -> Float {
        Float(bitPattern: uint32(at, little: little))
    }

    /// IEEE 754 double, as the web's `getFloat64` reads it.
    public func float64(_ at: Int, little: Bool = false) -> Double {
        Double(bitPattern: uint64(at, little: little))
    }
}

// MARK: - TIFF tag types & sizes

/// One IFD entry — the web's `Entry`, prefixed because a bare `Entry` in a
/// module-wide namespace is the kind of name two ports collide on.
public struct IfdEntry: Equatable, Sendable {
    public var type: Int
    public var count: Int
    /// Absolute offset (into the buffer) of the value bytes.
    public var valueOffset: Int
    public init(type: Int, count: Int, valueOffset: Int) {
        self.type = type; self.count = count; self.valueOffset = valueOffset
    }
}

private let typeSize: [Int: Int] = [
    1: 1, // BYTE
    2: 1, // ASCII
    3: 2, // SHORT
    4: 4, // LONG
    5: 8, // RATIONAL
    6: 1, // SBYTE
    7: 1, // UNDEFINED
    8: 2, // SSHORT
    9: 4, // SLONG
    10: 8, // SRATIONAL
    11: 4, // FLOAT
    12: 8, // DOUBLE
]

private func readNumberAt(_ view: ByteView, _ offset: Int, _ type: Int, _ little: Bool) -> Double {
    switch type {
    case 1, 7:
        return Double(view.uint8(offset))
    case 6:
        return Double(view.int8(offset))
    case 3:
        return Double(view.uint16(offset, little: little))
    case 8:
        return Double(view.int16(offset, little: little))
    case 4:
        return Double(view.uint32(offset, little: little))
    case 9:
        return Double(view.int32(offset, little: little))
    case 11:
        return Double(view.float32(offset, little: little))
    case 12:
        return view.float64(offset, little: little)
    case 5:
        let den = view.uint32(offset + 4, little: little)
        if den == 0 { return 0 }
        return Double(view.uint32(offset, little: little)) / Double(den)
    case 10:
        let den = view.int32(offset + 4, little: little)
        if den == 0 { return 0 }
        return Double(view.int32(offset, little: little)) / Double(den)
    default:
        return .nan
    }
}

/// Absolute offset of an entry's value bytes — inline if ≤4 bytes, else pointed.
private func valueOffsetOf(_ view: ByteView, _ tiffStart: Int, _ entryOffset: Int, _ type: Int, _ count: Int, _ little: Bool) -> Int {
    let byteLen = (typeSize[type] ?? 0) * count
    return byteLen > 4
        ? tiffStart + Int(view.uint32(entryOffset + 8, little: little))
        : entryOffset + 8
}

extension ByteView {
    /// Parse one IFD into a tag→entry map. Stops cleanly on any out-of-bounds read.
    public func parseIfd(tiffStart: Int, ifdOffset: Int, little: Bool) -> [Int: IfdEntry] {
        var map: [Int: IfdEntry] = [:]
        if ifdOffset < 0 || ifdOffset + 2 > byteLength { return map }
        let count = Int(uint16(ifdOffset, little: little))
        for i in 0..<count {
            let entryOffset = ifdOffset + 2 + i * 12
            if entryOffset + 12 > byteLength { break }
            let tag = Int(uint16(entryOffset, little: little))
            let type = Int(uint16(entryOffset + 2, little: little))
            let cnt = Int(uint32(entryOffset + 4, little: little))
            if (typeSize[type] ?? 0) == 0 { continue }
            map[tag] = IfdEntry(
                type: type,
                count: cnt,
                valueOffset: valueOffsetOf(self, tiffStart, entryOffset, type, cnt, little)
            )
        }
        return map
    }

    /// First numeric value of an entry, or nil if missing/out of bounds.
    public func num(_ entry: IfdEntry?, little: Bool) -> Double? {
        guard let entry else { return nil }
        let size = typeSize[entry.type] ?? 0
        if size == 0 || entry.valueOffset + size > byteLength { return nil }
        let v = readNumberAt(self, entry.valueOffset, entry.type, little)
        return v.isFinite ? v : nil
    }

    /// All numeric values of an entry (e.g. the 3 rationals of a GPS coordinate).
    public func nums(_ entry: IfdEntry?, little: Bool) -> [Double]? {
        guard let entry else { return nil }
        let size = typeSize[entry.type] ?? 0
        if size == 0 || entry.valueOffset + size * entry.count > byteLength { return nil }
        var out: [Double] = []
        out.reserveCapacity(entry.count)
        for i in 0..<entry.count {
            out.append(readNumberAt(self, entry.valueOffset + i * size, entry.type, little))
        }
        return out
    }

    /// ASCII value of an entry, trimmed and NUL-terminated, or nil. Read as
    /// UTF-8 where the bytes ARE UTF-8 — what this suite writes and what
    /// Lightroom and exiftool write, so a `©` comes back a `©` — else byte for
    /// byte, as an older body's Latin-1 was always read here.
    func str(_ entry: IfdEntry?) -> String? {
        guard let entry, entry.type == 2 else { return nil }
        if entry.valueOffset + entry.count > byteLength { return nil }
        var raw: [UInt8] = []
        for i in 0..<entry.count {
            let c = uint8(entry.valueOffset + i)
            if c == 0 { break }
            raw.append(c)
        }
        let decoded = String(decoding: raw, as: UTF8.self)
        // A valid UTF-8 sequence round-trips byte for byte; anything replaced
        // by U+FFFD on the way did not, and is read as Latin-1 instead.
        let text = Array(decoded.utf8) == raw
            ? decoded
            : String(raw.map { Character(Unicode.Scalar($0)) })
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

/// Degrees/minutes/seconds rationals + hemisphere ref → signed decimal degrees.
private func toDecimal(_ values: [Double]?, _ ref: String?) -> Double? {
    guard let values, values.count >= 3 else { return nil }
    let d = values[0]
    let m = values[1]
    let s = values[2]
    var dec = d + m / 60 + s / 3600
    if !dec.isFinite { return nil }
    if ref == "S" || ref == "W" { dec = -dec }
    return dec
}

/// A sub-IFD pointer read out of a tag, as an offset the walk can take: the
/// web hands `tiffStart + ptr` to `DataView`, which truncates a fraction and
/// which `parseIfd` bounds-checks; a value no offset could be is treated as
/// absent, which reads the same (an empty sub-IFD).
private func pointer(_ value: Double?) -> Int? {
    guard let value, value.isFinite, value.magnitude < 1e15 else { return nil }
    return Int(value)
}

// MARK: - Tag numbers

private enum IFD0 {
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

private enum EXIF {
    static let exposureTime = 0x829a
    static let fNumber = 0x829d
    static let exposureProgram = 0x8822
    static let iso = 0x8827
    static let dateTimeOriginal = 0x9003
    static let exposureBias = 0x9204
    static let meteringMode = 0x9207
    static let flash = 0x9209
    static let focalLength = 0x920a
    static let pixelWidth = 0xa002
    static let pixelHeight = 0xa003
    static let whiteBalance = 0xa403
    static let focalLength35 = 0xa405
    static let lensMake = 0xa433
    static let lensModel = 0xa434
}

private enum GPS {
    static let latRef = 0x0001
    static let lat = 0x0002
    static let lonRef = 0x0003
    static let lon = 0x0004
    static let altRef = 0x0005
    static let alt = 0x0006
}

/// Locate the TIFF block inside a JPEG's `APP1` (Exif) segment, or -1.
private func findExifInJpeg(_ view: ByteView) -> Int {
    var offset = 2 // past SOI
    while offset + 4 <= view.byteLength {
        if view.uint8(offset) != 0xff { break } // not a marker — give up
        let marker = view.uint8(offset + 1)
        // Start of scan / end of image: pixel data follows, no more metadata.
        if marker == 0xda || marker == 0xd9 { break }
        let segLen = Int(view.uint16(offset + 2))
        if marker == 0xe1 {
            let p = offset + 4
            // "Exif\0\0"
            if p + 6 <= view.byteLength, view.uint32(p) == 0x4578_6966, view.uint16(p + 4) == 0x0000 {
                return p + 6
            }
        }
        offset += 2 + segLen
    }
    return -1
}

/// Walk a TIFF block (IFD0 → Exif sub-IFD → GPS sub-IFD) into an ExifData.
private func readTiff(_ view: ByteView, _ tiffStart: Int) -> ExifData {
    if tiffStart < 0 || tiffStart + 8 > view.byteLength { return ExifData() }
    let bom = view.uint16(tiffStart)
    let little = bom == 0x4949
    if !little && bom != 0x4d4d { return ExifData() }
    if view.uint16(tiffStart + 2, little: little) != 0x002a { return ExifData() }

    let ifd0Offset = tiffStart + Int(view.uint32(tiffStart + 4, little: little))
    let ifd0 = view.parseIfd(tiffStart: tiffStart, ifdOffset: ifd0Offset, little: little)
    var out = ExifData()
    out.make = view.str(ifd0[IFD0.make])
    out.model = view.str(ifd0[IFD0.model])
    out.orientation = view.num(ifd0[IFD0.orientation], little: little)
    out.software = view.str(ifd0[IFD0.software])
    out.artist = view.str(ifd0[IFD0.artist])
    out.copyright = view.str(ifd0[IFD0.copyright])
    out.imageDescription = view.str(ifd0[IFD0.imageDescription])

    if let exifPtr = pointer(view.num(ifd0[IFD0.exifPointer], little: little)) {
        let exif = view.parseIfd(tiffStart: tiffStart, ifdOffset: tiffStart + exifPtr, little: little)
        out.exposureTime = view.num(exif[EXIF.exposureTime], little: little)
        out.fNumber = view.num(exif[EXIF.fNumber], little: little)
        out.iso = view.num(exif[EXIF.iso], little: little)
        out.exposureProgram = view.num(exif[EXIF.exposureProgram], little: little)
        out.dateTimeOriginal = view.str(exif[EXIF.dateTimeOriginal])
        out.exposureBias = view.num(exif[EXIF.exposureBias], little: little)
        out.meteringMode = view.num(exif[EXIF.meteringMode], little: little)
        out.flash = view.num(exif[EXIF.flash], little: little)
        out.focalLength = view.num(exif[EXIF.focalLength], little: little)
        out.focalLength35 = view.num(exif[EXIF.focalLength35], little: little)
        out.whiteBalance = view.num(exif[EXIF.whiteBalance], little: little)
        out.lensMake = view.str(exif[EXIF.lensMake])
        out.lensModel = view.str(exif[EXIF.lensModel])
        out.pixelWidth = view.num(exif[EXIF.pixelWidth], little: little)
        out.pixelHeight = view.num(exif[EXIF.pixelHeight], little: little)
    }

    if let gpsPtr = pointer(view.num(ifd0[IFD0.gpsPointer], little: little)) {
        let gps = view.parseIfd(tiffStart: tiffStart, ifdOffset: tiffStart + gpsPtr, little: little)
        let lat = toDecimal(view.nums(gps[GPS.lat], little: little), view.str(gps[GPS.latRef]))
        let lon = toDecimal(view.nums(gps[GPS.lon], little: little), view.str(gps[GPS.lonRef]))
        if let lat, let lon { out.gps = GpsCoord(lat: lat, lon: lon) }
        if let alt = view.num(gps[GPS.alt], little: little) {
            let below = view.num(gps[GPS.altRef], little: little) == 1
            out.gpsAltitude = below ? -alt : alt
        }
    }
    return out
}

/// Parse EXIF from the leading bytes of a JPEG or TIFF/RAW file.
public func parseExif(_ view: ByteView) -> ExifData {
    if view.byteLength < 8 { return ExifData() }
    let head = view.uint16(0)
    if head == 0xffd8 { return readTiff(view, findExifInJpeg(view)) } // JPEG
    if head == 0x4949 || head == 0x4d4d { return readTiff(view, 0) } // TIFF/RAW
    return ExifData()
}

public func parseExif(_ bytes: [UInt8]) -> ExifData { parseExif(ByteView(bytes)) }

public func parseExif(_ data: Data) -> ExifData { parseExif(ByteView(data)) }
