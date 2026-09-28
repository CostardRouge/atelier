// Port of `src/shared/exif/stamp-exif.test.ts`, plus this port's own goldens:
// four delivered JPEGs stamped by the web module, byte for byte.
//
// The web defaults a missing `fallbackYear` to the clock; the port takes the
// clock as `now` (ms), fixed here in 2026 — no case below depends on it but
// the ones the web also pins with a capture date or a `fallbackYear`.

import Foundation
import XCTest
@testable import AtelierKit

private let me = DeliveryIdentity(creator: "Steeve Pommier", copyright: "© {year} {creator}. All rights reserved.")

private let delivered = DeliveredSize(width: 1920, height: 1440)

/// 2026-09-21, in any time zone.
private let now = 1_790_000_000_000.0

private func choose(_ head: [UInt8]?, _ vouched: ExifData?, _ author: AuthorMeta = AuthorMeta()) -> ExportExif {
    exportExifBlock(head, vouched, delivered, author, now: now)
}

/// A JPEG with no metadata — what an encoder hands over.
private func canvasJpeg() -> [UInt8] {
    [0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0x07, 0x08, 0xff, 0xd9]
}

/// A camera JPEG: its EXIF, whole.
private func cameraJpeg(_ exif: ExifData) -> [UInt8] {
    try! withExifBlock(canvasJpeg(), buildExifBlock(exif))
}

/// A DNG: a TIFF stream, so its block cannot be moved — only its fields read.
private func dngHead(_ exif: ExifData) -> [UInt8] {
    buildExifBlock(exif)
}

private let capture = exifData {
    $0.make = "DJI"
    $0.model = "FC8482"
    $0.lensModel = "24mm f/1.7"
    $0.iso = 100
    $0.exposureTime = 0.005
    $0.fNumber = 1.7
    $0.dateTimeOriginal = "2026:07:14 18:32:05"
    $0.gps = GpsCoord(lat: 64.1466, lon: -21.9426)
    $0.gpsAltitude = 128.4
    $0.orientation = 6
    $0.pixelWidth = 8064
    $0.pixelHeight = 6048
}

/// What Winnow's row carries: no make, no model, no lens.
private let vouched = exifData {
    $0.iso = 100
    $0.exposureTime = 0.005
    $0.fNumber = 1.7
    $0.dateTimeOriginal = "2026:07:14 18:32:05"
    $0.gps = GpsCoord(lat: 64.1466, lon: -21.9426)
    $0.gpsAltitude = 128.4
}

private func with(_ exif: ExifData, _ change: (inout ExifData) -> Void) -> ExifData {
    var copy = exif
    change(&copy)
    return copy
}

private func read(_ chosen: ExportExif) -> ExifData {
    parseExif(chosen.block ?? [])
}

private func preset(_ id: MetaPresetId) -> MetaChoice {
    metaPresets.first { $0.id == id }!.choice
}

final class ExportExifBlockTests: XCTestCase {
    func testCopiesTheOriginalJpegsOwnBlockAndSaysSo() {
        let chosen = choose(cameraJpeg(capture), vouched)
        XCTAssertEqual(chosen.account, .block)
        let r = read(chosen)
        XCTAssertEqual(r.make, "DJI")
        XCTAssertEqual(r.lensModel, "24mm f/1.7")
        // Corrected on the way: the picture is delivered the way up it was looked at.
        XCTAssertEqual(r.orientation, 1)
        XCTAssertEqual(r.pixelWidth, 1920)
        XCTAssertEqual(r.pixelHeight, 1440)
    }

    func testMarksEveryAccountAsOursTheCopiedBlockIncluded() {
        // The copied block is the one that had no mark: it was the camera's.
        let copied = choose(cameraJpeg(with(capture) { $0.software = "v01.00.0800" }), nil)
        XCTAssertEqual(copied.account, .block)
        XCTAssertEqual(read(copied).software, "Atelier")
        XCTAssertEqual(read(choose(cameraJpeg(capture), nil)).software, "Atelier")
        XCTAssertEqual(read(choose(dngHead(capture), nil)).software, "Atelier")
        XCTAssertEqual(read(choose(nil, vouched)).software, "Atelier")
    }

    func testRebuildsFromARawsFieldsWhoseBlockIsTheWholeFile() {
        let chosen = choose(dngHead(capture), vouched)
        XCTAssertEqual(chosen.account, .fields)
        let r = read(chosen)
        XCTAssertEqual(r.make, "DJI")
        assertClose(r.gps?.lat ?? .nan, 64.1466, 6)
        XCTAssertEqual(r.orientation, 1)
        XCTAssertEqual(r.pixelWidth, 1920)
    }

    func testLetsTheOriginalFillWhatTheSourceDoesNotKnowAndNeverTheOtherWayRound() {
        let head = dngHead(with(capture) { $0.iso = 800 })
        let r = read(choose(head, with(vouched) { $0.iso = 100 }))
        // The file wins on a field both hold; the source is only read where it is silent.
        XCTAssertEqual(r.iso, 800)
        XCTAssertEqual(r.make, "DJI")
    }

