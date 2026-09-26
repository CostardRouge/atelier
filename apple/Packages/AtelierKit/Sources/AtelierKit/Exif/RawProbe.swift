// What a RAW file IS — read off its own IFDs, without decoding a pixel. Port
// of `src/shared/exif/raw-probe.ts`.
//
// A camera RAW (DNG, ARW, NEF, CR2…) is a TIFF whose IFDs describe several
// images: the sensor plane, and one or more RENDERS the camera made — a
// thumbnail, often a full-size JPEG. `ExifParser.swift` walks that structure
// for metadata; this walks it for the PICTURES through the very same reader
// (`parseIfd`, `num`, `nums` on `ByteView`), so there is one TIFF parser in
// the kernel and not two.
//
// The rules it keeps from the web module:
// - **SubIFDs are walked** (to depth 4, each IFD once, the IFD0 chain to 16
//   links): a DNG keeps its sensor plane and its full-size render there, and
//   IFD0 alone finds only the thumbnail.
// - **A preview is picked by PHOTOMETRIC, not compression**: a DNG's sensor
//   plane is very often compression 7 (lossless JPEG) too, and handing that
//   mosaic to a decoder draws nothing. A render says YCbCr/RGB/grey; a sensor
//   says CFA (32803) or LinearRaw (34892). The biggest render wins, by pixel
//   count where stated, else by byte length.
// - **A preview pointer is NOT bounds-checked against the head**: the probe
//   reads a megabyte, and a full-size render in a 60 MB DNG sits far past it.
//   `extractRawPreview`, which knows the file's size, is where it is checked.
// - **Only `OpcodeList3` is read as calibration** (`DngOpcodes.swift`): lists
//   1 and 2 act on the mosaic, inside the decoder, where nothing here reaches.
// - **The orientation**: the capture's is IFD0's tag, the sensor plane's as a
//   fallback — a render's own tag describes the render. The render sliced out
//   of the container left that tag behind, so it is GIVEN one — a 26-byte
//   block (`buildOrientationBlock`) spliced in by `uprightJpeg` — unless its
//   own IFD answers for it, it is already the transpose of the sensor (turned
//   once; turning again lays the photograph down), or it carries a block of
//   its own. Shape is asked only of the quarter turns (5–8).
// - **Sizes are reported as SHOWN** (`rawSizesFrom`): axes swapped for a
//   quarter turn, the sensor by the capture's tag, the render by what it will
//   really be given. `sensorIfd` stays the file's own, unturned statement —
//   the two views answer different questions.
// - Anything that is not a TIFF, or a head the walk trips on, is nil — never a
//   guess. The web's `DataView` throws (and the probe answers null) on a read
//   at a NEGATIVE offset a corrupt SubIFD pointer can name; so does this walk.
//
// The Blob-reading halves (`extractRawPreview`, `rawSizes`,
// `rawCalibration`) take the file's size and a `read` closure over a byte
// range — the app's `FileHandle` — so the kernel never pulls a 60 MB DNG in to
// show its preview, and a spec reads from an array.

import Foundation

/// IFDs are front-loaded in a TIFF; this is plenty to walk them and find the previews.
public let rawProbeBytes = 1024 * 1024

private enum RawTag {
    static let subfileType = 254
    static let orientation = 274
    static let width = 256
    static let height = 257
    static let compression = 259
    static let photometric = 262
    static let stripOffsets = 273
    static let stripByteCounts = 279
    static let subIfds = 330
    static let opcodeList3 = 51022
    static let jpegOffset = 513
    static let jpegLength = 514
}

/// DNG opcode lists — a gain map for lens shading among them.
private let opcodeTags = [51008, 51009, 51022]

/// PhotometricInterpretation values that mean "a finished picture a decoder
/// could draw": 1 (white is zero — a grey render), 2 (RGB), 6 (YCbCr).
private let renderedPhotometric: Set<Double> = [1, 2, 6]

/// Compression values whose bytes are a JPEG a decoder reads as-is.
private let jpegCompression: Set<Double> = [6, 7]

/// The orientations that TRANSPOSE the frame — the quarter turns, 5 to 8.
private let transposes: Double = 5

