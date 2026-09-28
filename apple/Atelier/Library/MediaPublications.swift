// What the active tool tells the shell — the native twin of the web's
// `MediaScopeProvider` (`src/shared/sources/media-scope.tsx`): the SPAN it is
// on (the kernel's `MediaScope`, which the Library's instance tab lists), and
// what it can START from a picture the shell shows large (`MediaActions`).
//
// The web keeps both in a React context the tool writes and the shell reads.
// Here a tool writes with a modifier — `.publishMediaScope(_:)`,
// `.publishMediaActions(_:)` — into ONE bus the shell owns
// (`MediaPublications`, in the environment), and the Library reads the bus.
// A preference key was the obvious SwiftUI seam and was not taken: a value a
// pushed editor publishes has to cross a NavigationStack and a TabView to
// reach a Library that is its SIBLING, never its ancestor, and a phone's
// Library is a sheet the shell presents.
//
// Rules kept (`architecture.md`, «A tool publishes VERBS for a picture»):
// - A publication is TAKEN BACK when its screen leaves, so the Library never
//   keeps showing a day nobody is looking at. Screens overlap as they come and
//   go (a pushed editor appears before the gallery under it disappears, and
//   the other way on the way back), so each publisher holds a token and the
//   one that appeared LAST is the one read — never whichever wrote last.
// - `run` is called with the media already in the Library and ACTIVE: no verb
//   takes a media, none writes a ref, and a verb reads what it needs from the
//   Library's active asset (`LibraryStore.activeAsset`) — which, unlike the
//   web's, is already set in the same tick.
// - Verbs carry closures, so a record is compared by its `key` and its words:
//   the publisher puts in the key whatever its closures depend on.

import Observation
import SwiftUI
import AtelierKit

/// What the sheet was SHOWING when a verb was pressed (R6 of
/// `docs/capture-renditions.md`): the capture's rendition on screen, as a roll
/// stores it — `delivered:<name>`, or nil for the one the picture opens on.
struct MediaView: Equatable {
    var rendition: String?
}

/// One thing the active tool can start from a media — "Develop".
struct MediaAction: Identifiable {
    /// The publisher's own key — `develop`, `new-roll`.
    let id: String
    /// The button's word.
    let label: String
    /// What it makes, one line, on the button's help.
    let hint: String?
    /// Called with the media already active; the view says which of its files was on screen.
    let run: @MainActor (MediaView?) -> Void

    init(id: String, label: String, hint: String? = nil, run: @escaping @MainActor (MediaView?) -> Void) {
        self.id = id
        self.label = label
        self.hint = hint
        self.run = run
    }
}

/// The verbs a tool offers, and the sentence read AFTER them — «starts a new
/// roll with this picture», «on Uluru at dusk».
struct MediaActions: Equatable {
    /// Everything the closures depend on, so a republish that changes nothing
    /// the eye can see still replaces stale closures.
    let key: String
    let heading: String
    let actions: [MediaAction]

    static func == (l: MediaActions, r: MediaActions) -> Bool {
        guard l.key == r.key, l.heading == r.heading, l.actions.count == r.actions.count else { return false }
        for (a, b) in zip(l.actions, r.actions) where a.id != b.id || a.label != b.label || a.hint != b.hint {
            return false
        }
        return true
    }
}

@MainActor
@Observable
final class MediaPublications {
    private struct ScopeEntry {
        let token: UUID
        var value: MediaScope
        var order: Int
    }

    private struct OfferEntry {
        let token: UUID
        var value: MediaActions
        var order: Int
    }

    private var scopes: [ScopeEntry] = []
    private var offers: [OfferEntry] = []
    @ObservationIgnored private var counter = 0

    init() {}

    /// The span the screen that appeared last is on, or nil.
    var scope: MediaScope? {
        scopes.max { $0.order < $1.order }?.value
    }

    /// What the screen that appeared last offers, or nil.
    var actions: MediaActions? {
        offers.max { $0.order < $1.order }?.value
    }

    /// Say what is open. `raise` is true when the screen APPEARS — it becomes
    /// the one read — and false for a change while it is up. Nil withdraws.
    func publish(scope: MediaScope?, token: UUID, raise: Bool) {
        guard let scope else {
            withdrawScope(token)
            return
        }
        if let i = scopes.firstIndex(where: { $0.token == token }) {
            if !sameScope(scopes[i].value, scope) { scopes[i].value = scope }
            if raise {
                counter += 1
                scopes[i].order = counter
            }
        } else {
            counter += 1
            scopes.append(ScopeEntry(token: token, value: scope, order: counter))
        }
    }

    func withdrawScope(_ token: UUID) {
        scopes.removeAll { $0.token == token }
    }

    func publish(actions: MediaActions?, token: UUID, raise: Bool) {
        guard let actions else {
            withdrawActions(token)
            return
        }
        if let i = offers.firstIndex(where: { $0.token == token }) {
            offers[i].value = actions
            if raise {
                counter += 1
                offers[i].order = counter
            }
        } else {
            counter += 1
            offers.append(OfferEntry(token: token, value: actions, order: counter))
        }
    }

    func withdrawActions(_ token: UUID) {
        offers.removeAll { $0.token == token }
    }
}

// MARK: - the tool's side

extension View {
    /// Say what span this screen is on, for as long as it is up. Pass nil to
    /// say nothing. Tolerant of a missing bus — a preview publishes into the void.
    func publishMediaScope(_ scope: MediaScope?) -> some View {
        modifier(MediaScopePublisher(scope: scope))
    }

    /// Offer verbs for a picture the shell shows large, for as long as this
    /// screen is up.
    func publishMediaActions(_ actions: MediaActions?) -> some View {
        modifier(MediaActionsPublisher(actions: actions))
    }
}

private struct MediaScopePublisher: ViewModifier {
    let scope: MediaScope?
    @Environment(MediaPublications.self) private var bus: MediaPublications?
    @State private var token = UUID()

    func body(content: Content) -> some View {
        content
            .onAppear { bus?.publish(scope: scope, token: token, raise: true) }
            .onChange(of: scope) { _, next in bus?.publish(scope: next, token: token, raise: false) }
            .onDisappear { bus?.withdrawScope(token) }
    }
}

private struct MediaActionsPublisher: ViewModifier {
    let actions: MediaActions?
    @Environment(MediaPublications.self) private var bus: MediaPublications?
    @State private var token = UUID()

    func body(content: Content) -> some View {
        content
            .onAppear { bus?.publish(actions: actions, token: token, raise: true) }
            .onChange(of: actions) { _, next in bus?.publish(actions: next, token: token, raise: false) }
            .onDisappear { bus?.withdrawActions(token) }
    }
}
