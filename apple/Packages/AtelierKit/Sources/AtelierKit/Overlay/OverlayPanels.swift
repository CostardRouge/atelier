// The pure half of the overlay engine's EDITING PANELS — what the web keeps
// inside its components (`src/shared/overlay/ElementPalette.tsx`,
// `ElementList.tsx`, `ElementPanel.tsx`, `StylePanel.tsx`, `TimingPanel.tsx`,
// `ScenePanel.tsx`, `src/tools/studio/OutroPanel.tsx`, `InfoPanel.tsx`) and
// the native app draws in `apple/Atelier/Studio/Panels/`. A view holds only
// what a browser could not do; every word a panel computes, every value it
// clamps and every field it writes is here, spec'd, so the SwiftUI side is
// controls over these functions and nothing else.
//
// The rules the port keeps, each the web's:
// - A palette cell previews the REAL value for the cue in hand, or the
//   field's name — never a fabricated reading (`palettePreviewText`).
// - Under a theme, editing an appearance control PINS that property as an
//   element override (`pinningStyle`); a property already pinned is never
//   re-pinned, and resetting one removes it (`withoutOverride`).
// - A time element's format is a PARTIAL record: only the key the author
//   touched is written (`patchTimeFormat`), so an element reads back as it
//   was stored.
// - A window's two ends never cross (`timingWindow`), a scene never ends
//   before it starts (`scenePatched`): the author is nudged, never shown a
//   setting with no visible effect.
// - Turning an entrance or an exit ON starts from a usable step, never from
//   the zero-length placeholder the "Cut" row stands on (`timingStepChanged`).
//
// Everything is namespaced under `OverlayPanels` so no generic helper name
// reaches module scope.

import Foundation

public enum OverlayPanels {
    // MARK: - numbers as the web prints them

    /// JS `n.toFixed(digits)`.
    public static func fixed(_ x: Double, _ digits: Int) -> String {
        ExifText.toFixed(x, digits)
    }

    /// JS `${n}`: `3`, `0.65`, never `3.0`.
    public static func plain(_ x: Double) -> String {
        ExifText.jsString(x)
    }

    /// `${Math.round(v * 100)}%`.
    public static func percent(_ v: Double) -> String {
        "\(plain(ExifText.jsRound(v * 100)))%"
    }

    /// `Number(v.toFixed(2))` — a playhead dropped into a time field.
    public static func hundredths(_ v: Double) -> Double {
        Double(fixed(v, 2)) ?? v
    }

    // MARK: - fresh elements (defaults read from the creators, never typed twice)

    /// A new element of `kind`, from its creator — what a control's "back to
    /// default" reads its value from. A telemetry field is `rel_alt`'s.
    public static func freshElement(_ kind: OverlayKind) -> OverlayElement {
        switch kind {
        case .telemetryField: return createTelemetryElement(.relAlt, id: "fresh")
        case .text: return createTextElement(id: "fresh")
        case .headingArrow: return createHeadingArrowElement(id: "fresh")
        case .headingTape: return createHeadingTapeElement(id: "fresh")
        case .frameCorners: return createFrameCornersElement(id: "fresh")
        case .battery: return createBatteryElement(id: "fresh")
        case .rotateDevice: return createRotateDeviceElement(id: "fresh")
        }
    }

    // MARK: - the palette (ElementPalette.tsx)

    /// A fresh element for a palette cell — the cell IS its constructor. The
    /// web's `elementFor`.
    public static func paletteElement(_ item: PaletteItem) -> OverlayElement {
        switch item {
        case .telemetryField(let field): return createTelemetryElement(field)
        case .text: return createTextElement()
        case .headingArrow: return createHeadingArrowElement()
        case .headingTape: return createHeadingTapeElement()
        case .frameCorners: return createFrameCornersElement()
        case .battery: return createBatteryElement()
        case .preset(let id): return introPreset(id).create()
        }
    }

    /// A stable identity for a cell (the web's React key).
    public static func paletteItemKey(_ item: PaletteItem) -> String {
        switch item {
        case .telemetryField(let field): return field.rawValue
        case .preset(let id): return id.rawValue
        default: return item.kind
        }
    }

