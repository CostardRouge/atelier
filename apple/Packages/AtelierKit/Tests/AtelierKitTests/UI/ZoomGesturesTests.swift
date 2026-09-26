// Port of `src/shared/ui/zoom-gestures.test.ts`.
//
// The one reading of the hand, driven by plain records: what the four
// surfaces used to each get subtly wrong — where a pinch anchors, who owns
// the first finger once a second lands, what the finger left after a pinch
// does — is pinned here rather than re-learned per surface.

import Foundation
import XCTest
@testable import AtelierKit

/// The spec's `Call` tuples, one case per target hook.
private enum Call: Equatable {
    case zoom(Double, Double, Double, ZoomBy)
    case pan(Double, Double, Double, Double, PanBy)
    case takeover
    case gesture
    case dragging(Bool)
    case capture(Int)

    var kind: String {
        switch self {
        case .zoom: return "zoom"
        case .pan: return "pan"
        case .takeover: return "takeover"
        case .gesture: return "gesture"
        case .dragging: return "dragging"
        case .capture: return "capture"
        }
    }
}

/// The spec's `harness()`: a target that records every call. `drag` is the
/// one hook a case overrides; absent (nil), the machine reads it as refused,
/// as the web's optional method does.
private final class Harness: ZoomTarget {
    var calls: [Call] = []
    var scale = 2.0
    var dragResponse: ((DragStart) -> DragResponse?)?

    init(scale: Double = 2, drag: ((DragStart) -> DragResponse?)? = nil) {
        self.scale = scale
        dragResponse = drag
    }

    func scaleAt(_ at: Point) -> Double { scale }
    func zoomTo(_ scale: Double, anchor: Point, by: ZoomBy) { calls.append(.zoom(scale, anchor.x, anchor.y, by)) }
    func panBy(_ dx: Double, _ dy: Double, at: Point, by: PanBy) { calls.append(.pan(dx, dy, at.x, at.y, by)) }
    func drag(_ start: DragStart) -> DragResponse? { dragResponse?(start) }
    func onTakeover() { calls.append(.takeover) }
    func onGesture() { calls.append(.gesture) }
    func onDragging(_ on: Bool) { calls.append(.dragging(on)) }
    func capture(_ id: Int) { calls.append(.capture(id)) }

    func only(_ kind: String) -> [Call] { calls.filter { $0.kind == kind } }
}

private func touch(_ id: Int, _ x: Double, _ y: Double, _ t: Double = 0) -> GesturePointer {
    GesturePointer(id: id, kind: .touch, x: x, y: y, button: 0, overControl: false, t: t)
}

private func mouse(_ x: Double, _ y: Double, _ t: Double = 0, id: Int = 1, button: Int = 0) -> GesturePointer {
    GesturePointer(id: id, kind: .mouse, x: x, y: y, button: button, overControl: false, t: t)
}

private func wheel(_ deltaX: Double, _ deltaY: Double, ctrlKey: Bool = false, metaKey: Bool = false) -> GestureWheel {
    GestureWheel(x: 100, y: 80, deltaX: deltaX, deltaY: deltaY, ctrlKey: ctrlKey, metaKey: metaKey, shiftKey: false)
}

final class GestureWheelTests: XCTestCase {
    func testZoomsAboutThePointerOnAVerticalNotchByTheOneCurve() {
        let h = Harness()
        let m = ZoomGestureMachine(target: h)
        XCTAssertTrue(m.onWheel(wheel(0, -100)))
        XCTAssertEqual(h.only("zoom"), [.zoom(2 * wheelZoomFactor(-100), 100, 80, .wheel)])
    }

    func testZoomsOnACmdCtrlWheelWhateverItsAxisATrackpadPinch() {
        let h = Harness()
        let m = ZoomGestureMachine(target: h)
        m.onWheel(wheel(30, -10, ctrlKey: true))
        XCTAssertEqual(h.only("zoom").count, 1)
        XCTAssertEqual(h.only("pan").count, 0)
    }

    func testPansOnASidewaysSweepConsumedEitherWay() {
        let h = Harness()
        let m = ZoomGestureMachine(target: h)
        XCTAssertTrue(m.onWheel(wheel(40, 5)))
        XCTAssertEqual(h.only("pan"), [.pan(-40, -5, 100, 80, .wheel)])
    }

    func testLeavesABareWheelToThePageUnderModifierAndTakesTheCmdWheel() {
        let h = Harness()
        let m = ZoomGestureMachine(target: h, options: ZoomGestureOptions(wheel: .modifier))
        XCTAssertFalse(m.onWheel(wheel(0, -100)))
        XCTAssertEqual(h.calls, [])
        XCTAssertTrue(m.onWheel(wheel(0, -100, metaKey: true)))
        XCTAssertEqual(h.only("zoom").count, 1)
    }

    func testReadsNothingUnderNoneTheSurfaceKeepsItsOwnWheel() {
        let h = Harness()
        let m = ZoomGestureMachine(target: h, options: ZoomGestureOptions(wheel: .none))
        XCTAssertFalse(m.onWheel(wheel(0, -100, ctrlKey: true)))
        XCTAssertEqual(h.calls, [])
    }
}

final class PinchTests: XCTestCase {
    func testZoomsFromTheScaleItBeganWithByTheSpreadRatioAboutTheLiveCentrePanFirst() {
        let h = Harness(scale: 2)
        let m = ZoomGestureMachine(target: h)
        m.onDown(touch(1, 100, 100))
        m.onDown(touch(2, 200, 100))
        XCTAssertTrue(m.pinching)
        XCTAssertEqual(h.only("takeover").count, 1)
        // Fingers spread to 200 apart and drift 10px right.
        m.onMove(touch(1, 60, 100))
        m.onMove(touch(2, 270, 100))
        let pans = h.only("pan")
        let zooms = h.only("zoom")
        XCTAssertEqual(pans.last, .pan(35, 0, 165, 100, .pinch))
        // spread 100 → 210: the START scale × 2.1, never the previous frame's × something.
        XCTAssertEqual(zooms.last, .zoom(2 * 2.1, 165, 100, .pinch))
    }

