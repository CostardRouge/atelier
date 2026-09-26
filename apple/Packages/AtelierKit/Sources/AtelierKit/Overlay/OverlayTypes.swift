// The overlay engine's element model — port of
// `src/shared/overlay/overlay-types.ts`: every element kind, `OverlayElement`,
// `LegibilityStyle` (its radius and outline), the anchors, the creators with
// their defaults, and — what the web does by a cast — the READER of a stored
// element and its writer.
//
// An element is one readout placed on the picture (a telemetry field, a free
// text, a shape). Its position is NORMALISED (0..1 of the frame's width and
// height) and its size a fraction of the frame's SHORTER side, so one layout
// serves the scaled preview and the full-size export alike (WYSIWYG).
//
// The rules the port keeps:
// - Every stored string — a kind, an anchor, a field key, a font family, a
//   gap mode, a reticle — is the web's byte for byte: `OverlayKind.headingTape`
//   is written `heading-tape`. Documents carry them.
// - An absent optional stays ABSENT: the reader never fills a default into a
//   field the web left out (the renderer's `el.x ?? default` does that at draw
//   time, here as there), so a stored element reads back and writes back as
//   the same JSON. The web's `T | null` fields that are also optional
//   (`borderColor`, an animation's `in`/`out`, a scene's `stagger`) are double
//   optionals: `.none` absent, `.some(nil)` written `null`.
// - A key this build does not know is CARRIED (`carried`) and written back
//   verbatim — an element edited on the phone must never lose what a newer web
//   build wrote on it. A known key of the wrong type is read as absent.
// - A kind this build does not know makes the element UNREADABLE (nil): the
//   web's renderer draws nothing for it either. A document port that must
//   keep such an element carries its raw JSON itself.
// - `timeFormat` is the web's PARTIAL record (every key optional there), kept
//   as written; `timeFormatOptions` reads it with the web's `??` defaults.
//
// Names differing from the web: the `Anchor` union is `OverlayAnchor` (SwiftUI
// has an `Anchor`), the inline `mode` union `LegibilityMode`, the inline
// compass union `CompassMode`; `FontWeight` is an `Int` (the web's
// `400 | 500 | 600 | 700`, kept lossless).

import Foundation

// MARK: - the unions

/// Telemetry fields exposable as widgets: the raw SRT fields plus the motion
/// values (`gnd_speed`, `vert_speed`, `heading`) reconstructed from GPS.
/// Declared in the web's menu order (`FIELD_KEYS`).
public enum TelemetryFieldKey: String, CaseIterable, Sendable {
    case relAlt = "rel_alt"
    case absAlt = "abs_alt"
    case gndSpeed = "gnd_speed"
    case vertSpeed = "vert_speed"
    case heading
    case latitude
    case longitude
    case iso
    case shutter
    case fnum
    case ev
    case focalLen = "focal_len"
    case colorMd = "color_md"
    case ct
    case frame
    case timestamp
    case clock
    case date
}

public enum OverlayKind: String, CaseIterable, Sendable {
    case telemetryField = "telemetry-field"
    case text
    case headingArrow = "heading-arrow"
    case headingTape = "heading-tape"
    case frameCorners = "frame-corners"
    case battery
    case rotateDevice = "rotate-device"
}

/// Which way the `rotate-device` pictogram tips the phone.
public enum RotateDirection: String, CaseIterable, Sendable {
    case cw, ccw
}

/// Where a shape element's caption sits relative to it.
public enum LabelPlacement: String, CaseIterable, Sendable {
    case none, above, below, left, right
}

/// What the heading tape draws under its sight.
public enum TapeReticle: String, CaseIterable, Sendable {
    case none, line, triangle, both
}

/// What a heading instrument does while the reading is gone (hovering, or a
/// yaw on the spot): `dim` holds the last bearing fading over the hold window
/// (default), `hold` keeps it at full strength then drops, `hide` drops at once.
public enum HeadingGapMode: String, CaseIterable, Sendable {
    case dim, hold, hide
}

/// Where the battery gauge reads its level. See `Battery.swift`.
public enum BatterySource: String, CaseIterable, Sendable {
    case manual, telemetry
}

/// `heading-arrow` + `showCompass`: north-up (`absolute`, the default) or
/// track-up (`relative`).
public enum CompassMode: String, CaseIterable, Sendable {
    case absolute, relative
}

