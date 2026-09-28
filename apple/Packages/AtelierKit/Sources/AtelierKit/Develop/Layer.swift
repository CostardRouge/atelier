// An ADJUSTMENT LAYER — a develop that applies only where its mask says. Port
// of `src/shared/develop/layer.ts`, with the reader/writer of the layers a
// roll carries (`RollPicture.layers`) and the mask record's writer.
//
// The one decision it rests on: **a layer's adjustment IS a `DevelopSettings`**
// — the very record the global develop uses, so the same maths, the same bake
// (`composeLutStack`) and the same panel serve a local exposure, a local white
// balance and a local curve at once.
//
// What a layer does NOT have: a blend mode (not in the ask; opacity is the
// control that was asked for) and a look of its own (a LUT is the picture's).
//
// The rules kept:
// - the list is BOTTOM to TOP: entry 0 is applied first; a list on screen shows
//   the top first, and every helper here speaks the real order;
// - a layer's mask is combined with its PARTS in order (Add, Subtract,
//   Intersect — never a subject), then HOLED by the subject it subtracts
//   (`except`) AFTER the invert, so the hole stays a hole whichever way it faces;
// - a stored layer whose develop is junk is KEPT, doing nothing — deleting
//   somebody's layer on a read is never the answer;
// - a layer that would change nothing (off, transparent, untouched develop)
//   draws nothing and costs no pass.

import Foundation

/// A further mask COMBINED with the layer's own — Lightroom's Add, Subtract,
/// Intersect (audit item 16). Any kind but a SUBJECT: a subject intersected
/// with anything is a Subject layer carrying that part, and anything minus the
/// subject is `except`.
public struct MaskPart: Equatable, Sendable {
    public var op: MaskOp
    public var mask: Mask
    /// This part turned inside out before it combines — each part has its own.
    public var invert: Bool

    public init(op: MaskOp, mask: Mask, invert: Bool = false) {
        self.op = op; self.mask = mask; self.invert = invert
    }
}

/// Each part is one more shape the pass evaluates per pixel, and a painted one a texture.
public let maxMaskParts = 4

/// The kinds a part may be — every kind but a subject.
public let partKinds: [MaskKind] = [.linear, .radial, .luma, .colour, .brush]

public struct AdjustLayer: Equatable, Sendable {
    public var id: String
    /// What the list calls it. Empty means "describe the mask instead".
    public var name: String
    /// Where it applies. Nil is the whole picture — a local develop with no shape yet.
    public var mask: Mask?
    /// Apply everywhere the mask ISN'T.
    public var invert: Bool
    /// The id of a SUBJECT layer whose mask is taken OUT of this one — "the
    /// whole picture except the subject" (2026-09-23). Nil, a missing layer or
    /// one that is not a subject subtracts nothing.
    public var except: String?
    /// Further masks combined with `mask`, in order.
    public var parts: [MaskPart]
    public var develop: DevelopSettings
    /// 0..1, how much of the adjustment lands where the mask is full.
    public var opacity: Double
    public var enabled: Bool

    public init(id: String, name: String = "", mask: Mask?, invert: Bool = false, except: String? = nil,
                parts: [MaskPart] = [], develop: DevelopSettings = .default, opacity: Double = 1, enabled: Bool = true) {
        self.id = id; self.name = name; self.mask = mask; self.invert = invert; self.except = except
        self.parts = parts; self.develop = develop; self.opacity = opacity; self.enabled = enabled
    }
}

public let maxLayers = 12

public func newLayerId() -> String {
    UUID().uuidString.lowercased()
}

public func createLayer(_ kind: MaskKind? = .linear, id: String = newLayerId()) -> AdjustLayer {
    AdjustLayer(id: id, name: "", mask: kind.map(defaultMask), invert: false, except: nil, parts: [],
                develop: .default, opacity: 1, enabled: true)
}

private func unitOrFallback(_ v: JSONValue?, _ fallback: Double) -> Double {
    guard let n = v?.finiteNumber else { return fallback }
    return min(1, max(0, n))
}

