// Where you are in the Develop tool, as a route. Port of
// `src/shared/develop/develop-route.ts` — Trips' rule (`TripRoute.swift`):
// the document is in the path, so Back, a reload and a link all land on the
// roll you were on.
//
// `/develop/home` is the gallery; `/develop/<roll>` a roll, where `<roll>` is
// the trip's readable-but-resolvable reference (`<slug>-<first 8 of the id>`),
// so renaming a roll never breaks a link; `/develop/<roll>/<picture>` names a
// picture on it. The app reads the same path out of an `atelier://` link
// (`Shell/AppLink.swift`), so a link made for either client opens the same
// roll in the other.
//
// The web's `DEVELOP_BASE` / `DEVELOP_HOME` are `developRouteBase` /
// `developRouteHome` here: `developBase` is already the develop's MATERIAL
// (`Develop.swift`). One divergence, the trip route's: a malformed escape
// makes the web's `decodeURIComponent` THROW; here the path reads as the
// gallery.

import Foundation

/// The web's `DEVELOP_BASE`.
public let developRouteBase = "/develop"
/// The web's `DEVELOP_HOME`.
public let developRouteHome = "/develop/home"

public struct DevelopRoute: Equatable, Sendable {
    /// Nil is the gallery.
    public var ref: String?
    public var pictureId: String?
    public init(ref: String?, pictureId: String?) {
        self.ref = ref
        self.pictureId = pictureId
    }

    /// The gallery. The web's `NOWHERE`.
    public static let nowhere = DevelopRoute(ref: nil, pictureId: nil)
}

/// The reference a roll goes by in a route — the trip's own.
public func rollRef(id: String, name: String) -> String {
    tripRef(id: id, name: name)
}

/// The roll a reference points at, matched on its id fragment alone.
public func rollFromRef<T>(_ ref: String, _ rolls: [T], id: (T) -> String) -> T? {
    tripFromRef(ref, rolls, id: id)
}

/// The path for a roll (and a picture on it); no roll is the gallery.
public func developPath(_ ref: String?, _ pictureId: String? = nil) -> String {
    guard let ref, !ref.isEmpty else { return developRouteHome }
    let base = "\(developRouteBase)/\(routeComponent(ref))"
    guard let pictureId, !pictureId.isEmpty else { return base }
    return "\(base)/\(routeComponent(pictureId))"
}

/// Read `/develop/<ref>/<picture>`, any tail of which may be absent; a query is ignored.
public func parseDevelopPath(_ path: String) -> DevelopRoute {
    let bare = path.firstIndex(of: "?").map { String(path[..<$0]) } ?? path
    guard bare == developRouteBase || bare.hasPrefix(developRouteBase + "/") else { return .nowhere }
    var rest = String(bare.dropFirst(developRouteBase.count))
    if rest.hasPrefix("/") { rest.removeFirst() }
    if rest.isEmpty || rest == "home" { return .nowhere }
    var parts: [String] = []
    for piece in rest.components(separatedBy: "/") {
        guard let decoded = piece.removingPercentEncoding else { return .nowhere }
        parts.append(decoded)
    }
    guard let ref = parts.first, !ref.isEmpty else { return .nowhere }
    let picture = parts.count > 1 ? parts[1] : ""
    return DevelopRoute(ref: ref, pictureId: picture.isEmpty ? nil : picture)
}

/// `encodeURIComponent`: everything but `A–Z a–z 0–9 - _ . ! ~ * ' ( )` escaped, as UTF-8.
private func routeComponent(_ s: String) -> String {
    let keep = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()")
    return s.addingPercentEncoding(withAllowedCharacters: keep) ?? s
}
