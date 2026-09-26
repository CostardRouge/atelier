// Port of `src/tools/roadtrip/library-sync.test.ts`, case for case.

import Foundation
import XCTest
@testable import AtelierKit

private func syncState(settled: Bool = true, tickMoved: Bool = false, slideName: String? = "alpha.jpg",
                       activeName: String? = "alpha.jpg") -> SyncState {
    SyncState(settled: settled, tickMoved: tickMoved, slideName: slideName, activeName: activeName)
}

final class LibrarySyncMoveTests: XCTestCase {
    func testRestoresUntilTheSlidesOwnPictureHasBeenLookedFor() {
        XCTAssertEqual(syncMove(syncState(settled: false)), .restore)
        XCTAssertEqual(syncMove(syncState(settled: false, tickMoved: true, activeName: "bravo.jpg")), .restore)
    }

    func testDoesNothingWhileTheTwoAgree() {
        XCTAssertEqual(syncMove(syncState()), .idle)
        XCTAssertEqual(syncMove(syncState(tickMoved: true)), .idle)
        XCTAssertEqual(syncMove(syncState(activeName: "ALPHA.JPG")), .idle)
    }

    func testRecordsThePictureTheAuthorTicked() {
        XCTAssertEqual(syncMove(syncState(tickMoved: true, activeName: "bravo.jpg")), .record)
        // An empty slide taking its first picture.
        XCTAssertEqual(syncMove(syncState(tickMoved: true, slideName: nil, activeName: "bravo.jpg")), .record)
    }

    func testLeavesTheSlideAloneWhenThePictureMovedUnderATickNobodyTouched() {
        // An undo, a redo: the slide names another picture and the Library is
        // still on the one it held. Writing it back is what made undo look dead.
        XCTAssertEqual(syncMove(syncState(slideName: "alpha.jpg", activeName: "bravo.jpg")), .idle)
        // A cleared cell, with its picture still ticked.
        XCTAssertEqual(syncMove(syncState(slideName: nil)), .idle)
    }

    func testNeverRecordsWhenNothingIsTicked() {
        XCTAssertEqual(syncMove(syncState(tickMoved: true, activeName: nil)), .idle)
    }
}

final class LibrarySyncClaimTests: XCTestCase {
    func testNamesTheSlideAndItsPictureSoAChangedPictureIsRestoredAgain() {
        XCTAssertNotEqual(restoreClaim("hook", "alpha.jpg"), restoreClaim("hook", "bravo.jpg"))
        XCTAssertNotEqual(restoreClaim("hook", nil), restoreClaim("hook", "alpha.jpg"))
        XCTAssertEqual(restoreClaim("hook", "Alpha.JPG"), restoreClaim("hook", "alpha.jpg"))
    }

    func testKeepsTwoCellsOfOneSlideApart() {
        XCTAssertNotEqual(restoreClaim("s1#1", "alpha.jpg"), restoreClaim("s1#2", "alpha.jpg"))
    }

    func testCannotBeForgedByAFileNameThatLooksLikeAKey() {
        XCTAssertNotEqual(restoreClaim("hook", "x"), restoreClaim("hook\u{0}x", nil))
    }

    func testTakesARefAsTheWebPassesIt() {
        let ref = SavedMediaRef(name: "Alpha.JPG", size: 1, lastModified: 1)
        XCTAssertEqual(restoreClaim("hook", media: ref), restoreClaim("hook", "alpha.jpg"))
        XCTAssertEqual(restoreClaim("hook", media: nil), restoreClaim("hook", nil))
    }
}

final class LibrarySyncSameFileNameTests: XCTestCase {
    func testIgnoresCaseAndTreatsTwoAbsencesAsTheSame() {
        XCTAssertTrue(sameFileName("a.JPG", "a.jpg"))
        XCTAssertTrue(sameFileName(nil, nil))
        XCTAssertFalse(sameFileName(nil, "a.jpg"))
    }
}