    func testFallsBackToWhatTheSourceVouchedForWhenTheOriginalIsOutOfReach() {
        let chosen = choose(nil, vouched)
        XCTAssertEqual(chosen.account, .vouched)
        let r = read(chosen)
        assertClose(r.gps?.lon ?? .nan, -21.9426, 6)
        XCTAssertEqual(r.iso, 100)
        // The poorest account: Winnow's row carries no body.
        XCTAssertNil(r.make)
    }

    func testStillSignsAPictureNothingIsKnownAboutABlockOfTheSignatureAlone() {
        let none = choose(nil, nil)
        XCTAssertEqual(none.account, .none)
        let r = read(none)
        XCTAssertEqual(r.software, "Atelier")
        XCTAssertNil(r.make)
        XCTAssertNil(r.gps)
        XCTAssertTrue(none.xmp.contains("xmp:CreatorTool=\"Atelier\""))
        XCTAssertEqual(choose(canvasJpeg(), nil).account, .none)
        XCTAssertEqual(choose([], ExifData()).account, .none)
    }

    func testWritesNoRightsUntilTheAuthorHasAName() {
        let chosen = choose(cameraJpeg(capture), nil, AuthorMeta(identity: DeliveryIdentity(creator: "  ", copyright: me.copyright)))
        XCTAssertEqual(chosen.rights, DeliveryRights(creator: nil, copyright: nil))
        XCTAssertNil(read(chosen).copyright)
        XCTAssertFalse(chosen.xmp.contains("dc:rights"))
    }

    func testSignsWithTheCapturesYearOnEveryAccount() {
        let author = AuthorMeta(identity: me, fallbackYear: 2031)
        for chosen in [
            choose(cameraJpeg(capture), nil, author),
            choose(dngHead(capture), nil, author),
            choose(nil, capture, author),
        ] {
            let r = read(chosen)
            XCTAssertEqual(r.artist, "Steeve Pommier")
            XCTAssertEqual(r.copyright, "© 2026 Steeve Pommier. All rights reserved.")
            XCTAssertTrue(chosen.xmp.contains("<dc:creator><rdf:Seq><rdf:li>Steeve Pommier</rdf:li></rdf:Seq></dc:creator>"))
            XCTAssertTrue(chosen.xmp.contains("© 2026 Steeve Pommier. All rights reserved."))
        }
        // No capture time: the export's own year.
        let none = choose(nil, nil, author)
        XCTAssertEqual(read(none).copyright, "© 2031 Steeve Pommier. All rights reserved.")
    }

    func testWritesTheAuthorOverTheCamerasOwnOwnerSettingAndKeepsTheMakersBlockAroundIt() {
        let owned = cameraJpeg(with(capture) { $0.artist = "CAMERA OWNER"; $0.copyright = "x" })
        let r = read(choose(owned, nil, AuthorMeta(identity: me)))
        XCTAssertEqual(r.artist, "Steeve Pommier")
        XCTAssertEqual(r.copyright, "© 2026 Steeve Pommier. All rights reserved.")
        XCTAssertEqual(r.model, "FC8482")
        XCTAssertEqual(r.software, "Atelier")
    }

    /// This port's own: the web's `new Date().getFullYear()` is the `now` handed in.
    func testDatesAPictureNobodyKnowsTheCaptureTimeOfByTheClockItIsGiven() {
        let r = read(choose(nil, nil, AuthorMeta(identity: me)))
        XCTAssertEqual(r.copyright, "© 2026 Steeve Pommier. All rights reserved.")
    }
}

final class ExportExifBlockWordsTests: XCTestCase {
    func testWritesTheCaptionAsImageDescriptionAndBothWordsInTheXmpOnEveryAccount() {
        let words = AuthorMeta(title: "Pinnacles", caption: "Nambung, at dawn — “limestone” & sand")
        for chosen in [
            choose(cameraJpeg(with(capture) { $0.imageDescription = "SONY DSC" }), nil, words),
            choose(dngHead(capture), nil, words),
            choose(nil, nil, words),
        ] {
            XCTAssertEqual(read(chosen).imageDescription, words.caption)
            XCTAssertTrue(chosen.xmp.contains("<dc:title><rdf:Alt><rdf:li xml:lang=\"x-default\">Pinnacles</rdf:li></rdf:Alt></dc:title>"))
            XCTAssertTrue(chosen.xmp.contains(
                "<dc:description><rdf:Alt><rdf:li xml:lang=\"x-default\">Nambung, at dawn — “limestone” &amp; sand</rdf:li></rdf:Alt></dc:description>"
            ))
        }
    }

    func testKeepsTheCapturesOwnDescriptionWhenThePictureHasNoCaption() {
        let chosen = choose(cameraJpeg(with(capture) { $0.imageDescription = "from the body" }), nil, AuthorMeta(caption: "  "))
        XCTAssertEqual(read(chosen).imageDescription, "from the body")
        XCTAssertFalse(chosen.xmp.contains("dc:description"))
    }
}

final class ExportExifBlockWhatLeavesTests: XCTestCase {
    private func words(_ keep: MetaChoice) -> AuthorMeta {
        AuthorMeta(identity: me, title: "T", caption: "C", keep: keep)
    }

