// Port of `src/shared/develop/write-through.test.ts`.

import XCTest
@testable import AtelierKit

/// A value with one number in it, compared the way a develop is: by what it says.
private struct Box: Equatable {
    var n: Int
}

private func same(_ a: Box?, _ b: Box?) -> Bool { (a?.n ?? 0) == (b?.n ?? 0) }

final class WriteThroughTests: XCTestCase {
    func testOwesNothingWhenItOpens() {
        let w = newWriteThrough(Box(n: 1))
        XCTAssertNil(w.pending)
        XCTAssertFalse(flushed(w).owed)
    }

    func testOwesAWriteOnceTheDraftMovesAndRemembersWhatItWrote() {
        var w = newWriteThrough(Box(n: 1))
        w = drafted(w, Box(n: 2), same)
        XCTAssertEqual(w.pending?.value, Box(n: 2))
        let out = flushed(w)
        XCTAssertTrue(out.owed)
        XCTAssertEqual(out.value, Box(n: 2))
        XCTAssertEqual(out.state.written, Box(n: 2))
        XCTAssertNil(out.state.pending)
        // A draft taken back to NOTHING owes a write too — of nothing.
        let cleared = flushed(drafted(newWriteThrough(Box(n: 4)), nil, same))
        XCTAssertTrue(cleared.owed)
        XCTAssertNil(cleared.value)
        XCTAssertNil(cleared.state.written)
    }

    func testOwesNothingForAGestureThatEndsWhereItStarted() {
        var w = newWriteThrough(Box(n: 1))
        w = drafted(w, Box(n: 5), same)
        w = drafted(w, Box(n: 1), same)
        XCTAssertNil(w.pending)
        XCTAssertFalse(flushed(w).owed)
    }

    func testDoesNotReadTheDocumentLaggingAGestureAsSomebodyElsesEdit() {
        // The drag writes 2, then moves on to 3 before the document has caught up:
        // what arrives is the 2 we wrote, and it must not reseed the draft to it.
        var w = newWriteThrough(Box(n: 1))
        w = flushed(drafted(w, Box(n: 2), same)).state
        w = drafted(w, Box(n: 3), same)
        let back = arrived(w, Box(n: 2), same)
        XCTAssertFalse(back.reseed)
        XCTAssertEqual(back.state.pending?.value, Box(n: 3))
    }

    func testTakesAValueTheEditorDidNotWriteAnUndoABatchVerbAnInstancesCopy() {
        var w = newWriteThrough(Box(n: 1))
        w = flushed(drafted(w, Box(n: 2), same)).state
        let back = arrived(w, Box(n: 1), same)
        XCTAssertTrue(back.reseed)
        XCTAssertEqual(back.state.written, Box(n: 1))
    }

    func testDropsWhatItOwedWhenTheDocumentIsChangedUnderIt() {
        // Undo landing mid-gesture: the pending write would otherwise put the
        // undone value straight back a moment later.
        var w = newWriteThrough(Box(n: 1))
        w = drafted(w, Box(n: 9), same)
        let back = arrived(w, Box(n: 0), same)
        XCTAssertTrue(back.reseed)
        XCTAssertNil(back.state.pending)
        XCTAssertFalse(flushed(back.state).owed)
    }

    func testReadsNilAndTheValueAtRestAsTheSameThing() {
        var w = newWriteThrough(Box?.none)
        w = drafted(w, Box(n: 0), same)
        XCTAssertNil(w.pending)
        XCTAssertFalse(arrived(w, Box(n: 0), same).reseed)
    }
}
