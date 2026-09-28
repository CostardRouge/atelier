// The small pieces every Adjust section draws with — the one slider row
// (`RangeSlider`, `src/shared/develop/DevelopSliders.tsx`), the ⓘ that folds
// a section's prose (`src/shared/ui/InfoDot.tsx`), the workbench's button and
// link (`developButtonClass` / `developLinkClass`, kept verbatim in the
// kernel's `Develop/DevelopClasses.swift`), and the haptic of a value landing
// back on its default.
//
// ONE slider, for anything with a name, a range and a value it goes back to:
// a second copy is how two panels come to disagree about what a slider looks
// like. The reset rule is the maintainer's (`develop.md`, 2026-09-20): a
// changed field wears an accent dot ahead of its label and the label in bold,
// and a small ↺ stays visible but dimmed at rest — never hover-only, a phone
// has no hover — turning accent once the value departs. A double-tap on the
// row's label line puts it back too, for whoever already reaches for it.

import SwiftUI
import AtelierKit

// MARK: - the slider row

struct DevelopRangeSlider: View {
    let label: String
    let value: Double
    let range: ClosedRange<Double>
    let step: Double
    /// Where a reset puts it — 0 for a develop's fields, 1 for a gamma, 50 for Blending.
    let reset: Double
    /// The value as words; the signed form (`+40`, `−12`) when nil.
    let printed: String?
    /// A colour the row is ABOUT — a mixer band's hue — drawn as a chip before the name.
    let swatch: Color?
    let onChange: (Double) -> Void

    /// Counts the times the HAND put the value back on its default — never a
    /// change of picture, which would buzz for every slider at once.
    @State private var snaps = 0
    @Environment(\.palette) private var palette

    init(_ label: String, value: Double, in range: ClosedRange<Double>, step: Double, reset: Double = 0,
         printed: String? = nil, swatch: Color? = nil, onChange: @escaping (Double) -> Void) {
        self.label = label
        self.value = value
        self.range = range
        self.step = step
        self.reset = reset
        self.printed = printed
        self.swatch = swatch
        self.onChange = onChange
    }

    private var changed: Bool { value != reset }
    private var shown: String { printed ?? signed(value) }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            header
            Slider(
                value: Binding(get: { value }, set: { next in write(next) }),
                in: range,
                step: step
            )
            .tint(palette.accent)
            .accessibilityLabel(label)
            .accessibilityValue(shown)
            // Shift with an arrow steps ten at a time — the web's own key.
            .onKeyPress(keys: [.leftArrow, .rightArrow, .upArrow, .downArrow]) { press in
                guard press.modifiers.contains(.shift) else { return .ignored }
                let up = press.key == .rightArrow || press.key == .upArrow
                let next = value + (up ? 1 : -1) * step * 10
                write(Swift.min(range.upperBound, Swift.max(range.lowerBound, next)))
                return .handled
            }
        }
        // A click under the hand when the value lands back on its default —
        // by a drag passing through it, the ↺ or the double-tap.
        .sensoryFeedback(DevelopHaptics.snap, trigger: snaps)
    }

    /// Every write the row makes goes through here, so a landing on the
    /// default is felt.
    private func write(_ raw: Double) {
        let next = Self.quantise(raw, step)
        if next == reset && value != reset { snaps += 1 }
        onChange(next)
    }

    /// A value on the step's own decimals — `0.35`, never `0.35000000000000003`
    /// — which is the number the web's range input writes, so a document
    /// diffs cleanly and an exposure dragged back to zero IS zero.
    private static func quantise(_ value: Double, _ step: Double) -> Double {
        guard value.isFinite, step > 0 else { return value }
        let decimals = Swift.max(0, Int((-log10(step)).rounded(.up)))
        let scale = pow(10, Double(decimals))
        let q = (value * scale).rounded() / scale
        return q == 0 ? 0 : q
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            // Ahead of the label rather than on it: it must read in the same
            // glance as the row above and below.
            Circle()
                .fill(palette.accent)
                .frame(width: 6, height: 6)
                .opacity(changed ? 1 : 0)
                .accessibilityHidden(true)
            if let swatch {
                Circle()
                    .fill(swatch)
                    .overlay(Circle().stroke(palette.line, lineWidth: 1))
                    .frame(width: 10, height: 10)
                    .accessibilityHidden(true)
            }
            Text(label)
                .font(Brand.sans(12, weight: changed ? .semibold : .regular))
                .foregroundStyle(palette.ink)
                .lineLimit(1)
            Spacer(minLength: 8)
            Text(shown)
                .font(Brand.mono(11))
                .monospacedDigit()
                .foregroundStyle(changed ? palette.inkSoft : palette.faint)
                .lineLimit(1)
            Button {
                write(reset)
            } label: {
                Image(systemName: "arrow.counterclockwise")
                    .font(Brand.sans(10, weight: .semibold))
                    .frame(width: 14, height: 14)
                    .contentShape(Rectangle().inset(by: -8))
            }
            .buttonStyle(.plain)
            .foregroundStyle(changed ? palette.accentInk : palette.inkSoft)
            .opacity(changed ? 1 : 0.3)
            .accessibilityLabel("Reset \(label)")
            .help("Reset")
        }
        .contentShape(Rectangle())
        .onTapGesture(count: 2) { write(reset) }
    }
}