    func testCopiesTheBlockWholeUnderAllMakerNoteAndAll() {
        let chosen = choose(cameraJpeg(capture), nil, words(allMeta))
        XCTAssertEqual(chosen.account, .block)
    }

    func testShareOnlineRebuildsWithoutThePositionKeepingTheBodyAndTheExposure() {
        let chosen = choose(cameraJpeg(capture), nil, words(preset(.share)))
        XCTAssertEqual(chosen.account, .fields)
        let r = read(chosen)
        XCTAssertNil(r.gps)
        XCTAssertNil(r.gpsAltitude)
        XCTAssertEqual(r.model, "FC8482")
        XCTAssertEqual(r.iso, 100)
        XCTAssertEqual(r.dateTimeOriginal, "2026:07:14 18:32:05")
        XCTAssertEqual(r.copyright, "© 2026 Steeve Pommier. All rights reserved.")
        XCTAssertEqual(r.imageDescription, "C")
        XCTAssertEqual(r.software, "Atelier")
    }

    func testMinimalLeavesTheRightsAndTheSignatureAloneNoWordsNoCapture() {
        for head in [cameraJpeg(capture), dngHead(capture)] {
            let chosen = choose(head, vouched, words(preset(.minimal)))
            let r = read(chosen)
            XCTAssertNil(r.make)
            XCTAssertNil(r.model)
            XCTAssertNil(r.iso)
            XCTAssertNil(r.gps)
            XCTAssertNil(r.dateTimeOriginal)
            XCTAssertNil(r.imageDescription)
            XCTAssertEqual(r.software, "Atelier")
            // The year still comes from the capture, even though its time does not leave.
            XCTAssertEqual(r.copyright, "© 2026 Steeve Pommier. All rights reserved.")
            XCTAssertFalse(chosen.xmp.contains("dc:title"))
        }
    }

    func testAGroupLeftOutClearsTheCamerasOwnValueEvenOnAWholeCopy() {
        let owned = cameraJpeg(with(capture) { $0.artist = "CAMERA OWNER"; $0.copyright = "owner"; $0.imageDescription = "SONY DSC" })
        let chosen = choose(owned, nil, AuthorMeta(identity: me, keep: MetaChoice(words: false, rights: false)))
        XCTAssertEqual(chosen.account, .block)
        let r = read(chosen)
        XCTAssertNil(r.artist)
        XCTAssertNil(r.copyright)
        XCTAssertNil(r.imageDescription)
        XCTAssertFalse(chosen.xmp.contains("dc:rights"))
        assertClose(r.gps?.lat ?? .nan, 64.1466, 6)
    }
}

final class ExportExifBlockPlaceTests: XCTestCase {
    private let placeOf: (GpsCoord) -> DeliveryPlace? = { _ in
        DeliveryPlace(city: "Reykjavik", country: "Iceland", countryCode: "IS")
    }

    func testNamesThePlaceFromTheCapturesOwnPositionEvenWhenThatPositionStaysHome() {
        let chosen = choose(cameraJpeg(capture), nil, AuthorMeta(keep: preset(.share), placeOf: placeOf))
        XCTAssertNil(read(chosen).gps)
        XCTAssertEqual(chosen.place?.city, "Reykjavik")
        XCTAssertTrue(chosen.xmp.contains("photoshop:City=\"Reykjavik\""))
        XCTAssertTrue(chosen.xmp.contains("photoshop:Country=\"Iceland\""))
        XCTAssertTrue(chosen.xmp.contains("Iptc4xmpCore:CountryCode=\"IS\""))
    }

    func testWritesNoneWhenTheGroupIsOffWhenNothingIsNearOrWhenThereIsNoPosition() {
        let off = choose(cameraJpeg(capture), nil, AuthorMeta(keep: MetaChoice(place: false), placeOf: placeOf))
        XCTAssertFalse(off.xmp.contains("photoshop:City"))
        let far = choose(cameraJpeg(capture), nil, AuthorMeta(placeOf: { _ in nil }))
        XCTAssertNil(far.place)
        XCTAssertTrue(far.located)
        let nowhere = choose(cameraJpeg(exifData { $0.make = "DJI" }), nil, AuthorMeta(placeOf: placeOf))
        XCTAssertNil(nowhere.place)
        XCTAssertFalse(nowhere.located)
        // A country alone writes no city.
        let country = choose(cameraJpeg(capture), nil, AuthorMeta(placeOf: { _ in
            DeliveryPlace(city: "", country: "Iceland", countryCode: "IS")
        }))
        XCTAssertFalse(country.xmp.contains("photoshop:City"))
        XCTAssertTrue(country.xmp.contains("photoshop:Country=\"Iceland\""))
        // A vouched position names a place too.
        XCTAssertEqual(choose(nil, vouched, AuthorMeta(placeOf: placeOf)).place?.city, "Reykjavik")
    }
}

