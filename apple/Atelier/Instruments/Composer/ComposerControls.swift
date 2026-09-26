// The Composer's controls — the web's control card, row for row and word
// for word: Aspect (and HD / Full HD), Layout, Split or Inset and its
// corner, Video cover / contain, Map zoom, Follow, the Look, and the readout
// card (shown / hidden, labels, its fields, text and background colours,
// the background's opacity, radius, size, font). Chips wrap like the web's
// `flex-wrap` rows.

import CoreGraphics
import SwiftUI
import AtelierKit

struct ComposerControls: View {
    let model: ComposerModel
    @Environment(\.palette) private var palette

    private static let qualities: [(id: String, long: Double)] = [("HD", 1280), ("Full HD", 1920)]
    private static let layouts: [(id: LayoutKind, label: String)] = [
        (.sideBySide, "Side by side"), (.stacked, "Stacked"), (.pipMap, "Map inset"), (.pipVideo, "Video inset"),
    ]
    private static let corners: [(id: Corner, label: String)] = [(.tl, "↖"), (.tr, "↗"), (.bl, "↙"), (.br, "↘")]

    var body: some View {
        let s = model.settings
        let isPip = s.layout == .pipMap || s.layout == .pipVideo
        InstrumentBar {
            InstrumentFlow {
                InstrumentRowLabel("Aspect").frame(width: 60, alignment: .leading)
                ForEach(ComposerAspect.all) { aspect in
                    InstrumentChip(title: aspect.id, pressed: s.aspectW == aspect.w && s.aspectH == aspect.h) {
                        model.settings.aspectW = aspect.w
                        model.settings.aspectH = aspect.h
                    }
                }
                Color.clear.frame(width: 6, height: 1)
                ForEach(Self.qualities, id: \.id) { q in
                    InstrumentChip(title: q.id, pressed: s.quality == q.long) { model.settings.quality = q.long }
                }
            }
            InstrumentFlow {
                InstrumentRowLabel("Layout").frame(width: 60, alignment: .leading)
                ForEach(Self.layouts, id: \.id) { l in
                    InstrumentChip(title: l.label, pressed: s.layout == l.id) { model.settings.layout = l.id }
                }
            }
            InstrumentFlow {
                if isPip {
                    slider("Inset", value: \.inset, range: 0.15...0.5, step: 0.01, width: 130)
                    ForEach(Self.corners, id: \.id) { c in
                        InstrumentChip(title: c.label, pressed: s.corner == c.id) { model.settings.corner = c.id }
                            .accessibilityLabel("Inset corner \(c.id.rawValue)")
                    }
                } else {
                    slider("Split", value: \.split, range: 0.2...0.8, step: 0.01, width: 150)
                }
                InstrumentRowLabel("Video")
                InstrumentChip(title: "cover", pressed: s.videoFit == .cover) { model.settings.videoFit = .cover }
                InstrumentChip(title: "contain", pressed: s.videoFit == .contain) { model.settings.videoFit = .contain }
                slider("Map zoom", value: \.zoomOffset, range: -4...4, step: 0.5, width: 130)
                InstrumentChip(title: s.follow ? "Follow: on" : "Follow: off", pressed: s.follow) {
                    model.settings.follow.toggle()
                }
                .help("Keep the map centred on the aircraft as the clip plays")
            }
            Hairline()
            InstrumentLookControls(look: model.look, showsRender: false)
            Hairline()
            overlayRows(s)
        }
    }

    // MARK: - the readout card

    @ViewBuilder
    private func overlayRows(_ s: ComposerSettings) -> some View {
        InstrumentFlow {
            InstrumentRowLabel("Overlay").frame(width: 60, alignment: .leading)
            InstrumentChip(title: s.overlay.show ? "shown" : "hidden", pressed: s.overlay.show) {
                model.settings.overlay.show.toggle()
            }
            InstrumentChip(title: "labels", pressed: s.overlay.labels) { model.settings.overlay.labels.toggle() }
                .help("Show the field label prefixes")
            Color.clear.frame(width: 4, height: 1)
            ForEach(composerOverlayFields, id: \.id) { field in
                let on = s.overlay.fields[field.id] == true
                InstrumentChip(title: field.label, pressed: on) {
                    model.settings.overlay.fields[field.id] = !on
                }
            }
        }
        InstrumentFlow {
            colour("Text", hex: \.textColor, label: "Text colour")
            colour("Bg", hex: \.bgColor, label: "Background colour")
            overlaySlider("Opacity", value: \.bgOpacity, range: 0...1, step: 0.05, width: 90, hideLabel: true)
                .accessibilityLabel("Background opacity")
            overlaySlider("Radius", value: \.radius, range: 0...32, step: 1, width: 90)
            overlaySlider("Size", value: \.fontScale, range: 0.6...2.2, step: 0.1, width: 90)
            InstrumentRowLabel("Font")
            ForEach(ComposerOverlayFont.allCases, id: \.self) { font in
                InstrumentChip(title: font.rawValue, pressed: s.overlay.font == font) {
                    model.settings.overlay.font = font
                }
            }
        }
    }

