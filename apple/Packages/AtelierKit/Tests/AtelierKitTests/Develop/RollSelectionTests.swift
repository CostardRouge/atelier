// Port of `src/shared/develop/roll-editor.test.ts`.

import XCTest
@testable import AtelierKit

private struct Item: RollSelectionItem, Equatable {
    var id: String
    var ignored = false
}

/// An object with an identity, as the web's pictures are — what `pictureAfterRestore`'s spec is written against.
private final class Obj: RollSelectionItem {
    let id: String
    init(_ id: String) { self.id = id }
}

private let strip = [Item(id: "a"), Item(id: "b"), Item(id: "c")]
private let wideStrip = [Item(id: "a"), Item(id: "b"), Item(id: "c"), Item(id: "d")]

private func press(_ key: String, repeat: Bool = false, metaKey: Bool = false, ctrlKey: Bool = false, shiftKey: Bool = false,
                   targetTypes: Bool = false, hasSelection: Bool = false, layersTab: Bool = false) -> EditorKeyAction? {
    editorKeyAction(EditorKeyPress(key: key, repeat: `repeat`, metaKey: metaKey, ctrlKey: ctrlKey, shiftKey: shiftKey,
                                   targetTypes: targetTypes, hasSelection: hasSelection, layersTab: layersTab))
}

final class RollEditorOpenPictureTests: XCTestCase {
    func testTakesTheRouteWhenItNamesAPictureOnTheRollElseTheFirst() {
        XCTAssertEqual(openPictureId(strip, "b"), "b")
        XCTAssertEqual(openPictureId(strip, "gone"), "a")
        XCTAssertEqual(openPictureId(strip, nil), "a")
        XCTAssertNil(openPictureId([Item](), "a"))
    }

    func testStepsAlongTheStripAndStopsAtItsEnds() {
        XCTAssertEqual(stepPicture(strip, "a", 1), "b")
        XCTAssertEqual(stepPicture(strip, "c", 1), "c")
        XCTAssertEqual(stepPicture(strip, "a", -1), "a")
        XCTAssertEqual(stepPicture(strip, nil, 1), "b")
        XCTAssertNil(stepPicture([Item](), "a", 1))
    }

    func testStepsOverAnIgnoredPictureAndHandsOnFromOneOpenedByAClick() {
        let roll = [Item(id: "a"), Item(id: "x", ignored: true), Item(id: "y", ignored: true), Item(id: "b"), Item(id: "z", ignored: true)]
        let skip: (Item) -> Bool = { $0.ignored }
        XCTAssertEqual(stepPicture(roll, "a", 1, skip: skip), "b")
        XCTAssertEqual(stepPicture(roll, "b", -1, skip: skip), "a")
        // Nothing further that way: it stays.
        XCTAssertEqual(stepPicture(roll, "b", 1, skip: skip), "b")
        // Opened by hand, an ignored picture lets the arrows go on to the next live one.
        XCTAssertEqual(stepPicture(roll, "x", 1, skip: skip), "b")
        XCTAssertEqual(stepPicture(roll, "y", -1, skip: skip), "a")
    }

    func testOpensThePictureThatTakesTheRemovedOnesPlace() {
        XCTAssertEqual(openAfterRemoval(strip, "a", "b"), "b")
        XCTAssertEqual(openAfterRemoval(strip, "b", "b"), "c")
        XCTAssertEqual(openAfterRemoval(strip, "c", "c"), "b")
        XCTAssertNil(openAfterRemoval([Item(id: "a")], "a", "a"))
    }
}

final class RollEditorSameDevelopTests: XCTestCase {
    func testReadsNilAndAnUntouchedSetAsTheSame() {
        XCTAssertTrue(sameDevelop(nil, .default))
        XCTAssertTrue(sameDevelop(dev { $0.exposure = 0.5 }, dev { $0.exposure = 0.5 }))
        XCTAssertFalse(sameDevelop(dev { $0.exposure = 0.5 }, nil))
    }
}

final class EditorKeyActionTests: XCTestCase {
    func testMapsTheEditorKeys() {
        XCTAssertEqual(press("ArrowLeft"), .previous)
        XCTAssertEqual(press("ArrowRight", repeat: true), .next)
        XCTAssertEqual(press("\\"), .hold)
        XCTAssertEqual(press("z"), .zoom)
        XCTAssertEqual(press("c", metaKey: true), .copy)
        XCTAssertEqual(press("V", ctrlKey: true), .paste)
    }

    func testMapsTheDeliveryKeysOffTheLayersTab() {
        XCTAssertEqual(press("p"), .deliver)
        XCTAssertEqual(press("U"), .deliverAuto)
        XCTAssertEqual(press("m"), .ignore)
        XCTAssertNil(press("p", repeat: true))
        XCTAssertNil(press("m", targetTypes: true))
    }

