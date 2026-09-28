// The pure half of `src/shared/hdr/ultra-hdr-export.ts` has no web spec (its
// twin is driven in a browser): this pins its rules over JPEG-shaped bytes,
// with a stub encoder and a stub decoder standing in for the browser's.

import XCTest
@testable import AtelierKit

/// A JPEG-shaped byte stream: SOI, a JFIF APP0, a quantisation table, a scan, EOI.
private func fakeJpeg(_ scanBytes: Int, seed: Int = 1) -> Data {
    let app0 = try! makeSegment(0xe0, Data([0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]))
    let dqt = try! makeSegment(0xdb, Data([UInt8](repeating: UInt8(seed), count: 65)))
    let sos = try! makeSegment(0xda, Data([1, 1, 0, 0, 63, 0]))
    var scan = [UInt8](repeating: 0, count: scanBytes)
    for i in 0..<scanBytes { scan[i] = UInt8((i * seed) & 0x7f) }
    var out = Data([0xff, 0xd8])
    out.append(app0)
    out.append(dqt)
    out.append(sos)
    out.append(contentsOf: scan)
    out.append(contentsOf: [0xff, 0xd9])
    return out
}

private let meta = GainMapMeta(
    gainMapMin: 0, gainMapMax: 2.25, gamma: 1, offsetSdr: 1.0 / 64, offsetHdr: 1.0 / 64, hdrCapacityMin: 0, hdrCapacityMax: 2.25
)

/// A `w × h` grey picture as a canvas reads it back (sRGB RGBA bytes) and in linear light.
private func sdrPicture(_ w: Int, _ h: Int, _ fill: (Int, Int) -> UInt8) -> (pixels: DecodedPixels, linear: LinearPicture) {
    var data = [UInt8](repeating: 255, count: w * h * 4)
    for y in 0..<h {
        for x in 0..<w {
            let v = fill(x, y)
            let i = (y * w + x) * 4
            data[i] = v
            data[i + 1] = v
            data[i + 2] = v
        }
    }
    return (DecodedPixels(width: w, height: h, data: data), linearFromBytes(data, width: w, height: h))
}

/// A `w × h` grey picture in linear light from a value per pixel.
private func linear(_ w: Int, _ h: Int, _ fill: (Int, Int) -> Double) -> LinearPicture {
    var data = [Float](repeating: 0, count: w * h * 3)
    for y in 0..<h {
        for x in 0..<w {
            let v = Float(fill(x, y))
            let i = (y * w + x) * 3
            data[i] = v
            data[i + 1] = v
            data[i + 2] = v
        }
    }
    return LinearPicture(width: w, height: h, data: data)
}

/// Whether these bytes are the whole file (whose XMP names the container) rather than the gain map alone.
private func isWholeFile(_ data: Data) -> Bool {
    String(decoding: data, as: UTF8.self).contains("Container:Directory")
}

/// The scene every case shares, the shape the web measured on (`hdr.md`): a
/// 16 × 8 picture whose left half ramps up and whose right half is a PATCH the
/// sensor holds at 1.5 — clipped to white in the SDR, delivered 2 stops darker.
/// A patch, not a ramp: the map is a quarter of the picture, and a cell that
/// straddles a gradient softens the peak by construction — the format's own
/// softening, not something a check should fail on.
private struct Scene {
    let width = 16
    let height = 8
    let stops = 2.0
    let sdr: (pixels: DecodedPixels, linear: LinearPicture)
    let darker: LinearPicture
    let sdrJpeg = fakeJpeg(300, seed: 3)

    static func light(_ x: Int) -> Double { x < 8 ? Double(x) / 8 : 1.5 }

    init() {
        sdr = sdrPicture(16, 8) { x, _ in
            UInt8((fromLinear(min(1, Scene.light(x)), .srgb) * 255).rounded())
        }
        darker = linear(16, 8) { x, _ in Scene.light(x) / 4 }
    }
}

final class GainMapPixelsTests: XCTestCase {
    func testDrawsTheCodesAsAGreyPictureForTheEncoder() {
        let map = GainMap(width: 2, height: 1, codes: [0, 200], meta: meta, headroom: 2.25)
        let px = gainMapPixels(map)
        XCTAssertEqual(px.width, 2)
        XCTAssertEqual(px.height, 1)
        XCTAssertEqual(px.data, [0, 0, 0, 255, 200, 200, 200, 255])
    }

    func testTheConstantsAreTheWebs() {
        XCTAssertEqual(gainMapScale, 4)
        XCTAssertEqual(gainMapQuality, 0.9)
        XCTAssertEqual(checkToleranceStops, 0.1)
    }
}

final class EncodeUltraHdrTests: XCTestCase {
    func testClaimsUltraHDROnlyAfterTheFileReadsBackAsWritten() throws {
        let scene = Scene()
        var mapPixels: DecodedPixels? = nil
        let result = try encodeUltraHdr(
            sdrJpeg: scene.sdrJpeg, sdr: scene.sdr.linear, darker: scene.darker, stops: scene.stops,
            encodeMap: { pixels in
                mapPixels = pixels
                return fakeJpeg(40, seed: 7)
            },
            decode: { data in isWholeFile(data) ? scene.sdr.pixels : mapPixels! }
        )
        XCTAssertTrue(result.ultra)
        XCTAssertNil(result.reason)
        // The patch reaches 1.5 above the SDR's white: ≈ 0.58 stops.
        assertClose(result.headroom, log2((1.5 + 1.0 / 64) / (1 + 1.0 / 64)), 2)
        let checked = try XCTUnwrap(result.checked)
        XCTAssertLessThan(checked, 0.01)
        // The map is a quarter of the picture on each side, its numbers in the file.
        let map = try XCTUnwrap(mapPixels)
        XCTAssertEqual(map.width, 4)
        XCTAssertEqual(map.height, 2)
        let parts = try XCTUnwrap(readUltraHdr(result.blob))
        assertClose(parts.meta.gainMapMax, result.headroom, 6)
        XCTAssertEqual(parts.foundBy, .mpf)
        XCTAssertEqual(Array(parts.primary.suffix(12)), Array(scene.sdrJpeg.suffix(12)))
    }

