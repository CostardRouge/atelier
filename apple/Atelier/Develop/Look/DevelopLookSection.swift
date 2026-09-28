// Develop's LOOK section — the web's `DevelopLookSection` as the Develop tool
// draws it (`PictureWorkbench.tsx`): the picture's own look under its
// correction, its `Apply look to…` verbs at the head, and the grade panel
// (`Look/GradeStackView.swift`) bound to the OPEN picture's look (roll v5,
// `RollEditor+Look.swift`). The last block of the Adjust tab, as on the web.
//
// `LookSectionPlaceholder` is the name `InspectorView` calls (the shell's
// contract, `PendingSections.swift`); it is this view now.

import SwiftUI
import AtelierKit

typealias LookSectionPlaceholder = DevelopLookSection

struct DevelopLookSection: View {
    @Bindable var editor: RollEditor
    @Environment(\.palette) private var palette

    var body: some View {
        DevelopSection(
            id: "look",
            title: "Look",
            info: [
                "This picture’s own look, applied AFTER its correction — the next picture keeps its own, and Apply look to… is the one way to dress others with it. Looks apply top to bottom and the output transform last.",
            ],
            marked: editor.picture?.grade != nil
        ) {
            let verbs = editor.lookApplyVerbs
            if !verbs.isEmpty {
                PresetChipFlow(spacing: 8) {
                    ForEach(verbs) { verb in
                        Button(verb.label) {
                            verb.run()
                            editor.tell("done · \(verb.label.lowercased())")
                        }
                        .buttonStyle(DevelopPillButtonStyle())
                        .help(verb.hint)
                    }
                }
            }
            GradeStackView(
                grade: editor.gradeBinding,
                picture: editor.lookPicture,
                previewHeight: editor.lookPreviewHeight,
                previewDraws: editor.lookPreviewDraws
            )
            // A picture's look is its own: what the panel resolved for one
            // picture never lingers on the next.
            .id(editor.openId)
        }
    }
}