/// Which point of the element box maps to (x, y) — enables clean corner
/// snaps. The web's `Anchor`.
public enum OverlayAnchor: String, CaseIterable, Sendable {
    case topLeft = "top-left"
    case topCenter = "top-center"
    case topRight = "top-right"
    case centerLeft = "center-left"
    case center
    case centerRight = "center-right"
    case bottomLeft = "bottom-left"
    case bottomCenter = "bottom-center"
    case bottomRight = "bottom-right"
}

/// The web's `400 | 500 | 600 | 700`, kept as the number the document holds.
public typealias FontWeight = Int

/// The four weights the style picker offers.
public let fontWeights: [FontWeight] = [400, 500, 600, 700]

/// Curated families. The brand faces are bundled with the app; the rest are
/// system faces.
public enum OverlayFontFamily: String, CaseIterable, Sendable {
    case spaceGrotesk = "Space Grotesk"
    case jetBrainsMono = "JetBrains Mono"
    case instrumentSerif = "Instrument Serif"
    case vt323 = "VT323"
    case arial = "Arial"
    case georgia = "Georgia"
    case courierNew = "Courier New"
}

/// Families the web must load before canvas text is correct (the app bundles
/// them). The web's `BRAND_FONTS`.
public let brandFonts: Set<OverlayFontFamily> = [.spaceGrotesk, .jetBrainsMono, .instrumentSerif, .vt323]

/// The font choices offered in the style picker. The web's `CURATED_FONTS`.
public let curatedFonts: [OverlayFontFamily] = [
    .spaceGrotesk, .jetBrainsMono, .instrumentSerif, .vt323, .arial, .georgia, .courierNew,
]

// MARK: - legibility

/// none → plain text; shadow → drop shadow; box → filled rounded panel.
public enum LegibilityMode: String, CaseIterable, Sendable {
    case none, shadow, box
}

public struct LegibilityStyle: Equatable, Sendable {
    public var mode: LegibilityMode
    /// Box fill / shadow colour (a CSS colour string).
    public var color: String
    /// Padding (box) or blur (shadow) as a fraction of the font size.
    public var padFrac: Double
    /// `box` only. Corner radius as a fraction of the PADDING; absent reads
    /// 0.5, which is what the box drew before the knob existed.
    public var radiusFrac: Double?
    /// `box` only. Outline colour; absent (`.none`) or null (`.some(nil)`)
    /// draws no outline.
    public var borderColor: String??
    /// `box` only. Outline width as a fraction of the font size.
    public var borderWidthFrac: Double?

    public init(mode: LegibilityMode, color: String, padFrac: Double,
                radiusFrac: Double? = nil, borderColor: String?? = .none, borderWidthFrac: Double? = nil) {
        self.mode = mode; self.color = color; self.padFrac = padFrac
        self.radiusFrac = radiusFrac; self.borderColor = borderColor; self.borderWidthFrac = borderWidthFrac
    }

    /// The outline colour when there is one.
    public var outlineColor: String? { borderColor ?? nil }

    /// The web's `DEFAULT_LEGIBILITY`.
    public static let `default` = LegibilityStyle(mode: .shadow, color: "rgba(0,0,0,0.65)", padFrac: 0.3)
}

// MARK: - the element

public struct OverlayElement: Equatable, Sendable {
    public var id: String
    public var kind: OverlayKind

    /// For telemetry-field: which field; ignored for text.
    public var field: TelemetryFieldKey?
    /// Optional label prefix shown before the value, e.g. `ALT`.
    public var label: String?
    /// For kind text, the literal string (and rotate-device's caption).
    public var text: String?

    /// Anchor point in normalised [0, 1] frame coordinates.
    public var anchor: OverlayAnchor
    public var x: Double
    public var y: Double

    public var fontFamily: OverlayFontFamily
    /// Size as a fraction of the frame's SHORTER side. For text the font size;
    /// for a heading arrow its radius.
    public var sizeFrac: Double
    public var color: String
    public var weight: FontWeight
    public var italic: Bool

    public var legibility: LegibilityStyle
    public var visible: Bool

    /// `heading-arrow` only: draw a compass ring with N/E/S/W around the arrow.
    public var showCompass: Bool?

