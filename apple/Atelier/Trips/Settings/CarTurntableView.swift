// The car on a turntable — the garage's own view of it, turning on its own
// and turnable by hand. Port of `src/tools/roadtrip/CarTurntable.tsx`.
//
// Rules kept (`roadtrip.md`, «The car is the TRIP's», (6)):
// - It is the DRIVE's renderer, never a second drawing: the frame is the
//   kernel's `Turntable.frame` (the drive's renderOrder + paintSteps + ground
//   shadow, the same light for the finish and palette for the colour) and the
//   car is painted by `DrivePainter.paintCar` — never SceneKit, never a model
//   of our own — so what the garage shows is what the Virée map gets.
// - The angle is a LOOK: held in this view's state, never stored, never a
//   piece's Camera row.
// - It turns by itself (~25 s a lap) unless the system asks for less motion,
//   and a gesture PAUSES it rather than stopping it for good: it resumes 1.5 s
//   after the last one. The loop runs only while it turns (a `TimelineView`
//   paused otherwise), so an idle or reduced-motion turntable repaints only
//   when the car or the view changes; the spin is folded into the stored
//   angle when it pauses, never accumulated per frame.
// - A finger turns only (the web's `touch-pan-y`: the sheet it sits in still
//   scrolls — the drag is SIMULTANEOUS with the scroll on iOS and reads only
//   the horizontal travel); a mouse on the Mac also tilts, 35°–90°; the arrow
//   keys turn by 15° and tilt by 5°; VoiceOver's adjustable action turns it.
//
// What differs, measured in points rather than device pixels: the outline's
// and the ring's floors (0.9 and 1) are points here, where the web's canvas
// counts them in device pixels at up to 2×.

import SwiftUI
import AtelierKit

struct CarTurntableView: View {
    let spec: CarSpec

    @Environment(\.palette) private var palette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// The view — written by gestures and keys, read by every paint.
    @State private var angles = Turntable.Angles.initial
    /// When the platter began turning on its own; nil while it is held still.
    @State private var spinFrom: Date? = Date()
    /// The drag's last translation, while a finger or the mouse is down.
    @State private var lastDrag: CGSize?
    @State private var resume: Task<Void, Never>?
    @State private var cache = TurntableParts()
    @FocusState private var focused: Bool

    /// A mouse tilts; a finger only turns.
    private static var pointerTilts: Bool {
        #if os(macOS)
        return true
        #else
        return false
        #endif
    }

