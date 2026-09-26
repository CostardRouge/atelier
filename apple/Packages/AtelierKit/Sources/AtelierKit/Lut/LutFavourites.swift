// ★ Favourites — the looks worth reaching for first. The pure half of
// `src/shared/lut/use-lut-favourites.ts`: how the shortlist is read back and
// how a star changes it. Where it is KEPT is the app's (the web's
// `localStorage`, `UserDefaults` here, under the same key).
//
// Rules kept (`media-pipeline.md`, «★ Favourites is a list of PICK IDS»):
// - a favourite is a working PREFERENCE, never on a document (a trip file must
//   not carry one person's shortlist) nor on a pack index (it spans built-ins,
//   film stocks and every pack at once);
// - what is stored is the gallery's own pick id — `<builtin id>`,
//   `film:<stock>`, `pack:<packId>/<lookId>` — so a star survives anything
//   that does not change what a look IS; a star whose look is gone is KEPT
//   and simply not drawn, so importing the pack again brings it back;
// - a new star goes to the END, so the rail's order is the order they were
//   starred in and nothing jumps under the pointer; a shortlist is a
//   shortlist, and past `maxLutFavourites` the oldest go.

import Foundation

/// Where the list is kept — the web's own `localStorage` key.
public let lutFavouritesKey = "atelier.lut.favourites"

/// A shortlist is a shortlist: past this it is the rail's job, not a star's.
public let maxLutFavourites = 60

/// The list read back defensively: an array of non-empty strings, the first
/// `maxLutFavourites` of them; anything else (junk someone else wrote, a
/// storage that answered nothing) is an empty list.
public func readLutFavourites(_ raw: JSONValue?) -> [String] {
    guard let items = raw?.arrayValue else { return [] }
    let ids = items.compactMap { item -> String? in
        guard let id = item.stringValue, !id.isEmpty else { return nil }
        return id
    }
    return Array(ids.prefix(maxLutFavourites))
}

/// Star or unstar a look: an id already there leaves, a new one goes to the
/// END and the list keeps its last `maxLutFavourites`. An empty id changes
/// nothing.
public func toggledLutFavourite(_ list: [String], _ id: String) -> [String] {
    guard !id.isEmpty else { return list }
    if list.contains(id) { return list.filter { $0 != id } }
    return Array((list + [id]).suffix(maxLutFavourites))
}

/// The list as it is stored.
public func lutFavouritesJSON(_ list: [String]) -> JSONValue {
    .array(list.map { .string($0) })
}