final class StampExifTests: XCTestCase {
    func testHandsBackAJpegTheReaderFindsTheCaptureIn() throws {
        let chosen = choose(cameraJpeg(capture), nil)
        let out = try stampExif(canvasJpeg(), chosen, delivered)
        let r = parseExif(out)
        XCTAssertEqual(r.model, "FC8482")
        assertClose(r.gps?.lat ?? .nan, 64.1466, 6)
        // The web's `Blob` says `image/jpeg`; bytes say it by their SOI.
        XCTAssertTrue(isJpeg(Data(out)))
    }

    func testSignsAPictureWithNothingElseToSayInTheExifAndTheXmp() throws {
        let out = try stampExif(canvasJpeg(), choose(nil, nil, AuthorMeta(identity: me)), delivered)
        XCTAssertEqual(parseExif(out).software, "Atelier")
        XCTAssertEqual(parseExif(out).artist, "Steeve Pommier")
        let xmp = try XCTUnwrap(readXmpPacket(out))
        XCTAssertTrue(xmp.contains("xmp:CreatorTool=\"Atelier\""))
        // And the colour space the pixels are in.
        XCTAssertEqual(readIccProfile(out), srgbIcc())
        XCTAssertTrue(xmp.contains("<rdf:li>Steeve Pommier</rdf:li>"))
    }

    func testRebuildsRatherThanDropsABlockNoSegmentCouldHold() throws {
        // A copied block can be larger than a JPEG segment; what can be read
        // of it still has to travel.
        var huge = [UInt8](repeating: 0, count: 70_000)
        let built = buildExifBlock(capture)
        huge.replaceSubrange(0..<built.count, with: built)
        let out = try stampExif(
            canvasJpeg(),
            ExportExif(block: huge, account: .block, rights: DeliveryRights(), tags: AuthorTags(),
                       keep: allMeta, place: nil, located: true, xmp: ""),
            delivered
        )
        let r = parseExif(out)
        XCTAssertEqual(r.make, "DJI")
        assertClose(r.gps?.lat ?? .nan, 64.1466, 6)
    }
}

final class ExifAccountTextTests: XCTestCase {
    func testNamesEachAccountSoAPanelNeverPresentsARowAsTheFilesOwn() {
        XCTAssertTrue(exifAccountText(.block).contains("copied whole"))
        XCTAssertTrue(exifAccountText(.fields).contains("rebuilt"))
        XCTAssertTrue(exifAccountText(.vouched).contains("the source knows"))
        XCTAssertTrue(exifAccountText(.none).contains("no camera EXIF"))
    }
}

/// Hex text as bytes — the goldens below were written by the web module itself.
private func hexBytes(_ hex: String) -> [UInt8] {
    var out: [UInt8] = []
    var it = hex.makeIterator()
    while let hi = it.next(), let lo = it.next() { out.append(UInt8(String([hi, lo]), radix: 16)!) }
    return out
}

/// This port's own cases: a delivered JPEG is the BROWSER's, byte for byte —
/// EXIF block, XMP packet and ICC profile, in the same segments at the same
/// offsets. Each golden is `stampExif(canvasJpeg, exportExifBlock(…), delivered)`
/// as `stamp-exif.ts` wrote it, over one account each.
final class StampExifGoldenTests: XCTestCase {
    private let author = AuthorMeta(
        identity: me, fallbackYear: 2031, title: "Pinnacles", caption: "Nambung, at dawn",
        placeOf: { _ in DeliveryPlace(city: "Reykjavik", country: "Iceland", countryCode: "IS") }
    )
    private let camera = cameraJpeg(with(capture) { $0.artist = "CAMERA OWNER"; $0.software = "v01.00.0800" })

    private func stamped(_ head: [UInt8]?, _ vouched: ExifData?, _ author: AuthorMeta) throws -> (ExifAccount, [UInt8]) {
        let chosen = choose(head, vouched, author)
        return (chosen.account, try stampExif(canvasJpeg(), chosen, delivered))
    }

    func testTheCopiedBlockLeavesAsTheWebWritesIt() throws {
        let (account, out) = try stamped(camera, vouched, author)
        XCTAssertEqual(account, .block)
        XCTAssertEqual(out, hexBytes(goldenBlock))
    }

    func testTheRebuiltBlockLeavesAsTheWebWritesIt() throws {
        var share = author
        share.keep = preset(.share)
        let (account, out) = try stamped(camera, vouched, share)
        XCTAssertEqual(account, .fields)
        XCTAssertEqual(out, hexBytes(goldenShare))
    }

    func testARawsFieldsLeaveAsTheWebWritesThem() throws {
        let (account, out) = try stamped(dngHead(capture), vouched, author)
        XCTAssertEqual(account, .fields)
        XCTAssertEqual(out, hexBytes(goldenDng))
    }

    func testThePictureNobodyKnowsLeavesAsTheWebWritesIt() throws {
        let (account, out) = try stamped(nil, nil, AuthorMeta(identity: me, fallbackYear: 2031))
        XCTAssertEqual(account, .none)
        XCTAssertEqual(out, hexBytes(goldenNone))
    }
}