    var body: some View {
        let model = carModel(spec.model)
        return GeometryReader { geo in
            TimelineView(.animation(minimumInterval: nil, paused: spinFrom == nil || reduceMotion)) { timeline in
                let shown = current(at: timeline.date)
                Canvas(rendersAsynchronously: false) { context, size in
                    draw(&context, size: size, angles: shown)
                }
            }
            .contentShape(Rectangle())
            #if os(iOS)
            .simultaneousGesture(drag(geo.size))
            #else
            .gesture(drag(geo.size))
            #endif
        }
        .background(palette.paper)
        .clipShape(RoundedRectangle(cornerRadius: Brand.paperRadius))
        .overlay(
            RoundedRectangle(cornerRadius: Brand.paperRadius)
                .strokeBorder(focused ? palette.accent : palette.line, lineWidth: focused ? 2 : 1)
        )
        .focusable()
        .focusEffectDisabled()
        .focused($focused)
        .onKeyPress(keys: [.leftArrow, .rightArrow, .upArrow, .downArrow]) { press in
            key(press.key)
            return .handled
        }
        .accessibilityElement()
        .accessibilityLabel(describeCar(spec, model.name))
        .accessibilityAddTraits(.isImage)
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: key(.rightArrow)
            case .decrement: key(.leftArrow)
            @unknown default: break
            }
        }
        .help("Drag to turn the car; the arrow keys turn and tilt it")
        .onChange(of: reduceMotion) { _, reduce in
            if reduce {
                fold()
            } else if lastDrag == nil {
                spinFrom = Date()
            }
        }
        .onDisappear { resume?.cancel() }
    }

    // MARK: - the view over time

    /// The angle on screen at `date`: the stored one, turned by the time the
    /// platter has been spinning.
    private func current(at date: Date) -> Turntable.Angles {
        guard let from = spinFrom, !reduceMotion else { return angles }
        return Turntable.spun(angles, seconds: date.timeIntervalSince(from))
    }

    /// Hold it still where it is: the spin so far becomes the stored angle.
    private func fold() {
        if let from = spinFrom {
            angles = Turntable.spun(angles, seconds: Date().timeIntervalSince(from))
        }
        spinFrom = nil
    }

    /// A gesture pauses the turning; it resumes a moment after the last one.
    private func pause() {
        resume?.cancel()
        fold()
    }

    private func resumeLater() {
        resume?.cancel()
        resume = Task { @MainActor in
            try? await Task.sleep(nanoseconds: UInt64(Turntable.resumeAfter * 1_000_000_000))
            guard !Task.isCancelled, lastDrag == nil, !reduceMotion else { return }
            spinFrom = Date()
        }
    }

    // MARK: - the hand and the keys

    private func drag(_ size: CGSize) -> some Gesture {
        DragGesture(minimumDistance: 2)
            .onChanged { value in
                if lastDrag == nil { pause() }
                let last = lastDrag ?? .zero
                let dx = Double(value.translation.width - last.width)
                let dy = Double(value.translation.height - last.height)
                lastDrag = value.translation
                angles = Turntable.dragged(angles, dx: dx, dy: dy, width: Double(size.width),
                                           height: Double(size.height), tilts: CarTurntableView.pointerTilts)
            }
            .onEnded { _ in
                lastDrag = nil
                resumeLater()
            }
    }

    private func key(_ key: KeyEquivalent) {
        let arrow: Turntable.Arrow
        switch key {
        case .leftArrow: arrow = .left
        case .rightArrow: arrow = .right
        case .upArrow: arrow = .up
        default: arrow = .down
        }
        pause()
        angles = Turntable.keyed(angles, arrow)
        resumeLater()
    }

    // MARK: - the paint

    private func draw(_ context: inout GraphicsContext, size: CGSize, angles: Turntable.Angles) {
        let parts = cache.parts(for: spec)
        guard let frame = Turntable.frame(spec, parts: parts, angles: angles,
                                          width: Double(size.width), height: Double(size.height)) else { return }
        // The platter: a disc the tilt foreshortens like the ground it stands for.
        let disc = frame.disc
        let r = CGFloat(disc.radius)
        var platter = context
        platter.translateBy(x: CGFloat(disc.center.x), y: CGFloat(disc.center.y))
        platter.scaleBy(x: 1, y: CGFloat(disc.squash))
        let ring = Path(ellipseIn: CGRect(x: -r, y: -r, width: 2 * r, height: 2 * r))
        platter.fill(ring, with: .color(Color(cgColor: CSSColor.parse(disc.fill, or: CSSColor.clear))))
        platter.stroke(ring, with: .color(palette.lineStrong), lineWidth: CGFloat(disc.ringWidth))
        // The car, by the drive's own painter.
        context.withCGContext { cg in
            let canvas = PaintCanvas(cg, width: Double(size.width), height: Double(size.height))
            DrivePainter.paintCar(canvas, frame.car)
            canvas.finish()
        }
    }
}

/// The car's parts, built once per model and gear rather than per frame.
private final class TurntableParts {
    private var builtFor: (model: CarModelId, gear: CarGear)?
    private var built: [Mesh3D.Part] = []

    func parts(for spec: CarSpec) -> [Mesh3D.Part] {
        if let key = builtFor, key.model == spec.model, key.gear == spec.gear { return built }
        built = carModel(spec.model).build(spec.gear)
        builtFor = (spec.model, spec.gear)
        return built
    }
}

#Preview("The Prado on its turntable") {
    CarTurntableView(spec: defaultCarSpec())
        .frame(width: 420, height: 300)
        .padding(24)
        .background(Palette.paper.surface)
}

#Preview("Glacier white, gloss, bare") {
    CarTurntableView(spec: CarSpec(model: .pradoJ120, color: "#f2f1ea", finish: .gloss, gear: .bare))
        .frame(width: 320, height: 240)
        .padding(24)
        .background(Palette.paper.surface)
}
