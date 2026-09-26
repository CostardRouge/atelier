// Auto — two buttons, deliberately not one. Port of `DevelopAutoSection` in
// `src/shared/develop/DevelopAuto.tsx`.
//
// Splitting tone from colour is the whole design: a stretch is almost always
// an improvement, and a white balance is often exactly wrong, so they must
// not share a tap. Both are measured by the kernel on the picture AS SHOT
// (`autoTone`, `autoColour` over the host's `SourceStats`), so a second press
// is the same answer rather than a compound; the clamp is said out loud
// ("as far as the sliders reach"). Pick grey is the host's eyedropper: this
// section only arms it — the stage reads the pixel and solves
// `whiteBalanceFor` on it.
//
// One row of verbs: not worth a fold, drawn with the same header as the
// foldable sections under it.

import SwiftUI
import AtelierKit

struct DevelopAutoSection: View {
    @Binding var settings: DevelopSettings
    let stats: SourceStats?
    let picking: Bool
    let onPicking: ((Bool) -> Void)?
    let onTold: (String) -> Void

    /// - Parameters:
    ///   - stats: the picture measured AS SHOT (`measureSource`), nil until it has been read.
    ///   - picking: the eyedropper is armed.
    ///   - onPicking: arm or disarm it; nil draws no Pick grey.
    ///   - onTold: what a verb did, in words — the workbench's status line.
    init(settings: Binding<DevelopSettings>, stats: SourceStats?, picking: Bool = false,
         onPicking: ((Bool) -> Void)? = nil, onTold: @escaping (String) -> Void) {
        self._settings = settings
        self.stats = stats
        self.picking = picking
        self.onPicking = onPicking
        self.onTold = onTold
    }

    private var ready: Bool { (stats?.total ?? 0) > 0 }
    private var notReadYet: String { ready ? "" : "the picture has not been read yet" }

    var body: some View {
        DevelopSection(id: "auto", title: "Auto", info: [Self.hint], foldable: false) {
            HStack(spacing: 8) {
                Button("Auto tone") { autoToneTapped() }
                    .buttonStyle(DevelopPillButtonStyle())
                    .disabled(!ready)
                    .help(notReadYet)
                Button("Auto colour") { autoColourTapped() }
                    .buttonStyle(DevelopPillButtonStyle())
                    .disabled(!ready)
                    .help(notReadYet)
                if let onPicking {
                    Button(picking ? "Pick…" : "Pick grey") { onPicking(!picking) }
                        .buttonStyle(DevelopPillButtonStyle(on: picking))
                        .disabled(!ready)
                        .accessibilityAddTraits(picking ? .isSelected : [])
                        .help("Click something in the picture that should be grey")
                }
            }
        }
    }

    private func autoToneTapped() {
        guard let stats else { return }
        let levels = autoTone(stats)
        settings.levels = levels
        onTold(levels != nil ? "auto tone · \(describeAutoTone(levels))" : "nothing to stretch")
    }

    private func autoColourTapped() {
        guard let stats else { return }
        let found = autoColour(stats)
        // One write for the two numbers — one step of undo, one render.
        var next = settings
        next.temperature = found.temperature
        next.tint = found.tint
        settings = next
        if found.temperature == 0 && found.tint == 0 {
            onTold("already neutral")
        } else {
            let clamp = found.clamped ? " · as far as the sliders reach" : ""
            onTold("auto colour · temperature \(Int(found.temperature)), tint \(Int(found.tint))\(clamp)")
        }
    }

    private static let hint = "Tone reads where the picture’s light actually sits and writes a black point, a white point and a midtone gamma into Levels — it touches no colour. Colour neutralises the AVERAGE cast, which is the wrong answer on a sunset or a candle-lit room, so it is a second button and never rides along with the first. Pick grey asks you instead: click something in the picture that ought to be neutral and the white balance is solved for that, which beats the average whenever the picture is not an average scene. All three are measured on the picture as shot, so pressing one twice gives the same answer rather than compounding."
}

#Preview("Auto") {
    DevelopPreviewState(DevelopSettings.default) { settings in
        DevelopAutoSection(settings: settings, stats: DevelopPanelFixtures.stats, picking: false,
                           onPicking: { _ in }, onTold: { print($0) })
        DevelopAutoSection(settings: settings, stats: nil, onTold: { _ in })
    }
}
