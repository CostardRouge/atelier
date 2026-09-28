// Everything ONE badge piece may depart from the trip's theme on — its
// casing, its ink, a panel behind it (fill, padding, corners, outline) and an
// entrance and an exit — as inspector rows. Port of
// `src/tools/roadtrip/PieceStylePanel.tsx`, its `StepRows` included (the
// badge's cascade draws them too, with no Delay row).
//
// Rules kept (`roadtrip.md`):
// - A piece departs from the theme by writing its own value; the badge's
//   element builder (`badgeElements`) then PINS exactly that key in
//   `styleOverrides`, so everything left alone follows the trip and one
//   preset change still restyles the whole deck. This panel only writes the
//   `BadgePieceStyle`.
// - Casing is a value of the style, applied to the STRING when the badge is
//   built — never the element's `uppercase` flag, which a theme could undo.
// - An optional colour is a switch AND a well: the switch decides whether the
//   colour exists at all ("no panel behind the trip's name" is the default
//   look, not an edge case), the well owns its value. Off writes `null`.
// - The animation half is the engine's own model (`AnimStep`), with no
//   translation layer: a look authored here means the same thing in the
//   Studio's intro titles. The curves are the ONE registry's, the
//   overshooting and the stepped ones said so.

import SwiftUI
import AtelierKit

struct PieceStyleRows: View {
    let style: BadgePieceStyle
    let onChange: (BadgePieceStyle) -> Void

