// Port of `src/shared/hdr/ultra-hdr.test.ts`. The web spec builds its signed
// base through `withXmpPacket`, `deliveryXmp`, `withIccProfile` and
// `readIccProfile` (`shared/exif/`), which the kernel does not carry yet: the
// four are re-made here as test-local twins that splice the same segments at
// the same places, so the case reads the same bytes.

import XCTest
@testable import AtelierKit

/// A JPEG-shaped byte stream: SOI, a JFIF APP0, a quantisation table, a scan, EOI.
private func fakeJpeg(_ scanBytes: Int, seed: Int = 1) -> Data {
    let app0 = try! makeSegment(0xe0, Data([0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]))
    let dqt = try! makeSegment(0xdb, Data([UInt8](repeating: UInt8(seed), count: 65)))
    let sos = try! makeSegment(0xda, Data([1, 1, 0, 0, 63, 0]))
    var scan = [UInt8](repeating: 0, count: scanBytes)
    for i in 0..<scanBytes { scan[i] = UInt8((i * seed) & 0x7f) } // never 0xFF
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

private func packetText(_ data: Data) -> String {
    String(decoding: data, as: UTF8.self)
}

// MARK: - the EXIF module's twins, for the folded-packet case

/// `delivery-meta.ts`'s `deliveryXmp` for a creator and a copyright: the signature, `dc:creator`, `dc:rights`.
private func testDeliveryXmp(creator: String, copyright: String) -> String {
    "<?xpacket begin=\"\u{FEFF}\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?>"
        + "<x:xmpmeta xmlns:x=\"adobe:ns:meta/\" x:xmptk=\"Atelier\">"
        + "<rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">"
        + "<rdf:Description rdf:about=\"\" xmlns:xmp=\"http://ns.adobe.com/xap/1.0/\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\""
        + " xmlns:xmpRights=\"http://ns.adobe.com/xap/1.0/rights/\" xmp:CreatorTool=\"Atelier\" xmpRights:Marked=\"True\">"
        + "<dc:creator><rdf:Seq><rdf:li>\(creator)</rdf:li></rdf:Seq></dc:creator>"
        + "<dc:rights><rdf:Alt><rdf:li xml:lang=\"x-default\">\(copyright)</rdf:li></rdf:Alt></dc:rights>"
        + "</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end=\"w\"?>"
}

/// `exif-block.ts`'s `withXmpPacket`: an APP1 after a leading JFIF APP0 (a fake carries no EXIF).
private func testWithXmpPacket(_ jpeg: Data, _ packet: String) -> Data {
    let header = Array("http://ns.adobe.com/xap/1.0/\0".utf8)
    let segment = try! makeSegment(0xe1, Data(header + Array(packet.utf8)))
    let segs = jpegSegments(jpeg)!
    let insertAt = segs.first?.marker == 0xe0 ? segs[0].start + segs[0].length : 2
    return jpeg.prefix(insertAt) + segment + jpeg.dropFirst(insertAt)
}

private let iccId = Array("ICC_PROFILE\0".utf8)

/// `icc-srgb.ts`'s `withIccProfile`: an APP2 (`ICC_PROFILE\0`, 1 of 1, the profile) after the leading APP0/APP1 run.
private func testWithIccProfile(_ jpeg: Data, _ profile: [UInt8]) -> Data {
    let segment = try! makeSegment(0xe2, Data(iccId + [1, 1] + profile))
    var insertAt = 2
    for s in jpegSegments(jpeg)! {
        if s.marker != 0xe0 && s.marker != 0xe1 { break }
        insertAt = s.start + s.length
    }
    return jpeg.prefix(insertAt) + segment + jpeg.dropFirst(insertAt)
}

/// `icc-srgb.ts`'s `readIccProfile`: the profile out of the first APP2 that holds one.
private func testReadIccProfile(_ jpeg: Data) -> Data? {
    guard let segs = jpegSegments(jpeg) else { return nil }
    for s in segs where s.marker == 0xe2 && s.data.count >= iccId.count + 2 && Array(s.data.prefix(iccId.count)) == iccId {
        return s.data.dropFirst(iccId.count + 2)
    }
    return nil
}

// MARK: - the specs

final class JpegSegmentsTests: XCTestCase {
    func testWalksTheMarkersUpToTheScanAndRefusesWhatIsNotAJPEG() throws {
        let segs = try XCTUnwrap(jpegSegments(fakeJpeg(40)))
        XCTAssertEqual(segs.map(\.marker), [0xe0, 0xdb])
        XCTAssertEqual(segs[0].start, 2)
        XCTAssertEqual(segs[1].start, 2 + segs[0].length)
        XCTAssertNil(jpegSegments(Data([1, 2, 3])))
        XCTAssertTrue(isJpeg(fakeJpeg(4)))
        XCTAssertFalse(isJpeg(Data([0x89, 0x50])))
    }
}

final class UltraHdrXmpTests: XCTestCase {
    func testNameTheTwoItemsAndCarryTheNumbersBackOut() {
        let primary = primaryXmp(1234)
        XCTAssertTrue(primary.contains("Item:Semantic=\"Primary\""))
        XCTAssertTrue(primary.contains("Item:Semantic=\"GainMap\" Item:Mime=\"image/jpeg\" Item:Length=\"1234\""))
        XCTAssertTrue(primary.contains("hdrgm:Version=\"1.0\""))
        let map = gainMapXmp(meta)
        XCTAssertTrue(map.contains("hdrgm:GainMapMax=\"2.25\""))
        XCTAssertTrue(map.contains("hdrgm:OffsetSDR=\"0.015625\""))
        XCTAssertEqual(parseGainMapMeta(map), meta)
        XCTAssertNil(parseGainMapMeta("<x/>"))
    }
}

final class MpfSegmentTests: XCTestCase {
    func testIsAFixedSizeBigEndianTIFFWhoseSecondEntrySaysWhereTheGainMapIs() {
        let seg = mpfSegment(primarySize: 5000, secondarySize: 700, secondaryOffset: 4990)
        XCTAssertEqual(seg.count, mpfSegmentLength)
        XCTAssertEqual(mpfSegmentLength, 90)
        XCTAssertEqual(seg[0], 0xff)
        XCTAssertEqual(seg[1], 0xe2)
        XCTAssertEqual(parseMpf(seg.dropFirst(4)), MpfSecondary(size: 700, offset: 4990, headerAt: 4))
        XCTAssertNil(parseMpf(Data([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])))
    }
}

final class WrapReadUltraHdrTests: XCTestCase {
    func testWritesAFileEveryDecoderReadsAsTheBaseAndReadsTheGainMapBackByItsMPFEntry() throws {
        let base = fakeJpeg(300, seed: 3)
        let map = fakeJpeg(50, seed: 5)
        let file = try wrapUltraHdr(base, map, meta)
        // Starts like the base, and the base's own segments are still in order.
        XCTAssertTrue(isJpeg(file))
        let segs = try XCTUnwrap(jpegSegments(file))
        XCTAssertEqual(segs.map(\.marker), [0xe0, 0xe1, 0xe2, 0xdb])
        let parts = try XCTUnwrap(readUltraHdr(file))
        XCTAssertEqual(parts.foundBy, .mpf)
        XCTAssertEqual(parts.meta, meta)
        // The gain map is the given one with its XMP inserted after the JFIF.
        let mapSegs = try XCTUnwrap(jpegSegments(parts.gainMap))
        XCTAssertEqual(mapSegs.map(\.marker), [0xe0, 0xe1, 0xdb])
        XCTAssertEqual(parts.gainMap.last, 0xd9)
        XCTAssertEqual(parts.gainMap.count + parts.primary.count, file.count)
        // The base ends at its own EOI, and the scan bytes are untouched.
        XCTAssertEqual(parts.primary.last, 0xd9)
        XCTAssertEqual(parts.primary.count, base.count + segs[1].length + mpfSegmentLength)
        XCTAssertEqual(Array(parts.primary.suffix(12)), Array(base.suffix(12)))
        // The directory's Length is the gain map's real length.
        XCTAssertTrue(packetText(segs[1].data).contains("Item:Length=\"\(parts.gainMap.count)\""))
    }

    func testFoldsAPacketTheBaseAlreadyCarriedIntoItsOwnSoTheFileKeepsONE() throws {
        let stamped = testWithXmpPacket(fakeJpeg(200, seed: 3), testDeliveryXmp(creator: "Steeve Pommier", copyright: "© 2026 Steeve Pommier."))
        let signed = testWithIccProfile(stamped, [1, 2, 3, 4])
        let file = try wrapUltraHdr(signed, fakeJpeg(40, seed: 5), meta)
        let segs = try XCTUnwrap(jpegSegments(file))
        let xmps = segs.filter { $0.marker == 0xe1 && packetText($0.data).hasPrefix("http://ns.adobe.com/xap/1.0/") }
        XCTAssertEqual(xmps.count, 1)
        let packet = packetText(xmps[0].data)
        XCTAssertTrue(packet.contains("xmp:CreatorTool=\"Atelier\""))
        XCTAssertTrue(packet.contains("<rdf:li>Steeve Pommier</rdf:li>"))
        XCTAssertTrue(packet.contains("Item:Semantic=\"GainMap\""))
        let parts = try XCTUnwrap(readUltraHdr(file))
        XCTAssertEqual(parts.foundBy, .mpf)
        XCTAssertEqual(parts.gainMap.count + parts.primary.count, file.count)
        // The base's colour profile rides through the container untouched.
        XCTAssertNotNil(testReadIccProfile(parts.primary))
    }

    func testFallsBackToTheDirectoryLengthWhenTheMPFSegmentIsGoneAndRefusesAPlainJPEG() throws {
        let base = fakeJpeg(120, seed: 2)
        let map = fakeJpeg(30, seed: 4)
        let file = try wrapUltraHdr(base, map, meta)
        // Strip the MPF segment (a re-save by a tool that drops APP2 would).
        let segs = try XCTUnwrap(jpegSegments(file))
        let mpf = try XCTUnwrap(segs.first { $0.marker == 0xe2 })
        let stripped = file.prefix(mpf.start) + file.dropFirst(mpf.start + mpf.length)
        let parts = try XCTUnwrap(readUltraHdr(stripped))
        XCTAssertEqual(parts.foundBy, .length)
        XCTAssertEqual(parts.meta.gainMapMax, 2.25)
        XCTAssertEqual(parts.gainMap.first, 0xff)
        XCTAssertNil(readUltraHdr(base))
        XCTAssertNil(readUltraHdr(Data([0, 1])))
    }

    func testRefusesWhatIsNotAJPEGAndASegmentThatWouldNotFit() {
        XCTAssertThrowsError(try wrapUltraHdr(Data([1, 2, 3]), fakeJpeg(10), meta)) { error in
            XCTAssertEqual(error as? UltraHdrError, .notJpeg)
        }
        XCTAssertThrowsError(try makeSegment(0xe1, Data(count: 0xfffe))) { error in
            XCTAssertEqual(error as? UltraHdrError, .segmentTooLong)
        }
    }
}
