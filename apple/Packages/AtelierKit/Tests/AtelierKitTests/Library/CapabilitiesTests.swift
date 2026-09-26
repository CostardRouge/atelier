// Port of the `capabilities` half of `src/shared/library/assets.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

final class CapabilitiesTests: XCTestCase {
    private let assets = buildAssets([
        f("DJI_0001.MP4"),
        f("DJI_0001.SRT"), // video+telemetry
        f("broll.mov"), // video
        f("shot.jpg"), // photo
    ])

    func testLetsAVideoToolUsePlainVideosAndVideoTelemetryAssets() {
        let usable = usableAssets([.video], assets).map { $0.id }
        XCTAssertEqual(usable.sorted(), ["broll", "dji_0001"])
    }

    func testMatchesAPhotoToolToPhotosOnly() {
        XCTAssertEqual(usableAssets([.photo], assets).map { $0.id }, ["shot"])
    }

    func testMatchesATelemetryToolToVideoTelemetryAndLoneSrt() {
        let a = assets.first { $0.id == "dji_0001" }!
        XCTAssertTrue(assetUsableBy([.videoTelemetry, .telemetry], a))
    }

    func testIntersectsUsabilityWithTheCurrentSelection() {
        let selection: Set<String> = ["broll", "shot"]
        let picked = selectedUsableAssets([.video], assets, selection)
        XCTAssertEqual(picked.map { $0.id }, ["broll"])
    }
}
