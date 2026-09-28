// Port of `src/shared/history/undo-keys.test.ts`.

import XCTest
@testable import AtelierKit

/// ⌘Z with nothing focused, a few fields changed.
private func press(_ change: (inout UndoKeyPress) -> Void = { _ in }) -> UndoKeyPress {
    var p = UndoKeyPress(key: "z", defaultPrevented: false, altKey: false, ctrlKey: false, metaKey: true, shiftKey: false, target: nil)
    change(&p)
    return p
}

/// A plain element, a few fields changed.
private func target(_ change: (inout KeyTarget) -> Void = { _ in }) -> KeyTarget {
    var t = KeyTarget(tagName: "DIV", isContentEditable: false, role: nil)
    change(&t)
    return t
}

final class UndoKeyActionTests: XCTestCase {
    func testReadsBothPlatformsAccelerators() {
        XCTAssertEqual(undoKeyAction(press()), .undo)
        XCTAssertEqual(undoKeyAction(press { $0.metaKey = false; $0.ctrlKey = true }), .undo)
        XCTAssertEqual(undoKeyAction(press { $0.shiftKey = true }), .redo)
        XCTAssertEqual(undoKeyAction(press { $0.metaKey = false; $0.ctrlKey = true; $0.shiftKey = true }), .redo)
        XCTAssertEqual(undoKeyAction(press { $0.key = "y"; $0.metaKey = false; $0.ctrlKey = true }), .redo)
    }

    func testReadsACapitalisedKeyShiftIsWhatCapitalisesIt() {
        XCTAssertEqual(undoKeyAction(press { $0.key = "Z"; $0.shiftKey = true }), .redo)
    }

    func testWantsExactlyOneModifierAndNeverAlt() {
        XCTAssertNil(undoKeyAction(press { $0.metaKey = false }))
        XCTAssertNil(undoKeyAction(press { $0.ctrlKey = true }))
        XCTAssertNil(undoKeyAction(press { $0.altKey = true }))
    }

    func testLeavesAFieldItsOwnUndo() {
        XCTAssertNil(undoKeyAction(press { $0.target = target { $0.tagName = "INPUT" } }))
        XCTAssertNil(undoKeyAction(press { $0.target = target { $0.tagName = "INPUT"; $0.inputType = "text" } }))
        XCTAssertNil(undoKeyAction(press { $0.target = target { $0.tagName = "INPUT"; $0.inputType = "number" } }))
        XCTAssertNil(undoKeyAction(press { $0.target = target { $0.tagName = "TEXTAREA" } }))
        XCTAssertNil(undoKeyAction(press { $0.target = target { $0.isContentEditable = true } }))
    }

    func testActsWithASliderFocusedARangeHoldsNoTextToUndo() {
        // Every develop number is a range input and a drag leaves it focused:
        // standing down there swallowed every ⌘Z after the first edit.
        XCTAssertEqual(undoKeyAction(press { $0.target = target { $0.tagName = "INPUT"; $0.inputType = "range" } }), .undo)
        XCTAssertEqual(undoKeyAction(press { $0.target = target { $0.tagName = "INPUT"; $0.inputType = "checkbox" } }), .undo)
        XCTAssertEqual(undoKeyAction(press { $0.target = target { $0.tagName = "SELECT" } }), .undo)
    }

    func testActsWithAButtonFocusedAButtonUndoesNothingOfItsOwn() {
        XCTAssertEqual(undoKeyAction(press { $0.target = target { $0.tagName = "BUTTON" } }), .undo)
    }

    func testStandsDownOnAPressSomethingElseAlreadyHandled() {
        XCTAssertNil(undoKeyAction(press { $0.defaultPrevented = true }))
    }

    func testIgnoresEveryOtherKey() {
        XCTAssertNil(undoKeyAction(press { $0.key = "x" }))
        XCTAssertNil(undoKeyAction(press { $0.key = "y"; $0.shiftKey = true }))
    }
}
