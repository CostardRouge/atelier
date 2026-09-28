// The badge stage's hand — the web's `BadgeStage` pointer handlers, its
// Placing half of the zoom grammar, and its Library drop, over the frame the
// stage last drew (its hit boxes and cells, measured by the very paint).
//
// A press lands where it STARTED and asks, in order (`roadtrip.md`, «click
// selects», «drag moves the whole block»):
// 1. a shade's centre is being placed → every press moves that centre on its
//    axis and nothing else;
// 2. a badge piece → selected (its tab comes back and its field focuses), and
//    a drag moves the WHOLE block, soft-snapped unless Option is held;
// 3. the opener's drawing (only where no element sits — the badge keeps
//    first claim) → selected, and a drag moves it by frame fractions;
// 4. a collage's cell → selected; a drag REFRAMES it at the cell's own size
//    (in its own axes: a print may be turned), a print on a free layout is
//    MOVED instead (Shift reframes), a 420 ms hold or an Option-drag becomes a
//    SWAP onto the cell released over;
// 5. the picture → a drag pans it inside its frame, clamped: never a gap
//    under Fill.
// A press that never travelled more than 4 points is a TAP, an "activate"
// that raises the phone's inspector.
//
// PLACING, never Looking (`frontend.md`, «Two uses, one hand»): a pinch, the
// wheel or a trackpad's scroll zoom the picture's FRAMING about the point
// under the hand — the cell under it on a collage — and write the document.
// There is no view zoom on this stage. A second finger ends whatever the
// first began; the pinch's drift does not pan (SwiftUI's pinch reports no
// moving centre — `PARITY.md`).

import Foundation
import Observation
import SwiftUI
import AtelierKit
#if os(macOS)
import AppKit
#endif

@MainActor
@Observable
final class BadgeStagePointer: ZoomTarget {
    enum CellMode: Equatable {
        case pending, pan, move, swap
    }

    enum Drag {
        case block(startPx: AtelierKit.Point, start: AtelierKit.Point)
        case picture(last: AtelierKit.Point)
        case hook(last: AtelierKit.Point)
        case shade
        case cell(i: Int, start: AtelierKit.Point, last: AtelierKit.Point, mode: CellMode, over: Int, shift: Bool)
    }

    /// The press's start and what it is dragging.
    @ObservationIgnored private var drag: Drag?
    @ObservationIgnored private var press: (id: String, at: CGPoint)?
    @ObservationIgnored private var holdTimer: Task<Void, Never>?
    /// A press is down (the first move event starts it).
    @ObservationIgnored var down = false
    /// Two fingers are on: the one left after them starts nothing.
    @ObservationIgnored var pinching = false
    /// A swap is under way — the cursor and the haptic say so.
    private(set) var swapping = false

    @ObservationIgnored weak var model: PieceEditorModel?
    /// The stage box's size in points, what the frame's pixels map onto.
    @ObservationIgnored var box = CGSize(width: 1, height: 1)

    // MARK: - mapping

    private var frame: PieceStageFrame? { model?.stage.frame }

    /// Frame pixels per point.
    private var k: Double {
        guard let frame, box.width > 0 else { return 1 }
        return frame.size.width / Double(box.width)
    }

    private func px(_ p: CGPoint) -> AtelierKit.Point {
        AtelierKit.Point(Double(p.x) * k, Double(p.y) * k)
    }

    private static func inRect(_ r: AtelierKit.Rect?, _ p: AtelierKit.Point) -> Bool {
        guard let r else { return false }
        return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height
    }

    // MARK: - the press

    func begin(_ at: CGPoint, alt: Bool, shift: Bool) {
        guard let model, let frame, !pinching else { return }
        let pt = px(at)
        drag = nil
        press = nil
        // Placing a shade's centre takes the whole picture.
        if model.shadeHandle != nil {
            drag = .shade
            placeShade(pt)
            return
        }
        if let id = OverlayGeometry.hitTest(frame.boxes, pt.x, pt.y) {
            model.selectElement(id)
            press = (id, at)
            if let anchor = model.blockAnchor { drag = .block(startPx: pt, start: anchor) }
            return
        }
        // No element here: the opener gets its turn — content too, second
        // only because a badge is composed constantly and an opener once.
        if BadgeStagePointer.inRect(model.hookRect(frame.size), pt) {
            model.selectElement(PieceEditorModel.hookId)
            press = (PieceEditorModel.hookId, at)
            if model.hookMovable { drag = .hook(last: pt) }
            return
        }
        model.selectElement(nil)
        if model.collage != nil {
            let i = cellAt(frame.cells, pt.x, pt.y)
            guard i >= 0 else { return }
            model.selectCell(i)
            let mode: CellMode = alt ? .swap : .pending
            drag = .cell(i: i, start: pt, last: pt, mode: mode, over: i, shift: shift)
            if mode == .swap { swapping = true } else { armHold() }
            return
        }
        // Nothing under the press at all: the gesture is about the PICTURE.
        if !model.isCta { drag = .picture(last: pt) }
    }

