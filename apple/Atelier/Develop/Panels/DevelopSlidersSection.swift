// Light · Tone · Colour: every slider of a develop, in the order the maths
// applies them — port of `src/shared/develop/DevelopSliders.tsx`.
//
// Three sections, each folding under its own id (`light`, `tone`, `colour`,
// prefixed `layer.` for a layer's own sliders so its folds stay apart from the
// picture's), each marked while any of its fields departs from 0. The ranges,
// steps and labels are the kernel's (`DevelopRange.of`, `DevelopKey.label`);
// exposure prints in stops with two decimals, the rest signed.

import SwiftUI
import AtelierKit

struct DevelopSlidersSection: View {
    @Binding var settings: DevelopSettings
    let foldPrefix: String

    /// - Parameter foldPrefix: keeps a LAYER's folds apart from the picture's (`layer.`).
    init(settings: Binding<DevelopSettings>, foldPrefix: String = "") {
        self._settings = settings
        self.foldPrefix = foldPrefix
    }

    var body: some View {
        ForEach(SliderGroup.all) { group in
            DevelopSection(
                id: "\(foldPrefix)\(group.legend.lowercased())",
                title: group.legend,
                info: [group.hint],
                marked: group.keys.contains { settings[$0] != 0 }
            ) {
                ForEach(group.keys, id: \.self) { key in
                    slider(key)
                }
            }
        }
    }

    private func slider(_ key: DevelopKey) -> some View {
        let range = DevelopRange.of(key)
        let value = settings[key]
        let printed = key == .exposure ? "\(signed(value, digits: 2)) \(range.unit)" : signed(value)
        return DevelopRangeSlider(key.label, value: value, in: range.min...range.max, step: range.step,
                                  printed: printed) { next in
            settings[key] = Swift.min(range.max, Swift.max(range.min, next))
        }
    }
}

/// One fold of the column: its legend, its keys, the prose behind its ⓘ.
private struct SliderGroup: Identifiable {
    let legend: String
    let keys: [DevelopKey]
    let hint: String
    var id: String { legend }

    static let all: [SliderGroup] = [
        SliderGroup(
            legend: "Light",
            keys: [.exposure, .brightness, .contrast],
            hint: "Exposure is a gain in stops, in scene light. Brightness lifts the midtones and leaves black and white where they are. Contrast stretches around 18 % grey."
        ),
        SliderGroup(
            legend: "Tone",
            keys: [.highlights, .shadows, .whites, .blacks],
            hint: "Highlights and shadows work the upper and lower halves without reaching the ends; whites and blacks move the ends themselves. On an 8-bit picture nothing above white can come back — only a RAW keeps it."
        ),
        SliderGroup(
            legend: "Colour",
            keys: [.temperature, .tint, .saturation, .vibrance],
            hint: "Temperature and tint are channel gains in linear light. Vibrance is saturation weighted by how pale a colour already is, so a strong colour barely moves — that is what protects skin."
        ),
    ]
}

#Preview("Light · Tone · Colour") {
    DevelopPreviewState(DevelopPanelFixtures.develop) { settings in
        DevelopSlidersSection(settings: settings)
    }
}
