// ONE reading of the hand for every surface that zooms and moves a picture —
// the wheel, a trackpad pinch (a ⌘/ctrl-wheel), two fingers, one pointer
// dragging — with no opinion about what it moves. Port of
// `src/shared/ui/zoom-gestures.ts` (`frontend.md`, «Two uses, one hand»).
//
// Two USES ride the same machine and must stay two: Looking (a view zoom that
// writes nothing — a `ViewState` moved through `PanZoom.swift`'s `zoomAbout`)
// and Placing (a FRAMING that writes the document — moved through
// `Framing.swift`'s `zoomFramingAbout`). A surface only says what a scale is
// under a point, what to do with a new scale and what to do with a pixel
// delta (`ZoomTarget`); the machine takes plain records and is tested.
//
// Grammar, the same on every surface: ⌘/ctrl-wheel zooms about the pointer,
// a bare VERTICAL wheel zooms under `.any` and is left to the page under
// `.modifier`, a shift-wheel or a sideways sweep pans; two fingers pinch AND
// pan by their LIVE centre, the pan applied first, the ratio measured from
// the spread the pinch began with and never compounded per frame; the second
// finger TAKES OVER whatever the first was doing (`onTakeover`); the finger
// left after a pinch takes the pan over without a new press; one pointer is
// offered to the surface as a drag (`.pan`, a handler, or refused), and a
// finger over a control still COUNTS for the pinch but never starts a drag.
//
// What the web hands the machine from DOM events (client coordinates, the
// event's own time in ms, capture on the element) a SwiftUI gesture handler
// hands it from its own values; `GesturePointer.target` (a DOM `EventTarget`)
// has no counterpart and is not carried.

import Foundation

/// Pixels a pointer travels before its press is a drag and not a tap.
public let dragSlop = 3.0

public enum PointerKind: String, Sendable {
    case mouse, pen, touch
}

/// A pointer event, stripped to what the reading needs.
public struct GesturePointer: Equatable, Sendable {
    public var id: Int
    public var kind: PointerKind
    public var x: Double
    public var y: Double
    /// Mouse button, 0 for the primary; ignored for a touch.
    public var button: Int
    /// Over a button or a control: counted for a pinch, never dragged.
    public var overControl: Bool
    /// Event time, ms — what the drag's speed is measured against.
    public var t: Double

    public init(id: Int, kind: PointerKind, x: Double, y: Double, button: Int = 0, overControl: Bool = false, t: Double = 0) {
        self.id = id; self.kind = kind; self.x = x; self.y = y
        self.button = button; self.overControl = overControl; self.t = t
    }

    public var point: Point { Point(x, y) }
}

/// A wheel event at a point (the web's `GestureWheel extends Point`).
public struct GestureWheel: Equatable, Sendable {
    public var x: Double
    public var y: Double
    public var deltaX: Double
    public var deltaY: Double
    public var ctrlKey: Bool
    public var metaKey: Bool
    public var shiftKey: Bool

    public init(x: Double, y: Double, deltaX: Double, deltaY: Double,
                ctrlKey: Bool = false, metaKey: Bool = false, shiftKey: Bool = false) {
        self.x = x; self.y = y; self.deltaX = deltaX; self.deltaY = deltaY
        self.ctrlKey = ctrlKey; self.metaKey = metaKey; self.shiftKey = shiftKey
    }

    public var point: Point { Point(x, y) }
    /// The bits `wheelZooms` reads.
    public var wheel: WheelLike {
        WheelLike(deltaX: deltaX, deltaY: deltaY, ctrlKey: ctrlKey, metaKey: metaKey, shiftKey: shiftKey)
    }
}

public enum ZoomBy: String, Sendable {
    case wheel, pinch
}

public enum PanBy: String, Sendable {
    case drag, pinch, wheel
}

public struct DragStart: Equatable, Sendable {
    public var x: Double
    public var y: Double
    /// The pointer, or nil for a finger left over from a pinch that has not moved yet.
    public var pointer: GesturePointer?
    public var handoff: Bool

    public init(x: Double, y: Double, pointer: GesturePointer?, handoff: Bool) {
        self.x = x; self.y = y; self.pointer = pointer; self.handoff = handoff
    }

    public var point: Point { Point(x, y) }
}

public struct DragMove: Equatable, Sendable {
    public var x: Double
    public var y: Double
    public var dx: Double
    public var dy: Double
    public var totalX: Double
    public var totalY: Double
    /// px per ms along x, from the last two samples.
    public var speedX: Double
    public var pointer: GesturePointer

    public init(x: Double, y: Double, dx: Double, dy: Double, totalX: Double, totalY: Double, speedX: Double, pointer: GesturePointer) {
        self.x = x; self.y = y; self.dx = dx; self.dy = dy
        self.totalX = totalX; self.totalY = totalY; self.speedX = speedX; self.pointer = pointer
    }

    public var point: Point { Point(x, y) }
}

public struct DragEnd: Equatable, Sendable {
    public var totalX: Double
    public var totalY: Double
    public var speedX: Double
    /// Ended by a second finger or by the system, not by a lift.
    public var cancelled: Bool