    // heading instruments (arrow + tape)
    /// Easing time constant in seconds for the reconstructed heading; 0 = raw.
    public var headingSmoothing: Double?
    /// What to do while the heading is missing. Default `dim`.
    public var headingGap: HeadingGapMode?
    /// How long a stale bearing keeps being shown, in seconds. Default 2.
    public var headingHoldSeconds: Double?
    /// `heading-arrow` + `showCompass` only. Default `absolute`.
    public var compassMode: CompassMode?

    /// Motion readouts: show the value measured FORWARD over the clip's opening
    /// window instead of `—`. Absent reads ON.
    public var earlyValues: Bool?

    /// `telemetry-field`, `gnd_speed` / `vert_speed`: the unit. Absent = m/s.
    public var speedUnit: SpeedUnit?

    /// `telemetry-field`, `clock` / `date` / `timestamp`: how this badge reads.
    /// The web's PARTIAL record, as written; read it with `timeFormatOptions`.
    /// The shift is the footage's, never here.
    public var timeFormat: JSONValue?

    /// `frame-corners` only: bracket inset as a fraction of the shorter side. Default 0.03.
    public var cornerInset: Double?

    // heading tape (the geometry is `HeadingTape.swift`)
    /// Degrees visible across the whole tape. Default 90.
    public var tapeSpanDeg: Double?
    /// Tape width as a fraction of the frame's width. Default 0.5.
    public var tapeWidthFrac: Double?
    /// Degrees between labelled ticks. Default 30.
    public var tapeMajorStep: Double?
    /// Degrees between plain ticks. Default 10.
    public var tapeMinorStep: Double?
    /// Share of each half that dissolves into the image. 0..0.9, default 0.22.
    public var tapeFadeFrac: Double?
    /// Tick height as a multiple of the label font size. Default 1.
    public var tapeTickScale: Double?
    /// What marks the centre. Default `both`.
    public var tapeReticle: TapeReticle?
    /// Sight colour — deliberately its own, so it reads against the ticks.
    public var tapeReticleColor: String?
    /// Draw the horizontal rule the ticks stand on. Default true.
    public var tapeRule: Bool?
    /// Letters (N/E/S/W) rather than degrees on the cardinal ticks. Default true.
    public var tapeCardinals: Bool?
    /// Where the "247° WSW" caption sits, or none. Default `above`.
    public var tapeLabel: LabelPlacement?
    /// Overall opacity of the ribbon, 0..1. Default 1.
    public var tapeOpacity: Double?

    // battery gauge
    /// Where the level comes from. Default `manual` — the sidecar has none.
    public var batterySource: BatterySource?
    /// `telemetry`: the cue key to read; blank probes the known set.
    public var batteryKey: String?
    /// `manual`: the authored percentage, 0..100.
    public var batteryPercent: Double?
    /// Gauge width as a multiple of its height. Default 2.1.
    public var batteryAspect: Double?
    /// Print the number beside the cell. Default true.
    public var batteryShowPercent: Bool?
    /// At or below this percentage the fill turns to `batteryLowColor`. Default 20.
    public var batteryLowPercent: Double?
    /// The alarm colour.
    public var batteryLowColor: String?
    /// Where the caption sits relative to the cell. Default `right`.
    public var batteryLabel: LabelPlacement?

    // rotate-device prompt
    /// Which way the phone tips. Default `cw`.
    public var rotateDirection: RotateDirection?
    /// Seconds for one full tip (and return). Default 1.8.
    public var rotateCycleSeconds: Double?
    /// Tip and come back, rather than tipping and holding. Default true.
    public var rotateReturn: Bool?
    /// Where the caption sits relative to the phone. Default `below`.
    public var rotateLabel: LabelPlacement?
    /// The phone's height as a fraction of `sizeFrac`'s square. Default 0.66.
    public var rotatePhoneScale: Double?
    /// The turn arrow's radius, same fraction. Default 0.44.
    public var rotateArcScale: Double?

    // timing
    /// When the element is on screen, in seconds from the first exported frame
    /// — or from its scene's start. Absent = the whole clip.
    public var window: TimeWindow?
    /// How it arrives and leaves. Absent = a hard cut. See `Animation.swift`.
    public var animation: ElementAnimation?
    /// The scene this element belongs to, if any.
    public var sceneId: String?