private let goldenBlock = [
        "ffd8ffe102a245786966000049492a00d801000007000f01020004000000444a490010010200070000003a0100001201030001000000010000003101",
        "02000c000000420100003b0102000d0000004e0100006987040001000000620000002588040001000000e0000000000000000a009a82050001000000",
        "5c0100009d820500010000006401000027880300010000006400000000900700040000003032333203900200140000006c0100000490020014000000",
        "8001000001a00300010000000100000002a00400010000008007000003a0040001000000a005000034a402000b000000940100000000000007000000",
        "0100040000000203000001000200020000004e0000000200050003000000a00100000300020002000000570000000400050003000000b80100000500",
        "010001000000000000000600050001000000d00100000000000046433834383200004174656c696572000000000043414d455241204f574e45520000",
        "01000000c8000000110000000a000000323032363a30373a31342031383a33323a303500323032363a30373a31342031383a33323a30350032346d6d",
        "20662f312e37000040000000010000000800000001000000a04907001027000015000000010000003800000001000000201705001027000082020000",
        "0500000009000e010200110000004a0200000f01020004000000444a490010010200070000003a010000120103000100000001000000310102000c00",
        "0000420100003b0102000f0000005c020000988202002d0000006c0200006987040001000000620000002588040001000000e0000000000000004e61",
        "6d62756e672c206174206461776e000053746565766520506f6d6d6965720000c2a920323032362053746565766520506f6d6d6965722e20416c6c20",
        "7269676874732072657365727665642e0000ffe10434687474703a2f2f6e732e61646f62652e636f6d2f7861702f312e302f003c3f787061636b6574",
        "20626567696e3d22efbbbf222069643d2257354d304d7043656869487a7265537a4e54637a6b633964223f3e3c783a786d706d65746120786d6c6e73",
        "3a783d2261646f62653a6e733a6d6574612f2220783a786d70746b3d224174656c696572223e3c7264663a52444620786d6c6e733a7264663d226874",
        "74703a2f2f7777772e77332e6f72672f313939392f30322f32322d7264662d73796e7461782d6e7323223e3c7264663a4465736372697074696f6e20",
        "7264663a61626f75743d222220786d6c6e733a786d703d22687474703a2f2f6e732e61646f62652e636f6d2f7861702f312e302f2220786d6c6e733a",
        "64633d22687474703a2f2f7075726c2e6f72672f64632f656c656d656e74732f312e312f2220786d6c6e733a786d705269676874733d22687474703a",
        "2f2f6e732e61646f62652e636f6d2f7861702f312e302f7269676874732f2220786d6c6e733a70686f746f73686f703d22687474703a2f2f6e732e61",
        "646f62652e636f6d2f70686f746f73686f702f312e302f2220786d6c6e733a4970746334786d70436f72653d22687474703a2f2f697074632e6f7267",
        "2f7374642f4970746334786d70436f72652f312e302f786d6c6e732f2220786d703a43726561746f72546f6f6c3d224174656c6965722220786d7052",
        "69676874733a4d61726b65643d2254727565222070686f746f73686f703a436974793d225265796b6a6176696b222070686f746f73686f703a436f75",
        "6e7472793d224963656c616e6422204970746334786d70436f72653a436f756e747279436f64653d224953223e3c64633a63726561746f723e3c7264",
        "663a5365713e3c7264663a6c693e53746565766520506f6d6d6965723c2f7264663a6c693e3c2f7264663a5365713e3c2f64633a63726561746f723e",
        "3c64633a7269676874733e3c7264663a416c743e3c7264663a6c6920786d6c3a6c616e673d22782d64656661756c74223ec2a9203230323620537465",
        "65766520506f6d6d6965722e20416c6c207269676874732072657365727665642e3c2f7264663a6c693e3c2f7264663a416c743e3c2f64633a726967",
        "6874733e3c64633a7469746c653e3c7264663a416c743e3c7264663a6c6920786d6c3a6c616e673d22782d64656661756c74223e50696e6e61636c65",
        "733c2f7264663a6c693e3c2f7264663a416c743e3c2f64633a7469746c653e3c64633a6465736372697074696f6e3e3c7264663a416c743e3c726466",
        "3a6c6920786d6c3a6c616e673d22782d64656661756c74223e4e616d62756e672c206174206461776e3c2f7264663a6c693e3c2f7264663a416c743e",
        "3c2f64633a6465736372697074696f6e3e3c2f7264663a4465736372697074696f6e3e3c2f7264663a5244463e3c2f783a786d706d6574613e3c3f78",
        "7061636b657420656e643d2277223f3effe202184943435f50524f46494c450001010000020800000000043000006d6e74725247422058595a2007ea",
        "0009001700000000000061637370000000000000000000000000000000000000000000000000000000000000f6d6000100000000d32d000000000000",
        "0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a64657363000000fc000000246370",
        "7274000001200000004c777470740000016c0000001463686164000001800000002c7258595a000001ac000000146758595a000001c0000000146258",
        "595a000001d40000001472545243000001e80000002067545243000001e80000002062545243000001e8000000206d6c756300000000000000010000",
        "000c656e5553000000080000001c00730052004700426d6c756300000000000000010000000c656e5553000000300000001c004e006f00200063006f",
        "0070007900720069006700680074002c002000750073006500200066007200650065006c007958595a20000000000000f6d6000100000000d32d7366",
        "33320000000000010c43000005ddfffff326000007940000fd8bfffffb9ffffffda5000003de0000c07d58595a200000000000006fa4000038f60000",
        "038f58595a2000000000000062960000b787000018dc58595a2000000000000024a200000f830000b6cf706172610000000000030000000266660000",
        "f2a700000d59000013d000000a5bffda00020708ffd9",
    ].joined()
