// A CAMERA PLATE — port of `src/shared/overlay/camera-plate.ts`: what the
// author chose (the facts, in order, one of eight layouts, where it sits, how
// big) and the plate's words, then (`MARK: - runs`) the plate laid out in U
// and the ordinary text elements it becomes on a frame.
//
// Rules kept:
// - A plate is built from ordinary `text` elements handed to the overlay
//   engine, never drawn by a renderer of its own, so preview and delivery
//   cannot disagree.
// - A pure module cannot measure text, so anything set SIDE BY SIDE (a
//   plate's columns, a ledger's label and value, a viewfinder's readout) is in
//   JetBrains Mono, pinned against the theme, whose advance is exactly 0.6 em:
//   widths are arithmetic. A run alone on its line keeps the theme's face.
// - Geometry is in U (a fraction of the frame's SHORTER side), converted to
//   frame fractions only when the elements are made.
// - None of the chosen fields recorded is NO plate, never a blank one.
// - Text lengths count code points, the web's `[...text].length`.
// - The SPEC is stored; the facts it is filled with never are — they are
//   measured from the picture at every render (`CameraFacts.swift`).
// - A stored spec is read defensively, field by field: a list that is not one
//   keeps the legacy six, an unknown field is dropped and a repeated one kept
//   once, the size clamped to 0.6…1.8, an unknown layout or place the default.
// - The WORDS are stored as they were TYPED, blanks included (a field that
//   snapped back to its default the moment it was emptied could not be
//   retyped); the drawing reads a blank as the English default
//   (`cameraWordsOf`).

import Foundation

public enum PlateLayout: String, CaseIterable, Sendable {
    case line, tiers, plate, ledger, caption, viewfinder, bar, margin
}

/// Under the badge's block, or in one cell of the frame's 3×3 grid.
public enum PlatePlace: Equatable, Sendable {
    case badge
    case cell(OverlayAnchor)

    public init?(rawValue: String) {
        if rawValue == "badge" { self = .badge; return }
        guard let anchor = OverlayAnchor(rawValue: rawValue) else { return nil }
        self = .cell(anchor)
    }

    public var rawValue: String {
        switch self {
        case .badge: return "badge"
        case .cell(let anchor): return anchor.rawValue
        }
    }
}

/// What the author chose. Stored; the facts it is filled with never are.
public struct CameraPlateSpec: Equatable, Sendable {
    /// The facts shown, in the order they are read.
    public var fields: [CameraField]
    public var layout: PlateLayout
    public var place: PlatePlace
    /// A multiple of the plate's own size, 0.6..1.8.
    public var size: Double

    public init(fields: [CameraField], layout: PlateLayout, place: PlatePlace, size: Double) {
        self.fields = fields; self.layout = layout; self.place = place; self.size = size
    }

    /// The spec as the document holds it.
    public var json: JSONValue {
        .object([
            "fields": .array(fields.map { .string($0.rawValue) }),
            "layout": .string(layout.rawValue),
            "place": .string(place.rawValue),
            "size": .number(size),
        ])
    }
}

public let minPlateSize = 0.6
public let maxPlateSize = 1.8

/// What a credit that never chose draws: the legacy line, under the badge.
public func defaultPlateSpec() -> CameraPlateSpec {
    CameraPlateSpec(fields: legacyCameraFields, layout: .line, place: .badge, size: 1)
}

/// A stored spec read defensively — junk lands on the defaults, field by field.
public func readPlateSpec(_ value: JSONValue?) -> CameraPlateSpec {
    let v = value?.objectValue ?? [:]
    var out = defaultPlateSpec()
    if let list = v["fields"]?.arrayValue {
        var seen = Set<CameraField>()
        out.fields = list.compactMap { entry -> CameraField? in
            guard let field = entry.stringValue.flatMap(CameraField.init(rawValue:)), !seen.contains(field) else { return nil }
            seen.insert(field)
            return field
        }
    }
    if let size = v["size"]?.finiteNumber { out.size = min(maxPlateSize, max(minPlateSize, size)) }
    if let layout = v["layout"]?.stringValue.flatMap(PlateLayout.init(rawValue:)) { out.layout = layout }
    if let place = v["place"]?.stringValue.flatMap(PlatePlace.init(rawValue:)) { out.place = place }
    return out
}

