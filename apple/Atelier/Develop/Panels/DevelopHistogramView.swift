// The strip over the sliders — port of `src/shared/develop/DevelopHistogram.tsx`:
// where the picture's light sits, dark to light, PER CHANNEL, and — in words,
// at each end — how much has gone to black or to white.
//
// The three channels are three areas blended as light blends (screen): where
// all three overlap the strip goes to white, where one stands alone it wears
// its own colour — so a red channel gone to 255 under a sky that still reads
// mid grey is seen, which a luminance strip hid (audit item 15). The shape is
// scaled on its inner bins (`channelShapes`), so a sky blown out does not
// flatten the rest; the clip marks — a bar at the end that has lost detail,
// and the words under it — are what say it. Fixed colours on purpose: the
// frame is dark in every theme, and a channel is its colour.
//
// Where the host can paint the clipping ON the picture (`onClipping`), the
// two end words are that switch — Lightroom's triangles; J is the workbench's
// key for the same switch (the shell binds it). Where it hands a `readout`,
// the pixel under the pointer is said between them — in its own small view,
// subscribed to the store, so a pointer move redraws that line and nothing
// else.

import SwiftUI
import AtelierKit

struct DevelopHistogramView: View {
    let histogram: Histogram?
    let clipping: Bool
    let onClipping: (() -> Void)?
    let readout: ReadoutStore?
    @Environment(\.palette) private var palette

    /// - Parameters:
    ///   - histogram: the picture as it will be delivered, nil before it is read.
    ///   - clipping: the clipping view is on.
    ///   - onClipping: turn it on or off; nil where the host does not paint it.
    ///   - readout: the pixel under the pointer, where the host reads one.
    init(histogram: Histogram?, clipping: Bool = false, onClipping: (() -> Void)? = nil, readout: ReadoutStore? = nil) {
        self.histogram = histogram
        self.clipping = clipping
        self.onClipping = onClipping
        self.readout = readout
    }

    /// Red, green and blue as the web draws them.
    private static let red = Color(.sRGB, red: 1, green: 0x4A / 255, blue: 0x3D / 255, opacity: 1)
    private static let green = Color(.sRGB, red: 0x3F / 255, green: 0xD4 / 255, blue: 0x6B / 255, opacity: 1)
    private static let blue = Color(.sRGB, red: 0x3F / 255, green: 0x7D / 255, blue: 1, opacity: 1)

    private var blacks: String? { histogram.flatMap { clipLabel($0.crushedShadows) } }
    private var whites: String? { histogram.flatMap { clipLabel($0.clippedHighlights) } }

    private var described: String {
        guard histogram != nil else { return "RGB histogram, not read yet" }
        var s = "RGB histogram"
        if let blacks { s += ", \(blacks) crushed to black" }
        if let whites { s += ", \(whites) clipped to white" }
        return s
    }

    private var switchHelp: String {
        clipping ? "Hide the clipping on the picture (J)" : "Show on the picture what has gone to white and to black (J)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            strip
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                end(blacks.map { "blacks \($0)" } ?? "blacks —", lit: blacks != nil, tone: palette.developInfo)
                Spacer(minLength: 4)
                if let readout {
                    ReadoutLine(store: readout)
                }
                Spacer(minLength: 4)
                end(whites.map { "whites \($0)" } ?? "whites —", lit: whites != nil, tone: palette.accentInk)
            }
            .font(Brand.mono(10))
            .monospacedDigit()
        }
        .padding(.vertical, 8)
    }

    private var strip: some View {
        var shapes: (red: [Double], green: [Double], blue: [Double])?
        if let h = histogram, h.total > 0 { shapes = channelShapes(h) }
        let blacksLit = blacks != nil
        let whitesLit = whites != nil
        return ZStack {
            palette.frame
            if let shapes {
                Canvas { context, size in
                    context.blendMode = .screen
                    for (heights, colour) in [(shapes.red, Self.red), (shapes.green, Self.green), (shapes.blue, Self.blue)] {
                        context.fill(Self.area(heights, size), with: .color(colour.opacity(0.85)))
                    }
                }
                .padding(.horizontal, 6)
                .padding(.top, 6)
            }
            HStack(spacing: 0) {
                Rectangle().fill(blacksLit ? palette.developInfo : Color.clear).frame(width: 4)
                Spacer(minLength: 0)
                Rectangle().fill(whitesLit ? palette.accent : Color.clear).frame(width: 4)
            }
        }
        .frame(height: 56)
        .clipShape(RoundedRectangle(cornerRadius: Brand.controlRadius))
        .accessibilityElement()
        .accessibilityLabel(described)
    }

    /// One channel as an area: a step per bin, the floor at the bottom.
    private static func area(_ heights: [Double], _ size: CGSize) -> Path {
        var path = Path()
        guard !heights.isEmpty else { return path }
        let n = CGFloat(heights.count)
        path.move(to: CGPoint(x: 0, y: size.height))
        for (i, v) in heights.enumerated() {
            let y = size.height * CGFloat(1 - v)
            path.addLine(to: CGPoint(x: size.width * CGFloat(i) / n, y: y))
            path.addLine(to: CGPoint(x: size.width * CGFloat(i + 1) / n, y: y))
        }
        path.addLine(to: CGPoint(x: size.width, y: size.height))
        path.closeSubpath()
        return path
    }

    /// An end's words — the clipping switch where the host paints it, else plain words.
    @ViewBuilder
    private func end(_ text: String, lit: Bool, tone: Color) -> some View {
        let ink = lit ? tone : palette.faint
        if let onClipping {
            Button(action: onClipping) {
                Text(text)
                    .underline(clipping)
                    .foregroundStyle(ink)
                    .lineLimit(1)
            }
            .buttonStyle(.plain)
            .fixedSize()
            .accessibilityAddTraits(clipping ? .isSelected : [])
            .help(switchHelp)
        } else {
            Text(text)
                .foregroundStyle(ink)
                .lineLimit(1)
                .fixedSize()
        }
    }
}

/// The pixel under the pointer. Subscribed to the store on its own, so a
/// pointer move re-renders this line and nothing else — the web's
/// `useSyncExternalStore` line.
private struct ReadoutLine: View {
    let store: ReadoutStore
    @State private var at: StageReadout?
    @State private var unsubscribe: (() -> Void)?
    @Environment(\.palette) private var palette

    var body: some View {
        Text(words)
            .foregroundStyle(ink)
            .lineLimit(1)
            .truncationMode(.tail)
            .onAppear {
                at = store.get()
                unsubscribe?()
                unsubscribe = store.subscribe {
                    DispatchQueue.main.async { at = store.get() }
                }
            }
            .onDisappear {
                unsubscribe?()
                unsubscribe = nil
            }
    }

    private var words: String {
        guard let at else { return "" }
        return (at.before ? "before · " : "") + readoutLabel(at.readout)
    }

    private var ink: Color {
        guard let at, case .clip(let clip) = at.readout else { return palette.muted }
        return clip == .white ? palette.accentInk : palette.developInfo
    }
}

#Preview("Histogram") {
    DevelopPreviewState(false) { clipping in
        DevelopHistogramView(histogram: DevelopPanelFixtures.histogram, clipping: clipping.wrappedValue,
                             onClipping: { clipping.wrappedValue.toggle() }, readout: DevelopPanelFixtures.readout)
        DevelopHistogramView(histogram: nil)
    }
}
