// The links the app answers. The web answers by URL — its hash routes — and
// the app by the `atelier://` scheme it registers (`project.yml`, both
// targets), handed over by `.onOpenURL` (`RootView`). The kernel reads the
// path exactly as the web's shell and tools read the hash
// (`Shell/AppLink.swift`); this follows it:
//
// - `/studio/open/<id>` — a project handed to the Studio: the Studio's own
//   seam (`StudioStore.openHandedOver`, what Trips' bridge calls), then the
//   Studio. An id this device does not hold lands on the Studio's gallery,
//   as the web's does. The link is consumed: nothing re-opens it.
// - `/roadtrip/<trip>/<day>/<piece>` — the trip, on that day, the piece
//   pushed over it (`TripsShell.follow`), so Back lands on the day; a trip
//   this device does not hold is the gallery, a piece the trip does not hold
//   leaves the overview on the day.
// - `/roadtrip/new?source=<host>&chapters=<id>` and
//   `/roadtrip/<trip>/import?source=<host>` — Winnow's two verbs, seed a trip
//   from a timeline or complete one. Behind the kernel's `timelineSyncEnabled`,
//   which is OFF, as the web's is (`features.ts`: Atelier must not lean on a
//   feature of another project that is not mature): a link is consumed and
//   lands on the ordinary screen — the gallery for a seed, the trip for a
//   completion — and no instance is asked. The branch the switch turns back
//   on is here and tested in the kernel: a host not connected goes to
//   Sources and comes back; a connected one opens `TimelineImportSheet` over
//   the ordinary screen.
// - `/develop/<roll>/<picture>` — the roll pushed from the Develop gallery,
//   on that picture (the first when the roll does not hold it); a roll this
//   device does not hold is the gallery.
// - `/sources`, `/connect` with `?instance=` and `?return=` — a link PROPOSES
//   a host on the Sources screen ("A link asked to connect … Check the
//   address"); nothing is sent until the person presses Allow, and Allow or
//   Not now lands on `?return=` — a path of ours only — else the Studio.
// - an instrument's page by its path (`/lut`, `/exif`, …); `/` and a path no
//   tool owns leave the app where it is: it has no home page, its tab bar is
//   the home.

import SwiftUI
import AtelierKit

/// A move of the shell a link asked for — its serial makes the same place,
/// asked twice, move twice.
struct ShellMove: Equatable {
    let place: ShellPlace
    let serial: Int
}

/// A picture a link named, with the link's serial: the same picture named
/// twice opens twice.
struct LinkedPicture: Equatable {
    let id: String
    let serial: Int
}

/// A roll a link named, until the Develop gallery takes it.
struct DevelopLinkRequest: Equatable {
    let route: DevelopRoute
    let serial: Int
}

/// A timeline a link asked to import — reached only while the kernel's
/// `timelineSyncEnabled` is on.
struct TimelineLinkRequest: Identifiable, Equatable {
    let link: TimelineLink
    /// The trip a completion reconciles into; nil for a seed.
    let tripId: String?
    let serial: Int

    var id: Int { serial }
}

@MainActor
@Observable
final class AppLinks {
    static let shared = AppLinks()

    /// Where the shell is asked to go; `RootView` follows it.
    private(set) var move: ShellMove?
    /// What a link asked of the Sources screen, until Allow or Not now answers it.
    var sourcesProposal: SourcesLink?
    /// A roll a link named, until the Develop gallery takes it.
    private(set) var developRequest: DevelopLinkRequest?
    /// A timeline import a link asked for, until its sheet closes.
    var timelineRequest: TimelineLinkRequest?

    private var serial = 0

    /// A URL the system handed the app.
    func open(_ url: URL) {
        guard let path = appLinkPath(url) else { return }
        follow(path)
    }

    /// Go where a web path says.
    func follow(_ path: String) {
        switch parseAppLink(path) {
        case .home:
            return
        case .sources(let link):
            sourcesProposal = link.sentByLink ? link : nil
            go(.tool(.sources))
        case .studio(let openId):
            go(.tool(.studio))
            if let openId {
                Task { await StudioStore.shared.openHandedOver(openId) }
            }
        case .develop(let route):
            serial += 1
            developRequest = DevelopLinkRequest(route: route, serial: serial)
            go(.tool(.develop))
        case .roadtrip(let route):
            followTrips(route, path: path)
        case .instrument(let slug):
            if let instrument = InstrumentTool(rawValue: slug) { go(.instrument(instrument)) }
        }
    }

