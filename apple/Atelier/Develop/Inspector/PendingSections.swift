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

// =============================================================================
// MARK: - REPAIR — owned by the Repair task (`Develop/Repair/*`): heal, clone,
// the dust field and its proposals. Delete when it lands.
// =============================================================================

struct RepairSectionPlaceholder: View {
    @Bindable var editor: RollEditor
    var body: some View {
        let patches = readPatches(editor.picture?.carried["repair"])
        ComingSection(id: "repair", title: "Repair",
                      text: patches.isEmpty
                          ? "Heal and clone spots, and find the dust on the sensor — coming with their own task."
                          : "\(describePatches(patches)) from the web app — kept, and not drawn here yet. Repair comes with its own task.")
    }
}

struct RepairStageOverlay: View {
    let context: StageOverlayContext
    var body: some View { PendingOverlayChip(text: "repair is coming with its own task") }
}

// MARK: - the overlays' shared stand-in

/// A chip on the stage saying a tool's overlay is not built yet — never a
/// silent stage.
struct PendingOverlayChip: View {
    let text: String
    @Environment(\.palette) private var palette

    var body: some View {
        VStack {
            Text(text)
                .font(Brand.mono(11))
                .foregroundStyle(palette.inkSoft)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(palette.surface.opacity(0.86), in: Capsule())
                .padding(10)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .allowsHitTesting(false)
    }
}
