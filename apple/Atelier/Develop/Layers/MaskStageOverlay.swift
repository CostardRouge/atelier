// The MASK tool on the stage — what the web's `DevelopViewport` draws and
// answers while a layer is open (`PictureWorkbench.tsx`'s paint seam and
// `marks`), plus the handles the web never had:
//
// - the layered picture itself (`LayerLookingRenderer`, while the stage's own
//   plan does not draw the layers), with the open layer's mask shown as its
//   outline or its wash, and the region a tap just added blinking;
// - a LINEAR mask's three lines (full · mid · none) with its handles — the
//   centre moves it, the knob on the mid line turns it, a bar on each edge
//   line sets the feather; a RADIAL mask's ellipse and feather ring with its
//   centre, two half-axes, the ring's handle and the knob above it;
// - with Paint on, a drag lays a stroke (a finger, the Pencil, the pointer),
//   the brush drawn as a ring of its size and its solid core; a point off the
//   picture starts nothing, a hand that strays past the edge and comes back
//   carries on;
// - with Pick on, a tap adds a subject point, samples a colour, or puts a
//   brightness band on the tone tapped; each picked point is DRAWN, a `+` disc
//   that turns `−` under the pointer and answers its OWN press, so the stage's
//   tap can never remove it twice; the Mac's cursor says copy;
// - a pinch zooms, a drag pans once zoomed (the stage's own gestures stand
//   down while the tool holds the pointer), a double tap goes closer when
//   nothing is being made, the Mac's wheel zooms, and Esc lets go.
//
// Every point goes through `StageGeometry` (the source's shares ↔ the view),
// every write through the editor (`RollEditor+Layers.swift`), and every
// guide's arithmetic is the kernel's (`MaskEdit.swift`), so a line drawn here
// is exactly where `maskAt` reads 1, 0.5 or 0.

import SwiftUI
#if os(macOS)
import AppKit
#endif
import AtelierKit

struct MaskStageOverlay: View {
    let context: StageOverlayContext
    @Environment(\.palette) private var palette
    /// The pointer (or the painting finger), for the brush's ring.
    @State private var hover: CGPoint?
    @State private var pinchStart: Double?
    /// The surface drag: begun, a stroke under way, panned rather than tapped.
    @State private var dragBegan = false
    @State private var strokeStarted = false
    @State private var dragPanned = false
    @State private var dragLast: CGSize = .zero
    /// A gradient's centre under the hand: the mask and the point it began at.
    @State private var held: HeldCentre?
    @State private var hoveredMark: Int?
    #if os(macOS)
    @State private var cursorPushed = false
    #endif

    private var editor: RollEditor { context.editor }
    private var geometry: StageGeometry { context.geometry }
    private var zoom: LookingZoom { context.zoom }

    /// What the pointer does on the picture now.
    private enum Mode {
        case look, paint, pick
    }

    private var mode: Mode {
        switch editor.maskPointerKind {
        case .brush?: return .paint
        case .subject?, .colour?, .luma?: return .pick
        default: return .look
        }
    }

