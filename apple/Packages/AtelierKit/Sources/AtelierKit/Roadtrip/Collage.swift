// A slide that holds SEVERAL pictures, as the trip document stores it — port
// of the stored half of `src/shared/roadtrip/collage.ts`: the collage record,
// its cells, how they arrive and leave, the factories and the reader.
//
// The types and the reader, then the behaviour (`MARK: - behaviour`): which
// cells a template draws, the cells' rects, their motion over the slide, the
// settle time, the kept pictures, re-templating, swapping and writing a cell.
// The geometry is `Media/MediaLayout.swift`'s; the paint is the app's.
//
// Rules kept:
// - **Cell 1 IS the slide.** Its picture, framing, develop and motion stay on
//   the slide itself, so every one-picture reader keeps working; `cells`
//   holds cells 2…n, each with its own picture, framing and develop — never
//   inherited.
// - A collage keeps MORE cells than its template draws: a smaller layout
//   keeps the extra pictures in the list, not drawn.
// - A template this build does not know is NO collage: a slide written by a
//   newer Atelier opens as its lead picture, it never fails to open. Junk in
//   a cell lands clamped or empty.

import Foundation

/// One cell after the first: a picture, how it sits, how it is corrected.
public struct CollageCell: Equatable, Sendable {
    public var media: SavedMediaRef?
    public var framing: Framing
    public var develop: DevelopSettings?
    /// How this cell's picture MOVES inside its mask over the slide, or nil.
    public var motion: FramingMotion?
    /// Where the author moved this print, on a free layout; the template's place otherwise.
    public var place: CellPlace

    public init(media: SavedMediaRef? = nil, framing: Framing = .default, develop: DevelopSettings? = nil,
                motion: FramingMotion? = nil, place: CellPlace = defaultCellPlace) {
        self.media = media; self.framing = framing; self.develop = develop; self.motion = motion; self.place = place
    }

    public var json: JSONValue {
        .object([
            "media": media?.json ?? .null, "framing": framing.json, "develop": develop?.json ?? .null,
            "motion": motion?.json ?? .null, "place": place.json,
        ])
    }
}

/// How the cells ARRIVE: one step for all of them, spread by where they sit.
public struct CollageEnter: Equatable, Sendable {
    public var step: AnimStep
    public var stagger: Stagger

    public init(step: AnimStep, stagger: Stagger) {
        self.step = step
        self.stagger = stagger
    }

    public var json: JSONValue {
        .object(["step": step.json, "stagger": stagger.json])
    }
}

/// How the cells LEAVE, laid against the slide's screen time — the last to
/// arrive leaves first when `reverse` is set.
public struct CollageExit: Equatable, Sendable {
    public var step: AnimStep
    public var reverse: Bool

    public init(step: AnimStep, reverse: Bool) {
        self.step = step
        self.reverse = reverse
    }

    public var json: JSONValue {
        .object(["step": step.json, "reverse": .bool(reverse)])
    }
}

public struct SlideCollage: Equatable, Sendable {
    /// A `LayoutTemplates.swift` id; one this build does not know reads as no collage.
    public var template: String
    public var spacing: LayoutSpacing
    /// Painted where no picture covers the frame — between cells and in an empty one.
    public var background: String
    /// Cells 2…n. The slide's own picture is cell 1.
    public var cells: [CollageCell]
    /// Where the SLIDE's own print was moved, on a free layout.
    public var place: CellPlace
    /// The cells' entrance, or nil for cells that are simply there.
    public var enter: CollageEnter?
    /// The cells' exit, or nil for cells that stay to the slide's end.
    public var exit: CollageExit?

    public init(template: String, spacing: LayoutSpacing = defaultLayoutSpacing, background: String = defaultCollageBackground,
                cells: [CollageCell] = [], place: CellPlace = defaultCellPlace, enter: CollageEnter? = nil, exit: CollageExit? = nil) {
        self.template = template; self.spacing = spacing; self.background = background; self.cells = cells
        self.place = place; self.enter = enter; self.exit = exit
    }

