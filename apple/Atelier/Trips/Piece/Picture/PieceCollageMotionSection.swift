// How a collage's cells arrive and leave — the web's
// `src/tools/roadtrip/panels/CollageMotionSection.tsx` (`roadtrip.md`, «M5 —
// a collage's cells arrive and leave»): one entrance shared by every cell,
// spread by an order (centre out, rows, the big one first…), and an exit laid
// against the slide's screen time. Any of it makes the slide a video; none of
// it leaves it a still.
//
// Rules kept:
// - an entrance carries no delay (the stagger spreads the cells), so its rows
//   hide the web's Delay (`hideDelay`);
// - `Inside` is offered only for a slide or a scale — it moves the picture
//   behind its cell rather than the cell;
// - a random order draws its seed ONCE and keeps it, so the export shuffles as
//   the preview did; "Shuffle again" draws another;
// - "The cells leave" mirrors the entrance when there is one.

import SwiftUI
import AtelierKit

struct PieceCollageMotionSection: View {
    let collage: SlideCollage
    /// The slide's screen time — what the exit is laid against.
    let seconds: Double
    let onChange: (SlideCollage) -> Void

    private var info: [String] {
        [
            "One entrance shared by every cell, the cells arriving one rank after another in the order chosen — from the centre, row by row, the biggest first, shuffled once with a seed that is kept. Inside moves the picture behind its cell rather than the cell itself, so the grid stays still while the pictures arrive in it.",
            "An exit is laid against the slide’s \(String(format: "%.1f", seconds)) s on screen; the cells leave in reverse or in arrival order. A collage that moves is delivered as a video; a still of it is taken once the last cell has landed.",
        ]
    }

    /// A step cleared to nothing — the web's `{ preset: 'none', duration: 0, easing: 'linear' }`.
    private static let noStep = AnimStep(preset: AnimPreset.none, duration: 0, easing: .linear)

    var body: some View {
        let moves = collage.enter != nil || collage.exit != nil
        DevelopSection(id: "piece.collage-motion", title: "Motion", badge: moves ? "video" : nil, info: info,
                       remember: .local) {
            OverlayPanelRow("Arrive") {
                OverlayPanelToggle("The cells arrive", isOn: collage.enter != nil, words: "The cells arrive") { on in
                    write { $0.enter = on ? defaultCollageEnter() : nil }
                }
            }
            if let enter = collage.enter {
                enterRows(enter)
            }
            leaveRow
            if let exit = collage.exit {
                exitRows(exit)
            }
        }
    }

    // MARK: - arriving

    @ViewBuilder
    private func enterRows(_ enter: CollageEnter) -> some View {
        PieceCollageStepRows(which: .entrance, step: enter.step) { step in
            write { $0.enter?.step = step ?? PieceCollageMotionSection.noStep }
        }
        if enter.step.preset == .slide || enter.step.preset == .scale {
            OverlayPanelRow("Inside") {
                OverlayPanelToggle("Move the picture inside its cell", isOn: enter.step.inside == true,
                                   words: "Move the picture inside its cell") { inside in
                    write { $0.enter?.step.inside = inside }
                }
            }
        }
        OverlayPanelPicker("Order", selection: enter.stagger.order, options: PieceCollageMotionSection.orderOptions) { order in
            write { collage in
                collage.enter?.stagger.order = order
                if order == .random && collage.enter?.stagger.seed == nil {
                    collage.enter?.stagger.seed = newStaggerSeed()
                }
            }
        }
        DevelopRangeSlider("Each", value: enter.stagger.each, in: 0...0.6, step: 0.01, reset: Stagger.default.each,
                           printed: String(format: "%.2f s", enter.stagger.each)) { each in
            write { $0.enter?.stagger.each = each }
        }
        .accessibilityHint("Seconds between two ranks")
        if enter.stagger.order == .random {
            OverlayPanelRow("Shuffle") {
                Button("Shuffle again") {
                    write { $0.enter?.stagger.seed = newStaggerSeed() }
                }
                .buttonStyle(DevelopPillButtonStyle())
            }
        }
    }

    // MARK: - leaving

