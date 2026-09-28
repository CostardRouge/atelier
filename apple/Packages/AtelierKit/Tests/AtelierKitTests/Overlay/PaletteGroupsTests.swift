// Port of `src/shared/overlay/palette-groups.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

private let items = paletteGroups.flatMap(\.items)

final class PaletteGroupsTests: XCTestCase {
    func testOffersEveryTelemetryFieldExactlyOnce() {
        let offered: [TelemetryFieldKey] = items.compactMap {
            if case .telemetryField(let f) = $0 { return f }
            return nil
        }
        XCTAssertEqual(Set(offered).count, offered.count)
        XCTAssertEqual(offered.map(\.rawValue).sorted(), fieldKeys.map(\.rawValue).sorted())
    }

    func testOffersEveryNonTelemetryKindExactlyOnce() {
        let shapes: [OverlayKind] = [.text, .headingArrow, .headingTape, .frameCorners, .battery]
        for kind in shapes {
            XCTAssertEqual(items.filter { $0.kind == kind.rawValue }.count, 1, kind.rawValue)
        }
    }

    func testOffersEveryIntroPresetExactlyOnce() {
        let offered: [IntroPresetId] = items.compactMap {
            if case .preset(let p) = $0 { return p }
            return nil
        }
        XCTAssertEqual(Set(offered).count, offered.count)
        XCTAssertEqual(offered.map(\.rawValue).sorted(), introPresets.map(\.id.rawValue).sorted())
    }

    func testReachesTheRotateDeviceKindThroughAPreset() {
        let kinds = introPresets.map { $0.create().kind }
        XCTAssertTrue(kinds.contains(.rotateDevice))
    }

    func testKeepsEveryGroupNonEmptyAndLabelled() {
        for group in paletteGroups {
            XCTAssertNotEqual(group.label.trimmingCharacters(in: .whitespaces), "")
            XCTAssertGreaterThan(group.items.count, 0)
        }
    }
}