    /// The collage as the document holds it: nulls for no entrance and no exit.
    public var json: JSONValue {
        .object([
            "template": .string(template), "spacing": spacing.json, "background": .string(background),
            "cells": .array(cells.map(\.json)), "place": place.json,
            "enter": enter?.json ?? .null, "exit": exit?.json ?? .null,
        ])
    }
}

/// The suite's frame black — what a stage shows behind a picture that does not cover it.
public let defaultCollageBackground = "#100f0d"

public func defaultCollageEnter() -> CollageEnter {
    CollageEnter(
        step: AnimStep(preset: .slide, duration: 0.5, easing: .outCubic, direction: .up, distanceFrac: 0.06, inside: true),
        stagger: Stagger(each: 0.1, order: .centerOut)
    )
}

public func defaultCollageExit() -> CollageExit {
    CollageExit(step: AnimStep(preset: .fade, duration: 0.4, easing: .in), reverse: true)
}

public func createCollageCell(_ media: SavedMediaRef? = nil) -> CollageCell {
    CollageCell(media: media, framing: normaliseFraming(nil), develop: nil, motion: nil, place: defaultCellPlace)
}

/// A new collage on `template`, its cells 2…n empty. Nil for an unknown id.
public func createCollage(_ template: String) -> SlideCollage? {
    guard let entry = layoutTemplate(template) else { return nil }
    let count = cellCount(entry.template)
    return SlideCollage(
        template: template,
        spacing: normaliseSpacing(nil),
        background: defaultCollageBackground,
        cells: (0..<max(0, count - 1)).map { _ in createCollageCell() },
        place: defaultCellPlace,
        enter: nil,
        exit: nil
    )
}

/// A ref read the collage's way: a name is required; a size or a date that is
/// not a finite number is 0; an empty id or hash is left out.
private func collageMediaRef(_ raw: JSONValue?) -> SavedMediaRef? {
    guard let r = raw?.objectValue, let name = r["name"]?.stringValue, !name.isEmpty else { return nil }
    let size = r["size"]?.finiteNumber ?? 0
    var ref = SavedMediaRef(name: name, size: abs(size) < 9e15 ? Int(size) : 0,
                            lastModified: r["lastModified"]?.finiteNumber ?? 0)
    if let assetId = r["assetId"]?.stringValue, !assetId.isEmpty { ref.assetId = assetId }
    if let hash = r["hash"]?.stringValue, !hash.isEmpty { ref.hash = hash }
    return ref
}

/// `/^#[0-9a-f]{6}$/i` after a trim, kept lower-cased; anything else is the frame black.
private func collageColour(_ raw: JSONValue?) -> String {
    guard let s = raw?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines) else { return defaultCollageBackground }
    let bytes = Array(s.utf8)
    guard bytes.count == 7, bytes[0] == UInt8(ascii: "#") else { return defaultCollageBackground }
    for b in bytes[1...] {
        let digit = (b >= 48 && b <= 57) || (b >= 65 && b <= 70) || (b >= 97 && b <= 102)
        if !digit { return defaultCollageBackground }
    }
    return s.lowercased()
}

/// A step and what rides with it: the badge's reader, plus `inside` when it is exactly true.
private func collageStep(_ raw: JSONValue) -> AnimStep {
    var step = readAnimStep(raw)
    if raw.objectValue?["inside"] == .bool(true) { step.inside = true }
    return step
}

/// A record holding a step (a record — or a list, which the web's `typeof`
/// takes for one), or nil.
private func stepOf(_ raw: JSONValue?) -> (record: [String: JSONValue], step: JSONValue)? {
    guard let e = raw?.objectValue, let step = e["step"], step.objectValue != nil || step.arrayValue != nil else { return nil }
    return (e, step)
}

private func readEnter(_ raw: JSONValue?) -> CollageEnter? {
    guard let found = stepOf(raw) else { return nil }
    return CollageEnter(step: collageStep(found.step), stagger: normaliseStagger(found.record["stagger"]))
}