    public init(totalX: Double, totalY: Double, speedX: Double, cancelled: Bool) {
        self.totalX = totalX; self.totalY = totalY; self.speedX = speedX; self.cancelled = cancelled
    }
}

/// A surface reading a drag itself.
public struct DragHandler {
    public var move: (DragMove) -> Void
    public var end: (DragEnd) -> Void

    public init(move: @escaping (DragMove) -> Void, end: @escaping (DragEnd) -> Void) {
        self.move = move; self.end = end
    }
}

/// What a surface answers to one pointer landing free: `.pan` lets the machine
/// pan it through `panBy` past the slop, `.handler` reads it itself; nil (the
/// web's `null`) leaves it to whoever else listens.
public enum DragResponse {
    case pan
    case handler(DragHandler)
}

/// What a surface answers with. Every point is in the coordinates the surface
/// was given; the surface converts. The six hooks after `panBy` are optional
/// on the web and default to nothing here.
public protocol ZoomTarget: AnyObject {
    /// The scale under `at` right now — a view's, or the framing's of the cell under it.
    func scaleAt(_ at: Point) -> Double
    /// Take `scale` while keeping `anchor` still. The target clamps to its own ceiling.
    func zoomTo(_ scale: Double, anchor: Point, by: ZoomBy)
    /// Move by a pixel delta; `at` is where the hand is (which cell, for a collage).
    func panBy(_ dx: Double, _ dy: Double, at: Point, by: PanBy)
    /// One pointer landing free. Not asked for the second finger of a pinch, nor over a control.
    func drag(_ start: DragStart) -> DragResponse?
    /// A second finger turned the surface's own gesture into a pinch: let go.
    func onTakeover()
    /// Two fingers are on the surface (true), or the last of them lifted (false).
    func onPinch(_ active: Bool)
    /// A gesture began — a press or a wheel notch (a button's easing stops).
    func onGesture()
    /// The machine started or ended dragging a pointer it was given.
    func onDragging(_ active: Bool)
    /// Capture this pointer on the element (a mouse leaving mid-drag still reports).
    func capture(_ id: Int)
}

public extension ZoomTarget {
    func drag(_ start: DragStart) -> DragResponse? { nil }
    func onTakeover() {}
    func onPinch(_ active: Bool) {}
    func onGesture() {}
    func onDragging(_ active: Bool) {}
    func capture(_ id: Int) {}
}

public struct ZoomGestureOptions: Equatable, Sendable {
    /// What a bare wheel does; `.none` leaves the wheel entirely to the surface.
    public enum Wheel: String, Sendable {
        case modifier, any, none
    }

    public var wheel: Wheel
    public var slop: Double

    public init(wheel: Wheel = .any, slop: Double = dragSlop) {
        self.wheel = wheel; self.slop = slop
    }
}

/// The reading itself. Feed it pointer and wheel records; it answers through
/// the target. One per surface, for the life of its view. The target is held
/// strongly, as the web's is: a target that owns its machine must break the
/// cycle when the surface goes.
public final class ZoomGestureMachine {
    private struct Touch {
        var id: Int
        var x: Double
        var y: Double
        var t: Double
    }

    private struct Pinch {
        var spread: Double
        var scale: Double
    }

    private final class Drag {
        let id: Int
        let startX: Double
        let startY: Double
        var lastX: Double
        var lastY: Double
        var lastT: Double
        var speedX = 0.0
        var moving = false
        let mode: DragResponse

        init(id: Int, x: Double, y: Double, t: Double, mode: DragResponse) {
            self.id = id; startX = x; startY = y; lastX = x; lastY = y; lastT = t; self.mode = mode
        }

        var pans: Bool {
            if case .pan = mode { return true }
            return false
        }
    }

    private let target: ZoomTarget
    private let wheel: ZoomGestureOptions.Wheel
    private let slop: Double
    /// Fingers down, in the order they landed (the web's insertion-ordered `Map`).
    private var touches: [Touch] = []
    private var pinch: Pinch?
    private var drag: Drag?

    public init(target: ZoomTarget, options: ZoomGestureOptions = ZoomGestureOptions()) {
        self.target = target
        wheel = options.wheel
        slop = options.slop
    }

    /// Two fingers are on the surface.
    public var pinching: Bool { pinch != nil }

    /// The machine is dragging a pointer it was given.
    public var dragging: Bool { drag?.moving == true }

    /// Whether the wheel event was consumed (the caller stops its default).
    @discardableResult
    public func onWheel(_ e: GestureWheel) -> Bool {
        let mode: WheelZoom
        switch wheel {
        case .none: return false
        case .modifier: mode = .modifier
        case .any: mode = .any
        }
        let zooms = wheelZooms(e.wheel, mode)
        // Under `modifier` a bare wheel is the page's: nothing here reads it.
        if !zooms && mode == .modifier { return false }
        target.onGesture()
        let at = e.point
        if zooms {
            target.zoomTo(target.scaleAt(at) * wheelZoomFactor(e.deltaY), anchor: at, by: .wheel)
        } else {
            // A sideways sweep, or a shift-wheel the system already turned sideways.
            target.panBy(-e.deltaX, -e.deltaY, at: at, by: .wheel)
        }
        return true
    }

