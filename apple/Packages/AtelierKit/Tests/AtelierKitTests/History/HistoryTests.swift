// Port of `src/shared/history/history.test.ts`.

import XCTest
@testable import AtelierKit

/// A document-shaped value: a new value per edit, as every tool builds them.
private struct Doc: Equatable {
    var name: String
}

private func doc(_ name: String) -> Doc { Doc(name: name) }

final class HistoryRecordTests: XCTestCase {
    func testKeepsTheStateADocumentOpenedOnAsTheFirstStepBack() {
        let opened = doc("a")
        let h = AtelierKit.record(newHistory(opened), doc("b"), RecordOptions(now: 1_000))
        XCTAssertEqual(h.past, [opened])
        XCTAssertTrue(canUndo(h))
    }

    func testNeverMergesIntoTheOpeningStateHoweverFastTheFirstEditLands() {
        // The seed is sealed: an edit one millisecond later must still leave the
        // opened document reachable, or a document edited on sight cannot be undone.
        let opened = doc("a")
        let h = AtelierKit.record(newHistory(opened), doc("b"), RecordOptions(now: 1))
        XCTAssertEqual(h.past, [opened])
    }

    func testMergesEditsThatArriveCloseTogetherUnderTheSameLabel() {
        var h = AtelierKit.record(newHistory(doc("a")), doc("b"), RecordOptions(now: 1_000, label: "trip"))
        h = AtelierKit.record(h, doc("c"), RecordOptions(now: 1_100, label: "trip"))
        h = AtelierKit.record(h, doc("d"), RecordOptions(now: 1_200, label: "trip"))
        XCTAssertEqual(h.present, doc("d"))
        // One gesture, one step: undo lands on what was there before it started.
        XCTAssertEqual(h.past, [doc("a")])
    }

    func testStartsANewStepOnceTheWindowHasPassed() {
        var h = AtelierKit.record(newHistory(doc("a")), doc("b"), RecordOptions(now: 1_000, label: "trip"))
        h = AtelierKit.record(h, doc("c"), RecordOptions(now: 1_000 + coalesceMs + 1, label: "trip"))
        XCTAssertEqual(h.past, [doc("a"), doc("b")])
    }

    func testStartsANewStepWhenTheLabelChangesHoweverCloseTheEditsAre() {
        var h = AtelierKit.record(newHistory(doc("a")), doc("b"), RecordOptions(now: 1_000, label: "post:1"))
        h = AtelierKit.record(h, doc("c"), RecordOptions(now: 1_010, label: "post:2"))
        XCTAssertEqual(h.past, [doc("a"), doc("b")])
        XCTAssertEqual(h.label, "post:2")
    }

    func testIgnoresAValueThatIsAlreadyThePresent() {
        // The web asks `Object.is`; a Swift value has no identity, so an EQUAL
        // document is the same document — the honest reading, and what a
        // watcher that hands a restored value back down relies on.
        let same = doc("a")
        let h = newHistory(same)
        XCTAssertEqual(AtelierKit.record(h, same, RecordOptions(now: 1_000)), h)
        XCTAssertEqual(AtelierKit.record(h, doc("a"), RecordOptions(now: 1_000)), h)
    }

    func testTakesACallersOwnSamenessForADocumentWithIdentity() {
        // A class-typed document compares `===`; the closure is where that goes.
        final class Box { let name: String; init(_ name: String) { self.name = name } }
        let opened = Box("a")
        let h = newHistory(opened)
        let unchanged = AtelierKit.record(h, opened, RecordOptions(now: 1_000), same: { $0 === $1 })
        XCTAssertTrue(unchanged.past.isEmpty)
        let edited = AtelierKit.record(h, Box("a"), RecordOptions(now: 1_000), same: { $0 === $1 })
        XCTAssertEqual(edited.past.count, 1)
        XCTAssertTrue(edited.past[0] === opened)
    }

    func testDropsTheOldestStepPastTheLimit() {
        var h = newHistory(doc("0"))
        for i in 1...5 {
            h = AtelierKit.record(h, doc(String(i)), RecordOptions(now: Double(i) * 10_000, limit: 3))
        }
        XCTAssertEqual(h.past, [doc("2"), doc("3"), doc("4")])
        XCTAssertEqual(h.present, doc("5"))
    }
}

final class HistoryUndoRedoTests: XCTestCase {
    func testWalkTheStackBothWays() {
        var h = AtelierKit.record(newHistory(doc("a")), doc("b"), RecordOptions(now: 1_000))
        h = AtelierKit.record(h, doc("c"), RecordOptions(now: 10_000))
        h = undo(h)
        XCTAssertEqual(h.present, doc("b"))
        h = undo(h)
        XCTAssertEqual(h.present, doc("a"))
        XCTAssertFalse(canUndo(h))
        h = redo(h)
        XCTAssertEqual(h.present, doc("b"))
        h = redo(h)
        XCTAssertEqual(h.present, doc("c"))
        XCTAssertFalse(canRedo(h))
    }

    func testStandStillAtEitherEnd() {
        let h = newHistory(doc("a"))
        XCTAssertEqual(undo(h), h)
        XCTAssertEqual(redo(h), h)
    }

    func testSealWhatTheyLandOnSoTheNextEditCannotSwallowIt() {
        var h = AtelierKit.record(newHistory(doc("a")), doc("b"), RecordOptions(now: 1_000, label: "trip"))
        h = undo(h)
        // Same label, one millisecond later: it must still be a step of its own,
        // or undoing and then editing loses the state undo just came back to.
        h = AtelierKit.record(h, doc("c"), RecordOptions(now: 1_001, label: "trip"))
        XCTAssertEqual(h.past, [doc("a")])
        XCTAssertEqual(undo(h).present, doc("a"))
    }