/// The plate's words. English by default and every one editable on the trip,
/// like the badge's own: a plate is published copy.
public struct CameraWords: Equatable, Sendable {
    /// What an italic caption opens with: "Shot on DJI Mini 4 Pro".
    public var shotOn: String
    /// Each fact's label, where a layout labels them.
    public var tags: [CameraField: String]

    public init(shotOn: String, tags: [CameraField: String]) {
        self.shotOn = shotOn
        self.tags = tags
    }

    /// The words as the document holds them — every tag the record has.
    public var json: JSONValue {
        var t: [String: JSONValue] = [:]
        for (field, word) in tags { t[field.rawValue] = .string(word) }
        return .object(["shotOn": .string(shotOn), "tags": .object(t)])
    }
}

/// The web's `DEFAULT_CAMERA_WORDS`.
public let defaultCameraWords = CameraWords(shotOn: "Shot on", tags: [
    .body: "Camera", .lens: "Lens", .focal35: "Focal", .focal: "Focal", .aperture: "Aperture",
    .shutter: "Shutter", .iso: "ISO", .ev: "EV", .altitude: "Height",
])

/// The web's `FRENCH_CAMERA_WORDS`.
public let frenchCameraWords = CameraWords(shotOn: "Pris au", tags: [
    .body: "Boîtier", .lens: "Objectif", .focal35: "Focale", .focal: "Focale", .aperture: "Ouverture",
    .shutter: "Vitesse", .iso: "ISO", .ev: "IL", .altitude: "Hauteur",
])

/// Words for DRAWING: every missing or blank one is the English default.
public func cameraWordsOf(_ words: CameraWords?) -> CameraWords {
    var tags = defaultCameraWords.tags
    for info in cameraFields {
        if let t = words?.tags[info.id], !t.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { tags[info.id] = t }
    }
    let shotOn = words?.shotOn ?? ""
    return CameraWords(
        shotOn: shotOn.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? defaultCameraWords.shotOn : shotOn,
        tags: tags
    )
}

/// Words as a trip STORES them, read back — what was typed, blanks included,
/// every tag the record lacks taking its English default (the trip settings'
/// own reading, `{ ...DEFAULT_CAMERA_WORDS.tags, ...stored.tags }`). Nil when
/// there is no record: a trip written before the plate existed has none.
public func readCameraWords(_ raw: JSONValue?) -> CameraWords? {
    guard let o = raw?.objectValue else { return nil }
    var tags = defaultCameraWords.tags
    let stored = o["tags"]?.objectValue ?? [:]
    for field in CameraField.allCases {
        if let word = stored[field.rawValue]?.stringValue { tags[field] = word }
    }
    return CameraWords(shotOn: o["shotOn"]?.stringValue ?? defaultCameraWords.shotOn, tags: tags)
}

// MARK: - runs: the plate in U, before it is anywhere

/// One of the eight layouts, as the picker offers it. The web's `PLATE_LAYOUTS`.
public struct PlateLayoutOption: Equatable, Sendable {
    public let id: PlateLayout
    public let label: String
    public let hint: String
}

public let plateLayouts: [PlateLayoutOption] = [
    PlateLayoutOption(id: .line, label: "Line", hint: "Every fact on one line, as the credit always read"),
    PlateLayoutOption(id: .tiers, label: "Two tiers", hint: "What took it in small capitals, the numbers under it"),
    PlateLayoutOption(id: .plate, label: "Plate", hint: "The numbers large, each over its own label"),
    PlateLayoutOption(id: .ledger, label: "Ledger", hint: "Label and value, row by row"),
    PlateLayoutOption(id: .caption, label: "Caption", hint: "An italic “Shot on…”, the numbers under it"),
    PlateLayoutOption(id: .viewfinder, label: "Viewfinder", hint: "The exposure as a camera shows it, with its meter"),
    PlateLayoutOption(id: .bar, label: "Edge bar", hint: "Across the top or bottom edge, what took it at one end"),
    PlateLayoutOption(id: .margin, label: "Margin", hint: "A column down the left or right edge"),
]

