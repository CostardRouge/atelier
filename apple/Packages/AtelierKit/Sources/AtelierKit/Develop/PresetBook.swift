// The personal PRESET BOOK — one list of named lights, the same in the Develop
// tool and the Trips and Studio modals. Port of
// `src/shared/develop/develop-presets.ts` (the list rules),
// `src/shared/develop/preset-book.ts` (the book) and the pure half of
// `src/shared/develop/preset-book-remote.ts` (the wire), over
// `Develop.swift`'s `DevelopPreset` and `normaliseDevelopPresets`.
//
// Rules kept (`develop-roll.md`, D4): a preset holds a COPY of numbers —
// applied, never followed — and never a material (`withoutBase`); a name is a
// name however it is cased, and saving under a taken one replaces it IN PLACE;
// a preset of zeros with no look is a button that does nothing and is refused;
// one book per person, its id minted like any document's (a UUID, never a
// fixed name), found on a second device by LISTING its kind; a book is a SET
// of names, so two copies that both moved are MERGED (`mergeBooks`), never
// handed to a person; the identity that signs a delivered picture lives on the
// book, the one personal document every device finds; `sourceId` never
// travels; and on the way back the id and the source come from the REQUEST.
//
// The identity's shape is `exif/delivery-meta.ts`'s (`DeliveryIdentity`,
// `readIdentity`, the default copyright template); that module's port reuses
// the declarations below rather than writing them twice.

import Foundation

// MARK: - the list rules (develop-presets.ts)

/// The list with a preset under `name` — or nil when nothing changes (a blank
/// name, or an as-shot develop with no look). A taken name, however cased, is
/// replaced IN PLACE, keeping its id and its position and taking the new spelling.
private func savedPresets(_ list: [DevelopPreset], _ name: String, _ settings: DevelopSettings?, _ id: String, _ look: JSONValue?) -> [DevelopPreset]? {
    let label = name.trimmingCharacters(in: .whitespacesAndNewlines)
    // A preset is numbers, never a material: the base and its metered gain
    // belong to the one picture they were measured on.
    let numbers = settings.map(withoutBase)
    // A look alone is a preset too — "just Portra" is a name worth keeping.
    if label.isEmpty || ((numbers == nil || isDefaultDevelop(numbers)) && look == nil) { return nil }
    let key = label.lowercased()
    let existing = list.firstIndex { presetKey($0.name) == key }
    let preset = DevelopPreset(id: existing.map { list[$0].id } ?? id, name: label,
                               settings: cloneDevelop(numbers), look: look)
    guard let existing else { return list + [preset] }
    var out = list
    out[existing] = preset
    return out
}

/// The list with a preset holding a copy of `settings` under `name`; the same
/// list back when a blank name, or an as-shot develop with no look, changes
/// nothing. A `look` (a `SavedGrade` as written) rides with the light when given.
public func savePresetIn(_ list: [DevelopPreset], _ name: String, _ settings: DevelopSettings?, _ id: String, look: JSONValue? = nil) -> [DevelopPreset] {
    savedPresets(list, name, settings, id, look) ?? list
}

/// The list without preset `id`; the same list when it holds none. No picture it was applied to changes.
public func removePresetFrom(_ list: [DevelopPreset], _ id: String) -> [DevelopPreset] {
    list.contains { $0.id == id } ? list.filter { $0.id != id } : list
}

/// What a person picks a preset by: its name, trimmed, however cased.
private func presetKey(_ name: String) -> String {
    name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
}

// MARK: - the identity (exif/delivery-meta.ts)

// `DeliveryIdentity`, `readIdentity`, `sameIdentity`, `emptyIdentity` and
// `defaultCopyrightTemplate` are `Exif/DeliveryMeta.swift`'s — the web keeps
// them in delivery-meta.ts, which preset-book.ts imports. The book adds the
// writer it stores the identity with.

extension DeliveryIdentity {
    public var json: JSONValue {
        .object(["creator": .string(creator), "copyright": .string(copyright)])
    }
}

