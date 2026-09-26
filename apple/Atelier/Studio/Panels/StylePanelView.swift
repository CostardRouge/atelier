// The title-style picker — port of `src/shared/overlay/StylePanel.tsx`, the
// engine-level panel two tools wear: the Studio's project theme and Trips'
// badge theme (`docs/memory/roadtrip.md`: a tool never reaches into another,
// so the generic half lives with the overlay engine).
//
// Preset cards — Off, then the four looks (Neutral · Or ciné · Pixel CRT ·
// Rouge plein cadre) — each previewing the look on a dark swatch; picking one
// ADOPTS it as the theme, a copy the knobs below then tweak: the one glow
// ("bave") slider driving the four layers proportionally, its warmth, the
// ink, font, weight, emphasis (italic, uppercase — the CASE is applied to the
// string when drawn, never baked into the words), letter spacing, the size
// multiplier (never an absolute size, so a theme cannot explode a layout),
// legibility, and the advanced per-layer disclosure, where a touched layer
// leaves the slider until its reset hands it back.
//
// The cards are painted by the real renderer (`OverlayElementPreview`), where
// the web approximates them in CSS.

import SwiftUI
import AtelierKit

struct StylePanelView: View {
    @Binding private var theme: StyleTheme?
    private let heading: String?

    /// The four layers by hand — a disclosure of the panel's own, as the web's.
    @State private var advanced = false
    @State private var painter = OverlayPainter()
    @Environment(\.palette) private var palette

    private typealias P = OverlayPanels
    private typealias Option = OverlayPanelOption