/// The horizontal side a run or a plate hangs from — the web's
/// `'left' | 'center' | 'right'`.
public enum PlateAlign: String, CaseIterable, Sendable {
    case left, center, right
}

/// The face a run is set in: the title style's, or pinned mono / serif.
public enum PlateFont: String, CaseIterable, Sendable {
    case theme, mono, serif
}

/// The edge a layout is bound to: the bar's top or bottom, the margin's side.
public enum PlateEdge: String, CaseIterable, Sendable {
    case top, bottom, left, right
}

/// One line of text in the plate.
public struct PlateRun: Equatable, Sendable {
    public var text: String
    /// Horizontal position in U from the plate's REFERENCE — its left edge when
    /// aligned left, its right edge when aligned right, its middle when centred.
    public var x: Double
    /// Top of the run's box, in U from the plate's top.
    public var y: Double
    /// The run's size in U (its `sizeFrac` is size × U).
    public var size: Double
    /// Which side of the run `x` names.
    public var align: PlateAlign
    public var font: PlateFont
    public var italic: Bool?
    public var letterSpacingEm: Double?
    /// A position across the WHOLE frame, 0..1, overriding `x` — an edge bar
    /// puts one run at each end of the frame.
    public var frameX: Double?

    public init(text: String, x: Double, y: Double, size: Double, align: PlateAlign, font: PlateFont,
                italic: Bool? = nil, letterSpacingEm: Double? = nil, frameX: Double? = nil) {
        self.text = text; self.x = x; self.y = y; self.size = size; self.align = align; self.font = font
        self.italic = italic; self.letterSpacingEm = letterSpacingEm; self.frameX = frameX
    }
}

public struct PlateRuns: Equatable, Sendable {
    public var runs: [PlateRun]
    /// The plate's height in U.
    public var height: Double
    /// Where it goes, once edges have had their say (a bar is never "under the badge").
    public var place: PlatePlace
    /// A layout bound to an edge, or nil.
    public var edge: PlateEdge?

    public init(runs: [PlateRun], height: Double, place: PlatePlace, edge: PlateEdge?) {
        self.runs = runs; self.height = height; self.place = place; self.edge = edge
    }
}

/// JetBrains Mono's advance: every glyph, 600 of 1000 units.
public let monoAdvance = 0.6

/// A text's length as the web's `[...text].length` counts it: code points.
private func plateLength(_ text: String) -> Double {
    Double(text.unicodeScalars.count)
}

/// A generous ESTIMATE of a proportional face's width in U — only ever used
/// to decide whether two things would meet, never to place a column.
public func approxWidth(_ text: String, _ size: Double, _ letterSpacingEm: Double = 0) -> Double {
    plateLength(text) * (0.6 + letterSpacingEm) * size
}

/// The width in U of `text` set in mono at `size`, letter spacing included.
public func monoWidth(_ text: String, _ size: Double, _ letterSpacingEm: Double = 0) -> Double {
    plateLength(text) * (monoAdvance + letterSpacingEm) * size
}

/// The plate's horizontal extent in U, about its reference: exact for mono
/// runs, estimated for the rest. For a preview to size itself by.
public func plateSpan(_ plate: PlateRuns) -> Double {
    var lo = 0.0
    var hi = 0.0
    for r in plate.runs where r.frameX == nil {
        let spacing = r.letterSpacingEm ?? 0
        let w = r.font == .mono ? monoWidth(r.text, r.size, spacing) : approxWidth(r.text, r.size, spacing)
        let a: Double
        switch r.align {
        case .left: a = r.x
        case .right: a = r.x - w
        case .center: a = r.x - w / 2
        }
        lo = min(lo, a)
        hi = max(hi, a + w)
    }
    return hi - lo
}