    /// The roll a link named, taken once by the gallery that opens it.
    func takeDevelopRequest() -> DevelopLinkRequest? {
        let request = developRequest
        developRequest = nil
        return request
    }

    /// Sources, proposing a host — the web's `#/connect?instance=…`, which a
    /// screen reaches without a URL (the Library's `reconnect`).
    func propose(_ link: SourcesLink) {
        sourcesProposal = link
        go(.tool(.sources))
    }

    /// The Sources proposal answered — allowed, or Not now: it goes, and the
    /// link's landing is followed.
    func answer(_ proposal: SourcesLink) {
        sourcesProposal = nil
        follow(proposal.after)
    }

    private func followTrips(_ route: RoadtripRoute, path: String) {
        let shell = TripsShell.shared
        let connections = ConnectionStore.shared
        guard let landing = timelineLinkLanding(route, path: path,
                                                isConnected: { connections.connection($0) != nil }) else {
            go(.tool(.trips))
            shell.follow(route)
            return
        }
        switch landing {
        case .land(let under):
            go(.tool(.trips))
            shell.follow(under)
        case .connectFirst(let proposal):
            propose(proposal)
        case .open(let link, let under):
            go(.tool(.trips))
            shell.follow(under)
            let tripId = under.ref.flatMap { ref in tripFromRef(ref, shell.store.trips, id: { $0.id })?.id }
            // A completion of a trip this device does not hold lands on the
            // gallery with nothing opened, as the web's does.
            if link.kind == .complete && tripId == nil { return }
            serial += 1
            timelineRequest = TimelineLinkRequest(link: link, tripId: tripId, serial: serial)
        }
    }

    private func go(_ place: ShellPlace) {
        serial += 1
        move = ShellMove(place: place, serial: serial)
    }
}

// MARK: - Trips

extension TripsShell {
    /// Go where a trip route says — the web's route effect: the trip the
    /// reference resolves to (renamed or not), on the route's day, the piece
    /// pushed over it when the trip holds it. No reference, or a trip this
    /// device does not hold, is the gallery.
    func follow(_ route: RoadtripRoute) {
        guard let ref = route.ref else {
            showTrips()
            return
        }
        store.reload()
        guard let doc = tripFromRef(ref, store.trips, id: { $0.id }) else {
            showTrips()
            return
        }
        open(doc)
        path = [.trip(id: doc.id, day: route.date)]
        if let postId = route.postId, doc.posts.contains(where: { $0.id == postId }) {
            openPiece(tripId: doc.id, postId: postId, day: route.date)
        }
    }
}

/// The timeline import a link asked for, over whichever Trips screen is up.
/// Reached only while `timelineSyncEnabled` is on. The shell is read as the
/// one it is — this sits outside the stack the tool's environment is put on.
private struct TimelineLinkSheet: ViewModifier {
    @State private var links = AppLinks.shared
    private var shell: TripsShell { TripsShell.shared }

    func body(content: Content) -> some View {
        @Bindable var links = links
        return content.sheet(item: $links.timelineRequest) { request in
            sheet(request)
        }
    }

    @ViewBuilder
    private func sheet(_ request: TimelineLinkRequest) -> some View {
        let close: () -> Void = { links.timelineRequest = nil }
        if request.link.kind == .complete, let tripId = request.tripId {
            TimelineImportSheet(store: shell.store, sourceId: request.link.source, mode: .complete(tripId: tripId),
                                onApplied: { doc, widened in
                                    shell.spanNote = widened ? spanWidenedSentence(doc) : nil
                                },
                                onClose: close)
                .environment(ConnectionStore.shared)
        } else {
            TimelineImportSheet(store: shell.store, sourceId: request.link.source,
                                mode: .seed(preselect: request.link.chapters),
                                onSeeded: { doc in shell.open(doc) },
                                onClose: close)
                .environment(ConnectionStore.shared)
        }
    }
}

extension View {
    /// The timeline import a link asked for (`AppLinks.timelineRequest`).
    func timelineLinkSheet() -> some View {
        modifier(TimelineLinkSheet())
    }
}