/// A stored layer read back, or nil when what is stored is not a record at
/// all. An ARRAY is a record to the web's `typeof … === 'object'` and reads as
/// a layer with every field defaulted; so it does here.
public func normaliseLayer(_ raw: JSONValue?, id: String = newLayerId()) -> AdjustLayer? {
    let src: [String: JSONValue]
    switch raw {
    case .object(let o)?: src = o
    case .array?: src = [:]
    default: return nil
    }
    let storedId = src["id"]?.stringValue ?? ""
    let except = src["except"]?.stringValue ?? ""
    return AdjustLayer(
        id: storedId.isEmpty ? id : storedId,
        name: src["name"]?.stringValue.map { String($0.prefix(80)) } ?? "",
        mask: normaliseMask(src["mask"]),
        invert: src["invert"]?.boolValue == true,
        except: except.isEmpty ? nil : except,
        parts: readParts(src["parts"]),
        // A layer whose develop is absent or junk is a layer that does nothing — kept.
        develop: developOrNull(src["develop"]) ?? .default,
        opacity: unitOrFallback(src["opacity"], 1),
        enabled: src["enabled"]?.boolValue != false
    )
}

/// A stored part list: junk and subjects dropped, a bad op read as `add`,
/// capped at `maxMaskParts`.
public func readParts(_ raw: JSONValue?) -> [MaskPart] {
    guard let list = raw?.arrayValue else { return [] }
    var out: [MaskPart] = []
    for entry in list {
        guard let e = entry.objectValue else { continue }
        guard let mask = normaliseMask(e["mask"]), partKinds.contains(mask.kind) else { continue }
        let op = (e["op"]?.stringValue).flatMap { MaskOp(rawValue: $0) } ?? .add
        out.append(MaskPart(op: op, mask: mask, invert: e["invert"]?.boolValue == true))
        if out.count >= maxMaskParts { break }
    }
    return out
}

public func sameParts(_ a: [MaskPart]?, _ b: [MaskPart]?) -> Bool {
    let x = a ?? []
    let y = b ?? []
    guard x.count == y.count else { return false }
    return zip(x, y).allSatisfy { $0.op == $1.op && $0.invert == $1.invert && sameMask($0.mask, $1.mask) }
}

/// A copy safe to hold against a live draft — value types copy on their own;
/// the name survives so a caller reads as the web's does.
public func cloneParts(_ parts: [MaskPart]?) -> [MaskPart] {
    parts ?? []
}

/// A stored list read back, dropping what is not a layer and capping the length.
public func readLayers(_ raw: JSONValue?) -> [AdjustLayer] {
    guard let list = raw?.arrayValue else { return [] }
    return Array(list.compactMap { normaliseLayer($0) }.prefix(maxLayers))
}

/// A layer that would change nothing: off, transparent, or carrying an
/// untouched develop. The renderers skip these, so an author can park a layer
/// at zero without paying a pass for it.
public func layerDraws(_ l: AdjustLayer) -> Bool {
    l.enabled && l.opacity > 0 && !isDefaultDevelop(l.develop)
}

public func drawingLayers(_ layers: [AdjustLayer]?) -> [AdjustLayer] {
    (layers ?? []).filter(layerDraws)
}

private func subjectPoints(_ l: AdjustLayer) -> [Point]? {
    if case .subject(let s)? = l.mask { return s.points }
    return nil
}

/// The layers whose SUBJECT the model must find: every visible one with a
/// point, whether or not it draws yet — a fresh subject has its sliders at
/// zero, and waiting for it to draw meant a tap segmented nothing until a
/// slider moved. A subject another layer SUBTRACTS is wanted even hidden.
public func subjectLayersToSegment(_ layers: [AdjustLayer]?) -> [AdjustLayer] {
    let list = layers ?? []
    let cut = Set(list.compactMap { $0.enabled ? $0.except : nil })
    return list.filter { l in
        guard let points = subjectPoints(l), !points.isEmpty else { return false }
        return l.enabled || cut.contains(l.id)
    }
}

/// The subject layers a DELIVERY must segment: those that draw, and those a
/// drawing layer subtracts — an export segments nothing it would not use.
public func subjectLayersForRender(_ layers: [AdjustLayer]?) -> [AdjustLayer] {
    var needed = Set<String>()
    for l in drawingLayers(layers) {
        if l.mask?.kind == .subject { needed.insert(l.id) }
        if let except = l.except { needed.insert(except) }
    }
    return subjectLayersToSegment(layers).filter { needed.contains($0.id) }
}

/// The subject layers a layer may subtract: every other layer whose mask is a subject.
public func exceptCandidates(_ layers: [AdjustLayer]?, _ id: String) -> [AdjustLayer] {
    (layers ?? []).filter { $0.id != id && $0.mask?.kind == .subject }
}

