// An Ultra HDR JPEG out of two delivered pictures — the SDR one, and the same
// picture developed `stops` darker — and the CHECK that earns the name: the
// file is read back through `readUltraHdr`, its numbers compared with the
// ones written, its gain map decoded as a viewer would and held to the codes
// it was given, and the lift it puts on the base's brightest pixel held to the
// rendition's. The export says "Ultra HDR" only when all of that holds
// (`docs/photo-editor.md` §4.4: the claim after decoding back). Anything short
// leaves the plain JPEG, and says why.
//
// The pure half of `src/shared/hdr/ultra-hdr-export.ts`. The web's DOM half —
// `canvas.toBlob` for the two JPEG encodes, `getImageData` for the SDR and
// darker pixels, `createImageBitmap` for the read-back decode — is the app's
// (Core Image / ImageIO), handed in as two closures: `encodeMap` turns the
// map's grey pixels into a JPEG at `gainMapQuality`, `decode` turns a JPEG into
// its RGBA bytes. The SDR JPEG arrives already encoded AND STAMPED: the MPF
// entry counts the gain map's offset from the base's own bytes, so a metadata
// segment inserted afterwards would move the map out from under it
// (`docs/memory/hdr.md`).

import Foundation

/// The map at a quarter of the picture on each side — Android's own default, and a lift varies slowly.
public let gainMapScale = 4
/// The map's own JPEG quality: a grey picture, and its ringing would be a halo.
public let gainMapQuality = 0.9
/// How far the map's codes may stray through their own JPEG, in stops, before the file is not claimed.
public let checkToleranceStops = 0.1

/// A decoded picture's bytes — RGBA, top row first — what the web reads back through a 2D canvas.
public struct DecodedPixels: Equatable, Sendable {
    public var width: Int
    public var height: Int
    /// `width × height × 4` bytes.
    public var data: [UInt8]

    public init(width: Int, height: Int, data: [UInt8]) {
        self.width = width; self.height = height; self.data = data
    }
}

/// A JPEG's bytes → its pixels, as a viewer decodes them. Throws when it cannot.
public typealias JpegDecoder = (Data) throws -> DecodedPixels

public struct UltraHdrResult: Equatable, Sendable {
    /// The file that leaves: the Ultra HDR JPEG, or the plain SDR JPEG given.
    public var blob: Data
    /// True when `blob` IS an Ultra HDR JPEG that read back within tolerance.
    public var ultra: Bool
    /// The lift the map holds, in stops (0 when flat).
    public var headroom: Double
    /// The read-back's worst stray from the rendition, in stops, when it was checked.
    public var checked: Double?
    /// Why the plain JPEG left instead, when it did.
    public var reason: String?

    public init(blob: Data, ultra: Bool, headroom: Double, checked: Double?, reason: String?) {
        self.blob = blob; self.ultra = ultra; self.headroom = headroom; self.checked = checked; self.reason = reason
    }
}

/// The gain map's codes drawn as a grey picture, for the JPEG encoder — the web's `mapCanvas` fill.
public func gainMapPixels(_ map: GainMap) -> DecodedPixels {
    var data = [UInt8](repeating: 255, count: map.codes.count * 4)
    var i = 0
    for c in map.codes {
        data[i] = c
        data[i + 1] = c
        data[i + 2] = c
        i += 4
    }
    return DecodedPixels(width: map.width, height: map.height, data: data)
}

