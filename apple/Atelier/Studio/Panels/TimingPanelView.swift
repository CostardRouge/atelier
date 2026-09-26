// When the selected element is on screen, and how it arrives and leaves —
// port of `src/shared/overlay/TimingPanel.tsx`.
//
// A panel of its own rather than another branch of the element panel:
// timing applies to EVERY kind (a title, a heading tape, an altitude
// readout). The window is "appears at / disappears at", typed, each with a
// Playhead button that drops the playhead in — read in the scene's own clock
// inside a scene, whose times are offsets into it. The two ends never cross
// (an unreachable element reads as "my title vanished"). An entrance and an
// exit are each a preset (Cut · Fade · Slide · Scale · Typewriter · Wipe),
// a duration, a curve from the ONE easing registry (`Motion/Easing.swift`,
// the overshooting curves said so), and the preset's own knobs; switching one
// on starts from a usable step, never the zero-length Cut. An entrance may
// WAIT; an exit is laid against the window's end and so needs one — said
// under the controls when there is none.

import SwiftUI
import AtelierKit

struct TimingPanelView: View {
    @Binding private var element: OverlayElement
    private let scene: OverlayScene?
    private let playhead: Double
    @Environment(\.palette) private var palette

    private typealias P = OverlayPanels
    private typealias Option = OverlayPanelOption

    /// - Parameters:
    ///   - element: the selected element, written through on every change.
    ///   - scene: the scene it belongs to, if any — its window is relative to it.
    ///   - playhead: seconds from the first exported frame.
    init(element: Binding<OverlayElement>, scene: OverlayScene?, playhead: Double) {
        _element = element
        self.scene = scene
        self.playhead = playhead
    }