    /// A still hold on a cell becomes a swap.
    private func armHold() {
        holdTimer?.cancel()
        holdTimer = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 420_000_000)
            guard let self, !Task.isCancelled else { return }
            if case .cell(let i, let start, let last, .pending, let over, let shift)? = self.drag {
                self.drag = .cell(i: i, start: start, last: last, mode: .swap, over: over, shift: shift)
                self.swapping = true
            }
        }
    }

    func moved(_ at: CGPoint, alt: Bool) {
        guard let model, let frame, !pinching, let current = drag else { return }
        let pt = px(at)
        let w = frame.size.width
        let h = frame.size.height
        switch current {
        case .shade:
            placeShade(pt)
        case .block(let startPx, let start):
            let next = moveBlock(start, (pt.x - startPx.x) / w, (pt.y - startPx.y) / h, !alt)
            model.moveBlock(to: next)
        case .hook(let last):
            model.moveHook(dx: (pt.x - last.x) / w, dy: (pt.y - last.y) / h)
            drag = .hook(last: pt)
        case .picture(let last):
            if let target = reframable(at: pt) {
                let next = AtelierKit.panBy(target.framing, target.srcW, target.srcH, w, h, pt.x - last.x, pt.y - last.y)
                model.placeFraming(0, next)
            }
            drag = .picture(last: pt)
        case .cell(let i, let start, let last, var mode, var over, let shift):
            if mode == .pending, hypot(pt.x - start.x, pt.y - start.y) > 6 * k {
                holdTimer?.cancel()
                let free = frame.cells.indices.contains(i) && frame.cells[i].mount == .print
                mode = free && !shift ? .move : .pan
            }
            switch mode {
            case .swap:
                over = cellAt(frame.cells, pt.x, pt.y)
            case .move:
                model.moveCell(i, dx: (pt.x - last.x) / w, dy: (pt.y - last.y) / h)
            case .pan:
                panCell(i, dx: pt.x - last.x, dy: pt.y - last.y)
            case .pending:
                break
            }
            drag = .cell(i: i, start: start, last: pt, mode: mode, over: over, shift: shift)
        }
    }

    func end(_ at: CGPoint, compact: Bool) {
        holdTimer?.cancel()
        if case .cell(let i, _, _, .swap, let over, _)? = drag, over >= 0, over != i {
            model?.swapCells(i, over)
            model?.selectCell(over)
        }
        swapping = false
        // 4 points, the threshold every press-or-drag surface uses.
        if let press, abs(at.x - press.at.x) <= 4, abs(at.y - press.at.y) <= 4 {
            model?.activate(press.id, compact: compact)
        }
        press = nil
        drag = nil
        down = false
    }

    /// A second finger: whatever the first began stops where it is.
    nonisolated func onTakeover() {
        MainActor.assumeIsolated {
            holdTimer?.cancel()
            swapping = false
            drag = nil
            press = nil
        }
    }

    nonisolated func onPinch(_ active: Bool) {
        MainActor.assumeIsolated { pinching = active }
    }

    // MARK: - a shade's centre

    private func placeShade(_ pt: AtelierKit.Point) {
        guard let model, let frame, let handle = model.shadeHandle else { return }
        let fx = min(1, max(0, pt.x / frame.size.width))
        let fy = min(1, max(0, pt.y / frame.size.height))
        model.moveShadeCentre(x: handle.axis == .y ? handle.x : fx, y: handle.axis == .x ? handle.y : fy)
    }

    // MARK: - reframing

    /// What a gesture at `pt` reframes: the cell under it on a collage, else
    /// the whole frame — its picture's shape, its box, its framing as shown.
    struct Reframable {
        var index: Int
        var srcW: Double
        var srcH: Double
        var rect: CellRect
        var framing: Framing
    }

    func reframable(at pt: AtelierKit.Point) -> Reframable? {
        guard let model, let frame, !model.isCta else { return nil }
        if model.collage != nil {
            let i = cellAt(frame.cells, pt.x, pt.y)
            guard i >= 0, i < frame.cells.count else { return nil }
            let source = i == 0 ? model.leadSource : (i < model.cellSources.count ? model.cellSources[i] : nil)
            guard let source, source.width > 0, source.height > 0 else { return nil }
            return Reframable(index: i, srcW: source.width, srcH: source.height, rect: frame.cells[i],
                              framing: model.stageFraming(i))
        }
        guard let source = model.leadSource, source.width > 0, source.height > 0 else { return nil }
        let whole = CellRect(x: 0, y: 0, width: frame.size.width, height: frame.size.height, rotation: 0, mount: .none)
        return Reframable(index: 0, srcW: source.width, srcH: source.height, rect: whole, framing: model.stageFraming(0))
    }

    /// A delta in frame pixels turned into cell `i`'s own axes, then panned at
    /// the CELL's size: the pan is a fraction of the cell's long edge, so it
    /// holds at any export size.
    private func panCell(_ i: Int, dx: Double, dy: Double) {
        guard let model, let frame, frame.cells.indices.contains(i) else { return }
        let cell = frame.cells[i]
        let source = i == 0 ? model.leadSource : (i < model.cellSources.count ? model.cellSources[i] : nil)
        guard let source else { return }
        let (lx, ly) = BadgeStagePointer.local(dx, dy, rotation: cell.rotation)
        let next = AtelierKit.panBy(model.stageFraming(i), source.width, source.height, cell.width, cell.height, lx, ly)
        model.placeFraming(i, next)
    }

    /// A vector in the frame's axes, in a cell turned by `rotation` degrees.
    private static func local(_ x: Double, _ y: Double, rotation: Double) -> (Double, Double) {
        let a = -rotation * Double.pi / 180
        let lx = x * cos(a) - y * sin(a)
        let ly = x * sin(a) + y * cos(a)
        return (lx, ly)
    }

    // MARK: - ZoomTarget: PLACING (points in the stage box's own coordinates)

    nonisolated func scaleAt(_ at: AtelierKit.Point) -> Double {
        MainActor.assumeIsolated {
            reframable(at: px(CGPoint(x: at.x, y: at.y)))?.framing.scale ?? 1
        }
    }

    nonisolated func zoomTo(_ scale: Double, anchor: AtelierKit.Point, by: ZoomBy) {
        MainActor.assumeIsolated {
            let pt = px(CGPoint(x: anchor.x, y: anchor.y))
            guard let model, let target = reframable(at: pt) else { return }
            // The anchor in the cell's own frame: a print may be turned.
            let r = target.rect
            let (dx, dy) = BadgeStagePointer.local(pt.x - (r.x + r.width / 2), pt.y - (r.y + r.height / 2),
                                                   rotation: r.rotation)
            let next = zoomFramingAbout(target.framing, scale, anchorX: dx + r.width / 2, anchorY: dy + r.height / 2,
                                        target.srcW, target.srcH, r.width, r.height)
            let f = target.framing
            if next.scale != f.scale || next.x != f.x || next.y != f.y { model.placeFraming(target.index, next) }
        }
    }

    nonisolated func panBy(_ dx: Double, _ dy: Double, at: AtelierKit.Point, by: PanBy) {
        MainActor.assumeIsolated {
            let pt = px(CGPoint(x: at.x, y: at.y))
            guard let model, let target = reframable(at: pt) else { return }
            let (lx, ly) = BadgeStagePointer.local(dx * k, dy * k, rotation: target.rect.rotation)
            let next = AtelierKit.panBy(target.framing, target.srcW, target.srcH, target.rect.width, target.rect.height,
                                        lx, ly)
            model.placeFraming(target.index, next)
        }
    }

    /// Whether the stage takes a Placing gesture now.
    var places: Bool {
        guard let model else { return false }
        return !model.isCta && model.shadeHandle == nil
    }

    // MARK: - modifiers

    /// Option held — place freely, swap on a cell (the web's Alt). A phone has none.
    static var optionHeld: Bool {
        #if os(macOS)
        return NSEvent.modifierFlags.contains(.option)
        #else
        return false
        #endif
    }

    static var shiftHeld: Bool {
        #if os(macOS)
        return NSEvent.modifierFlags.contains(.shift)
        #else
        return false
        #endif
    }
}
