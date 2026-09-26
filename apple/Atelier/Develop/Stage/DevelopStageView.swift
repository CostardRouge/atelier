// The Develop STAGE — the web's `DevelopViewport.tsx` over
// `use-develop-picture.ts`: the picture as it will be delivered, on the
// darkroom's frame, rendered ONCE per change through the editor's
// `DevelopRenderPlan` on a pixel budget (one 4K frame, never the file's own
// density), and LOOKED at through a view zoom that writes nothing
// (`LookingZoom`: pinch, the Mac's wheel and trackpad, a double tap, `Z`, the
// pill — to 4000 %, one pixel per device pixel a landmark).
//
// The compare reads BEFORE → AFTER, left to right (`develop-roll.md`): the
// picture as shot LEFT of the divider, the corrected one on its right; no
// split is 0. It is a switch the host owns (`A/B`), and it SUSPENDS itself
// while a tool holds the pointer — the divider comes back where it was. At
// the fit a drag across the picture wipes; zoomed, a drag pans and the
// divider's handle still wipes. `\` or the pill holds the picture as shot.
//
// Over the picture: the tool's overlay (`StageOverlaySlot`), then the chips —
// `after` / `before · after` / `before`, what this stage does NOT draw yet,
// the facts under `I`, and `◐ hold for before`.

import CoreGraphics
import SwiftUI
import AtelierKit

struct DevelopStageView: View {
    @Bindable var editor: RollEditor
    @Bindable var zoom: LookingZoom
    /// What an empty frame says — the host knows where a picture comes from.
    let emptyText: String

    @Environment(\.palette) private var palette
    @Environment(\.displayScale) private var displayScale
    @State private var pinchStart: Double?
    @State private var dragLast: CGSize?
    @State private var pixels: StagePixels?

    var body: some View {
        GeometryReader { geo in
            let geometry = stageGeometry(geo.size)
            ZStack {
                palette.frame
                if let stage = editor.stage {
                    pictureLayer(stage, geometry)
                    if editor.comparing && editor.wipe > 0 {
                        divider(geometry)
                    }
                }
                StageOverlaySlot(tool: editor.activeTool,
                                 context: StageOverlayContext(editor: editor, geometry: geometry, zoom: zoom))
                states
                chips
            }
            .coordinateSpace(.named(DevelopStageView.space))
            .contentShape(Rectangle())
            .gesture(stageGesture(geometry), including: editor.activeTool.takesPointer ? .subviews : .all)
            .simultaneousGesture(doubleTap(geometry), including: editor.activeTool.takesPointer ? .subviews : .all)
            #if os(macOS)
            .overlay(WheelCatcher(target: zoom, enabled: editor.stage != nil && !editor.activeTool.takesPointer))
            #endif
            .onContinuousHover { phase in hover(phase, geometry) }
            .onChange(of: LayoutKey(viewport: geo.size, fitted: geometry.fitted, frame: geometry.frame,
                                    rendered: Int(editor.stageSize.width), scale: displayScale), initial: true) { _, key in
                zoom.displayScale = Double(key.scale)
                zoom.renderedWidth = Double(key.rendered)
                zoom.layout(viewport: key.viewport, content: key.fitted, natural: key.frame)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: Brand.paperRadius))
        .onChange(of: editor.openId) { _, _ in
            zoom.reset()
            editor.readoutStore.set(nil)
        }
        // The Crop tab raises its tool; the open picture's lens is looked up.
        .modifier(CropTabHooks(editor: editor))
        // The clipping (J) is painted by the render plan over what the stage
        // shows, so a toggle is a render — the histogram never carries it.
        .onChange(of: editor.clipping) { _, _ in
            editor.requestRender()
        }
    }

    // MARK: - geometry

    private func stageGeometry(_ size: CGSize) -> StageGeometry {
        let picture = editor.picture
        let whole = editor.activeTool.showsWholePicture
        let source = editor.decodedSize ?? .zero
        return StageGeometry(
            source: source,
            framing: whole ? .default : (picture?.framing ?? .default),
            aspect: whole ? "original" : (picture?.aspect ?? "original"),
            viewport: size,
            inset: 12,
            view: zoom.view
        )
    }

    // MARK: - the picture

