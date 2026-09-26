// WHERE THE SENSOR'S DATA COMES FROM, for one picture — the one answer the
// workbench and the export both need, decided here once. Port of
// `src/shared/develop/sensor-source.ts` (R3b of `docs/capture-renditions.md`).
//
// Four reaches, in the order they are tried:
//
// - `file` — the file in hand IS the RAW (a DNG dropped into Develop).
// - `sibling` — a RAW a folder listed beside it (`AssetParts.siblings`): the
//   DNG beside a DJI's JPEG. In hand, no fetch.
// - `original` — the proxy's OWN original is the RAW (a lone DNG on a
//   Winnow). Fetched once, held for the session.
// - `companion` — the capture's OTHER file on the instance
//   (`MediaOrigin.companion`): the ARW behind a Sony's HIF. Fetched once,
//   held for the session under ITS OWN asset id — never the picture's
//   (`renditions-build.md`, R3b).
//
// The web's `File` is the kernel's `SavedMediaRef`; the web's module-level
// session cache (`sources/original-cache.ts`) is the `HeldOriginals` the app
// hands in; and the web's `fetch` closure is `SensorFetch`, a FACT saying what
// to fetch — the app's fetcher performs it, as a task it can cancel.

import Foundation

/// The session's memory of the originals it fetched — the reads and writes of
/// the web's `sources/original-cache.ts`, which the app implements (its byte
/// ceiling is `Sources/HeldBudget.swift`'s). Keys are asset ids (`<host>/<id>`).
public protocol HeldOriginals: AnyObject {
    /// The file held under `key`, or nil.
    func heldOriginal(_ key: String) -> SavedMediaRef?
    func holdOriginal(_ key: String, _ file: SavedMediaRef)
    /// The render inside the RAW held under `key`: `nil` nobody measured it,
    /// `.some(nil)` it was read and carries none, `.some(size)` measured.
    func heldRawRender(_ key: String) -> PixelSize??
    func holdRawRender(_ key: String, _ render: PixelSize?)
}

public enum SensorReach: String, CaseIterable, Sendable {
    case file, sibling, original, companion
}

/// How a source that is not in hand is got — the web's `fetch` closure, said
/// as what it fetches.
public enum SensorFetch: Equatable, Sendable {
    /// The ORIGINAL of the picture in hand (`MediaOrigin.fetchOriginal`).
    case original
    /// The capture's companion, by its own asset id (`CaptureCompanion.fetchFile`).
    case companion(assetId: String)
}

public struct SensorSource: Equatable, Sendable {
    public var reach: SensorReach
    /// The file's own name and weight — what a row says before anyone clicks.
    public var name: String
    public var bytes: Int?
    /// The session cache's key for a fetched file; nil where it is in hand.
    public var key: String?
    /// The file when it is in hand already — the file, a sibling, or a held fetch.
    public var held: SavedMediaRef?
    /// How to get it when it is not; nil where nothing can.
    public var fetch: SensorFetch?

    public init(reach: SensorReach, name: String, bytes: Int?, key: String?, held: SavedMediaRef?, fetch: SensorFetch?) {
        self.reach = reach; self.name = name; self.bytes = bytes; self.key = key; self.held = held; self.fetch = fetch
    }
}

private func heldFile(_ key: String?, _ held: HeldOriginals?) -> SavedMediaRef? {
    guard let key, let held else { return nil }
    return held.heldOriginal(key)
}