    private var leaveRow: some View {
        OverlayPanelRow("Leave") {
            OverlayPanelToggle("The cells leave", isOn: collage.exit != nil, words: "The cells leave") { on in
                write { collage in
                    if on {
                        collage.exit = collage.enter.map(mirroredExit) ?? defaultCollageExit()
                    } else {
                        collage.exit = nil
                    }
                }
            }
            if collage.exit != nil, let enter = collage.enter {
                Button("Mirror the entrance") {
                    write { $0.exit = mirroredExit(enter) }
                }
                .buttonStyle(DevelopLinkButtonStyle())
            }
        }
    }

    @ViewBuilder
    private func exitRows(_ exit: CollageExit) -> some View {
        PieceCollageStepRows(which: .exit, step: exit.step) { step in
            write { $0.exit?.step = step ?? PieceCollageMotionSection.noStep }
        }
        OverlayPanelRow("Order") {
            OverlayPanelToggle("Leave in reverse order", isOn: exit.reverse, words: "Leave in reverse order") { reverse in
                write { $0.exit?.reverse = reverse }
            }
        }
    }

    private func write(_ change: (inout SlideCollage) -> Void) {
        var next = collage
        change(&next)
        onChange(next)
    }

    /// `Centre out — From the middle of the frame outwards`, the web's words.
    private static let orderOptions: [OverlayPanelOption<StaggerOrder>] =
        staggerOrders.map { OverlayPanelOption($0.id, "\($0.label) — \($0.hint)") }
}

/// One step's rows — the web's `StepRows` (`PieceStylePanel.tsx`) as the
/// collage uses it: the preset, and when there is a step its duration, curve,
/// steps and a slide's direction. An entrance's delay is not offered here.
private struct PieceCollageStepRows: View {
    enum Which { case entrance, exit }

    let which: Which
    let step: AnimStep?
    let onChange: (AnimStep?) -> Void

    private static let presets: [OverlayPanelOption<AnimPreset>] = [
        OverlayPanelOption(AnimPreset.none, "None"),
        OverlayPanelOption(.fade, "Fade"),
        OverlayPanelOption(.slide, "Slide"),
        OverlayPanelOption(.scale, "Scale"),
        OverlayPanelOption(.typewriter, "Typewriter"),
        OverlayPanelOption(.wipe, "Wipe"),
    ]

    private static let easings: [OverlayPanelOption<EasingId>] =
        easingIds.map { OverlayPanelOption($0, OverlayPanels.easingLabel($0)) }

    private static let directions: [OverlayPanelOption<AnimDirection>] =
        AnimDirection.allCases.map { OverlayPanelOption($0, $0.rawValue) }

    private var word: String { which == .entrance ? "In" : "Out" }

    var body: some View {
        let preset: AnimPreset = step?.preset ?? AnimPreset.none
        OverlayPanelPicker(which == .entrance ? "Entrance" : "Exit", selection: preset, options: Self.presets) { next in
            if next == AnimPreset.none {
                onChange(nil)
            } else {
                var out = step ?? defaultStep(next)
                out.preset = next
                onChange(out)
            }
        }
        if let step {
            rows(step)
        }
    }

    @ViewBuilder
    private func rows(_ step: AnimStep) -> some View {
        DevelopRangeSlider("Duration", value: step.duration, in: 0...2, step: 0.05, reset: 0.5,
                           printed: String(format: "%.2f s", step.duration)) { v in
            var next = step
            next.duration = v
            onChange(next)
        }
        .accessibilityHint("\(word) duration")
        OverlayPanelPicker("Easing", selection: step.easing, options: Self.easings) { easing in
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
            .accessibilityHint("\(word) steps")
        }
        if step.preset == .slide {
            OverlayPanelPicker("From", selection: step.direction ?? .up, options: Self.directions) { direction in
                var next = step
                next.direction = direction
                onChange(next)
            }
        }
    }
}

#Preview("Collage motion") {
    let start = createCollage("grid-2x2") ?? SlideCollage(template: "grid-2x2")
    return DevelopPreviewState(start) { collage in
        PieceCollageMotionSection(collage: collage.wrappedValue, seconds: 3) { collage.wrappedValue = $0 }
    }
}
