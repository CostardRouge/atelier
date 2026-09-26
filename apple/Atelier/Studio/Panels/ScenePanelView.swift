// The intro scene's own controls — port of `src/shared/overlay/ScenePanel.tsx`.
//
// The intro is a SCENE (`docs/memory/studio.md`): a shared window over
// ordinary elements plus two optional pieces of furniture — a veil (scrim)
// over the picture and under every element, and SOLO, holding the rest of
// the deck back while it plays and fading it back after — and a CASCADE, a
// delay added to each member's entrance from where it sits, derived on every
// draw and never stored on an element. One panel per scene; the Studio shows
// the single intro it creates on the first intro element, the model already
// taking several.
//
// Removing the intro drops the scene AND every element in it, so it asks
// first (a confirmation, where the web asks inline).

import SwiftUI
import AtelierKit

struct ScenePanelView: View {
    @Binding private var scene: OverlayScene
    private let memberCount: Int
    private let playhead: Double
    private let onRemove: () -> Void

    @State private var confirming = false
    @Environment(\.palette) private var palette

    private typealias P = OverlayPanels
    private typealias Option = OverlayPanelOption

    /// - Parameters:
    ///   - memberCount: how many elements live in it — an empty scene is worth saying so.
    ///   - playhead: seconds from the first exported frame.
    ///   - onRemove: drops the scene and the elements in it; called once confirmed.
    init(scene: Binding<OverlayScene>, memberCount: Int, playhead: Double, onRemove: @escaping () -> Void) {
        _scene = scene
        self.memberCount = memberCount
        self.playhead = playhead
        self.onRemove = onRemove
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            spanRows
            veilRows
            cascadeRows
            soloRows
            contentsRow
        }
    }

    /// Every edit: the patch, then a scene that would end before it starts
    /// nudged to end 0.2 s after — never a setting with no visible effect.
    private func patch(_ edit: (inout OverlayScene) -> Void) {
        var next = scene
        edit(&next)
        scene = P.scenePatched(next)
    }

    // MARK: - when

    @ViewBuilder
    private var spanRows: some View {
        OverlayPanelRow("Starts") {
            OverlayPanelNumberField("Scene starts", value: scene.start, step: 0.1, range: 0...86_400, unit: "s") { v in
                patch { $0.start = max(0, v) }
            }
        }
        OverlayPanelRow("Ends") {
            OverlayPanelNumberField("Scene ends", value: scene.end, step: 0.1, range: 0...86_400, unit: "s") { v in
                patch { $0.end = v }
            }
            Button("Playhead") {
                patch { $0.end = P.hundredths(max(0, playhead)) }
            }
            .buttonStyle(DevelopLinkButtonStyle())
            .help("End the scene at the playhead")
        }
    }

    // MARK: - the veil

    @ViewBuilder
    private var veilRows: some View {
        OverlayPanelRow("Veil") {
            OverlayPanelToggle("Veil over the picture", isOn: scene.scrim != nil, words: "Over the picture") { on in
                patch { $0.scrim = on ? SceneScrim.default : nil }
            }
            if let scrim = scene.scrim {
                Spacer(minLength: 0)
                OverlayPanelColourWell("Veil colour", css: scrim.color) { hex in
                    patch { $0.scrim?.color = hex }
                }
            }
        }
        if let scrim = scene.scrim {
            DevelopRangeSlider("Strength", value: scrim.opacity, in: 0.05...1, step: 0.05, reset: SceneScrim.default.opacity,
                               printed: P.percent(scrim.opacity)) { v in patch { $0.scrim?.opacity = v } }
                .accessibilityHint("Veil strength")
            DevelopRangeSlider("Fade", value: scrim.fade, in: 0...2, step: 0.05, reset: SceneScrim.default.fade,
                               printed: "\(P.fixed(scrim.fade, 2)) s") { v in patch { $0.scrim?.fade = v } }
                .accessibilityHint("Veil fade")
        }
    }

    // MARK: - the cascade

    /// One cascade over the scene's members, from where they sit — added to
    /// each element's own delay, so the intro's titles arrive one rank after
    /// another without a delay typed on each.
    @ViewBuilder
    private var cascadeRows: some View {
        let stagger = scene.staggerValue
        OverlayPanelRow("Cascade", hint: stagger != nil
            ? "Added to each element’s own delay; an element with no entrance cuts in on its beat."
            : "Spread the scene’s entrances by where its elements sit.") {
            OverlayPanelToggle("Cascade the scene’s elements", isOn: stagger != nil) { on in
                patch { $0.stagger = P.sceneStaggerToggled(on) }
            }
        }
        if let stagger {
            OverlayPanelPicker("Order", selection: stagger.order, options: ScenePanelView.orderOptions) { order in
                patch { $0.stagger = .some(P.sceneStaggerOrdered(stagger, order)) }
            }
            DevelopRangeSlider("Each", value: stagger.each, in: 0...maxStaggerEach, step: 0.01, reset: Stagger.default.each,
                               printed: "\(P.fixed(stagger.each, 2)) s") { v in
                var next = stagger
                next.each = v
                patch { $0.stagger = .some(next) }
            }
            .accessibilityHint("Seconds between two ranks")
            if stagger.order == .random {
                OverlayPanelRow("Shuffle") {
                    Button("Shuffle again") {
                        var next = stagger
                        next.seed = newStaggerSeed()
                        patch { $0.stagger = .some(next) }
                    }
                    .buttonStyle(DevelopPillButtonStyle())
                }
            }
        }
    }

    // MARK: - solo

    @ViewBuilder
    private var soloRows: some View {
        OverlayPanelRow("Solo", hint: "Holds the rest of the deck back while the intro plays.") {
            OverlayPanelToggle("Hold the rest of the deck back", isOn: scene.solo) { on in patch { $0.solo = on } }
        }
        if scene.solo {
            DevelopRangeSlider("Comes back", value: scene.hudFade, in: 0...3, step: 0.05, reset: 0.5,
                               printed: P.hudFadeText(scene.hudFade)) { v in patch { $0.hudFade = v } }
                .accessibilityHint("The deck comes back over")
        }
    }

    // MARK: - contents

    private var contentsRow: some View {
        OverlayPanelRow("Contents") {
            Text(verbatim: P.sceneMembersSentence(memberCount))
                .font(Brand.sans(12))
                .foregroundStyle(palette.muted)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button("Remove the intro") { confirming = true }
                .buttonStyle(DevelopLinkButtonStyle())
        }
        .confirmationDialog("Drop the intro and every element in it?", isPresented: $confirming,
                            titleVisibility: .visible) {
            Button("Remove", role: .destructive) { onRemove() }
            Button("Keep", role: .cancel) {}
        }
    }

    private static let orderOptions: [Option<StaggerOrder>] =
        staggerOrders.map { Option($0.id, OverlayPanels.staggerOrderLabel($0)) }
}

// MARK: - previews

private struct ScenePanelPreview: View {
    @State private var scene: OverlayScene

    init(_ scene: OverlayScene) {
        _scene = State(initialValue: scene)
    }

    var body: some View {
        DevelopPreviewState(true) { _ in
            ScenePanelView(scene: $scene, memberCount: 3, playhead: 2.4, onRemove: {})
        }
    }
}

#Preview("Intro — veil, cascade, solo") { ScenePanelPreview(OverlayPanelFixtures.scene) }
#Preview("Intro — bare") { ScenePanelPreview(createIntroScene()) }