public struct RawIfd: Equatable, Sendable {
    /// NewSubfileType: 0 the main image, 1 a reduced-resolution preview.
    public var subfileType: Double?
    public var width: Double?
    public var height: Double?
    /// TIFF Compression (tag 259).
    public var compression: Double?
    /// PhotometricInterpretation (tag 262): 32803 is a CFA sensor plane, 34892 LinearRaw.
    public var photometric: Double?
    /// EXIF Orientation (tag 274), where this IFD states one.
    public var orientation: Double?
    /// Where this IFD's whole image sits, when it has one.
    public var imageOffset: Double?
    public var imageLength: Double?

    public init(subfileType: Double? = nil, width: Double? = nil, height: Double? = nil, compression: Double? = nil,
                photometric: Double? = nil, orientation: Double? = nil, imageOffset: Double? = nil, imageLength: Double? = nil) {
        self.subfileType = subfileType; self.width = width; self.height = height; self.compression = compression
        self.photometric = photometric; self.orientation = orientation
        self.imageOffset = imageOffset; self.imageLength = imageLength
    }
}

public struct RawPreview: Equatable, Sendable {
    public var offset: Double
    public var length: Double
    public var width: Double?
    public var height: Double?
    /// The orientation this render's OWN IFD states, where it states one. It
    /// describes the render; the capture's is `RawProbe.orientation`, and
    /// where both are there this one wins.
    public var orientation: Double?

    public init(offset: Double, length: Double, width: Double? = nil, height: Double? = nil, orientation: Double? = nil) {
        self.offset = offset; self.length = length; self.width = width; self.height = height
        self.orientation = orientation
    }
}

public struct RawProbe: Equatable, Sendable {
    public var little: Bool
    /// IFD0, then its SubIFDs, then the rest of the IFD0 chain.
    public var ifds: [RawIfd]
    /// The biggest embedded JPEG a decoder can draw, or nil when there is none.
    public var preview: RawPreview?
    /// How the camera was HELD (tag 274 of IFD0, the sensor plane's as a
    /// fallback), or nil when the file says nothing.
    public var orientation: Double?
    /// The DNG opcode lists the file carries; a decoder that skips them vignettes.
    public var opcodes: [Int]
    /// What `OpcodeList3` really asks for, read from the file, or nil when the
    /// file carries none — and then no rung above `gain` is offered.
    public var calibration: DngOpcodes?

    public init(little: Bool, ifds: [RawIfd], preview: RawPreview?, orientation: Double?, opcodes: [Int], calibration: DngOpcodes?) {
        self.little = little; self.ifds = ifds; self.preview = preview; self.orientation = orientation
        self.opcodes = opcodes; self.calibration = calibration
    }
}

/// What a compression code means, for a report or a panel.
public func describeCompression(_ code: Double?) -> String {
    guard let code else { return "unstated" }
    switch code {
    case 1: return "uncompressed"
    case 6, 7: return "JPEG"
    case 8, 32946: return "deflate"
    case 34892: return "lossy JPEG"
    // The one that decides the decoder question: LibRaw reads JPEG XL tiles
    // only when built with Adobe's DNG SDK.
    case 52546: return "JPEG XL"
    default: return "compression \(ExifText.jsString(code))"
    }
}

/// A value read out of a tag as an offset a walk can take — truncated as a
/// `DataView` truncates it; nil for a value no offset could be.
private func offsetOf(_ value: Double) -> Int? {
    guard value.isFinite, value.magnitude < 1e15 else { return nil }
    return Int(value)
}