public func sameLayer(_ a: AdjustLayer, _ b: AdjustLayer) -> Bool {
    a.id == b.id
        && a.name == b.name
        && a.invert == b.invert
        && a.except == b.except
        && sameParts(a.parts, b.parts)
        && a.opacity == b.opacity
        && a.enabled == b.enabled
        && sameMask(a.mask, b.mask)
        && sameDevelop(a.develop, b.develop)
}

public func sameLayers(_ a: [AdjustLayer]?, _ b: [AdjustLayer]?) -> Bool {
    let x = a ?? []
    let y = b ?? []
    guard x.count == y.count else { return false }
    return zip(x, y).allSatisfy { sameLayer($0, $1) }
}

public func cloneLayer(_ l: AdjustLayer) -> AdjustLayer {
    l
}

public func cloneLayers(_ layers: [AdjustLayer]?) -> [AdjustLayer] {
    layers ?? []
}

// MARK: - the list (bottom to top)

/// Appended on TOP, which is where a new layer belongs. Capped at `maxLayers`.
public func addLayer(_ layers: [AdjustLayer]?, _ layer: AdjustLayer) -> [AdjustLayer] {
    let list = layers ?? []
    if list.count >= maxLayers { return list }
    return list + [layer]
}

/// A layer that subtracted the one removed subtracts nothing now, rather than
/// pointing at an id that is gone.
public func removeLayer(_ layers: [AdjustLayer]?, _ id: String) -> [AdjustLayer] {
    (layers ?? []).filter { $0.id != id }.map { l in
        guard l.except == id else { return l }
        var out = l
        out.except = nil
        return out
    }
}

/// `delta` is in STACK terms: +1 is nearer the top, and the ends hold.
public func moveLayer(_ layers: [AdjustLayer]?, _ id: String, _ delta: Int) -> [AdjustLayer] {
    var list = layers ?? []
    guard let from = list.firstIndex(where: { $0.id == id }) else { return list }
    let to = max(0, min(list.count - 1, from + delta))
    if to == from { return list }
    let moved = list.remove(at: from)
    list.insert(moved, at: to)
    return list
}

/// One layer's own fields changed; its id never moves.
public func patchLayer(_ layers: [AdjustLayer]?, _ id: String, _ patch: (inout AdjustLayer) -> Void) -> [AdjustLayer] {
    (layers ?? []).map { l in
        guard l.id == id else { return l }
        var out = l
        patch(&out)
        out.id = l.id
        return out
    }
}

private func opGlyph(_ op: MaskOp) -> String {
    switch op {
    case .add: return "+"
    case .subtract: return "\u{2212}"
    case .intersect: return "\u{2229}"
    }
}

/// `− painted · 2 strokes`, `∩ not shadows` — one part, as the list and a label read it.
public func describePart(_ p: MaskPart) -> String {
    let d = describeMask(p.mask)
    return "\(opGlyph(p.op)) \(p.invert ? "not \(d)" : d)"
}

/// The layer's own name, else what its mask is — never an empty row.
public func layerLabel(_ l: AdjustLayer, _ layers: [AdjustLayer]? = nil) -> String {
    let named = l.name.trimmingCharacters(in: .whitespacesAndNewlines)
    if !named.isEmpty { return named }
    let described = describeMask(l.mask)
    let own = l.invert ? "not \(described)" : described
    let where_ = l.parts.isEmpty ? own : "\(own) \(l.parts.map(describePart).joined(separator: " "))"
    guard let except = l.except,
          let cut = layers?.first(where: { $0.id == except && $0.mask?.kind == .subject }) else { return where_ }
    let cutName = cut.name.trimmingCharacters(in: .whitespacesAndNewlines)
    return "\(where_) except \(cutName.isEmpty ? "the subject" : cutName)"
}

/// One part's value at a pixel, already evaluated (`maskAt`), beside its op and invert.
public struct MaskPartValue: Equatable, Sendable {
    public var op: MaskOp
    public var invert: Bool
    public var value: Double

    public init(op: MaskOp, invert: Bool, value: Double) {
        self.op = op; self.invert = invert; self.value = value
    }
}

/// How much of a layer lands on a pixel: the mask, turned by `invert`,
/// combined with each PART in order (each turned by its own invert first),
/// holed by the subtracted subject, scaled by the opacity. The layer kernel is
/// a transcription of this; the order is the point.
public func layerWeight(_ mask: Double, _ invert: Bool, _ except: Double, _ opacity: Double,
                        _ parts: [MaskPartValue] = []) -> Double {
    var m = invert ? 1 - mask : mask
    for p in parts { m = combineMask(m, p.invert ? 1 - p.value : p.value, p.op) }
    return m * (1 - except) * opacity
}

