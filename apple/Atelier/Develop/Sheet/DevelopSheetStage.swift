// The develop SHEET's stage — the web's `DevelopViewport.tsx` as
// `DevelopSheet.tsx` draws it over `useDevelopPicture`, modelled on the
// Develop tool's own stage (`DevelopStageView`) and reusing its parts: the
// Looking zoom (`LookingZoom`, pinch, the Mac's wheel through `WheelCatcher`,
// a double tap, `Z`), the one geometry every point goes through
// (`StageGeometry`), the chips (`StageChip`) and the pixel reader
// (`StagePixels`). The tool's stage is left exactly as it was.
//
// The compare reads BEFORE → AFTER, left to right (`develop-roll.md`): the
// picture as shot LEFT of the divider, the corrected one on its right; no
// split is 0 and the handle waits at the left edge. At the fit a drag across
// the picture wipes; zoomed, a drag pans and the handle still wipes. `\` or
// the pill holds the picture as shot. While the grey dropper is armed it
// takes the pointer WHOLE — the wipe and the pan stand down, the divider is
// suspended — and one tap reads the picture AS SHOT under it, through the
// same geometry that draws it, then puts the dropper down.
//
// Over the picture: `after` / `before · after` / `before`, the dropper's
// word, `the stage’s pixels, magnified` past the preview's own pixels, and
// `◐ hold for before`. The pixel under the pointer goes to the readout store
// the histogram's middle line listens to — with the clipping painted, a mark
// is read as the clip it marks.

import CoreGraphics
import CoreImage
import SwiftUI
import AtelierKit

struct DevelopSheetStage: View {
    @Bindable var picture: DevelopSheetPicture
    @Binding var draft: DevelopSettings
    /// A picture was handed over, so a frame with nothing on it is decoding.
    let hasPicture: Bool
    /// What an empty frame says — the host knows where a picture comes from.
    let emptyText: String
    let onTold: (String) -> Void

    @Environment(\.palette) private var palette
    @Environment(\.displayScale) private var displayScale
    @State private var pinchStart: Double?
    @State private var dragLast: CGSize?
    @State private var pixels: StagePixels?

    static let space = "develop-sheet-stage"

    var body: some View {
        GeometryReader { geo in
            let geometry = stageGeometry(geo.size)
            stack(geometry)
                .coordinateSpace(.named(DevelopSheetStage.space))
                .contentShape(Rectangle())
                .gesture(stageGesture(geometry), including: picture.picking ? .subviews : .all)
                .simultaneousGesture(doubleTap, including: picture.picking ? .subviews : .all)
                #if os(macOS)
                .overlay(WheelCatcher(target: picture.zoom, enabled: picture.shown != nil && !picture.picking))
                #endif
                .onContinuousHover { phase in hover(phase, geometry) }
                .onChange(of: layoutKey(geo.size, geometry), initial: true) { _, key in
                    picture.zoom.displayScale = Double(key.scale)
                    picture.zoom.renderedWidth = Double(key.rendered)
                    picture.zoom.layout(viewport: key.viewport, content: key.fitted, natural: key.natural)
                }
        }
        .clipShape(RoundedRectangle(cornerRadius: Brand.paperRadius))
    }

    private func stack(_ geometry: StageGeometry) -> some View {
        ZStack {
            palette.frame
            if let shown = picture.shown {
                pictureLayer(shown, geometry)
                if picture.comparing {
                    divider(geometry)
                }
                if picture.picking {
                    dropper(geometry)
                }
            }
            states
            chips
        }
    }

    // MARK: - geometry

    /// The picture whole, fitted in the box less a hair — the sheet's picture
    /// carries no crop, so its frame IS the picture.
    private func stageGeometry(_ size: CGSize) -> StageGeometry {
        StageGeometry(source: picture.sourceSize, viewport: size, inset: 8, view: picture.zoom.view)
    }

    private func layoutKey(_ size: CGSize, _ geometry: StageGeometry) -> SheetStageLayout {
        SheetStageLayout(viewport: size, fitted: geometry.fitted, natural: picture.natural,
                         rendered: Int(picture.sourceSize.width), scale: displayScale)
    }

    // MARK: - the picture

