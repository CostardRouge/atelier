// Colour grading — Lightroom's wheels. Port of
// `src/shared/develop/DevelopGrading.tsx`: shadows, midtones and highlights
// side by side (they are set against each other), then the global wheel
// beside Blending and Balance.
//
// A wheel is the hue circle — red at the right, turning clockwise, the very
// convention the kernel's `wheelPoint` reads — under a grey that fades out
// toward the rim, so the centre is "no colour". A drag in it sets the hue
// (the angle) and the strength (the distance from the centre); a double-tap
// clears its colour and keeps its hue; the arrows turn it (←/→) and
// strengthen it (↑/↓), Shift for ten; the Light slider under it moves the
// light, which a wheel never does. Fixed colours on purpose: a colour wheel
// is its colours in every theme.
//
// Blending and Balance with no wheel moved shape nothing, and the kernel's
// record does not keep them (`DevelopSettings.grading`, "a panel holds such a
// draft itself") — so this section keeps them as a DRAFT until a wheel
// moves, as the web's in-memory draft does. The shell gives the section a
// fresh identity per picture (`.id(picture.id)`) so a draft never crosses
// from one picture to the next.

import SwiftUI
import AtelierKit

struct DevelopGradingSection: View {
    @Binding var settings: DevelopSettings
    /// Blending / Balance moved while no wheel is, which the record drops.
    @State private var draft: ColourGrading?
    /// The first row's width, which the second row's wheel matches.
    @State private var rowWidth: CGFloat = 0

    init(settings: Binding<DevelopSettings>) {
        self._settings = settings
    }

    /// What is shown and edited: the stored grading, else the draft, else neutral.
    private var grading: ColourGrading {
        settings.grading ?? draft ?? neutralGrading()
    }

    private func write(_ next: ColourGrading?) {
        // Only a SHAPE with no wheel is held here — anything the record keeps
        // is read back from it, so an undo that takes a wheel away is seen.
        draft = next.flatMap { isDefaultGrading($0) ? $0 : nil }
        settings.grading = next
    }

    var body: some View {
        let g = grading
        let touched = !isDefaultGrading(settings.grading) || g.blending != 50 || g.balance != 0
        DevelopSection(id: "grading", title: "Colour grading", info: [Self.hint],
                       marked: !isDefaultGrading(settings.grading), defaultOpen: false) {
            HStack(alignment: .top, spacing: 12) {
                wheel(.shadows, g).frame(maxWidth: .infinity)
                wheel(.midtones, g).frame(maxWidth: .infinity)
                wheel(.highlights, g).frame(maxWidth: .infinity)
            }
            .background(
                GeometryReader { proxy in
                    Color.clear
                        .onAppear { rowWidth = proxy.size.width }
                        .onChange(of: proxy.size.width) { _, width in rowWidth = width }
                }
            )
            HStack(alignment: .top, spacing: 12) {
                wheel(.global, g)
                    .frame(width: rowWidth > 0 ? Swift.max(0, (rowWidth - 24) / 3) : nil)
                    .frame(maxWidth: rowWidth > 0 ? nil : .infinity)
                VStack(alignment: .leading, spacing: 8) {
                    DevelopRangeSlider("Blending", value: g.blending, in: 0...100, step: 1, reset: 50,
                                       printed: DevelopNumbers.plain(g.blending)) { v in
                        write(withShape(grading, .blending, v))
                    }
                    DevelopRangeSlider("Balance", value: g.balance, in: -100...100, step: 1) { v in
                        write(withShape(grading, .balance, v))
                    }
                }
                .padding(.top, 20)
                .frame(maxWidth: .infinity)
            }
            if touched {
                Button("Reset grading") { write(nil) }
                    .buttonStyle(DevelopLinkButtonStyle())
            }
        }
        .onChange(of: settings.grading) { _, stored in
            // The record now carries the shape itself.
            if stored != nil { draft = nil }
        }
    }

    private func wheel(_ zone: GradeZone, _ g: ColourGrading) -> some View {
        GradeWheelControl(zone: zone, value: g[zone]) { next in
            // From what is SHOWN, so a Blending moved first is kept once a wheel moves.
            write(withWheel(grading, zone, next))
        }
    }

    private static let hint = "A colour and a light for the shadows, the midtones and the highlights, and one for the whole picture. Drag in a wheel: the angle is the hue, the distance from the centre how strongly it tints; a wheel colours without brightening, and the slider under it moves the light. Balance says where the shadows end and the highlights begin; Blending how far each range reaches into the next. Double-click a wheel to clear its colour."
}

/// One wheel: its name, the hue circle with its puck, what it holds in
/// words, and its Light slider.
private struct GradeWheelControl: View {
    let zone: GradeZone
    let value: GradeWheel
    let onChange: (GradeWheel) -> Void

    @State private var lastTap: Date?
    @Environment(\.palette) private var palette

    /// The hues around the rim, `hsl(h 85% 55%)` every sixty degrees — the web's conic sweep.
    private static let rim: [Color] = [0.0, 60, 120, 180, 240, 300, 360].map { Color.developHSL($0, 0.85, 0.55) }
    /// "No colour" at the centre — the web's `rgb(128 128 128)`.
    private static let neutral = Color(.sRGB, red: 128.0 / 255, green: 128.0 / 255, blue: 128.0 / 255, opacity: 1)

