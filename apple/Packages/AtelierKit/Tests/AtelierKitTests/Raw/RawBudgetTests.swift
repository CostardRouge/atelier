// Port of `src/shared/raw/raw-budget.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

final class RawDecodeEdgeTests: XCTestCase {
    func testLeavesARoomyDeviceToTheGpusCapAlone() {
        XCTAssertEqual(rawDecodeEdge(.stage, .roomy, 16384), 16384)
        XCTAssertEqual(rawDecodeEdge(.export, .roomy, 8192), 8192)
        XCTAssertEqual(rawDecodeEdge(.loupe, .roomy, .infinity), .infinity)
    }

    func testCapsAConstrainedDeviceByPurposeUnderTheGpuWhereTheGpuIsSmaller() {
        XCTAssertEqual(rawDecodeEdge(.stage, .constrained, 16384), constrainedStageEdge)
        XCTAssertEqual(rawDecodeEdge(.loupe, .constrained, 16384), constrainedStageEdge)
        XCTAssertEqual(rawDecodeEdge(.export, .constrained, 16384), constrainedExportEdge)
        XCTAssertEqual(rawDecodeEdge(.export, .constrained, 2048), 2048)
        // A GPU that answered nothing sensible is no cap at all.
        XCTAssertEqual(rawDecodeEdge(.stage, .constrained, 0), constrainedStageEdge)
    }

    func testADjiDngAtLibRawsHalfLandsAt2016OnAPhonesStageAnd4032InItsExport() {
        // The decoder box-averages by ceil(edge / max): the same arithmetic, pinned here.
        let half = 4032.0
        XCTAssertEqual((half / rawDecodeEdge(.stage, .constrained, 16384)).rounded(.up), 2)
        XCTAssertEqual((half / rawDecodeEdge(.export, .constrained, 16384)).rounded(.up), 1)
    }
}

final class RawDecodeCapTests: XCTestCase {
    func testNamesWhichLimitALongEdgeRanInto() {
        XCTAssertEqual(rawDecodeCap(4032, .stage, .constrained, 16384), .device)
        XCTAssertNil(rawDecodeCap(2016, .stage, .constrained, 16384))
        XCTAssertEqual(rawDecodeCap(9504, .export, .roomy, 8192), .gpu)
        XCTAssertEqual(rawDecodeCap(9504, .export, .constrained, 8192), .device)
        // A GPU smaller than the device's own ceiling is the GPU's fault.
        XCTAssertEqual(rawDecodeCap(4032, .stage, .constrained, 2048), .gpu)
    }
}

final class RawBudgetRestTests: XCTestCase {
    func testHoldsLessDecodedRawOnAPhoneAndCountsADecodesBytesHonestly() {
        XCTAssertEqual(decodedCacheCeiling(.constrained), 64 * 1024 * 1024)
        XCTAssertEqual(decodedCacheCeiling(.roomy), 256 * 1024 * 1024)
        // A DJI stage decode: 2016 × 1134 at six bytes for the GPU and four for the canvas.
        XCTAssertEqual(decodedBytes(2016, 1134, true), 2016 * 1134 * 10)
        XCTAssertEqual(decodedBytes(2016, 1134, false), 2016 * 1134 * 6)
        XCTAssertEqual(decodedBytes(0, 10, true), 0)
    }

    func testLetsAPhonesDecoderGoAfterARestAndKeepsADesktops() {
        XCTAssertEqual(decoderIdleMs(.constrained), 8000)
        XCTAssertNil(decoderIdleMs(.roomy))
    }
}
