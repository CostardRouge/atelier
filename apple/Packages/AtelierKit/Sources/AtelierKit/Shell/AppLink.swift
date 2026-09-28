// The app's LINKS — the web answers by URL, the app by the `atelier://` scheme
// it registers (`apple/project.yml`, both targets). Native, with the web's own
// routing read one for one:
//
// - the shell's two-level router (`src/app/App.tsx` + `tools.tsx`'s
//   `toolForPath`): `/sources` and `/connect` (its older name, what an
//   instance's own app rail links to) are the shell's; any other path belongs
//   to the tool whose base it is or starts with (`/studio/home` is the
//   Studio's), and anything else is the home page;
// - `SourcesScreen.tsx`'s query: `?instance=` PROPOSES a host — nothing is
//   sent until the person presses Allow, which is what turns "a link can name
//   any server" into a decision — and `?return=` is where to land afterwards,
//   honoured only as a path of ours (`/…`, never `//…` nor an absolute URL);
// - `StudioTool.tsx`'s `open/<id>`: another tool hands a project over by
//   navigating, neither reaching into the other's state;
// - `RoadTripTool.tsx`'s two timeline links (`TripRoute.swift` reads them),
//   and what it does with them (`timelineLinkLanding`).
//
// The path is the web's own, so a link a Winnow builds for the web is one
// origin swap away from the app, and the web's hash is read whole wherever a
// URL carries one:
//
//   https://atelier.steeve.website/#/roadtrip/new?source=winnow.steeve.website
//   atelier://roadtrip/new?source=winnow.steeve.website
//   atelier:///roadtrip/new?source=winnow.steeve.website
//   atelier://open#/roadtrip/new?source=winnow.steeve.website

import Foundation

/// The URL scheme the app registers.
public let appLinkScheme = "atelier"

/// The web's `AFTER_CONNECT`: where a link that asked for an instance lands
/// once it is allowed (or refused with Not now), when it named no path of ours.
public let sourcesAfterConnect = "/studio/home"

/// What a link asked of the Sources screen.
public struct SourcesLink: Equatable, Sendable {
    /// `?instance=` — the address a link PROPOSES; empty when none.
    public var proposed: String
    /// `?return=` as the link wrote it; empty when none.
    public var back: String

    public init(proposed: String, back: String) {
        self.proposed = proposed
        self.back = back
    }

    /// Where Allow and Not now land — the web's `after`.
    public var after: String { sourcesLanding(back) }
    /// A link asked something — the web's `sentByLink`: it is what draws Not
    /// now, and what sends a successful Allow on to `after`.
    public var sentByLink: Bool { !proposed.isEmpty || !back.isEmpty }
}

/// `?return=` honoured only as a path of ours — never an absolute URL, never
/// a protocol-relative `//host` — else `sourcesAfterConnect`.
public func sourcesLanding(_ back: String) -> String {
    back.hasPrefix("/") && !back.hasPrefix("//") ? back : sourcesAfterConnect
}

/// The instruments' web paths, the registry's `group: 'instrument'` entries.
public let instrumentRouteSlugs = ["telemetry", "overlay", "map", "composer", "exif", "compare", "lut"]

/// Where a path lands, as the web's shell and tools read it.
public enum AppLink: Equatable, Sendable {
    /// `/`, or a path no tool owns — the web's home page.
    case home
    /// `/sources`, `/connect`, with what the link asked.
    case sources(SourcesLink)
    /// `/studio`, `/studio/home`, `/studio/open/<id>` (the project handed over).
    case studio(openId: String?)
    /// `/develop…`, read by `parseDevelopPath`.
    case develop(DevelopRoute)
    /// `/roadtrip…`, read by `parseRoadtripPath` — the timeline links included.
    case roadtrip(RoadtripRoute)
    /// An instrument page, by its web path's slug (`lut`, `exif`, …).
    case instrument(String)
}

/// The web path a URL carries: the hash of a web link, else an `atelier://`
/// URL's host and path with its query. Nil for a URL that is neither.
public func appLinkPath(_ url: URL) -> String? {
    guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
    if let fragment = parts.percentEncodedFragment, fragment.hasPrefix("/") { return fragment }
    guard parts.scheme?.lowercased() == appLinkScheme else { return nil }
    let host = (parts.percentEncodedHost ?? "").lowercased()
    var path = parts.percentEncodedPath
    if !host.isEmpty { path = "/" + host + path }
    if path.isEmpty { path = "/" }
    if let query = parts.percentEncodedQuery { path += "?" + query }
    return path
}

