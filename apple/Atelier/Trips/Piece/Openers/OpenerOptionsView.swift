// The open opener's OPTIONS — the variant's own `Panel`, mounted by the Look
// tab's picker under its cards (`Look/OpenerPickerView.swift`, the web's
// `panels/HookPicker.tsx`): Défilé's stops and its tape
// (`ScrubOptionsPanel`), the Itinerary's stops and its picking map
// (`MapOptionsPanel`), Virée's road, its car and the garage verb
// (`DriveOptionsPanel`). The badge has no options, so nothing is drawn under
// its card — the honest face of a variant with nothing to set.
//
// The picker is the panel's HOST: a panel may not open the Library or ask an
// instance itself (`hook-variant.ts`), so it asks the host, and the host
// presents the chooser (`OpenerPicturesSheet(model:)`) when the panel calls
// `\.chooseOpenerPictures`. That verb carries nothing, and a chooser needs to
// know what to tick and where the kept pictures go — the Itinerary asks FOR
// ONE STOP — so the panel leaves its request with `OpenerPictureAsk` first,
// keyed by the piece, and the sheet takes it from there (else it opens on the
// opener's whole list, `OpenerPicturesRequest.forOpener`). With no host in
// the environment, a panel says what the web's does: "The picture chooser is
// not available here." The garage is the model's own sheet
// (`configureCar()`), as on the web.

import SwiftUI
import AtelierKit

/// One opening of the picture chooser: what is ticked on open, how it opens,
/// and where the kept pictures are written.
struct OpenerPicturesRequest: Identifiable {
    let id = UUID()
    /// What the variant holds now — ticked on open.
    var selected: [HookPickedPicture]
    /// Open on the piece's own day too; keep a picture shot after it.
    var choice: HookPictureChoice
    /// The kept pictures, in the order they were shot — written by the panel.
    let settle: ([HookPickedPicture]) -> Void
}

extension OpenerPicturesRequest {
    /// The chooser as a host with no request of a panel's opens it: the open
    /// opener's whole list — Défilé's and Virée's picked pictures, or the
    /// Itinerary's first stop (the rest filled after it). Nil when the open
    /// opener picks no pictures.
    @MainActor
    static func forOpener(_ model: PieceEditorModel) -> OpenerPicturesRequest? {
        switch model.hookVariant?.id ?? "" {
        case scrubVariant.id:
            let o = scrubOptions(model.hookOptions)
            return OpenerPicturesRequest(selected: o.picked, choice: HookPictureChoice()) { [weak model] next in
                guard let model else { return }
                var patched = scrubOptions(model.hookOptions)
                patched.stopsOn = .picked
                patched.picked = next
                model.writeOpenerOptions(patched.json)
            }
        case driveVariant.id:
            let o = driveOptions(model.hookOptions)
            return OpenerPicturesRequest(selected: o.picked, choice: HookPictureChoice()) { [weak model] next in
                guard let model else { return }
                var patched = driveOptions(model.hookOptions)
                patched.picked = next
                model.writeOpenerOptions(patched.json)
            }
        case mapVariant.id:
            let o = mapOptions(model.hookOptions)
            guard let first = o.stops.first else { return nil }
            let selected = first.picture.map { [$0] } ?? []
            let choice = HookPictureChoice(includeThisDay: true, keepsLater: true)
            return OpenerPicturesRequest(selected: selected, choice: choice) { [weak model] next in
                guard let model else { return }
                var patched = mapOptions(model.hookOptions)
                patched.stops = assignPictures(patched.stops, 0, next).stops
                model.writeOpenerOptions(patched.json.objectValue ?? [:])
            }
        default:
            return nil
        }
    }
}

/// Where a panel leaves its chooser request for the sheet the host presents —
/// one per piece, the latest ask winning; the sheet forgets it when it goes.
@MainActor
enum OpenerPictureAsk {
    private static var pending: [String: OpenerPicturesRequest] = [:]

    static func leave(_ request: OpenerPicturesRequest, for postId: String) {
        pending[postId] = request
    }

    static func request(for postId: String) -> OpenerPicturesRequest? {
        pending[postId]
    }

    /// The sheet is gone: its request with it, unless a newer ask replaced it.
    static func forget(_ id: UUID, for postId: String) {
        if pending[postId]?.id == id { pending[postId] = nil }
    }
}

/// The open opener's options panel, or nothing for the badge.
struct OpenerOptionsView: View {
    let model: PieceEditorModel
    /// The host's verb for the chooser — the Look tab's picker; nil elsewhere.
    @Environment(\.chooseOpenerPictures) private var chooseOpenerPictures

    var body: some View {
        if let state = model.hookState, let variant = model.hookVariant {
            switch variant.id {
            case scrubVariant.id:
                ScrubOptionsPanel(model: model, ctx: state.ctx, choose: choose)
            case mapVariant.id:
                MapOptionsPanel(model: model, ctx: state.ctx, choose: choose)
            case driveVariant.id:
                DriveOptionsPanel(model: model, ctx: state.ctx, choose: choose)
            default:
                EmptyView()
            }
        }
    }

    /// Leave the request, then ask the host — nil where there is no host, and
    /// the panel says so.
    private var choose: ((OpenerPicturesRequest) -> Void)? {
        guard let host = chooseOpenerPictures else { return nil }
        let postId = model.postId
        return { request in
            OpenerPictureAsk.leave(request, for: postId)
            host()
        }
    }
}

/// What a panel shows where its chooser button would be, with no host.
struct OpenerNoChooser: View {
    var body: some View {
        OpenerNote("The picture chooser is not available here.", tone: .muted)
    }
}

#Preview("Défilé's options") {
    ScrollView {
        OpenerOptionsView(model: OpenerFixtures.model(scrubVariant.id))
            .environment(\.chooseOpenerPictures, ChooseOpenerPicturesAction {})
            .padding(16)
    }
    .frame(width: 360, height: 900)
    .darkroom()
}

#Preview("Itinerary's options") {
    ScrollView {
        OpenerOptionsView(model: OpenerFixtures.model(mapVariant.id))
            .environment(\.chooseOpenerPictures, ChooseOpenerPicturesAction {})
            .padding(16)
    }
    .frame(width: 360, height: 900)
    .darkroom()
}

#Preview("Virée's options, no host") {
    ScrollView {
        OpenerOptionsView(model: OpenerFixtures.model(driveVariant.id))
            .padding(16)
    }
    .frame(width: 360, height: 900)
    .darkroom()
}
