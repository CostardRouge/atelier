// Telemetry field formatting — port of `src/shared/overlay/field-format.ts`,
// pure: the single source of truth for how a field's value reads on the
// overlay, used by the renderer and by the inspector alike.
//
// The rules it keeps:
// - A missing value reads `—` (`missingField`), never a fabricated one.
// - The motion fields (speed, vertical speed, heading) read the clip's
//   opening window measured FORWARD (`motionAt(_, early:)`) unless the
//   element opts out; a real backward measurement always wins.
// - The time fields' FORMAT is the element's, their SHIFT the footage's (one
//   correction for every time element of a project, so a clock and a date
//   can never disagree).
// - A photograph feeds this formatter through the one cue it is worth
//   (`Exif/ExifCue.swift`): what a still cannot answer stays `—`.

import Foundation

/// How a time field reads: the element's format and the project's shift.
public struct TimeFieldOptions: Equatable, Sendable {
    public var format: TimeFormatOptions?
    public var shift: TimeShift?
    public init(format: TimeFormatOptions? = nil, shift: TimeShift? = nil) {
        self.format = format
        self.shift = shift
    }
}

public struct FieldSpec: Equatable, Sendable {
    /// Human label for the inspector / add menu.
    public var label: String
    /// Prepended to the raw value (e.g. `f/`).
    public var prefix: String?
    /// Appended to the raw value (e.g. ` m`).
    public var suffix: String?

    public init(label: String, prefix: String? = nil, suffix: String? = nil) {
        self.label = label; self.prefix = prefix; self.suffix = suffix
    }
}

/// The web's `FIELD_SPECS`. The derived motion fields carry their own units
/// (and sign / compass), formatted by the telemetry module instead.
public let fieldSpecs: [TelemetryFieldKey: FieldSpec] = [
    .relAlt: FieldSpec(label: "Rel. altitude", suffix: " m"),
    .absAlt: FieldSpec(label: "Abs. altitude", suffix: " m"),
    .gndSpeed: FieldSpec(label: "Ground speed"),
    .vertSpeed: FieldSpec(label: "Vertical speed"),
    .heading: FieldSpec(label: "Heading"),
    .latitude: FieldSpec(label: "Latitude"),
    .longitude: FieldSpec(label: "Longitude"),
    .iso: FieldSpec(label: "ISO"),
    .shutter: FieldSpec(label: "Shutter"),
    .fnum: FieldSpec(label: "Aperture", prefix: "f/"),
    .ev: FieldSpec(label: "EV"),
    .focalLen: FieldSpec(label: "Focal length", suffix: " mm"),
    .colorMd: FieldSpec(label: "Color profile"),
    .ct: FieldSpec(label: "Color temp.", suffix: " K"),
    .frame: FieldSpec(label: "Frame"),
    .timestamp: FieldSpec(label: "Timestamp"),
    .clock: FieldSpec(label: "Clock (HH:MM:SS)"),
    .date: FieldSpec(label: "Date"),
]

/// The three fields read out of the capture timestamp. The web's `TIME_FIELDS`.
public let timeFields: Set<TelemetryFieldKey> = [.clock, .date, .timestamp]

/// All field keys in menu order. The web's `FIELD_KEYS`.
public let fieldKeys: [TelemetryFieldKey] = TelemetryFieldKey.allCases

/// Placeholder rendered when a value is missing. The web's `MISSING`.
public let missingField = "—"

/// A field's display string for `cue`, unit prefix/suffix included, or `—`
/// when the cue or the value is absent. `speedUnit` only reaches the two
/// speeds (default m/s); `time` the three time fields; `early` the three
/// derived motion fields (default on).
public func formatField(_ key: TelemetryFieldKey, _ cue: Cue?, _ speedUnit: SpeedUnit? = nil,
                        _ time: TimeFieldOptions? = nil, early: Bool = true) -> String {
    guard let cue else { return missingField }
    if timeFields.contains(key) {
        guard let parsed = parseWallClock(cue.timestamp) else { return missingField }
        let wc = shiftWallClock(parsed, time?.shift)
        let opts = time?.format ?? .default
        switch key {
        case .clock: return formatClock(wc, opts)
        case .date: return formatDate(wc, opts)
        default: return formatTimestamp(wc, opts)
        }
    }
    let unit = speedUnit ?? .metresPerSecond
    switch key {
    case .frame:
        return cue.frame.map { String($0) } ?? missingField
    case .gndSpeed:
        return formatGroundSpeed(motionAt(cue, early: early).groundSpeed, unit: unit) ?? missingField
    case .vertSpeed:
        return formatVerticalSpeed(motionAt(cue, early: early).verticalSpeed, unit: unit) ?? missingField
    case .heading:
        return formatHeading(motionAt(cue, early: early).heading) ?? missingField
    default:
        break
    }

    guard let raw = cue.data[key.rawValue], !raw.isEmpty else { return missingField }
    let spec = fieldSpecs[key]
    return "\(spec?.prefix ?? "")\(raw)\(spec?.suffix ?? "")"
}

/// Kinds that paint a shape and lay out their own captions, not a text run.
private let shapeKinds: Set<OverlayKind> = [.headingArrow, .headingTape, .frameCorners, .battery]

/// The full string an element renders for `cue`: a free-text element its
/// literal; a telemetry element `LABEL value` (or just the value with no
/// label). Shape kinds return `""` — they draw, and any caption they show is
/// laid out by their own renderer.
public func renderElementText(_ el: OverlayElement, _ cue: Cue?, shift: TimeShift? = nil) -> String {
    if el.kind == .text { return el.text ?? "" }
    guard !shapeKinds.contains(el.kind), let field = el.field else { return "" }
    let value = formatField(field, cue, el.speedUnit, TimeFieldOptions(format: el.timeFormatOptions, shift: shift),
                            early: el.earlyValues != false)
    let label = el.label?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return label.isEmpty ? value : "\(label) \(value)"
}