/// `#/studio/open/<id>`'s prefix.
private let studioOpenPrefix = "/studio/open/"

/// Read a web path the way the shell and the tools read the hash.
public func parseAppLink(_ path: String) -> AppLink {
    for base in ["/sources", "/connect"] where path == base || path.hasPrefix(base + "?") {
        let query = path.count > base.count ? String(path.dropFirst(base.count + 1)) : ""
        let pairs = linkFormPairs(query)
        let instance = pairs.first(where: { $0.name == "instance" })?.value ?? ""
        let back = pairs.first(where: { $0.name == "return" })?.value ?? ""
        return .sources(SourcesLink(proposed: instance, back: back))
    }
    func owns(_ base: String) -> Bool { path == base || path.hasPrefix(base + "/") }
    if owns("/studio") {
        guard path.hasPrefix(studioOpenPrefix) else { return .studio(openId: nil) }
        let id = String(path.dropFirst(studioOpenPrefix.count)).removingPercentEncoding ?? ""
        return .studio(openId: id.isEmpty ? nil : id)
    }
    if owns(roadtripBase) { return .roadtrip(parseRoadtripPath(path)) }
    if owns(developRouteBase) { return .develop(parseDevelopPath(path)) }
    for slug in instrumentRouteSlugs where owns("/" + slug) {
        return .instrument(slug)
    }
    return .home
}

/// What `RoadTripTool.tsx` does with a timeline link — a PROPOSAL, never an
/// action the URL performs (`docs/winnow-timeline.md` §5.5). Nil when the
/// route carries no link.
public enum TimelineLinkLanding: Equatable, Sendable {
    /// The ordinary screen — the trip's overview for a completion, the
    /// gallery for a seed — and nothing opened. What every link does while
    /// `timelineSyncEnabled` is off: it is consumed, and no instance is asked.
    case land(RoadtripRoute)
    /// The link's host is not connected here: Sources proposes it and comes
    /// back to the link once allowed.
    case connectFirst(SourcesLink)
    /// The import screen, over the ordinary one.
    case open(TimelineLink, over: RoadtripRoute)
}

/// The landing of a timeline link at `path`. `isConnected` says whether the
/// link's host is a connection held here — a link names a HOST the shell
/// resolves, never a URL it fetches.
public func timelineLinkLanding(_ route: RoadtripRoute, path: String, enabled: Bool = timelineSyncEnabled,
                                isConnected: (String) -> Bool) -> TimelineLinkLanding? {
    guard let link = route.link else { return nil }
    let under: RoadtripRoute
    if link.kind == .seed || route.ref == nil {
        under = .nowhere
    } else {
        under = RoadtripRoute(ref: route.ref, date: nil, postId: nil)
    }
    guard enabled else { return .land(under) }
    guard isConnected(link.source) else {
        return .connectFirst(SourcesLink(proposed: "https://\(link.source)", back: path))
    }
    return .open(link, over: under)
}

// MARK: - `URLSearchParams`, as the Sources screen reads its query

/// `&`-separated pairs, `+` as a space, a lenient percent-decode (a stray `%`
/// stays), UTF-8 with replacement.
private func linkFormPairs(_ query: String) -> [(name: String, value: String)] {
    query.split(separator: "&", omittingEmptySubsequences: true).map { part in
        let text = String(part)
        guard let eq = text.firstIndex(of: "=") else { return (linkFormDecode(text), "") }
        return (linkFormDecode(String(text[..<eq])), linkFormDecode(String(text[text.index(after: eq)...])))
    }
}

private func linkHexValue(_ c: UInt8) -> UInt8? {
    switch c {
    case 48...57: return c - 48
    case 65...70: return c - 55
    case 97...102: return c - 87
    default: return nil
    }
}

private func linkFormDecode(_ s: String) -> String {
    let bytes = Array(s.utf8)
    var out: [UInt8] = []
    out.reserveCapacity(bytes.count)
    var i = 0
    while i < bytes.count {
        let b = bytes[i]
        if b == UInt8(ascii: "+") {
            out.append(0x20)
            i += 1
        } else if b == UInt8(ascii: "%"), i + 2 < bytes.count,
                  let hi = linkHexValue(bytes[i + 1]), let lo = linkHexValue(bytes[i + 2]) {
            out.append(hi << 4 | lo)
            i += 3
        } else {
            out.append(b)
            i += 1
        }
    }
    return String(decoding: out, as: UTF8.self)
}