/// The horizontal half of an anchor.
public func columnOf(_ anchor: OverlayAnchor) -> PlateAlign {
    let raw = anchor.rawValue
    if raw.hasSuffix("-left") { return .left }
    if raw.hasSuffix("-right") { return .right }
    return .center
}

private enum PlateRow: String { case top, center, bottom }

private func plateRowOf(_ anchor: OverlayAnchor) -> PlateRow {
    let raw = anchor.rawValue
    if raw.hasPrefix("top-") { return .top }
    if raw.hasPrefix("bottom-") { return .bottom }
    return .center
}

/// Shift runs laid out from a left edge onto the alignment's reference.
private func realign(_ runs: [PlateRun], _ width: Double, _ align: PlateAlign) -> [PlateRun] {
    if align == .left { return runs }
    let shift = align == .right ? -width : -width / 2
    return runs.map { r in
        var out = r
        out.x = r.x + shift
        return out
    }
}

/// A fact as a viewfinder shows it: `F1.7`, `ISO100`, `1/240`.
private func readout(_ f: CameraFact) -> String {
    if f.field == .aperture {
        let value = f.value.hasPrefix("ƒ/") ? String(f.value.dropFirst(2)) : f.value
        return "F\(value)"
    }
    if f.field == .iso { return "ISO\(f.bare)" }
    return f.value.replacingOccurrences(of: " ", with: "")
}

/// The meter's ticks: −2 to +2 EV in thirds, whole stops marked.
private let meterTicks = 13

/// How far an edge bar sits in from the frame's sides, as a fraction of the width.
private let barInset = 0.05

