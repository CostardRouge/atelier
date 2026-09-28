// "Apply crop to…" and "Apply borders to…" — the Crop tab's two batch folds
// (`CropPanel.tsx`, `BorderSection.tsx`): the maintainer's TWO verbs, never
// one, so a roll can wear one border over crops that each differ. Folded by
// default; drawn only while there is somewhere to apply to (a selection, else
// the other pictures of the roll). The verbs themselves are the editor's
// (`cropApplyVerbs` / `borderApplyVerbs`, one section through
// `applySections`, each target its own copy), and each says what it did.

import SwiftUI
import AtelierKit

struct CropApplyFold: View {
    @Bindable var editor: RollEditor
    let id: String
    let title: String
    let info: String
    let verbs: [ApplyVerb]
    @Environment(\.palette) private var palette

    var body: some View {
        if !verbs.isEmpty {
            DevelopSection(id: id, title: title, info: [info], defaultOpen: false) {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(verbs) { verb in
                        VStack(alignment: .leading, spacing: 3) {
                            Button(verb.label) {
                                verb.run()
                                editor.tell("done · \(verb.label.lowercased())")
                            }
                            .buttonStyle(DevelopPillButtonStyle())
                            Text(verb.hint)
                                .font(Brand.mono(10))
                                .foregroundStyle(palette.faint)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
        }
    }

    /// The crop's fold, in the web's words.
    static func crop(_ editor: RollEditor) -> CropApplyFold {
        CropApplyFold(editor: editor, id: "crop-apply", title: "Apply crop to…",
                      info: "This format, zone, rotation and flips written onto other pictures, now, each as its own copy. A zone that would fall off a picture of another shape is held at its edge.",
                      verbs: editor.cropApplyVerbs)
    }

    /// The border's fold, in the web's words.
    static func border(_ editor: RollEditor) -> CropApplyFold {
        CropApplyFold(editor: editor, id: "border-apply", title: "Apply borders to…",
                      info: "This border — or none — written onto other pictures, now, each as its own copy. Their crops are left as they are: a roll can wear one border over crops that each differ.",
                      verbs: editor.borderApplyVerbs)
    }
}

#Preview("Apply crop to…") {
    DevelopPreviewState(true) { _ in
        CropApplyFoldPreview()
    }
}

private struct CropApplyFoldPreview: View {
    var body: some View {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("atelier-preview")
        let store = RollStore(root: root)
        let editor = RollEditor(store: store, pool: PicturePool(store: store), presets: PresetBookStore(root: root),
                                rollId: "preview")
        let verbs = [ApplyVerb(id: "roll", label: "Apply crop to 11 other pictures",
                               hint: "the rest of this roll, each as its own copy", run: {})]
        return CropApplyFold(editor: editor, id: "preview.crop-apply", title: "Apply crop to…",
                             info: "Each as its own copy.", verbs: verbs)
    }
}
