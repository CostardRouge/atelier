// The geometry of the trip's contribution grid — one column per week, one cell
// per day, and how both follow the grid's zoom. Port of
// `src/shared/roadtrip/day-grid.ts`.
//
// Pure, so the zoom can ask "how wide would you be at this scale?" without a
// layout: that answer is what tells it how far out it may go (below the box's
// own width there is nothing left to reveal) and how much the content really
// grew between two scales — which is NOT the ratio of the scales, because a
// cell is rounded to whole pixels and floors at 4.

import Foundation

/// The cell and its gutter at 100%. The web's `CELL` / `GAP`.
public let heatmapCell = 14.0
public let heatmapGap = 3.0
/// The weekday rail and the gap after it: the width the zoom never touches, so
/// the scroll correction must not count it as content that grew. The web's
/// `RAIL_WIDTH` / `RAIL_GAP` / `HEATMAP_FIXED.x`.
public let heatmapRailWidth = 26.0
public let heatmapRailGap = 8.0
public let heatmapFixedX = heatmapRailWidth + heatmapRailGap

public struct HeatmapColumn: Equatable, Sendable {
    public var cellPx: Double
    public var gapPx: Double
    public init(cellPx: Double, gapPx: Double) { self.cellPx = cellPx; self.gapPx = gapPx }
}

/// A cell and its gutter at a scale, in whole pixels — the lattice the grid is
/// drawn on. Both floor: a cell under 4px and a gutter under 1px stop being a
/// calendar and start being noise.
public func heatmapColumn(_ scale: Double) -> HeatmapColumn {
    HeatmapColumn(cellPx: max(4, TripJS.round(heatmapCell * scale)),
                  gapPx: max(1, TripJS.round(heatmapGap * scale)))
}

/// The grid's own width at a scale, rail excluded. Measured on the column
/// lattice, so it runs one gutter past the last column — the lattice is what
/// places a cell, which makes its ratio the exact multiplier for the scroll
/// correction, and the extra gutter only makes the zoom-out floor a hair
/// conservative.
public func heatmapWidth(_ weeks: Int, _ scale: Double) -> Double {
    let c = heatmapColumn(scale)
    return Double(weeks) * (c.cellPx + c.gapPx)
}

/// Widest a cell is drawn when the box has room to spare: past this a grid
/// stops being a calendar and becomes tiles. The web's `MAX_FIT_CELL`.
public let maxFitCell = 28.0
/// Narrowest a fitted cell may be before the grid scrolls instead of shrinking
/// further. The web's `MIN_FIT_CELL`.
public let minFitCell = 6.0

/// A cell and its gutter FITTED to a box: the whole trip across the width it is
/// given, no zoom. A year is 53 columns, which a 1000px box gives ~18px each —
/// enough to aim at; up to about fourteen months stays readable, and past that
/// the cell floors at 6px and the grid scrolls inside its box. A short trip
/// (a few weeks) would get cells the size of tiles, so it caps at 28px.
public func fittedColumn(_ viewportWidth: Double, _ weeks: Int) -> HeatmapColumn {
    if viewportWidth <= 0 || weeks <= 0 { return HeatmapColumn(cellPx: heatmapCell, gapPx: heatmapGap) }
    let column = ((viewportWidth - heatmapRailWidth - heatmapRailGap) / Double(weeks)).rounded(.down)
    let gapPx = column >= 12 ? heatmapGap : column >= 8 ? 2 : 1
    let cellPx = max(minFitCell, min(maxFitCell, column - gapPx))
    return HeatmapColumn(cellPx: cellPx, gapPx: gapPx)
}