private func readRawIfd(_ view: ByteView, _ offset: Int, _ little: Bool) -> (entry: RawIfd, map: [Int: IfdEntry], next: Int) {
    let map = view.parseIfd(tiffStart: 0, ifdOffset: offset, little: little)
    let jpegOffset = view.num(map[RawTag.jpegOffset], little: little)
    let jpegLength = view.num(map[RawTag.jpegLength], little: little)
    let strips = view.nums(map[RawTag.stripOffsets], little: little)
    let counts = view.nums(map[RawTag.stripByteCounts], little: little)
    // A whole image in one piece is what can be sliced out; a picture split
    // over many strips would have to be reassembled, and no camera writes its
    // JPEG preview that way.
    let single = strips?.count == 1 && counts?.count == 1
    let entry = RawIfd(
        subfileType: view.num(map[RawTag.subfileType], little: little),
        width: view.num(map[RawTag.width], little: little),
        height: view.num(map[RawTag.height], little: little),
        compression: view.num(map[RawTag.compression], little: little),
        photometric: view.num(map[RawTag.photometric], little: little),
        orientation: view.num(map[RawTag.orientation], little: little),
        imageOffset: jpegOffset ?? (single ? strips?.first : nil),
        imageLength: jpegLength ?? (single ? counts?.first : nil)
    )
    let count = offset + 2 <= view.byteLength ? Int(view.uint16(offset, little: little)) : 0
    let nextAt = offset + 2 + count * 12
    let next = nextAt + 4 <= view.byteLength ? Int(view.uint32(nextAt, little: little)) : 0
    return (entry, map, next)
}

/// A CFA (32803) or LinearRaw (34892) plane: the sensor's data, not a render.
private func isSensor(_ ifd: RawIfd) -> Bool {
    ifd.photometric == 32803 || ifd.photometric == 34892
}

/// The biggest embedded JPEG, by pixel count where the dimensions are stated
/// and by byte length otherwise.
private func pickPreview(_ ifds: [RawIfd]) -> RawPreview? {
    var best: RawPreview?
    var bestScore = 0.0
    for ifd in ifds {
        guard jpegCompression.contains(ifd.compression ?? -1) else { continue }
        guard renderedPhotometric.contains(ifd.photometric ?? -1) else { continue }
        guard let offset = ifd.imageOffset, let length = ifd.imageLength, length > 0 else { continue }
        if !offset.isFinite || !length.isFinite { continue }
        let w = ifd.width ?? 0
        let h = ifd.height ?? 0
        let score = w != 0 && h != 0 ? w * h : length
        if score > bestScore {
            bestScore = score
            best = RawPreview(offset: offset, length: length, width: ifd.width, height: ifd.height, orientation: ifd.orientation)
        }
    }
    return best
}

/// Walk a RAW's IFDs. Nil for anything that is not a TIFF — a JPEG is not a
/// RAW, and a truncated head is not worth guessing at.
public func probeRaw(_ bytes: [UInt8]) -> RawProbe? {
    let view = ByteView(bytes)
    if view.byteLength < 16 { return nil }
    let bom = view.uint16(0)
    let little = bom == 0x4949
    if !little && bom != 0x4d4d { return nil }
    if view.uint16(2, little: little) != 0x002a { return nil }

    var ifds: [RawIfd] = []
    var opcodes: [Int] = []
    var calibration: DngOpcodes?
    var seen = Set<Int>()
    var tripped = false

    func visit(_ offset: Int, _ depth: Int) -> Int {
        if tripped || offset == 0 || offset >= view.byteLength || seen.contains(offset) || depth > 4 { return 0 }
        // The web's `DataView` throws on a negative offset, and the probe
        // answers null for the whole file.
        if offset < 0 {
            tripped = true
            return 0
        }
        seen.insert(offset)
        let read = readRawIfd(view, offset, little)
        ifds.append(read.entry)
        for tag in opcodeTags where read.map[tag] != nil && !opcodes.contains(tag) { opcodes.append(tag) }
        // Only list 3: lists 1 and 2 act on the MOSAIC, inside the decoder.
        if let three = read.map[RawTag.opcodeList3], calibration == nil {
            let list = parseOpcodeList(view, offset: three.valueOffset, length: three.count)
            if !list.gainMaps.isEmpty || list.warp != nil || !list.unread.isEmpty { calibration = list }
        }
        // SubIFDs are where a DNG keeps the sensor plane and its full-size
        // render; reading only IFD0 finds the thumbnail and misses both.
        for sub in view.nums(read.map[RawTag.subIfds], little: little) ?? [] {
            // As the web's walk reads a pointer: NaN is no pointer, one past
            // the head is skipped, and a negative one (within the depth the
            // walk still reads) trips the whole probe — `visit` says so.
            if sub.isNaN { continue }
            guard let at = offsetOf(sub) else {
                if sub < 0 && depth + 1 <= 4 {
                    tripped = true
                    return 0
                }
                continue
            }
            _ = visit(at, depth + 1)
            if tripped { return 0 }
        }
        return read.next
    }

    var offset = Int(view.uint32(4, little: little))
    var guardCount = 0
    while offset != 0 && guardCount < 16 {
        offset = visit(offset, 0)
        guardCount += 1
    }
    if tripped { return nil }

    // IFD0 is where a camera writes how it was held; a file whose IFD0 says
    // nothing but whose sensor plane does is the fallback.
    let orientation = ifds.first?.orientation ?? ifds.first(where: isSensor)?.orientation
    return RawProbe(little: little, ifds: ifds, preview: pickPreview(ifds), orientation: orientation,
                    opcodes: opcodes, calibration: calibration)
}