    func testHandsThePanToTheFingerLeftWhenTheOtherLiftsWithoutANewPress() {
        var drags: [DragStart] = []
        let h = Harness(drag: { s in
            drags.append(s)
            return .pan
        })
        let m = ZoomGestureMachine(target: h)
        m.onDown(touch(1, 100, 100))
        m.onDown(touch(2, 200, 100))
        m.onUp(touch(2, 200, 100))
        XCTAssertFalse(m.pinching)
        let last = drags.last
        XCTAssertEqual(last?.x, 100)
        XCTAssertEqual(last?.y, 100)
        XCTAssertEqual(last?.handoff, true)
        XCTAssertNil(last?.pointer)
        // And it moves at once, no slop to cross again.
        m.onMove(touch(1, 110, 104))
        XCTAssertEqual(h.only("pan").last, .pan(10, 4, 110, 104, .drag))
        XCTAssertEqual(h.only("capture").count, 0)
    }

    func testCountsAFingerThatLandedOnAControlWithoutDraggingIt() {
        let h = Harness(drag: { _ in .pan })
        let m = ZoomGestureMachine(target: h)
        var onControl = touch(1, 100, 100)
        onControl.overControl = true
        m.onDown(onControl)
        XCTAssertEqual(h.only("dragging").count, 0)
        m.onMove(touch(1, 140, 100))
        XCTAssertEqual(h.only("pan").count, 0)
        m.onDown(touch(2, 200, 100))
        XCTAssertTrue(m.pinching)
    }

    func testCancelsTheSurfacesOwnDragWhenTheSecondFingerLands() {
        var ended: [Bool] = []
        let handler = DragHandler(move: { _ in }, end: { e in ended.append(e.cancelled) })
        let h = Harness(drag: { _ in .handler(handler) })
        let m = ZoomGestureMachine(target: h)
        m.onDown(touch(1, 100, 100))
        m.onMove(touch(1, 130, 100))
        m.onDown(touch(2, 200, 100))
        XCTAssertEqual(ended, [true])
        XCTAssertEqual(h.only("takeover").count, 1)
    }

    func testIgnoresAThirdFingerAndAMouseWhilePinching() {
        let h = Harness(drag: { _ in .pan })
        let m = ZoomGestureMachine(target: h)
        m.onDown(touch(1, 100, 100))
        m.onDown(touch(2, 200, 100))
        m.onDown(touch(3, 150, 150))
        m.onDown(mouse(50, 50, id: 9))
        m.onMove(mouse(90, 50, id: 9))
        let dragPans = h.only("pan").filter {
            if case .pan(_, _, _, _, .drag) = $0 { return true }
            return false
        }
        XCTAssertEqual(dragPans.count, 0)
    }
}

final class OnePointerTests: XCTestCase {
    func testPansPastTheSlopCapturedForAMouseAndReportsDragging() {
        let h = Harness(drag: { _ in .pan })
        let m = ZoomGestureMachine(target: h)
        m.onDown(mouse(100, 100, 0))
        XCTAssertEqual(h.only("capture"), [.capture(1)])
        XCTAssertFalse(m.onMove(mouse(101, 100, 8)))
        XCTAssertEqual(h.only("pan").count, 0)
        XCTAssertTrue(m.onMove(mouse(100 + dragSlop + 2, 100, 16)))
        XCTAssertEqual(h.only("dragging"), [.dragging(true)])
        // The step is measured from the last sample, not from the press — no jump.
        XCTAssertEqual(h.only("pan").last, .pan(dragSlop + 1, 0, 100 + dragSlop + 2, 100, .drag))
        m.onUp(mouse(120, 100, 32))
        XCTAssertEqual(h.only("dragging").last, .dragging(false))
        XCTAssertFalse(m.dragging)
    }

    func testGivesAHandlerTheTotalsAndTheSpeedAndSaysWhenItWasCancelled() {
        var moves: [Double] = []
        var end: DragEnd?
        let handler = DragHandler(move: { mv in moves.append(mv.totalX) }, end: { e in end = e })
        let h = Harness(drag: { _ in .handler(handler) })
        let m = ZoomGestureMachine(target: h, options: ZoomGestureOptions(slop: 6))
        m.onDown(mouse(0, 0, 0))
        m.onMove(mouse(10, 0, 10))
        m.onMove(mouse(30, 0, 20))
        XCTAssertEqual(moves, [10, 30])
        m.onUp(mouse(30, 0, 30))
        XCTAssertEqual(end, DragEnd(totalX: 30, totalY: 0, speedX: 2, cancelled: false))
        // Not reported as the machine's own dragging: the handler owns it.
        XCTAssertEqual(h.only("dragging").count, 0)
    }

    func testIsRefusedByASurfaceThatAnswersNilAndByASecondaryButton() {
        let h = Harness(drag: { _ in nil })
        let m = ZoomGestureMachine(target: h)
        m.onDown(mouse(0, 0))
        m.onMove(mouse(40, 0, 10))
        XCTAssertEqual(h.only("pan").count, 0)
        XCTAssertEqual(h.only("capture").count, 0)
        let h2 = Harness(drag: { _ in .pan })
        let m2 = ZoomGestureMachine(target: h2)
        m2.onDown(mouse(0, 0, 0, button: 2))
        XCTAssertEqual(h2.only("gesture").count, 0)
    }
}