// MARK: - which mask the author is working on
//
// A layer's masks are the COMPONENT list: nil is its own mask, 0… its parts.
// The stage's gestures (paint, pick, sample) act on the one open in the panel.

public func componentMask(_ l: AdjustLayer, _ part: Int?) -> Mask? {
    guard let part else { return l.mask }
    return l.parts.indices.contains(part) ? l.parts[part].mask : nil
}

/// The layer with one component's mask replaced; an index past the list changes nothing.
public func withComponentMask(_ l: AdjustLayer, _ part: Int?, _ mask: Mask?) -> AdjustLayer {
    var out = l
    guard let part else {
        out.mask = mask
        return out
    }
    guard let mask, l.parts.indices.contains(part) else { return l }
    out.parts[part].mask = mask
    return out
}

/// A part appended, capped at `maxMaskParts`; a subject is refused.
public func addPart(_ l: AdjustLayer, _ op: MaskOp, _ kind: MaskKind) -> AdjustLayer {
    if l.parts.count >= maxMaskParts || !partKinds.contains(kind) { return l }
    var out = l
    out.parts.append(MaskPart(op: op, mask: defaultMask(kind), invert: false))
    return out
}

public func patchPart(_ l: AdjustLayer, _ index: Int, _ patch: (inout MaskPart) -> Void) -> AdjustLayer {
    guard l.parts.indices.contains(index) else { return l }
    var out = l
    patch(&out.parts[index])
    return out
}

public func removePart(_ l: AdjustLayer, _ index: Int) -> AdjustLayer {
    guard l.parts.indices.contains(index) else { return l }
    var out = l
    out.parts.remove(at: index)
    return out
}

// MARK: - the record, written

private func pair(_ p: Point) -> JSONValue {
    .array([.number(p.x), .number(p.y)])
}

extension Mask {
    /// The mask as the web's `mask.ts` records it — `kind` beside the shape's
    /// own fields, points as `[x, y]` pairs — so `normaliseMask` reads it back
    /// to the same value.
    public var json: JSONValue {
        switch self {
        case .linear(let m):
            return .object(["kind": "linear", "x": .number(m.x), "y": .number(m.y), "angle": .number(m.angle),
                            "feather": .number(m.feather)])
        case .radial(let m):
            return .object(["kind": "radial", "x": .number(m.x), "y": .number(m.y), "radiusX": .number(m.radiusX),
                            "radiusY": .number(m.radiusY), "angle": .number(m.angle), "feather": .number(m.feather)])
        case .luma(let m):
            return .object(["kind": "luma", "from": .number(m.from), "to": .number(m.to), "feather": .number(m.feather)])
        case .colour(let m):
            let samples: [JSONValue] = m.samples.map { s in
                .object(["x": .number(s.x), "y": .number(s.y), "r": .number(s.r), "g": .number(s.g), "b": .number(s.b)])
            }
            return .object(["kind": "colour", "samples": .array(samples), "range": .number(m.range)])
        case .brush(let m):
            let strokes: [JSONValue] = m.strokes.map { s in
                .object(["points": .array(s.points.map(pair)), "radius": .number(s.radius),
                         "hardness": .number(s.hardness), "erase": .bool(s.erase)])
            }
            return .object(["kind": "brush", "strokes": .array(strokes)])
        case .subject(let m):
            return .object(["kind": "subject", "points": .array(m.points.map(pair)), "model": .string(m.model)])
        }
    }
}

extension MaskPart {
    public var json: JSONValue {
        .object(["op": .string(op.rawValue), "mask": mask.json, "invert": .bool(invert)])
    }
}

extension AdjustLayer {
    /// The layer as the web writes it into `RollPicture.layers`.
    public var json: JSONValue {
        .object([
            "id": .string(id),
            "name": .string(name),
            "mask": mask?.json ?? .null,
            "invert": .bool(invert),
            "except": except.map { .string($0) } ?? .null,
            "parts": .array(parts.map(\.json)),
            "develop": develop.json,
            "opacity": .number(opacity),
            "enabled": .bool(enabled),
        ])
    }
}

extension RollPicture {
    /// The picture's adjustment layers (`RollPicture.layers`), bottom to top,
    /// read through `readLayers` from what the roll carries. An empty list
    /// takes the field off, which the roll then writes as the web's `[]`.
    public var layers: [AdjustLayer] {
        get { readLayers(carried["layers"]) }
        set { carried["layers"] = newValue.isEmpty ? nil : .array(newValue.map(\.json)) }
    }
}