public func probeRaw(_ data: Data) -> RawProbe? { probeRaw([UInt8](data)) }

/// The sensor plane, for the report: the IFD that is not a render.
public func sensorIfd(_ probe: RawProbe) -> RawIfd? {
    probe.ifds.first(where: isSensor)
}

/// One line about a RAW, for a panel or a report:
/// `6000×4000 · sensor JPEG XL · preview 6000×4000 · 2 opcode lists`.
public func describeRaw(_ probe: RawProbe) -> String {
    let sensor = sensorIfd(probe)
    var parts: [String] = []
    if let w = sensor?.width, let h = sensor?.height, w != 0, h != 0 {
        parts.append("\(ExifText.jsString(w))×\(ExifText.jsString(h))")
    }
    if let sensor { parts.append("sensor \(describeCompression(sensor.compression))") }
    if let preview = probe.preview {
        let w = preview.width.map(ExifText.jsString) ?? "?"
        let h = preview.height.map(ExifText.jsString) ?? "?"
        parts.append("preview \(w)×\(h)")
    } else {
        parts.append("no embedded preview")
    }
    if !probe.opcodes.isEmpty {
        parts.append("\(probe.opcodes.count) opcode list\(probe.opcodes.count > 1 ? "s" : "")")
    }
    // What list 3 really asks for, once it has been read rather than counted.
    let asked = describeOpcodes(probe.calibration)
    if !asked.isEmpty { parts.append(asked) }
    return parts.joined(separator: " · ")
}

/// The orientation the embedded render should be GIVEN, or 1 when it must be
/// left exactly as it is: a render whose own IFD states one answers for
/// itself; a render that is the TRANSPOSE of the sensor plane has been turned
/// already. The shape test is asked only of the quarter turns.
public func previewOrientation(_ probe: RawProbe) -> Double {
    let stated = probe.preview?.orientation ?? probe.orientation ?? 1
    if !(stated > 1) || stated > 8 { return 1 }
    if stated < transposes { return stated }
    if let sensor = sensorIfd(probe), let preview = probe.preview,
       let sw = sensor.width, let sh = sensor.height, let pw = preview.width, let ph = preview.height,
       sw != 0, sh != 0, pw != 0, ph != 0 {
        if (sw >= sh) != (pw >= ph) { return 1 }
    }
    return stated
}

/// The same JPEG carrying an orientation-only EXIF block, so a decoder that
/// honours the file's orientation has something to read — the same bytes back
/// where nothing should be added. It declines for a picture that already
/// carries a block of its own, and for bytes that will not splice: the picture
/// is worth more than the turn.
public func uprightJpeg(_ bytes: [UInt8], _ orientation: Double) -> [UInt8] {
    if !(orientation > 1) { return bytes }
    if readExifBlock(bytes) != nil { return bytes }
    return (try? withExifBlock(bytes, buildOrientationBlock(orientation))) ?? bytes
}

// MARK: - the reading half

/// Past this, a preview pointer is not worth believing enough to read into
/// memory to splice; the untouched slice is handed back instead.
private let previewSpliceMax = 32.0 * 1024 * 1024