/// Text trimmed; an empty template falls back to the default.
private func trimmedIdentity(_ creator: String, _ copyright: String) -> DeliveryIdentity {
    let c = copyright.trimmingCharacters(in: .whitespacesAndNewlines)
    return DeliveryIdentity(creator: creator.trimmingCharacters(in: .whitespacesAndNewlines),
                            copyright: c.isEmpty ? defaultCopyrightTemplate : c)
}

// MARK: - the book (preset-book.ts)

public let presetBookVersion = 1

public struct PresetBook: Equatable, Sendable {
    public var id: String
    public var version: Int
    /// Where the book is kept. Never on the wire.
    public var sourceId: String
    public var updatedAt: Double
    public var presets: [DevelopPreset]
    /// The trips whose own presets have already been brought in — kept on the
    /// book so a preset deleted from it is not brought back by the next load.
    public var mergedTripIds: [String]
    /// Who signs a delivered picture; nil until the person writes one.
    public var identity: DeliveryIdentity?

    public init(id: String, version: Int = presetBookVersion, sourceId: String = defaultSourceId, updatedAt: Double,
                presets: [DevelopPreset] = [], mergedTripIds: [String] = [], identity: DeliveryIdentity? = nil) {
        self.id = id; self.version = version; self.sourceId = sourceId; self.updatedAt = updatedAt
        self.presets = presets; self.mergedTripIds = mergedTripIds; self.identity = identity
    }
}

public func createPresetBook(_ id: String, now: Double = nowMillis(), sourceId: String = defaultSourceId) -> PresetBook {
    PresetBook(id: id, sourceId: sourceId, updatedAt: now)
}

/// A stored or received book read onto the current shape, or nil when it is
/// not a book. One preset per name, the first kept; a preset's look is read
/// through the roll's own look reader, so junk is no look.
public func readPresetBook(_ raw: JSONValue?, fallbackSourceId: String = defaultSourceId) -> PresetBook? {
    guard let b = raw?.objectValue, let id = b["id"]?.stringValue, !id.isEmpty, let list = b["presets"], list.arrayValue != nil else {
        return nil
    }
    var seen = Set<String>()
    var presets: [DevelopPreset] = []
    for var p in normaliseDevelopPresets(list) {
        let key = presetKey(p.name)
        if key.isEmpty || seen.contains(key) { continue }
        seen.insert(key)
        p.look = p.look.flatMap { readRollGrade($0)?.json }
        presets.append(p)
    }
    var book = PresetBook(
        id: id,
        sourceId: (b["sourceId"]?.stringValue).flatMap { $0.isEmpty ? nil : $0 } ?? fallbackSourceId,
        updatedAt: b["updatedAt"]?.finiteNumber ?? 0,
        presets: presets,
        mergedTripIds: (b["mergedTripIds"]?.arrayValue ?? []).compactMap { $0.stringValue }
    )
    if let identity = b["identity"], identity != .null { book.identity = readIdentity(identity) }
    return book
}

/// The book signing with `identity`; the same book back when nothing changed.
public func withIdentity(_ book: PresetBook, _ identity: DeliveryIdentity, now: Double = nowMillis()) -> PresetBook {
    let next = trimmedIdentity(identity.creator, identity.copyright)
    if let current = book.identity, sameIdentity(current, next) { return book }
    var out = book
    out.identity = next
    out.updatedAt = now
    return out
}

/// Save under a name — the list rules are `savePresetIn`'s; the same book back when nothing changed.
public func savePresetInBook(_ book: PresetBook, _ name: String, _ settings: DevelopSettings?, _ id: String,
                             now: Double = nowMillis(), look: JSONValue? = nil) -> PresetBook {
    guard let presets = savedPresets(book.presets, name, settings, id, look) else { return book }
    var out = book
    out.presets = presets
    out.updatedAt = now
    return out
}

public func removePresetFromBook(_ book: PresetBook, _ id: String, now: Double = nowMillis()) -> PresetBook {
    guard book.presets.contains(where: { $0.id == id }) else { return book }
    var out = book
    out.presets = removePresetFrom(book.presets, id)
    out.updatedAt = now
    return out
}