    /// The cell's name. A field's parenthetical ("Clock (HH:MM:SS)") only
    /// truncates here — the cell shows the real value underneath, which says
    /// it better. The web's `nameOf`.
    public static func paletteItemName(_ item: PaletteItem) -> String {
        switch item {
        case .telemetryField(let field):
            return withoutTrailingParenthetical(fieldSpecs[field]?.label ?? field.rawValue)
        case .text: return "Text"
        case .headingArrow: return "Arrow"
        case .headingTape: return "Heading tape"
        case .frameCorners: return "Corners"
        case .battery: return "Battery"
        case .preset(let id): return introPreset(id).label
        }
    }

    /// `label.replace(/\s*\([^)]*\)\s*$/, '')`.
    private static func withoutTrailingParenthetical(_ label: String) -> String {
        let pattern = #"\s*\([^)]*\)\s*$"#
        guard let re = try? NSRegularExpression(pattern: pattern) else { return label }
        let range = NSRange(label.startIndex..<label.endIndex, in: label)
        return re.stringByReplacingMatches(in: label, range: range, withTemplate: "")
    }

    /// How many of this component are already placed. Intro cells count
    /// nothing on purpose: a preset is a starting point, not a component
    /// placed once. The web's `countPlaced`.
    public static func palettePlacedCount(_ elements: [OverlayElement], _ item: PaletteItem) -> Int {
        switch item {
        case .preset: return 0
        case .telemetryField(let field):
            return elements.filter { $0.kind == .telemetryField && $0.field == field }.count
        default:
            return elements.filter { $0.kind.rawValue == item.kind }.count
        }
    }

    /// What an intro cell says instead of a count: where in the intro it
    /// lands (`+0.5s`), or `intro`. Nil outside a scene. The web's `timingHint`.
    public static func paletteTimingHint(_ el: OverlayElement) -> String? {
        guard let scene = el.sceneId, !scene.isEmpty else { return nil }
        let start = el.window?.start ?? 0
        return start > 0 ? "+\(fixed(start, 1))s" : "intro"
    }

    /// What a text cell shows in its little stage: a telemetry field's LIVE
    /// value at the playhead, or — when the clip carries none — its label
    /// alone: a fabricated "87 m" would be a lie about the footage. Text and
    /// intro presets show their words; shapes show nothing (they draw a
    /// glyph). The web's `previewText`.
    public static func palettePreviewText(_ item: PaletteItem, _ el: OverlayElement, _ cue: Cue?,
                                          timeShift: TimeShift? = nil) -> String {
        switch item {
        case .text, .preset: return el.text ?? ""
        case .telemetryField(let field):
            let time = TimeFieldOptions(format: el.timeFormatOptions, shift: timeShift)
            let value = formatField(field, cue, el.speedUnit, time, early: el.earlyValues != false)
            if value == missingField {
                let label = el.label?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                return label.isEmpty ? (fieldSpecs[field]?.label ?? field.rawValue) : label
            }
            return renderElementText(el, cue, shift: timeShift)
        default:
            return ""
        }
    }

    /// The tooltip of a cell.
    public static func paletteCellTitle(_ name: String, placed: Int) -> String {
        placed > 0 ? "Add another \(name) (\(placed) already on the frame)" : "Add \(name)"
    }

    // MARK: - the element list (ElementList.tsx)

    public struct ListRow: Equatable, Sendable {
        /// What the row says: the element's current text, or a shape's name.
        public var preview: String
        /// The mono tag at its right: a glyph, `TXT` or the field key.
        public var tag: String
    }

    private static let shapeRows: [OverlayKind: (name: String, tag: String)] = [
        .headingArrow: ("Heading arrow", "↗"),
        .headingTape: ("Heading tape", "⇥"),
        .frameCorners: ("Frame corners", "⌗"),
        .battery: ("Battery", "▮"),
        .rotateDevice: ("Rotate phone", "⟳"),
    ]