    // MARK: - pieces

    private func slider(_ title: String, value: WritableKeyPath<ComposerSettings, Double>,
                        range: ClosedRange<Double>, step: Double, width: CGFloat) -> some View {
        let binding = Binding<Double>(
            get: { model.settings[keyPath: value] },
            set: { model.settings[keyPath: value] = $0 }
        )
        return HStack(spacing: 8) {
            InstrumentRowLabel(title)
            Slider(value: binding, in: range, step: step)
                .tint(palette.accent)
                .frame(width: width)
                .accessibilityLabel(title)
        }
    }

    private func overlaySlider(_ title: String, value: WritableKeyPath<ComposerOverlayConfig, Double>,
                               range: ClosedRange<Double>, step: Double, width: CGFloat,
                               hideLabel: Bool = false) -> some View {
        let binding = Binding<Double>(
            get: { model.settings.overlay[keyPath: value] },
            set: { model.settings.overlay[keyPath: value] = $0 }
        )
        return HStack(spacing: 8) {
            if !hideLabel { InstrumentRowLabel(title) }
            Slider(value: binding, in: range, step: step)
                .tint(palette.accent)
                .frame(width: width)
                .accessibilityLabel(title)
        }
    }

    /// A colour well over the card's `#rrggbb` — the web's `<input type=color>`.
    private func colour(_ title: String, hex: WritableKeyPath<ComposerOverlayConfig, String>,
                        label: String) -> some View {
        let binding = Binding<CGColor>(
            get: { CSSColor.parse(model.settings.overlay[keyPath: hex]) ?? CSSColor.black },
            set: { model.settings.overlay[keyPath: hex] = composerHex($0) }
        )
        return HStack(spacing: 6) {
            InstrumentRowLabel(title)
            ColorPicker(label, selection: binding, supportsOpacity: false)
                .labelsHidden()
        }
    }
}

/// `#rrggbb` for a colour, through sRGB — what `<input type=color>` writes.
func composerHex(_ color: CGColor) -> String {
    let srgb = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
    let converted = color.converted(to: srgb, intent: .defaultIntent, options: nil) ?? color
    let parts = converted.components ?? []
    let channels: [CGFloat]
    if parts.count >= 3 {
        channels = [parts[0], parts[1], parts[2]]
    } else if let grey = parts.first {
        channels = [grey, grey, grey]
    } else {
        channels = [0, 0, 0]
    }
    let bytes = channels.map { Int((min(1, max(0, $0)) * 255).rounded()) }
    return String(format: "#%02x%02x%02x", bytes[0], bytes[1], bytes[2])
}

/// Rows that wrap, as the web's `flex flex-wrap` bars do.
struct InstrumentFlow: Layout {
    var spacing: CGFloat = 6
    var lineSpacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let limit = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var line: CGFloat = 0
        var widest: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0, x + size.width > limit {
                y += line + lineSpacing
                x = 0
                line = 0
            }
            x += size.width + spacing
            line = max(line, size.height)
            widest = max(widest, x - spacing)
        }
        let width = proposal.width ?? widest
        return CGSize(width: width, height: y + line)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var line: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                y += line + lineSpacing
                x = bounds.minX
                line = 0
            }
            view.place(at: CGPoint(x: x, y: y), anchor: .topLeading, proposal: ProposedViewSize(size))
            x += size.width + spacing
            line = max(line, size.height)
        }
    }
}

#Preview("Composer controls") {
    ScrollView {
        ComposerControls(model: ComposerModel()).padding()
    }
}