    /// - Parameters:
    ///   - theme: the theme, nil for Off (every element keeps its own style).
    ///   - heading: the legend over the cards — `Style` by default; nil when
    ///     the host's section already says whose style it is (the web's
    ///     `heading={<></>}`, which both of its hosts pass).
    init(theme: Binding<StyleTheme?>, heading: String? = "Style") {
        _theme = theme
        self.heading = heading
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            cards
            if let theme {
                knobs(theme)
            }
        }
    }

    // MARK: - the cards

    private var cards: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let heading {
                Eyebrow(heading)
            }
            offCard
            ForEach(titleStylePresets.indices, id: \.self) { i in
                presetCard(titleStylePresets[i])
            }
        }
    }

    private var offCard: some View {
        let on = theme == nil
        return Button {
            theme = nil
        } label: {
            Text("Off — each element keeps its own style")
                .font(Brand.sans(12))
                .foregroundStyle(palette.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
                .modifier(TitleStyleCardFrame(on: on))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func presetCard(_ preset: TitleStylePreset) -> some View {
        let on = theme?.presetId == preset.id
        let swatchTheme = StyleTheme(presetId: preset.id, style: preset.style)
        // 0.95rem over a 2.2rem swatch, the web's card.
        let sample = OverlayElementPreview.centred(createTextElement("Alt 87m"), id: "style.\(preset.id)",
                                                   fontShare: 0.43, theme: swatchTheme)
        return Button {
            theme = themeFromPreset(preset.id)
        } label: {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 4).fill(palette.frame)
                    OverlayElementPreview(sample, theme: swatchTheme, painter: painter)
                }
                .frame(width: 74, height: 35)
                .clipShape(RoundedRectangle(cornerRadius: 4))
                VStack(alignment: .leading, spacing: 1) {
                    Text(verbatim: preset.name)
                        .font(Brand.sans(13, weight: .semibold))
                        .foregroundStyle(palette.ink)
                    Text(verbatim: preset.tagline)
                        .font(Brand.sans(11))
                        .foregroundStyle(palette.muted)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .modifier(TitleStyleCardFrame(on: on))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(preset.name): \(preset.tagline)")
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    // MARK: - the knobs

    private func patch(_ edit: (inout TitleStyle) -> Void) {
        guard var next = theme else { return }
        edit(&next.style)
        theme = next
    }

    @ViewBuilder
    private func knobs(_ theme: StyleTheme) -> some View {
        let style = theme.style
        VStack(alignment: .leading, spacing: 12) {
            glowRows(style)
            OverlayPanelColourRow("Ink", css: style.color, readout: style.color) { hex in patch { $0.color = hex } }
            OverlayPanelPicker("Font", selection: style.fontFamily, options: StylePanelView.fontOptions) { f in
                patch { $0.fontFamily = f }
            }
            OverlayPanelPicker("Weight", selection: style.weight, options: StylePanelView.weightOptions) { w in
                patch { $0.weight = w }
            }
            emphasisRow(style)
            DevelopRangeSlider("Spacing", value: style.letterSpacingEm, in: -0.05...0.2, step: 0.005, reset: 0,
                               printed: P.fixed(style.letterSpacingEm * 100, 0)) { v in patch { $0.letterSpacingEm = v } }
            DevelopRangeSlider("Size", value: style.sizeScale, in: 0.5...2, step: 0.05, reset: 1,
                               printed: P.percent(style.sizeScale)) { v in patch { $0.sizeScale = v } }
            OverlayPanelPicker("Legibility", selection: style.legibility.mode,
                               options: StylePanelView.legibilityOptions) { mode in
                patch { $0.legibility.mode = mode }
            }
            advancedRows(style)
        }
    }

    /// The bave slider: one amount drives the four glow layers.
    @ViewBuilder
    private func glowRows(_ style: TitleStyle) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            DevelopRangeSlider("Glow", value: style.glowAmount, in: 0...1, step: 0.01, reset: presetValue(\.glowAmount),
                               printed: P.plain(DevelopNumbers.jsRound(style.glowAmount * 100))) { v in
                patch { $0.glowAmount = v }
            }
            OverlayPanelHint("Matte → fluo.")
        }
        VStack(alignment: .leading, spacing: 4) {
            DevelopRangeSlider("Warmth", value: style.glowWarmth, in: 0...1, step: 0.05, reset: presetValue(\.glowWarmth),
                               printed: P.percent(style.glowWarmth)) { v in patch { $0.glowWarmth = v } }
            OverlayPanelHint("Halation drift.")
        }
    }

    private func emphasisRow(_ style: TitleStyle) -> some View {
        OverlayPanelRow("Emphasis") {
            OverlayPanelToggle("Italic", isOn: style.italic, words: nil) { on in patch { $0.italic = on } }
            Text("Italic")
                .font(Brand.display(14, italic: true))
                .foregroundStyle(palette.inkSoft)
            OverlayPanelToggle("Uppercase", isOn: style.uppercase, words: nil) { on in patch { $0.uppercase = on } }
            Text(verbatim: "AA")
                .font(Brand.sans(12, weight: .semibold))
                .foregroundStyle(palette.inkSoft)
        }
    }

    /// Advanced: the four layers, hand-tuned. A layer follows the slider
    /// until touched; its reset hands it back.
    @ViewBuilder
    private func advancedRows(_ style: TitleStyle) -> some View {
        OverlayPanelRow("Glow layers") {
            OverlayPanelToggle("Show the four glow layers", isOn: advanced, words: "Tune by hand") { on in
                withAnimation(.easeOut(duration: 0.15)) { advanced = on }
            }
        }
        if advanced {
            let layers = glowLayersFor(style)
            ForEach(P.GlowLayer.allCases, id: \.self) { layer in
                layerRow(layer, style: style, layers: layers)
            }
            OverlayPanelHint("Layers follow the glow slider until you touch one; the reset hands a layer back to the slider.")
        }
    }

    private func layerRow(_ layer: P.GlowLayer, style: TitleStyle, layers: GlowLayers) -> some View {
        // The slider's own reset is the value the glow slider derives: a
        // press there hands the layer back, as the web's reset button does.
        var derivedStyle = style
        derivedStyle.glowLayers = nil
        let derived = layer.value(in: glowLayersFor(derivedStyle))
        let value = layer.value(in: layers)
        let tuned = layer.override(in: style) != nil
        return HStack(alignment: .bottom, spacing: 6) {
            DevelopRangeSlider(layer.label, value: value, in: 0...layer.max, step: layer.step, reset: derived,
                               printed: P.fixed(value, 3)) { v in
                patch { $0 = layer.setting(v, in: $0) }
            }
            if tuned {
                Button {
                    patch { $0 = layer.setting(nil, in: $0) }
                } label: {
                    Image(systemName: "arrow.uturn.backward")
                        .font(Brand.sans(11, weight: .semibold))
                        .frame(width: 22, height: 22)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(palette.accentInk)
                .help("Back to the slider-derived value")
                .accessibilityLabel("Back to the slider-derived value")
            }
        }
    }

    /// The adopted preset's own value of a knob — where the slider's reset goes.
    private func presetValue(_ path: KeyPath<TitleStyle, Double>) -> Double {
        guard let theme, let preset = presetById(theme.presetId) else { return 0 }
        return preset.style[keyPath: path]
    }

    // MARK: - the menus' words

    private static let fontOptions: [Option<OverlayFontFamily>] = curatedFonts.map { Option($0, $0.rawValue) }
    private static let weightOptions: [Option<FontWeight>] = OverlayPanels.weightOptions.map { Option($0.weight, $0.label) }
    private static let legibilityOptions: [Option<LegibilityMode>] = [
        Option(.none, "None"),
        Option(.shadow, "Drop shadow"),
        Option(.box, "Background box"),
    ]
}

/// A card's ground: the accent wash and line when it is the theme.
private struct TitleStyleCardFrame: ViewModifier {
    let on: Bool
    @Environment(\.palette) private var palette

    func body(content: Content) -> some View {
        content
            .background(on ? palette.accentWash : palette.paper, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(on ? palette.accent : palette.line, lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: 12))
    }
}

// MARK: - previews

private struct StylePanelPreview: View {
    @State private var theme: StyleTheme?
    let heading: String?

    init(_ theme: StyleTheme?, heading: String? = "Style") {
        _theme = State(initialValue: theme)
        self.heading = heading
    }

    var body: some View {
        DevelopPreviewState(true) { _ in
            StylePanelView(theme: $theme, heading: heading)
        }
    }
}

#Preview("Style — Or ciné") { StylePanelPreview(OverlayPanelFixtures.theme) }
#Preview("Style — Off, no legend") { StylePanelPreview(nil, heading: nil) }
