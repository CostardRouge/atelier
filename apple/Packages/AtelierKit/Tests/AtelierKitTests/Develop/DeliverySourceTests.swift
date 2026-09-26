// The part of `src/shared/develop/roll-export.test.ts` that covers what
// `DeliverySource.swift` ports — `pixelHeadroom`, `decodableOriginal`,
// `choosePixels`, `deliversLine`, `fixedFrameDelivery` — ported one for one;
// then a spec of its own for `delivery-source.ts`, which has none on the web:
// `originalOf`, `isProxyOverRaw`, `rawRenderFrom` and `deliveryFor`.

import XCTest
@testable import AtelierKit

private let proxy = Size(2048, 1536)
private let original = OriginalInfo(width: 8064, height: 6048, name: "DJI_0421.JPG", bytes: 24_000_000)

private func raw(render: Size? = nil) -> OriginalInfo {
    var o = original
    o.name = "DJI_0421.DNG"
    o.render = render
    return o
}

private func matches(_ text: String?, _ pattern: String, file: StaticString = #filePath, line: UInt = #line) {
    guard let text else { return XCTFail("nil does not match /\(pattern)/", file: file, line: line) }
    XCTAssertNotNil(text.range(of: pattern, options: .regularExpression), "\(text) does not match /\(pattern)/", file: file, line: line)
}

final class PixelHeadroomTests: XCTestCase {
    func testFindsALandscapeProxyCroppedTo45At1920UpscaledAndThe48MPOriginalWithRoomToSpare() {
        assertClose(pixelHeadroom(proxy, .default, Size(1536, 1920)), 0.8, 3)
        assertClose(pixelHeadroom(Size(8064, 6048), .default, Size(1536, 1920)), 3.15, 2)
    }

    func testIsExactForAPortraitProxyDeliveredAtItsOwnPixels() {
        assertClose(pixelHeadroom(Size(1536, 2048), nil, Size(1536, 2048)), 1, 6)
    }

    func testShrinksWithAFramingZoom() {
        assertClose(pixelHeadroom(proxy, framing { $0.scale = 1.6 }, Size(1536, 1920)), 0.5, 3)
    }
}

final class DecodableOriginalTests: XCTestCase {
    func testAcceptsWhatARendererDecodesAndRefusesARAWHEICOrTIFF() {
        XCTAssertTrue(decodableOriginal("a.JPG"))
        XCTAssertTrue(decodableOriginal("a.png"))
        XCTAssertTrue(decodableOriginal("a.webp"))
        XCTAssertFalse(decodableOriginal("a.DNG"))
        XCTAssertFalse(decodableOriginal("a.ARW"))
        XCTAssertFalse(decodableOriginal("a.heic"))
        XCTAssertFalse(decodableOriginal("a.tif"))
        XCTAssertFalse(decodableOriginal(nil))
    }
}

final class ChoosePixelsTests: XCTestCase {
    func testHasNothingToChooseForAFileThatIsTheOriginal() {
        XCTAssertEqual(choosePixels(.auto, 0.5, nil), PixelsChoice(from: .file, reason: nil))
        XCTAssertEqual(choosePixels(.proxies, 0.5, nil), PixelsChoice(from: .file, reason: nil))
    }

    func testRefusesARAWWhoseRenderHasNotBeenMeasured() {
        for mode in PixelsMode.allCases {
            XCTAssertEqual(choosePixels(mode, 0.5, raw(), proxy).from, .file)
        }
        matches(choosePixels(.auto, 0.5, raw(), proxy).reason, "read from the file’s head at export")
    }

    func testTakesTheProxyOverASmallerEmbeddedRenderTheDJIMeasured() {
        // 960 × 540 inside the file, 2048 px of proxy: fetching 74 MB would
        // deliver 0.52 megapixels.
        let dji = raw(render: Size(960, 540))
        XCTAssertEqual(choosePixels(.auto, 0.5, dji, proxy).from, .file)
        XCTAssertEqual(choosePixels(.auto, 0.5, dji, proxy).reason,
                       "its original is a RAW whose own render is 960 px against the proxy’s 2048 — the proxy is what leaves")
    }