    // appearance extensions (title styles)
    /// Render the text uppercase. Absent = false.
    public var uppercase: Bool?
    /// Extra letter spacing in em. Absent = 0.
    public var letterSpacingEm: Double?
    /// Element-level glow (used when `glow` is overridden or there's no theme).
    public var glowAmount: Double?
    public var glowWarmth: Double?
    /// Appearance keys this element pins against the project theme (the
    /// cascade's third level — `TitleStyles.swift`). Kept as the strings the
    /// document holds, so a key a newer build knows survives here.
    public var styleOverrides: [String]?

    /// Keys this build does not interpret, written back verbatim.
    public var carried: [String: JSONValue] = [:]

    public init(id: String, kind: OverlayKind, anchor: OverlayAnchor, x: Double, y: Double,
                fontFamily: OverlayFontFamily = .spaceGrotesk, sizeFrac: Double = 0.045, color: String = "#ffffff",
                weight: FontWeight = 600, italic: Bool = false, legibility: LegibilityStyle = .default,
                visible: Bool = true) {
        self.id = id; self.kind = kind; self.anchor = anchor; self.x = x; self.y = y
        self.fontFamily = fontFamily; self.sizeFrac = sizeFrac; self.color = color
        self.weight = weight; self.italic = italic; self.legibility = legibility; self.visible = visible
    }

    /// `timeFormat` read with the web's defaults (`hour12` false, `meridiem`
    /// true, `seconds` true, `milliseconds` false, `dateStyle` iso), or nil
    /// when the element holds none.
    public var timeFormatOptions: TimeFormatOptions? {
        timeFormat.map { readTimeFormatOptions($0) }
    }
}

// MARK: - creators

/// A fresh element id — a lowercase UUID, what the web's `crypto.randomUUID()` writes.
public func newOverlayElementId() -> String {
    UUID().uuidString.lowercased()
}

/// Short uppercase labels used as the default prefix per field.
private let shortLabels: [TelemetryFieldKey: String] = [
    .relAlt: "ALT", .absAlt: "ABS ALT", .gndSpeed: "SPEED", .vertSpeed: "V.SPEED", .heading: "HDG",
    .latitude: "LAT", .longitude: "LON", .iso: "ISO", .shutter: "SHUTTER", .fnum: "APERTURE", .ev: "EV",
    .focalLen: "FOCAL", .colorMd: "PROFILE", .ct: "WB", .frame: "FRAME", .timestamp: "TIME", .clock: "", .date: "",
]

/// Shared style defaults for a new element (the web's `baseStyle`) are the
/// init's own defaults: Space Grotesk, 0.045, white, 600, upright, the default
/// legibility, visible.
private func base(_ kind: OverlayKind, _ id: String?, _ anchor: OverlayAnchor, _ x: Double, _ y: Double) -> OverlayElement {
    OverlayElement(id: id ?? newOverlayElementId(), kind: kind, anchor: anchor, x: x, y: y)
}

/// A telemetry-field element for `field`, with its default label.
public func createTelemetryElement(_ field: TelemetryFieldKey, id: String? = nil) -> OverlayElement {
    var el = base(.telemetryField, id, .topLeft, 0.05, 0.05)
    el.field = field
    el.label = shortLabels[field] ?? ""
    return el
}

/// A free-text element.
public func createTextElement(_ text: String = "Text", id: String? = nil) -> OverlayElement {
    var el = base(.text, id, .topLeft, 0.05, 0.05)
    el.text = text
    return el
}

/// The frame-corner brackets: four L-shaped marks inset from the frame edges.
/// It spans the whole frame, so it ignores anchor/position — `sizeFrac` is the
/// arm length, `cornerInset` the distance from the edges.
public func createFrameCornersElement(id: String? = nil) -> OverlayElement {
    var el = base(.frameCorners, id, .center, 0.5, 0.5)
    el.sizeFrac = 0.05
    el.cornerInset = 0.03
    el.legibility = LegibilityStyle(mode: .none, color: "rgba(0,0,0,0.65)", padFrac: 0.3)
    return el
}

/// A heading arrow: a chevron that rotates to the course over ground and
/// shrinks to a dot while the drone hovers.
public func createHeadingArrowElement(id: String? = nil) -> OverlayElement {
    var el = base(.headingArrow, id, .center, 0.5, 0.5)
    el.sizeFrac = 0.06
    el.headingSmoothing = 0.6
    el.headingGap = .dim
    el.headingHoldSeconds = 2
    return el
}

