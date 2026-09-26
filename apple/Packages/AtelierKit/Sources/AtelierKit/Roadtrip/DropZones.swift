// What the stage shows while a picture is dragged onto it — the port of
// `src/tools/roadtrip/drop-zones.ts`, pure and tested.
//
// The zones are the collage's cells in the stage's POINTS (the web's CSS
// pixels), or the whole frame when the slide holds one picture, each knowing
// what it holds, so a target can say "Replace pic-D" rather than a bare "Drop
// here". The copy is here too, one function per question, so the words a
// person reads — or hears, through VoiceOver — while dragging are the same
// wherever a drop is offered.

import Foundation

/// One place a picture can land, in the stage's points.
public struct DropZone: Equatable, Sendable {
    /// The cell index — 0 is the slide's own picture.
    public var index: Int
    public var x: Double
    public var y: Double
    public var w: Double
    public var h: Double
    /// Degrees clockwise about the zone's centre — only a print turns.
    public var rotation: Double
    /// The name of what the cell holds now, or nil for an empty one.
    public var holding: String?

    public init(index: Int, x: Double, y: Double, w: Double, h: Double, rotation: Double, holding: String?) {
        self.index = index; self.x = x; self.y = y; self.w = w; self.h = h
        self.rotation = rotation; self.holding = holding
    }
}

/// The zones for a stage `cssW` × `cssH` whose canvas is `canvasW` wide.
/// Without cells (no collage) the whole frame is zone 0.
public func dropZones(_ cells: [CellRect], canvasW: Double, cssW: Double, cssH: Double,
                      holding: [String?]) -> [DropZone] {
    if cells.isEmpty {
        let first = holding.first ?? nil
        return [DropZone(index: 0, x: 0, y: 0, w: cssW, h: cssH, rotation: 0, holding: first)]
    }
    let k = canvasW > 0 ? cssW / canvasW : 1
    return cells.enumerated().map { i, c in
        let held: String? = i < holding.count ? holding[i] : nil
        return DropZone(index: i, x: c.x * k, y: c.y * k, w: c.width * k, h: c.height * k,
                        rotation: c.rotation, holding: held)
    }
}

/// Where a drop is in its life, as the stage draws it.
public enum DropPhase: String, Sendable {
    case over, fetching, placed, failed
}

public enum ChipTone: String, Sendable {
    case accent, ok, danger, muted
}

/// Which glyph leads a drop chip.
public enum DropChipIcon: String, Sendable {
    case plus, swap, check, warning, wait
}

public struct DropChip: Equatable, Sendable {
    /// The verb, large.
    public var title: String
    /// What it applies to, small — a cell, a picture, a reason.
    public var detail: String?
    public var tone: ChipTone
    public var icon: DropChipIcon

    public init(title: String, detail: String?, tone: ChipTone, icon: DropChipIcon) {
        self.title = title; self.detail = detail; self.tone = tone; self.icon = icon
    }
}

public struct DropChipInput: Equatable, Sendable {
    public var phase: DropPhase
    /// The zone the chip sits in: its index and what it holds.
    public var zoneIndex: Int
    public var zoneHolding: String?
    /// Whether the slide is a collage — a single picture has no cells to name.
    public var collage: Bool
    /// The picture being dropped.
    public var label: String
    /// Where it is being fetched from, while it is.
    public var source: String?
    /// Why it failed, when it did.
    public var reason: String?

    public init(phase: DropPhase, zoneIndex: Int, zoneHolding: String?, collage: Bool, label: String,
                source: String? = nil, reason: String? = nil) {
        self.phase = phase; self.zoneIndex = zoneIndex; self.zoneHolding = zoneHolding
        self.collage = collage; self.label = label; self.source = source; self.reason = reason
    }

    public init(phase: DropPhase, zone: DropZone, collage: Bool, label: String,
                source: String? = nil, reason: String? = nil) {
        self.init(phase: phase, zoneIndex: zone.index, zoneHolding: zone.holding, collage: collage,
                  label: label, source: source, reason: reason)
    }
}

/// The chip a zone wears for one phase of a drop.
public func dropChip(_ input: DropChipInput) -> DropChip {
    switch input.phase {
    case .over:
        if let holding = input.zoneHolding, !holding.isEmpty {
            return DropChip(title: input.collage ? "Replace" : "Replace the picture", detail: holding,
                            tone: .accent, icon: .swap)
        }
        return DropChip(title: input.collage ? "Place here" : "Use this picture",
                        detail: input.collage ? "Cell \(input.zoneIndex + 1)" : input.label,
                        tone: .accent, icon: .plus)
    case .fetching:
        let from = input.source.flatMap { $0.isEmpty ? nil : "from \($0)" }
        return DropChip(title: "Fetching…", detail: from ?? input.label, tone: .muted, icon: .wait)
    case .placed:
        return DropChip(title: "Placed", detail: input.label, tone: .ok, icon: .check)
    case .failed:
        let reason = input.reason.flatMap { $0.isEmpty ? nil : $0 }
        return DropChip(title: "Couldn’t place it", detail: reason ?? input.label, tone: .danger, icon: .warning)
    }
}

/// The line a screen reader hears when a drop settles.
public func dropAnnouncement(_ input: DropChipInput) -> String {
    let place = input.collage ? "cell \(input.zoneIndex + 1)" : "the slide"
    switch input.phase {
    case .over:
        if let holding = input.zoneHolding, !holding.isEmpty {
            return "Drop to replace \(holding) in \(place)"
        }
        return "Drop to place \(input.label) in \(place)"
    case .fetching:
        let from = input.source.flatMap { $0.isEmpty ? nil : " from \($0)" } ?? ""
        return "Fetching \(input.label)\(from)…"
    case .placed:
        return "\(input.label) placed in \(place)"
    case .failed:
        let why = input.reason.flatMap { $0.isEmpty ? nil : ": \($0)" } ?? ""
        return "\(input.label) could not be placed\(why)"
    }
}

/// The hint the stage wears while any picture is being dragged, before it
/// reaches a zone.
public func dropHint(collage: Bool, cellCount: Int) -> String {
    collage ? "Drop on one of the \(cellCount) cells" : "Drop on the picture to use it"
}