/// The runs of `spec.layout` for the facts in hand, or nil when none of the
/// chosen fields is recorded — the credit is then ABSENT, never a blank plate.
/// `align` is the side a plate hangs from; an edge layout decides its own.
/// `frameWidth` (the frame's width in U), when known, is what an edge bar has
/// to fit its two ends into; nil assumes they fit.
public func plateRuns(_ facts: CameraFacts, _ spec: CameraPlateSpec, _ words: CameraWords, _ align: PlateAlign,
                      _ frameWidth: Double? = nil) -> PlateRuns? {
    let picked = pickFacts(facts, spec.fields)
    let meterWanted = spec.layout == .viewfinder && spec.fields.contains(.ev) && facts.evStops != nil
    if picked.isEmpty && !meterWanted { return nil }

    let ids = picked.filter { isIdentityField($0.field) }
    let nums = picked.filter { !isIdentityField($0.field) }
    let tag = { (f: CameraFact) in (words.tags[f.field] ?? "").uppercased() }
    let place = spec.place

    switch spec.layout {
    case .line:
        let text = picked.map(\.value).joined(separator: " · ")
        return PlateRuns(runs: [PlateRun(text: text, x: 0, y: 0, size: 1, align: align, font: .theme)],
                         height: 1, place: place, edge: nil)

    case .tiers:
        var runs: [PlateRun] = []
        var y = 0.0
        if !ids.isEmpty {
            runs.append(PlateRun(text: ids.map(\.value).joined(separator: "  —  ").uppercased(), x: 0, y: y,
                                 size: 0.8, align: align, font: .theme, letterSpacingEm: 0.12))
            y += 0.8 + 0.5
        }
        if !nums.isEmpty {
            runs.append(PlateRun(text: nums.map(\.value).joined(separator: "   "), x: 0, y: y, size: 1,
                                 align: align, font: .mono, letterSpacingEm: 0))
            y += 1
        } else {
            y -= 0.5
        }
        return PlateRuns(runs: runs, height: y, place: place, edge: nil)

    case .plate:
        var runs: [PlateRun] = []
        var y = 0.0
        if !ids.isEmpty {
            runs.append(PlateRun(text: ids.map(\.value).joined(separator: " · ").uppercased(), x: 0, y: y,
                                 size: 0.72, align: align, font: .theme, letterSpacingEm: 0.14))
            y += 0.72 + 0.7
        }
        if nums.isEmpty { return PlateRuns(runs: runs, height: max(0, y - 0.7), place: place, edge: nil) }
        var cells: [PlateRun] = []
        var x = 0.0
        let gap = 1.3
        for (i, f) in nums.enumerated() {
            let value = f.field == .iso || f.field == .ev ? f.bare : f.value
            let label = tag(f)
            let w = max(monoWidth(value, 1.5), monoWidth(label, 0.5, 0.12))
            cells.append(PlateRun(text: value, x: x, y: y, size: 1.5, align: .left, font: .mono, letterSpacingEm: 0))
            cells.append(PlateRun(text: label, x: x, y: y + 1.5 + 0.4, size: 0.5, align: .left, font: .mono,
                                  letterSpacingEm: 0.12))
            x += w + (i < nums.count - 1 ? gap : 0)
        }
        runs.append(contentsOf: realign(cells, x, align))
        return PlateRuns(runs: runs, height: y + 1.5 + 0.4 + 0.5, place: place, edge: nil)

    case .ledger:
        let rows = picked.map { (label: tag($0), value: $0.value) }
        let labelW = rows.map { monoWidth($0.label, 0.58, 0.12) }.max() ?? -.infinity
        let valueW = rows.map { monoWidth($0.value, 0.95) }.max() ?? -.infinity
        let gap = 1.4
        let width = labelW + gap + valueW
        let pitch = 1.45
        var runs: [PlateRun] = []
        for (i, r) in rows.enumerated() {
            let top = Double(i) * pitch
            // Tops offset so the two faces sit on one baseline: a cap is ~0.73 em.
            runs.append(PlateRun(text: r.label, x: 0, y: top + (0.95 - 0.58) * 0.73, size: 0.58, align: .left,
                                 font: .mono, letterSpacingEm: 0.12))
            runs.append(PlateRun(text: r.value, x: width, y: top, size: 0.95, align: .right, font: .mono,
                                 letterSpacingEm: 0))
        }
        let height = Double(rows.count) * pitch - (pitch - 0.95)
        return PlateRuns(runs: realign(runs, width, align), height: height, place: place, edge: nil)

    case .caption:
        var runs: [PlateRun] = []
        var y = 0.0
        let body = ids.first { $0.field == .body }
        let lens = ids.first { $0.field == .lens }
        let head: String
        if let body {
            let lensPart = lens.map { ", \($0.value)" } ?? ""
            head = "\(words.shotOn.trimmingCharacters(in: .whitespacesAndNewlines)) \(body.value)\(lensPart)"
                .trimmingCharacters(in: .whitespacesAndNewlines)
        } else {
            head = lens?.value ?? ""
        }
        if !head.isEmpty {
            runs.append(PlateRun(text: head, x: 0, y: y, size: 1.5, align: align, font: .serif, italic: true))
            y += 1.5 + 0.45
        }
        if !nums.isEmpty {
            runs.append(PlateRun(text: nums.map(\.value).joined(separator: "  ·  "), x: 0, y: y, size: 0.7,
                                 align: align, font: .mono, letterSpacingEm: 0.04))
            y += 0.7
        } else if !head.isEmpty {
            y -= 0.45
        }
        return PlateRuns(runs: runs, height: y, place: place, edge: nil)

    case .viewfinder:
        // A viewfinder shows the exposure, not the name of the camera it is in.
        let shown = nums.filter { $0.field != .ev }.map(readout)
        let gap = 1.6
        var runs: [PlateRun] = []
        var x = 0.0
        for (i, text) in shown.enumerated() {
            runs.append(PlateRun(text: text, x: x, y: 0, size: 1, align: .left, font: .mono, letterSpacingEm: 0.04))
            x += monoWidth(text, 1, 0.04) + (i < shown.count - 1 ? gap : 0)
        }
        var height = shown.isEmpty ? 0.0 : 1.0
        if meterWanted {
            if !shown.isEmpty { x += gap }
            let ticks = (0..<meterTicks).map { $0 % 3 == 0 ? "|" : "·" }.joined()
            let scale = "−\(ticks)+"
            let k = 0.8
            runs.append(PlateRun(text: scale, x: x, y: 0.1, size: k, align: .left, font: .mono, letterSpacingEm: 0))
            let stops = max(-2, min(2, facts.evStops ?? 0))
            let tick = TripJS.round((stops + 2) * 3)
            // Under its tick: the scale's first glyph is the minus, then the ticks.
            let at = x + (1 + tick + 0.5) * monoAdvance * k
            runs.append(PlateRun(text: "▲", x: at, y: 0.1 + k * 0.85, size: 0.55, align: .center, font: .mono,
                                 letterSpacingEm: 0))
            x += monoWidth(scale, k)
            height = max(height, 0.1 + k * 0.85 + 0.55)
        }
        return PlateRuns(runs: realign(runs, x, align), height: height, place: place, edge: nil)

    case .bar:
        // Across a whole edge: what took it at the start, the numbers at the end.
        var top = false
        if case .cell(let anchor) = place { top = plateRowOf(anchor) == .top }
        let left = ids.map(\.value).joined(separator: "  ·  ")
        let right = nums.map(\.value).joined(separator: "   ")
        // Two ends of one line, unless they would meet: a bar that cannot hold
        // both on one line sets them on two rather than let them collide.
        let room = frameWidth.map { $0 * (1 - 2 * barInset) } ?? .infinity
        let leftNeed = left.isEmpty ? 0 : approxWidth(left, 1)
        let rightNeed = right.isEmpty ? 0 : monoWidth(right, 0.9, 0.02)
        let need = leftNeed + rightNeed + (!left.isEmpty && !right.isEmpty ? 2 : 0)
        let stacked = need > room
        let twoLines = stacked && !left.isEmpty
        var runs: [PlateRun] = []
        if !left.isEmpty {
            runs.append(PlateRun(text: left, x: 0, y: 0, size: 1, align: .left, font: .theme, frameX: barInset))
        }
        if !right.isEmpty {
            runs.append(PlateRun(text: right, x: 0, y: twoLines ? 1.45 : 0.08, size: 0.9,
                                 align: twoLines ? .left : .right, font: .mono, letterSpacingEm: 0.02,
                                 frameX: twoLines ? barInset : 1 - barInset))
        }
        let height = twoLines && !right.isEmpty ? 1.45 + 0.9 : 1
        return PlateRuns(runs: runs, height: height, place: .cell(top ? .topCenter : .bottomCenter),
                         edge: top ? .top : .bottom)

    case .margin:
        // A column down one side: left if the cell says so, the right otherwise.
        var side = PlateAlign.right
        if case .cell(let anchor) = place, columnOf(anchor) == .left { side = .left }
        var runs: [PlateRun] = []
        var y = 0.0
        for f in ids {
            runs.append(PlateRun(text: f.value.uppercased(), x: 0, y: y, size: 0.62, align: side, font: .theme,
                                 letterSpacingEm: 0.12))
            y += 0.62 + 0.45
        }
        if !ids.isEmpty && !nums.isEmpty { y += 0.35 }
        for f in nums {
            runs.append(PlateRun(text: tag(f), x: 0, y: y, size: 0.48, align: side, font: .mono, letterSpacingEm: 0.14))
            runs.append(PlateRun(text: f.field == .iso || f.field == .ev ? f.bare : f.value, x: 0, y: y + 0.48 + 0.3,
                                 size: 1, align: side, font: .mono, letterSpacingEm: 0))
            y += 0.48 + 0.3 + 1 + 0.6
        }
        let height = max(0, y - (nums.isEmpty ? 0.45 : 0.6))
        var row = PlateRow.center
        if case .cell(let anchor) = place { row = plateRowOf(anchor) }
        let cell: OverlayAnchor
        switch (row, side) {
        case (.top, .left): cell = .topLeft
        case (.top, _): cell = .topRight
        case (.bottom, .left): cell = .bottomLeft
        case (.bottom, _): cell = .bottomRight
        case (.center, .left): cell = .centerLeft
        case (.center, _): cell = .centerRight
        }
        return PlateRuns(runs: runs, height: height, place: .cell(cell), edge: side == .left ? .left : .right)
    }
}

