// Port of `src/shared/develop/sensor-source.test.ts`.

import XCTest
@testable import AtelierKit

/// The session cache as a dictionary — what `original-cache.ts` is to the web.
private final class Held: HeldOriginals {
    var files: [String: SavedMediaRef] = [:]
    var renders: [String: PixelSize?] = [:]
    func heldOriginal(_ key: String) -> SavedMediaRef? { files[key] }
    func holdOriginal(_ key: String, _ file: SavedMediaRef) { files[key] = file }
    func heldRawRender(_ key: String) -> PixelSize?? { renders[key] }
    func holdRawRender(_ key: String, _ render: PixelSize?) { renders[key] = .some(render) }
}

private func file(_ name: String, _ bytes: Int = 100) -> SavedMediaRef {
    SavedMediaRef(name: name, size: bytes, lastModified: 0)
}

private func proxyOver(_ name: String, companion: CaptureCompanion? = nil) -> MediaOrigin {
    MediaOrigin(sourceId: "winnow.example", fidelity: .proxy, width: 8064, height: 4536, name: name, bytes: 74_000_000, companion: companion)
}

private func companion(_ name: String) -> CaptureCompanion {
    CaptureCompanion(assetId: "winnow.example/99", name: name, bytes: 34_600_000, width: 7040, height: 4688)
}

final class SensorSourceForTests: XCTestCase {
    func testIsTheFileItselfWhenThatIsARAW() {
        let raw = file("DSC08463.ARW")
        let s = sensorSourceFor(raw, nil)
        XCTAssertEqual(s?.reach, .file)
        XCTAssertEqual(s?.held, raw)
        XCTAssertNil(s?.fetch)
    }

    func testIsTheRAWAFolderListedBesideAJPEGInHand() {
        let dng = file("DJI_0101.DNG")
        let s = sensorSourceFor(file("DJI_0101.JPG"), nil, [file("DJI_0101.HIF"), dng])
        XCTAssertEqual(s?.reach, .sibling)
        XCTAssertEqual(s?.name, "DJI_0101.DNG")
        XCTAssertEqual(s?.held, dng)
    }

    func testIsTheProxysOwnOriginalWhenThatIsARAWHeldUnderThePicturesAssetId() {
        let s = sensorSourceFor(file("dji_fly_0242.webp"), proxyOver("dji_fly_0242_photo.DNG"), [], "winnow.example/12")
        XCTAssertEqual(s, SensorSource(reach: .original, name: "dji_fly_0242_photo.DNG", bytes: 74_000_000,
                                       key: "winnow.example/12", held: nil, fetch: .original))
    }

    func testIsTheCompanionBehindASonyHIFOrADJIJPEGUnderTheCompanionsOwnAssetId() {
        let s = sensorSourceFor(file("DSC08463.webp"), proxyOver("DSC08463.HIF", companion: companion("DSC08463.ARW")), [], "winnow.example/12")
        XCTAssertEqual(s, SensorSource(reach: .companion, name: "DSC08463.ARW", bytes: 34_600_000, key: "winnow.example/99",
                                       held: nil, fetch: .companion(assetId: "winnow.example/99")))
    }

    func testNeverOffersACompanionThatIsNotARAWAndAnswersNilForAPlainJPEG() {
        XCTAssertNil(sensorSourceFor(file("IMG_1.webp"), proxyOver("IMG_1.HEIC", companion: companion("IMG_1.MOV"))))
        XCTAssertNil(sensorSourceFor(file("IMG_1.JPG"), nil, [file("IMG_1.PNG")]))
    }
}

final class DeliveredSourceForTests: XCTestCase {
    func testAnswersNothingForTheProxyForNoChoiceAndForANameTheCaptureNoLongerOffers() {
        let f = file("DJI_0101.webp")
        XCTAssertNil(deliveredSourceFor("proxy", f, proxyOver("DJI_0101.JPG")))
        XCTAssertNil(deliveredSourceFor(nil, f, proxyOver("DJI_0101.JPG")))
        XCTAssertNil(deliveredSourceFor("delivered:gone.jpg", f, proxyOver("DJI_0101.JPG")))
    }

