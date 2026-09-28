// The BADGE STAGE — the web's `BadgeStage.tsx`: the open slide drawn through
// the export's own renderer at the piece's aspect (`PieceStageRenderer`),
// fitted into the room it is given — no view zoom: a pinch here PLACES the
// picture in its frame (`BadgeStagePointer`). Over the paint, the editor's
// chrome (`BadgeStageChrome`), the Library's drop targets, the corner word,
// "decoding…" while a picture loads, and the piece's tasks as a hairline on
// the bottom edge; an error in red under it.
//
// The box is measured, never taken from the picture inside it: the largest
// box of the frame's aspect that fits the room, so a preview never measures
// its own output (`frontend.md`). Its pixels follow the displayed size at the
// screen's scale, between `previewLongEdge` and `maxPreviewLongEdge`.

import SwiftUI
import AtelierKit
#if os(macOS)
import AppKit
#endif

struct BadgeStageView: View {
    @Bindable var model: PieceEditorModel
    let compact: Bool
    @Environment(\.palette) private var palette
    @Environment(\.displayScale) private var displayScale
    @State private var pointer = BadgeStagePointer()
    @State private var drop = PieceDropState()
    @State private var pinchStart: Double?
    @State private var pinchAnchor: AtelierKit.Point?
    @State private var hovering = false

    var body: some View {
        GeometryReader { geo in
            let box = BadgeStageView.fit(model.aspect, in: geo.size)
            stage(box.size)
                .frame(width: box.width, height: box.height)
                .offset(x: box.minX, y: box.minY)
                .onChange(of: box.size, initial: true) { _, size in
                    pointer.box = size
                    model.setStageBox(AtelierKit.Size(Double(size.width), Double(size.height)), scale: Double(displayScale))
                }
        }
        .onAppear { pointer.model = model }
    }

    /// The largest box of `aspect` inside `room`, centred.
    static func fit(_ aspect: Double, in room: CGSize) -> CGRect {
        guard aspect > 0, room.width > 0, room.height > 0 else { return .zero }
        let w = min(Double(room.width), Double(room.height) * aspect)
        let h = w / aspect
        return CGRect(x: (Double(room.width) - w) / 2, y: (Double(room.height) - h) / 2, width: w, height: h)
    }

    // MARK: - the box

    private func stage(_ size: CGSize) -> some View {
        dropped(gestures(layers(size), size), size)
            .clipShape(RoundedRectangle(cornerRadius: Brand.paperRadius))
            .overlay(border)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(accessibilityLabel)
            .accessibilityHint("Tap a piece of the badge to edit it, drag it to move the whole badge; drag the picture to reframe it, pinch to zoom it in its frame")
    }

    private func layers(_ size: CGSize) -> some View {
        ZStack(alignment: .topLeading) {
            palette.frame
            if let frame = model.stage.frame {
                Image(decorative: frame.image, scale: 1)
                    .resizable()
                    .interpolation(.high)
            }
            BadgeStageChrome(model: model, size: size)
            if model.library != nil && !model.isCta {
                PieceDropZonesView(zones: zones(size), state: drop, collage: model.collage != nil)
            }
            if let caption = model.stageCaption {
                BadgeStageCaption(caption: caption)
            }
            TaskEdge(scope: "piece:\(model.postId)")
            if model.loading {
                Text("decoding…")
                    .font(Brand.mono(11))
                    .foregroundStyle(palette.onMedia)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(Capsule().fill(palette.frame.opacity(0.7)))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .allowsHitTesting(false)
            }
        }
        .frame(width: size.width, height: size.height)
    }

    private var border: some View {
        let shape = RoundedRectangle(cornerRadius: Brand.paperRadius)
        return shape
            .strokeBorder(drop.armed ? palette.accent : palette.lineStrong, lineWidth: drop.armed ? 2 : 1)
            .shadow(color: drop.armed ? palette.accent.opacity(0.4) : .clear, radius: drop.armed ? 6 : 0)
            .allowsHitTesting(false)
    }

    private var accessibilityLabel: String {
        if model.stage.frame == nil { return model.loading ? "The picture is decoding" : "The stage" }
        return "Stage — \(model.displayTitle), slide \(model.slideIndex + 1) of \(max(1, model.slides.count))"
    }