// MARK: - the ⓘ

/// The dot that folds a standing explanation away until it is asked for. The
/// note itself is drawn by the caller (`DevelopNote`), under the header.
struct DevelopInfoDot: View {
    let about: String
    @Binding var isOpen: Bool
    @Environment(\.palette) private var palette

    var body: some View {
        Button {
            withAnimation(.easeOut(duration: 0.15)) { isOpen.toggle() }
        } label: {
            Text(verbatim: "i")
                .font(Brand.display(12))
                .foregroundStyle(isOpen ? palette.accentInk : palette.muted)
                .frame(width: 16, height: 16)
                .background(Circle().fill(isOpen ? palette.accentWash : Color.clear))
                .overlay(Circle().stroke(isOpen ? palette.accent : palette.lineStrong, lineWidth: 1))
                // A 16pt ring sits on the cap height of a title; the touch
                // target around it is 32pt, what a thumb needs.
                .contentShape(Circle().inset(by: -8))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("About \(about)")
        .accessibilityAddTraits(isOpen ? .isSelected : [])
        .help(isOpen ? "Hide the note" : "What is this?")
    }
}

/// The note an ⓘ unfolds: the section's standing prose, one paragraph per entry.
struct DevelopNote: View {
    let paragraphs: [String]
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(paragraphs.enumerated()), id: \.offset) { _, paragraph in
                Text(verbatim: paragraph)
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.muted)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - the workbench's button and link

/// `developButtonClass`: a rounded pill, the strong line, the paper under it;
/// `on` is the pressed state the eyedropper wears while armed.
struct DevelopPillButtonStyle: ButtonStyle {
    var on = false

    func makeBody(configuration: Configuration) -> some View {
        PillBody(configuration: configuration, on: on)
    }

    private struct PillBody: View {
        let configuration: ButtonStyleConfiguration
        let on: Bool
        @Environment(\.palette) private var palette
        @Environment(\.isEnabled) private var isEnabled

        var body: some View {
            let lit = on || configuration.isPressed
            configuration.label
                .font(Brand.sans(12, weight: .semibold))
                .foregroundStyle(lit ? palette.accentInk : palette.inkSoft)
                .lineLimit(1)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(Capsule().fill(palette.paper))
                .overlay(Capsule().stroke(lit ? palette.accent : palette.lineStrong, lineWidth: 1))
                .opacity(isEnabled ? 1 : 0.5)
                .contentShape(Capsule())
        }
    }
}

/// `developLinkClass`: small muted words, underlined — a verb that is not
/// worth a pill (Reset all, Show the mask). `active` is its pressed state.
struct DevelopLinkButtonStyle: ButtonStyle {
    var active = false

