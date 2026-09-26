// `Media/MediaOrigin.swift` has no web spec of its own (the web's type is a
// record in `media-identity.ts`); this pins its spellings and the seam it
// exists for: feeding the renditions of a paired capture from a source's
// facts alone, the way the web's `captureInput` does.

import Foundation
import XCTest
@testable import AtelierKit

final class MediaOriginTests: XCTestCase {
    func testFidelityIsSpelledAsTheWebSpellsIt() {
        XCTAssertEqual(Fidelity.proxy.rawValue, "proxy")
        XCTAssertEqual(Fidelity.original.rawValue, "original")
        XCTAssertEqual(Fidelity(rawValue: "proxy"), .proxy)
    }

    func testACompanionRidesOnTheOriginWithTheRowsOwnFacts() {
        let origin = MediaOrigin(
            sourceId: "winnow.example", fidelity: .proxy, width: 7040, height: 4688, name: "DSC08463.HIF", bytes: 12_600_000,
            companion: CaptureCompanion(assetId: "winnow.example/99", name: "DSC08463.ARW", bytes: 34_600_000, width: 7040, height: 4688))
        XCTAssertEqual(origin.companion?.assetId, "winnow.example/99")
        XCTAssertEqual(origin.companion?.name, "DSC08463.ARW")
        XCTAssertEqual(origin.companion?.bytes, 34_600_000)
        XCTAssertNil(MediaOrigin(sourceId: "winnow.example", fidelity: .original).companion)
    }

    func testFeedsTheRenditionsOfAPairedCaptureFromItsFactsAlone() {
        // The proxy in hand, the primary's own HIF, the ARW Winnow paired with
        // it — a RAW's render stays unmeasured until its head is read, and
        // that is why the unreachable HIF gives way to the ARW.
        let origin = MediaOrigin(
            sourceId: "winnow.example", fidelity: .proxy, width: 7008, height: 4672, name: "DSC08463.HIF", bytes: 12_600_000,
            companion: CaptureCompanion(assetId: "winnow.example/99", name: "DSC08463.ARW", bytes: 34_600_000, width: 7040, height: 4688))
        var others: [CaptureFile] = []
        if let name = origin.name, let w = origin.width, let h = origin.height {
            others.append(CaptureFile(name: name, bytes: origin.bytes, here: false, assetId: "winnow.example/42", pixels: PixelSize(width: w, height: h)))
        }
        if let c = origin.companion, let w = c.width, let h = c.height {
            others.append(CaptureFile(name: c.name, bytes: c.bytes, here: false, assetId: c.assetId, sensor: PixelSize(width: w, height: h)))
        }
        let rows = renditionsOf(CaptureInput(
            open: CaptureFile(name: "DSC08463.webp", here: true, pixels: PixelSize(width: 2048, height: 1365)),
            openIsProxy: origin.fidelity == .proxy,
            others: others,
            canDraw: { ["jpg", "jpeg", "png", "webp"].contains($0.split(separator: ".").last.map { $0.lowercased() } ?? "") }))
        XCTAssertEqual(rows.map { $0.id }, ["proxy", "delivered:dsc08463.arw", "sensor:dsc08463.arw"])
        XCTAssertEqual(rows[2].pixels, PixelSize(width: 7040, height: 4688))
        XCTAssertEqual(rows[1].assetId, "winnow.example/99")
    }
}