/// Bring the presets trips carried (`TripDoc.developPresets`, before the book
/// existed) into the book, once per trip. A name already in the book keeps the
/// BOOK's numbers — what the person has in hand wins over an old copy. The
/// same book back when there was nothing new to bring.
public func mergeTripPresets(_ book: PresetBook, _ trips: [(id: String, developPresets: [DevelopPreset])], now: Double = nowMillis()) -> PresetBook {
    let merged = Set(book.mergedTripIds)
    let fresh = trips.filter { !merged.contains($0.id) }
    if fresh.isEmpty { return book }
    var presets = book.presets
    var names = Set(presets.map { presetKey($0.name) })
    for trip in fresh {
        for p in trip.developPresets {
            let key = presetKey(p.name)
            if key.isEmpty || names.contains(key) { continue }
            names.insert(key)
            presets.append(DevelopPreset(id: p.id, name: p.name.trimmingCharacters(in: .whitespacesAndNewlines),
                                         settings: p.settings, look: p.look))
        }
    }
    var out = book
    out.presets = presets
    out.mergedTripIds = book.mergedTripIds + fresh.map { $0.id }
    out.updatedAt = now
    return out
}

/// Two copies of one book that both moved, merged: the server's presets in
/// its order, each overridden by the local copy of the same name (the local
/// side is the one being edited), then the presets only this device has. A
/// preset deleted on one side and kept on the other comes back — the price of
/// never asking a person to settle a list of names, and the safe direction to
/// be wrong in. The server's id is kept so the result lands on the same row.
public func mergeBooks(_ local: PresetBook, _ server: PresetBook, now: Double = nowMillis()) -> PresetBook {
    var localByName: [String: DevelopPreset] = [:]
    for p in local.presets { localByName[presetKey(p.name)] = p }
    var presets: [DevelopPreset] = []
    var names = Set<String>()
    for p in server.presets {
        let key = presetKey(p.name)
        names.insert(key)
        presets.append(localByName[key] ?? p)
    }
    for p in local.presets {
        let key = presetKey(p.name)
        if !names.contains(key) {
            names.insert(key)
            presets.append(p)
        }
    }
    var tripIds: [String] = []
    for t in server.mergedTripIds + local.mergedTripIds where !tripIds.contains(t) { tripIds.append(t) }
    // One identity, not a list: the copy being edited wins, as a same-named preset does.
    return PresetBook(id: server.id, sourceId: server.sourceId, updatedAt: now, presets: presets,
                      mergedTripIds: tripIds, identity: local.identity ?? server.identity)
}

/// A preset as a book stores it — its look only when it has one.
private func presetJSON(_ p: DevelopPreset) -> JSONValue {
    var o: [String: JSONValue] = ["id": .string(p.id), "name": .string(p.name), "settings": p.settings.json]
    if let look = p.look { o["look"] = look }
    return .object(o)
}

extension PresetBook {
    /// The book as its store keeps it, `sourceId` included.
    public var json: JSONValue {
        var o: [String: JSONValue] = [
            "id": .string(id), "version": .number(Double(version)), "sourceId": .string(sourceId),
            "updatedAt": .number(updatedAt), "presets": .array(presets.map(presetJSON)),
            "mergedTripIds": .array(mergedTripIds.map { .string($0) }),
        ]
        if let identity { o["identity"] = identity.json }
        return .object(o)
    }
}

/// What travels: everything but where it is kept.
public func bookToWire(_ book: PresetBook) -> JSONValue {
    guard var o = book.json.objectValue else { return .null }
    o["sourceId"] = nil
    return .object(o)
}

// MARK: - the wire (preset-book-remote.ts)

/// The kind books are filed under in an instance's document bucket.
public let presetBookKind = "presets"

/// A stored body back into a book, id and source from the request — never
/// from the body; refused when it is not a book.
public func bookFromWire(_ raw: JSONValue?, _ id: String, _ sourceId: String) throws -> PresetBook {
    guard var body = raw?.objectValue else { throw WireDocError(message: "The stored copy of \(id) is not a preset book.") }
    body["id"] = .string(id)
    body["sourceId"] = .string(sourceId)
    guard let book = readPresetBook(.object(body), fallbackSourceId: sourceId) else {
        throw WireDocError(message: "The stored copy of \(id) is not a preset book.")
    }
    return book
}