    func makeBody(configuration: Configuration) -> some View {
        LinkBody(configuration: configuration, active: active)
    }

    private struct LinkBody: View {
        let configuration: ButtonStyleConfiguration
        let active: Bool
        @Environment(\.palette) private var palette
        @Environment(\.isEnabled) private var isEnabled

        var body: some View {
            configuration.label
                .font(Brand.sans(12))
                .underline(isEnabled)
                .foregroundStyle(active || configuration.isPressed ? palette.accentInk : palette.muted)
                .opacity(isEnabled ? 1 : 0.5)
                .lineLimit(1)
                .contentShape(Rectangle())
        }
    }
}

// MARK: - haptics, colours

enum DevelopHaptics {
    /// A value landing on its default. The Mac's trackpad plays an alignment,
    /// the phone a light tap.
    static var snap: SensoryFeedback {
        #if os(macOS)
        return .alignment
        #else
        return .impact(weight: .light)
        #endif
    }
}

extension Color {
    /// CSS `hsl(h s% l%)`, exactly — the web draws a mixer band's swatch and
    /// the grading wheel's hues in HSL, and SwiftUI's own `hue:` initialiser
    /// is HSB, a different colour for the same three numbers.
    static func developHSL(_ hue: Double, _ saturation: Double, _ lightness: Double) -> Color {
        let h = ((hue.truncatingRemainder(dividingBy: 360)) + 360).truncatingRemainder(dividingBy: 360) / 60
        let c = (1 - abs(2 * lightness - 1)) * saturation
        let x = c * (1 - abs(h.truncatingRemainder(dividingBy: 2) - 1))
        let m = lightness - c / 2
        let rgb: (Double, Double, Double)
        switch Int(h) {
        case 0: rgb = (c, x, 0)
        case 1: rgb = (x, c, 0)
        case 2: rgb = (0, c, x)
        case 3: rgb = (0, x, c)
        case 4: rgb = (x, 0, c)
        default: rgb = (c, 0, x)
        }
        return Color(.sRGB, red: rgb.0 + m, green: rgb.1 + m, blue: rgb.2 + m, opacity: 1)
    }
}

extension Palette {
    /// The web's `--color-info` (`src/index.css`), which `Palette` does not
    /// carry yet: what the histogram's black end and a crushed-to-black
    /// readout are written in.
    var developInfo: Color {
        isDarkroom ? Color(hex: 0x8FB4D6) : Color(light: 0x3F5A72, dark: 0x8FB4D6)
    }
}

// MARK: - numbers as the web prints them

enum DevelopNumbers {
    /// JavaScript's `Math.round`: the nearest integer, a half rounding toward +∞.
    static func jsRound(_ x: Double) -> Double {
        guard x.isFinite else { return x }
        return (x + 0.5).rounded(.down)
    }

    /// JavaScript's `${n}` for a whole or a short number: `50`, `1.5`, never `50.0`.
    static func plain(_ n: Double) -> String {
        if n.isFinite, n == n.rounded(), abs(n) < 1e15 { return String(Int64(n)) }
        return String(n)
    }
}

// MARK: - previews

#Preview("Slider rows") {
    DevelopPreviewState(0.35) { value in
        DevelopRangeSlider("Exposure", value: value.wrappedValue, in: -3...3, step: 0.05,
                           printed: "\(signed(value.wrappedValue, digits: 2)) EV") { value.wrappedValue = $0 }
        DevelopRangeSlider("Blue", value: -35, in: -100...100, step: 1,
                           swatch: .developHSL(225, 0.75, 0.52)) { _ in }
        DevelopRangeSlider("Contrast", value: 0, in: -100...100, step: 1) { _ in }
        HStack {
            Button("Auto tone") {}.buttonStyle(DevelopPillButtonStyle())
            Button("Pick…") {}.buttonStyle(DevelopPillButtonStyle(on: true))
            Button("Reset all") {}.buttonStyle(DevelopLinkButtonStyle())
        }
    }
}