/// A heading tape: the sliding compass ribbon across the top, where a cockpit
/// HUD puts it.
public func createHeadingTapeElement(id: String? = nil) -> OverlayElement {
    var el = base(.headingTape, id, .topCenter, 0.5, 0.06)
    el.sizeFrac = 0.028
    el.tapeSpanDeg = 90
    el.tapeWidthFrac = 0.5
    el.tapeMajorStep = 30
    el.tapeMinorStep = 10
    el.tapeFadeFrac = 0.22
    el.tapeTickScale = 1
    el.tapeReticle = .both
    el.tapeReticleColor = "#e2542f"
    el.tapeRule = true
    el.tapeCardinals = true
    el.tapeLabel = .above
    el.tapeOpacity = 1
    el.headingSmoothing = 0.6
    el.headingGap = .dim
    el.headingHoldSeconds = 2
    el.legibility = LegibilityStyle(mode: .shadow, color: "rgba(0,0,0,0.55)", padFrac: 0.3)
    return el
}

/// A battery gauge. Manual by default and on purpose: the DJI video sidecar
/// carries no state of charge (`Battery.swift`).
public func createBatteryElement(id: String? = nil) -> OverlayElement {
    var el = base(.battery, id, .topRight, 0.95, 0.05)
    el.sizeFrac = 0.03
    el.batterySource = .manual
    el.batteryPercent = 100
    el.batteryAspect = 2.1
    el.batteryShowPercent = true
    el.batteryLowPercent = 20
    el.batteryLowColor = "#e2402a"
    el.batteryLabel = .right
    return el
}

/// The "turn your phone" prompt: a phone pictogram that tips a quarter turn,
/// with a caption under it. A drawing, not a control — the export is a flat
/// video, so the gesture is shown.
public func createRotateDeviceElement(id: String? = nil) -> OverlayElement {
    var el = base(.rotateDevice, id, .center, 0.5, 0.5)
    el.text = "Rotate your phone"
    el.sizeFrac = 0.16
    el.rotateDirection = .cw
    el.rotateCycleSeconds = 1.8
    el.rotateReturn = true
    el.rotateLabel = .below
    el.rotatePhoneScale = 0.66
    el.rotateArcScale = 0.44
    el.legibility = LegibilityStyle(mode: .shadow, color: "rgba(0,0,0,0.55)", padFrac: 0.3)
    return el
}

/// A starter deck: altitude headline with speed and heading beneath it, GPS
/// bottom-left and the exposure pair top-right.
public func defaultElementsPreset() -> [OverlayElement] {
    func placed(_ field: TelemetryFieldKey, _ anchor: OverlayAnchor, _ x: Double, _ y: Double, _ size: Double?) -> OverlayElement {
        var el = createTelemetryElement(field)
        el.anchor = anchor
        el.x = x
        el.y = y
        if let size { el.sizeFrac = size }
        return el
    }
    return [
        placed(.relAlt, .topLeft, 0.04, 0.05, nil),
        placed(.gndSpeed, .topLeft, 0.04, 0.12, 0.03),
        placed(.heading, .topLeft, 0.04, 0.16, 0.03),
        placed(.latitude, .bottomLeft, 0.04, 0.95, 0.03),
        placed(.longitude, .bottomLeft, 0.04, 0.99, 0.03),
        placed(.iso, .topRight, 0.96, 0.05, 0.03),
        placed(.shutter, .topRight, 0.96, 0.09, 0.03),
    ]
}

// MARK: - JSON: the overlay files' shared reading

/// The overlay modules' JSON accessors — one namespace so no generic helper
/// name reaches module scope.
enum OverlayJSON {
    static func number(_ o: [String: JSONValue], _ key: String) -> Double? { o[key]?.finiteNumber }
    static func string(_ o: [String: JSONValue], _ key: String) -> String? { o[key]?.stringValue }
    static func bool(_ o: [String: JSONValue], _ key: String) -> Bool? { o[key]?.boolValue }
    static func value<E: RawRepresentable>(_ o: [String: JSONValue], _ key: String, _: E.Type) -> E? where E.RawValue == String {
        o[key]?.stringValue.flatMap { E(rawValue: $0) }
    }

    /// Write `v` under `key` when present.
    /// A font weight as the document holds it — rounded, and only a number an
    /// `Int` can hold (a finite 1e300 would trap the conversion).
    static func weight(_ o: [String: JSONValue], _ key: String) -> FontWeight? {
        guard let n = number(o, key), abs(n) < 1e9 else { return nil }
        return Int(ExifText.jsRound(n))
    }

