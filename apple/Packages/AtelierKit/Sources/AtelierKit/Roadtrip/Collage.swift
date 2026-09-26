// A slide that holds SEVERAL pictures, as the trip document stores it — port
// of the stored half of `src/shared/roadtrip/collage.ts`: the collage record,
// its cells, how they arrive and leave, the factories and the reader.
//
// Types + reader only; the behaviour of `collage.ts` (which cells a template
// draws, the cells' rects, their motion over the slide, the settle time, the
// kept pictures, re-templating, swapping and writing a cell) is ported later
// INTO THIS FILE. The geometry is `Media/MediaLayout.swift`'s.
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