    func testTakesALargerEmbeddedRenderAndOnlyWhereTheFrameNeedsIt() {
        let big = raw(render: Size(6048, 4032))
        // Auto: the proxy fills this frame, so the bigger render buys nothing.
        XCTAssertEqual(choosePixels(.auto, 1.2, big, proxy).from, .file)
        matches(choosePixels(.auto, 1.2, big, proxy).reason, "would buy nothing here")
        // Auto, upscaling: worth the fetch, and it says both numbers.
        XCTAssertEqual(choosePixels(.auto, 0.8, big, proxy).from, .original)
        matches(choosePixels(.auto, 0.8, big, proxy).reason, "6048 px render inside it is larger than the 2048 px proxy")
        XCTAssertEqual(choosePixels(.proxies, 0.5, big, proxy).from, .file)
    }

    func testAutoFetchesTheOriginalOnlyWhereTheProxyWouldUpscale() {
        XCTAssertEqual(choosePixels(.auto, 0.8, original).from, .original)
        matches(choosePixels(.auto, 0.8, original).reason, "×1\\.25")
        XCTAssertEqual(choosePixels(.auto, 1.0, original).from, .file)
        XCTAssertEqual(choosePixels(.auto, 2.3, original).from, .file)
    }

    func testProxiesOnlyHoldsTheProxyWhereAutoWouldFetchAndNothingForcesAFetch() {
        XCTAssertEqual(choosePixels(.proxies, 0.5, original).from, .file)
        XCTAssertEqual(choosePixels(.proxies, 0.5, original).reason, "proxies only")
        XCTAssertEqual(choosePixels(.auto, 2.0, original).from, .file)
    }
}

final class DeliversLineTests: XCTestCase {
    func testIsTheCalculatorInOneSentence() {
        XCTAssertEqual(deliversLine("Proxy", Size(1536, 1920), 0.8), "Proxy 1536 px → 1920 · ×1.25 upscaled")
        XCTAssertEqual(deliversLine("Original", Size(1536, 1920), 3.15), "Original 6048 px → 1920 · ×3.15 to spare")
        XCTAssertEqual(deliversLine("File", Size(2048, 1536), 1), "File 2048 px → 2048 · exact")
    }
}

final class FixedFrameDeliveryTests: XCTestCase {
    private let deck = Size(1536, 1920)

    func testSaysTheProxyIsUpscaledIntoTheDeckAndAutoFetchesForIt() {
        let s = fixedFrameDelivery(proxy, true, original, nil, deck)
        XCTAssertEqual(s.from, .original)
        matches(s.reason, "×1\\.25")
        // The frame is written whatever happens — it is a frame, not a cap.
        XCTAssertEqual(s.out, deck)
        assertClose(s.headroom, 3.15, 2)
        matches(s.line, "^DJI_0421\\.JPG \\d+ px → 1920 · ×3\\.15 to spare$")
    }

    func testHoldsTheProxyWhereTheFrameFitsItThereIsNoDoorToSayOtherwise() {
        let held = fixedFrameDelivery(proxy, true, original, nil, Size(1229, 1536))
        XCTAssertEqual(held.from, .file)
        XCTAssertEqual(held.line, "Proxy 1536 px → 1536 · exact")
        XCTAssertEqual(held.reason, "the proxy has the pixels this frame needs")
    }

    func testNeverFetchesARAWWhoseRenderIsSmallerThanTheProxy() {
        let s = fixedFrameDelivery(proxy, true, raw(render: Size(960, 540)), nil, deck)
        XCTAssertEqual(s.from, .file)
        matches(s.reason, "960 px against the proxy’s 2048")
    }

    func testCallsAFileThatIsTheOriginalByItsOwnName() {
        let s = fixedFrameDelivery(Size(8064, 6048), false, nil, nil, deck)
        XCTAssertEqual(s.from, .file)
        matches(s.line, "^File ")
        XCTAssertNil(s.reason)
    }

    func testSaysARAWRenderIsARAWRenderWhereverItIsMeasured() {
        let s = fixedFrameDelivery(Size(960, 540), false, nil, nil, deck, viaRawPreview: true)
        matches(s.line, "^Camera render ")
    }
}

// MARK: - delivery-source.ts, which has no spec of its own on the web