    public func onDown(_ p: GesturePointer) {
        if p.kind == .touch {
            setTouch(p)
            if touches.count == 2 {
                target.onGesture()
                // The second finger makes a pinch of the two, whatever the first
                // was doing — the machine's own drag, or the surface's.
                endDrag(cancelled: true)
                pinch = Pinch(spread: spread(), scale: target.scaleAt(centre()))
                target.onTakeover()
                target.onPinch(true)
                return
            }
            if touches.count > 2 { return }
        } else if p.button != 0 {
            return
        }
        target.onGesture()
        // A control keeps its own press; its finger was still counted above.
        if p.overControl || pinch != nil { return }
        begin(DragStart(x: p.x, y: p.y, pointer: p, handoff: false), id: p.id, t: p.t, kind: p.kind)
    }

    /// Whether the move was consumed by a pinch or a drag.
    @discardableResult
    public func onMove(_ p: GesturePointer) -> Bool {
        if p.kind == .touch, let i = touches.firstIndex(where: { $0.id == p.id }) {
            let before: Point? = touches.count == 2 ? centre() : nil
            touches[i] = Touch(id: p.id, x: p.x, y: p.y, t: p.t)
            if let pinch, let before, touches.count == 2 {
                let after = centre()
                // Pan on the fingers' centre first, so the zoom's own correction
                // is measured from an offset already moved.
                target.panBy(after.x - before.x, after.y - before.y, at: after, by: .pinch)
                if pinch.spread > 0 {
                    target.zoomTo(pinch.scale * (spread() / pinch.spread), anchor: after, by: .pinch)
                }
                return true
            }
        }
        guard let d = drag, p.id == d.id else { return false }
        if !d.moving {
            if hypot(p.x - d.startX, p.y - d.startY) < slop {
                // Not a drag yet — but the last position moves with the pointer,
                // or the first real step would carry the whole slop as a jump.
                d.lastX = p.x
                d.lastY = p.y
                d.lastT = p.t
                return false
            }
            d.moving = true
            if d.pans { target.onDragging(true) }
        }
        let dx = p.x - d.lastX
        let dy = p.y - d.lastY
        let dt = p.t - d.lastT
        if dt > 0 { d.speedX = dx / dt }
        d.lastX = p.x
        d.lastY = p.y
        d.lastT = p.t
        let move = DragMove(x: p.x, y: p.y, dx: dx, dy: dy,
                            totalX: p.x - d.startX, totalY: p.y - d.startY,
                            speedX: d.speedX, pointer: p)
        switch d.mode {
        case .pan: target.panBy(dx, dy, at: move.point, by: .drag)
        case .handler(let h): h.move(move)
        }
        return true
    }

    /// A lift, or a cancel (`cancelled`) the system decided.
    public func onUp(_ p: GesturePointer, cancelled: Bool = false) {
        if p.kind == .touch {
            touches.removeAll { $0.id == p.id }
            if pinch != nil && touches.count < 2 {
                pinch = nil
                target.onPinch(false)
                // One finger of the pinch lifted, the other still down: it takes
                // the pan over rather than being inert until lifted and put back.
                // Zoomed in, that second half is most of the gesture.
                if let left = touches.first {
                    begin(DragStart(x: left.x, y: left.y, pointer: nil, handoff: true), id: left.id, t: left.t, kind: .touch)
                    if let d = drag {
                        d.moving = true
                        if d.pans { target.onDragging(true) }
                    }
                }
            }
        }
        if let d = drag, p.id == d.id { endDrag(cancelled: cancelled) }
    }

    private func setTouch(_ p: GesturePointer) {
        let touch = Touch(id: p.id, x: p.x, y: p.y, t: p.t)
        if let i = touches.firstIndex(where: { $0.id == p.id }) {
            touches[i] = touch
        } else {
            touches.append(touch)
        }
    }

    private func begin(_ start: DragStart, id: Int, t: Double, kind: PointerKind) {
        guard let mode = target.drag(start) else { return }
        drag = Drag(id: id, x: start.x, y: start.y, t: t, mode: mode)
        // A touch is captured by the system already; a mouse leaving the frame
        // mid-drag is not, and must still report.
        if kind != .touch { target.capture(id) }
    }

    private func endDrag(cancelled: Bool) {
        guard let d = drag else { return }
        drag = nil
        switch d.mode {
        case .pan:
            if d.moving { target.onDragging(false) }
        case .handler(let h):
            h.end(DragEnd(totalX: d.lastX - d.startX, totalY: d.lastY - d.startY,
                          speedX: d.speedX, cancelled: cancelled))
        }
    }

    private func centre() -> Point {
        let n = Double(touches.count)
        let sx = touches.reduce(0.0) { $0 + $1.x }
        let sy = touches.reduce(0.0) { $0 + $1.y }
        return Point(sx / n, sy / n)
    }

    private func spread() -> Double {
        let a = touches[0]
        let b = touches[1]
        return hypot(a.x - b.x, a.y - b.y)
    }
}
