// Levels — the three numbers Auto tone writes, so they can be seen and moved.
// Port of `DevelopLevelsSection` in `src/shared/develop/DevelopAuto.tsx`.
//
// The MASTER channel only, as on the web: per-channel levels exist in the
// engine (`Levels.red/green/blue`, read and baked by the kernel), but setting
// them by hand is a white balance done the hard way, and the curve's own R, G
// and B tabs are the better tool for it. A picture that carries them from
// elsewhere keeps them — every write here hands them back untouched.
//
// Black and white are shown in the 0..255 codes a photographer reads and
// stored in [0,1]; they may not cross — a range read backwards is a
// threshold, and `normaliseLevel` would throw the whole channel away.

import SwiftUI
import AtelierKit

struct DevelopLevelsSection: View {
    @Binding var settings: DevelopSettings

    init(settings: Binding<DevelopSettings>) {
        self._settings = settings
    }

    private var level: LevelChannel { settings.levels?.rgb ?? .neutral }

    private var marked: Bool {
        let l = settings.levels
        return l?.rgb != nil || l?.red != nil || l?.green != nil || l?.blue != nil
    }

    var body: some View {
        DevelopSection(id: "levels", title: "Levels", info: [Self.hint], marked: marked, defaultOpen: false) {
            let l = level
            DevelopRangeSlider("Black", value: DevelopNumbers.jsRound(l.inBlack * 255), in: 0...255, step: 1,
                               printed: String(Int(DevelopNumbers.jsRound(l.inBlack * 255)))) { v in
                write(.inBlack, v / 255)
            }
            DevelopRangeSlider("Gamma", value: l.gamma, in: minLevelGamma...maxLevelGamma, step: 0.01, reset: 1,
                               printed: String(format: "%.2f", l.gamma)) { v in
                write(.gamma, v)
            }
            DevelopRangeSlider("White", value: DevelopNumbers.jsRound(l.inWhite * 255), in: 0...255, step: 1, reset: 255,
                               printed: String(Int(DevelopNumbers.jsRound(l.inWhite * 255)))) { v in
                write(.inWhite, v / 255)
            }
            if !isNeutralLevel(settings.levels?.rgb) {
                Button("Reset levels") { resetMaster() }
                    .buttonStyle(DevelopLinkButtonStyle())
            }
        }
    }

    private enum LevelKey { case inBlack, gamma, inWhite }

    private func write(_ key: LevelKey, _ raw: Double) {
        let current = level
        var next = current
        switch key {
        case .inBlack: next.inBlack = Swift.min(raw, current.inWhite - 1.0 / 255)
        case .inWhite: next.inWhite = Swift.max(raw, current.inBlack + 1.0 / 255)
        case .gamma: next.gamma = raw
        }
        let rgb: LevelChannel? = isNeutralLevel(next) ? nil : next
        let old = settings.levels
        let empty = rgb == nil && old?.red == nil && old?.green == nil && old?.blue == nil
        settings.levels = empty ? nil : Levels(rgb: rgb, red: old?.red, green: old?.green, blue: old?.blue)
    }

    private func resetMaster() {
        let old = settings.levels
        let others = old?.red != nil || old?.green != nil || old?.blue != nil
        settings.levels = others ? Levels(rgb: nil, red: old?.red, green: old?.green, blue: old?.blue) : nil
    }

    private static let hint = "Where the range is read FROM: everything at or under black becomes black, everything at or over white becomes white, and gamma bends what is between them. Auto tone writes these three; the curve’s own end points do the same thing by hand."
}

#Preview("Levels") {
    DevelopPreviewState(DevelopPanelFixtures.develop) { settings in
        DevelopLevelsSection(settings: settings)
    }
}
