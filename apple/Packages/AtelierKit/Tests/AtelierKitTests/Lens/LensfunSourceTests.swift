// Port of `src/shared/lens/lens-profile.test.ts`, second half — «which
// Lensfun files a lookup asks for», the spec of `lensfun-source.ts`.

import Foundation
import XCTest
@testable import AtelierKit

final class LensfunSourceTests: XCTestCase {
    func testStartsWithTheCameraMakersAndKnowsNothingForAMakerItHasNoFileFor() {
        XCTAssertEqual(cameraFiles("sony").first, "mil-sony.xml")
        XCTAssertEqual(cameraFiles("dji"), ["actioncams.xml"])
        XCTAssertEqual(cameraFiles("nobody"), [])
    }

    func testLooksFurtherOnlyAmongTheIndependentLensMakersForThatKindOfBody() {
        XCTAssertTrue(lensFiles("mil-sony.xml").contains("mil-sigma.xml"))
        XCTAssertTrue(lensFiles("mil-sony.xml").allSatisfy { $0.hasPrefix("mil-") || $0 == "misc.xml" })
        XCTAssertTrue(lensFiles("slr-canon.xml").contains("slr-tamron.xml"))
        // A compact's or an action camera's lens is in its own file.
        XCTAssertEqual(lensFiles("compact-sony.xml"), [])
        XCTAssertEqual(lensfunUrl("mil-sony.xml"),
                       "https://raw.githubusercontent.com/lensfun/lensfun/master/data/db/mil-sony.xml")
    }
}
