// Port of `src/shared/sources/winnow/materialize.test.ts`. The web reads the
// identity back out of its registry (`knownIdentity`, `mediaOrigin`,
// `hashedMediaRef`); here `materialize` returns it beside each file, and the
// ref a registry would build is built from the two.

import Foundation
import XCTest
@testable import AtelierKit

private let source = "winnow.example"
private let perth = TimeZone(identifier: "Australia/Perth")!
private let utc = TimeZone(identifier: "UTC")!

private func row(_ change: (inout WinnowAssetRow) -> Void = { _ in }) -> WinnowAssetRow {
    var r = WinnowAssetRow(
        id: 42, filename: "DJI_0001.MP4", sessionId: 3, ext: "mp4", mediaType: .video,
        capturedAt: "2025-07-09T08:30:00.000Z", captureDate: "2025-07-09", width: 3840, height: 2160,
        durationS: 12, fileSize: 500_000_000, contentHash: "abc123", cameraModel: "DJI Mini 4 Pro",
        derivativeStatus: .ready, hasTelemetry: true,
        sidecars: [WinnowSidecar(id: 7, kind: .srt, filename: "DJI_0001.SRT")]
    )
    change(&r)
    return r
}

/// An instance that serves `bytes[path]` zero bytes at each path, 404 elsewhere.
private func clientServing(_ bytes: [String: Int]) -> WinnowClient {
    WinnowStub { req, _ in
        guard let n = bytes[req.path] else { return WinnowResponse(status: 404) }
        return WinnowResponse(status: 200, body: Data(count: n))
    }.client()
}

/// The ref a registry would build for a vouched file — the web's `hashedMediaRef`.
private func hashedRef(_ m: MaterializedFile) -> SavedMediaRef {
    SavedMediaRef(name: m.file.name, size: m.file.size, lastModified: m.file.lastModified,
                  assetId: m.identity.assetId, hash: m.identity.hash)
}

private let capturedMs = 1_752_049_800_000.0 // 2025-07-09T08:30:00Z

final class PlannedFilesTests: XCTestCase {
    private let c = clientServing([:])

    func testNamesAVideoProxyAfterTheOriginalBaseNameAsMp4WithItsSrt() {
        XCTAssertEqual(plannedFiles(c, row(), .proxy), [
            PlannedFile(url: "\(winnowBase)/api/assets/42/proxy", name: "DJI_0001.mp4", type: "video/mp4"),
            PlannedFile(url: "\(winnowBase)/api/sidecars/7/download", name: "DJI_0001.SRT", type: "text/plain"),
        ])
    }

    func testNamesAPhotoProxyWebpTheDecodableHalfOfARaw() {
        let photo = row { $0.filename = "DSC00123.ARW"; $0.mediaType = .photo; $0.sidecars = [] }
        XCTAssertEqual(plannedFiles(c, photo, .proxy), [
            PlannedFile(url: "\(winnowBase)/api/assets/42/proxy", name: "DSC00123.webp", type: "image/webp"),
        ])
    }

    func testKeepsTheExactOriginalFilenameForTheOriginal() {
        XCTAssertEqual(plannedFiles(c, row(), .original)[0],
                       PlannedFile(url: "\(winnowBase)/api/assets/42/download", name: "DJI_0001.MP4", type: ""))
    }

    func testIgnoresSonyXmlThmCompanionsNothingHereReadsThem() {
        let sony = row { $0.sidecars = [WinnowSidecar(id: 1, kind: .xml, filename: "C0001M01.XML")] }
        XCTAssertEqual(plannedFiles(c, sony, .proxy).count, 1)
    }
}

final class IdentityForTests: XCTestCase {
    func testScopesTheAssetIdToItsSourceAndCarriesTheContentHash() {
        XCTAssertEqual(identityFor(source, row()), WinnowIdentity(assetId: "winnow.example/42", hash: "abc123"))
    }

    func testOmitsAHashWinnowDoesNotHaveRatherThanWritingNull() {
        XCTAssertEqual(identityFor(source, row { $0.contentHash = nil }), WinnowIdentity(assetId: "winnow.example/42"))
    }
}

final class CaptureMtimeTests: XCTestCase {
    func testIsTheCaptureInstantWhenTheInstanceHasOne() {
        XCTAssertEqual(captureMtime(row(), now: 0), capturedMs)
    }