    /// One row of the list: what the stage draws for this cue, `(empty)` for
    /// a text that says nothing. The web's `SHAPE_ROW` and row preview.
    public static func listRow(_ el: OverlayElement, _ cue: Cue?, timeShift: TimeShift? = nil) -> ListRow {
        if let shape = shapeRows[el.kind] { return ListRow(preview: shape.name, tag: shape.tag) }
        let text = renderElementText(el, cue, shift: timeShift)
        let tag = el.kind == .text ? "TXT" : (el.field?.rawValue ?? "")
        return ListRow(preview: text.isEmpty ? "(empty)" : text, tag: tag)
    }

    // MARK: - the element panel (ElementPanel.tsx)

    /// `element` with `touched` pinned as overrides of `theme` — only under a
    /// theme, and only when one of them was not pinned yet (then the list is
    /// the web's `[...new Set(overrides), …added]`). The web's `change`.
    public static func pinningStyle(_ element: OverlayElement, _ touched: [ThemableKey],
                                    theme: StyleTheme?) -> OverlayElement {
        guard theme != nil, !touched.isEmpty else { return element }
        var pinned: [String] = []
        for key in element.styleOverrides ?? [] where !pinned.contains(key) { pinned.append(key) }
        var grew = false
        for key in touched where !pinned.contains(key.rawValue) {
            pinned.append(key.rawValue)
            grew = true
        }
        guard grew else { return element }
        var out = element
        out.styleOverrides = pinned
        return out
    }

    /// `element` following the theme again for `key` (every copy of it
    /// dropped). The web's `resetOverride`.
    public static func withoutOverride(_ element: OverlayElement, _ key: ThemableKey) -> OverlayElement {
        var out = element
        out.styleOverrides = (element.styleOverrides ?? []).filter { $0 != key.rawValue }
        return out
    }

    /// Whether `key` is pinned on `element` under `theme` — when the panel
    /// draws its "back to theme" affordance.
    public static func isOverriding(_ element: OverlayElement, _ key: ThemableKey, theme: StyleTheme?) -> Bool {
        theme != nil && (element.styleOverrides ?? []).contains(key.rawValue)
    }

    /// The line over a themed element's controls.
    public static func overridesSentence(_ count: Int) -> String {
        if count == 0 { return "Following the project style." }
        return "\(count) propert\(count == 1 ? "y" : "ies") overriding the style."
    }

    /// A CSS colour split into the `#rrggbb` a colour well shows and its
    /// alpha — `rgba(0,0,0,0.65)` → (`#000000`, 0.65). A hex passes through
    /// at alpha 1; anything else reads black. The web's `splitColor`, with two
    /// documented departures: a channel that is not a whole number is ROUNDED
    /// (the web writes a fraction into the hex, which its colour input
    /// refuses) and an alpha that is not a number reads 1 (the web's NaN).
    public static func splitColor(_ color: String) -> (hex: String, alpha: Double) {
        let lower = color.lowercased()
        let opener = lower.range(of: "rgba(") ?? lower.range(of: "rgb(")
        if let opener, let close = lower[opener.upperBound...].firstIndex(of: ")") {
            let inner = color[opener.upperBound..<close]
            let parts = inner.split(separator: ",", omittingEmptySubsequences: false)
                .map { $0.trimmingCharacters(in: .whitespaces) }
            let channels = (0..<3).map { i -> String in
                let raw = i < parts.count ? parts[i] : ""
                let n = raw.isEmpty ? 0 : (Double(raw) ?? 0)
                let byte = Int(ExifText.jsRound(max(0, min(255, n))))
                return String(format: "%02x", byte)
            }
            let alpha = parts.count > 3 ? (Double(parts[3]) ?? 1) : 1
            return ("#" + channels.joined(), alpha)
        }
        return (color.hasPrefix("#") ? color : "#000000", 1)
    }