private let goldenShare = [
        "ffd8ffe1019845786966000049492a000800000008000e01020011000000ec0000000f01020004000000444a49001001020007000000fe0000001201",
        "030001000000010000003101020008000000060100003b0102000f0000000e010000988202002d0000001e01000069870400010000006e0000000000",
        "00000a009a820500010000004c0100009d82050001000000540100002788030001000000640000000090070004000000303233320390020014000000",
        "5c01000004900200140000007001000001a00300010000000100000002a00400010000008007000003a0040001000000a005000034a402000b000000",
        "84010000000000004e616d62756e672c206174206461776e000046433834383200004174656c6965720053746565766520506f6d6d6965720000c2a9",
        "20323032362053746565766520506f6d6d6965722e20416c6c207269676874732072657365727665642e000001000000c8000000110000000a000000",
        "323032363a30373a31342031383a33323a303500323032363a30373a31342031383a33323a30350032346d6d20662f312e370000ffe1043468747470",
        "3a2f2f6e732e61646f62652e636f6d2f7861702f312e302f003c3f787061636b657420626567696e3d22efbbbf222069643d2257354d304d70436568",
        "69487a7265537a4e54637a6b633964223f3e3c783a786d706d65746120786d6c6e733a783d2261646f62653a6e733a6d6574612f2220783a786d7074",
        "6b3d224174656c696572223e3c7264663a52444620786d6c6e733a7264663d22687474703a2f2f7777772e77332e6f72672f313939392f30322f3232",
        "2d7264662d73796e7461782d6e7323223e3c7264663a4465736372697074696f6e207264663a61626f75743d222220786d6c6e733a786d703d226874",
        "74703a2f2f6e732e61646f62652e636f6d2f7861702f312e302f2220786d6c6e733a64633d22687474703a2f2f7075726c2e6f72672f64632f656c65",
        "6d656e74732f312e312f2220786d6c6e733a786d705269676874733d22687474703a2f2f6e732e61646f62652e636f6d2f7861702f312e302f726967",
        "6874732f2220786d6c6e733a70686f746f73686f703d22687474703a2f2f6e732e61646f62652e636f6d2f70686f746f73686f702f312e302f222078",
        "6d6c6e733a4970746334786d70436f72653d22687474703a2f2f697074632e6f72672f7374642f4970746334786d70436f72652f312e302f786d6c6e",
        "732f2220786d703a43726561746f72546f6f6c3d224174656c6965722220786d705269676874733a4d61726b65643d2254727565222070686f746f73",
        "686f703a436974793d225265796b6a6176696b222070686f746f73686f703a436f756e7472793d224963656c616e6422204970746334786d70436f72",
        "653a436f756e747279436f64653d224953223e3c64633a63726561746f723e3c7264663a5365713e3c7264663a6c693e53746565766520506f6d6d69",
        "65723c2f7264663a6c693e3c2f7264663a5365713e3c2f64633a63726561746f723e3c64633a7269676874733e3c7264663a416c743e3c7264663a6c",
        "6920786d6c3a6c616e673d22782d64656661756c74223ec2a920323032362053746565766520506f6d6d6965722e20416c6c20726967687473207265",
        "7365727665642e3c2f7264663a6c693e3c2f7264663a416c743e3c2f64633a7269676874733e3c64633a7469746c653e3c7264663a416c743e3c7264",
        "663a6c6920786d6c3a6c616e673d22782d64656661756c74223e50696e6e61636c65733c2f7264663a6c693e3c2f7264663a416c743e3c2f64633a74",
        "69746c653e3c64633a6465736372697074696f6e3e3c7264663a416c743e3c7264663a6c6920786d6c3a6c616e673d22782d64656661756c74223e4e",
        "616d62756e672c206174206461776e3c2f7264663a6c693e3c2f7264663a416c743e3c2f64633a6465736372697074696f6e3e3c2f7264663a446573",
        "6372697074696f6e3e3c2f7264663a5244463e3c2f783a786d706d6574613e3c3f787061636b657420656e643d2277223f3effe202184943435f5052",
        "4f46494c450001010000020800000000043000006d6e74725247422058595a2007ea0009001700000000000061637370000000000000000000000000",
        "000000000000000000000000000000000000f6d6000100000000d32d0000000000000000000000000000000000000000000000000000000000000000",
        "000000000000000000000000000000000000000a64657363000000fc0000002463707274000001200000004c777470740000016c0000001463686164",
        "000001800000002c7258595a000001ac000000146758595a000001c0000000146258595a000001d40000001472545243000001e80000002067545243",
        "000001e80000002062545243000001e8000000206d6c756300000000000000010000000c656e5553000000080000001c00730052004700426d6c7563",
        "00000000000000010000000c656e5553000000300000001c004e006f00200063006f0070007900720069006700680074002c00200075007300650020",
        "0066007200650065006c007958595a20000000000000f6d6000100000000d32d736633320000000000010c43000005ddfffff326000007940000fd8b",
        "fffffb9ffffffda5000003de0000c07d58595a200000000000006fa4000038f60000038f58595a2000000000000062960000b787000018dc58595a20",
        "00000000000024a200000f830000b6cf706172610000000000030000000266660000f2a700000d59000013d000000a5bffda00020708ffd9",
    ].joined()
