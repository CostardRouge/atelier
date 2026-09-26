// The outro — the closing card the export appends after the footage. Port of
// `src/tools/studio/OutroPanel.tsx`.
//
// A project is intro · footage · closing card (`docs/memory/studio.md`): the
// card is APPENDED, never drawn over the footage; audio ends with the
// footage; clean variants ship without it. The stage cannot show it (the
// playhead cannot travel past the clip), so the panel carries its own
// preview, painted by the very renderer the export uses (`OutroPainter`), at
// the card's midpoint — an entrance has played, an exit has not.
//
// Editing is by line for now: the words, how long it holds, its ground and
// the QR link (a link too long to encode is refused with a sentence, never
// truncated into a code that scans to half a URL); free placement on a stage
// of its own is the agreed later step.

import SwiftUI
import AtelierKit

struct OutroPanelView: View {
    @Binding private var outro: OutroCard
    private let aspect: Double
    private let onRemove: () -> Void

    @State private var painter = OverlayPainter()
    @State private var confirming = false
    @Environment(\.palette) private var palette

    private typealias P = OverlayPanels

    /// - Parameters:
    ///   - aspect: the project's destination ratio (width / height) — what the preview composes for.
    ///   - onRemove: takes the card off the project; called once confirmed.
    init(outro: Binding<OutroCard>, aspect: Double, onRemove: @escaping () -> Void) {
        _outro = outro
        self.aspect = aspect
        self.onRemove = onRemove
    }

    var body: some View {
        let prepared = prepareOutro(outro)
        return VStack(alignment: .leading, spacing: 12) {
            OverlayPanelRow("Preview", alignTop: true) {
                preview(prepared)
            }
            OverlayPanelRow("Holds for") {
                OverlayPanelNumberField("Outro duration in seconds", value: outro.seconds, step: 0.5, range: 1...15,
                                        unit: "s") { v in
                    outro = P.outroSeconds(outro, v)
                }
            }
            OverlayPanelColourRow("Ground", css: outro.background, readout: outro.background) { hex in
                var next = outro
                next.background = hex
                outro = next
            }
            lineRows
            OverlayPanelRow("") {
                Button {
                    outro = withOutroLine(outro)
                } label: {
                    Label("Line", systemImage: "plus")
                }
                .buttonStyle(DevelopLinkButtonStyle())
                .accessibilityLabel("Add a line")
            }
            OverlayPanelRow("QR link", hint: prepared.qrProblem, tone: .problem) {
                OverlayPanelTextInput("QR link", text: outro.qr?.url ?? "", placeholder: "https://… — empty means no QR",
                                      isLink: true) { url in
                    outro = P.outroWithQrUrl(outro, url, aspect: aspect)
                }
            }
            OverlayPanelRow("Card", hint: "Appended after the footage on variants that carry the overlays; the card plays silent.") {
                Button("Remove the outro") { confirming = true }
                    .buttonStyle(OverlayPanelDangerButtonStyle())
            }
        }
        .confirmationDialog("Remove the closing card?", isPresented: $confirming, titleVisibility: .visible) {
            Button("Remove the outro", role: .destructive) { onRemove() }
            Button("Keep", role: .cancel) {}
        }
    }

    /// The card at its midpoint, 120 points wide at the project's ratio.
    private func preview(_ prepared: PreparedOutro) -> some View {
        let width: CGFloat = 120
        let ratio = aspect.isFinite && aspect > 0 ? aspect : 9.0 / 16
        let height = max(1, (width / CGFloat(ratio)).rounded())
        let t = outro.seconds / 2
        return Canvas(opaque: true, rendersAsynchronously: false) { context, size in
            context.withCGContext { cg in
                OutroPainter.draw(prepared, in: cg, size: size, tSeconds: t, painter: painter)
            }
        }
        .frame(width: width, height: height)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(palette.line, lineWidth: 1))
        .accessibilityLabel("Outro card preview")
    }

    @ViewBuilder
    private var lineRows: some View {
        let lines = P.outroLines(outro)
        ForEach(lines.indices, id: \.self) { i in
            let line = lines[i]
            OverlayPanelRow("Line \(i + 1)") {
                OverlayPanelTextInput("Outro line \(i + 1)", text: line.text ?? "") { text in
                    outro = P.outroWithLineText(outro, line.id, text)
                }
                Button {
                    outro = P.outroWithoutLine(outro, line.id)
                } label: {
                    Image(systemName: "xmark")
                        .font(Brand.sans(11, weight: .semibold))
                        .foregroundStyle(palette.muted)
                        .frame(width: 26, height: 26)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help("Remove this line")
                .accessibilityLabel("Remove this line")
            }
        }
    }
}

// MARK: - previews

private struct OutroPanelPreview: View {
    @State private var outro = OverlayPanelFixtures.outro
    let aspect: Double

    init(aspect: Double) {
        self.aspect = aspect
    }

    var body: some View {
        DevelopPreviewState(true) { _ in
            OutroPanelView(outro: $outro, aspect: aspect, onRemove: {})
        }
    }
}

#Preview("Outro — a reel") { OutroPanelPreview(aspect: 9.0 / 16) }
#Preview("Outro — landscape") { OutroPanelPreview(aspect: 16.0 / 9) }