/// The sensor's source for `file`, or nil when no RAW of this capture is
/// reachable at all. `siblings` are the capture's other files a folder listed
/// beside it; an instance's picture has none and carries its companion on its
/// origin instead. `canFetchOriginal` is the web's `origin.fetchOriginal`
/// being there — a source that hands a proxy over always gives one.
public func sensorSourceFor(
    _ file: SavedMediaRef,
    _ origin: MediaOrigin?,
    _ siblings: [SavedMediaRef] = [],
    _ assetId: String? = nil,
    held: HeldOriginals? = nil,
    canFetchOriginal: Bool = true
) -> SensorSource? {
    if isRawImage(file.name) {
        return SensorSource(reach: .file, name: file.name, bytes: file.size, key: nil, held: file, fetch: nil)
    }
    if let sibling = siblings.first(where: { isRawImage($0.name) }) {
        return SensorSource(reach: .sibling, name: sibling.name, bytes: sibling.size, key: nil, held: sibling, fetch: nil)
    }
    if let origin, origin.fidelity == .proxy, let name = origin.name, isRawImage(name), canFetchOriginal {
        return SensorSource(reach: .original, name: name, bytes: origin.bytes, key: assetId,
                            held: heldFile(assetId, held), fetch: .original)
    }
    if let companion = origin?.companion, isRawImage(companion.name) {
        return SensorSource(reach: .companion, name: companion.name, bytes: companion.bytes, key: companion.assetId,
                            held: heldFile(companion.assetId, held), fetch: .companion(assetId: companion.assetId))
    }
    return nil
}

/// The DELIVERED file a stored rendition names (`RollPicture.rendition`,
/// `delivered:<name>`), found the same way the sensor is: the file itself, a
/// folder sibling, the proxy's original, the capture's companion — by NAME,
/// since two files of one capture never share one. Nil for `proxy`, for
/// nothing stored, and for a name this capture no longer offers, in which case
/// the picture leaves from where it opens.
public func deliveredSourceFor(
    _ rendition: String?,
    _ file: SavedMediaRef,
    _ origin: MediaOrigin?,
    _ siblings: [SavedMediaRef] = [],
    _ assetId: String? = nil,
    held: HeldOriginals? = nil,
    canFetchOriginal: Bool = true
) -> SensorSource? {
    let prefix = "delivered:"
    guard let rendition, rendition.hasPrefix(prefix) else { return nil }
    let wanted = String(rendition.dropFirst(prefix.count)).lowercased()
    func isNamed(_ name: String) -> Bool { name.lowercased() == wanted }
    if isNamed(file.name) && origin?.fidelity != .proxy {
        return SensorSource(reach: .file, name: file.name, bytes: file.size, key: nil, held: file, fetch: nil)
    }
    if let sibling = siblings.first(where: { isNamed($0.name) }) {
        return SensorSource(reach: .sibling, name: sibling.name, bytes: sibling.size, key: nil, held: sibling, fetch: nil)
    }
    if let origin, origin.fidelity == .proxy, let name = origin.name, !name.isEmpty, isNamed(name), canFetchOriginal {
        return SensorSource(reach: .original, name: name, bytes: origin.bytes, key: assetId,
                            held: heldFile(assetId, held), fetch: .original)
    }
    if let companion = origin?.companion, isNamed(companion.name) {
        return SensorSource(reach: .companion, name: companion.name, bytes: companion.bytes, key: companion.assetId,
                            held: heldFile(companion.assetId, held), fetch: .companion(assetId: companion.assetId))
    }
    return nil
}

/// Why a source's bytes could not be had.
public enum SensorSourceError: Error, Equatable, Sendable {
    /// Neither held nor fetchable from here.
    case unreachable(String)

    public var message: String {
        switch self {
        case .unreachable(let name): return "\(name) is not reachable from here"
        }
    }
}

/// A source's bytes: what is held, else fetched once and held for the
/// session under its key. `fetch` is the app's — on the web a TASK named after
/// the file, on the picture's edge, cancellable; a cancel is the error it throws.
public func fetchSourceFile(
    _ source: SensorSource,
    held: HeldOriginals,
    fetch: (SensorFetch) async throws -> SavedMediaRef
) async throws -> SavedMediaRef {
    if let file = source.held { return file }
    if let key = source.key, let file = held.heldOriginal(key) { return file }
    guard let how = source.fetch else { throw SensorSourceError.unreachable(source.name) }
    let fetched = try await fetch(how)
    if let key = source.key { held.holdOriginal(key, fetched) }
    return fetched
}
