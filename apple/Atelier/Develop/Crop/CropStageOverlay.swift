// The Develop tool's CROP STAGE — port of `src/tools/develop/CropStage.tsx`,
// the classic crop the maintainer asked for (2026-09-19, `develop-roll.md`):
// the WHOLE picture as delivered, fitted once and never moving while it is
// cropped, turned UNDER the kept zone, and everything outside the zone under
// a veil. The zone is edited here and stored as the aspect + framing the roll
// always stored (`CropRect.swift`), so the export, the filmstrip cell and the
// Adjust stage are unchanged.
//
// Gestures, the web's:
// - inside the zone MOVES it (sliding along the picture's edge), on the veil
//   over the picture DRAWS a new one from that point (after 6 pt — a press is
//   not a draw), the eight handles are anchored on the opposite edge or corner
//   and keep where the finger took them (a finger lands up to 22 pt off an
//   edge, a pointer 10), Shift holds the ratio in Free (the Mac);
// - a double tap / double-click takes the largest zone of the format;
// - Level armed: a drag lays a line, and the angle is corrected by it (a
//   click is not a line: under 12 pt the tool stays armed);
// - the arrows NUDGE the zone once the stage has been pressed (Shift ×10) —
//   unpressed, ←/→ still step along the roll;
// - a pinch, the Mac's wheel, the pill and `Z` zoom the stage's VIEW
//   (`CropView`, 1..8×) — never the zone. A second finger turns what the
//   first began into a pinch: the zone keeps what that finger already did and
//   stops there, and the finger left after a pinch starts nothing.
//
// The picture is a transformed IMAGE layer (turned, mirrored, scaled — no
// redraw per drag); the veil, the dashed outline of the turned picture, the
// thirds (stronger while a gesture is on), the dense grid while the angle
// moves, the zone's edge and its handles are ONE `Canvas` over it. A gesture
// holds its zone LIVE and writes it once, at its end: one undo step, and no
// render of the whole picture per pointer move.

import SwiftUI
import AtelierKit
#if os(macOS)
import AppKit
#endif

/// A zone gesture in flight — the web's `Gesture`, in the zone's frame.
private enum ZoneGesture {
    case resize(handle: CropHandle, start: CropZone, grabX: Double, grabY: Double)
    case move(lastX: Double, lastY: Double)
    case level(x1: Double, y1: Double)
    case draw(anchor: AtelierKit.Point, startX: Double, startY: Double, drawing: Bool, drew: Bool)
}

/// `cropStageTransform`'s answer: a point `(zx, zy)` of the zone's frame is at
/// `(ox + k·zx, oy + k·zy)` on the stage.
private typealias StageTransform = (k: Double, ox: Double, oy: Double)

/// A point of the zone's frame on the stage.
private func onStage(_ x: Double, _ y: Double, _ t: StageTransform) -> CGPoint {
    let sx = t.ox + t.k * x
    let sy = t.oy + t.k * y
    return CGPoint(x: sx, y: sy)
}

/// A point of the stage in the zone's frame.
private func inZone(_ p: CGPoint, _ t: StageTransform) -> (x: Double, y: Double) {
    let zx = (Double(p.x) - t.ox) / t.k
    let zy = (Double(p.y) - t.oy) / t.k
    return (zx, zy)
}

/// The zone's four edges on the stage, in points.
private struct ZoneEdges {
    let l: Double
    let r: Double
    let t: Double
    let b: Double

    init(_ zone: CropZone, _ tr: StageTransform) {
        let halfW = zone.w / 2
        let halfH = zone.h / 2
        l = tr.ox + tr.k * (zone.cx - halfW)
        r = tr.ox + tr.k * (zone.cx + halfW)
        t = tr.oy + tr.k * (zone.cy - halfH)
        b = tr.oy + tr.k * (zone.cy + halfH)
    }
}

/// Which handle a point is on, corners before edges; `tol` is the hit radius.
private func handleAt(_ z: ZoneEdges, _ x: Double, _ y: Double, _ tol: Double) -> CropHandle? {
    let nearL = abs(x - z.l) <= tol
    let nearR = abs(x - z.r) <= tol
    let nearT = abs(y - z.t) <= tol
    let nearB = abs(y - z.b) <= tol
    if nearT && nearL { return .nw }
    if nearT && nearR { return .ne }
    if nearB && nearL { return .sw }
    if nearB && nearR { return .se }
    let inX = x > z.l && x < z.r
    let inY = y > z.t && y < z.b
    if nearT && inX { return .n }
    if nearB && inX { return .s }
    if nearL && inY { return .w }
    if nearR && inY { return .e }
    return nil
}