/// The session cache as a dictionary.
private final class Held: HeldOriginals {
    var files: [String: SavedMediaRef] = [:]
    var renders: [String: PixelSize?] = [:]
    func heldOriginal(_ key: String) -> SavedMediaRef? { files[key] }
    func holdOriginal(_ key: String, _ file: SavedMediaRef) { files[key] = file }
    func heldRawRender(_ key: String) -> PixelSize?? { renders[key] }
    func holdRawRender(_ key: String, _ render: PixelSize?) { renders[key] = .some(render) }
}

private enum Refused: Error { case offline }

private let webp = SavedMediaRef(name: "DJI_0421.webp", size: 400_000, lastModified: 1)
private let fetchedJpeg = SavedMediaRef(name: "DJI_0421.JPG", size: 24_000_000, lastModified: 1)

private func overJpeg() -> MediaOrigin {
    MediaOrigin(sourceId: "w.example", fidelity: .proxy, width: 8064, height: 6048, name: "DJI_0421.JPG", bytes: 24_000_000)
}

private func overDng() -> MediaOrigin {
    MediaOrigin(sourceId: "w.example", fidelity: .proxy, width: 8064, height: 4536, name: "DJI_0421.DNG", bytes: 74_000_000)
}

final class DeliverySourceSeamTests: XCTestCase {
    func testOriginalOfNamesAProxysOriginalAndNothingForAFileThatIsItsCapture() {
        XCTAssertEqual(originalOf(overJpeg()), OriginalInfo(width: 8064, height: 6048, name: "DJI_0421.JPG", bytes: 24_000_000))
        XCTAssertEqual(originalOf(overDng(), PixelSize(width: 960, height: 540))?.render, Size(960, 540))
        XCTAssertNil(originalOf(MediaOrigin(sourceId: "w.example", fidelity: .original)))
        XCTAssertNil(originalOf(nil))
    }

    func testIsProxyOverRawOnlyForAProxyWhoseOriginalIsARAW() {
        XCTAssertTrue(isProxyOverRaw(overDng()))
        XCTAssertFalse(isProxyOverRaw(overJpeg()))
        XCTAssertFalse(isProxyOverRaw(MediaOrigin(sourceId: "w.example", fidelity: .original, name: "X.DNG")))
        XCTAssertFalse(isProxyOverRaw(nil))
    }

    func testRawRenderFromReadsTheHeadOnceAndRemembersWhatItSaidNoneIncluded() async {
        let held = Held()
        var heads = 0
        let head = Data([1, 2, 3])
        let fetchHead: (Int) async throws -> Data = { bytes in
            XCTAssertEqual(bytes, 1024 * 1024)
            heads += 1
            return head
        }
        let probe: (Data) -> PixelSize? = { $0 == head ? PixelSize(width: 960, height: 540) : nil }
        let first = await rawRenderFrom(fetchHead, "w/1", held: held, readHead: { _ in nil }, probe: probe)
        XCTAssertEqual(first.render, PixelSize(width: 960, height: 540))
        XCTAssertEqual(first.head, head)
        let again = await rawRenderFrom(fetchHead, "w/1", held: held, readHead: { _ in nil }, probe: probe)
        XCTAssertEqual(again.render, PixelSize(width: 960, height: 540))
        XCTAssertNil(again.head)
        XCTAssertEqual(heads, 1)
        // A head that cannot be fetched is remembered as none, and never asked again.
        let failing: (Int) async throws -> Data = { _ in heads += 1; throw Refused.offline }
        let none = await rawRenderFrom(failing, "w/2", held: held, readHead: { _ in nil }, probe: probe)
        XCTAssertNil(none.render)
        XCTAssertEqual(held.heldRawRender("w/2"), .some(nil))
        _ = await rawRenderFrom(failing, "w/2", held: held, readHead: { _ in nil }, probe: probe)
        XCTAssertEqual(heads, 2)
        // Nothing to fetch it with: not measured, nothing remembered.
        let blind = await rawRenderFrom(nil, "w/3", held: held, readHead: { _ in nil }, probe: probe)
        XCTAssertNil(blind.render)
        XCTAssertEqual(held.heldRawRender("w/3"), PixelSize??.none)
    }