private let goldenDng = [
        "ffd8ffe1023645786966000049492a000800000009000e01020011000000520100000f01020004000000444a49001001020007000000640100001201",
        "0300010000000100000031010200080000006c0100003b0102000f00000074010000988202002d0000008401000069870400010000007a0000002588",
        "040001000000f8000000000000000a009a82050001000000b20100009d82050001000000ba0100002788030001000000640000000090070004000000",
        "303233320390020014000000c20100000490020014000000d601000001a00300010000000100000002a00400010000008007000003a0040001000000",
        "a005000034a402000b000000ea01000000000000070000000100040000000203000001000200020000004e0000000200050003000000f60100000300",
        "0200020000005700000004000500030000000e020000050001000100000000000000060005000100000026020000000000004e616d62756e672c2061",
        "74206461776e000046433834383200004174656c6965720053746565766520506f6d6d6965720000c2a920323032362053746565766520506f6d6d69",
        "65722e20416c6c207269676874732072657365727665642e000001000000c8000000110000000a000000323032363a30373a31342031383a33323a30",
        "3500323032363a30373a31342031383a33323a30350032346d6d20662f312e37000040000000010000000800000001000000a0490700102700001500",
        "000001000000380000000100000020170500102700008202000005000000ffe10434687474703a2f2f6e732e61646f62652e636f6d2f7861702f312e",
        "302f003c3f787061636b657420626567696e3d22efbbbf222069643d2257354d304d7043656869487a7265537a4e54637a6b633964223f3e3c783a78",
        "6d706d65746120786d6c6e733a783d2261646f62653a6e733a6d6574612f2220783a786d70746b3d224174656c696572223e3c7264663a5244462078",
        "6d6c6e733a7264663d22687474703a2f2f7777772e77332e6f72672f313939392f30322f32322d7264662d73796e7461782d6e7323223e3c7264663a",
        "4465736372697074696f6e207264663a61626f75743d222220786d6c6e733a786d703d22687474703a2f2f6e732e61646f62652e636f6d2f7861702f",
        "312e302f2220786d6c6e733a64633d22687474703a2f2f7075726c2e6f72672f64632f656c656d656e74732f312e312f2220786d6c6e733a786d7052",
        "69676874733d22687474703a2f2f6e732e61646f62652e636f6d2f7861702f312e302f7269676874732f2220786d6c6e733a70686f746f73686f703d",
        "22687474703a2f2f6e732e61646f62652e636f6d2f70686f746f73686f702f312e302f2220786d6c6e733a4970746334786d70436f72653d22687474",
        "703a2f2f697074632e6f72672f7374642f4970746334786d70436f72652f312e302f786d6c6e732f2220786d703a43726561746f72546f6f6c3d2241",
        "74656c6965722220786d705269676874733a4d61726b65643d2254727565222070686f746f73686f703a436974793d225265796b6a6176696b222070",
        "686f746f73686f703a436f756e7472793d224963656c616e6422204970746334786d70436f72653a436f756e747279436f64653d224953223e3c6463",
        "3a63726561746f723e3c7264663a5365713e3c7264663a6c693e53746565766520506f6d6d6965723c2f7264663a6c693e3c2f7264663a5365713e3c",
        "2f64633a63726561746f723e3c64633a7269676874733e3c7264663a416c743e3c7264663a6c6920786d6c3a6c616e673d22782d64656661756c7422",
        "3ec2a920323032362053746565766520506f6d6d6965722e20416c6c207269676874732072657365727665642e3c2f7264663a6c693e3c2f7264663a",
        "416c743e3c2f64633a7269676874733e3c64633a7469746c653e3c7264663a416c743e3c7264663a6c6920786d6c3a6c616e673d22782d6465666175",
        "6c74223e50696e6e61636c65733c2f7264663a6c693e3c2f7264663a416c743e3c2f64633a7469746c653e3c64633a6465736372697074696f6e3e3c",
        "7264663a416c743e3c7264663a6c6920786d6c3a6c616e673d22782d64656661756c74223e4e616d62756e672c206174206461776e3c2f7264663a6c",
        "693e3c2f7264663a416c743e3c2f64633a6465736372697074696f6e3e3c2f7264663a4465736372697074696f6e3e3c2f7264663a5244463e3c2f78",
        "3a786d706d6574613e3c3f787061636b657420656e643d2277223f3effe202184943435f50524f46494c450001010000020800000000043000006d6e",
        "74725247422058595a2007ea0009001700000000000061637370000000000000000000000000000000000000000000000000000000000000f6d60001",
        "00000000d32d0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a6465",
        "7363000000fc0000002463707274000001200000004c777470740000016c0000001463686164000001800000002c7258595a000001ac000000146758",
        "595a000001c0000000146258595a000001d40000001472545243000001e80000002067545243000001e80000002062545243000001e8000000206d6c",
        "756300000000000000010000000c656e5553000000080000001c00730052004700426d6c756300000000000000010000000c656e5553000000300000",
        "001c004e006f00200063006f0070007900720069006700680074002c002000750073006500200066007200650065006c007958595a20000000000000",
        "f6d6000100000000d32d736633320000000000010c43000005ddfffff326000007940000fd8bfffffb9ffffffda5000003de0000c07d58595a200000",
        "000000006fa4000038f60000038f58595a2000000000000062960000b787000018dc58595a2000000000000024a200000f830000b6cf706172610000",
        "000000030000000266660000f2a700000d59000013d000000a5bffda00020708ffd9",
    ].joined()