private func lum(_ data: [Float], _ i: Int) -> Double {
    let r = Double(data[i])
    let g = Double(data[i + 1])
    let b = Double(data[i + 2])
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/// Read the written file back and measure it against what was written: the
/// base must decode at the picture's size, the `hdrgm:` numbers must come
/// back as they went in, the gain map — decoded as a viewer would — must hold
/// the codes it was given within JPEG's rounding, and the brightest pixel the
/// decoded map lifts must reach the rendition's own peak. The worst stray of
/// the two, in stops; nil when the file does not read back as written. Not a
/// pixel-for-pixel comparison with the rendition: a map at a quarter of the
/// picture softens the edge of a clipped region by construction, and that
/// softness is the format's, not a fault of the file.
public func checkUltraHdr(_ bytes: Data, _ map: GainMap, _ hdr: LinearPicture, decode: JpegDecoder) throws -> Double? {
    let width = hdr.width
    let height = hdr.height
    guard let parts = readUltraHdr(bytes) else { return nil }
    let meta = parts.meta
    func same(_ a: Double, _ b: Double) -> Bool { abs(a - b) < 1e-4 }
    if !same(meta.gainMapMin, map.meta.gainMapMin) || !same(meta.gainMapMax, map.meta.gainMapMax)
        || !same(meta.gamma, map.meta.gamma) || !same(meta.hdrCapacityMax, map.meta.hdrCapacityMax) {
        return nil
    }
    let base = try decode(bytes)
    if base.width != width || base.height != height { return nil }
    if base.data.count < width * height * 4 { return nil }
    let decoded = try decode(parts.gainMap)
    if decoded.width != map.width || decoded.height != map.height { return nil }
    if decoded.data.count < map.codes.count * 4 { return nil }
    var worst = 0
    var codes = [UInt8](repeating: 0, count: map.codes.count)
    var i = 0
    for p in 0..<map.codes.count {
        let have = Int(decoded.data[i])
        codes[p] = decoded.data[i]
        let stray = abs(have - Int(map.codes[p]))
        if stray > worst { worst = stray }
        i += 4
    }
    // A code is a share of the map's span; the span is in stops.
    let codeStray = (Double(worst) * (meta.gainMapMax - meta.gainMapMin)) / 255
    // The lift a viewer applies, once the numbers hold: the decoded map on the
    // decoded base must bring its brightest pixel where the rendition's is,
    // or the map says one thing and the pixels another.
    let read = GainMap(width: map.width, height: map.height, codes: codes, meta: meta, headroom: map.headroom)
    let lifted = applyGainMap(linearFromBytes(base.data, width: width, height: height), read, displayStops: meta.hdrCapacityMax)
    var peakHave = 0.0
    var peakWant = 0.0
    var j = 0
    while j < lifted.data.count {
        let have = lum(lifted.data, j)
        let want = lum(hdr.data, j)
        if have > peakHave { peakHave = have }
        if want > peakWant { peakWant = want }
        j += 3
    }
    let peakStray = abs(log2((peakHave + 1.0 / 64) / (peakWant + 1.0 / 64)))
    return max(codeStray, peakStray)
}

/// The file. `sdr` and `darker` are the two delivered pictures at the same
/// size, in linear light (`linearFromBytes` of what the renderer read back);
/// `stops` is how much darker the second was developed; `sdrJpeg` is the SDR
/// picture already encoded at the target's quality and already stamped with
/// its metadata. The plain JPEG (`sdrJpeg`) is what leaves when the map would
/// be flat (the picture had nothing above white) or when the read-back does
/// not hold.
public func encodeUltraHdr(sdrJpeg: Data, sdr: LinearPicture, darker: LinearPicture, stops: Double,
                           encodeMap: (DecodedPixels) throws -> Data, decode: JpegDecoder) throws -> UltraHdrResult {
    let hdr = try hdrRendition(sdr, darker, stops: stops)
    let map = try encodeGainMap(sdr, hdr, scale: gainMapScale, maxStops: stops)
    if isFlatGainMap(map) {
        return UltraHdrResult(blob: sdrJpeg, ultra: false, headroom: map.headroom, checked: nil, reason: "nothing above white in this picture")
    }
    let mapJpeg = try encodeMap(gainMapPixels(map))
    let bytes = try wrapUltraHdr(sdrJpeg, mapJpeg, map.meta)
    var checked: Double? = nil
    do {
        checked = try checkUltraHdr(bytes, map, hdr, decode: decode)
    } catch {
        checked = nil
    }
    if let stray = checked, stray <= checkToleranceStops {
        return UltraHdrResult(blob: bytes, ultra: true, headroom: map.headroom, checked: stray, reason: nil)
    }
    let reason: String
    if let stray = checked {
        reason = "the gain map read back \(HdrNumberFormat.toFixed(stray, 2)) stops off, so the plain JPEG left"
    } else {
        reason = "the Ultra HDR file could not be read back, so the plain JPEG left"
    }
    return UltraHdrResult(blob: sdrJpeg, ultra: false, headroom: map.headroom, checked: checked, reason: reason)
}
