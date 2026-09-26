// WHAT A RUN WILL DELIVER, picture by picture, before anything is fetched or
// rendered — the *Delivers* row grown to the whole roll. Port of
// `src/shared/develop/run-plan.ts` (R4 of `docs/capture-renditions.md`).
//
// Which pixels a picture leaves from is the PICTURE's own answer: its RAW when
// it is developed on the sensor, the file it was set to above the photograph,
// else where it opens — where `Auto`'s arithmetic still fetches a proxy's
// original for a frame the proxy cannot fill. The one thing the door still
// says is *proxies only, for this run*: every picture then leaves from what is
// in hand, a RAW base set aside and said. READ-ONLY on purpose
// (`renditions-build.md`): editable it would be the choice above the
// photograph a second time. This module only COUNTS and SAYS.

import Foundation

public enum PlanKind: String, CaseIterable, Sendable {
    case sensor, delivered, proxy, file, missing
}

/// What the export knows of ONE picture's files, gathered by the app.
public struct PictureFacts: Equatable, Sendable {
    /// A proxy's own original — what `Auto` may fetch where the frame asks.
    public struct Original: Equatable, Sendable {
        public var name: String
        public var bytes: Int?
        public var held: Bool
        public init(name: String, bytes: Int?, held: Bool) { self.name = name; self.bytes = bytes; self.held = held }
    }

    /// The file in hand, or nil while it is not.
    public var file: SavedMediaRef?
    /// True when that file is a source's editing rendition.
    public var proxy: Bool
    /// Where the sensor's data would come from, when a RAW is reachable (`sensorSourceFor`).
    public var sensor: SensorSource?
    /// The file the stored rendition names, when the capture still offers it (`deliveredSourceFor`).
    public var delivered: SensorSource?
    /// A proxy's own original; nil where there is none.
    public var original: Original?

    public init(file: SavedMediaRef?, proxy: Bool = false, sensor: SensorSource? = nil, delivered: SensorSource? = nil, original: Original? = nil) {
        self.file = file; self.proxy = proxy; self.sensor = sensor; self.delivered = delivered; self.original = original
    }
}

public struct PicturePlan: Equatable, Sendable {
    public var id: String
    public var name: String
    public var kind: PlanKind
    /// The file the pixels leave from; nil when nothing is in hand.
    public var from: String?
    /// Bytes the run WILL fetch for this picture — 0 when it is in hand.
    public var fetchBytes: Int
    /// Bytes the run MAY fetch on top, where the frame asks for the original.
    public var maybeBytes: Int
    /// The picture's own line, for the list behind the summary.
    public var line: String
}

public struct RunPlan: Equatable, Sendable {
    public var total: Int
    public var pictures: [PicturePlan]
    public var fetchBytes: Int
    public var maybeBytes: Int
    /// The one sentence the panel says.
    public var summary: String
}

/// The web's line says a cost as `<n> B to fetch` and `planRun` rewrites it
/// with the panel's formatter; here the formatter is handed through instead,
/// which writes the same text in one pass.
private func planOne(_ picture: RollPicture, _ facts: PictureFacts, _ proxiesOnly: Bool, _ bytes: (Int) -> String) -> PicturePlan {
    let name = picture.ref.name
    func plan(_ kind: PlanKind, _ from: String?, _ fetch: Int, _ line: String, maybe: Int = 0) -> PicturePlan {
        PicturePlan(id: picture.id, name: name, kind: kind, from: from, fetchBytes: fetch, maybeBytes: maybe, line: line)
    }
    guard let file = facts.file else {
        return plan(.missing, nil, 0, "\(name) — not in hand, left out")
    }
    let onSensor = isRawDevelop(picture.develop)
    if proxiesOnly {
        let aside = onSensor ? ", its RAW base set aside" : ""
        return facts.proxy
            ? plan(.proxy, file.name, 0, "\(name) ← its proxy\(aside)")
            : plan(.file, file.name, 0, "\(name) ← the file itself\(aside)")
    }
    if onSensor, let s = facts.sensor {
        let heldHere = s.held != nil
        let cost = heldHere ? "in hand" : "\(bytes(s.bytes ?? 0)) to fetch"
        return plan(.sensor, s.name, heldHere ? 0 : (s.bytes ?? 0), "\(name) ← \(s.name), the sensor’s data (\(cost))")
    }
    if let d = facts.delivered {
        let heldHere = d.held != nil
        let cost = heldHere ? "in hand" : "\(bytes(d.bytes ?? 0)) to fetch"
        return plan(.delivered, d.name, heldHere ? 0 : (d.bytes ?? 0), "\(name) ← \(d.name) (\(cost))")
    }
    let aside = onSensor ? " — its RAW is out of reach here, the base set aside" : ""
    if facts.proxy {
        let o = facts.original
        let maybe = o.map { $0.held ? 0 : ($0.bytes ?? 0) } ?? 0
        let more = o.map { ", \($0.name) fetched where the frame asks\($0.held ? " (in hand)" : "")" } ?? ""
        return plan(.proxy, file.name, 0, "\(name) ← its proxy\(more)\(aside)", maybe: maybe)
    }
    return plan(.file, file.name, 0, "\(name) ← the file itself\(aside)")
}

/// One picture planned. A cost is said in bytes, `34600000 B to fetch`, as the
/// web's does before `planRun` formats it.
public func planPicture(_ picture: RollPicture, _ facts: PictureFacts, _ proxiesOnly: Bool) -> PicturePlan {
    planOne(picture, facts, proxiesOnly) { "\($0) B" }
}

private func kindWords(_ kind: PlanKind) -> String {
    switch kind {
    case .sensor: return "from the sensor"
    case .delivered: return "from the file chosen"
    case .proxy: return "from the proxy"
    case .file: return "from the file itself"
    case .missing: return "not in hand"
    }
}

/// The whole run: every picture planned, the bytes it costs, and the sentence.
public func planRun(
    _ pictures: [RollPicture],
    _ factsFor: (RollPicture) -> PictureFacts,
    _ proxiesOnly: Bool,
    _ format: (Int) -> String
) -> RunPlan {
    let planned = pictures.map { planOne($0, factsFor($0), proxiesOnly, format) }
    var counts: [PlanKind: Int] = [:]
    var fetchBytes = 0
    var maybeBytes = 0
    for p in planned {
        counts[p.kind, default: 0] += 1
        fetchBytes += p.fetchBytes
        maybeBytes += p.maybeBytes
    }
    var parts = ["\(planned.count) picture\(planned.count == 1 ? "" : "s")"]
    for kind in [PlanKind.sensor, .delivered, .proxy, .file] {
        let n = counts[kind] ?? 0
        if n > 0 { parts.append("\(n) \(kindWords(kind))") }
    }
    let missing = counts[.missing] ?? 0
    if missing > 0 { parts.append("\(missing) not in hand") }
    if fetchBytes > 0 { parts.append("\(format(fetchBytes)) to fetch") }
    if maybeBytes > 0 { parts.append("up to \(format(maybeBytes)) more where a frame asks") }
    if proxiesOnly {
        let aside = pictures.filter { isRawDevelop($0.develop) }.count
        parts.append(aside > 0 ? "proxies only, \(aside) RAW base\(aside == 1 ? "" : "s") set aside" : "proxies only")
    }
    return RunPlan(total: planned.count, pictures: planned, fetchBytes: fetchBytes, maybeBytes: maybeBytes,
                   summary: parts.joined(separator: " · "))
}