private let goldenNone = [
        "ffd8ffe100ce45786966000049492a000800000005001201030001000000010000003101020008000000800000003b0102000f000000880000009882",
        "02002d0000009800000069870400010000004a00000000000000040000900700040000003032333201a00300010000000100000002a0040001000000",
        "8007000003a0040001000000a0050000000000004174656c6965720053746565766520506f6d6d6965720000c2a92032303331205374656576652050",
        "6f6d6d6965722e20416c6c207269676874732072657365727665642e0000ffe1031e687474703a2f2f6e732e61646f62652e636f6d2f7861702f312e",
        "302f003c3f787061636b657420626567696e3d22efbbbf222069643d2257354d304d7043656869487a7265537a4e54637a6b633964223f3e3c783a78",
        "6d706d65746120786d6c6e733a783d2261646f62653a6e733a6d6574612f2220783a786d70746b3d224174656c696572223e3c7264663a5244462078",
        "6d6c6e733a7264663d22687474703a2f2f7777772e77332e6f72672f313939392f30322f32322d7264662d73796e7461782d6e7323223e3c7264663a",
        "4465736372697074696f6e207264663a61626f75743d222220786d6c6e733a786d703d22687474703a2f2f6e732e61646f62652e636f6d2f7861702f",
        "312e302f2220786d6c6e733a64633d22687474703a2f2f7075726c2e6f72672f64632f656c656d656e74732f312e312f2220786d6c6e733a786d7052",
        "69676874733d22687474703a2f2f6e732e61646f62652e636f6d2f7861702f312e302f7269676874732f2220786d6c6e733a70686f746f73686f703d",
        "22687474703a2f2f6e732e61646f62652e636f6d2f70686f746f73686f702f312e302f2220786d6c6e733a4970746334786d70436f72653d22687474",
        "703a2f2f697074632e6f72672f7374642f4970746334786d70436f72652f312e302f786d6c6e732f2220786d703a43726561746f72546f6f6c3d2241",
        "74656c6965722220786d705269676874733a4d61726b65643d2254727565223e3c64633a63726561746f723e3c7264663a5365713e3c7264663a6c69",
        "3e53746565766520506f6d6d6965723c2f7264663a6c693e3c2f7264663a5365713e3c2f64633a63726561746f723e3c64633a7269676874733e3c72",
        "64663a416c743e3c7264663a6c6920786d6c3a6c616e673d22782d64656661756c74223ec2a920323033312053746565766520506f6d6d6965722e20",
        "416c6c207269676874732072657365727665642e3c2f7264663a6c693e3c2f7264663a416c743e3c2f64633a7269676874733e3c2f7264663a446573",
        "6372697074696f6e3e3c2f7264663a5244463e3c2f783a786d706d6574613e3c3f787061636b657420656e643d2277223f3effe202184943435f5052",
        "4f46494c450001010000020800000000043000006d6e74725247422058595a2007ea0009001700000000000061637370000000000000000000000000",
        "000000000000000000000000000000000000f6d6000100000000d32d0000000000000000000000000000000000000000000000000000000000000000",
        "000000000000000000000000000000000000000a64657363000000fc0000002463707274000001200000004c777470740000016c0000001463686164",
        "000001800000002c7258595a000001ac000000146758595a000001c0000000146258595a000001d40000001472545243000001e80000002067545243",
        "000001e80000002062545243000001e8000000206d6c756300000000000000010000000c656e5553000000080000001c00730052004700426d6c7563",
        "00000000000000010000000c656e5553000000300000001c004e006f00200063006f0070007900720069006700680074002c00200075007300650020",
        "0066007200650065006c007958595a20000000000000f6d6000100000000d32d736633320000000000010c43000005ddfffff326000007940000fd8b",
        "fffffb9ffffffda5000003de0000c07d58595a200000000000006fa4000038f60000038f58595a2000000000000062960000b787000018dc58595a20",
        "00000000000024a200000f830000b6cf706172610000000000030000000266660000f2a700000d59000013d000000a5bffda00020708ffd9",
    ].joined()
