// The stage: the picture as it will be delivered, on the darkroom's frame,
// with what the picture SAYS (the histogram, the develop's own facts) drawn
// on it and toggled by `I` — never a control that could be mistaken for one.

import SwiftUI
import AtelierKit

struct DevelopStage: View {
    @Bindable var editor: RollEditor
    @Environment(\.palette) private var palette

    var body: some View {
        ZStack {
            palette.frame
            content
            overlays
        }
        .clipped()
    }

    @ViewBuilder
    private var content: some View {
        if let stage = editor.stage {
            Image(decorative: stage, scale: 1, orientation: .up)
                .resizable()
                .interpolation(.high)
                .aspectRatio(contentMode: .fit)
                .padding(12)
                // Hold to see the picture as shot; the bar's button latches it.
                .onLongPressGesture(minimumDuration: 0.15, pressing: { pressing in
                    editor.setCompare(pressing)
                }, perform: {})
                .opacity(editor.loading ? 0.6 : 1)
        } else if editor.loading {
            ProgressView().tint(palette.onMedia)
        } else if let problem = editor.problem {
            VStack(spacing: 6) {
                Image(systemName: "exclamationmark.triangle").font(.title2)
                Text(problem).multilineTextAlignment(.center)
            }
            .foregroundStyle(palette.onMedia)
            .padding(24)
        } else {
            VStack(spacing: 8) {
                Image(systemName: "photo").font(.largeTitle)
                Text(editor.pictures.isEmpty ? "Add pictures to this roll." : "Pick a picture in the strip.")
            }
            .foregroundStyle(palette.onMedia.opacity(0.7))
        }
    }

    private var overlays: some View {
        VStack {
            HStack(alignment: .top) {
                if editor.stageIsOriginal {
                    chip("As shot")
                } else if !editor.unrenderedStages.isEmpty {
                    chip("Without \(editor.unrenderedStages.joined(separator: ", ")) — not rendered here yet")
                }
                Spacer()
                if editor.showInfo, let histogram = editor.histogram {
                    HistogramView(histogram: histogram)
                }
            }
            Spacer()
            HStack(alignment: .bottom) {
                if editor.showInfo, editor.picture != nil {
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(Array(developLines(editor.picture?.develop).enumerated()), id: \.offset) { _, line in
                            Text(line)
                        }
                        if let size = editor.pictureSize {
                            Text("\(size.width) × \(size.height)")
                                .foregroundStyle(palette.onMedia.opacity(0.6))
                        }
                    }
                    .font(Brand.mono(11))
                    .foregroundStyle(palette.onMedia)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .background(Color.black.opacity(0.45), in: RoundedRectangle(cornerRadius: 8))
                }
                Spacer()
                if let note = editor.note {
                    chip(note)
                }
            }
        }
        .padding(16)
        .allowsHitTesting(false)
    }

    private func chip(_ text: String) -> some View {
        Text(text)
            .font(Brand.mono(11))
            .foregroundStyle(palette.onMedia)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(Color.black.opacity(0.45), in: Capsule())
    }
}

/// The luminance histogram, bars scaled on the tallest inner bin, the clipped
/// shares said in words beneath — the web's strip, on the stage.
struct HistogramView: View {
    let histogram: Histogram
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(alignment: .trailing, spacing: 4) {
            Canvas { context, size in
                let shape = histogramShape(histogram)
                guard !shape.isEmpty else { return }
                let step = size.width / CGFloat(shape.count)
                for (i, value) in shape.enumerated() {
                    let height = CGFloat(value) * size.height
                    let rect = CGRect(x: CGFloat(i) * step, y: size.height - height, width: max(1, step - 0.5), height: height)
                    context.fill(Path(rect), with: .color(palette.onMedia.opacity(0.85)))
                }
            }
            .frame(width: 160, height: 56)
            HStack {
                if let low = clipLabel(histogram.crushedShadows) {
                    Text("◂ \(low)")
                }
                Spacer()
                if let high = clipLabel(histogram.clippedHighlights) {
                    Text("\(high) ▸")
                }
            }
            .font(Brand.mono(10))
            .foregroundStyle(palette.onMedia.opacity(0.8))
            .frame(width: 160)
        }
        .padding(8)
        .background(Color.black.opacity(0.45), in: RoundedRectangle(cornerRadius: 8))
    }
}
