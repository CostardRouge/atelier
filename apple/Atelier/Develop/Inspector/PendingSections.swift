// PENDING SECTIONS — the stand-ins the inspector and the stage call until the
// tasks that own them land. ONE file on purpose: each block below names the
// task that replaces it and the folder its real views live in; that task
// DELETES ITS BLOCK (the last one deletes the file). The names and the
// initialisers here are the CONTRACT `InspectorView` and `StageOverlaySlot`
// call — a task whose view takes other arguments changes the one call line in
// `InspectorView.swift` / `DevelopTool.swift`, not the other way round.
//
// The Adjust sections are NOT here: they landed in `Develop/Panels/` and the
// inspector draws them. Where Develop v0 already did the job, its working
// controls are kept below (aspect + straighten + mirror, one picture's
// JPEG/HEIC export), so the app never loses a feature between two merges.
// Everything else SAYS what is coming — never a blank.

import Photos
import SwiftUI
import UniformTypeIdentifiers
import AtelierKit

// MARK: - A small shared face for a section not built yet

/// A section that is coming: its name, what it will hold, and where the web
/// already has it — in the inspector's own fold frame.
struct ComingSection: View {
    let id: String
    let title: String
    let text: String
    @Environment(\.palette) private var palette

    var body: some View {
        DevelopSection(id: id, title: title) {
            Text(text)
                .font(Brand.sans(13))
                .foregroundStyle(palette.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

// =============================================================================
// MARK: - LOOK — owned by the Looks task (run-sheet #11). Delete when it lands.
// =============================================================================

/// The picture's own look: LUT layers, the output transform, film texture.
struct LookSectionPlaceholder: View {
    @Bindable var editor: RollEditor
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ApplySection(editor: editor, verbs: editor.lookApplyVerbs, title: "Apply look to…", id: "look-apply")
            ComingSection(id: "look", title: "Look",
                          text: editor.picture?.grade != nil
                              ? "This picture wears a look set in the web app — kept, and not drawn here yet: the looks (built-in LUTs, your vault, film stocks) come with their own task."
                              : "This picture's own look, applied AFTER its correction — the built-in LUTs, your vault and the film stocks come with their own task.")
        }
    }
}