    private typealias P = OverlayPanels

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            caseRow
            PieceOptionalColourRow(label: "Ink", value: flat(style.color), fallback: "#ffffff") { value in
                patch { $0.color = .some(value) }
            }
            PieceOptionalColourRow(label: "Background", value: flat(style.boxColor), fallback: "#d9442a") { value in
                patch { $0.boxColor = .some(value) }
            }
            PieceOptionalColourRow(label: "Border", value: flat(style.borderColor), fallback: "#ffffff") { value in
                patch { $0.borderColor = .some(value) }
            }
            if hasPanel {
                panelRows
            }
            PieceStepRows(which: .entrance, step: animation?.inStep) { step in
                onChange(pieceStyleEntrance(style, step))
            }
            PieceStepRows(which: .exit, step: animation?.outStep) { step in
                onChange(pieceStyleExit(style, step))
            }
        }
    }

    // MARK: - reading

    private var animation: ElementAnimation? { style.animation ?? nil }

    /// A doubly optional colour as the row reads it: absent, null and an empty
    /// string are all "no colour" (the web's `Boolean(value)`).
    private func flat(_ value: String??) -> String? {
        guard let inner = value ?? nil, !inner.isEmpty else { return nil }
        return inner
    }

    private var hasPanel: Bool {
        flat(style.boxColor) != nil || flat(style.borderColor) != nil
    }

    private func patch(_ edit: (inout BadgePieceStyle) -> Void) {
        var next = style
        edit(&next)
        onChange(next)
    }

    // MARK: - the rows

    private var caseRow: some View {
        OverlayPanelRow("Case") {
            Picker("Case", selection: Binding(get: { style.textCase ?? BadgeTextCase.asIs },
                                              set: { next in patch { $0.textCase = next } })) {
                ForEach(PieceStyleRows.cases) { option in
                    Text(verbatim: option.label).tag(option.value)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
        }
    }

    @ViewBuilder
    private var panelRows: some View {
        let pad = style.boxPadFrac ?? 0.3
        let corners = style.boxRadiusFrac ?? 0.5
        DevelopRangeSlider("Padding", value: pad, in: 0.05...1.2, step: 0.05, reset: 0.3,
                           printed: P.percent(pad)) { v in patch { $0.boxPadFrac = v } }
            .accessibilityHint("Panel padding")
        DevelopRangeSlider("Corners", value: corners, in: 0...6, step: 0.1, reset: 0.5,
                           printed: P.fixed(corners, 1)) { v in patch { $0.boxRadiusFrac = v } }
            .accessibilityHint("Panel corners")
        if flat(style.borderColor) != nil {
            let width = style.borderWidthFrac ?? 0.06
            DevelopRangeSlider("Border width", value: width, in: 0.01...0.25, step: 0.005, reset: 0.06,
                               printed: P.percent(width)) { v in patch { $0.borderWidthFrac = v } }
        }
    }

    // MARK: - the words

    private static let cases: [OverlayPanelOption<BadgeTextCase>] = [
        OverlayPanelOption(.asIs, "As-is"),
        OverlayPanelOption(.upper, "UPPER"),
        OverlayPanelOption(.lower, "lower"),
    ]
}

/// One optional colour: a switch, then the well — dimmed while there is no colour.
struct PieceOptionalColourRow: View {
    let label: String
    let value: String?
    let fallback: String
    let onChange: (String?) -> Void

    var body: some View {
        OverlayPanelRow(label) {
            OverlayPanelToggle("Use \(label.lowercased())", isOn: value != nil) { on in
                onChange(on ? fallback : nil)
            }
            OverlayPanelColourWell(label, css: value ?? fallback) { hex in
                onChange(hex)
            }
            .disabled(value == nil)
            .opacity(value == nil ? 0.4 : 1)
        }
    }
}

// MARK: - one animation step

/// Which end of a piece's life a step is.
enum PieceStepEnd {
    case entrance, exit

    var word: String { self == .entrance ? "Entrance" : "Exit" }
    /// The web's `which`, in the accessible names.
    var short: String { self == .entrance ? "In" : "Out" }
}

/// One animation step as inspector rows — the preset, its length, its wait
/// (an entrance's, unless hidden), its curve and its steps, its direction.
/// The web's `StepRows`.
struct PieceStepRows: View {
    let which: PieceStepEnd
    let step: AnimStep?
    var hideDelay = false
    let onChange: (AnimStep?) -> Void

    private typealias P = OverlayPanels
    private typealias Option = OverlayPanelOption

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            OverlayPanelPicker(which.word, selection: step?.preset ?? AnimPreset.none, options: PieceStepRows.presets) { preset in
                onChange(pieceStepWithPreset(step, preset))
            }
            if let step {
                knobs(step)
            }
        }
    }

    @ViewBuilder
    private func knobs(_ step: AnimStep) -> some View {
        DevelopRangeSlider("Duration", value: step.duration, in: 0...2, step: 0.05, reset: 0.5,
                           printed: "\(P.fixed(step.duration, 2)) s") { v in
            var next = step
            next.duration = v
            onChange(next)
        }
        .accessibilityHint("\(which.short) duration")
        if which == .entrance && !hideDelay {
            let delay = step.delay ?? 0
            DevelopRangeSlider("Delay", value: delay, in: 0...2, step: 0.05, reset: 0,
                               printed: "\(P.fixed(delay, 2)) s") { v in
                var next = step
                next.delay = v
                onChange(next)
            }
            .accessibilityHint("In delay")
        }
        OverlayPanelPicker("Easing", selection: step.easing, options: PieceStepRows.easings) { easing in
            var next = step
            next.easing = easing
            onChange(next)
        }
        if step.easing == .steps {
            let count = step.steps ?? Double(defaultSteps)
            DevelopRangeSlider("Steps", value: count, in: Double(minSteps)...Double(maxSteps), step: 1,
                               reset: Double(defaultSteps), printed: DevelopNumbers.plain(count)) { v in
                var next = step
                next.steps = v
                onChange(next)
            }
            .accessibilityHint("\(which.short) steps")
        }
        if step.preset == .slide {
            OverlayPanelPicker("From", selection: step.direction ?? .up, options: PieceStepRows.directions) { direction in
                var next = step
                next.direction = direction
                onChange(next)
            }
        }
    }

    // MARK: - the menus' words

    /// The web's `PRESETS` — the badge's own words, shorter than the Studio's.
    private static let presets: [Option<AnimPreset>] = [
        Option(AnimPreset.none, "None"),
        Option(.fade, "Fade"),
        Option(.slide, "Slide"),
        Option(.scale, "Scale"),
        Option(.typewriter, "Typewriter"),
        Option(.wipe, "Wipe"),
    ]

    /// Every curve of the shared registry, by its own name. The web's `EASINGS`.
    private static let easings: [Option<EasingId>] = easingIds.map { Option($0, OverlayPanels.easingLabel($0)) }

    private static let directions: [Option<AnimDirection>] = AnimDirection.allCases.map { Option($0, $0.rawValue) }
}

// MARK: - previews

#Preview("This piece — a panel and an entrance") {
    DevelopPreviewState(BadgePieceStyle(
        textCase: .upper, boxColor: .some("#d9442a"), borderColor: .some("#ffffff"),
        animation: .some(ElementAnimation(in: .some(AnimStep(preset: .slide, duration: 0.5, easing: .steps, direction: .up))))
    )) { style in
        PieceStyleRows(style: style.wrappedValue) { style.wrappedValue = $0 }
    }
}

#Preview("This piece — following the trip") {
    DevelopPreviewState(BadgePieceStyle()) { style in
        PieceStyleRows(style: style.wrappedValue) { style.wrappedValue = $0 }
    }
}
