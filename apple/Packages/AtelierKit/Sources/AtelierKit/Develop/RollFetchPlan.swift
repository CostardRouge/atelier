// What a roll asks its instance for, and what it can say about each picture's
// bytes meanwhile — the pure half of `src/tools/develop/use-roll-media.ts`
// (`develop-media.md`, the maintainer's Q1–Q3). `RollMedia.swift` holds the
// rules the web kept in `roll-media.ts` (`fetchOrder`, `keepWindow`,
// `summarizeAvailability`); these are the ones the web wrote inline in its
// hook, lifted out so both clients count the same way:
//
// - **Only a CONNECTED instance** (`resolvableSourceOf`): a ref naming a host
//   this device never connected resolves to nil and is SAID as such — a stored
//   id must never become a reason to call a server nobody named.
// - **VARIANTS share their bytes** (`rollMates`): a picture's other copies are
//   the pictures holding the same file; only pictures that HAVE a variant are
//   compared, so a roll with none pays nothing.
// - **Only what is near, nearest first** (`rollFetchQueue`): the open picture,
//   then its neighbours; never a picture in hand (itself or a variant), never
//   one whose instance already answered badly — nothing retries on its own.
// - **Every picture says something** (`rollAvailability`): in hand, being
//   fetched, what the instance answered, waiting its turn, on an instance not
//   connected, or a file of this device that is not open.
//
// The web's module state (the pool, the in-flight map) is the app's; the web's
// `getWinnowConnection` is the `connected` closure.

import Foundation

/// The connected instance `ref` names, or nil when none does — the web's
/// `resolvableSource`. A ref naming `local`, or no host, is not resolvable here.
public func resolvableSourceOf(_ ref: SavedMediaRef?, connected: (String) -> Bool) -> String? {
    guard let split = splitAssetId(ref?.assetId), split.host != defaultSourceId else { return nil }
    return connected(split.host) ? split.host : nil
}

/// Each picture's VARIANTS — the other pictures holding the same file — by
/// picture id. Only families with a variant appear: a picture alone has no entry.
public func rollMates(_ pictures: [RollPicture]) -> [String: [String]] {
    var out: [String: [String]] = [:]
    for v in pictures where variantNumber(v) >= 2 {
        let family = pictures.filter { sameMediaRef($0.ref, v.ref) }.map(\.id)
        for id in family { out[id] = family.filter { $0 != id } }
    }
    return out
}

/// Whether a fetched file is still worth keeping: it or any of its variants is
/// inside the keep window around the open picture.
public func keptNearOpen(_ id: String, _ window: Set<String>, _ mates: [String: [String]]) -> Bool {
    window.contains(id) || (mates[id] ?? []).contains { window.contains($0) }
}

/// What is still to fetch, in the order it is wanted: the open picture, then
/// its neighbours out to `radius` — leaving out a picture in hand (itself or a
/// variant) and one whose instance already answered badly.
public func rollFetchQueue(_ ids: [String], _ openId: String?, inHand: (String) -> Bool,
                           mates: [String: [String]], failed: Set<String>, radius: Int = fetchRadius) -> [String] {
    fetchOrder(ids, openId, radius: radius).filter { id in
        !inHand(id) && !(mates[id] ?? []).contains(where: inHand) && !failed.contains(id)
    }
}

/// What a failed fetch leaves on the picture — the web's `Failure`: a 401 is
/// "not signed in", with the instance's own sign-in page; anything else is the
/// instance's words.
public func fetchFailure(_ sourceId: String, unauthenticated: Bool, message: String) -> PictureAvailability {
    unauthenticated
        ? .failed(sourceId: sourceId, problem: "Not signed in to \(sourceId).", loginUrl: "https://\(sourceId)/login")
        : .failed(sourceId: sourceId, problem: message)
}

/// Every picture's availability, in the web's order of precedence: in hand;
/// being fetched from a connected instance; what the instance last answered;
/// waiting its turn on a connected instance; kept on an instance this device
/// is not connected to; else a file of this device that is not open.
public func rollAvailability(_ pictures: [RollPicture], inHand: Set<String>, fetching: Set<String>,
                             failures: [String: PictureAvailability],
                             connected: (String) -> Bool) -> [String: PictureAvailability] {
    var out: [String: PictureAvailability] = [:]
    for p in pictures {
        if inHand.contains(p.id) {
            out[p.id] = .ready
            continue
        }
        let sourceId = resolvableSourceOf(p.ref, connected: connected)
        if let sourceId, fetching.contains(p.id) {
            out[p.id] = .fetching(sourceId: sourceId)
        } else if let failure = failures[p.id] {
            out[p.id] = failure
        } else if let sourceId {
            out[p.id] = .waiting(sourceId: sourceId)
        } else if let host = splitAssetId(p.ref.assetId)?.host, host != defaultSourceId {
            out[p.id] = .unconnected(sourceId: host)
        } else {
            out[p.id] = .local
        }
    }
    return out
}

/// The instance named by the first picture being fetched, for a status line —
/// `its instance` when none is.
public func fetchingHost(_ ids: [String], _ availability: [String: PictureAvailability]) -> String {
    for id in ids {
        if case .fetching(let sourceId)? = availability[id] { return sourceId }
    }
    return "its instance"
}