    var body: some View {
        let state = editor.layerState
        let mask = editor.openMask
        let mode = self.mode
        ZStack {
            looking(state)
            guides(mask: mask, mode: mode, brush: state.brush)
            surface(mode)
            handles(mask)
            marks(mask, removable: mode == .pick)
            chip(state: state, mask: mask, mode: mode)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onContinuousHover { phase in hovered(phase) }
        .onChange(of: editor.toolCommand) { _, command in
            if command?.action == .escape { editor.layersEscape() }
        }
        #if os(macOS)
        .onChange(of: mode) { _, next in
            if hover != nil || cursorPushed { setCursor(next) }
        }
        .onDisappear { setCursor(nil) }
        .overlay(WheelCatcher(target: zoom, enabled: editor.stage != nil))
        #endif
    }

    // MARK: - the layered picture

    @ViewBuilder
    private func looking(_ state: LayerEditState) -> some View {
        let image = state.flashOn ? (state.lookingFlash ?? state.lookingImage) : state.lookingImage
        if let image, !editor.holding {
            let fit = geometry.fitted
            let pixels = zoom.magnifying && zoom.pixelView == .pixels
            Image(decorative: image, scale: 1, orientation: .up)
                .resizable()
                .interpolation(pixels ? .none : .high)
                .frame(width: fit.width, height: fit.height)
                .scaleEffect(zoom.view.scale)
                .offset(x: zoom.view.x, y: zoom.view.y)
                .animation(zoom.settling ? .easeOut(duration: 0.22) : nil, value: zoom.view)
                .allowsHitTesting(false)
                .accessibilityLabel("The picture with its layers")
        }
    }

    // MARK: - the guides

    private func guides(mask: Mask?, mode: Mode, brush: BrushTool) -> some View {
        let strokes = guideStrokes(mask)
        let clip = geometry.drawnRect
        let ring = mode == .paint ? brushRing(brush) : nil
        let ink = palette.onMedia
        let shade = palette.frame
        let accent = palette.accent
        return Canvas { ctx, _ in
            var inside = ctx
            inside.clip(to: Path(clip))
            for stroke in strokes {
                let dash: [CGFloat] = stroke.dashed ? [6, 5] : []
                let under = StrokeStyle(lineWidth: 3.2, lineCap: .round, dash: dash)
                let over = StrokeStyle(lineWidth: stroke.strong ? 1.6 : 1.1, lineCap: .round, dash: dash)
                inside.stroke(stroke.path, with: .color(shade.opacity(0.55)), style: under)
                inside.stroke(stroke.path, with: .color(ink.opacity(stroke.strong ? 1 : 0.8)), style: over)
            }
            if let ring {
                let outer = Path(ellipseIn: CGRect(x: ring.at.x - ring.radius, y: ring.at.y - ring.radius,
                                                   width: ring.radius * 2, height: ring.radius * 2))
                let core = Path(ellipseIn: CGRect(x: ring.at.x - ring.core, y: ring.at.y - ring.core,
                                                  width: ring.core * 2, height: ring.core * 2))
                ctx.stroke(outer, with: .color(shade.opacity(0.55)), lineWidth: 3)
                ctx.stroke(outer, with: .color(ring.erase ? accent : ink), lineWidth: 1.25)
                ctx.stroke(core, with: .color(ink.opacity(0.7)), style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                if ring.erase {
                    var minus = Path()
                    minus.move(to: CGPoint(x: ring.at.x - 5, y: ring.at.y))
                    minus.addLine(to: CGPoint(x: ring.at.x + 5, y: ring.at.y))
                    ctx.stroke(minus, with: .color(accent), lineWidth: 2)
                }
            }
        }
        .allowsHitTesting(false)
    }

    private struct GuideStroke {
        let path: Path
        let dashed: Bool
        let strong: Bool
    }

    /// A point of the source's shares on the stage, whether the crop kept it or not.
    private func onStage(_ p: AtelierKit.Point) -> CGPoint {
        geometry.stagePoint(u: p.x, v: p.y)?.point ?? .zero
    }

    /// The source's shape — what every mask is measured against — from the
    /// geometry the stage is drawn with; nil before a decode.
    private var aspect: Double? {
        let size = geometry.source
        guard size.width > 0, size.height > 0 else { return nil }
        return Double(size.width / size.height)
    }

    private func line(_ a: AtelierKit.Point, _ b: AtelierKit.Point) -> Path {
        var path = Path()
        path.move(to: onStage(a))
        path.addLine(to: onStage(b))
        return path
    }

    private func polyline(_ points: [AtelierKit.Point]) -> Path {
        var path = Path()
        guard let first = points.first else { return path }
        path.move(to: onStage(first))
        for p in points.dropFirst() { path.addLine(to: onStage(p)) }
        return path
    }

    /// A gradient's lines: FULL solid and strong, MID dashed, NONE solid; an
    /// ellipse solid and its feather ring dashed.
    private func guideStrokes(_ mask: Mask?) -> [GuideStroke] {
        guard let ar = aspect else { return [] }
        switch mask {
        case .linear(let m)?:
            let g = linearGuides(m, ar)
            return [
                GuideStroke(path: line(g.fullFrom, g.fullTo), dashed: false, strong: true),
                GuideStroke(path: line(g.midFrom, g.midTo), dashed: true, strong: false),
                GuideStroke(path: line(g.noneFrom, g.noneTo), dashed: false, strong: false),
            ]
        case .radial(let m)?:
            let g = radialGuides(m, ar)
            return [
                GuideStroke(path: polyline(g.ellipse), dashed: false, strong: true),
                GuideStroke(path: polyline(g.ring), dashed: true, strong: false),
            ]
        default:
            return []
        }
    }

    /// The brush as a ring of its size at the pointer, its solid core inside.
    private func brushRing(_ brush: BrushTool) -> (at: CGPoint, radius: CGFloat, core: CGFloat, erase: Bool)? {
        guard let at = hover else { return nil }
        let diagonal = hypot(Double(geometry.source.width), Double(geometry.source.height))
        let perPoint = geometry.sourceLength(ofViewLength: 1)
        guard diagonal > 0, perPoint > 0 else { return nil }
        let radius = CGFloat(brush.radius * diagonal / 2 / perPoint)
        let core = radius * CGFloat(Swift.min(1, Swift.max(0, brush.hardness)) * 0.95)
        return (at, radius, core, brush.erase)
    }

    // MARK: - the gradients' handles

    private struct HandleSpot: Identifiable {
        let handle: MaskHandle
        let at: CGPoint
        var id: String { handle.rawValue }
    }

    private struct HeldCentre {
        let mask: Mask
        let start: AtelierKit.Point
    }

    private func handleSpots(_ mask: Mask?) -> [HandleSpot] {
        guard let ar = aspect else { return [] }
        switch mask {
        case .linear(let m)?:
            let g = linearGuides(m, ar)
            return [
                HandleSpot(handle: .full, at: onStage(g.fullHandle)),
                HandleSpot(handle: .none, at: onStage(g.noneHandle)),
                HandleSpot(handle: .turn, at: onStage(g.turn)),
                HandleSpot(handle: .centre, at: onStage(g.centre)),
            ]
        case .radial(let m)?:
            let g = radialGuides(m, ar, segments: 8)
            return [
                HandleSpot(handle: .radiusX, at: onStage(g.radiusX)),
                HandleSpot(handle: .radiusY, at: onStage(g.radiusY)),
                HandleSpot(handle: .feather, at: onStage(g.feather)),
                HandleSpot(handle: .turn, at: onStage(g.turn)),
                HandleSpot(handle: .centre, at: onStage(g.centre)),
            ]
        default:
            return []
        }
    }

    @ViewBuilder
    private func handles(_ mask: Mask?) -> some View {
        if let mask {
            ForEach(handleSpots(mask)) { spot in
                MaskHandleKnob(handle: spot.handle)
                    .gesture(handleDrag(spot.handle, mask: mask))
                    .position(spot.at)
            }
        }
    }

    private func handleDrag(_ handle: MaskHandle, mask: Mask) -> some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .named(DevelopStageView.space))
            .onChanged { value in
                guard let at = geometry.pointAt(view: value.location, unbounded: true) else { return }
                let p = AtelierKit.Point(at.u, at.v)
                guard handle == .centre else {
                    editor.maskDragHandle(handle, to: p)
                    return
                }
                if held == nil, let start = geometry.pointAt(view: value.startLocation, unbounded: true) {
                    held = HeldCentre(mask: editor.openMask ?? mask, start: AtelierKit.Point(start.u, start.v))
                }
                guard let held else { return }
                editor.maskMove(from: held.mask, du: p.x - held.start.x, dv: p.y - held.start.y)
            }
            .onEnded { _ in held = nil }
    }

