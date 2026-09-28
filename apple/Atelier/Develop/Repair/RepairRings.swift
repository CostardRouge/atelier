// What the repair puts ON the picture — the web's `DevelopViewport.tsx`
// rings and spots, and the two pictures `use-develop-picture.ts` lays over
// the stage for it — shared by the repair tool's overlay (Repair armed) and
// the stage's idle slot (`RepairMarksOverlay`):
//
// - every patch as TWO rings following the zoom: the destination solid, its
//   source dashed, a dotted line between them; a clone in the warm ink, a
//   heal in the light one, the selected patch in the accent with a dot at
//   its centre; the `−` a click would take away drawn in the solid ring
//   under the pointer (`render-repair.md`);
// - on the Detail tab every ring is a HANDLE with a hit disc of at least
//   11 pt under a pointer (22 under a finger — a 3 pt ring is not a target):
//   a drag on the solid ring moves the patch, on the dashed one its source,
//   and a press that travels under 3 pt is a TAP — on the solid ring it takes
//   the patch off, on the dashed one it selects. The press is CLAIMED: a
//   child's gesture takes precedence over the stage's own, so the wipe, the
//   pan and the placing surface never see it. The Mac's cursor says what a
//   click does before it clicks — a native `−` over a solid ring, an open
//   hand over a dashed one, a closed hand once the press moves;
// - the spots the dust scan proposes, as dotted rings with a `+`, each
//   healed by its own tap — a proposal is never a patch until it is taken;
// - the dust MAP in the picture's place, drawn through the stage's own
//   framing (an affine map from the source to the view: rotation, mirror,
//   zoom and pan in one), so a proposed ring lands on the mark it names;
// - the repaired picture while the stage's plan does not draw the repair,
//   keeping to the right of the divider when the compare is live.
//
// Every point goes through `StageGeometry` — the source's shares ↔ the view —
// and every radius is measured as a vector one radius to the right, so a
// turned framing keeps a circle a circle.

import SwiftUI
#if os(macOS)
import AppKit
#endif
import AtelierKit

// MARK: - the rings and the spots

struct RepairHandles: View {
    let context: StageOverlayContext
    /// The rings answer the hand (the Detail tab); elsewhere they are facts.
    let live: Bool
    @Environment(\.palette) private var palette
    /// The handle the hand holds, where the press began, whether it travelled.
    @State private var press: HandlePress?

    /// A press on a handle. A new press is told by its START — a drag a
    /// system gesture took over gets no end from SwiftUI, and a flag it left
    /// set must never hold the next press back.
    private struct HandlePress {
        let id: String
        let start: CGPoint
        var travelled: Bool
    }

    /// Points a press may wander before it is a drag rather than a tap (the web's `RING_SLOP`).
    static let slop: CGFloat = 3
    /// A ring's hit disc is never smaller than this (the web's `RING_HIT`, a finger's twice it).
    static var hitRadius: CGFloat {
        #if os(iOS)
        return 22
        #else
        return 11
        #endif
    }

    private var editor: RollEditor { context.editor }
    private var geometry: StageGeometry { context.geometry }

