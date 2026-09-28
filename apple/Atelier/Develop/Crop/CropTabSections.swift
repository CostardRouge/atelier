// The Develop inspector's CROP tab, in the web's order (`PictureWorkbench.tsx`:
// `CropPanel` — Crop, Apply crop to…, and its `BorderSection` — then
// `KeystonePanel` and `LensPanel`):
//
//   Crop               format · shape + swap · straighten · Level · turn · flip
//   Apply crop to…     folded; this crop onto the selection, else the others
//   (the picture as delivered, on its border, small)
//   Borders            folded; file format · fill · margins
//   Apply borders to…  folded; never the crop
//   Perspective        vertical · horizontal · turn · stretch · zoom
//   Lens               the measured profile, then the six sliders
//
// The post-crop vignette is on the Adjust tab, as on the web. The zone itself
// is on the stage (`CropStageOverlay`), which the tab's tool holds while the
// tab is open (`RollEditor.syncCropTool`).

import SwiftUI
import AtelierKit

struct CropTabSections: View {
    @Bindable var editor: RollEditor

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            CropSection(editor: editor)
            CropApplyFold.crop(editor)
            BorderSection(editor: editor)
            PerspectiveSection(keystone: editor.keystoneBinding)
            LensSection(editor: editor)
        }
    }
}

#Preview("Crop tab") {
    DevelopPreviewState(true) { _ in
        CropTabPreview()
    }
}

private struct CropTabPreview: View {
    var body: some View {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("atelier-preview")
        let store = RollStore(root: root)
        let editor = RollEditor(store: store, pool: PicturePool(store: store), presets: PresetBookStore(root: root),
                                rollId: "preview")
        return CropTabSections(editor: editor)
    }
}