    func testFallsBackToTheCaptureDayAtLocalNoonNeverToMidnight() {
        // Midnight would fall on the day before in any zone west of the
        // reader, and the day is the whole point of the fallback.
        let noDate = row { $0.capturedAt = nil }
        XCTAssertEqual(captureMtime(noDate, now: 0, timeZone: utc), 1_752_062_400_000) // 2025-07-09T12:00Z
        XCTAssertEqual(captureMtime(noDate, now: 0, timeZone: perth), 1_752_033_600_000) // 12:00 at UTC+8
    }

    func testIsNowOnlyWhenTheRowKnowsNeither() {
        XCTAssertEqual(captureMtime(row { $0.capturedAt = nil; $0.captureDate = nil }, now: 1_800_000_000_000),
                       1_800_000_000_000)
    }

    func testRefusesAnUnparseableInstantRatherThanDatingTheFileByIt() {
        XCTAssertEqual(captureMtime(row { $0.capturedAt = "not a date" }, now: 0, timeZone: utc), 1_752_062_400_000)
    }
}

final class MaterializeFetchTests: XCTestCase {
    func testFetchesTheClipAndItsLogDatedAtCaptureVouchedWithTheOriginalHash() async throws {
        let c = clientServing(["/api/assets/42/proxy": 10, "/api/sidecars/7/download": 3])
        var seen: [String] = []
        let files = try await materialize(c, source, row(), fidelity: .proxy, now: 0) { f, i, n in
            seen.append("\(i)/\(n) \(f.name)")
        }
        XCTAssertEqual(files.map(\.file.name), ["DJI_0001.mp4", "DJI_0001.SRT"])
        XCTAssertEqual(files[0].file.lastModified, capturedMs)
        XCTAssertEqual(seen, ["1/2 DJI_0001.mp4", "2/2 DJI_0001.SRT"])

        // The proxy's own bytes are nobody's identity: the ref carries Winnow's.
        XCTAssertEqual(files[0].identity.assetId, "winnow.example/42")
        XCTAssertEqual(files[0].identity.hash, "abc123")
        let ref = hashedRef(files[0])
        XCTAssertEqual(ref.name, "DJI_0001.mp4")
        XCTAssertEqual(ref.assetId, "winnow.example/42")
        XCTAssertEqual(ref.hash, "abc123")
    }

    func testSurfacesAMissingRenditionAsAnErrorInsteadOfASilentGap() async {
        let err = await winnowError {
            try await materialize(clientServing([:]), source, row { $0.sidecars = [] }, fidelity: .proxy, now: 0)
        }
        XCTAssertEqual(err?.kind, .notfound)
        XCTAssertEqual(err?.status, 404)
    }
}

final class MaterializeOriginTests: XCTestCase {
    func testRecordsTheCapturesSizeNotTheProxysSoAnExportCanSizeAVariant() async throws {
        let c = clientServing(["/api/assets/42/proxy": 10, "/api/sidecars/7/download": 3])
        let clip = try await materialize(c, source, row(), fidelity: .proxy, now: 0)[0]
        let origin = try XCTUnwrap(clip.identity.origin)
        XCTAssertEqual(origin.sourceId, "winnow.example")
        XCTAssertEqual(origin.fidelity, .proxy)
        XCTAssertEqual(origin.width, 3840)
        XCTAssertEqual(origin.height, 2160)
    }

    func testRidesTheClipOnlyTheOriginalOfASrtWouldBeTheVideo() async throws {
        let c = clientServing(["/api/assets/42/proxy": 10, "/api/sidecars/7/download": 3])
        let log = try await materialize(c, source, row(), fidelity: .proxy, now: 0)[1]
        XCTAssertEqual(log.file.name, "DJI_0001.SRT")
        XCTAssertNil(log.identity.origin)
    }

    func testOffersNoFetchWhenTheFileAlreadyIsTheOriginal() async throws {
        let c = clientServing(["/api/assets/42/download": 20])
        let clip = try await materialize(c, source, row { $0.sidecars = [] }, fidelity: .original, now: 0)[0]
        XCTAssertEqual(clip.identity.origin?.fidelity, .original)
        XCTAssertNil(clip.identity.originalUrl)
    }

