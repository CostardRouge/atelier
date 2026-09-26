// The post-crop vignette — Lightroom's Effects vignette. Port of
// `src/tools/develop/VignettePanel.tsx` over the kernel's
// `Render/PostVignette.swift` (`PostCropVignette`, `postVignetteRanges`,
// `isDefaultPostVignette`), stored by the host in `picture.carried["vignette"]`.
//
// It follows the CROP wherever the crop goes, where the lens correction's
// vignetting follows the optics of the whole frame. Folded by default, like
// the other finishing sections. Stored as nil the moment Amount is 0: the
// other four shape nothing alone, so moving one of them while Amount is 0
// puts it back — as on the web.

import SwiftUI
import AtelierKit

struct VignetteSection: View {
    @Binding var vignette: PostCropVignette?

    /// - Parameter vignette: the picture's post-crop vignette, nil for none.
    init(vignette: Binding<PostCropVignette?>) {
        self._vignette = vignette
    }

    private struct Row: Identifiable {
        let key: String
        let label: String
        let path: WritableKeyPath<PostCropVignette, Double>
        /// Printed as a plain number rather than signed: the three that run 0..100.
        let plain: Bool
        var id: String { key }
    }

    private static let rows: [Row] = [
        Row(key: "amount", label: "Amount", path: \.amount, plain: false),
        Row(key: "midpoint", label: "Midpoint", path: \.midpoint, plain: true),
        Row(key: "roundness", label: "Roundness", path: \.roundness, plain: false),
        Row(key: "feather", label: "Feather", path: \.feather, plain: true),
        Row(key: "highlights", label: "Highlights", path: \.highlights, plain: true),
    ]

    var body: some View {
        let v = vignette ?? .default
        DevelopSection(id: "vignette", title: "Vignette", info: [Self.hint],
                       marked: !isDefaultPostVignette(vignette), defaultOpen: false) {
            ForEach(Self.rows) { row in
                let bounds = postVignetteRanges[row.key] ?? (min: -100, max: 100)
                let value = v[keyPath: row.path]
                DevelopRangeSlider(row.label, value: value, in: bounds.min...bounds.max, step: 1,
                                   reset: PostCropVignette.default[keyPath: row.path],
                                   printed: row.plain ? DevelopNumbers.plain(value) : nil) { n in
                    var next = vignette ?? .default
                    next[keyPath: row.path] = n
                    vignette = isDefaultPostVignette(next) ? nil : next
                }
            }
            if !isDefaultPostVignette(vignette) {
                Button("Reset vignette") { vignette = nil }
                    .buttonStyle(DevelopLinkButtonStyle())
            }
        }
    }

    private static let hint = "A vignette on the picture AS CROPPED — it follows the crop wherever the crop goes, where the lens correction’s vignetting follows the optics of the whole frame. Amount darkens the edges below zero and lightens them above; Midpoint is how far in it begins, Roundness goes from a rounded rectangle to a circle, Feather how soft it is, and Highlights spares a bright corner — a sky keeps its light under a dark vignette."
}

#Preview("Vignette") {
    DevelopPreviewState(Optional(DevelopPanelFixtures.vignette)) { vignette in
        VignetteSection(vignette: vignette)
    }
}