    static func put(_ o: inout [String: JSONValue], _ key: String, _ v: Double?) {
        if let v { o[key] = .number(v) }
    }
    static func put(_ o: inout [String: JSONValue], _ key: String, _ v: String?) {
        if let v { o[key] = .string(v) }
    }
    static func put(_ o: inout [String: JSONValue], _ key: String, _ v: Bool?) {
        if let v { o[key] = .bool(v) }
    }
    static func put<E: RawRepresentable>(_ o: inout [String: JSONValue], _ key: String, _ v: E?) where E.RawValue == String {
        if let v { o[key] = .string(v.rawValue) }
    }
}

// MARK: - reading and writing TimeFormatOptions

/// The web's partial `TimeFormatOptions` read with its `??` defaults.
public func readTimeFormatOptions(_ v: JSONValue?) -> TimeFormatOptions {
    let o = v?.objectValue ?? [:]
    let d = TimeFormatOptions.default
    return TimeFormatOptions(
        hour12: OverlayJSON.bool(o, "hour12") ?? d.hour12,
        meridiem: OverlayJSON.bool(o, "meridiem") ?? d.meridiem,
        seconds: OverlayJSON.bool(o, "seconds") ?? d.seconds,
        milliseconds: OverlayJSON.bool(o, "milliseconds") ?? d.milliseconds,
        dateStyle: OverlayJSON.value(o, "dateStyle", DateStyle.self) ?? d.dateStyle
    )
}

extension TimeFormatOptions {
    /// Every key written — what the web's style panel stores once touched.
    public var json: JSONValue {
        .object([
            "hour12": .bool(hour12), "meridiem": .bool(meridiem), "seconds": .bool(seconds),
            "milliseconds": .bool(milliseconds), "dateStyle": .string(dateStyle.rawValue),
        ])
    }
}

// MARK: - reading and writing a legibility style

/// A stored legibility read back; nil when it is not a record. A missing mode
/// draws nothing (the web's renderer tests `box` and `shadow` only).
public func readLegibilityStyle(_ v: JSONValue?) -> LegibilityStyle? {
    guard let o = v?.objectValue else { return nil }
    let d = LegibilityStyle.default
    var out = LegibilityStyle(
        mode: OverlayJSON.value(o, "mode", LegibilityMode.self) ?? .none,
        color: OverlayJSON.string(o, "color") ?? d.color,
        padFrac: OverlayJSON.number(o, "padFrac") ?? d.padFrac
    )
    out.radiusFrac = OverlayJSON.number(o, "radiusFrac")
    if let border = o["borderColor"] {
        if border.isNull { out.borderColor = .some(nil) } else if let s = border.stringValue { out.borderColor = .some(s) }
    }
    out.borderWidthFrac = OverlayJSON.number(o, "borderWidthFrac")
    return out
}

extension LegibilityStyle {
    public var json: JSONValue {
        var o: [String: JSONValue] = ["mode": .string(mode.rawValue), "color": .string(color), "padFrac": .number(padFrac)]
        OverlayJSON.put(&o, "radiusFrac", radiusFrac)
        switch borderColor {
        case .none: break
        case .some(.none): o["borderColor"] = .null
        case .some(.some(let s)): o["borderColor"] = .string(s)
        }
        OverlayJSON.put(&o, "borderWidthFrac", borderWidthFrac)
        return .object(o)
    }
}

// MARK: - reading and writing an element

private let elementKeys: Set<String> = [
    "id", "kind", "field", "label", "text", "anchor", "x", "y", "fontFamily", "sizeFrac", "color", "weight", "italic",
    "legibility", "visible", "showCompass", "headingSmoothing", "headingGap", "headingHoldSeconds", "compassMode",
    "earlyValues", "speedUnit", "timeFormat", "cornerInset", "tapeSpanDeg", "tapeWidthFrac", "tapeMajorStep",
    "tapeMinorStep", "tapeFadeFrac", "tapeTickScale", "tapeReticle", "tapeReticleColor", "tapeRule", "tapeCardinals",
    "tapeLabel", "tapeOpacity", "batterySource", "batteryKey", "batteryPercent", "batteryAspect", "batteryShowPercent",
    "batteryLowPercent", "batteryLowColor", "batteryLabel", "rotateDirection", "rotateCycleSeconds", "rotateReturn",
    "rotateLabel", "rotatePhoneScale", "rotateArcScale", "window", "animation", "sceneId", "uppercase",
    "letterSpacingEm", "glowAmount", "glowWarmth", "styleOverrides",
]

