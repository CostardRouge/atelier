// The Studio STAGE — the web's `useOverlayStage` canvas: the composite the
// editor renders (the frame or the still, graded, the overlays burnt in by
// the export's own painter), fitted into the room it is given — no view zoom:
// one shipped on the web and was taken back out, because over a media preview
// it fought the gestures the picture itself answers.
//
// Over the picture, editor chrome that never reaches a file: the composition
// guides (`GuidesPainter`, the web's `drawGuides`), the selected element's
// dashed outline (its box from `measureOverlays`, the paint's own layout),
// and — while the A/B wipe is on — the divider, the ORIGINAL on its left.
//
// The gestures are the web's pointer handlers, in the image's own pixels:
// a press hit-tests the elements (the selected one ghosted outside its window
// so it stays reachable) and selects what it lands on; a drag moves it —
// clamped to the frame, snapped to the grid when the grid snaps, else to the
// light edge-and-centre snap, Option held to place freely on a Mac; a press
// that never travelled is a TAP, which on a phone raises the inspector. With
// the wipe on, any drag moves the divider instead.

import SwiftUI
import AtelierKit
#if os(macOS)
import AppKit
#endif

struct StudioStageView: View {
    @Bindable var editor: StudioEditor
    let compact: Bool
    let emptyText: String
    @Environment(\.palette) private var palette
    @Environment(\.displayScale) private var displayScale
    @State private var drag: StageDrag?

    /// What a press started.
    private struct StageDrag {
        enum Mode {
            case wipe
            case element(id: String, startX: Double, startY: Double)
            case nothing
        }
        let mode: Mode
        let start: CGPoint
        let hit: String?
    }

    var body: some View {
        GeometryReader { geo in
            let image = editor.stage.image
            let imageSize = image.map { CGSize(width: $0.width, height: $0.height) } ?? .zero
            let rect = stageFitRect(imageSize, in: geo.size)
            ZStack(alignment: .topLeading) {
                (image == nil ? Color.clear : palette.frame)
                if let image {
                    Image(decorative: image, scale: 1)
                        .resizable()
                        .interpolation(.high)
                        .frame(width: rect.width, height: rect.height)
                        .offset(x: rect.minX, y: rect.minY)
                    chrome(rect: rect, imageSize: imageSize)
                        .frame(width: rect.width, height: rect.height)
                        .offset(x: rect.minX, y: rect.minY)
                        .allowsHitTesting(false)
                } else {
                    placeholder
                        .frame(width: geo.size.width, height: geo.size.height)
                }
            }
            .contentShape(Rectangle())
            .gesture(pointer(rect: rect, imageSize: imageSize), including: image == nil ? .subviews : .all)
            .onChange(of: geo.size, initial: true) { _, size in
                editor.renderSize = stagePixels(size, scale: displayScale)
                editor.requestRender()
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: Brand.controlRadius))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(editor.stage.image == nil ? emptyText : "Stage — \(editor.active?.baseName ?? "")")
        .accessibilityHint(editor.compareOn ? "Drag to move the divider: original on the left, composed on the right"
                                            : "Tap an element to select it, drag it to move it")
    }

    @ViewBuilder
    private var placeholder: some View {
        if editor.active != nil, editor.photoProblem == nil, editor.playback.failure == nil {
            ProgressView().tint(palette.onMedia)
        } else {
            Text(emptyText)
                .font(Brand.mono(13))
                .foregroundStyle(palette.muted)
                .multilineTextAlignment(.center)
                .padding(24)
                .frame(maxWidth: 520)
                .background(palette.surface, in: RoundedRectangle(cornerRadius: Brand.paperRadius))
                .overlay(RoundedRectangle(cornerRadius: Brand.paperRadius).stroke(palette.line, lineWidth: 1))
                .padding(16)
        }
    }

    // MARK: - chrome