// MARK: - elements: the plate somewhere on a frame

/// A length in U of the shorter side, as a fraction of the frame's WIDTH.
private func plateWidthFraction(_ u: Double, _ aspect: Double) -> Double {
    u * min(1, 1 / aspect)
}

/// A length in U of the shorter side, as a fraction of the frame's HEIGHT.
public func heightFraction(_ u: Double, _ aspect: Double) -> Double {
    u * min(1, aspect)
}

/// Where a plate hangs from: the reference x of its column, its top, and the side.
public struct PlateOrigin: Equatable, Sendable {
    public var x: Double
    public var top: Double
    public var align: PlateAlign

    public init(x: Double, top: Double, align: PlateAlign = .left) { self.x = x; self.top = top; self.align = align }
}

/// Where a plate placed in a GRID cell hangs from: the reference x of its
/// column (the badge grid's own insets) and its top, in frame fractions.
public func gridOrigin(_ plate: PlateRuns, _ unit: Double, _ aspect: Double) -> PlateOrigin {
    var cell = OverlayAnchor.bottomRight
    if case .cell(let anchor) = plate.place { cell = anchor }
    let h = heightFraction(plate.height * unit, aspect)
    let edgeInset = plate.edge != nil ? 0.045 : 0
    let col = columnOf(cell)
    let x = col == .left ? 0.07 - edgeInset : col == .right ? 0.93 + edgeInset : 0.5
    let top: Double
    switch plateRowOf(cell) {
    case .top: top = 0.08 - edgeInset
    case .bottom: top = 0.92 + edgeInset - h
    case .center: top = 0.5 - h / 2
    }
    return PlateOrigin(x: x, top: top, align: col)
}

