// PENDING OPENERS — the stand-ins the Look tab hosts for the opener's own
// views until the openers' task lands (the PendingTabs pattern: that task
// DELETES THIS FILE and defines the real views under the SAME names and
// initialisers). The Look tab owns the picker and where these sit; the
// openers' task owns what each variant draws and asks for.

import SwiftUI
import AtelierKit

// MARK: - owned by the openers' task (`hooks/scrub.tsx`, `hooks/map.tsx`,
// `hooks/drive.tsx`, `hooks/map-field.tsx`, `hooks/badge.tsx`,
// `hooks/panel-ui.tsx`, `HookPicturesModal.tsx`, `use-hook-pictures.ts`).

/// The opener's picker card: a small live sketch of what variant `variantId`
/// does, drawn from the kernel's plan.
struct OpenerSketchView: View {
    let variantId: String

    var body: some View {
        RoundedRectangle(cornerRadius: 6)
            .fill(.quaternary)
            .overlay(Text(variantId).font(Brand.mono(10)).foregroundStyle(.secondary))
            .aspectRatio(4.0 / 5.0, contentMode: .fit)
    }
}

/// The open opener's OPTIONS — Défilé's stops, the Itinerary's stops and its
/// picking map, Virée's drive and its garage verb — written through the model.
struct OpenerOptionsView: View {
    let model: PieceEditorModel

    var body: some View {
        PieceTabPending(title: "Opener",
                        text: "This opener's own options — its stops, its map, its drive — are coming with the openers' task.") {
            EmptyView()
        }
    }
}

/// The chooser of the pictures an opener flashes or pins: the Library and the
/// instance, by span and day, everything ticked to start.
struct OpenerPicturesSheet: View {
    let model: PieceEditorModel

    var body: some View {
        PieceTabPending(title: "Pictures",
                        text: "The opener's picture chooser is coming with the openers' task.") {
            EmptyView()
        }
        .padding(24)
    }
}