    func testMakesAVariantOnCommandApostropheOncePerPressNeverWhileTyping() {
        XCTAssertEqual(press("'", metaKey: true), .variant)
        XCTAssertEqual(press("'", ctrlKey: true), .variant)
        XCTAssertNil(press("'", repeat: true, metaKey: true))
        XCTAssertNil(press("'", metaKey: true, targetTypes: true))
        XCTAssertNil(press("'"))
    }

    func testOpensTheSectionsOnCommandShiftCAndPastesThemOnCommandShiftVNeverOverATextSelection() {
        XCTAssertEqual(press("C", metaKey: true, shiftKey: true), .copySettings)
        XCTAssertEqual(press("v", ctrlKey: true, shiftKey: true), .pasteSettings)
        XCTAssertNil(press("c", metaKey: true, shiftKey: true, hasSelection: true))
        XCTAssertNil(press("c", metaKey: true, shiftKey: true, targetTypes: true))
    }

    func testYieldsToAFieldASelectionAHeldKeyAndOtherChords() {
        XCTAssertNil(press("ArrowLeft", targetTypes: true))
        XCTAssertNil(press("c", metaKey: true, hasSelection: true))
        XCTAssertNil(press("\\", repeat: true))
        XCTAssertNil(press("z", metaKey: true))
        XCTAssertNil(press("ArrowRight", shiftKey: true))
        XCTAssertNil(press("x", metaKey: true, shiftKey: true))
        XCTAssertNil(press("q"))
    }

    func testOnTheLayersTabStepsTheMaskViewOnMAndTurnsPickOnP() {
        XCTAssertEqual(press("m", layersTab: true), .mask)
        XCTAssertEqual(press("M", layersTab: true), .mask)
        XCTAssertEqual(press("p", layersTab: true), .pick)
        XCTAssertEqual(press("u", layersTab: true), .deliverAuto)
        // A slider or a field keeps its letters.
        XCTAssertNil(press("m", targetTypes: true, layersTab: true))
        XCTAssertNil(press("p", repeat: true, layersTab: true))
    }

    func testRemovesTheSelectionOnDeleteOrBackspaceAndLetsGoOnEscapeNeverFromAField() {
        XCTAssertEqual(press("Delete"), .remove)
        XCTAssertEqual(press("Backspace"), .remove)
        XCTAssertNil(press("Backspace", targetTypes: true))
        XCTAssertNil(press("Backspace", repeat: true))
        XCTAssertEqual(press("Escape"), .escape)
        XCTAssertNil(press("Escape", metaKey: true))
    }

    func testOpensTheShortcutsOnHAndTheFactsOnI() {
        XCTAssertEqual(press("h"), .help)
        XCTAssertEqual(press("H"), .help)
        XCTAssertEqual(press("i"), .facts)
        XCTAssertEqual(press("I"), .facts)
    }

    func testPaintsTheClippingOnJAndNotWhileAFieldTypes() {
        XCTAssertEqual(press("j"), .clipping)
        XCTAssertEqual(press("J"), .clipping)
        XCTAssertNil(press("j", repeat: true))
        XCTAssertNil(press("j", targetTypes: true))
    }

    func testFlipsBlackAndWhiteOnVAndLeavesCommandVToThePaste() {
        XCTAssertEqual(press("v"), .mono)
        XCTAssertEqual(press("V"), .mono)
        XCTAssertEqual(press("v", metaKey: true), .paste)
        XCTAssertNil(press("v", repeat: true))
    }

    func testAnswersQuestionMarkAlthoughItIsAShiftedKey() {
        // On most layouts `?` cannot be pressed WITHOUT shift, so the blanket
        // refusal would have made the help key unreachable.
        XCTAssertEqual(press("?", shiftKey: true), .help)
        XCTAssertEqual(press("?"), .help)
        XCTAssertNil(press("?", repeat: true))
        XCTAssertNil(press("?", targetTypes: true))
        XCTAssertNil(press("?", metaKey: true))
        XCTAssertNil(press("h", shiftKey: true))
    }

    func testCropsToTheViewOnShiftCAndABareCStillOpensTheCrop() {
        XCTAssertEqual(press("C", shiftKey: true), .cropView)
        XCTAssertEqual(press("c", shiftKey: true), .cropView)
        XCTAssertNil(press("C", repeat: true, shiftKey: true))
        // With ⌘ it is the settings' copy, never the crop.
        XCTAssertEqual(press("C", metaKey: true, shiftKey: true), .copySettings)
        XCTAssertNil(press("C", shiftKey: true, targetTypes: true))
        XCTAssertEqual(press("c"), .tab(.crop))
    }

