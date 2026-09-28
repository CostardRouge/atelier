// The crop stage's ± pill — the web's `StageZoomControl` over `cropZoom`
// (`PictureWorkbench.tsx`): the stage's VIEW, never the crop (the zone's size
// IS the crop). Drawn at every width, the pinch's twin — a pinch can be taken
// away, the pill always answers (`frontend.md`). A step zooms about the middle
// of the view by `STAGE_ZOOM_STEP`; the percentage is the way back to the fit.
// Its shape is the Adjust stage's pill, so the bar never changes size between
// the two tabs.

import SwiftUI
import AtelierKit

struct CropZoomPill: View {
    @Bindable var editor: RollEditor
    var large = false
    @Environment(\.palette) private var palette

    var body: some View {
        let height: CGFloat = large ? 34 : 28
        let view = editor.cropView
        HStack(spacing: 0) {
            Button {
                editor.cropSetView { stepCropView($0, 1 / stageZoomStep) }
            } label: {
                Image(systemName: "minus").frame(width: height, height: height)
            }
            .disabled(view.zoom <= 1)
            .accessibilityLabel("Zoom out")
            Button {
                editor.cropSetView { _ in .fit }
            } label: {
                Text(zoomLabel(view.zoom))
                    .font(Brand.mono(11))
                    .monospacedDigit()
                    .frame(width: 52, height: height)
            }
            .disabled(view.zoom <= 1)
            .help("look closer: pinch, the wheel or Z — the crop stays")
            .accessibilityLabel("Back to the fit")
            Button {
                editor.cropSetView { stepCropView($0, stageZoomStep) }
            } label: {
                Image(systemName: "plus").frame(width: height, height: height)
            }
            .disabled(view.zoom >= cropViewMax - 1e-6)
            .accessibilityLabel("Zoom in")
        }
        .buttonStyle(.plain)
        .font(.system(size: 11, weight: .semibold))
        .foregroundStyle(palette.inkSoft)
        .background(palette.paper2, in: RoundedRectangle(cornerRadius: Brand.controlRadius))
        .overlay(RoundedRectangle(cornerRadius: Brand.controlRadius).stroke(palette.line, lineWidth: 1))
    }
}

#Preview("Crop zoom pill") {
    CropZoomPillPreview()
        .padding()
        .darkroom()
}

private struct CropZoomPillPreview: View {
    var body: some View {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("atelier-preview")
        let store = RollStore(root: root)
        let editor = RollEditor(store: store, pool: PicturePool(store: store), presets: PresetBookStore(root: root),
                                rollId: "preview")
        return VStack(spacing: 12) {
            CropZoomPill(editor: editor)
            CropZoomPill(editor: editor, large: true)
        }
    }
}