    func testDropTheRedoBranchAsSoonAsSomethingElseIsEdited() {
        var h = AtelierKit.record(newHistory(doc("a")), doc("b"), RecordOptions(now: 1_000))
        h = undo(h)
        h = AtelierKit.record(h, doc("c"), RecordOptions(now: 2_000))
        XCTAssertFalse(canRedo(h))
        XCTAssertEqual(h.present, doc("c"))
    }
}

final class HistorySealTests: XCTestCase {
    func testClosesTheOpenStep() {
        var h = AtelierKit.record(newHistory(doc("a")), doc("b"), RecordOptions(now: 1_000, label: "trip"))
        h = AtelierKit.record(seal(h), doc("c"), RecordOptions(now: 1_050, label: "trip"))
        XCTAssertEqual(h.past, [doc("a"), doc("b")])
    }

    func testLeavesAnAlreadyClosedHistoryAlone() {
        let h = newHistory(doc("a"))
        XCTAssertEqual(seal(h), h)
    }
}

final class SameSliceTests: XCTestCase {
    func testReadsAMemberRebuiltWithTheSameContentsAsUnchanged() throws {
        // What `useLutStack.restore` does to an already empty stack, and what cost
        // a graded project its grade the first time it opened: a fresh `[]` and a
        // fresh `{}` mean nothing.
        let a: [String: JSONValue] = ["layers": [], "text": [:]]
        let b: [String: JSONValue] = ["layers": [], "text": [:]]
        XCTAssertTrue(sameSlice(a, b))
        // The web's other half — `shallowSame` calling the same pair an EDIT —
        // is JavaScript object identity, which a Swift value does not have.
        throw XCTSkip("`shallowSame` reads a rebuilt equal member as an edit only where a member has identity; a Swift value has none, so `==` is the reading")
    }

    func testSeesAMemberAppearChangeMoveOrGo() {
        let a: JSONValue = ["id": "a"]
        let b: JSONValue = ["id": "b"]
        XCTAssertTrue(sameSlice(["l": [a, b]], ["l": [a, b]]))
        XCTAssertFalse(sameSlice(["l": [a, b]], ["l": [b, a]]))
        XCTAssertFalse(sameSlice(["l": [a, b]], ["l": [a]]))
        XCTAssertFalse(sameSlice(["t": ["x": 1]], ["t": ["x": 2]]))
        XCTAssertFalse(sameSlice(["t": ["x": 1]], ["t": ["x": 1, "y": 1]]))
        XCTAssertFalse(sameSlice(["t": ["x": 1]], ["t": ["x": 1], "u": ["x": 1]]))
    }

    func testAnEqualItemRebuiltIsNotAnEditHereWhereTheWebReadsIdentity() throws {
        // `sameSlice({ l: [a] }, { l: [{ id: 'a' }] })` is false on the web: an
        // item of an immutably updated collection is a new object exactly when
        // it changed. A value carries no such trace.
        let a: JSONValue = ["id": "a"]
        XCTAssertTrue(sameSlice(["l": [a]], ["l": [["id": "a"]]]))
        throw XCTSkip("an item's identity is JavaScript's; here an equal item is the same item")
    }

    func testStopsAtOneLevelANestedObjectIsComparedByIdentity() throws {
        let inner: JSONValue = ["deep": 1]
        XCTAssertTrue(sameSlice(["t": ["inner": inner]], ["t": ["inner": inner]]))
        // Two equal-but-rebuilt inner objects are an edit on the web — which is
        // right there, since an immutable update only rebuilds what changed.
        throw XCTSkip("the nested object's identity is JavaScript's; here a rebuilt equal object is the same object")
    }

    func testComparesAnythingThatIsNotAnArrayOrAPlainRecordByIdentity() throws {
        let plain: [String: JSONValue] = ["n": 1, "s": "a", "z": nil]
        let other: [String: JSONValue] = ["n": 1, "s": "b", "z": nil]
        XCTAssertTrue(sameSlice(plain, ["n": 1, "s": "a", "z": nil]))
        XCTAssertFalse(sameSlice(plain, other))
        throw XCTSkip("the `Date` half compares two instances by identity; a Swift `Date` is a value")
    }
}

final class ShallowSameTests: XCTestCase {
    func testReadsARebuiltSliceOfUnchangedMembersAsUnchanged() {
        let elements: JSONValue = []
        let theme: JSONValue = ["id": "t"]
        XCTAssertTrue(shallowSame(["elements": elements, "theme": theme, "name": "a"],
                                  ["elements": elements, "theme": theme, "name": "a"]))
    }

    func testSeesAMemberReplacedAndAMemberAdded() throws {
        let theme: JSONValue = ["id": "t"]
        XCTAssertFalse(shallowSame(["theme": theme, "name": "a"], ["theme": theme, "name": "b"]))
        XCTAssertFalse(shallowSame(["theme": theme], ["theme": theme, "name": "a"]))
        // Equal contents in a NEW object is an edit on the web as far as one
        // level can tell — which is why every member of a slice is held
        // immutably there. A value has no "new object".
        throw XCTSkip("`shallowSame({ theme: { id: 't' } }, { theme: { id: 't' } })` is false only under object identity")
    }
}
