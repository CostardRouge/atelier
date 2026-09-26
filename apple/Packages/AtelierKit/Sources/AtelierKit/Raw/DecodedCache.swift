// Decoded RAWs held for the session, so a picture stepped away from and back to
// is not decoded twice — a decode is seconds and a memory spike, and on a phone
// the spike is the thing that ends the app. Port of
// `src/shared/raw/decoded-cache.ts`.
//
// Keyed by the file's identity AND the size it was asked at (the stage's edge
// is not the export's), bounded by a byte ceiling the device class sets
// (`RawBudget.swift`), least recently used let go first and the entry used
// last never — `HeldBudget.swift`'s policy (`toEvict`), the one the fetched
// originals already follow. What is evicted is only the cache's reference: a
// consumer that still holds the value keeps it. Session-only, never persisted —
// media bytes are not (`local-first.md`).
//
// A class, as the web's is a closure over a `Map`: it is state, owned by one
// caller, and not `Sendable` — the app keeps it on one actor. Keys come back in
// the order they were FIRST held, as a JavaScript `Map` lists them.

import Foundation

public struct DecodedEntry<T> {
    public var value: T
    public var bytes: Int
    public var lastUsed: Double

    public init(value: T, bytes: Int, lastUsed: Double) {
        self.value = value; self.bytes = bytes; self.lastUsed = lastUsed
    }
}

public final class DecodedCache<T> {
    private var held: [String: DecodedEntry<T>] = [:]
    private var order: [String] = []
    private var tick = 0.0
    private let ceiling: () -> Int

    /// `ceiling` is asked at every `remember`, so a device that learns more
    /// about itself (or a spec that squeezes it) moves the bound live.
    public init(ceiling: @escaping () -> Int) {
        self.ceiling = ceiling
    }

    /// The value held under `key`, counted as used now; nil where nothing is.
    public func recall(_ key: String) -> T? {
        guard var entry = held[key] else { return nil }
        tick += 1
        entry.lastUsed = tick
        held[key] = entry
        return entry.value
    }

    /// Hold `value` under `key`, then let go of whatever no longer fits.
    public func remember(_ key: String, _ value: T, _ bytes: Int) {
        tick += 1
        if held[key] == nil { order.append(key) }
        held[key] = DecodedEntry(value: value, bytes: bytes, lastUsed: tick)
        let entries = order.compactMap { k in held[k].map { HeldEntry(key: k, bytes: $0.bytes, lastUsed: $0.lastUsed) } }
        let evicted = Set(toEvict(entries, ceiling()))
        if evicted.isEmpty { return }
        for k in evicted { held[k] = nil }
        order.removeAll { evicted.contains($0) }
    }

    /// Drop everything.
    public func clear() {
        held.removeAll()
        order.removeAll()
    }

    /// How many bytes are held right now.
    public func size() -> Int {
        held.values.reduce(0) { $0 + $1.bytes }
    }

    public func keys() -> [String] {
        order
    }
}

/// The web's factory, kept by name.
public func makeDecodedCache<T>(_ ceiling: @escaping () -> Int) -> DecodedCache<T> {
    DecodedCache(ceiling: ceiling)
}

/// The identity a file is cached under: its name, its weight and its capture
/// instant (ms since the epoch, printed as JavaScript prints a number).
public func fileKey(name: String, size: Int, lastModified: Double) -> String {
    "\(name):\(size):\(ExifText.jsString(lastModified))"
}
