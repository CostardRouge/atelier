// Editor-only composition guides — port of `src/shared/overlay/guides.ts`:
// social-media safe zones (the areas a platform's chrome covers) and a
// configurable grid for snapping. Pure.
//
// The stage draws these on the preview ONLY — never through the overlay
// renderer — so they help compose and never burn into an export. The drawing
// is the app's; the geometry is here.
//
// A preset is authored for one orientation (portrait for Reels, TikTok and
// Shorts; landscape for YouTube). Over a frame of the other orientation the
// upright template would shrink to a band across the middle, so `auto` turns
// it a quarter-turn CLOCKWISE (the phone tipped onto its right side) to span
// the frame — the maintainer's call, the rejected alternatives recorded in
// `docs/memory/studio.md`. The labels are never rotated: they name what covers
// the area and have to stay readable.

import Foundation

/// A rectangle in normalised [0, 1] coordinates of a reference frame.
public struct GuideRect: Equatable, Sendable {
    public var x: Double
    public var y: Double
    public var w: Double
    public var h: Double
    /// Short label drawn in the zone, e.g. `Caption`.
    public var label: String?

    public init(x: Double, y: Double, w: Double, h: Double, label: String? = nil) {
        self.x = x; self.y = y; self.w = w; self.h = h; self.label = label
    }
}

public struct SafeZonePreset: Equatable, Sendable {
    public var id: String
    public var label: String
    /// Target aspect ratio (width / height). Most social verticals are 9/16.
    public var aspect: Double
    /// Areas the platform chrome covers, normalised to the target frame.
    public var deadzones: [GuideRect]
}

// Approximate, hand-measured from app layouts (2025). Platform UIs shift over
// time and by device; guides, not pixel-exact masks.
public let safeZonePresets: [SafeZonePreset] = [
    SafeZonePreset(id: "tiktok", label: "TikTok", aspect: 9.0 / 16, deadzones: [
        GuideRect(x: 0.0, y: 0.0, w: 1.0, h: 0.07, label: "Top"),
        GuideRect(x: 0.84, y: 0.42, w: 0.16, h: 0.46, label: "Actions"),
        GuideRect(x: 0.0, y: 0.8, w: 0.84, h: 0.2, label: "Caption"),
    ]),
    SafeZonePreset(id: "reels", label: "Instagram Reels", aspect: 9.0 / 16, deadzones: [
        GuideRect(x: 0.0, y: 0.0, w: 1.0, h: 0.08, label: "Top"),
        GuideRect(x: 0.84, y: 0.38, w: 0.16, h: 0.44, label: "Actions"),
        GuideRect(x: 0.0, y: 0.78, w: 0.84, h: 0.22, label: "Caption"),
    ]),
    SafeZonePreset(id: "shorts", label: "YouTube Shorts", aspect: 9.0 / 16, deadzones: [
        GuideRect(x: 0.0, y: 0.0, w: 1.0, h: 0.06, label: "Top"),
        GuideRect(x: 0.84, y: 0.44, w: 0.16, h: 0.42, label: "Actions"),
        GuideRect(x: 0.0, y: 0.82, w: 0.84, h: 0.18, label: "Title"),
    ]),
    SafeZonePreset(id: "youtube", label: "YouTube", aspect: 16.0 / 9, deadzones: [
        GuideRect(x: 0.0, y: 0.88, w: 1.0, h: 0.12, label: "Controls"),
    ]),
]

/// The preset for an id, or nil for `none` / an unknown id.
public func findSafeZone(_ id: String) -> SafeZonePreset? {
    safeZonePresets.first { $0.id == id }
}

/// How the safe-zone template is laid over the frame: `auto` turns it only
/// when the two orientations disagree, `upright` pins it as authored,
/// `rotated` always turns it.
public enum SafeZoneOrientation: String, CaseIterable, Sendable {
    case auto, upright, rotated
}

/// −1 portrait, 1 landscape, 0 square-ish. The dead band around 1:1 keeps
/// near-square frames and templates out of the rotation logic.
public func orientationOf(_ aspect: Double) -> Int {
    guard aspect.isFinite, aspect > 0 else { return 0 }
    if aspect > 1.02 { return 1 }
    if aspect < 0.98 { return -1 }
    return 0
}

/// Whether `mode` calls for a quarter-turn over a frame of `frameAspect`.
public func shouldRotateSafeZone(_ mode: SafeZoneOrientation, _ presetAspect: Double, _ frameAspect: Double) -> Bool {
    switch mode {
    case .rotated: return true
    case .upright: return false
    case .auto:
        let p = orientationOf(presetAspect)
        let f = orientationOf(frameAspect)
        return p != 0 && f != 0 && p != f
    }
}

/// The preset turned a quarter-turn CLOCKWISE: the aspect inverts and every
/// deadzone travels with it — the portrait top bar becomes a strip down the
/// right edge, the right-hand action column a band along the bottom.
public func rotateSafeZone(_ preset: SafeZonePreset) -> SafeZonePreset {
    var out = preset
    out.aspect = 1 / preset.aspect
    out.deadzones = preset.deadzones.map { r in
        GuideRect(x: 1 - r.y - r.h, y: r.x, w: r.h, h: r.w, label: r.label)
    }
    return out
}