    /// `rgba(r,g,b,alpha)` from a `#rrggbb` and an alpha. The web's `toRgba`.
    public static func rgba(_ hex: String, _ alpha: Double) -> String {
        let digits = Array(hex.hasPrefix("#") ? hex.dropFirst() : Substring(hex))
        func channel(_ i: Int) -> String {
            guard digits.count >= i + 2 else { return "NaN" }
            return Int(String(digits[i..<(i + 2)]), radix: 16).map(String.init) ?? "NaN"
        }
        return "rgba(\(channel(0)),\(channel(2)),\(channel(4)),\(plain(alpha)))"
    }

    /// The colour well's hex for `color`, or `fallback` when it is not a hex —
    /// the web's `color.startsWith('#') ? color : fallback`.
    public static func hexOr(_ color: String?, _ fallback: String) -> String {
        guard let color, color.hasPrefix("#") else { return fallback }
        return color
    }

    /// Where the battery's reading sits — `none` when the number is hidden.
    public static func batteryReading(_ el: OverlayElement) -> LabelPlacement {
        el.batteryShowPercent == false ? .none : (el.batteryLabel ?? .right)
    }

    /// The battery with its reading set: `none` hides the number and leaves
    /// the placement it had; any other shows it there.
    public static func withBatteryReading(_ el: OverlayElement, _ placement: LabelPlacement) -> OverlayElement {
        var out = el
        if placement == .none {
            out.batteryShowPercent = false
        } else {
            out.batteryShowPercent = true
            out.batteryLabel = placement
        }
        return out
    }

    /// The placeholder of a telemetry battery's key: the first three keys it probes.
    public static var batteryKeyPlaceholder: String {
        "(probe \(batteryKeys.prefix(3).joined(separator: ", "))…)"
    }

    /// `element` with only the given keys of its time format written — the
    /// web's `{ ...time, ...patch }` on the stored partial record.
    public static func patchTimeFormat(_ element: OverlayElement, hour12: Bool? = nil, meridiem: Bool? = nil,
                                       seconds: Bool? = nil, milliseconds: Bool? = nil,
                                       dateStyle: DateStyle? = nil) -> OverlayElement {
        var o = element.timeFormat?.objectValue ?? [:]
        if let hour12 { o["hour12"] = .bool(hour12) }
        if let meridiem { o["meridiem"] = .bool(meridiem) }
        if let seconds { o["seconds"] = .bool(seconds) }
        if let milliseconds { o["milliseconds"] = .bool(milliseconds) }
        if let dateStyle { o["dateStyle"] = .string(dateStyle.rawValue) }
        var out = element
        out.timeFormat = .object(o)
        return out
    }

    /// The date picker's words: each style spelled on the same sample day.
    public static let dateStyleOptions: [(style: DateStyle, label: String)] = [
        (.iso, "2026-05-30"),
        (.dmy, "30/05/2026"),
        (.mdy, "05/30/2026"),
        (.longDmy, "30 May 2026"),
        (.longMdy, "May 30, 2026"),
        (.weekday, "Sat 30 May 2026"),
    ]

    /// The four weights and their names.
    public static let weightOptions: [(weight: FontWeight, label: String)] = [
        (400, "Regular"), (500, "Medium"), (600, "Semibold"), (700, "Bold"),
    ]

    /// The speed fields, which take a unit.
    public static let speedFields: Set<TelemetryFieldKey> = [.gndSpeed, .vertSpeed]

    /// The fields rebuilt from motion, and therefore blank on the clip's first frames.
    public static let derivedFields: Set<TelemetryFieldKey> = [.gndSpeed, .vertSpeed, .heading]

    /// The heading smoothing as it reads: `off`, or `0.6 s`.
    public static func smoothingText(_ seconds: Double) -> String {
        seconds == 0 ? "off" : "\(fixed(seconds, 1)) s"
    }

    // MARK: - the title style (StylePanel.tsx)

    /// One of the four glow layers, as the advanced disclosure tunes it. The
    /// web's `ADVANCED_FIELDS`.
    public enum GlowLayer: String, CaseIterable, Sendable {
        case coreBlurFrac, haloRadiusFrac, haloAlpha, bleedRadiusFrac, bleedAlpha, grainAlpha