    // MARK: - the surface: paint, pick, pan, pinch

    private func surface(_ mode: Mode) -> some View {
        Color.clear
            .contentShape(Rectangle())
            .gesture(surfaceDrag(mode))
            .simultaneousGesture(pinch)
            .simultaneousGesture(doubleTap, including: mode == .look ? .all : .none)
            .accessibilityHidden(true)
    }

    private func surfaceDrag(_ mode: Mode) -> some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .named(DevelopStageView.space))
            .onChanged { value in
                guard pinchStart == nil else { return }
                if mode == .paint {
                    paint(value)
                } else {
                    pan(value)
                }
            }
            .onEnded { value in
                if mode == .paint {
                    if strokeStarted { editor.maskStrokeEnd() }
                    #if os(iOS)
                    hover = nil
                    #endif
                } else if mode == .pick, !dragPanned, pinchStart == nil,
                          let at = geometry.pointAt(view: value.location) {
                    editor.maskTap(at: AtelierKit.Point(at.u, at.v))
                }
                dragBegan = false
                strokeStarted = false
                dragPanned = false
                dragLast = .zero
            }
    }

    /// A stroke: the press starts it — only on the picture — and every move
    /// grows it, past the edge too.
    private func paint(_ value: DragGesture.Value) {
        hover = value.location
        if !dragBegan {
            dragBegan = true
            if let at = geometry.pointAt(view: value.startLocation) {
                editor.maskStrokeBegin(at: AtelierKit.Point(at.u, at.v))
                strokeStarted = true
            }
        }
        guard strokeStarted, let at = geometry.pointAt(view: value.location, unbounded: true) else { return }
        editor.maskStrokeMove(to: AtelierKit.Point(at.u, at.v))
    }

    /// A drag that moves past a tap's slop pans the zoomed picture; one that
    /// never does is a tap, answered on the lift.
    private func pan(_ value: DragGesture.Value) {
        let moved = hypot(value.translation.width, value.translation.height)
        if !dragPanned {
            guard moved > 6 else { return }
            dragPanned = true
            dragLast = value.translation
            return
        }
        if zoom.zoomed {
            let dx = Double(value.translation.width - dragLast.width)
            let dy = Double(value.translation.height - dragLast.height)
            zoom.pan(dx: dx, dy: dy)
        }
        dragLast = value.translation
    }

    private var pinch: some Gesture {
        MagnifyGesture()
            .onChanged { value in
                guard editor.stage != nil else { return }
                let start = pinchStart ?? zoom.view.scale
                if pinchStart == nil { pinchStart = start }
                zoom.pinch(from: start, ratio: Double(value.magnification), anchor: value.startLocation)
            }
            .onEnded { _ in pinchStart = nil }
    }

    private var doubleTap: some Gesture {
        SpatialTapGesture(count: 2).onEnded { value in
            guard editor.stage != nil else { return }
            zoom.toggle(about: value.location)
        }
    }

    // MARK: - the picked points

    @ViewBuilder
    private func marks(_ mask: Mask?, removable: Bool) -> some View {
        if let points = maskMarks(mask) {
            let swatches = markSwatches(mask)
            ForEach(Array(points.enumerated()), id: \.offset) { index, point in
                if let at = geometry.stagePoint(u: point.x, v: point.y), at.inside {
                    let spoken: String = removable ? "Take point \(index + 1) off" : "Point \(index + 1)"
                    let tip: String = removable ? "Take this point off" : "A point of the mask"
                    MaskMarkDisc(minus: removable && hoveredMark == index, removable: removable,
                                 swatch: index < swatches.count ? swatches[index] : nil)
                        .onTapGesture { if removable { editor.maskUnmark(index) } }
                        .onHover { inside in
                            if inside {
                                hoveredMark = index
                            } else if hoveredMark == index {
                                hoveredMark = nil
                            }
                        }
                        .allowsHitTesting(removable)
                        .accessibilityLabel(spoken)
                        .accessibilityAddTraits(removable ? .isButton : [])
                        .help(tip)
                        .position(at.point)
                }
            }
        }
    }

    /// A colour range's samples wear their own colour on the marker's ring.
    private func markSwatches(_ mask: Mask?) -> [Color] {
        guard case .colour(let c)? = mask else { return [] }
        return c.samples.map { Color(.sRGB, red: $0.r, green: $0.g, blue: $0.b, opacity: 1) }
    }

    // MARK: - what the tool says

    @ViewBuilder
    private func chip(state: LayerEditState, mask: Mask?, mode: Mode) -> some View {
        if let text = chipText(state: state, mask: mask, mode: mode) {
            let warn = mode == .pick && mask?.kind == .subject && state.subjectUnavailable != nil
            VStack {
                Text(text)
                    .font(Brand.mono(11))
                    .foregroundStyle(warn ? palette.warn : palette.accentInk)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(palette.surface.opacity(0.92), in: Capsule())
                    .overlay(Capsule().stroke(warn ? palette.warn : palette.accent, lineWidth: 1))
                    .padding(.top, 44)
                    .padding(.horizontal, 12)
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .allowsHitTesting(false)
        }
    }

    private func chipText(state: LayerEditState, mask: Mask?, mode: Mode) -> String? {
        let touch = pointerWord
        switch mode {
        case .paint:
            let size = Int((state.brush.radius * 100).rounded())
            return "\(state.brush.erase ? "drag to erase" : "drag to paint") · size \(size) % · P to stop"
        case .pick:
            switch mask {
            case .subject(let s)?:
                guard let layer = editor.openLayer else { return nil }
                return editor.subjectStatus(layer, s)
            case .colour?:
                return state.readout ?? "\(touch) a colour — a marker to take it off"
            case .luma?:
                return state.readout ?? "\(touch) a tone to put the band on it"
            default:
                return nil
            }
        case .look:
            switch mask {
            case .linear?:
                return "drag the centre to move it, the knob to turn it, an edge bar for the feather"
            case .radial?:
                return "drag the centre, a side, the dashed ring or the knob"
            case .brush?:
                return "Paint is off — P, or Paint in the panel"
            case .subject?, .colour?, .luma?:
                return "Pick is off — P, or Pick in the panel"
            default:
                return nil
            }
        }
    }

    private var pointerWord: String {
        #if os(macOS)
        return "click"
        #else
        return "tap"
        #endif
    }

    // MARK: - the pointer

    private func hovered(_ phase: HoverPhase) {
        switch phase {
        case .active(let at):
            if mode == .paint { hover = at }
            let p = geometry.pointAt(view: at).map { AtelierKit.Point($0.u, $0.v) }
            editor.layersHover(at: p)
            #if os(macOS)
            if !cursorPushed { setCursor(mode) }
            #endif
        case .ended:
            hover = nil
            editor.layersHover(at: nil)
            #if os(macOS)
            setCursor(nil)
            #endif
        }
    }

    #if os(macOS)
    /// The Mac's cursor says what a click does: copy while picking (a `+`
    /// badge), a crosshair while painting, the arrow otherwise.
    private func setCursor(_ next: Mode?) {
        if cursorPushed {
            NSCursor.pop()
            cursorPushed = false
        }
        switch next {
        case .paint?:
            NSCursor.crosshair.push()
            cursorPushed = true
        case .pick?:
            NSCursor.dragCopy.push()
            cursorPushed = true
        default:
            break
        }
    }
    #endif
}

