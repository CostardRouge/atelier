// `develop-classes.ts` has no spec on the web; this pins that the five
// recipes are the web's, distinct, and read from the workbench's type scale.

import XCTest
@testable import AtelierKit

final class DevelopClassesTests: XCTestCase {
    func testTheFiveRecipesAreDistinctAndTheTwoPillsDifferOnlyByHeight() {
        let all = [developLegendClass, developPillClass, developTouchPillClass, developButtonClass, developLinkClass]
        XCTAssertEqual(Set(all).count, all.count)
        XCTAssertTrue(developLegendClass.contains("font-mono"))
        XCTAssertTrue(developPillClass.contains("h-[1.4rem]"))
        XCTAssertTrue(developTouchPillClass.contains("h-8"))
        XCTAssertEqual(
            developPillClass.replacingOccurrences(of: "h-[1.4rem] px-2", with: "h-8 px-3"),
            developTouchPillClass
        )
        XCTAssertTrue(developLinkClass.contains("underline"))
        XCTAssertFalse(developButtonClass.contains("underline"))
    }
}