    private var coloured: Bool { value.saturation > 0 }

    var body: some View {
        VStack(spacing: 4) {
            Text(zone.label)
                .font(Brand.sans(12, weight: coloured || value.luminance != 0 ? .semibold : .regular))
                .foregroundStyle(palette.ink)
                .lineLimit(1)
                .frame(maxWidth: .infinity)
            circle
            Text(coloured ? "\(DevelopNumbers.plain(value.hue))° · \(DevelopNumbers.plain(value.saturation))" : "—")
                .font(Brand.mono(9))
                .monospacedDigit()
                .foregroundStyle(palette.faint)
                .frame(maxWidth: .infinity)
            DevelopRangeSlider("Light", value: value.luminance, in: -100...100, step: 1) { v in
                var next = value
                next.luminance = v
                onChange(next)
            }
        }
    }

    private var circle: some View {
        ZStack {
            // Red at the right, turning clockwise on screen — SwiftUI's angles
            // run clockwise, as `wheelPoint`'s do.
            Circle()
                .fill(AngularGradient(gradient: Gradient(colors: Self.rim), center: .center,
                                      startAngle: .degrees(0), endAngle: .degrees(360)))
            Circle().stroke(palette.line, lineWidth: 1)
        }
        .aspectRatio(1, contentMode: .fit)
        .overlay(
            GeometryReader { geo in
                let side = Swift.min(geo.size.width, geo.size.height)
                let r = side / 2
                let puck = pointOnWheel(value.hue, value.saturation)
                ZStack {
                    // The grey that makes the centre "no colour", fading to the rim.
                    Circle()
                        .fill(RadialGradient(gradient: Gradient(colors: [Self.neutral, Self.neutral.opacity(0)]),
                                             center: .center, startRadius: 0, endRadius: r))
                        .frame(width: side, height: side)
                        .position(x: geo.size.width / 2, y: geo.size.height / 2)
                    Circle()
                        .fill(puckColour)
                        .frame(width: 12, height: 12)
                        .overlay(Circle().stroke(palette.onMedia, lineWidth: 2))
                        .shadow(color: palette.frame.opacity(0.5), radius: 1.5)
                        .position(x: geo.size.width / 2 + CGFloat(puck.x) * r,
                                  y: geo.size.height / 2 + CGFloat(puck.y) * r)
                }
                .contentShape(Circle())
                .gesture(drag(radius: r, centre: CGPoint(x: geo.size.width / 2, y: geo.size.height / 2)))
            }
        )
        .focusable()
        .onKeyPress(keys: [.leftArrow, .rightArrow, .upArrow, .downArrow]) { press in
            let step: Double = press.modifiers.contains(.shift) ? 10 : 1
            var next = value
            if press.key == .rightArrow {
                next.hue = (value.hue + step + 360).truncatingRemainder(dividingBy: 360)
            } else if press.key == .leftArrow {
                next.hue = (value.hue - step + 360).truncatingRemainder(dividingBy: 360)
            } else if press.key == .upArrow {
                next.saturation = Swift.min(100, value.saturation + step)
            } else {
                next.saturation = Swift.max(0, value.saturation - step)
            }
            onChange(next)
            return .handled
        }
        .accessibilityElement()
        .accessibilityLabel("\(zone.label) colour")
        .accessibilityValue(coloured ? "hue \(Int(value.hue)) degrees, strength \(Int(value.saturation))" : "no colour")
        .accessibilityAdjustableAction { direction in
            var next = value
            switch direction {
            case .increment: next.saturation = Swift.min(100, value.saturation + 5)
            case .decrement: next.saturation = Swift.max(0, value.saturation - 5)
            @unknown default: return
            }
            onChange(next)
        }
        .help("\(zone.label) — drag for a colour; arrows turn it (←/→) and strengthen it (↑/↓)")
    }

    private var puckColour: Color {
        coloured ? .developHSL(value.hue, 0.85, 0.55 + (1 - value.saturation / 100) * 0.2) : Self.neutral
    }

    private func drag(radius r: CGFloat, centre: CGPoint) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { g in
                guard r > 0 else { return }
                let x = Double((g.location.x - centre.x) / r)
                let y = Double((g.location.y - centre.y) / r)
                let picked = wheelPoint(x, y)
                var next = value
                next.hue = picked.hue
                next.saturation = picked.saturation
                onChange(next)
            }
            .onEnded { g in
                let moved = hypot(g.translation.width, g.translation.height) > 3
                if !moved, let last = lastTap, Date().timeIntervalSince(last) < 0.35 {
                    // A double-tap clears the colour and keeps the hue, so it is found again.
                    var next = value
                    next.saturation = 0
                    onChange(next)
                    lastTap = nil
                } else {
                    lastTap = moved ? nil : Date()
                }
            }
    }
}

#Preview("Colour grading") {
    DevelopPreviewState(DevelopPanelFixtures.develop) { settings in
        DevelopGradingSection(settings: settings)
    }
}