/// A gradient's handle: a disc for the centre, a knob to turn, a bar or a dot
/// for a size — each with a finger's target round it.
private struct MaskHandleKnob: View {
    let handle: MaskHandle
    @Environment(\.palette) private var palette

    var body: some View {
        knob
            .frame(width: 40, height: 40)
            .contentShape(Circle())
            .accessibilityLabel(label)
            .help(label)
    }

    @ViewBuilder
    private var knob: some View {
        switch handle {
        case .centre:
            Circle()
                .fill(palette.accent)
                .frame(width: 14, height: 14)
                .overlay(Circle().stroke(palette.onMedia, lineWidth: 2))
                .shadow(color: palette.frame.opacity(0.6), radius: 2)
        case .turn:
            Image(systemName: "arrow.triangle.2.circlepath")
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(palette.inkSoft)
                .frame(width: 20, height: 20)
                .background(Circle().fill(palette.surface.opacity(0.92)))
                .overlay(Circle().stroke(palette.accent, lineWidth: 1))
        case .full, .none:
            Capsule()
                .fill(palette.onMedia)
                .frame(width: 16, height: 6)
                .overlay(Capsule().stroke(palette.frame.opacity(0.6), lineWidth: 1))
        default:
            Circle()
                .fill(palette.onMedia)
                .frame(width: 10, height: 10)
                .overlay(Circle().stroke(palette.frame.opacity(0.6), lineWidth: 1))
        }
    }