/// The element id of a plate's `i`-th run under `baseId` — the first keeps the id itself.
public func plateRunId(_ baseId: String, _ i: Int) -> String {
    i == 0 ? baseId : "\(baseId):\(i)"
}

/// The plate's elements, hung from `origin` (its reference x and its top, in
/// frame fractions). `unit` is U as a fraction of the shorter side. Mono and
/// serif runs pin their face (and the mono ones their letter spacing, which
/// the widths depend on) so a title style cannot break a column.
public func plateElements(_ plate: PlateRuns, _ origin: PlateOrigin, _ unit: Double, _ aspect: Double,
                          _ baseId: String) -> [OverlayElement] {
    plate.runs.enumerated().map { i, run in
        var el = createTextElement(run.text, id: plateRunId(baseId, i))
        switch run.align {
        case .left: el.anchor = .topLeft
        case .center: el.anchor = .topCenter
        case .right: el.anchor = .topRight
        }
        el.x = run.frameX ?? origin.x + plateWidthFraction(run.x * unit, aspect)
        el.y = origin.top + heightFraction(run.y * unit, aspect)
        el.sizeFrac = run.size * unit
        var pins: [String] = []
        if run.font == .mono {
            el.fontFamily = .jetBrainsMono
            pins.append("fontFamily")
        } else if run.font == .serif {
            el.fontFamily = .instrumentSerif
            el.weight = 400
            pins.append(contentsOf: ["fontFamily", "weight"])
        }
        if run.italic == true {
            el.italic = true
            pins.append("italic")
        }
        if let spacing = run.letterSpacingEm {
            el.letterSpacingEm = spacing
            pins.append("letterSpacing")
        }
        el.styleOverrides = pins
        return el
    }
}