    func testLeavesThePlainJPEGWhenThePictureHadNothingAboveWhite() throws {
        let scene = Scene()
        // A darker render that agrees with the SDR everywhere: lifted back, it is the SDR.
        let sdrLinear = scene.sdr.linear
        var agreeing = sdrLinear
        agreeing.data = sdrLinear.data.map { $0 / 4 }
        var encoded = false
        let result = try encodeUltraHdr(
            sdrJpeg: scene.sdrJpeg, sdr: sdrLinear, darker: agreeing, stops: 2,
            encodeMap: { _ in
                encoded = true
                return fakeJpeg(40)
            },
            decode: { _ in scene.sdr.pixels }
        )
        XCTAssertFalse(result.ultra)
        XCTAssertEqual(result.blob, scene.sdrJpeg)
        XCTAssertEqual(result.headroom, 0)
        XCTAssertNil(result.checked)
        XCTAssertEqual(result.reason, "nothing above white in this picture")
        XCTAssertFalse(encoded)
    }

    func testLeavesThePlainJPEGAndSaysByHowMuchWhenTheMapReadsBackOff() throws {
        let scene = Scene()
        // A decoder that hands back a flat map: every code strayed to 0.
        let result = try encodeUltraHdr(
            sdrJpeg: scene.sdrJpeg, sdr: scene.sdr.linear, darker: scene.darker, stops: scene.stops,
            encodeMap: { _ in fakeJpeg(40, seed: 7) },
            decode: { data in
                if isWholeFile(data) { return scene.sdr.pixels }
                var zeros = [UInt8](repeating: 0, count: 4 * 2 * 4)
                var i = 3
                while i < zeros.count { zeros[i] = 255; i += 4 }
                return DecodedPixels(width: 4, height: 2, data: zeros)
            }
        )
        XCTAssertFalse(result.ultra)
        XCTAssertEqual(result.blob, scene.sdrJpeg)
        // A code that strays by the whole span is the whole headroom, in stops.
        let checked = try XCTUnwrap(result.checked)
        assertClose(checked, result.headroom, 6)
        XCTAssertGreaterThan(checked, checkToleranceStops)
        XCTAssertEqual(result.reason, "the gain map read back \(HdrNumberFormat.toFixed(checked, 2)) stops off, so the plain JPEG left")
    }

    func testLeavesThePlainJPEGWhenTheFileCannotBeReadBack() throws {
        struct Refused: Error {}
        let scene = Scene()
        let result = try encodeUltraHdr(
            sdrJpeg: scene.sdrJpeg, sdr: scene.sdr.linear, darker: scene.darker, stops: scene.stops,
            encodeMap: { _ in fakeJpeg(40, seed: 7) },
            decode: { _ in throw Refused() }
        )
        XCTAssertFalse(result.ultra)
        XCTAssertEqual(result.blob, scene.sdrJpeg)
        XCTAssertNil(result.checked)
        XCTAssertGreaterThan(result.headroom, 0.5)
        XCTAssertEqual(result.reason, "the Ultra HDR file could not be read back, so the plain JPEG left")
    }

    func testTwoRenditionsOfDifferentSizesAreRefusedOutright() {
        let scene = Scene()
        XCTAssertThrowsError(try encodeUltraHdr(
            sdrJpeg: scene.sdrJpeg, sdr: scene.sdr.linear, darker: linear(4, 4) { _, _ in 0 }, stops: 2,
            encodeMap: { _ in fakeJpeg(40) }, decode: { _ in scene.sdr.pixels }
        ))
    }
}

final class CheckUltraHdrTests: XCTestCase {
    func testAnswersNilWhenTheNumbersOrTheSizesDoNotMatchWhatWasWritten() throws {
        let scene = Scene()
        let hdr = try hdrRendition(scene.sdr.linear, scene.darker, stops: scene.stops)
        let map = try encodeGainMap(scene.sdr.linear, hdr, scale: gainMapScale, maxStops: scene.stops)
        let mapPixels = gainMapPixels(map)
        let file = try wrapUltraHdr(scene.sdrJpeg, fakeJpeg(40, seed: 7), map.meta)
        let decoder: JpegDecoder = { data in isWholeFile(data) ? scene.sdr.pixels : mapPixels }
        // As written: within an ulp of the rendition.
        let stray = try XCTUnwrap(try checkUltraHdr(file, map, hdr, decode: decoder))
        XCTAssertLessThan(stray, 0.01)
        // Numbers that are not the file's.
        var other = map
        other.meta.gainMapMax += 0.5
        XCTAssertNil(try checkUltraHdr(file, other, hdr, decode: decoder))
        // A base that decodes at another size.
        let small = sdrPicture(8, 8) { _, _ in 128 }
        XCTAssertNil(try checkUltraHdr(file, map, hdr, decode: { _ in small.pixels }))
        // A plain JPEG is not an Ultra HDR file.
        XCTAssertNil(try checkUltraHdr(scene.sdrJpeg, map, hdr, decode: decoder))
    }
}
