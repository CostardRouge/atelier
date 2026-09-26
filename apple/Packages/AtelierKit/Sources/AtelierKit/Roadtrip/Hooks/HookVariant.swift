// A piece's OPENER as the trip document stores it — port of the stored half of
// `src/shared/roadtrip/hooks/hook-variant.ts`: the layer list, its default,
// the options record, and a picture an opener's options name.
//
// Types + reader only; the behaviour of `hook-variant.ts` (the variant
// contract, `prepare`, the context, the fold of several layers, the registry
// that resolves an id) is ported later INTO THIS FILE.
//
// Rules kept:
// - A layer's OPTIONS are a plain JSON record, never typed here: it is what
//   travels in `.roadtrip.json` and what a newer build may have written keys
//   into that this one does not know. A variant reads it through its own
//   defaults (`readOptions`), and a layer read back writes back exactly the
//   record it held.
// - The hook is a LIST from its first version with one entry today, so a
//   stack costs no second migration (`docs/hook-engine.md` §D3).
// - An id this build does not know is kept: it is skipped at resolve time, and
//   a trip written by a newer Atelier opens here and loses only its opener.

import Foundation

/// A variant's stored settings — a plain JSON record.
public typealias HookOptions = [String: JSONValue]

/// One entry of a piece's hook — a variant, and the settings it was given.
public struct HookLayer: Equatable, Sendable {
    public var id: String
    public var options: HookOptions

    public init(id: String, options: HookOptions = [:]) {
        self.id = id
        self.options = options
    }

    /// The layer as the document holds it.
    public var json: JSONValue {
        .object(["id": .string(id), "options": .object(options)])
    }
}

/// The variant every piece starts on: the badge, drawing nothing extra.
public let defaultHookId = "badge"

/// A fresh opener list: the badge alone.
public func defaultHookLayers() -> [HookLayer] {
    [HookLayer(id: defaultHookId, options: [:])]
}

/// Merge a variant's defaults UNDER what was stored — `{ ...defaults, ...options }`.
/// A variant never reads `options` directly: a document written before one of
/// its settings existed is the normal case, not an error.
public func readOptions(_ options: HookOptions, _ defaults: HookOptions) -> HookOptions {
    defaults.merging(options) { _, stored in stored }
}

/// A stored layer list read back. An entry that is not a record, or names no
/// variant, is dropped; a layer whose options are not a record keeps none.
public func readHookLayers(_ raw: JSONValue?) -> [HookLayer] {
    guard let list = raw?.arrayValue else { return [] }
    return list.compactMap { entry -> HookLayer? in
        guard let o = entry.objectValue, let id = o["id"]?.stringValue else { return nil }
        return HookLayer(id: id, options: o["options"]?.objectValue ?? [:])
    }
}

/// A picture the author picked for a variant, stored in its options: the ref
/// the shell finds the file again by, and the day it was shot.
public struct HookPickedPicture: Equatable, Sendable {
    public var ref: SavedMediaRef
    /// The day the picture was shot, `YYYY-MM-DD`.
    public var date: String
    /// The capture instant in ms, when known — orders one day's pictures.
    public var takenAt: Double?
    /// Where it was shot, when its EXIF (or the instance) says. Absent is the
    /// normal case for a camera without GPS, never an error.
    public var coords: GeoPoint?

    public init(ref: SavedMediaRef, date: String, takenAt: Double? = nil, coords: GeoPoint? = nil) {
        self.ref = ref; self.date = date; self.takenAt = takenAt; self.coords = coords
    }

    /// The picture as an opener's options hold it: `takenAt` and `coords` only when known.
    public var json: JSONValue {
        var o: [String: JSONValue] = ["ref": ref.json, "date": .string(date)]
        if let takenAt { o["takenAt"] = .number(takenAt) }
        if let coords { o["coords"] = .object(["lat": .number(coords.lat), "lon": .number(coords.lon)]) }
        return .object(o)
    }
}