    private var label: String {
        switch handle {
        case .centre: return "Move the mask"
        case .turn: return "Turn the mask"
        case .full: return "Where the mask is full — the feather"
        case .none: return "Where the mask ends — the feather"
        case .radiusX: return "Width"
        case .radiusY: return "Height"
        case .feather: return "The feather ring"
        }
    }
}

/// A picked point: a `+` at rest, a `−` under the pointer — the icon SAYS
/// what a click will do rather than what the marker is.
private struct MaskMarkDisc: View {
    let minus: Bool
    let removable: Bool
    let swatch: Color?
    @Environment(\.palette) private var palette

    var body: some View {
        let edge: Color = minus ? palette.accent : palette.lineStrong
        let ring: Color = swatch ?? edge
        let width: CGFloat = swatch == nil ? 1 : 2.5
        return Image(systemName: minus ? "minus" : "plus")
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(minus ? palette.accentInk : palette.inkSoft)
            .frame(width: 20, height: 20)
            .background(Circle().fill(palette.surface.opacity(0.92)))
            .overlay(Circle().stroke(ring, lineWidth: width))
            .shadow(color: palette.frame.opacity(0.4), radius: 2)
            .frame(width: 36, height: 36)
            .contentShape(Circle())
            .opacity(removable ? 1 : 0.85)
    }
}

// MARK: - preview

#Preview("Mask tool · radial") {
    let editor = LayersPreviewFixture.editor(open: "face")
    let zoom = LookingZoom()
    let geometry = StageGeometry(source: CGSize(width: 4000, height: 3000), viewport: CGSize(width: 640, height: 440))
    return ZStack {
        Palette.darkroom.frame
        MaskStageOverlay(context: StageOverlayContext(editor: editor, geometry: geometry, zoom: zoom))
    }
    .frame(width: 640, height: 440)
    .darkroom()
}