        public var label: String {
            switch self {
            case .coreBlurFrac: return "Core softness"
            case .haloRadiusFrac: return "Halo radius"
            case .haloAlpha: return "Halo strength"
            case .bleedRadiusFrac: return "Bleed radius"
            case .bleedAlpha: return "Bleed strength"
            case .grainAlpha: return "Grain"
            }
        }

        public var max: Double {
            switch self {
            case .coreBlurFrac: return 0.1
            case .haloRadiusFrac: return 0.4
            case .haloAlpha, .bleedAlpha: return 1
            case .bleedRadiusFrac: return 1.5
            case .grainAlpha: return 0.3
            }
        }

        public var step: Double {
            switch self {
            case .coreBlurFrac: return 0.005
            case .haloRadiusFrac, .grainAlpha: return 0.01
            case .haloAlpha, .bleedRadiusFrac, .bleedAlpha: return 0.05
            }
        }

        private var path: WritableKeyPath<GlowLayerOverrides, Double?> {
            switch self {
            case .coreBlurFrac: return \.coreBlurFrac
            case .haloRadiusFrac: return \.haloRadiusFrac
            case .haloAlpha: return \.haloAlpha
            case .bleedRadiusFrac: return \.bleedRadiusFrac
            case .bleedAlpha: return \.bleedAlpha
            case .grainAlpha: return \.grainAlpha
            }
        }

        /// The layer's value in derived layers.
        public func value(in layers: GlowLayers) -> Double {
            switch self {
            case .coreBlurFrac: return layers.coreBlurFrac
            case .haloRadiusFrac: return layers.haloRadiusFrac
            case .haloAlpha: return layers.haloAlpha
            case .bleedRadiusFrac: return layers.bleedRadiusFrac
            case .bleedAlpha: return layers.bleedAlpha
            case .grainAlpha: return layers.grainAlpha
            }
        }

        /// The hand-set value, when this layer is tuned by hand.
        public func override(in style: TitleStyle) -> Double? {
            style.glowLayers?[keyPath: path]
        }

        /// `style` with this layer set by hand — or, with nil, handed back to
        /// the slider (and no override record left when none remains).
        public func setting(_ value: Double?, in style: TitleStyle) -> TitleStyle {
            var layers = style.glowLayers ?? GlowLayerOverrides()
            layers[keyPath: path] = value
            var out = style
            out.glowLayers = layers == GlowLayerOverrides() ? nil : layers
            return out
        }
    }

    // MARK: - timing (TimingPanel.tsx)

    public enum TimingPhase: Sendable {
        case entrance, exit
    }

    /// The entrance / exit menu's words. The web's `PRESETS`.
    public static let animPresetOptions: [(preset: AnimPreset, label: String)] = [
        (.none, "Cut — no animation"),
        (.fade, "Fade"),
        (.slide, "Slide + fade"),
        (.scale, "Scale + fade"),
        (.typewriter, "Typewriter"),
        (.wipe, "Wipe"),
    ]

    /// The slide directions. The web's `DIRECTIONS`.
    public static let animDirectionOptions: [(direction: AnimDirection, label: String)] = [
        (.up, "Up"), (.down, "Down"), (.left, "Left"), (.right, "Right"),
    ]

    /// Every curve of the shared registry, the overshooting ones said so. The
    /// web's `EASINGS`.
    public static func easingLabel(_ id: EasingId) -> String {
        let curve = curveOf(id)
        if curve.overshoots { return "\(curve.label) — overshoots" }
        if curve.stepped { return "\(curve.label) — in jumps" }
        return curve.label
    }

    /// The step a freshly switched-on animation starts from. The web's `defaultFor`.
    public static func timingDefaultStep(_ phase: TimingPhase) -> AnimStep {
        phase == .entrance
            ? AnimStep(preset: .fade, duration: 0.5, easing: .out)
            : AnimStep(preset: .fade, duration: 0.4, easing: .in)
    }

    /// What the "Cut" row stands on when there is no step.
    public static func timingPlaceholderStep(_ phase: TimingPhase) -> AnimStep {
        AnimStep(preset: .none, duration: 0, easing: phase == .entrance ? .out : .in)
    }