    private func pictureLayer(_ shown: CGImage, _ geometry: StageGeometry) -> some View {
        let fit = geometry.fitted
        let zoom = picture.zoom
        let interpolation: Image.Interpolation = zoom.magnifying && zoom.pixelView == .pixels ? .none : .high
        let wipe = picture.shownWipe
        let holding = picture.holding
        let before = picture.before
        return ZStack(alignment: .leading) {
            Image(decorative: holding ? (before ?? shown) : shown, scale: 1, orientation: .up)
                .resizable()
                .interpolation(interpolation)
                .frame(width: fit.width, height: fit.height)
            if wipe > 0 && !holding, let before {
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
        .accessibilityLabel("The picture, corrected")
    }

    /// The divider where the picture is — its handle held inside the box so
    /// it can always be reached, at the left edge while there is no split.
    private func divider(_ geometry: StageGeometry) -> some View {
        let rect = geometry.drawnRect
        let at = rect.minX + rect.width * CGFloat(picture.wipe)
        let x = min(max(at, 14), geometry.viewport.width - 14)
        let top = max(rect.minY, 0)
        let bottom = min(rect.maxY, geometry.viewport.height)
        let height = max(0, bottom - top)
        return ZStack {
            if picture.wipe > 0 {
                Rectangle()
                    .fill(palette.onMedia.opacity(0.9))
                    .frame(width: 1.5, height: height)
            }
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
            DragGesture(minimumDistance: 0, coordinateSpace: .named(DevelopSheetStage.space))
                .onChanged { value in
                    picture.wipe = clamp01(Double(geometry.fraction(atView: value.location).x))
                }
        )
        .help("Drag to compare with the picture as shot")
        .accessibilityLabel("Before and after divider")
        .position(x: x, y: top + height / 2)
    }

    // MARK: - the grey dropper

    /// Armed, the whole stage answers ONE tap: the picture as shot under it.
    private func dropper(_ geometry: StageGeometry) -> some View {
        Color.clear
            .contentShape(Rectangle())
            .gesture(
                SpatialTapGesture().onEnded { value in
                    guard let at = geometry.pointAt(view: value.location) else { return }
                    pick(u: at.u, v: at.v)
                }
            )
            #if os(macOS)
            .onHover { inside in
                if inside { NSCursor.crosshair.push() } else { NSCursor.pop() }
            }
            #endif
    }

    /// Solve the white balance on the picture AS SHOT at `[u, v]`, write it
    /// into the draft, say what was picked and put the dropper down.
    private func pick(u: Double, v: Double) {
        Task { @MainActor in
            let linear = await picture.sampleGrey(u: u, v: v)
            picture.setPicking(false)
            guard let linear else { return }
            let wb = whiteBalanceFor(linear)
            var next = draft
            next.temperature = wb.temperature
            next.tint = wb.tint
            draft = next
            onTold("picked grey · temperature \(Int(wb.temperature)), tint \(Int(wb.tint))"
                + (wb.clamped ? " · as far as the sliders reach" : ""))
        }
    }

    // MARK: - what the frame says when there is no picture

    @ViewBuilder
    private var states: some View {
        if picture.shown == nil {
            if let problem = picture.problem {
                message(problem, ink: palette.onMedia)
            } else if hasPicture {
                message("decoding…", ink: palette.muted)
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
        let lit = picture.shown != nil
        return VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 6) {
                if lit && picture.picking {
                    dropperWord
                } else if lit && picture.changed {
                    StageChip(text: picture.holding ? "before" : (picture.shownWipe > 0 ? "before · after" : "after"))
                }
                Spacer(minLength: 0)
                if lit && picture.zoom.magnifying {
                    StageChip(text: "the stage’s pixels, magnified")
                }
            }
            .allowsHitTesting(false)
            Spacer(minLength: 0)
            if lit && picture.changed && !picture.picking {
                HStack {
                    Spacer(minLength: 0)
                    holdPill
                }
            }
        }
        .padding(10)
    }

    private var dropperWord: some View {
        Text(DevelopSheetStage.pickWord)
            .font(Brand.mono(11))
            .foregroundStyle(palette.accentInk)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(palette.surface.opacity(0.92), in: Capsule())
            .overlay(Capsule().stroke(palette.accent, lineWidth: 1))
    }

    #if os(macOS)
    static let pickWord = "click something grey"
    #else
    static let pickWord = "tap something grey"
    #endif

    /// `◐ hold for before` — the picture as shot while pressed.
    private var holdPill: some View {
        StageChip(text: "◐ hold for before")
            .contentShape(Capsule())
            .onLongPressGesture(minimumDuration: 0, maximumDistance: 40, perform: {}, onPressingChanged: { pressing in
                picture.setHolding(pressing)
            })
            .help("Hold to see the picture as shot")
            .accessibilityLabel("Hold for before")
    }

    // MARK: - gestures

    /// Pinch zooms about where it began; a drag pans once zoomed, and at the
    /// fit WIPES — where the compare is live.
    private func stageGesture(_ geometry: StageGeometry) -> some Gesture {
        let pinch = MagnifyGesture()
            .onChanged { value in
                guard picture.shown != nil else { return }
                let start = pinchStart ?? picture.zoom.view.scale
                if pinchStart == nil { pinchStart = start }
                picture.zoom.pinch(from: start, ratio: Double(value.magnification), anchor: value.startLocation)
            }
            .onEnded { _ in pinchStart = nil }
        let drag = DragGesture(minimumDistance: 0)
            .onChanged { value in
                guard picture.shown != nil, pinchStart == nil else { return }
                if picture.zoom.zoomed {
                    let last = dragLast ?? .zero
                    let dx = Double(value.translation.width - last.width)
                    let dy = Double(value.translation.height - last.height)
                    picture.zoom.pan(dx: dx, dy: dy)
                    dragLast = value.translation
                } else if picture.comparing {
                    picture.wipe = clamp01(Double(geometry.fraction(atView: value.location).x))
                }
            }
            .onEnded { _ in dragLast = nil }
        return SimultaneousGesture(pinch, drag)
    }

    /// A double tap: closer about the tap, or back to the fit.
    private var doubleTap: some Gesture {
        SpatialTapGesture(count: 2).onEnded { value in
            guard picture.shown != nil else { return }
            picture.zoom.toggle(about: value.location)
        }
    }

    // MARK: - the pixel under the pointer

    private func hover(_ phase: HoverPhase, _ geometry: StageGeometry) {
        guard case .active(let at) = phase, let shown = picture.shown else {
            picture.readout.set(nil)
            return
        }
        let f = geometry.fraction(atView: at)
        guard f.x >= 0, f.y >= 0, f.x <= 1, f.y <= 1 else {
            picture.readout.set(nil)
            return
        }
        let wipe = picture.shownWipe
        let isBefore = picture.holding || (wipe > 0 && Double(f.x) < wipe)
        let image = isBefore ? (picture.before ?? shown) : shown
        if pixels?.image !== image { pixels = StagePixels(image) }
        guard let rgb = pixels?.rgb(atFraction: f) else { return }
        // The before side is never painted: a mark is read as a clip only after.
        let painted = picture.clipping && !isBefore
        picture.readout.set(StageReadout(readout: readoutOf(rgb.0, rgb.1, rgb.2, clipping: painted), before: isBefore))
    }
}

/// What decides the zoom's boxes — it is laid out again when one moves.
private struct SheetStageLayout: Equatable {
    let viewport: CGSize
    let fitted: CGSize
    let natural: CGSize?
    let rendered: Int
    let scale: CGFloat
}

#Preview("Sheet stage") {
    DevelopSheetStagePreview()
        .frame(width: 420, height: 300)
        .padding()
        .background(Palette.darkroom.surface)
        .darkroom()
}

/// A painted gradient on the stage, graded by a develop, the divider live.
private struct DevelopSheetStagePreview: View {
    @State private var picture = DevelopSheetPicture()
    @State private var draft: DevelopSettings = {
        var d = DevelopSettings.default
        d.exposure = 0.7
        return d
    }()

    var body: some View {
        DevelopSheetStage(picture: picture, draft: $draft, hasPicture: true,
                          emptyText: "No picture to develop yet.", onTold: { _ in })
            .onAppear {
                let ramp = CIFilter(name: "CILinearGradient", parameters: [
                    "inputPoint0": CIVector(x: 0, y: 0), "inputPoint1": CIVector(x: 800, y: 0),
                    "inputColor0": CIColor(red: 0.1, green: 0.2, blue: 0.3),
                    "inputColor1": CIColor(red: 0.95, green: 0.85, blue: 0.6),
                ])?.outputImage?.cropped(to: CGRect(x: 0, y: 0, width: 800, height: 533))
                if let ramp {
                    picture.load(ramp, natural: nil, facts: nil)
                    picture.grade(draft, through: DevelopSheetLook(look: nil, film: nil, grader: FrameGrader(),
                                                                   interpolation: .tetrahedral))
                    picture.wipe = 0.4
                }
            }
    }
}
