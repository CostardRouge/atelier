// Port of `src/shared/develop/curve-edit.test.ts`.

import XCTest
@testable import AtelierKit

private let line: Curve = [CurvePoint(x: 0, y: 0), CurvePoint(x: 1, y: 1)]
private let three: Curve = [CurvePoint(x: 0, y: 0), CurvePoint(x: 0.5, y: 0.5), CurvePoint(x: 1, y: 1)]

final class PointAtTests: XCTestCase {
    func testGrabsTheNearestPointInsideTheRadiusAndNothingOutsideIt() {
        XCTAssertEqual(pointAt(three, 0.5, 0.5), 1)
        XCTAssertEqual(pointAt(three, 0.5 + grabRadius * 0.5, 0.5), 1)
        XCTAssertEqual(pointAt(three, 0.5, 0.2), -1)
        XCTAssertEqual(pointAt(three, 0.02, 0.02), 0)
    }

    func testIsACircleNotABoxAFarDiagonalIsAMiss() {
        // Inside the bounding box on both axes, outside the radius.
        let d = grabRadius * 0.8
        XCTAssertEqual(pointAt(three, 0.5 + d, 0.5 + d), -1)
    }

    func testPicksTheNearerOfTwoNeighboursSoEachKeepsItsOwnSide() {
        let crowded: Curve = [
            CurvePoint(x: 0, y: 0),
            CurvePoint(x: 0.4, y: 0.4),
            CurvePoint(x: 0.44, y: 0.5),
            CurvePoint(x: 1, y: 1),
        ]
        XCTAssertEqual(pointAt(crowded, 0.405, 0.4), 1)
        XCTAssertEqual(pointAt(crowded, 0.438, 0.5), 2)
    }
}

final class MoveCurvePointTests: XCTestCase {
    func testMovesYFreelyAndClampsItToTheBox() {
        XCTAssertEqual(moveCurvePoint(three, 1, 0.5, 0.8)[1], CurvePoint(x: 0.5, y: 0.8))
        XCTAssertEqual(moveCurvePoint(three, 1, 0.5, 5)[1].y, 1)
        XCTAssertEqual(moveCurvePoint(three, 1, 0.5, -5)[1].y, 0)
    }

    func testPensAPointInBehindItsNeighboursInsteadOfSwappingThemUnderTheHand() {
        // Dragged well past the neighbour, not merely near it.
        assertClose(moveCurvePoint(three, 1, 1.5, 0.5)[1].x, 1 - minGap, 12)
        assertClose(moveCurvePoint(three, 1, -1, 0.5)[1].x, minGap, 12)
        // Short of the limit it simply goes where it was put.
        XCTAssertEqual(moveCurvePoint(three, 1, 0.9, 0.5)[1].x, 0.9)
        // Still sorted and still legal after the move, which is what the pen is for.
        XCTAssertEqual(normaliseCurve(curveJSON(moveCurvePoint(three, 1, 1.5, 0.5)))?.count, 3)
    }

    func testLetsAnEndPointTravelInXThatIsHowAnInputBlackPointIsSet() {
        let blackPoint = moveCurvePoint(line, 0, 0.3, 0)
        XCTAssertEqual(blackPoint[0], CurvePoint(x: 0.3, y: 0))
        // Everything below it is black, because makeCurve holds the end value.
        let f = makeCurve(blackPoint)
        XCTAssertEqual(f(0.1), 0)
        assertClose(f(0.3), 0, 12)
        assertClose(f(1), 1, 12)
    }

    func testLeavesTheCurveAloneForAnIndexItDoesNotHave() {
        XCTAssertEqual(moveCurvePoint(three, 9, 0.5, 0.5), three)
        XCTAssertEqual(moveCurvePoint(three, -1, 0.5, 0.5), three)
    }

    func testNeverReturnsAPointOutsideItsNeighboursEvenSqueezedToNothing() {
        let tight: Curve = [
            CurvePoint(x: 0.5, y: 0),
            CurvePoint(x: 0.5 + minGap, y: 0.5),
            CurvePoint(x: 0.5 + minGap * 2, y: 1),
        ]
        let out = moveCurvePoint(tight, 1, 0.9, 0.5)
        XCTAssertGreaterThanOrEqual(out[1].x, tight[0].x)
        XCTAssertLessThanOrEqual(out[1].x, tight[2].x)
    }
}