    func testFindsTheProxysOriginalTheCompanionAndAFolderSiblingByNameCaseAside() {
        let f = file("DJI_0101.webp")
        let origin = proxyOver("DJI_0101.JPG", companion: companion("DJI_0101.DNG"))
        let original = deliveredSourceFor("delivered:dji_0101.jpg", f, origin, [], "winnow.example/12")
        XCTAssertEqual(original?.reach, .original)
        XCTAssertEqual(original?.name, "DJI_0101.JPG")
        XCTAssertEqual(original?.key, "winnow.example/12")
        let paired = deliveredSourceFor("delivered:dji_0101.dng", f, origin)
        XCTAssertEqual(paired?.reach, .companion)
        XCTAssertEqual(paired?.name, "DJI_0101.DNG")
        XCTAssertEqual(paired?.key, "winnow.example/99")
        let dng = file("DJI_0101.DNG")
        let sibling = deliveredSourceFor("delivered:dji_0101.dng", file("DJI_0101.JPG"), nil, [dng])
        XCTAssertEqual(sibling?.reach, .sibling)
        XCTAssertEqual(sibling?.held, dng)
    }

    func testIsTheFileItselfWhenTheNameIsItsOwnAndNotWhenThatFileIsAProxyOfTheSameName() {
        let jpg = file("DJI_0101.JPG")
        let itself = deliveredSourceFor("delivered:dji_0101.jpg", jpg, nil)
        XCTAssertEqual(itself?.reach, .file)
        XCTAssertEqual(itself?.held, jpg)
        let looksAlike = file("DJI_0101.JPG")
        XCTAssertEqual(deliveredSourceFor("delivered:dji_0101.jpg", looksAlike, proxyOver("DJI_0101.JPG"), [], "k")?.reach, .original)
    }
}

final class FetchSourceFileTests: XCTestCase {
    func testFetchesOnceAndHoldsTheRAWForTheSessionUnderItsKey() async throws {
        let held = Held()
        var fetched = 0
        let origin = proxyOver("DSC08463.HIF", companion: companion("DSC08463.ARW"))
        let fetch: (SensorFetch) async throws -> SavedMediaRef = { how in
            XCTAssertEqual(how, .companion(assetId: "winnow.example/99"))
            fetched += 1
            return file("DSC08463.ARW", 35)
        }
        let first = try await fetchSourceFile(sensorSourceFor(file("DSC08463.webp"), origin, held: held)!, held: held, fetch: fetch)
        XCTAssertEqual(first.name, "DSC08463.ARW")
        XCTAssertEqual(held.heldOriginal("winnow.example/99"), first)
        // Asked again, the source sees it held and fetches nothing.
        let again = sensorSourceFor(file("DSC08463.webp"), origin, held: held)!
        XCTAssertEqual(again.held, first)
        let second = try await fetchSourceFile(again, held: held, fetch: fetch)
        XCTAssertEqual(second, first)
        XCTAssertEqual(fetched, 1)
    }

    func testHandsBackARAWInHandWithoutTouchingTheCache() async throws {
        let held = Held()
        let raw = file("X.DNG")
        let back = try await fetchSourceFile(sensorSourceFor(raw, nil)!, held: held) { _ in
            XCTFail("a file in hand is never fetched")
            return raw
        }
        XCTAssertEqual(back, raw)
        XCTAssertTrue(held.files.isEmpty)
    }

    func testRefusesASourceNothingCanFetch() async {
        let lone = SensorSource(reach: .original, name: "X.DNG", bytes: nil, key: nil, held: nil, fetch: nil)
        do {
            _ = try await fetchSourceFile(lone, held: Held()) { _ in file("X.DNG") }
            XCTFail("an unreachable source threw nothing")
        } catch {
            XCTAssertEqual(error as? SensorSourceError, .unreachable("X.DNG"))
            XCTAssertEqual((error as? SensorSourceError)?.message, "X.DNG is not reachable from here")
        }
    }
}