    func testRawRenderFromMeasuresAFileAlreadyHeldFromItsOwnHead() async {
        let held = Held()
        held.holdOriginal("w/1", SavedMediaRef(name: "DJI_0421.DNG", size: 74_000_000, lastModified: 1))
        let own = Data([9])
        let r = await rawRenderFrom({ _ in XCTFail("a held file needs no fetch"); return Data() }, "w/1", held: held,
                                    readHead: { _ in own }, probe: { $0 == own ? PixelSize(width: 7008, height: 4672) : nil })
        XCTAssertEqual(r.render, PixelSize(width: 7008, height: 4672))
        XCTAssertNil(r.head)
        XCTAssertEqual(held.heldRawRender("w/1"), .some(PixelSize(width: 7008, height: 4672)))
    }

    func testDeliveryDecisionIsNilForAFileThatCouldNotBeMeasured() {
        XCTAssertNil(deliveryDecision(measured: nil, origin: overJpeg(), render: nil, framing: nil, out: Size(1536, 1920)))
    }

    func testDeliveryForDeliversAnUnmeasuredFileAsItIs() async {
        let out = await deliveryFor(webp, nil, Size(1536, 1920), measured: nil, origin: overJpeg(), assetId: "w/1", held: Held(),
                                    fetchOriginal: { XCTFail("nothing was decided"); return fetchedJpeg })
        XCTAssertEqual(out, DeliveryOutcome(file: webp, summary: nil, fetched: false))
    }

    func testDeliveryForHoldsTheProxyWhereItFillsTheFrame() async {
        let out = await deliveryFor(webp, nil, Size(1229, 1536), measured: proxy, origin: overJpeg(), assetId: "w/1", held: Held(),
                                    fetchOriginal: { XCTFail("the proxy fills this frame"); return fetchedJpeg })
        XCTAssertEqual(out.file, webp)
        XCTAssertFalse(out.fetched)
        XCTAssertEqual(out.summary?.from, .file)
    }

    func testDeliveryForFetchesTheOriginalOnceAndHoldsItForTheNextDelivery() async {
        let held = Held()
        var fetches = 0
        var said: [String] = []
        let fetch: () async throws -> SavedMediaRef = { fetches += 1; return fetchedJpeg }
        let first = await deliveryFor(webp, nil, Size(1536, 1920), measured: proxy, origin: overJpeg(), assetId: "w/1", held: held,
                                      fetchOriginal: fetch, onProgress: { said.append($0) })
        XCTAssertEqual(first.file, fetchedJpeg)
        XCTAssertTrue(first.fetched)
        XCTAssertEqual(first.summary?.from, .original)
        XCTAssertEqual(said, ["Fetching the original…"])
        XCTAssertEqual(held.heldOriginal("w/1"), fetchedJpeg)
        let second = await deliveryFor(webp, nil, Size(1536, 1920), measured: proxy, origin: overJpeg(), assetId: "w/1", held: held,
                                       fetchOriginal: fetch)
        XCTAssertEqual(second.file, fetchedJpeg)
        XCTAssertFalse(second.fetched)
        XCTAssertEqual(fetches, 1)
    }

    func testDeliveryForCostsTheExtraPixelsNeverTheDeliveryWhenTheFetchFails() async {
        let out = await deliveryFor(webp, nil, Size(1536, 1920), measured: proxy, origin: overJpeg(), assetId: "w/1", held: Held(),
                                    fetchOriginal: { throw Refused.offline })
        XCTAssertEqual(out.file, webp)
        XCTAssertFalse(out.fetched)
        XCTAssertEqual(out.summary?.from, .file)
    }

    func testDeliveryForReadsARAWsRenderAndNeverFetchesOneSmallerThanTheProxy() async {
        let held = Held()
        let head = Data([7])
        let out = await deliveryFor(webp, nil, Size(1536, 1920), measured: proxy, origin: overDng(), assetId: "w/9", held: held,
                                    fetchOriginalHead: { _ in head },
                                    probe: { $0 == head ? PixelSize(width: 960, height: 540) : nil },
                                    fetchOriginal: { XCTFail("74 MB for 0.52 megapixels"); return fetchedJpeg })
        XCTAssertEqual(out.file, webp)
        XCTAssertEqual(out.summary?.from, .file)
        matches(out.summary?.reason, "960 px against the proxy’s 2048")
        XCTAssertEqual(held.heldRawRender("w/9"), .some(PixelSize(width: 960, height: 540)))
    }
}