/// A stored element read back — nil when it is not a record, carries no id,
/// or is of a kind this build does not know. A required field that is
/// missing takes a new element's own default (the web trusts its documents
/// and would draw `undefined`; the port never invents one it can avoid).
public func readOverlayElement(_ v: JSONValue?) -> OverlayElement? {
    guard let o = v?.objectValue, let id = o["id"]?.stringValue,
          let kind = OverlayJSON.value(o, "kind", OverlayKind.self) else { return nil }
    typealias J = OverlayJSON
    var el = OverlayElement(
        id: id, kind: kind,
        anchor: J.value(o, "anchor", OverlayAnchor.self) ?? .topLeft,
        x: J.number(o, "x") ?? 0.05,
        y: J.number(o, "y") ?? 0.05,
        fontFamily: J.value(o, "fontFamily", OverlayFontFamily.self) ?? .spaceGrotesk,
        sizeFrac: J.number(o, "sizeFrac") ?? 0.045,
        color: J.string(o, "color") ?? "#ffffff",
        weight: J.weight(o, "weight") ?? 600,
        italic: J.bool(o, "italic") ?? false,
        legibility: readLegibilityStyle(o["legibility"]) ?? .default,
        visible: J.bool(o, "visible") ?? true
    )
    el.field = J.value(o, "field", TelemetryFieldKey.self)
    el.label = J.string(o, "label")
    el.text = J.string(o, "text")
    el.showCompass = J.bool(o, "showCompass")
    el.headingSmoothing = J.number(o, "headingSmoothing")
    el.headingGap = J.value(o, "headingGap", HeadingGapMode.self)
    el.headingHoldSeconds = J.number(o, "headingHoldSeconds")
    el.compassMode = J.value(o, "compassMode", CompassMode.self)
    el.earlyValues = J.bool(o, "earlyValues")
    el.speedUnit = J.value(o, "speedUnit", SpeedUnit.self)
    if let tf = o["timeFormat"], tf.objectValue != nil { el.timeFormat = tf }
    el.cornerInset = J.number(o, "cornerInset")
    el.tapeSpanDeg = J.number(o, "tapeSpanDeg")
    el.tapeWidthFrac = J.number(o, "tapeWidthFrac")
    el.tapeMajorStep = J.number(o, "tapeMajorStep")
    el.tapeMinorStep = J.number(o, "tapeMinorStep")
    el.tapeFadeFrac = J.number(o, "tapeFadeFrac")
    el.tapeTickScale = J.number(o, "tapeTickScale")
    el.tapeReticle = J.value(o, "tapeReticle", TapeReticle.self)
    el.tapeReticleColor = J.string(o, "tapeReticleColor")
    el.tapeRule = J.bool(o, "tapeRule")
    el.tapeCardinals = J.bool(o, "tapeCardinals")
    el.tapeLabel = J.value(o, "tapeLabel", LabelPlacement.self)
    el.tapeOpacity = J.number(o, "tapeOpacity")
    el.batterySource = J.value(o, "batterySource", BatterySource.self)
    el.batteryKey = J.string(o, "batteryKey")
    el.batteryPercent = J.number(o, "batteryPercent")
    el.batteryAspect = J.number(o, "batteryAspect")
    el.batteryShowPercent = J.bool(o, "batteryShowPercent")
    el.batteryLowPercent = J.number(o, "batteryLowPercent")
    el.batteryLowColor = J.string(o, "batteryLowColor")
    el.batteryLabel = J.value(o, "batteryLabel", LabelPlacement.self)
    el.rotateDirection = J.value(o, "rotateDirection", RotateDirection.self)
    el.rotateCycleSeconds = J.number(o, "rotateCycleSeconds")
    el.rotateReturn = J.bool(o, "rotateReturn")
    el.rotateLabel = J.value(o, "rotateLabel", LabelPlacement.self)
    el.rotatePhoneScale = J.number(o, "rotatePhoneScale")
    el.rotateArcScale = J.number(o, "rotateArcScale")
    el.window = TimeWindow(json: o["window"])
    el.animation = ElementAnimation(json: o["animation"])
    el.sceneId = J.string(o, "sceneId")
    el.uppercase = J.bool(o, "uppercase")
    el.letterSpacingEm = J.number(o, "letterSpacingEm")
    el.glowAmount = J.number(o, "glowAmount")
    el.glowWarmth = J.number(o, "glowWarmth")
    if let list = o["styleOverrides"]?.arrayValue { el.styleOverrides = list.compactMap { $0.stringValue } }
    el.carried = o.filter { !elementKeys.contains($0.key) }
    return el
}

