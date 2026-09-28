// Detail — denoise, defringe, sharpen — on its own tab: what is next to a
// pixel, rather than what a pixel is. Port of the default export of
// `src/tools/develop/DetailPanel.tsx`; the record, its ranges and its words
// are the kernel's (`Render/Detail.swift`: `DetailSettings`, `DetailRange`,
// `describeDetail`), stored by the host in `picture.carried["detail"]`.
//
// Three sections — Noise, Fringing (one slider: the same header, no fold),
// Sharpen with Lightroom's Detail and Masking — and a line under them saying
// what this TAB holds, with its Reset. Presence (texture · clarity · dehaze)
// rides the same record but is drawn on the Adjust tab
// (`PresenceSection.swift`), so this Reset never reaches it.
//
// Stored as nil the moment it does nothing: a radius alone is not an
// operation, so a Radius moved while every amount is 0 goes back — as on the
// web.

import SwiftUI
import AtelierKit

struct DetailSection: View {
    @Binding var detail: DetailSettings?
    let maskView: Bool
    let onMaskView: ((Bool) -> Void)?
    @Environment(\.palette) private var palette

    /// - Parameters:
    ///   - detail: the picture's `DetailSettings` (the host reads and writes `carried["detail"]`), nil for none.
    ///   - maskView: the stage paints the sharpen's Masking weight instead of the picture.
    ///   - onMaskView: turn that view on or off; nil draws no Show the mask.
    init(detail: Binding<DetailSettings?>, maskView: Bool = false, onMaskView: ((Bool) -> Void)? = nil) {
        self._detail = detail
        self.maskView = maskView
        self.onMaskView = onMaskView
    }

    private var d: DetailSettings { detail ?? .default }

    /// The keys this TAB owns — presence shares the record and is drawn on the Adjust tab.
    private static let tabKeys: [DetailKey] = [.luminance, .colour, .defringe, .sharpen, .sharpenRadius, .sharpenDetail, .sharpenMasking]

    private func write(_ key: DetailKey, _ value: Double) {
        var next = d
        next[key] = value
        detail = isDefaultDetail(next) ? nil : next
    }

    private func slider(_ key: DetailKey, _ label: String, reset: Double = 0) -> some View {
        let range = DetailRange.of(key)
        let value = d[key]
        return DevelopRangeSlider(label, value: value, in: range.min...range.max, step: range.step, reset: reset,
                                  printed: key == .sharpenRadius ? String(format: "%.1f px", value) : nil) { v in
            write(key, v)
        }
    }

    var body: some View {
        let current = d
        let tabOnly = Self.withoutPresence(current)
        DevelopSection(id: "noise", title: "Noise", info: [Self.noiseHint, Self.scaleNote],
                       marked: current.luminance != 0 || current.colour != 0) {
            slider(.luminance, "Luminance")
            slider(.colour, "Colour")
        }
        DevelopSection(id: "fringing", title: "Fringing", info: [Self.fringeHint], foldable: false) {
            slider(.defringe, "Defringe")
        }
        DevelopSection(id: "sharpen", title: "Sharpen", info: [Self.sharpenHint], marked: current.sharpen != 0) {
            slider(.sharpen, "Amount")
            slider(.sharpenRadius, "Radius", reset: DetailSettings.default.sharpenRadius)
            slider(.sharpenDetail, "Detail", reset: DetailSettings.default.sharpenDetail)
            slider(.sharpenMasking, "Masking")
            if let onMaskView {
                Button(maskView ? "Hide the mask" : "Show the mask") { onMaskView(!maskView) }
                    .buttonStyle(DevelopLinkButtonStyle(active: maskView))
                    .accessibilityAddTraits(maskView ? .isSelected : [])
                    .help("Paint the picture white where it is sharpened and black where it is left alone — Lightroom's Alt-drag on Masking")
            }
        }
        if !isDefaultDetail(tabOnly) {
            HStack(spacing: 8) {
                Text(describeDetail(tabOnly))
                    .font(Brand.mono(10))
                    .foregroundStyle(palette.faint)
                    .lineLimit(1)
                    .help(describeDetail(tabOnly))
                Spacer(minLength: 0)
                Button("Reset") { resetTab() }
                    .buttonStyle(DevelopLinkButtonStyle())
            }
            .padding(.top, 4)
        }
    }

    /// The record as this tab sees it — presence taken out.
    private static func withoutPresence(_ d: DetailSettings) -> DetailSettings {
        var t = d
        t.texture = 0
        t.clarity = 0
        t.dehaze = 0
        return t
    }

    /// This tab's keys only: texture, clarity and dehaze belong to the Adjust tab.
    private func resetTab() {
        var next = d
        for key in Self.tabKeys { next[key] = DetailSettings.default[key] }
        detail = isDefaultDetail(next) ? nil : next
    }

    private static let noiseHint = "Luminance smooths the grain of a high ISO while keeping every edge — a pixel is averaged only with neighbours of a similar brightness, so a wall goes quiet and a hairline stays a hairline. Colour removes the coloured speckle on its own; it can go much further than luminance without softening anything the eye reads, because edges live in the luminance. Both run on the picture BEFORE the develop, where the noise is what the sensor left rather than what a lift made of it."

    private static let fringeHint = "A lens leaves a purple edge on high-contrast subjects — a branch against the sky, a chrome rim. Defringe pulls the purple toward neutral only where the brightness changes steeply; a purple wall away from any edge is left alone."

    private static let sharpenHint = "An unsharp mask on the luminance, applied last so nothing resamples it afterwards: Amount is how much the edges are steepened, Radius how wide an edge counts as one. One pixel suits a sharp file; a soft one wants a little more. Detail holds back the strong edges, where a halo is born, while the fine texture keeps its gain — 100 is the plain mask. Masking sharpens only where the picture changes steeply, so a sky’s noise and a cheek are left alone; Show the mask paints white where it sharpens. No hue moves and no coloured halo is invented, which is what applying it to the luminance alone buys."

    private static let scaleNote = "A radius is a number of pixels of the FILE. The stage shows the picture at a fraction of its density and scales the kernels to match, which is a fair preview and not the truth: judge detail in the loupe, at one pixel per pixel."
}

#Preview("Detail") {
    DevelopPreviewState(Optional(DevelopPanelFixtures.detail)) { detail in
        DetailSection(detail: detail, maskView: false, onMaskView: { _ in })
    }
}
