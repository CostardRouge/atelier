// The film TEXTURE's dials — grain and halation, the half of a stock the cube
// cannot carry. The web's `FilmTextureDials.tsx`.
//
// It edits the GRADE's texture, never a layer's: the texture belongs to the
// stock but cascades with the look, so it sits beside the layers exactly as
// the output transform does (`render-film.md`). Sizes are fractions of the
// frame's HEIGHT and are shown as such (`h/667`), never in pixels — a pixel
// would be a different grain at every export size. A cell's size in THIS
// preview's pixels is said beside it, because that is what decides whether
// the preview can honestly show it.

import SwiftUI
import AtelierKit

struct FilmTextureDialsView: View {
    @Binding var texture: FilmTexture?
    /// The height in pixels of the surface the host really draws its preview
    /// at — nil where it cannot say, and then nothing is claimed.
    var previewHeight: Double?
    /// False where the host's preview does not draw the film node at all.
    var previewDraws = true
    @Environment(\.palette) private var palette

    private var on: Bool { texture != nil }
    private var t: FilmTexture { texture ?? defaultFilmTexture }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Toggle(isOn: Binding(get: { on }, set: { next in
                if next {
                    var start = defaultFilmTexture
                    start.grain = 0.3
                    start.halation = 0.2
                    texture = start
                } else {
                    texture = nil
                }
            })) {
                Text("Grain and halation")
                    .font(Brand.sans(13, weight: .medium))
                    .foregroundStyle(palette.ink)
            }
            .tint(palette.accent)
            Text("The half of a film stock the cube cannot carry: a grain field, and the bleed a bright highlight leaves through the base. Drawn after the look, at the size the frame is delivered at.")
                .font(Brand.sans(11))
                .foregroundStyle(palette.muted)
                .fixedSize(horizontal: false, vertical: true)
            if on { dials }
        }
    }

    @ViewBuilder
    private var dials: some View {
        slider("Grain", .grain, printed: percent(t.grain))
        if !previewDraws {
            note("This stage does not draw the texture — every export does. Dial it in Develop, where the loupe shows it at the file’s own pixels.",
                 tone: palette.warn)
        }
        if let shown = showable {
            note(shown.text, tone: shown.warn ? palette.warn : palette.muted)
        }
        slider("Cell", .grainSize, printed: "h/\(Int((1 / t.grainSize).rounded()))",
               hint: "A fraction of the frame’s HEIGHT, so the export’s grain is this one, resampled — never a size in pixels.")
        slider("Chroma", .grainChroma, printed: percent(t.grainChroma),
               hint: "0 moves every channel together — a silver screen door. 1 gives each its own field, which is the digital look.")
        slider("Re-rolls", .grainFps, printed: t.grainFps <= 0 ? "Frozen" : "\(Int(t.grainFps.rounded()))/s",
               hint: "On a clip, how often the field is drawn again, per second of the SOURCE. Real film re-rolls once per photographed frame; 60 a second is the boiling. Frozen leaves a still, and a Ken-Burns move, with one field.")
        slider("Halation", .halation, printed: percent(t.halation),
               hint: "The warm bleed a bright highlight leaves through the film base. Resolution-independent by construction: the blur is the same over the same small buffer at every size.")
        if t.halation > 0 {
            slider("Bleed", .halationRadius, printed: "h/\(Int((1 / t.halationRadius).rounded()))")
            slider("From", .halationThreshold, printed: percent(t.halationThreshold),
                   hint: "The luminance a highlight has to reach before it bleeds.")
        }
    }

    /// What this preview can honestly show — said as a visible state, never a
    /// tooltip: the export carries what the screen cannot.
    private var showable: (text: String, warn: Bool)? {
        guard previewDraws, on, t.grain > 0, let height = previewHeight, height > 0 else { return nil }
        let shown = grainShowable(t, height)
        let px = String(format: "%.1f", shown.cellPixels)
        if !shown.showable {
            return ("Finer than this preview can show (\(px) px a cell) — it will be there in the export.", true)
        }
        if shown.cellPixels < fadeCellPx {
            return ("A grain cell is \(px) px here — drawn at part strength. Judge it in the loupe.", false)
        }
        return ("A grain cell is \(px) px on this preview.", false)
    }

    private func slider(_ label: String, _ key: FilmTextureKey, printed: String, hint: String? = nil) -> some View {
        let range = textureRanges[key] ?? FilmRange(min: 0, max: 1, step: 0.01)
        return VStack(alignment: .leading, spacing: 2) {
            DevelopRangeSlider(label, value: t[key], in: range.min...range.max, step: range.step,
                               reset: defaultFilmTexture[key], printed: printed) { value in
                var next = t
                next[key] = value
                texture = next
            }
            if let hint {
                Text(hint)
                    .font(Brand.sans(11))
                    .foregroundStyle(palette.faint)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func note(_ text: String, tone: Color) -> some View {
        Text(text)
            .font(Brand.sans(11))
            .foregroundStyle(tone)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func percent(_ v: Double) -> String {
        "\(Int((v * 100).rounded()))%"
    }
}

#Preview("Texture") {
    DevelopPreviewState(FilmTexture?.some(textureOf(FilmStockId.negativePortrait.rawValue))) { texture in
        FilmTextureDialsView(texture: texture, previewHeight: 900)
    }
    .darkroom()
}