/// `Blob.slice(start, end)` on a file of `size` bytes: negatives count from
/// the end, everything clamps, and an inverted span is empty.
private func blobRange(_ start: Double, _ end: Double, _ size: Int) -> Range<Int> {
    let total = Double(size)
    func clampIndex(_ v: Double) -> Int {
        let t = v.rounded(.towardZero)
        let r = t < 0 ? max(total + t, 0) : min(t, total)
        return Int(r)
    }
    let lo = clampIndex(start)
    let hi = max(clampIndex(end), lo)
    return lo..<hi
}

/// The camera's own render out of a RAW, as JPEG bytes — or nil when the file
/// carries none, or its pointer runs past the file. `head` is a head already
/// read (for the sizes, say), else the first `rawProbeBytes` are read; `read`
/// hands back the bytes of a range of the file.
public func extractRawPreview(
    fileSize: Int,
    head: [UInt8]? = nil,
    read: (Range<Int>) throws -> [UInt8]
) rethrows -> [UInt8]? {
    let probeHead = try head ?? read(0..<min(rawProbeBytes, fileSize))
    guard let probe = probeRaw(probeHead), let preview = probe.preview else { return nil }
    if preview.offset + preview.length > Double(fileSize) { return nil }
    let slice = try read(blobRange(preview.offset, preview.offset + preview.length, fileSize))
    // A landscape capture — the overwhelming majority — keeps the byte-exact
    // slice. Only a turned one is given its block.
    let orientation = previewOrientation(probe)
    if orientation == 1 || preview.length > previewSpliceMax { return slice }
    return uprightJpeg(slice, orientation)
}

/// `extractRawPreview` over a file already in memory.
public func extractRawPreview(_ file: [UInt8]) -> [UInt8]? {
    extractRawPreview(fileSize: file.count) { Array(file[$0]) }
}

/// What a RAW holds, in two sizes, read from its head alone — both as they
/// are SHOWN, turned the way the camera was held.
public struct RawSizes: Equatable, Sendable {
    /// The sensor plane's own pixels, when the file states them.
    public var sensor: Size?
    /// The biggest embedded render a decoder could draw, when its size is stated.
    public var render: Size?
    /// How the camera was held, or nil when the file says nothing.
    public var orientation: Double?

    public init(sensor: Size? = nil, render: Size? = nil, orientation: Double? = nil) {
        self.sensor = sensor; self.render = render; self.orientation = orientation
    }
}

/// A stated size as it is SHOWN: the axes swapped for a quarter turn.
private func shownSize(_ width: Double?, _ height: Double?, _ turned: Bool) -> Size? {
    guard let width, let height, width != 0, height != 0, !width.isNaN, !height.isNaN else { return nil }
    return turned ? Size(width: height, height: width) : Size(width: width, height: height)
}

/// The two sizes from a head already in hand — pure, so a fetched head needs no second read.
public func rawSizesFrom(_ head: [UInt8]) -> RawSizes {
    guard let probe = probeRaw(head) else { return RawSizes() }
    let sensor = sensorIfd(probe)
    let preview = probe.preview
    // The sensor is turned by the CAPTURE's tag, which is what the decoder
    // applies; the render by whatever it is really going to be given.
    let sensorTurned = (probe.orientation ?? 1) >= transposes
    let renderTurned = previewOrientation(probe) >= transposes
    return RawSizes(
        sensor: shownSize(sensor?.width, sensor?.height, sensorTurned),
        render: shownSize(preview?.width, preview?.height, renderTurned),
        orientation: probe.orientation
    )
}

/// What the CALIBRATION in a RAW on hand asks for, read from its head alone.
/// Nil for a file that carries none — or one that could not be read.
public func rawCalibration(fileSize: Int, read: (Range<Int>) throws -> [UInt8]) -> DngOpcodes? {
    guard let head = try? read(0..<min(rawProbeBytes, fileSize)) else { return nil }
    return probeRaw(head)?.calibration
}

/// The two sizes of a RAW on hand: what its sensor holds, and what of it a
/// decoder can actually draw. A megabyte of the head, never the file.
public func rawSizes(fileSize: Int, read: (Range<Int>) throws -> [UInt8]) -> RawSizes {
    guard let head = try? read(0..<min(rawProbeBytes, fileSize)) else { return RawSizes() }
    return rawSizesFrom(head)
}