    private func chrome(rect: CGRect, imageSize: CGSize) -> some View {
        let guides = editor.edit.guides
        let outline = selectionRect(rect: rect, imageSize: imageSize)
        return ZStack(alignment: .topLeading) {
            if guides.grid.show || guides.safeZone != "none" {
                Canvas { ctx, size in
                    ctx.withCGContext { cg in
                        GuidesPainter.drawGuides(in: cg, size: size, guides: guides)
                    }
                }
            }
            if let outline {
                Rectangle()
                    .path(in: outline)
                    .stroke(palette.accent, style: StrokeStyle(lineWidth: 1.5, dash: [6, 6]))
            }
            if editor.compareOn {
                divider(height: rect.height, x: rect.width * CGFloat(editor.split))
            }
        }
    }

    /// The selected element's box, in the stage view's points.
    private func selectionRect(rect: CGRect, imageSize: CGSize) -> CGRect? {
        guard let id = editor.selectedId, imageSize.width > 0, imageSize.height > 0,
              let box = OverlayGeometry.boxForId(editor.overlayBoxes(), id) else { return nil }
        let k = rect.width / imageSize.width
        return CGRect(x: CGFloat(box.x) * k, y: CGFloat(box.y) * k, width: CGFloat(box.w) * k, height: CGFloat(box.h) * k)
    }

    private func divider(height: CGFloat, x: CGFloat) -> some View {
        ZStack {
            Rectangle()
                .fill(palette.accent)
                .frame(width: 2, height: height)
            Circle()
                .fill(palette.accent)
                .overlay(
                    Image(systemName: "arrow.left.and.right")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(palette.onMedia)
                )
                .frame(width: 30, height: 30)
        }
        .frame(width: 30, height: height)
        .position(x: x, y: height / 2)
    }

    // MARK: - the pointer

    private func pointer(rect: CGRect, imageSize: CGSize) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                guard rect.width > 0, imageSize.width > 0 else { return }
                let k = imageSize.width / rect.width
                let px = Double((value.location.x - rect.minX) * k)
                if drag == nil { begin(at: value.startLocation, rect: rect, k: Double(k)) }
                guard let current = drag else { return }
                switch current.mode {
                case .wipe:
                    editor.setSplit(wipeSplit(px, width: Double(imageSize.width)))
                case .element(let id, let startX, let startY):
                    let dx = Double(value.location.x - current.start.x) * Double(k)
                    let dy = Double(value.location.y - current.start.y) * Double(k)
                    let point = stageDragPosition(startX: startX, startY: startY, dxPx: dx, dyPx: dy,
                                                  width: Double(imageSize.width), height: Double(imageSize.height),
                                                  grid: editor.edit.guides.grid, bypassSnap: StudioStageView.optionHeld)
                    editor.moveElement(id, to: point)
                case .nothing:
                    break
                }
            }
            .onEnded { value in
                defer { drag = nil }
                guard let current = drag, let hit = current.hit else { return }
                let dx = Double(value.location.x - current.start.x)
                let dy = Double(value.location.y - current.start.y)
                if isStageTap(dx: dx, dy: dy) { editor.activate(hit, compact: compact) }
            }
    }

    private func begin(at start: CGPoint, rect: CGRect, k: Double) {
        if editor.compareOn {
            drag = StageDrag(mode: .wipe, start: start, hit: nil)
            return
        }
        // The press lands where it STARTED, not where the first move event is.
        let sx = Double(start.x - rect.minX) * k
        let sy = Double(start.y - rect.minY) * k
        let hit = OverlayGeometry.hitTest(editor.overlayBoxes(), sx, sy)
        editor.select(hit)
        if let hit, let element = editor.edit.elements.first(where: { $0.id == hit }) {
            drag = StageDrag(mode: .element(id: hit, startX: element.x, startY: element.y), start: start, hit: hit)
        } else {
            drag = StageDrag(mode: .nothing, start: start, hit: nil)
        }
    }

    /// Option held — place freely, no snapping (the web's Alt). A phone has no modifier.
    private static var optionHeld: Bool {
        #if os(macOS)
        return NSEvent.modifierFlags.contains(.option)
        #else
        return false
        #endif
    }
}