    /// The playhead in the window's own clock.
    private var local: Double { P.timingLocal(playhead, scene: scene) }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            clockSentence
            if scene != nil {
                OverlayPanelRow("Scene") {
                    Button("Take it out") {
                        var next = element
                        next.sceneId = nil
                        element = next
                    }
                    .buttonStyle(DevelopLinkButtonStyle())
                }
            }
            windowRows
            steps
        }
    }

    // MARK: - the window

    private var clockSentence: some View {
        let sentence: Text
        if let scene {
            sentence = Text("In ")
                + Text(verbatim: scene.name).bold().foregroundColor(palette.ink)
                + Text(verbatim: " — times count from the scene's start (\(P.fixed(scene.start, 1)) s), and it leaves with the scene at \(P.fixed(scene.end, 1)) s at the latest.")
        } else {
            sentence = Text("Times count from the clip's in point — the first frame an export keeps.")
        }
        return OverlayPanelNote(text: sentence)
    }

    @ViewBuilder
    private var windowRows: some View {
        let timed = element.window != nil
        OverlayPanelRow("Window") {
            OverlayPanelToggle("Give it a window", isOn: timed, words: timed ? "Timed" : "The whole clip") { on in
                var next = element
                next.window = P.timingWindowToggled(on, inScene: scene != nil)
                element = next
            }
        }
        if let window = element.window {
            OverlayPanelRow("Appears") {
                OverlayPanelNumberField("Appears", value: window.start, step: 0.1, range: 0...86_400, unit: "s") { v in
                    setWindow(start: max(0, v))
                }
                playheadButton { setWindow(start: P.hundredths(local)) }
            }
            OverlayPanelRow("Disappears") {
                OverlayPanelNumberField("Disappears", value: window.end, step: 0.1, range: 0...86_400, unit: "s",
                                        placeholder: scene != nil ? "with the scene" : "end of clip",
                                        onClear: { setWindow(end: .some(nil)) }) { v in
                    setWindow(end: .some(v))
                }
                playheadButton { setWindow(end: .some(P.hundredths(local))) }
            }
        }
    }

    private func playheadButton(_ action: @escaping () -> Void) -> some View {
        Button("Playhead", action: action)
            .buttonStyle(DevelopLinkButtonStyle())
            .help("Drop the playhead here")
    }

    private func setWindow(start: Double? = nil, end: Double?? = .none) {
        var next = element
        next.window = P.timingWindow(element.window, start: start, end: end)
        element = next
    }

    // MARK: - the entrance and the exit

    @ViewBuilder
    private var steps: some View {
        let entrance = element.animation?.inStep
        stepControls(.entrance, entrance)
        if let entrance {
            DevelopRangeSlider("Wait", value: entrance.delay ?? 0, in: 0...5, step: 0.05, reset: 0,
                               printed: "\(P.fixed(entrance.delay ?? 0, 2)) s") { v in
                var next = entrance
                next.delay = v
                setStep(.entrance, next)
            }
            .accessibilityHint("Wait before it starts")
        }
        stepControls(.exit, element.animation?.outStep)
        if P.timingExitNeedsEnd(element, scene: scene) {
            OverlayPanelNote("An exit needs an end to play against — give the element a window above.")
        }
    }

    private func setStep(_ phase: P.TimingPhase, _ step: AnimStep?) {
        element = P.withTimingStep(element, phase, step)
    }

    /// The step's controls over `current` (the "Cut" placeholder when none):
    /// every edit lands through `timingStepChanged`, so a cut clears the step
    /// and a first preset starts from a usable default.
    @ViewBuilder
    private func stepControls(_ phase: P.TimingPhase, _ current: AnimStep?) -> some View {
        let step = current ?? P.timingPlaceholderStep(phase)
        let name = phase == .entrance ? "Entrance" : "Exit"
        let commit: (AnimStep) -> Void = { next in setStep(phase, P.timingStepChanged(current, next, phase)) }
        OverlayPanelPicker(name, selection: step.preset, options: TimingPanelView.presetOptions) { preset in
            var next = step
            next.preset = preset
            commit(next)
        }
        if step.preset != .none {
            DevelopRangeSlider("Duration", value: step.duration, in: 0.05...3, step: 0.05, reset: P.timingDefaultStep(phase).duration,
                               printed: "\(P.fixed(step.duration, 2)) s") { v in
                var next = step
                next.duration = v
                commit(next)
            }
            .accessibilityHint("\(name) duration")
            OverlayPanelPicker("Curve", selection: step.easing, options: TimingPanelView.easingOptions) { easing in
                var next = step
                next.easing = easing
                commit(next)
            }
            if step.easing == .steps {
                let count = step.steps ?? Double(defaultSteps)
                DevelopRangeSlider("Steps", value: count, in: Double(minSteps)...Double(maxSteps), step: 1,
                                   reset: Double(defaultSteps), printed: DevelopNumbers.plain(count)) { v in
                    var next = step
                    next.steps = v
                    commit(next)
                }
            }
            presetKnobs(phase, step, commit)
        }
    }

    /// A slide's direction and travel; a scale's starting (or ending) size.
    @ViewBuilder
    private func presetKnobs(_ phase: P.TimingPhase, _ step: AnimStep, _ commit: @escaping (AnimStep) -> Void) -> some View {
        if step.preset == .slide {
            OverlayPanelPicker("Direction", selection: step.direction ?? .up, options: TimingPanelView.directionOptions) { d in
                var next = step
                next.direction = d
                commit(next)
            }
            let travel = step.distanceFrac ?? 0.06
            DevelopRangeSlider("Travel", value: travel, in: 0.01...0.4, step: 0.01, reset: 0.06,
                               printed: P.percent(travel)) { v in
                var next = step
                next.distanceFrac = v
                commit(next)
            }
        }
        if step.preset == .scale {
            let from = step.scaleFrom ?? 0.86
            DevelopRangeSlider(phase == .entrance ? "From" : "To", value: from, in: 0.2...2, step: 0.02, reset: 0.86,
                               printed: P.percent(from)) { v in
                var next = step
                next.scaleFrom = v
                commit(next)
            }
            .accessibilityHint(phase == .entrance ? "Scale from" : "Scale to")
        }
    }

    // MARK: - the menus' words

    private static let presetOptions: [Option<AnimPreset>] = OverlayPanels.animPresetOptions.map { Option($0.preset, $0.label) }
    private static let directionOptions: [Option<AnimDirection>] =
        OverlayPanels.animDirectionOptions.map { Option($0.direction, $0.label) }
    private static let easingOptions: [Option<EasingId>] = easingIds.map { Option($0, OverlayPanels.easingLabel($0)) }
}

// MARK: - previews

private struct TimingPanelPreview: View {
    @State private var element: OverlayElement
    let scene: OverlayScene?

    init(_ id: String, scene: OverlayScene?) {
        _element = State(initialValue: OverlayPanelFixtures.element(id))
        self.scene = scene
    }

    var body: some View {
        DevelopPreviewState(true) { _ in
            TimingPanelView(element: $element, scene: scene, playhead: 1.25)
        }
    }
}

#Preview("Timing — a title in the intro") { TimingPanelPreview("deck.title", scene: OverlayPanelFixtures.scene) }
#Preview("Timing — a readout, whole clip") { TimingPanelPreview("deck.0", scene: nil) }
