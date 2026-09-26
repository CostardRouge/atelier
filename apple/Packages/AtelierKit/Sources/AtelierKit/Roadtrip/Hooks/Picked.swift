// The pictures an author picked for an opener, as they are stored in its
// options — read defensively, and ordered the way they were shot. Port of
// `src/shared/roadtrip/hooks/picked.ts`.
//
// Grown in Défilé, lifted out when the drive wanted the same list with one
// more thing on it: the POSITION a picture was shot at, so a geotagged
// picture can be a stop on a map. Défilé ignores the position.
//
// Rules kept:
// - A stored entry is never trusted: one with no readable ref or day is
//   dropped, a second entry for the same picture (by `hookPictureKey`) is
//   dropped, a position that is not two finite numbers inside the globe is
//   dropped. What a newer build wrote beside the known keys is left behind.
// - A ref's size and date are read only from JSON NUMBERS (the web's
//   `Number.isFinite`, which never coerces a string).

import Foundation

/// A stored position, or nil: two finite numbers inside the globe's bounds.
public func readCoords(_ raw: JSONValue?) -> GeoPoint? {
    guard let o = raw?.objectValue,
          case .number(let lat)? = o["lat"], case .number(let lon)? = o["lon"],
          lat.isFinite, lon.isFinite, abs(lat) <= 90, abs(lon) <= 180 else { return nil }
    return GeoPoint(lat: lat, lon: lon)
}

/// `/^\d{4}-\d{2}-\d{2}$/`.
private func isIsoDay(_ s: String) -> Bool {
    let b = Array(s.utf8)
    guard b.count == 10 else { return false }
    for (i, c) in b.enumerated() {
        if i == 4 || i == 7 {
            if c != UInt8(ascii: "-") { return false }
        } else if c < UInt8(ascii: "0") || c > UInt8(ascii: "9") {
            return false
        }
    }
    return true
}

/// A stored ref kept only when it names a file; its size and date only when
/// they are finite numbers.
private func pickedRef(_ raw: JSONValue?) -> SavedMediaRef? {
    guard let r = raw?.objectValue, let name = r["name"]?.stringValue, !name.isEmpty else { return nil }
    let size = r["size"]?.finiteNumber ?? 0
    var ref = SavedMediaRef(name: name, size: abs(size) < 9e15 ? Int(size) : 0,
                            lastModified: r["lastModified"]?.finiteNumber ?? 0)
    if let assetId = r["assetId"]?.stringValue, !assetId.isEmpty { ref.assetId = assetId }
    if let hash = r["hash"]?.stringValue, !hash.isEmpty { ref.hash = hash }
    return ref
}

/// A stored picked list, read defensively (see the header).
public func readPicked(_ raw: JSONValue?) -> [HookPickedPicture] {
    guard let list = raw?.arrayValue else { return [] }
    var seen = Set<String>()
    var out: [HookPickedPicture] = []
    for item in list {
        guard let o = item.objectValue else { continue }
        guard let date = o["date"]?.stringValue, isIsoDay(date) else { continue }
        guard let ref = pickedRef(o["ref"]) else { continue }
        let key = hookPictureKey(ref)
        if seen.contains(key) { continue }
        seen.insert(key)
        var takenAt: Double? = nil
        if case .number(let n)? = o["takenAt"], n.isFinite { takenAt = n }
        out.append(HookPickedPicture(ref: ref, date: date, takenAt: takenAt, coords: readCoords(o["coords"])))
    }
    return out
}

/// Picked pictures in the order they were shot: day, then instant (an unknown
/// one last), then name — a stable sort, as the web's.
public func sortPicked(_ picked: [HookPickedPicture]) -> [HookPickedPicture] {
    let unknown = 9_007_199_254_740_991.0 // Number.MAX_SAFE_INTEGER
    func order(_ a: HookPickedPicture, _ b: HookPickedPicture) -> Int {
        if a.date != b.date { return a.date < b.date ? -1 : 1 }
        let ta = a.takenAt ?? unknown
        let tb = b.takenAt ?? unknown
        if ta != tb { return ta < tb ? -1 : 1 }
        return packLocaleCompare(a.ref.name, b.ref.name)
    }
    return picked.enumerated()
        .sorted { x, y in
            let c = order(x.element, y.element)
            return c != 0 ? c < 0 : x.offset < y.offset
        }
        .map(\.element)
}

/// Where each picked picture falls against a piece.
public struct PickedPartition: Equatable, Sendable {
    /// Shot on a day of the trip, no later than the piece's own — in shot order.
    public var inReach: [HookPickedPicture]
    /// How many were shot after the piece's day.
    public var after: Int
    /// How many were shot outside the trip altogether.
    public var outside: Int

    public init(inReach: [HookPickedPicture], after: Int, outside: Int) {
        self.inReach = inReach; self.after = after; self.outside = outside
    }
}

/// Where each picked picture falls against this piece: in reach (shot on a
/// day of the trip, no later than the piece's own), after it, or outside the
/// trip altogether. A panel says the last two out loud; a plan uses the first.
public func partitionPicked(_ calendar: [HookDay], _ date: IsoDate, _ picked: [HookPickedPicture]) -> PickedPartition {
    let days = Set(calendar.map(\.date))
    var inReach: [HookPickedPicture] = []
    var after = 0
    var outside = 0
    for picture in picked {
        if !days.contains(picture.date) {
            outside += 1
        } else if picture.date > date {
            after += 1
        } else {
            inReach.append(picture)
        }
    }
    return PickedPartition(inReach: sortPicked(inReach), after: after, outside: outside)
}

/// `k` items spread evenly over `items`, first and last always kept. Fewer
/// than `k` comes back whole: a sweep never repeats a day to reach a count.
public func sampleEvenly<T>(_ items: [T], _ k: Int) -> [T] {
    if k <= 0 { return [] }
    if items.count <= k { return items }
    if k == 1 { return [items[items.count - 1]] }
    var out: [T] = []
    out.reserveCapacity(k)
    for i in 0..<k {
        let index = TripJS.round(Double(i * (items.count - 1)) / Double(k - 1))
        out.append(items[Int(index)])
    }
    return out
}
