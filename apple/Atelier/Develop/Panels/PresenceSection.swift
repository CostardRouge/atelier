// Presence — texture, clarity, dehaze — drawn on the ADJUST tab, where a
// Lightroom hand looks for them, over the detail record they share. Port of
// `PresencePanel` in `src/tools/develop/DetailPanel.tsx`; the maths is the
// kernel's `Render/Presence.swift`, the ranges `DetailRange.of`.
//
// All three look around the pixel, so their scale is a share of the picture:
// the stage and the file see the same thing. Stored as nil the moment the
// whole record does nothing, exactly as the Detail tab writes it.

import SwiftUI
import AtelierKit

struct PresenceSection: View {
    @Binding var detail: DetailSettings?

    /// - Parameter detail: the picture's `DetailSettings` (`carried["detail"]`), shared with `DetailSection`.
    init(detail: Binding<DetailSettings?>) {
        self._detail = detail
    }

    private static let keys: [DetailKey] = [.texture, .clarity, .dehaze]

    private static func label(_ key: DetailKey) -> String {
        switch key {
        case .texture: return "Texture"
        case .clarity: return "Clarity"
        default: return "Dehaze"
        }
    }

    var body: some View {
        let d = detail ?? .default
        DevelopSection(id: "presence", title: "Presence", info: [Self.hint],
                       marked: d.texture != 0 || d.clarity != 0 || d.dehaze != 0) {
            ForEach(Self.keys, id: \.self) { key in
                let range = DetailRange.of(key)
                DevelopRangeSlider(Self.label(key), value: d[key], in: range.min...range.max, step: range.step) { v in
                    var next = detail ?? .default
                    next[key] = v
                    detail = isDefaultDetail(next) ? nil : next
                }
            }
        }
    }

    private static let hint = "Texture is local contrast at a small scale — pores, bark, fabric — and smooths them below zero. Clarity is the same at a large scale, on the midtones only, so shapes and clouds gain body while the ends are spared. Dehaze reads the haze from the darkest channel around each place and takes it out (or adds one below zero); a bright sky darkens with it, as haze removal does. All three look around the pixel, so their scale is a share of the picture — the stage and the file see the same thing."
}

#Preview("Presence") {
    DevelopPreviewState(Optional(DevelopPanelFixtures.detail)) { detail in
        PresenceSection(detail: detail)
    }
}