    var body: some View {
        let state = editor.repairState
        let rings = ringSpots(editor.repairPatches, selected: state.selectedId)
        let spots = live ? spotMarks(editor.repairVisibleSpots ?? []) : []
        let hovered = live ? state.hovered : nil
        ZStack {
            drawing(rings: rings, spots: spots, hovered: hovered)
            if live {
                ForEach(spots) { spot in spotDisc(spot) }
                ForEach(handleSpots(rings)) { handle in ringDisc(handle) }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - where everything is on the stage

    struct RingSpot: Identifiable {
        let id: String
        let number: Int
        let at: CGPoint
        let from: CGPoint?
        let radius: CGFloat
        let kind: PatchKind
        let selected: Bool
    }

    struct SpotMark: Identifiable {
        let spot: DustSpot
        let at: CGPoint
        let radius: CGFloat
        var id: String { "\(spot.x),\(spot.y)" }
    }

    struct RingHandle: Identifiable {
        let ring: String
        let number: Int
        let part: RingPart
        let at: CGPoint
        let radius: CGFloat
        var id: String { "\(ring).\(part.rawValue)" }
    }

    private var aspect: Double? {
        let size = geometry.source
        guard size.width > 0, size.height > 0 else { return nil }
        return Double(size.width / size.height)
    }

    /// A radius as shares of the frame, measured on the stage as a vector one
    /// radius to the right of the centre.
    private func stageRadius(u: Double, v: Double, ru: Double, from at: CGPoint, floor: CGFloat) -> CGFloat {
        guard let edge = geometry.stagePoint(u: u + ru, v: v) else { return floor * 2 }
        let dx = edge.point.x - at.x
        let dy = edge.point.y - at.y
        return max(floor, hypot(dx, dy))
    }

    private func ringSpots(_ patches: [Patch], selected: String?) -> [RingSpot] {
        guard let ar = aspect else { return [] }
        var out: [RingSpot] = []
        for (index, p) in patches.enumerated() {
            guard let at = geometry.stagePoint(u: p.x, v: p.y) else { continue }
            let extent = patchExtent(p, ar)
            let radius = stageRadius(u: p.x, v: p.y, ru: extent.ru, from: at.point, floor: 3)
            let source = patchSource(p)
            let from = geometry.stagePoint(u: source.x, v: source.y)?.point
            out.append(RingSpot(id: p.id, number: index + 1, at: at.point, from: from, radius: radius,
                                kind: p.kind, selected: p.id == selected))
        }
        return out
    }

    private func spotMarks(_ spots: [DustSpot]) -> [SpotMark] {
        guard let ar = aspect else { return [] }
        var out: [SpotMark] = []
        for spot in spots {
            // A spot the crop left out is not offered.
            guard let at = geometry.stagePoint(u: spot.x, v: spot.y), at.inside else { continue }
            let ru = radiusExtent(spot.radius, ar).ru
            let radius = stageRadius(u: spot.x, v: spot.y, ru: ru, from: at.point, floor: 4)
            out.append(SpotMark(spot: spot, at: at.point, radius: radius))
        }
        return out
    }

    /// Each ring's two handles — the source first, so the solid ring is on top where two overlap.
    private func handleSpots(_ rings: [RingSpot]) -> [RingHandle] {
        var out: [RingHandle] = []
        for ring in rings {
            if let from = ring.from {
                out.append(RingHandle(ring: ring.id, number: ring.number, part: .source, at: from, radius: ring.radius))
            }
            out.append(RingHandle(ring: ring.id, number: ring.number, part: .patch, at: ring.at, radius: ring.radius))
        }
        return out
    }

    // MARK: - the drawing

    private func drawing(rings: [RingSpot], spots: [SpotMark], hovered: RingHover?) -> some View {
        let halo = palette.frame.opacity(0.55)
        let light = palette.onMedia.opacity(0.92)
        let warm = palette.warn
        let accent = palette.accent
        return Canvas { ctx, _ in
            for spot in spots {
                let circle = Path(ellipseIn: circleRect(spot.at, spot.radius))
                ctx.stroke(circle, with: .color(halo), lineWidth: 2.5)
                ctx.stroke(circle, with: .color(light), style: StrokeStyle(lineWidth: 1, dash: [1.5, 2.5]))
                var plus = Path()
                plus.move(to: CGPoint(x: spot.at.x - 3, y: spot.at.y))
                plus.addLine(to: CGPoint(x: spot.at.x + 3, y: spot.at.y))
                plus.move(to: CGPoint(x: spot.at.x, y: spot.at.y - 3))
                plus.addLine(to: CGPoint(x: spot.at.x, y: spot.at.y + 3))
                ctx.stroke(plus, with: .color(light.opacity(0.9)), style: StrokeStyle(lineWidth: 1.2, lineCap: .round))
            }
            for ring in rings {
                let ink: Color = ring.kind == .heal ? light : warm
                let stroke: Color = ring.selected ? accent : ink
                if let from = ring.from {
                    var link = Path()
                    link.move(to: ring.at)
                    link.addLine(to: from)
                    ctx.stroke(link, with: .color(stroke.opacity(0.7)), style: StrokeStyle(lineWidth: 1, dash: [2, 3]))
                    let source = Path(ellipseIn: circleRect(from, ring.radius))
                    ctx.stroke(source, with: .color(halo), lineWidth: 2.5)
                    ctx.stroke(source, with: .color(stroke),
                               style: StrokeStyle(lineWidth: ring.selected ? 1.6 : 1.2, dash: [3, 3]))
                }
                let disc = Path(ellipseIn: circleRect(ring.at, ring.radius))
                ctx.stroke(disc, with: .color(halo), lineWidth: 3)
                ctx.stroke(disc, with: .color(stroke), lineWidth: ring.selected ? 2 : 1.4)
                if ring.selected {
                    ctx.fill(Path(ellipseIn: circleRect(ring.at, 1.6)), with: .color(stroke))
                }
                // The `−` a click would take away, in the ring under the pointer.
                if hovered == RingHover(id: ring.id, part: .patch) {
                    var minus = Path()
                    minus.move(to: CGPoint(x: ring.at.x - 3.5, y: ring.at.y))
                    minus.addLine(to: CGPoint(x: ring.at.x + 3.5, y: ring.at.y))
                    ctx.stroke(minus, with: .color(stroke), style: StrokeStyle(lineWidth: 1.8, lineCap: .round))
                }
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private func circleRect(_ at: CGPoint, _ radius: CGFloat) -> CGRect {
        CGRect(x: at.x - radius, y: at.y - radius, width: radius * 2, height: radius * 2)
    }

    // MARK: - the handles

    private func ringDisc(_ handle: RingHandle) -> some View {
        let hit = max(handle.radius, RepairHandles.hitRadius)
        let isPatch = handle.part == .patch
        let spoken: String = isPatch ? "Patch \(handle.number)" : "Where patch \(handle.number) borrows from"
        let tip: String = isPatch ? "Click to take this patch off · drag to move it"
                                  : "Drag to change where this patch borrows from · click to edit the patch"
        let verb: String = isPatch ? "Take it off" : "Edit it"
        return Circle()
            .fill(Color.clear)
            .frame(width: hit * 2, height: hit * 2)
            .contentShape(Circle())
            .gesture(ringDrag(handle))
            .onHover { inside in hover(inside ? RingHover(id: handle.ring, part: handle.part) : nil,
                                       leaving: RingHover(id: handle.ring, part: handle.part)) }
            .position(handle.at)
            .accessibilityElement()
            .accessibilityLabel(spoken)
            .accessibilityAddTraits(.isButton)
            .accessibilityAction(named: Text(verb)) {
                if isPatch { editor.repairRemove(handle.ring) } else { editor.repairSelect(handle.ring) }
            }
            .help(tip)
    }

    private func ringDrag(_ handle: RingHandle) -> some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .named(DevelopStageView.space))
            .onChanged { value in
                if press?.id != handle.id || press?.start != value.startLocation {
                    press = HandlePress(id: handle.id, start: value.startLocation, travelled: false)
                    if let at = geometry.pointAt(view: value.startLocation, unbounded: true) {
                        editor.repairRingBegin(handle.ring, handle.part, at: AtelierKit.Point(at.u, at.v))
                    }
                }
                guard var held = press else { return }
                if !held.travelled {
                    let moved = hypot(value.translation.width, value.translation.height)
                    guard moved > RepairHandles.slop else { return }
                    held.travelled = true
                    press = held
                    #if os(macOS)
                    NSCursor.closedHand.set()
                    #endif
                }
                if let at = geometry.pointAt(view: value.location, unbounded: true) {
                    editor.repairRingMove(to: AtelierKit.Point(at.u, at.v))
                }
            }
            .onEnded { _ in
                let wasTravelled = press?.travelled ?? false
                press = nil
                editor.repairRingEnd(travelled: wasTravelled)
                #if os(macOS)
                // A cursor says what the hand is doing NOW (`render-repair.md`).
                RepairCursor.show(editor.repairEdit.hovered?.part, armed: editor.activeTool == .repair)
                #endif
            }
    }

    private func spotDisc(_ mark: SpotMark) -> some View {
        let hit = max(mark.radius, RepairHandles.hitRadius)
        return Circle()
            .fill(Color.clear)
            .frame(width: hit * 2, height: hit * 2)
            .contentShape(Circle())
            // Its own press: reaching the stage would place a second patch
            // under the heal this tap makes.
            .gesture(
                DragGesture(minimumDistance: 0, coordinateSpace: .named(DevelopStageView.space))
                    .onEnded { value in
                        let moved = hypot(value.translation.width, value.translation.height)
                        if moved <= RepairHandles.slop * 3 { editor.repairHealSpot(mark.spot) }
                    }
            )
            #if os(macOS)
            .onHover { inside in
                if inside {
                    NSCursor.pointingHand.set()
                } else {
                    RepairCursor.show(nil, armed: editor.activeTool == .repair)
                }
            }
            #endif
            .position(mark.at)
            .accessibilityElement()
            .accessibilityLabel("A spot the scan found")
            .accessibilityAddTraits(.isButton)
            .accessibilityAction(named: Text("Heal this spot")) { editor.repairHealSpot(mark.spot) }
            .help("Heal this spot")
    }

    /// The pointer entered or left a handle: its `−`, and the Mac's cursor.
    private func hover(_ next: RingHover?, leaving: RingHover) {
        let state = editor.repairEdit
        if let next {
            state.hovered = next
        } else if state.hovered == leaving {
            state.hovered = nil
        }
        #if os(macOS)
        // While a press moves a ring the closed hand stays.
        if press == nil {
            RepairCursor.show(state.hovered?.part, armed: editor.activeTool == .repair)
        }
        #endif
    }
}

// MARK: - the repaired picture

/// The picture with its patches, laid over the stage's own while the plan
/// does not draw the repair — the stage's frame, zoom and pixels.
struct RepairLookingLayer: View {
    let context: StageOverlayContext
    /// Off the tool the compare is live: the repaired picture keeps to the
    /// RIGHT of the divider, where the stage shows its after.
    let followsWipe: Bool

    var body: some View {
        let editor = context.editor
        let zoom = context.zoom
        if let image = editor.repairEdit.lookingImage, editor.stage != nil, !editor.holding {
            let fit = context.geometry.fitted
            let pixels = zoom.magnifying && zoom.pixelView == .pixels
            let wipe = followsWipe ? CGFloat(editor.shownWipe) : 0
            let kept = max(0, fit.width * (1 - wipe))
            Image(decorative: image, scale: 1, orientation: .up)
                .resizable()
                .interpolation(pixels ? .none : .high)
                .frame(width: fit.width, height: fit.height)
                .mask(alignment: .trailing) {
                    Rectangle().frame(width: kept)
                }
                .scaleEffect(zoom.view.scale)
                .offset(x: zoom.view.x, y: zoom.view.y)
                .animation(zoom.settling ? .easeOut(duration: 0.22) : nil, value: zoom.view)
                .allowsHitTesting(false)
                .accessibilityLabel("The picture, repaired")
            if wipe > 0 {
                DividerEcho(geometry: context.geometry, wipe: wipe)
            }
        }
    }
}

/// The stage's divider drawn again over the repaired picture, which would
/// otherwise cover half of it — a picture, not a handle: the stage's own
/// divider under it still takes the hand.
private struct DividerEcho: View {
    let geometry: StageGeometry
    let wipe: CGFloat
    @Environment(\.palette) private var palette

    var body: some View {
        let rect = geometry.drawnRect
        let x = min(max(rect.minX + rect.width * wipe, 14), geometry.viewport.width - 14)
        let top = max(rect.minY, 0)
        let bottom = min(rect.maxY, geometry.viewport.height)
        let height = max(0, bottom - top)
        ZStack {
            Rectangle()
                .fill(palette.onMedia.opacity(0.9))
                .frame(width: 1.5, height: height)
            Image(systemName: "chevron.left.chevron.right")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(palette.inkSoft)
                .frame(width: 26, height: 26)
                .background(palette.surface.opacity(0.92), in: Circle())
                .overlay(Circle().stroke(palette.lineStrong, lineWidth: 1))
        }
        .frame(width: 28, height: height)
        .position(x: x, y: top + height / 2)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

// MARK: - the dust map

/// The dust scan's MAP in the picture's place: the source-space field drawn
/// through the stage's framing and zoom, clipped to the drawn frame.
struct DustMapLayer: View {
    let context: StageOverlayContext

    var body: some View {
        let editor = context.editor
        let state = editor.repairEdit
        if state.dust.on, state.dust.map, let veil = state.veil, editor.stage != nil, !editor.holding {
            let geometry = context.geometry
            let clip = geometry.drawnRect
            let size = geometry.source
            let place = DustMapLayer.sourceToView(geometry)
            Canvas { ctx, _ in
                var inside = ctx
                inside.clip(to: Path(clip))
                inside.concatenate(place)
                inside.draw(Image(decorative: veil, scale: 1, orientation: .up), in: CGRect(origin: .zero, size: size))
            }
            .allowsHitTesting(false)
            .accessibilityLabel("The dust map: the picture as what falls below its surroundings")
        }
    }

    /// The affine map from the SOURCE's pixels to the view — the framing
    /// (rotation, mirror, scale, pan) and the Looking zoom in one, read off
    /// three points of `StageGeometry.toView(source:)`.
    static func sourceToView(_ g: StageGeometry) -> CGAffineTransform {
        let w = g.source.width
        let h = g.source.height
        guard w > 0, h > 0 else { return .identity }
        let o = g.toView(source: .zero)
        let across = g.toView(source: CGPoint(x: w, y: 0))
        let down = g.toView(source: CGPoint(x: 0, y: h))
        let a = (across.x - o.x) / w
        let b = (across.y - o.y) / w
        let c = (down.x - o.x) / h
        let d = (down.y - o.y) / h
        return CGAffineTransform(a: a, b: b, c: c, d: d, tx: o.x, ty: o.y)
    }
}

// MARK: - the Mac's cursors

#if os(macOS)
enum RepairCursor {
    /// A disc with a minus in it — the glyph the ring shows under the
    /// pointer — so the hand is told what a click does before it clicks (the
    /// web's `REMOVE_CURSOR`, its hotspot at the centre).
    static let remove: NSCursor = {
        let ink = NSColor(Palette.darkroom.onMedia)
        let shade = NSColor(Palette.darkroom.frame)
        let image = NSImage(size: NSSize(width: 22, height: 22), flipped: false) { _ in
            let disc = NSBezierPath(ovalIn: NSRect(x: 2.5, y: 2.5, width: 17, height: 17))
            ink.withAlphaComponent(0.96).setFill()
            disc.fill()
            shade.withAlphaComponent(0.8).setStroke()
            disc.lineWidth = 1.4
            disc.stroke()
            let minus = NSBezierPath()
            minus.move(to: NSPoint(x: 6.5, y: 11))
            minus.line(to: NSPoint(x: 15.5, y: 11))
            minus.lineWidth = 2
            minus.lineCapStyle = .round
            shade.withAlphaComponent(0.9).setStroke()
            minus.stroke()
            return true
        }
        return NSCursor(image: image, hotSpot: NSPoint(x: 11, y: 11))
    }()

    /// The cursor for what is under the pointer: the `−` over a solid ring,
    /// an open hand over a dashed one, else the crosshair while Repair places
    /// patches and the arrow when it does not.
    static func show(_ part: RingPart?, armed: Bool) {
        switch part {
        case .patch?: remove.set()
        case .source?: NSCursor.openHand.set()
        case nil: (armed ? NSCursor.crosshair : NSCursor.arrow).set()
        }
    }
}
#endif
