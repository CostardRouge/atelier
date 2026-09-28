// What the component palette offers, and in what order — port of
// `src/shared/overlay/palette-groups.ts`, pure data.
//
// The palette is a grid of three cells per row inside a narrow inspector, so
// the eighteen telemetry fields plus the shapes only stay readable GROUPED: a
// pilot looks for "speed" under Flight, not in an alphabetical wall. The spec
// beside this file guarantees a field added to the model can never stay
// unreachable from the palette.

import Foundation

/// A cell is usually one element kind. The Intro group is the exception: its
/// cells are PRESETS (`IntroPresets.swift`), told apart by size, placement and
/// entrance, not by kind.
public enum PaletteItem: Equatable, Sendable {
    case telemetryField(TelemetryFieldKey)
    case text
    case headingArrow
    case headingTape
    case frameCorners
    case battery
    case preset(IntroPresetId)

    /// The web's `kind` discriminant: an `OverlayKind`'s string, or `preset`.
    public var kind: String {
        switch self {
        case .telemetryField: return OverlayKind.telemetryField.rawValue
        case .text: return OverlayKind.text.rawValue
        case .headingArrow: return OverlayKind.headingArrow.rawValue
        case .headingTape: return OverlayKind.headingTape.rawValue
        case .frameCorners: return OverlayKind.frameCorners.rawValue
        case .battery: return OverlayKind.battery.rawValue
        case .preset: return "preset"
        }
    }
}

public struct PaletteGroup: Equatable, Sendable {
    /// Section header — short, it sits above a three-column grid.
    public let label: String
    public let items: [PaletteItem]
}

/// The web's `PALETTE_GROUPS`.
public let paletteGroups: [PaletteGroup] = [
    // First, because it is where a social cut starts: the hook decides whether
    // the flight footage underneath is watched at all.
    PaletteGroup(label: "Intro", items: [.preset(.hookTitle), .preset(.subtitle), .preset(.question), .preset(.rotatePhone)]),
    PaletteGroup(label: "Flight", items: [
        .telemetryField(.relAlt), .telemetryField(.absAlt), .telemetryField(.gndSpeed), .telemetryField(.vertSpeed),
        .telemetryField(.heading), .telemetryField(.latitude), .telemetryField(.longitude),
    ]),
    PaletteGroup(label: "Camera", items: [
        .telemetryField(.iso), .telemetryField(.shutter), .telemetryField(.fnum), .telemetryField(.ev),
        .telemetryField(.focalLen), .telemetryField(.colorMd), .telemetryField(.ct),
    ]),
    PaletteGroup(label: "Time", items: [.telemetryField(.clock), .telemetryField(.date), .telemetryField(.timestamp), .telemetryField(.frame)]),
    PaletteGroup(label: "Instruments", items: [.headingTape, .headingArrow, .battery]),
    PaletteGroup(label: "Shapes", items: [.text, .frameCorners]),
]