/// The template to draw over a `frameAspect` frame, already turned when the
/// state (or the frame) calls for it. Nil when no preset is picked.
public func resolveSafeZone(_ guides: GuidesState, _ frameAspect: Double) -> SafeZonePreset? {
    guard let preset = findSafeZone(guides.safeZone) else { return nil }
    return shouldRotateSafeZone(guides.safeZoneOrientation, preset.aspect, frameAspect) ? rotateSafeZone(preset) : preset
}

public struct GridConfig: Equatable, Sendable {
    /// Draw the grid lines on the preview.
    public var show: Bool
    public var cols: Int
    public var rows: Int
    /// Snap a dragged element's anchor to the grid lines.
    public var snap: Bool

    public init(show: Bool, cols: Int, rows: Int, snap: Bool) {
        self.show = show; self.cols = cols; self.rows = rows; self.snap = snap
    }
}

public struct GuidesState: Equatable, Sendable {
    /// Active safe-zone preset id, or `none`.
    public var safeZone: String
    /// Quarter-turn handling for that preset.
    public var safeZoneOrientation: SafeZoneOrientation
    public var grid: GridConfig

    public init(safeZone: String, safeZoneOrientation: SafeZoneOrientation = .auto, grid: GridConfig) {
        self.safeZone = safeZone; self.safeZoneOrientation = safeZoneOrientation; self.grid = grid
    }

    /// The web's `DEFAULT_GUIDES`.
    public static let `default` = GuidesState(safeZone: "none", safeZoneOrientation: .auto,
                                              grid: GridConfig(show: false, cols: 3, rows: 3, snap: false))
}

/// JS `Math.round`: halves toward +∞.
private func jsRound(_ x: Double) -> Double {
    let floor = x.rounded(.down)
    return x - floor >= 0.5 ? floor + 1 : floor
}

/// Clamp a grid division count to a sane, integer range.
public func clampDivisions(_ n: Double) -> Int {
    guard n.isFinite else { return 1 }
    return Int(max(1, min(12, jsRound(n))))
}

/// Snap a normalised coordinate to 0 / 0.5 / 1 when within `tol` — the light
/// edge-and-centre snap every stage uses while dragging, with Alt to bypass.
public func snap(_ value: Double, _ tol: Double = 0.02) -> Double {
    if abs(value) < tol { return 0 }
    if abs(value - 1) < tol { return 1 }
    if abs(value - 0.5) < tol { return 0.5 }
    return value
}

/// Snap a normalised coordinate to the nearest of `divisions` grid lines (a
/// 3-division axis has lines at 0, 1/3, 2/3, 1) when within `tol`; the input
/// unchanged otherwise, or when `divisions` < 1.
public func snapToGrid(_ value: Double, _ divisions: Int, _ tol: Double = 0.025) -> Double {
    if divisions < 1 { return value }
    let d = Double(divisions)
    let line = jsRound(value * d) / d
    return abs(value - line) <= tol ? line : value
}

/// The largest rectangle of `aspect` (w/h) centred inside a `vw`×`vh` frame —
/// the centred crop the target platform would show, in pixels.
public func targetFrame(_ aspect: Double, _ vw: Double, _ vh: Double) -> Rect {
    let frameAspect = vw / vh
    let w: Double
    let h: Double
    if aspect < frameAspect {
        // Narrower than the frame → full height, pillarboxed.
        h = vh
        w = vh * aspect
    } else {
        // Wider (or equal) → full width, letterboxed.
        w = vw
        h = vw / aspect
    }
    return Rect(x: (vw - w) / 2, y: (vh - h) / 2, width: w, height: h)
}

// MARK: - JSON

/// A stored guides state read back — a project keeps it in its portable half.
/// A state written before the quarter-turn existed reads `auto`; a missing
/// field reads `GuidesState.default`'s; a division count is clamped.
public func readGuidesState(_ v: JSONValue?) -> GuidesState {
    let o = v?.objectValue ?? [:]
    let d = GuidesState.default
    let g = o["grid"]?.objectValue ?? [:]
    let grid = GridConfig(
        show: OverlayJSON.bool(g, "show") ?? d.grid.show,
        cols: OverlayJSON.number(g, "cols").map(clampDivisions) ?? d.grid.cols,
        rows: OverlayJSON.number(g, "rows").map(clampDivisions) ?? d.grid.rows,
        snap: OverlayJSON.bool(g, "snap") ?? d.grid.snap
    )
    return GuidesState(
        safeZone: OverlayJSON.string(o, "safeZone") ?? d.safeZone,
        safeZoneOrientation: OverlayJSON.value(o, "safeZoneOrientation", SafeZoneOrientation.self) ?? .auto,
        grid: grid
    )
}

extension GuidesState {
    public var json: JSONValue {
        .object([
            "safeZone": .string(safeZone),
            "safeZoneOrientation": .string(safeZoneOrientation.rawValue),
            "grid": .object([
                "show": .bool(grid.show), "cols": .number(Double(grid.cols)),
                "rows": .number(Double(grid.rows)), "snap": .bool(grid.snap),
            ]),
        ])
    }
}