    /// The step to store after the controls produced `next` over `current`:
    /// nil for a cut; the edit itself when there already was a step; else a
    /// usable default wearing the chosen preset.
    public static func timingStepChanged(_ current: AnimStep?, _ next: AnimStep, _ phase: TimingPhase) -> AnimStep? {
        if next.preset == .none { return nil }
        if current != nil { return next }
        var fresh = timingDefaultStep(phase)
        fresh.preset = next.preset
        return fresh
    }

    /// `element` with its entrance or exit set; nil is written `null`, as the web writes it.
    public static func withTimingStep(_ element: OverlayElement, _ phase: TimingPhase, _ step: AnimStep?) -> OverlayElement {
        var anim = element.animation ?? ElementAnimation()
        switch phase {
        case .entrance: anim.in = .some(step)
        case .exit: anim.out = .some(step)
        }
        var out = element
        out.animation = anim
        return out
    }

    /// The window with an end moved or a start moved; the two never cross —
    /// an end at or before the start becomes the start + 0.1 s, since an
    /// unreachable element reads as "my title vanished". `end: .some(nil)`
    /// clears the end.
    public static func timingWindow(_ window: TimeWindow?, start: Double? = nil, end: Double?? = .none) -> TimeWindow {
        var next = window ?? TimeWindow(start: 0, end: nil)
        if let start { next.start = start }
        if case .some(let e) = end { next.end = e }
        if let e = next.end, e <= next.start { next.end = next.start + 0.1 }
        return next
    }

    /// The window switched on (from 0, to 3 s — or to the scene's end
    /// inside one) or off (the whole clip).
    public static func timingWindowToggled(_ on: Bool, inScene: Bool) -> TimeWindow? {
        on ? TimeWindow(start: 0, end: inScene ? nil : 3) : nil
    }

    /// The playhead read the way the element's window counts: from the
    /// scene's start inside one, never before 0.
    public static func timingLocal(_ playhead: Double, scene: OverlayScene?) -> Double {
        max(0, playhead - (scene?.start ?? 0))
    }

    /// True when an exit has nothing to play against: no exit, no end, no scene.
    public static func timingExitNeedsEnd(_ element: OverlayElement, scene: OverlayScene?) -> Bool {
        element.animation?.outStep == nil && element.window?.end == nil && scene == nil
    }

    // MARK: - the intro scene (ScenePanel.tsx)

    /// A scene as the author left it — nudged to end 0.2 s after its start
    /// when it would end before, rather than never drawing.
    public static func scenePatched(_ scene: OverlayScene) -> OverlayScene {
        var out = scene
        if out.end <= out.start { out.end = out.start + 0.2 }
        return out
    }

    /// The cascade switched on (the default) or off (`null`).
    public static func sceneStaggerToggled(_ on: Bool) -> Stagger?? {
        on ? .some(.default) : .some(nil)
    }

    /// The cascade in a new order; a shuffle draws its seed the moment it is
    /// asked for, and keeps it after.
    public static func sceneStaggerOrdered(_ stagger: Stagger, _ order: StaggerOrder,
                                           seed: () -> Double = newStaggerSeed) -> Stagger {
        var out = stagger
        out.order = order
        if order == .random && stagger.seed == nil { out.seed = seed() }
        return out
    }

    /// The order menu's words: `Centre out — From the middle of the frame outwards`.
    public static func staggerOrderLabel(_ option: StaggerOrderOption) -> String {
        "\(option.label) — \(option.hint)"
    }

    /// What the scene holds, said.
    public static func sceneMembersSentence(_ count: Int) -> String {
        count == 0 ? "Nothing in it yet." : "\(count) element\(count > 1 ? "s" : "")"
    }

    /// `3.0–5.5 s`, the badge on the scene's section.
    public static func sceneBadge(_ scene: OverlayScene) -> String {
        "\(fixed(scene.start, 1))–\(fixed(scene.end, 1)) s"
    }

    /// The deck's comeback as it reads: `cut`, or `0.50 s`.
    public static func hudFadeText(_ seconds: Double) -> String {
        seconds == 0 ? "cut" : "\(fixed(seconds, 2)) s"
    }