/// A stored list read back, unreadable entries left out.
public func readOverlayElements(_ v: JSONValue?) -> [OverlayElement] {
    (v?.arrayValue ?? []).compactMap { readOverlayElement($0) }
}

extension OverlayElement {
    /// The element as the web writes it: the required fields, each present
    /// optional, then every carried key.
    public var json: JSONValue {
        typealias J = OverlayJSON
        var o = carried
        o["id"] = .string(id)
        o["kind"] = .string(kind.rawValue)
        J.put(&o, "field", field)
        J.put(&o, "label", label)
        J.put(&o, "text", text)
        o["anchor"] = .string(anchor.rawValue)
        o["x"] = .number(x)
        o["y"] = .number(y)
        o["fontFamily"] = .string(fontFamily.rawValue)
        o["sizeFrac"] = .number(sizeFrac)
        o["color"] = .string(color)
        o["weight"] = .number(Double(weight))
        o["italic"] = .bool(italic)
        o["legibility"] = legibility.json
        o["visible"] = .bool(visible)
        J.put(&o, "showCompass", showCompass)
        J.put(&o, "headingSmoothing", headingSmoothing)
        J.put(&o, "headingGap", headingGap)
        J.put(&o, "headingHoldSeconds", headingHoldSeconds)
        J.put(&o, "compassMode", compassMode)
        J.put(&o, "earlyValues", earlyValues)
        J.put(&o, "speedUnit", speedUnit)
        if let timeFormat { o["timeFormat"] = timeFormat }
        J.put(&o, "cornerInset", cornerInset)
        J.put(&o, "tapeSpanDeg", tapeSpanDeg)
        J.put(&o, "tapeWidthFrac", tapeWidthFrac)
        J.put(&o, "tapeMajorStep", tapeMajorStep)
        J.put(&o, "tapeMinorStep", tapeMinorStep)
        J.put(&o, "tapeFadeFrac", tapeFadeFrac)
        J.put(&o, "tapeTickScale", tapeTickScale)
        J.put(&o, "tapeReticle", tapeReticle)
        J.put(&o, "tapeReticleColor", tapeReticleColor)
        J.put(&o, "tapeRule", tapeRule)
        J.put(&o, "tapeCardinals", tapeCardinals)
        J.put(&o, "tapeLabel", tapeLabel)
        J.put(&o, "tapeOpacity", tapeOpacity)
        J.put(&o, "batterySource", batterySource)
        J.put(&o, "batteryKey", batteryKey)
        J.put(&o, "batteryPercent", batteryPercent)
        J.put(&o, "batteryAspect", batteryAspect)
        J.put(&o, "batteryShowPercent", batteryShowPercent)
        J.put(&o, "batteryLowPercent", batteryLowPercent)
        J.put(&o, "batteryLowColor", batteryLowColor)
        J.put(&o, "batteryLabel", batteryLabel)
        J.put(&o, "rotateDirection", rotateDirection)
        J.put(&o, "rotateCycleSeconds", rotateCycleSeconds)
        J.put(&o, "rotateReturn", rotateReturn)
        J.put(&o, "rotateLabel", rotateLabel)
        J.put(&o, "rotatePhoneScale", rotatePhoneScale)
        J.put(&o, "rotateArcScale", rotateArcScale)
        if let window { o["window"] = window.json }
        if let animation { o["animation"] = animation.json }
        J.put(&o, "sceneId", sceneId)
        J.put(&o, "uppercase", uppercase)
        J.put(&o, "letterSpacingEm", letterSpacingEm)
        J.put(&o, "glowAmount", glowAmount)
        J.put(&o, "glowWarmth", glowWarmth)
        if let styleOverrides { o["styleOverrides"] = .array(styleOverrides.map { .string($0) }) }
        return .object(o)
    }
}