    func testOpensEachTabOnItsOwnInitial() {
        XCTAssertEqual(press("a"), .tab(.adjust))
        XCTAssertEqual(press("A"), .tab(.adjust))
        XCTAssertEqual(press("d"), .tab(.detail))
        XCTAssertEqual(press("l"), .tab(.layers))
        XCTAssertEqual(press("c"), .tab(.crop))
        XCTAssertEqual(press("e"), .tab(.export))
        XCTAssertEqual(press("x"), .swap)
        XCTAssertEqual(press("X"), .swap)
        XCTAssertNil(press("r"))
        XCTAssertNil(press("a", targetTypes: true))
        XCTAssertNil(press("d", repeat: true))
    }

    func testKeepsCommandCForTheDevelopSoABareCCanOpenTheCrop() {
        XCTAssertEqual(press("c", metaKey: true), .copy)
        XCTAssertEqual(press("c"), .tab(.crop))
    }

    func testTheTabsAreListedInTheStripsOrder() {
        XCTAssertEqual(workbenchTabs.map { $0.label }, ["Adjust", "Detail", "Layers", "Crop", "Export"])
    }
}

final class PictureRangeTests: XCTestCase {
    func testSpansTheStripBetweenTwoIdsWhicheverComesFirst() {
        XCTAssertEqual(pictureRange(wideStrip, "a", "c"), ["a", "b", "c"])
        XCTAssertEqual(pictureRange(wideStrip, "c", "a"), ["a", "b", "c"])
        XCTAssertEqual(pictureRange(wideStrip, "b", "b"), ["b"])
    }

    func testReadsAnIdOffTheRollAsJustTheOtherEnd() {
        XCTAssertEqual(pictureRange(wideStrip, "gone", "b"), ["b"])
    }
}

final class SelectionAfterClickTests: XCTestCase {
    func testReplacesTheSelectionWithTheRangeFromTheAnchorOnShiftWithoutMovingTheAnchor() {
        let first = selectionAfterClick(wideStrip, [], "a", "c", SelectionModifiers(shiftKey: true))
        XCTAssertEqual(first, ["a", "b", "c"])
        // A second Shift-click from the SAME anchor replaces, it does not accumulate.
        let second = selectionAfterClick(wideStrip, first, "a", "b", SelectionModifiers(shiftKey: true))
        XCTAssertEqual(second, ["a", "b"])
    }

    func testTogglesOnePictureInPlaceOnCommandOrControlClickKeepingTheRest() {
        let withB = selectionAfterClick(wideStrip, ["a"], "a", "b", SelectionModifiers(metaKey: true))
        XCTAssertEqual(withB, ["a", "b"])
        let withoutA = selectionAfterClick(wideStrip, withB, "b", "a", SelectionModifiers(ctrlKey: true))
        XCTAssertEqual(withoutA, ["b"])
    }

    func testLeavesTheSelectionAloneOnAPlainClick() {
        let selected: Set<String> = ["a", "b"]
        XCTAssertEqual(selectionAfterClick(wideStrip, selected, "a", "c", SelectionModifiers()), selected)
    }
}

final class PictureAfterRestoreTests: XCTestCase {
    private let a = Obj("a")
    private let b = Obj("b")
    private let c = Obj("c")
    private let same: (Obj, Obj) -> Bool = { $0 === $1 }

    func testOpensThePictureAnUndoChangedWhenItIsNotTheOneOnScreen() {
        let b2 = Obj("b")
        XCTAssertEqual(pictureAfterRestore([a, b, c], [a, b2, c], "c", same: same), "b")
    }

    func testStaysWhenTheOpenPictureIsAmongTheChangedOrWhenNoPictureChanged() {
        let a2 = Obj("a")
        let b2 = Obj("b")
        XCTAssertNil(pictureAfterRestore([a, b, c], [a2, b2, c], "a", same: same))
        XCTAssertNil(pictureAfterRestore([a, b, c], [a, b, c], "c", same: same))
    }

    func testOpensAPictureAnUndoBroughtBackAndTheFirstChangedOfAnApplyTo() {
        XCTAssertEqual(pictureAfterRestore([a, c], [a, b, c], "c", same: same), "b")
        let b2 = Obj("b")
        let c2 = Obj("c")
        XCTAssertEqual(pictureAfterRestore([a, b, c], [a, b2, c2], "a", same: same), "b")
    }

    func testReadsAChangedRollPictureByItsValue() {
        // A Swift picture is a value: an edit changes it, a restore of the same value does not.
        let ref = SavedMediaRef(name: "a.jpg", size: 1, lastModified: 1)
        let p1 = RollPicture(id: "p1", ref: ref)
        let p2 = RollPicture(id: "p2", ref: ref)
        var edited = p2
        edited.aspect = "4:5"
        XCTAssertEqual(pictureAfterRestore([p1, p2], [p1, edited], "p1"), "p2")
        XCTAssertNil(pictureAfterRestore([p1, p2], [p1, p2], "p1"))
    }
}