private func readExit(_ raw: JSONValue?) -> CollageExit? {
    guard let found = stepOf(raw) else { return nil }
    return CollageExit(step: collageStep(found.step), reverse: found.record["reverse"] != .bool(false))
}

/// Read a collage out of anything — a stored document, an imported file, a
/// hand edit. A template the registry does not know is NO collage.
public func readCollage(_ v: JSONValue?) -> SlideCollage? {
    guard let c = v?.objectValue, let template = c["template"]?.stringValue, layoutTemplate(template) != nil else { return nil }
    let cells = (c["cells"]?.arrayValue ?? []).map { cell -> CollageCell in
        let raw = cell.objectValue ?? [:]
        return CollageCell(
            media: collageMediaRef(raw["media"]),
            framing: normaliseFraming(raw["framing"]),
            develop: developOrNull(raw["develop"]),
            motion: readMotion(raw["motion"]),
            place: normaliseCellPlace(raw["place"])
        )
    }
    return SlideCollage(
        template: template,
        spacing: normaliseSpacing(c["spacing"]),
        background: collageColour(c["background"]),
        cells: cells,
        place: normaliseCellPlace(c["place"]),
        enter: readEnter(c["enter"]),
        exit: readExit(c["exit"])
    )
}

// MARK: - behaviour

/// Mirror an entrance into an exit: the same step, travelling back the way it came.
public func mirroredExit(_ enter: CollageEnter) -> CollageExit {
    var step = enter.step
    step.delay = nil
    if let direction = step.direction {
        switch direction {
        case .up: step.direction = .down
        case .down: step.direction = .up
        case .left: step.direction = .right
        case .right: step.direction = .left
        }
    }
    return CollageExit(step: step, reverse: true)
}

/// True when the cells move at all — what makes a collage slide a video.
public func collageAnimates(_ collage: SlideCollage?) -> Bool {
    guard let collage else { return false }
    if let enter = collage.enter, enter.step.preset != .none || enter.stagger.each > 0 { return true }
    return collage.exit != nil
}

/// True when a DRAWN cell's picture moves inside its mask — the lead's motion
/// lives on the slide and is asked about there. A kept cell past the template
/// draws nothing, so its motion makes nothing move.
public func collageCellsMove(_ collage: SlideCollage?) -> Bool {
    guard let collage else { return false }
    let drawn = max(0, collageCellCount(collage) - 1)
    return collage.cells.prefix(drawn).contains { hasMotion($0.motion) }
}

/// One cell's motion at a moment — the web's `CellMotion` (`cell-paint.ts`).
public struct CellMotion: Equatable, Sendable {
    public var transform: OverlayTransform
    /// The edge a reveal grows from; `right` when unsaid.
    public var direction: AnimDirection?
    /// Move the picture inside the mask rather than the cell.
    public var inside: Bool?

    public init(transform: OverlayTransform, direction: AnimDirection? = nil, inside: Bool? = nil) {
        self.transform = transform; self.direction = direction; self.inside = inside
    }
}

/// Every drawn cell's motion at `t` seconds into the slide, or nil for a
/// collage that does not move. `seconds` is the slide's screen time — what an
/// exit is laid against; without one, cells that entered stay.
public func collageCellMotions(_ collage: SlideCollage, _ cells: [CellRect], _ frame: Size, _ t: Double,
                               _ seconds: Double?) -> [CellMotion?]? {
    let enter = collage.enter
    let exit = collage.exit
    if enter == nil && exit == nil { return nil }
    let boxes = cells.map(\.rect)
    let delays = enter.map { staggerDelays(boxes, frame, $0.stagger) } ?? cells.map { _ in 0 }
    var ends: [Double?] = cells.map { _ in nil }
    if let exit, let seconds {
        let stagger = enter?.stagger ?? Stagger(each: 0, order: .sequence)
        let ranks = staggerRanks(boxes, frame, stagger.order, seed: stagger.seed ?? 0)
        let top = max(0, ranks.max() ?? 0)
        let each = max(0, stagger.each)
        // Reverse: last in, first out — the highest rank's window ends first.
        ends = ranks.map { r in seconds - Double(exit.reverse ? r : top - r) * each }
    }
    return cells.indices.map { i -> CellMotion? in
        var inStep: AnimStep? = nil
        if let enter {
            var step = enter.step
            step.delay = delays[i]
            inStep = step
        }
        let outStep: AnimStep? = ends[i] != nil ? exit?.step : nil
        let anim = ElementAnimation(in: .some(inStep), out: .some(outStep))
        let transform = transformAt(anim, TimeWindow(start: 0, end: ends[i]), t)
        let entering = t < delays[i] + (enter?.step.duration ?? 0)
        let step = entering ? enter?.step : exit?.step
        return CellMotion(transform: transform, direction: step?.direction, inside: step?.inside)
    }
}