    func testFetchesTheCaptureUnderItsRealFilenameWhenAsked() async throws {
        let c = clientServing(["/api/assets/42/proxy": 10, "/api/assets/42/download": 500])
        let clip = try await materialize(c, source, row { $0.sidecars = [] }, fidelity: .proxy, now: 0)[0]
        // The web's `origin.fetchOriginal()`: the client's fetch of the URL the
        // identity names, under the original's name, dated as the proxy.
        let url = try XCTUnwrap(clip.identity.originalUrl)
        let original = try await c.fetchFile(url, name: try XCTUnwrap(clip.identity.origin?.name), type: "",
                                             lastModified: clip.file.lastModified)
        XCTAssertEqual(original.name, "DJI_0001.MP4")
        XCTAssertEqual(original.size, 500)
        // Same capture time as the proxy — it is the same shot.
        XCTAssertEqual(original.lastModified, clip.file.lastModified)
    }

    func testCarriesWhatWinnowParsedForAStillAndNothingForAClip() async throws {
        let c = clientServing(["/api/assets/42/proxy": 10])
        let still = row { $0.mediaType = .photo; $0.sidecars = []; $0.iso = 100 }
        let photo = try await materialize(c, source, still, fidelity: .proxy, now: 0)[0]
        XCTAssertEqual(photo.identity.exif?.iso, 100)
        let clip = try await materialize(c, source, row { $0.sidecars = []; $0.iso = 100 }, fidelity: .proxy, now: 0)[0]
        XCTAssertNil(clip.identity.exif)
    }
}

final class RowMediaRefTests: XCTestCase {
    func testIsTheRefAFetchedProxyWouldCarryButForItsByteSize() async throws {
        let photo = row { $0.filename = "DJI_0101.JPG"; $0.mediaType = .photo; $0.sidecars = [] }
        let c = clientServing(["/api/assets/42/proxy": 10])
        let fetched = try await materialize(c, source, photo, fidelity: .proxy, now: 0)[0]
        var expected = hashedRef(fetched)
        expected.size = 0
        XCTAssertEqual(rowMediaRef(source, photo, now: 0), expected)
        XCTAssertEqual(rowMediaRef(source, photo, now: 0), SavedMediaRef(
            name: "DJI_0101.webp", size: 0, lastModified: capturedMs, assetId: "winnow.example/42", hash: "abc123"
        ))
    }

    func testCarriesNoHashTheInstanceDidNotGive() {
        XCTAssertNil(rowMediaRef(source, row { $0.contentHash = nil }, now: 0).hash)
        XCTAssertEqual(rowMediaRef(source, row(), now: 0).name, "DJI_0001.mp4")
    }
}

final class CompanionOfTests: XCTestCase {
    private func paired(_ change: (inout WinnowAssetRow) -> Void = { _ in }) -> WinnowAssetRow {
        row {
            $0.filename = "DSC08463.HIF"; $0.mediaType = .photo; $0.ext = "hif"; $0.sidecars = []
            $0.groupKind = "raw_jpeg"; $0.companionId = 99; $0.companionExt = "arw"; $0.companionMediaType = "photo"
            $0.companionFilename = "DSC08463.ARW"; $0.companionFileSize = 34_600_000
            $0.companionWidth = 7040; $0.companionHeight = 4688
            change(&$0)
        }
    }

    func testReadsTheCapturesOtherFileOffTheRowWithNoSecondRequest() {
        XCTAssertEqual(companionOf(source, paired()), CaptureCompanion(
            assetId: "winnow.example/99", name: "DSC08463.ARW", bytes: 34_600_000, width: 7040, height: 4688
        ))
    }

    func testRefusesALivePhotosCompanionAMovIsMotionNeverMaterial() {
        XCTAssertNil(companionOf(source, paired { $0.groupKind = "live_photo" }))
        XCTAssertNil(companionOf(source, paired { $0.groupKind = nil; $0.companionMediaType = "video" }))
    }

    func testAnswersNilForAnUnpairedRowAndForOneAnOlderInstanceHalfDescribes() {
        XCTAssertNil(companionOf(source, row { $0.mediaType = .photo }))
        XCTAssertNil(companionOf(source, paired { $0.companionFilename = nil }))
        XCTAssertNil(companionOf(source, paired { $0.companionId = nil }))
    }

    func testRidesOnTheOriginOfAMaterialisedProxy() async throws {
        let c = clientServing(["/api/assets/42/proxy": 10])
        let file = try await materialize(c, source, paired(), fidelity: .proxy, now: 0)[0]
        XCTAssertEqual(file.identity.origin?.companion?.name, "DSC08463.ARW")
        // Its bytes are the companion's own original, on this instance.
        XCTAssertEqual(file.identity.origin?.companion.flatMap(c.originalUrl(of:)), "\(winnowBase)/api/assets/99/download")
    }
}
