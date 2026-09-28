// The picture as the FILE will be — the crop on its border — small, in the
// panel. Port of `DeliveredPreview` (`src/tools/develop/BorderSection.tsx`):
// the crop stage shows the whole picture for cropping, so this is the one
// place the border is seen while it is set. Drawn by the export's own painter
// (`BorderPainter.drawDelivered`), from the stage's render of the whole
// picture, 240 pt on its long side; repainted when the picture, the crop or
// the border changes, never per body evaluation.

import CoreGraphics
import SwiftUI
import AtelierKit

struct DeliveredPreview: View {
    @Bindable var editor: RollEditor
    @Environment(\.palette) private var palette
    @Environment(\.displayScale) private var displayScale
    @State private var rendered: CGImage?

    /// The web's `PREVIEW_EDGE`.
    static let edge = 240.0

    var body: some View {
        if editor.cropZone != nil {
            VStack(spacing: 6) {
                if let rendered {
                    Image(decorative: rendered, scale: displayScale, orientation: .up)
                        .shadow(color: palette.frame.opacity(0.25), radius: 1.5, y: 1)
                        .accessibilityLabel("What the export delivers")
                } else {
                    Color.clear.frame(height: 40)
                }
                Text(line)
                    .font(Brand.mono(10))
                    .monospacedDigit()
                    .foregroundStyle(palette.muted)
            }
            .frame(maxWidth: .infinity)
            .padding(8)
            .background(palette.paper2, in: RoundedRectangle(cornerRadius: Brand.controlRadius))
            .overlay(RoundedRectangle(cornerRadius: Brand.controlRadius).stroke(palette.line, lineWidth: 1))
            .padding(.vertical, 10)
            .task(id: key) { rendered = paint() }
        }
    }

    private var line: String {
        editor.borderDeliveredSize.map { "delivers \($0.width) × \($0.height) px" } ?? "what the export delivers"
    }

    /// What decides the painting: the render, the crop, the border, the screen.
    private var key: String {
        let stage = editor.cropWholeStage.map { "\(ObjectIdentifier($0).hashValue)" } ?? "none"
        let framing = editor.picture?.framing?.json.serialized() ?? ""
        let border = editor.picture?.border?.json.serialized() ?? ""
        return "\(stage)|\(editor.cropAspect)|\(framing)|\(border)|\(displayScale)"
    }

    private func paint() -> CGImage? {
        guard let src = editor.cropSrc, let zone = editor.cropZone, let image = editor.cropWholeStage else { return nil }
        let border = editor.picture?.border
        let full = borderLayout(zone.w, zone.h, border)
        let long = max(full.w, full.h)
        guard long > 0 else { return nil }
        let k = DeliveredPreview.edge / long
        let scale = Double(displayScale)
        let width = max(1, Int((full.w * k * scale).rounded()))
        let height = max(1, Int((full.h * k * scale).rounded()))
        guard let ctx = OverlayRaster.makeContext(width: width, height: height) else { return nil }
        let layout = scaleLayout(full, Double(width) / full.w)
        let picture = PaintPicture(image, width: src.width, height: src.height)
        BorderPainter.drawDelivered(in: ctx, picture, editor.cropFraming, layout, border: border)
        return ctx.makeImage()
    }
}