/// How far a pointer travels on the veil before it is drawing a zone, not clicking.
private let drawStartPoints = 6.0

/// A handle's hit radius: a finger's 44 pt target, a pointer's 20.
private var handleTolerance: Double {
    #if os(iOS)
    return 22
    #else
    return 10
    #endif
}

struct CropStageOverlay: View {
    let context: StageOverlayContext

    @Environment(\.palette) private var palette
    @State private var gesture: ZoneGesture?
    /// The zone as THIS gesture last wrote it — drawn in place of the stored one.
    @State private var live: CropZone?
    /// The drag's first event has been read.
    @State private var started = false
    /// The Level line while it is drawn, in the zone's frame.
    @State private var line: (x1: Double, y1: Double, x2: Double, y2: Double)?
    /// A gesture is on: the thirds are stronger and the size tag shows.
    @State private var active = false
    @State private var pinchStart: Double?
    /// A finger left over from a pinch: it starts nothing until it lifts.
    @State private var spent = false
    @State private var wheel = CropWheelTarget()
    @FocusState private var focused: Bool
    /// A pointer is down on the stage — reset by SwiftUI itself, even on a cancel.
    @GestureState private var pressed = false

    private var editor: RollEditor { context.editor }
    private var box: AtelierKit.Size {
        AtelierKit.Size(Double(context.geometry.viewport.width), Double(context.geometry.viewport.height))
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            palette.frame
            if let src = editor.cropSrc, let zone = live ?? editor.cropZone {
                let t = cropStageTransform(box, src, editor.cropFraming.rotation, editor.cropView)
                picture(src, t)
                marks(src, zone, t)
                words(src, zone, t)
            }
        }
        .frame(width: context.geometry.viewport.width, height: context.geometry.viewport.height)
        .clipped()
        .contentShape(Rectangle())
        .gesture(SimultaneousGesture(zoneDrag, pinch))
        .simultaneousGesture(SpatialTapGesture(count: 2).onEnded { _ in
            guard editor.cropSrc != nil else { return }
            editor.cropMaximize()
        })
        #if os(macOS)
        .overlay(WheelCatcher(target: wheel, enabled: editor.cropSrc != nil))
        .onContinuousHover { phase in hover(phase) }
        #endif
        .focusable(editor.cropSrc != nil)
        .focusEffectDisabled()
        .focused($focused)
        .onKeyPress(keys: [.leftArrow, .rightArrow, .upArrow, .downArrow]) { press in nudge(press) }
        .onChange(of: pressed) { _, down in
            if !down { released() }
        }
        .onChange(of: editor.toolCommand) { _, command in
            guard let command else { return }
            answer(command.action)
        }
        .onChange(of: LayoutBox(width: box.width, height: box.height), initial: true) { _, next in
            editor.cropLayout(box: AtelierKit.Size(next.width, next.height))
        }
        .onAppear { wheel.editor = editor }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Crop: drag inside the zone to move it, on the picture to draw a new one, the handles to resize; the arrows nudge it")
    }

    // MARK: - the picture, turned under the zone

    /// The stage's render is the whole picture; until the render that follows
    /// the crop tool arrives, the one on screen is still the CROPPED picture,
    /// and drawing it as the whole would lie for a frame.
    private var wholeStage: CGImage? {
        guard let whole = editor.cropWholeStage else { return nil }
        return editor.holding ? (editor.before ?? whole) : whole
    }

    @ViewBuilder
    private func picture(_ src: PictureDims, _ t: StageTransform) -> some View {
        if let image = wholeStage {
            let framing = editor.cropFraming
            let width = CGFloat(src.width * t.k)
            let height = CGFloat(src.height * t.k)
            Image(decorative: image, scale: 1, orientation: .up)
                .resizable()
                .interpolation(.high)
                .frame(width: width, height: height)
                .scaleEffect(x: framing.flipX ? -1 : 1, y: framing.flipY ? -1 : 1)
                .rotationEffect(.degrees(framing.rotation))
                .position(x: CGFloat(t.ox), y: CGFloat(t.oy))
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
    }

    // MARK: - the marks

    private func edges(_ zone: CropZone, _ t: StageTransform) -> ZoneEdges {
        ZoneEdges(zone, t)
    }

    private func marks(_ src: PictureDims, _ zone: CropZone, _ t: StageTransform) -> some View {
        let e = edges(zone, t)
        let rotation = editor.cropFraming.rotation
        let corners: [CGPoint] = turnedCorners(rotation, src).map { onStage($0.x, $0.y, t) }
        let rotating = editor.cropRotating
        let strong = active
        let levelLine: (CGPoint, CGPoint)? = line.map { l in (onStage(l.x1, l.y1, t), onStage(l.x2, l.y2, t)) }
        let ink = palette.onMedia
        let veil = palette.frame.opacity(0.66)
        let accent = palette.accent
        return Canvas { ctx, size in
            let l = CGFloat(e.l)
            let top = CGFloat(e.t)
            let w = CGFloat(e.r - e.l)
            let h = CGFloat(e.b - e.t)
            let zoneRect = CGRect(x: l, y: top, width: w, height: h)
            // The veil: the whole stage less the zone, one even-odd path.
            var veilPath = Path()
            veilPath.addRect(CGRect(origin: .zero, size: size))
            veilPath.addRect(zoneRect)
            ctx.fill(veilPath, with: .color(veil), style: FillStyle(eoFill: true))
            // The turned picture's outline, faint and dashed: what is available.
            var outline = Path()
            outline.addLines(corners)
            outline.closeSubpath()
            ctx.stroke(outline, with: .color(ink.opacity(0.32)), style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
            // Thirds inside the zone, stronger while a gesture is on.
            var thirds = Path()
            for f in [CGFloat(1) / 3, CGFloat(2) / 3] {
                thirds.move(to: CGPoint(x: l + w * f, y: top))
                thirds.addLine(to: CGPoint(x: l + w * f, y: top + h))
                thirds.move(to: CGPoint(x: l, y: top + h * f))
                thirds.addLine(to: CGPoint(x: l + w, y: top + h * f))
            }
            ctx.stroke(thirds, with: .color(ink.opacity(strong ? 0.55 : 0.2)), lineWidth: 1)
            // While the angle moves, a dense grid: a horizon is read against lines.
            if rotating {
                let cell = max(14, min(w, h) / 12)
                var grid = Path()
                var x = l + cell
                while x < l + w - 1 {
                    grid.move(to: CGPoint(x: x, y: top))
                    grid.addLine(to: CGPoint(x: x, y: top + h))
                    x += cell
                }
                var y = top + cell
                while y < top + h - 1 {
                    grid.move(to: CGPoint(x: l, y: y))
                    grid.addLine(to: CGPoint(x: l + w, y: y))
                    y += cell
                }
                ctx.stroke(grid, with: .color(ink.opacity(0.28)), lineWidth: 1)
            }
            // The zone's edge.
            ctx.stroke(Path(zoneRect.insetBy(dx: 0.5, dy: 0.5)), with: .color(ink.opacity(0.9)), lineWidth: 1)
            // Handles: brackets at the corners, bars mid-edge, drawn just outside.
            let arm = min(18, w / 3, h / 3)
            let thick: CGFloat = 3
            var handles = Path()
            let cornerSigns: [(CGFloat, CGFloat, CGFloat, CGFloat)] = [
                (l, top, 1, 1), (l + w, top, -1, 1), (l, top + h, 1, -1), (l + w, top + h, -1, -1),
            ]
            for (cx, cy, sx, sy) in cornerSigns {
                let hx = sx > 0 ? cx - thick : cx - arm
                let hy = sy > 0 ? cy - thick : cy
                handles.addRect(CGRect(x: hx, y: hy, width: arm + thick, height: thick))
                let vx = sx > 0 ? cx - thick : cx
                let vy = sy > 0 ? cy - thick : cy - arm
                handles.addRect(CGRect(x: vx, y: vy, width: thick, height: arm + thick))
            }
            let bar = min(22, w / 4, h / 4)
            handles.addRect(CGRect(x: l + w / 2 - bar / 2, y: top - thick, width: bar, height: thick))
            handles.addRect(CGRect(x: l + w / 2 - bar / 2, y: top + h, width: bar, height: thick))
            handles.addRect(CGRect(x: l - thick, y: top + h / 2 - bar / 2, width: thick, height: bar))
            handles.addRect(CGRect(x: l + w, y: top + h / 2 - bar / 2, width: thick, height: bar))
            ctx.fill(handles, with: .color(ink))
            // The Level line, over everything while it is laid.
            if let ends = levelLine {
                var p = Path()
                p.move(to: ends.0)
                p.addLine(to: ends.1)
                ctx.stroke(p, with: .color(accent), lineWidth: 2)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    // MARK: - the words on the stage

    @ViewBuilder
    private func words(_ src: PictureDims, _ zone: CropZone, _ t: StageTransform) -> some View {
        let e = edges(zone, t)
        if active {
            // The size tag, in the FILE's pixels (the decoded picture IS the
            // file here), while a gesture is on.
            let px = zoneInSourcePixels(zone, src, src)
            let text = "\(px.w) × \(px.h) px · \(describeAspect(zone.w / zone.h))"
            tag(text)
                .offset(x: CGFloat(e.l), y: CGFloat(e.t > 30 ? e.t - 26 : e.t + 6))
        }
        if editor.cropLevelling && line == nil {
            tag("draw a line along the horizon, or along an upright")
                .frame(maxWidth: .infinity)
                .padding(.top, 44)
        }
        if !active && !editor.cropLevelling && editor.cropView.zoom <= 1 {
            // The crop's own line (the web keeps it UNDER the stage: a box over
            // the picture would cover a grip — here it sits in the handles' room).
            Text(hintLine)
                .font(Brand.mono(10))
                .foregroundStyle(palette.onMedia.opacity(0.62))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                .padding(.horizontal, 12)
                .padding(.bottom, 7)
                .allowsHitTesting(false)
        }
    }

    private var hintLine: String {
        #if os(macOS)
        return "drag inside to move · on the picture to draw · a handle to resize · double-click for the largest"
        #else
        return "drag inside to move · on the picture to draw · a handle to resize · double-tap for the largest"
        #endif
    }

    private func tag(_ text: String) -> some View {
        Text(text)
            .font(Brand.mono(10))
            .monospacedDigit()
            .foregroundStyle(palette.onMedia)
            .lineLimit(1)
            .fixedSize()
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(palette.frame.opacity(0.8), in: RoundedRectangle(cornerRadius: 3))
            .allowsHitTesting(false)
    }

    // MARK: - one finger: the zone

    private var zoneDrag: some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .local)
            .updating($pressed) { _, state, _ in state = true }
            .onChanged { value in
                if pinchStart != nil || spent { return }
                if !started {
                    // The press: the gesture is decided where it landed, and
                    // nothing is written until the pointer moves.
                    started = true
                    focused = true
                    begin(at: value.startLocation)
                    return
                }
                move(to: value.location)
            }
            .onEnded { value in
                end(at: value.location)
            }
    }

    /// The system took the gesture away (no `onEnded`): the zone keeps what
    /// the finger did, and the next press starts afresh.
    private func released() {
        if let zone = live { editor.cropSetZone(zone) }
        finish()
        spent = false
    }

    private var shiftHeld: Bool {
        #if os(macOS)
        return NSEvent.modifierFlags.contains(.shift)
        #else
        return false
        #endif
    }

    private func begin(at p: CGPoint) {
        guard let src = editor.cropSrc, let zone = editor.cropZone else { return }
        let deg = editor.cropFraming.rotation
        let t = cropStageTransform(box, src, deg, editor.cropView)
        let px = Double(p.x)
        let py = Double(p.y)
        let (zx, zy) = inZone(p, t)
        let handle = handleAt(edges(zone, t), px, py, handleTolerance)
        let left = zone.cx - zone.w / 2
        let right = zone.cx + zone.w / 2
        let top = zone.cy - zone.h / 2
        let bottom = zone.cy + zone.h / 2
        let inside = zx > left && zx < right && zy > top && zy < bottom
        var next: ZoneGesture?
        if editor.cropLevelling {
            next = .level(x1: zx, y1: zy)
        } else if let handle {
            // Where the finger took the handle, from the edge itself: the edge
            // must not jump under a finger that landed beside it.
            let name = handle.rawValue
            var edgeX = zx
            if name.contains("e") { edgeX = right } else if name.contains("w") { edgeX = left }
            var edgeY = zy
            if name.contains("s") { edgeY = bottom } else if name.contains("n") { edgeY = top }
            next = .resize(handle: handle, start: zone, grabX: edgeX - zx, grabY: edgeY - zy)
        } else if inside {
            next = .move(lastX: zx, lastY: zy)
        } else if pointOnPicture(zx, zy, deg, src) {
            next = .draw(anchor: AtelierKit.Point(zx, zy), startX: px, startY: py, drawing: false, drew: false)
        }
        gesture = next
        live = nil
        if let next {
            if case .draw = next {} else { active = true }
        }
    }

    private func move(to p: CGPoint) {
        guard let g = gesture, let src = editor.cropSrc, let stored = editor.cropZone else { return }
        let current = live ?? stored
        let deg = editor.cropFraming.rotation
        let t = cropStageTransform(box, src, deg, editor.cropView)
        let px = Double(p.x)
        let py = Double(p.y)
        let (zx, zy) = inZone(p, t)
        var next: CropZone?
        switch g {
        case .level(let x1, let y1):
            line = (x1, y1, zx, zy)
            return
        case .resize(let handle, let start, let grabX, let grabY):
            // In Free, Shift holds the ratio the gesture started with.
            let lock = editor.cropLock ?? (shiftHeld ? start.w / start.h : nil)
            next = resizeZone(start, current, handle, zx + grabX, zy + grabY, lock, deg, src)
        case .move(let lastX, let lastY):
            next = moveZone(current, zx - lastX, zy - lastY, deg, src)
            // The pointer's own position, not the zone's: a move held at an
            // edge resumes the moment the pointer comes back, not a lag later.
            gesture = .move(lastX: zx, lastY: zy)
        case .draw(let anchor, let startX, let startY, let drawing, let drew):
            var isDrawing = drawing
            var didDraw = drew
            if !isDrawing {
                if hypot(px - startX, py - startY) < drawStartPoints { return }
                isDrawing = true
                active = true
            }
            let lock = editor.cropLock ?? (shiftHeld ? current.w / current.h : nil)
            let candidate = drawCandidate(anchor, zx, zy, lock, deg, src)
            if zoneValid(candidate, deg, src) {
                next = candidate
                didDraw = true
            } else if didDraw {
                // Clamped from the last zone THIS draw made — never from the
                // zone it is replacing, which would morph toward the pointer.
                next = clampToward(current, candidate, deg, src)
            }
            gesture = .draw(anchor: anchor, startX: startX, startY: startY, drawing: isDrawing, drew: didDraw)
        }
        if let next, next != current { live = next }
    }

    private func end(at p: CGPoint) {
        if case .level(let x1, let y1)? = gesture, !spent, let src = editor.cropSrc {
            let t = cropStageTransform(box, src, editor.cropFraming.rotation, editor.cropView)
            let (x2, y2) = inZone(p, t)
            // A click is not a line: under a few points the tool stays armed.
            let length = hypot(x2 - x1, y2 - y1) * t.k
            if length >= 12 { editor.cropLevel(x1, y1, x2, y2) }
        } else if let zone = live {
            editor.cropSetZone(zone)
        }
        finish()
        spent = false
    }

    /// The gesture let go — by its end, or by a pinch taking over.
    private func finish() {
        gesture = nil
        live = nil
        line = nil
        active = false
        started = false
    }

    // MARK: - two fingers: the view

    private var pinch: some Gesture {
        MagnifyGesture()
            .onChanged { value in
                guard editor.cropSrc != nil else { return }
                if pinchStart == nil {
                    // The second finger turns what the first began into a
                    // pinch: the zone keeps what that finger did, and stops.
                    if let zone = live { editor.cropSetZone(zone) }
                    finish()
                    spent = true
                    pinchStart = editor.cropView.zoom
                }
                let start = pinchStart ?? 1
                editor.cropZoomView(to: start * Double(value.magnification), anchor: value.startLocation)
            }
            .onEnded { _ in
                pinchStart = nil
            }
    }

    // MARK: - keys

    /// The arrows nudge the zone while the stage has focus (Shift for ten).
    private func nudge(_ press: KeyPress) -> KeyPress.Result {
        let mods = press.modifiers
        if mods.contains(.command) || mods.contains(.control) || mods.contains(.option) { return .ignored }
        guard let src = editor.cropSrc, let zone = editor.cropZone else { return .ignored }
        let deg = editor.cropFraming.rotation
        let t = cropStageTransform(box, src, deg, editor.cropView)
        let step = (mods.contains(.shift) ? 10 : 1) / t.k
        var d = (0.0, 0.0)
        switch press.key {
        case .leftArrow: d = (-step, 0)
        case .rightArrow: d = (step, 0)
        case .upArrow: d = (0, -step)
        case .downArrow: d = (0, step)
        default: return .ignored
        }
        editor.cropSetZone(moveZone(zone, d.0, d.1, deg, src))
        return .handled
    }

    /// A key the editor forwards to the crop tool.
    private func answer(_ action: EditorKeyAction) {
        switch action {
        case .zoom:
            editor.cropSetView { toggleCropView($0) }
        case .swap:
            editor.cropSwap()
        case .escape:
            if editor.cropLevelling {
                editor.cropSetLevelling(false)
                line = nil
            }
        default:
            break
        }
    }

    // MARK: - the pointer (the Mac)

    #if os(macOS)
    /// The cursor says what a press would do.
    private func hover(_ phase: HoverPhase) {
        guard case .active(let at) = phase, gesture == nil,
              let src = editor.cropSrc, let zone = editor.cropZone else {
            if case .ended = phase { NSCursor.arrow.set() }
            return
        }
        if editor.cropLevelling {
            NSCursor.crosshair.set()
            return
        }
        let t = cropStageTransform(box, src, editor.cropFraming.rotation, editor.cropView)
        let e = edges(zone, t)
        let x = Double(at.x)
        let y = Double(at.y)
        let inside = x > e.l && x < e.r && y > e.t && y < e.b
        switch handleAt(e, x, y, 10) {
        case .n?, .s?: NSCursor.resizeUpDown.set()
        case .e?, .w?: NSCursor.resizeLeftRight.set()
        // macOS 14 has no diagonal resize cursor; a corner says "take it".
        case .ne?, .nw?, .se?, .sw?: NSCursor.pointingHand.set()
        case nil: (inside ? NSCursor.openHand : NSCursor.crosshair).set()
        }
    }
    #endif
}

/// The stage box, as `onChange` compares it.
private struct LayoutBox: Equatable {
    let width: Double
    let height: Double
}

/// The Mac's wheel over the crop stage: the kernel's one reading of the hand
/// (`ZoomGestureMachine`, through `WheelCatcher`) driving the crop's VIEW —
/// never the zone.
@MainActor
final class CropWheelTarget: ZoomTarget {
    weak var editor: RollEditor?

    nonisolated func scaleAt(_ at: AtelierKit.Point) -> Double {
        MainActor.assumeIsolated { editor?.cropView.zoom ?? 1 }
    }

    nonisolated func zoomTo(_ scale: Double, anchor: AtelierKit.Point, by: ZoomBy) {
        MainActor.assumeIsolated {
            editor?.cropZoomView(to: scale, anchor: CGPoint(x: anchor.x, y: anchor.y))
        }
    }

    nonisolated func panBy(_ dx: Double, _ dy: Double, at: AtelierKit.Point, by: PanBy) {
        MainActor.assumeIsolated { editor?.cropPanView(dx: dx, dy: dy) }
    }
}

#Preview("Crop stage") {
    CropStagePreview()
        .frame(width: 420, height: 320)
        .darkroom()
}

/// A crop stage over an editor with no roll open — the empty frame and its words.
private struct CropStagePreview: View {
    var body: some View {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("atelier-preview")
        let store = RollStore(root: root)
        let editor = RollEditor(store: store, pool: PicturePool(store: store), presets: PresetBookStore(root: root),
                                rollId: "preview")
        let geometry = StageGeometry(source: CGSize(width: 4000, height: 3000), viewport: CGSize(width: 420, height: 320))
        return CropStageOverlay(context: StageOverlayContext(editor: editor, geometry: geometry, zoom: LookingZoom()))
    }
}