    private func pictureLayer(_ stage: CGImage, _ geometry: StageGeometry) -> some View {
        let fit = geometry.fitted
        let interpolation: Image.Interpolation = zoom.magnifying && zoom.pixelView == .pixels ? .none : .high
        let wipe = editor.shownWipe
        let showsBefore = editor.holding || wipe > 0
        return ZStack(alignment: .leading) {
            Image(decorative: editor.holding ? (editor.before ?? stage) : stage, scale: 1, orientation: .up)
                .resizable()
                .interpolation(interpolation)
                .frame(width: fit.width, height: fit.height)
            if showsBefore && !editor.holding, let before = editor.before {
                Image(decorative: before, scale: 1, orientation: .up)
                    .resizable()
                    .interpolation(interpolation)
                    .frame(width: fit.width, height: fit.height)
                    .mask(alignment: .leading) {
                        Rectangle().frame(width: max(0, fit.width * CGFloat(wipe)))
                    }
            }
        }
        .frame(width: fit.width, height: fit.height)
        .scaleEffect(zoom.view.scale)
        .offset(x: zoom.view.x, y: zoom.view.y)
        .animation(zoom.settling ? .easeOut(duration: 0.22) : nil, value: zoom.view)
        .opacity(editor.loading ? 0.6 : 1)
        .accessibilityLabel("The picture, corrected")
    }