final class AddCurvePointTests: XCTestCase {
    func testInsertsInSortedPositionAndHandsBackWhereItLanded() {
        let added = addCurvePoint(line, 0.4, 0.25)
        XCTAssertEqual(added.index, 1)
        XCTAssertEqual(added.curve, [CurvePoint(x: 0, y: 0), CurvePoint(x: 0.4, y: 0.25), CurvePoint(x: 1, y: 1)])
    }

    func testGrabsInsteadOfPilingASecondPointOnOneThatIsAlreadyThere() {
        let added = addCurvePoint(three, 0.5 + minGap / 2, 0.9)
        XCTAssertEqual(added.curve, three)
        XCTAssertEqual(added.index, 1)
    }

    func testClampsAClickOutsideTheBoxOntoItsEdge() {
        XCTAssertEqual(addCurvePoint(three, 1.4, -0.2).curve.count, 3)
        let added = addCurvePoint([CurvePoint(x: 0.2, y: 0.2), CurvePoint(x: 0.8, y: 0.8)], 1.4, -0.2)
        XCTAssertEqual(added.curve[2], CurvePoint(x: 1, y: 0))
    }
}

final class RemoveCurvePointTests: XCTestCase {
    func testDropsThePointNamed() {
        XCTAssertEqual(removeCurvePoint(three, 1), line)
    }

    func testKeepsTheLastTwoSoAnEditorAlwaysHasSomethingToDrag() {
        XCTAssertEqual(removeCurvePoint(line, 0), line)
        XCTAssertEqual(removeCurvePoint(line, 1), line)
    }

    func testLetsAnEndGoWhichIsHowAnInputBlackPointIsUndone() {
        let withBlackPoint: Curve = [CurvePoint(x: 0.3, y: 0), CurvePoint(x: 0.6, y: 0.5), CurvePoint(x: 1, y: 1)]
        XCTAssertEqual(removeCurvePoint(withBlackPoint, 0), [CurvePoint(x: 0.6, y: 0.5), CurvePoint(x: 1, y: 1)])
    }

    func testIgnoresAnIndexItDoesNotHave() {
        XCTAssertEqual(removeCurvePoint(three, 7), three)
    }
}

final class CurvePathAndWordsTests: XCTestCase {
    func testDrawsWithYDownStartingAtTheLeftEdgeAndEndingAtTheRight() {
        let d = curvePath(line, samples: 4)
        XCTAssertTrue(d.hasPrefix("M0.0000,1.0000"))
        XCTAssertTrue(d.hasSuffix("L1.0000,0.0000"))
        // At four decimals a double ties only on an odd multiple of 1/32; JavaScript's
        // `toFixed` takes the larger digit, C's `%.4f` the even one — the path is the web's.
        let fine = curvePath(line, samples: 32)
        XCTAssertTrue(fine.contains("L0.0313,0.9688"), fine)
        XCTAssertTrue(fine.contains("L0.0938,0.9063"), fine)
    }

    func testSamplesTheRealSplineSoTheDrawingAndTheBakeAreTheSameCurve() {
        let s: Curve = [CurvePoint(x: 0, y: 0), CurvePoint(x: 0.25, y: 0.1), CurvePoint(x: 0.75, y: 0.9), CurvePoint(x: 1, y: 1)]
        let f = makeCurve(s)
        for part in curvePath(s, samples: 8).split(separator: " ") {
            let numbers = part.dropFirst().split(separator: ",").map { Double($0)! }
            assertClose(1 - numbers[1], f(numbers[0]), 3)
        }
    }

    func testNamesAPointInTheCodesAPhotographerReads() {
        XCTAssertEqual(describeCurvePoint(CurvePoint(x: 0, y: 1)), "in 0, out 255")
        XCTAssertEqual(describeCurvePoint(CurvePoint(x: 0.5, y: 0.25)), "in 128, out 64")
    }

    func testStartsEditingFromTheStoredCurveElseFromTheStraightLine() {
        XCTAssertEqual(curveToEdit(nil), line)
        XCTAssertEqual(curveToEdit(line), line)
        XCTAssertEqual(curveToEdit(three), line) // three points ON the diagonal is still identity
        let s: Curve = [CurvePoint(x: 0, y: 0), CurvePoint(x: 0.5, y: 0.7), CurvePoint(x: 1, y: 1)]
        XCTAssertEqual(curveToEdit(s), s)
    }
}