    private func zones(_ size: CGSize) -> [DropZone] {
        let cells = model.stage.frame?.cells ?? []
        let frameW = model.stage.frame?.size.width ?? 0
        return dropZones(cells, canvasW: frameW, cssW: Double(size.width), cssH: Double(size.height),
                         holding: model.cellLabels)
    }

    // MARK: - the hand

    private func gestures(_ content: some View, _ size: CGSize) -> some View {
        let press = DragGesture(minimumDistance: 0)
            .onChanged { value in
                guard !pointer.pinching else { return }
                if !pointer.down {
                    pointer.down = true
                    pointer.begin(value.startLocation, alt: BadgeStagePointer.optionHeld,
                                  shift: BadgeStagePointer.shiftHeld)
                }
                pointer.moved(value.location, alt: BadgeStagePointer.optionHeld)
            }
            .onEnded { value in
                if pointer.pinching {
                    pointer.down = false
                    if pinchStart == nil { pointer.onPinch(false) }
                    return
                }
                pointer.end(value.location, compact: compact)
            }
        let pinch = MagnifyGesture()
            .onChanged { value in
                guard pointer.places else { return }
                if pinchStart == nil {
                    // A second finger: whatever the first began stops where it is.
                    pointer.onTakeover()
                    pointer.onPinch(true)
                    let anchor = AtelierKit.Point(Double(value.startLocation.x), Double(value.startLocation.y))
                    pinchAnchor = anchor
                    pinchStart = pointer.scaleAt(anchor)
                }
                guard let start = pinchStart, let anchor = pinchAnchor else { return }
                pointer.zoomTo(start * Double(value.magnification), anchor: anchor, by: .pinch)
            }
            .onEnded { _ in
                pinchStart = nil
                pinchAnchor = nil
                if !pointer.down { pointer.onPinch(false) }
            }
        return content
            .contentShape(Rectangle())
            .gesture(press)
            .simultaneousGesture(pinch)
            .sensoryFeedback(DevelopHaptics.snap, trigger: pointer.swapping)
            .overlay { wheel }
            #if os(macOS)
            .onContinuousHover { phase in hover(phase, size) }
            #endif
    }

    /// The Mac's wheel and trackpad scroll zoom the framing about the pointer
    /// (SwiftUI hands a view no wheel on macOS 14).
    @ViewBuilder
    private var wheel: some View {
        #if os(macOS)
        WheelCatcher(target: pointer, enabled: pointer.places && model.stage.frame != nil)
        #else
        EmptyView()
        #endif
    }

    #if os(macOS)
    /// The cursor says what a press would do: grab a piece or the block,
    /// point at a caption, grab a pannable picture, copy while swapping.
    private func hover(_ phase: HoverPhase, _ size: CGSize) {
        guard case .active(let at) = phase, let frame = model.stage.frame, size.width > 0 else {
            if hovering { NSCursor.arrow.set() }
            hovering = false
            return
        }
        hovering = true
        let k = frame.size.width / Double(size.width)
        let x = Double(at.x) * k
        let y = Double(at.y) * k
        if model.shadeHandle != nil {
            NSCursor.crosshair.set()
        } else if pointer.swapping {
            NSCursor.dragCopy.set()
        } else if OverlayGeometry.hitTest(frame.boxes, x, y) != nil {
            (model.blockAnchor != nil ? NSCursor.openHand : NSCursor.pointingHand).set()
        } else if let r = model.hookRect(frame.size), x >= r.x, x <= r.x + r.width, y >= r.y, y <= r.y + r.height {
            NSCursor.pointingHand.set()
        } else if model.collage != nil || (!model.isCta && model.leadSource != nil) {
            NSCursor.openHand.set()
        } else {
            NSCursor.arrow.set()
        }
    }
    #endif

    // MARK: - the drop

    private func dropped(_ content: some View, _ size: CGSize) -> some View {
        content.onDrop(of: PieceDropReader.types, delegate: BadgeStageDrop(model: model, state: drop, box: size))
    }
}

#Preview("Badge stage") {
    let model = PieceEditorFixtures.model()
    BadgeStageView(model: model, compact: false)
        .aspectRatio(model.aspect, contentMode: .fit)
        .frame(width: 360, height: 450)
        .padding(16)
        .darkroom()
}
