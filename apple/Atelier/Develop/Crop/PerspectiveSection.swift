// The perspective correction — port of `src/tools/develop/KeystonePanel.tsx`
// over the kernel's `Render/Keystone.swift`: the suite's first control that
// moves a pixel rather than changing its colour.
//
// It sits on the Crop tab because it is the same gesture in a photographer's
// head ("make the frame right"), and because the ORDER is easier to see when
// the two are together: the warp happens first, the crop decides what
// survives it. Stored as nil the moment it does nothing — the record's rule
// everywhere — so a picture nobody corrected carries no correction.

import SwiftUI
import AtelierKit

struct PerspectiveSection: View {
    @Binding var keystone: Keystone?

    init(keystone: Binding<Keystone?>) {
        self._keystone = keystone
    }

    private struct Row: Identifiable {
        let id: String
        let label: String
        let path: WritableKeyPath<Keystone, Double>
        let range: ClosedRange<Double>
        let step: Double
        let reset: Double
    }

    private static let rows: [Row] = [
        Row(id: "vertical", label: "Vertical", path: \.vertical, range: -100...100, step: 1, reset: 0),
        Row(id: "horizontal", label: "Horizontal", path: \.horizontal, range: -100...100, step: 1, reset: 0),
        Row(id: "rotation", label: "Turn", path: \.rotation, range: -maxKeystoneRotation...maxKeystoneRotation, step: 0.1, reset: 0),
        Row(id: "aspect", label: "Stretch", path: \.aspect, range: -100...100, step: 1, reset: 0),
        Row(id: "scale", label: "Zoom", path: \.scale, range: minKeystoneScale...maxKeystoneScale, step: 0.01, reset: 1),
    ]

    var body: some View {
        let k = keystone ?? .default
        let touched = !isDefaultKeystone(keystone)
        DevelopSection(id: "perspective", title: "Perspective", info: PerspectiveSection.info, marked: touched, actions: {
            if touched {
                Button("Reset") { keystone = nil }
                    .buttonStyle(DevelopLinkButtonStyle())
            }
        }) {
            ForEach(PerspectiveSection.rows) { row in
                let value = k[keyPath: row.path]
                DevelopRangeSlider(row.label, value: value, in: row.range, step: row.step, reset: row.reset,
                                   printed: printed(row.id, value)) { n in
                    var next = keystone ?? .default
                    next[keyPath: row.path] = n
                    keystone = isDefaultKeystone(next) ? nil : next
                }
            }
        }
    }

    /// `1.25×` for the zoom, `+2.5°` / `−2.5°` for the turn, the signed number otherwise.
    private func printed(_ id: String, _ value: Double) -> String? {
        switch id {
        case "scale":
            return String(format: "%.2f×", value)
        case "rotation":
            let sign = value > 0 ? "+" : (value < 0 ? "−" : "")
            return sign + String(format: "%.1f°", abs(value))
        default:
            return nil
        }
    }

    static let info = [
        "Pointing a lens up at a building makes its verticals converge; these take that back out. Vertical is the one you want for a building, horizontal for a wall shot from one side, and the two perspective sliders empty the corners of the frame — Zoom is what hides that, so it usually goes up as they do. Turn levels the horizon in the same pass, so the picture is resampled once rather than twice. The correction happens BEFORE the crop, which then decides what of the result is kept.",
        "The corners it empties are left EMPTY, never smeared — zoom to hide them.",
    ]
}

#Preview("Perspective") {
    DevelopPreviewState(Optional(Keystone(vertical: -24, scale: 1.12))) { keystone in
        PerspectiveSection(keystone: keystone)
    }
}