    /// The divider, where the picture is — held inside the box so its handle
    /// can always be reached, even when the line is panned out of view.
    private func divider(_ geometry: StageGeometry) -> some View {
        let rect = geometry.drawnRect
        let x = min(max(rect.minX + rect.width * CGFloat(editor.wipe), 14), geometry.viewport.width - 14)
        let top = max(rect.minY, 0)
        let bottom = min(rect.maxY, geometry.viewport.height)
        let height = max(0, bottom - top)
        return ZStack {
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
        .contentShape(Rectangle())
        .gesture(
            DragGesture(minimumDistance: 0, coordinateSpace: .named(DevelopStageView.space))
                .onChanged { value in
                    editor.wipe = clamp01(Double(geometry.fraction(atView: value.location).x))
                }
        )
        .help("Drag to compare with the picture as shot")
        .position(x: x, y: top + height / 2)
    }

    static let space = "develop-stage"

    // MARK: - what the frame says when there is no picture

    @ViewBuilder
    private var states: some View {
        if editor.stage == nil {
            if let problem = editor.problem {
                message(problem, ink: palette.onMedia)
            } else if editor.loading {
                message("decoding…", ink: palette.muted)
            } else if let p = editor.picture {
                message(availabilityText(p.ref.name, editor.availability(p)), ink: palette.muted)
            } else {
                message(emptyText, ink: palette.muted)
            }
        }
    }

    private func message(_ text: String, ink: Color) -> some View {
        Text(text)
            .font(Brand.mono(11))
            .foregroundStyle(ink)
            .multilineTextAlignment(.center)
            .padding(24)
            .allowsHitTesting(false)
    }

    // MARK: - the chips

    private var chips: some View {
        VStack(alignment: .leading, spacing: 6) {
            if editor.stage != nil && editor.activeTool != .eyedropper {
                HStack(alignment: .top, spacing: 6) {
                    if editor.activeTool != .crop {
                        StageChip(text: editor.holding ? "before" : (editor.shownWipe > 0 ? "before · after" : "after"))
                    }
                    if !editor.unrendered.isEmpty {
                        StageChip(text: "not drawn here: \(editor.unrendered.joined(separator: ", "))", tone: palette.warn)
                    }
                    Spacer(minLength: 0)
                    if zoom.magnifying {
                        StageChip(text: "the stage’s pixels, magnified")
                    }
                }
                .allowsHitTesting(false)
            }
            Spacer(minLength: 0)
            // The crop stage keeps its corners for its handles (`develop-roll.md`).
            if editor.activeTool != .crop {
                HStack(alignment: .bottom, spacing: 8) {
                    if editor.showFacts, editor.stage != nil {
                        StageFacts(shot: editor.captureFacts, facts: editor.factLines)
                    }
                    Spacer(minLength: 0)
                    if editor.stage != nil {
                        holdPill
                    }
                }
            }
        }
        .padding(10)
    }

    /// `◐ hold for before` — the picture as shot while pressed.
    private var holdPill: some View {
        StageChip(text: "◐ hold for before")
            .contentShape(Capsule())
            .onLongPressGesture(minimumDuration: 0, maximumDistance: 40, perform: {}, onPressingChanged: { pressing in
                editor.setHolding(pressing)
            })
            .help("Hold to see the picture as shot")
            .accessibilityLabel("Hold for before")
    }

    // MARK: - gestures

    /// Pinch zooms about where it began; a drag pans once zoomed, and at the
    /// fit WIPES — where the compare is on and nothing holds the pointer.
    private func stageGesture(_ geometry: StageGeometry) -> some Gesture {
        let pinch = MagnifyGesture()
            .onChanged { value in
                guard editor.stage != nil else { return }
                let start = pinchStart ?? zoom.view.scale
                if pinchStart == nil { pinchStart = start }
                zoom.pinch(from: start, ratio: Double(value.magnification), anchor: value.startLocation)
            }
            .onEnded { _ in pinchStart = nil }
        let drag = DragGesture(minimumDistance: 0)
            .onChanged { value in
                guard editor.stage != nil, pinchStart == nil else { return }
                if zoom.zoomed {
                    let last = dragLast ?? .zero
                    zoom.pan(dx: Double(value.translation.width - last.width), dy: Double(value.translation.height - last.height))
                    dragLast = value.translation
                } else if editor.comparing {
                    editor.wipe = clamp01(Double(geometry.fraction(atView: value.location).x))
                }
            }
            .onEnded { _ in dragLast = nil }
        return SimultaneousGesture(pinch, drag)
    }

    /// A double tap: closer about the tap, or back to the fit.
    private func doubleTap(_ geometry: StageGeometry) -> some Gesture {
        SpatialTapGesture(count: 2).onEnded { value in
            guard editor.stage != nil else { return }
            zoom.toggle(about: value.location)
        }
    }

    // MARK: - the pixel under the pointer

    private func hover(_ phase: HoverPhase, _ geometry: StageGeometry) {
        guard case .active(let at) = phase, let stage = editor.stage else {
            editor.readoutStore.set(nil)
            return
        }
        let f = geometry.fraction(atView: at)
        guard f.x >= 0, f.y >= 0, f.x <= 1, f.y <= 1 else {
            editor.readoutStore.set(nil)
            return
        }
        let isBefore = editor.holding || (editor.shownWipe > 0 && Double(f.x) < editor.shownWipe)
        let image = isBefore ? (editor.before ?? stage) : stage
        if pixels?.image !== image { pixels = StagePixels(image) }
        guard let rgb = pixels?.rgb(atFraction: f) else { return }
        // The store tells only the one line that shows it; the same reading twice tells nobody.
        // The before side is never painted: a mark is read as a clip only after.
        let painted = editor.clipping && !isBefore
        editor.readoutStore.set(StageReadout(readout: readoutOf(rgb.0, rgb.1, rgb.2, clipping: painted), before: isBefore))
    }
}

/// What decides the stage's boxes — the zoom is re-laid out when it moves.
private struct LayoutKey: Equatable {
    let viewport: CGSize
    let fitted: CGSize
    let frame: CGSize
    let rendered: Int
    let scale: CGFloat
}

/// The stage render's bytes, read once per render for the readout.
private final class StagePixels {
    let image: CGImage
    private let data: CFData?
    private let bytesPerRow: Int
    private let bytesPerPixel: Int

    init(_ image: CGImage) {
        self.image = image
        data = image.dataProvider?.data
        bytesPerRow = image.bytesPerRow
        bytesPerPixel = max(1, image.bitsPerPixel / 8)
    }

    /// The 8-bit codes at a share of the picture's width and height.
    func rgb(atFraction f: CGPoint) -> (Double, Double, Double)? {
        guard let data, bytesPerPixel >= 3 else { return nil }
        let x = min(image.width - 1, max(0, Int(f.x * CGFloat(image.width))))
        let y = min(image.height - 1, max(0, Int(f.y * CGFloat(image.height))))
        let offset = y * bytesPerRow + x * bytesPerPixel
        guard offset + 2 < CFDataGetLength(data), let base = CFDataGetBytePtr(data) else { return nil }
        return (Double(base[offset]), Double(base[offset + 1]), Double(base[offset + 2]))
    }
}