/// When a collage slide is at rest — the last cell's entrance done. What a
/// still of it is taken at; 0 with no entrance. Resolved on a frame of the
/// slide's shape, since the ranks depend on where the cells are.
public func collageSettleSeconds(_ collage: SlideCollage?, _ aspect: Double) -> Double {
    guard let collage, let enter = collage.enter else { return 0 }
    let cells = resolveCollage(collage, aspect, 1)
    return staggerSettle(staggerDelays(cells.map(\.rect), Size(aspect, 1), enter.stagger), enter.step)
}

/// The registry entry a collage draws with. Nil only for an id `readCollage` would already have refused.
public func collageEntry(_ collage: SlideCollage) -> LayoutTemplateEntry? {
    layoutTemplate(collage.template)
}

/// How many cells the collage's template DRAWS (its `cells` may hold more).
public func collageCellCount(_ collage: SlideCollage) -> Int {
    collageEntry(collage).map { cellCount($0.template) } ?? 0
}

/// The lead picture as the collage's first cell — what lets every consumer
/// treat "cell i" uniformly. Cell 0 is the slide; the rest are `cells[i − 1]`.
public struct CollageLead: Equatable, Sendable {
    public var media: SavedMediaRef?
    public var framing: Framing
    public var develop: DevelopSettings?
    public var motion: FramingMotion?

    public init(media: SavedMediaRef?, framing: Framing, develop: DevelopSettings?, motion: FramingMotion?) {
        self.media = media; self.framing = framing; self.develop = develop; self.motion = motion
    }
}

public func collageCellAt(_ lead: CollageLead, _ collage: SlideCollage, _ i: Int) -> CollageCell {
    if i == 0 {
        return CollageCell(media: lead.media, framing: lead.framing, develop: lead.develop, motion: lead.motion,
                           place: collage.place)
    }
    let k = i - 1
    return k >= 0 && k < collage.cells.count ? collage.cells[k] : createCollageCell()
}

/// The places of every drawn cell, in cell order, for `resolveLayout`.
public func collagePlaces(_ collage: SlideCollage) -> [CellPlace] {
    (0..<collageCellCount(collage)).map { i in
        if i == 0 { return collage.place }
        return i - 1 < collage.cells.count ? collage.cells[i - 1].place : defaultCellPlace
    }
}

/// The collage's cells in a `w`×`h` frame. Empty for an unknown template.
public func resolveCollage(_ collage: SlideCollage, _ w: Double, _ h: Double) -> [CellRect] {
    guard let entry = collageEntry(collage) else { return [] }
    return resolveLayout(entry.template, w, h, collage.spacing, collagePlaces(collage))
}

/// The refs every DRAWN cell names, lead first — what a surface needs to find
/// or fetch before it can paint the slide. A cell without a picture is skipped.
public func collageMediaRefs(_ lead: CollageLead, _ collage: SlideCollage) -> [SavedMediaRef] {
    (0..<collageCellCount(collage)).compactMap { collageCellAt(lead, collage, $0).media }
}

/// A picture a smaller template no longer draws, by its 1-based cell number.
public struct KeptCollagePicture: Equatable, Sendable {
    public var cell: Int
    public var media: SavedMediaRef

    public init(cell: Int, media: SavedMediaRef) { self.cell = cell; self.media = media }
}