    // MARK: - the outro (OutroPanel.tsx)

    /// The card's text lines, in order.
    public static func outroLines(_ card: OutroCard) -> [OverlayElement] {
        card.elements.filter { $0.kind == .text }
    }

    public static func outroWithLineText(_ card: OutroCard, _ id: String, _ text: String) -> OutroCard {
        var out = card
        out.elements = card.elements.map { el in
            guard el.id == id else { return el }
            var next = el
            next.text = text
            return next
        }
        return out
    }

    public static func outroWithoutLine(_ card: OutroCard, _ id: String) -> OutroCard {
        var out = card
        out.elements = card.elements.filter { $0.id != id }
        return out
    }

    /// The card holding for `seconds` — never under half a second, and a
    /// field emptied or zeroed reads half a second (`Math.max(0.5, v || 0.5)`).
    public static func outroSeconds(_ card: OutroCard, _ seconds: Double) -> OutroCard {
        var out = card
        let v = (seconds.isNaN || seconds == 0) ? 0.5 : seconds
        out.seconds = max(0.5, v)
        return out
    }

    /// The card with its QR link set: an empty link removes the code; a first
    /// link places a fresh one centred under the middle, at the closing
    /// slide's proportions, light on the card's own ground.
    public static func outroWithQrUrl(_ card: OutroCard, _ url: String, aspect: Double) -> OutroCard {
        var out = card
        if url.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            out.qr = nil
            return out
        }
        if var qr = card.qr {
            qr.url = url
            out.qr = qr
        } else {
            let side = 0.3 * min(1 / aspect, 1)
            out.qr = OutroQr(url: url, x: 0.5 - side / 2, y: 0.55, sizeFrac: 0.3, dark: "#f4f0e7", light: card.background)
        }
        return out
    }

    /// `+ 4.0 s`, the badge on the outro's section.
    public static func outroBadge(_ card: OutroCard) -> String {
        "+ \(fixed(card.seconds, 1)) s"
    }

    // MARK: - the clip's facts (InfoPanel.tsx)

    /// The cadence row: the measured (or overridden) rates and what they make
    /// of the footage, or — when the log cannot answer and the author has not
    /// — which rate it IS quoting. Empty when there is nothing to say.
    public static func infoCadence(_ timing: TimeScaleReading, scale: Double, overridden: Bool) -> String {
        if timing.basis == .none && !overridden {
            guard let fps = timing.mediaFps, fps != 0, !fps.isNaN else { return "" }
            return "plays at \(plain(fps)) fps · shooting cadence not measurable"
        }
        let shown = withScale(timing, scale)
        let parts: [String?] = [formatCadence(shown), describeTimeScale(scale), overridden ? "set by hand" : nil]
        return parts.compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    /// The Flight row: `600 cues · alt 20–60 m · dlog_m`, or nil without a log.
    public static func infoFlight(_ cues: [Cue]) -> String? {
        if cues.isEmpty { return nil }
        let s = summarizeTelemetry(cues)
        var parts = ["\(s.cueCount) cues"]
        if let hi = s.relAltMax { parts.append("alt \(plain(s.relAltMin ?? 0))–\(plain(hi)) m") }
        if let profile = s.colorProfile, !profile.isEmpty { parts.append(profile) }
        return parts.joined(separator: " · ")
    }

    /// The camera of a photograph: `SONY ILCE-7CM2`, or nil.
    public static func infoCamera(_ exif: ExifData) -> String? {
        let words = [exif.make, exif.model].compactMap { $0 }.filter { !$0.isEmpty }
        return words.isEmpty ? nil : words.joined(separator: " ")
    }

    /// Its lens, maker first, or nil when it names none.
    public static func infoLens(_ exif: ExifData) -> String? {
        let hasLens = !(exif.lensModel ?? "").isEmpty || !(exif.lensMake ?? "").isEmpty
        guard hasLens else { return nil }
        return [exif.lensMake, exif.lensModel].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
    }
}
