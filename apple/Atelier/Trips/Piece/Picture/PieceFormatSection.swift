// The shape every slide of this deck is delivered in — the Format rows of the
// web's `src/tools/roadtrip/panels/PictureTab.tsx`: the aspect presets as
// glyph chips, from tallest to widest so a shape sits beside its neighbours,
// each drawn as its own outline. The frame is a property of the PIECE (one
// deck, one shape) and shows on every slide.

import SwiftUI
import AtelierKit

struct PieceFormatSection: View {
    let model: PieceEditorModel
    @Environment(\.palette) private var palette

    /// The formats from tallest to widest — the preset list itself stays in
    /// portrait/landscape pairs for the Studio's cards.
    static let formats: [AspectPreset] = aspectPresets.sorted { $0.w / $0.h < $1.w / $1.h }

    private static let columns = Array(repeating: GridItem(.flexible(), spacing: 6), count: 4)

    var body: some View {
        let current = model.post?.badge.aspectId
        DevelopSection(id: "piece.format", title: "Format", info: ["The shape every slide of this deck is delivered in."],
                       remember: .local) {
            OverlayPanelRow("Frame", alignTop: true) {
                LazyVGrid(columns: Self.columns, spacing: 6) {
                    ForEach(Self.formats, id: \.id) { format in
                        chip(format, on: current == format.id)
                    }
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel("Format")
            }
        }
    }

    private func chip(_ format: AspectPreset, on: Bool) -> some View {
        let shape = RoundedRectangle(cornerRadius: 8)
        return Button {
            model.patchBadge { $0.aspectId = format.id }
        } label: {
            VStack(spacing: 4) {
                PieceFormatGlyph(w: format.w, h: format.h)
                    .frame(height: 12)
                Text(format.id)
                    .font(Brand.mono(10))
                    .monospacedDigit()
            }
            .foregroundStyle(on ? palette.accentInk : palette.inkSoft)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
            .background(shape.fill(on ? palette.accentWash : palette.paper))
            .overlay(shape.stroke(on ? palette.accent : palette.lineStrong, lineWidth: 1))
            .contentShape(shape)
        }
        .buttonStyle(.plain)
        .help(format.label)
        .accessibilityLabel("\(format.id), \(format.label)")
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// A format drawn as its own outline, 12 points on its long side.
struct PieceFormatGlyph: View {
    let w: Double
    let h: Double

    var body: some View {
        let long = 12.0
        let width = w >= h ? long : DevelopNumbers.jsRound(long * w / h)
        let height = w >= h ? DevelopNumbers.jsRound(long * h / w) : long
        RoundedRectangle(cornerRadius: 1.5)
            .stroke(.foreground, lineWidth: 1.5)
            .frame(width: CGFloat(width), height: CGFloat(height))
            .accessibilityHidden(true)
    }
}

#Preview("Format") {
    DevelopPreviewState(0) { _ in
        PieceFormatSection(model: PieceEditorFixtures.model())
    }
}