/// The pictures a smaller template no longer draws — kept, and listed so the
/// author knows they are there.
public func collageKept(_ collage: SlideCollage) -> [KeptCollagePicture] {
    let n = collageCellCount(collage)
    var kept: [KeptCollagePicture] = []
    for (k, cell) in collage.cells.enumerated() {
        let number = k + 2
        if number > n, let media = cell.media { kept.append(KeptCollagePicture(cell: number, media: media)) }
    }
    return kept
}

/// Change the template and keep every picture: the list is padded with empty
/// cells up to the new count, never truncated.
public func retemplateCollage(_ collage: SlideCollage, _ template: String) -> SlideCollage? {
    guard let entry = layoutTemplate(template) else { return nil }
    let need = max(0, cellCount(entry.template) - 1)
    var out = collage
    while out.cells.count < need { out.cells.append(createCollageCell()) }
    out.template = template
    return out
}

/// A lead and its collage, as a write hands them back.
public struct CollageWrite: Equatable, Sendable {
    public var lead: CollageLead
    public var collage: SlideCollage

    public init(lead: CollageLead, collage: SlideCollage) { self.lead = lead; self.collage = collage }
}

/// Swap two cells' pictures with everything that is about the picture — its
/// framing, its develop, its motion — never their places, which belong to the slot.
public func swapCollageCells(_ lead: CollageLead, _ collage: SlideCollage, _ a: Int, _ b: Int) -> CollageWrite {
    if a == b || a < 0 || b < 0 { return CollageWrite(lead: lead, collage: collage) }
    let n = max(collage.cells.count + 1, a + 1, b + 1)
    var all = (0..<n).map { collageCellAt(lead, collage, $0) }
    let cellA = all[a]
    let cellB = all[b]
    func swapped(_ from: CollageCell, into to: CollageCell) -> CollageCell {
        var out = to
        out.media = from.media
        out.framing = from.framing
        out.develop = from.develop
        out.motion = from.motion
        return out
    }
    all[a] = swapped(cellB, into: cellA)
    all[b] = swapped(cellA, into: cellB)
    var next = collage
    next.cells = Array(all.dropFirst())
    let first = all[0]
    return CollageWrite(
        lead: CollageLead(media: first.media, framing: first.framing, develop: first.develop, motion: first.motion),
        collage: next
    )
}

/// What a write changes on one cell — the web's `Partial<CollageCell>`. The
/// fields that may be written NULL are double optionals: `.none` leaves the
/// cell's own, `.some(nil)` clears it.
public struct CollageCellPatch: Equatable, Sendable {
    public var media: SavedMediaRef??
    public var framing: Framing?
    public var develop: DevelopSettings??
    public var motion: FramingMotion??
    public var place: CellPlace?

    public init(media: SavedMediaRef?? = .none, framing: Framing? = nil, develop: DevelopSettings?? = .none,
                motion: FramingMotion?? = .none, place: CellPlace? = nil) {
        self.media = media; self.framing = framing; self.develop = develop; self.motion = motion; self.place = place
    }
}

/// Write cell `i` (0 = the lead), returning the new lead and collage.
public func withCollageCell(_ lead: CollageLead, _ collage: SlideCollage, _ i: Int,
                            _ patch: CollageCellPatch) -> CollageWrite {
    if i == 0 {
        var nextLead = lead
        if let media = patch.media { nextLead.media = media }
        if let framing = patch.framing { nextLead.framing = framing }
        if let develop = patch.develop { nextLead.develop = develop }
        if let motion = patch.motion { nextLead.motion = motion }
        var next = collage
        if let place = patch.place { next.place = place }
        return CollageWrite(lead: nextLead, collage: next)
    }
    var next = collage
    while next.cells.count < i { next.cells.append(createCollageCell()) }
    var cell = next.cells[i - 1]
    if let media = patch.media { cell.media = media }
    if let framing = patch.framing { cell.framing = framing }
    if let develop = patch.develop { cell.develop = develop }
    if let motion = patch.motion { cell.motion = motion }
    if let place = patch.place { cell.place = place }
    next.cells[i - 1] = cell
    return CollageWrite(lead: lead, collage: next)
}
