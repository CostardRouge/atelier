// The selected element's own controls — port of
// `src/shared/overlay/ElementPanel.tsx`: its content (per kind), then its
// appearance (font, size, colour, weight, italic, anchor, legibility).
//
// Every kind's fields, the web's ranges, steps, defaults and words:
// - text: the words;
// - telemetry field: the field, its prefix, a TIME field's presentation (the
//   clock, AM/PM, seconds, milliseconds, the date's style — the format is
//   the element's, the SHIFT the project's: no timezone picker, the log has
//   no zone to convert from), a speed's unit, and a derived readout's "value
//   from the start";
// - heading arrow and heading tape: the compass ring and its orientation,
//   the tape's width, span, labels, ticks, fade, opacity, sight and reading,
//   the heading's smoothing, what it does when the heading is lost, and for
//   how long — the heading being course over ground, gone while hovering;
// - battery: the level from an authored value or a named telemetry key —
//   the DJI `.srt` carries none, and with nothing to read the gauge draws
//   empty rather than inventing a level;
// - frame corners: arm length and inset (it spans the frame: no anchor, no size);
// - rotate phone: caption, turn, sizes, cycle, return, caption placement.
//
// Under a project THEME the appearance controls show the RESOLVED look, and
// editing one PINS that property as an element override (`OverlayPanels.
// pinningStyle`); a pinned property offers "back to theme" beside its label,
// and the head line counts them with a Reset all. Without a theme the panel
// behaves exactly as before themes existed.

import SwiftUI
import AtelierKit

struct ElementPanelView: View {
    @Binding private var element: OverlayElement
    private let theme: StyleTheme?
    @Environment(\.palette) private var palette

    private typealias P = OverlayPanels

    /// - Parameters:
    ///   - element: the selected element, written through on every change.
    ///   - theme: the project's title style, when the host has one (the Studio).
    init(element: Binding<OverlayElement>, theme: StyleTheme? = nil) {
        _element = element
        self.theme = theme
    }

    private var st: ResolvedStyle { resolveElementStyle(element, theme) }
    /// A new element of this kind — where a slider's reset goes.
    private var fresh: OverlayElement { P.freshElement(element.kind) }
    /// Kinds that draw a shape with no text run of their own to dress.
    private var dressesText: Bool { element.kind != .headingArrow && element.kind != .frameCorners }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if theme != nil {
                themeLine
            }
            kindContent
            if dressesText {
                fontRow
            }
            if element.kind != .frameCorners {
                sizeRow
            }
            colourRow
            if dressesText {
                weightRow
                italicRow
            }
            if element.kind != .frameCorners {
                OverlayPanelRow("Anchor", alignTop: true) {
                    OverlayAnchorGrid(selection: element.anchor) { a in change { $0.anchor = a } }
                }
            }
            legibilityRows
        }
    }

    // MARK: - writing

    /// Every edit goes through here: the patch, then — under a theme — the
    /// appearance keys it touched pinned as overrides.
    private func change(_ touched: [ThemableKey] = [], _ edit: (inout OverlayElement) -> Void) {
        var next = element
        edit(&next)
        element = P.pinningStyle(next, touched, theme: theme)
    }

    /// The "back to theme" action of a pinned property, or nil.
    private func backToTheme(_ key: ThemableKey) -> (() -> Void)? {
        guard P.isOverriding(element, key, theme: theme) else { return nil }
        return { element = P.withoutOverride(element, key) }
    }

    // MARK: - the theme line

    private var themeLine: some View {
        let count = element.styleOverrides?.count ?? 0
        return HStack(spacing: 8) {
            Text(verbatim: P.overridesSentence(count))
                .font(Brand.sans(12))
                .foregroundStyle(palette.muted)
                .fixedSize(horizontal: false, vertical: true)
            if count > 0 {
                Button("Reset all") {
                    var next = element
                    next.styleOverrides = []
                    element = next
                }
                .buttonStyle(DevelopLinkButtonStyle())
            }
        }
    }

    // MARK: - content, per kind

    @ViewBuilder
    private var kindContent: some View {
        switch element.kind {
        case .frameCorners: cornersContent
        case .headingArrow: arrowContent
        case .headingTape: tapeContent
        case .battery: batteryContent
        case .rotateDevice: rotateContent
        case .text:
            OverlayPanelTextField("Text", text: element.text ?? "") { v in change { $0.text = v } }
        case .telemetryField: fieldContent
        }
    }

    // frame corners

    @ViewBuilder
    private var cornersContent: some View {
        OverlayPanelNote("Viewfinder brackets in the frame's four corners. It spans the whole frame, so it isn't dragged — tune its geometry here.")
        DevelopRangeSlider("Arm length", value: element.sizeFrac, in: 0.01...0.2, step: 0.005, reset: fresh.sizeFrac,
                           printed: P.percent(element.sizeFrac)) { v in change { $0.sizeFrac = v } }
        let inset = element.cornerInset ?? 0.03
        DevelopRangeSlider("Inset", value: inset, in: 0...0.15, step: 0.005, reset: fresh.cornerInset ?? 0.03,
                           printed: P.percent(inset)) { v in change { $0.cornerInset = v } }
    }

    // heading arrow

    @ViewBuilder
    private var arrowContent: some View {
        OverlayPanelNote("Rotates to the current course-over-ground heading. Shows a dot while hovering (no direction data).")
        OverlayPanelSwitch("Compass ring (N / E / S / W)", isOn: element.showCompass ?? false) { on in
            change { $0.showCompass = on }
        }
        if element.showCompass == true {
            OverlayPanelPicker("Orientation", selection: element.compassMode ?? .absolute,
                               options: ElementPanelView.compassOptions) { m in change { $0.compassMode = m } }
        }
        headingControls
    }

    // heading tape

    @ViewBuilder
    private var tapeContent: some View {
        OverlayPanelNote("A slice of the compass sliding under a fixed sight. Ends fade into the image; the scale disappears when there is no heading (hovering, or a clip without telemetry).")
        tapeGeometry
        tapeSight
        OverlayPanelSwitch("Letters at N / E / S / W", isOn: element.tapeCardinals ?? true) { on in
            change { $0.tapeCardinals = on }
        }
        OverlayPanelSwitch("Baseline rule", isOn: element.tapeRule ?? true) { on in change { $0.tapeRule = on } }
        headingControls
    }

    @ViewBuilder
    private var tapeGeometry: some View {
        let width = element.tapeWidthFrac ?? 0.5
        DevelopRangeSlider("Width", value: width, in: 0.15...0.98, step: 0.01, reset: fresh.tapeWidthFrac ?? 0.5,
                           printed: P.percent(width)) { v in change { $0.tapeWidthFrac = v } }
        let span = element.tapeSpanDeg ?? 90
        DevelopRangeSlider("Span", value: span, in: 20...180, step: 5, reset: fresh.tapeSpanDeg ?? 90,
                           printed: "\(DevelopNumbers.plain(DevelopNumbers.jsRound(span)))°") { v in
            change { $0.tapeSpanDeg = v }
        }
        OverlayPanelPicker("Labels every", selection: element.tapeMajorStep ?? 30,
                           options: ElementPanelView.degrees([10, 15, 20, 30, 45, 90])) { d in
            change { $0.tapeMajorStep = d }
        }
        OverlayPanelPicker("Tick every", selection: element.tapeMinorStep ?? 10,
                           options: ElementPanelView.degrees([1, 2, 5, 10, 15, 30])) { d in
            change { $0.tapeMinorStep = d }
        }
        let tick = element.tapeTickScale ?? 1
        DevelopRangeSlider("Tick height", value: tick, in: 0.4...2.5, step: 0.1, reset: fresh.tapeTickScale ?? 1,
                           printed: P.percent(tick)) { v in change { $0.tapeTickScale = v } }
        let fade = element.tapeFadeFrac ?? 0.22
        DevelopRangeSlider("Edge fade", value: fade, in: 0...0.6, step: 0.02, reset: fresh.tapeFadeFrac ?? 0.22,
                           printed: P.percent(fade)) { v in change { $0.tapeFadeFrac = v } }
        let opacity = element.tapeOpacity ?? 1
        DevelopRangeSlider("Opacity", value: opacity, in: 0.1...1, step: 0.05, reset: fresh.tapeOpacity ?? 1,
                           printed: P.percent(opacity)) { v in change { $0.tapeOpacity = v } }
    }

    @ViewBuilder
    private var tapeSight: some View {
        OverlayPanelColourRow("Sight", css: P.hexOr(element.tapeReticleColor ?? st.color, "#e2542f")) { hex in
            change { $0.tapeReticleColor = hex }
        }
        OverlayPanelPicker("Sight mark", selection: element.tapeReticle ?? .both,
                           options: ElementPanelView.reticleOptions) { r in change { $0.tapeReticle = r } }
        OverlayPanelPicker("Reading", selection: element.tapeLabel ?? .above,
                           options: ElementPanelView.tapeReadingOptions) { l in change { $0.tapeLabel = l } }
    }

    /// The two heading instruments share these: the smoothing, what happens
    /// when the heading is lost, for how long, and the value from the start.
    @ViewBuilder
    private var headingControls: some View {
        let smoothing = element.headingSmoothing ?? 0.6
        VStack(alignment: .leading, spacing: 4) {
            DevelopRangeSlider("Smoothing", value: smoothing, in: 0...3, step: 0.1, reset: fresh.headingSmoothing ?? 0.6,
                               printed: P.smoothingText(smoothing)) { v in change { $0.headingSmoothing = v } }
            OverlayPanelHint("The heading is rebuilt from GPS a few times a second, so it steps. Averaging a window of readings eases it — and bridges the short gaps where there is nothing to read.")
        }
        OverlayPanelPicker("Heading lost", selection: element.headingGap ?? .dim, options: ElementPanelView.gapOptions,
                           hint: "There is no compass in the log: the heading is course over ground, so it disappears while hovering or yawing on the spot.") { g in
            change { $0.headingGap = g }
        }
        if (element.headingGap ?? .dim) != .hide {
            let hold = element.headingHoldSeconds ?? 2
            DevelopRangeSlider("Hold for", value: hold, in: 0.5...10, step: 0.5, reset: fresh.headingHoldSeconds ?? 2,
                               printed: "\(P.fixed(hold, 1)) s") { v in change { $0.headingHoldSeconds = v } }
        }
        earlyValues
    }

    /// Speed and heading are MEASURED between two positions a second apart,
    /// so the clip's opening second has nothing behind it; this offers the
    /// mirror measurement over the second ahead.
    private var earlyValues: some View {
        OverlayPanelSwitch("Value from the start", isOn: element.earlyValues != false,
                           hint: "Measured between two GPS fixes a second apart, the clip's first second has nothing behind it — the instrument would sit blank where a social cut begins. On, it shows the second ahead instead: measured, not invented. A drone that does not move still shows nothing.") { on in
            change { $0.earlyValues = on }
        }
    }

    // battery

    @ViewBuilder
    private var batteryContent: some View {
        OverlayPanelNote(text: Text("A charge gauge. DJI's per-frame ")
            + Text(".srt").font(Brand.mono(11))
            + Text(" carries no battery level — the Mini 4 Pro included — so this is an authored value by default. Point it at a telemetry key if your firmware writes one."))
        let source = element.batterySource ?? .manual
        OverlayPanelPicker("Level from", selection: source, options: ElementPanelView.batterySourceOptions) { s in
            change { $0.batterySource = s }
        }
        if source == .manual {
            let level = element.batteryPercent ?? 100
            DevelopRangeSlider("Level", value: level, in: 0...100, step: 1, reset: fresh.batteryPercent ?? 100,
                               printed: "\(DevelopNumbers.plain(DevelopNumbers.jsRound(level)))%") { v in
                change { $0.batteryPercent = v }
            }
        } else {
            OverlayPanelTextField("Key", text: element.batteryKey ?? "", placeholder: P.batteryKeyPlaceholder,
                                  hint: "Blank probes the keys DJI firmwares are known to use. With nothing to read the gauge draws empty — it never invents a level.") { v in
                change { $0.batteryKey = v }
            }
        }
        let aspect = element.batteryAspect ?? 2.1
        DevelopRangeSlider("Cell width", value: aspect, in: 1.2...4, step: 0.1, reset: fresh.batteryAspect ?? 2.1,
                           printed: "\(P.fixed(aspect, 1))×") { v in change { $0.batteryAspect = v } }
        OverlayPanelColourRow("Low", css: P.hexOr(element.batteryLowColor ?? "#e2402a", "#e2402a")) { hex in
            change { $0.batteryLowColor = hex }
        }
        let low = element.batteryLowPercent ?? 20
        DevelopRangeSlider("Alarm under", value: low, in: 0...60, step: 1, reset: fresh.batteryLowPercent ?? 20,
                           printed: "\(DevelopNumbers.plain(DevelopNumbers.jsRound(low)))%") { v in
            change { $0.batteryLowPercent = v }
        }
        OverlayPanelPicker("Reading", selection: P.batteryReading(element),
                           options: ElementPanelView.batteryReadingOptions) { placement in
            element = P.withBatteryReading(element, placement)
        }
    }

    // rotate phone

    @ViewBuilder
    private var rotateContent: some View {
        OverlayPanelNote("A phone tipping a quarter turn, to invite the viewer to rotate their screen. It is drawn into the video like everything else — the export is a flat file, so the gesture is the whole message.")
        OverlayPanelTextField("Caption", text: element.text ?? "", placeholder: "(none)") { v in change { $0.text = v } }
        OverlayPanelPicker("Turn", selection: element.rotateDirection ?? .cw, options: ElementPanelView.turnOptions) { d in
            change { $0.rotateDirection = d }
        }
        let phone = element.rotatePhoneScale ?? 0.66
        DevelopRangeSlider("Phone size", value: phone, in: 0.3...0.85, step: 0.02, reset: fresh.rotatePhoneScale ?? 0.66,
                           printed: P.percent(phone)) { v in change { $0.rotatePhoneScale = v } }
        let arc = element.rotateArcScale ?? 0.44
        DevelopRangeSlider("Arrow size", value: arc, in: 0.2...0.48, step: 0.02, reset: fresh.rotateArcScale ?? 0.44,
                           printed: P.percent(arc)) { v in change { $0.rotateArcScale = v } }
        let cycle = element.rotateCycleSeconds ?? 1.8
        DevelopRangeSlider("Cycle", value: cycle, in: 0.6...4, step: 0.1, reset: fresh.rotateCycleSeconds ?? 1.8,
                           printed: "\(P.fixed(cycle, 1)) s") { v in change { $0.rotateCycleSeconds = v } }
        OverlayPanelSwitch("Tip back upright each cycle", isOn: element.rotateReturn ?? true) { on in
            change { $0.rotateReturn = on }
        }
        OverlayPanelPicker("Caption at", selection: element.rotateLabel ?? .below,
                           options: ElementPanelView.captionOptions) { l in change { $0.rotateLabel = l } }
    }

    // telemetry field

    @ViewBuilder
    private var fieldContent: some View {
        OverlayPanelPicker("Field", selection: element.field ?? .relAlt, options: ElementPanelView.fieldOptions) { f in
            change { $0.field = f }
        }
        OverlayPanelTextField("Prefix", text: element.label ?? "", placeholder: "(none)") { v in change { $0.label = v } }
        if let field = element.field {
            if timeFields.contains(field) {
                timeControls(field)
            }
            if P.speedFields.contains(field) {
                OverlayPanelPicker("Unit", selection: element.speedUnit ?? .metresPerSecond,
                                   options: ElementPanelView.unitOptions) { u in change { $0.speedUnit = u } }
            }
            if P.derivedFields.contains(field) {
                earlyValues
            }
        }
    }

    /// A clock, a date or a timestamp: how THIS badge reads it. The shift is
    /// the project's, set once in its settings for every time element.
    @ViewBuilder
    private func timeControls(_ field: TelemetryFieldKey) -> some View {
        let time = element.timeFormatOptions ?? .default
        if field != .date {
            OverlayPanelPicker("Clock", selection: time.hour12 ? 12 : 24, options: ElementPanelView.clockOptions) { h in
                element = P.patchTimeFormat(element, hour12: h == 12)
            }
            if time.hour12 {
                OverlayPanelSwitch("Show AM / PM", isOn: time.meridiem) { on in
                    element = P.patchTimeFormat(element, meridiem: on)
                }
            }
            OverlayPanelSwitch("Seconds", isOn: time.seconds) { on in element = P.patchTimeFormat(element, seconds: on) }
            if field == .timestamp {
                OverlayPanelSwitch("Milliseconds", isOn: time.milliseconds) { on in
                    element = P.patchTimeFormat(element, milliseconds: on)
                }
            }
        }
        if field != .clock {
            OverlayPanelPicker("Date", selection: time.dateStyle, options: ElementPanelView.dateOptions) { s in
                element = P.patchTimeFormat(element, dateStyle: s)
            }
        }
        OverlayPanelHint("The flight log records a bare wall-clock reading with no timezone. If this clip's clock was off, correct it once in the project settings — it applies to every time element at once.")
    }

    // MARK: - appearance

    private var fontRow: some View {
        OverlayPanelPicker("Font", selection: st.fontFamily, options: ElementPanelView.fontOptions,
                           resetToTheme: backToTheme(.fontFamily)) { f in change([.fontFamily]) { $0.fontFamily = f } }
    }

    /// Geometry, always the element's own — a theme only multiplies it.
    private var sizeRow: some View {
        DevelopRangeSlider("Size", value: element.sizeFrac, in: 0.015...0.14, step: 0.005, reset: fresh.sizeFrac,
                           printed: P.percent(element.sizeFrac)) { v in change { $0.sizeFrac = v } }
    }

    private var colourRow: some View {
        OverlayPanelColourRow("Colour", css: P.hexOr(st.color, "#ffffff"), resetToTheme: backToTheme(.color)) { hex in
            change([.color]) { $0.color = hex }
        }
    }

    private var weightRow: some View {
        OverlayPanelPicker("Weight", selection: st.weight, options: ElementPanelView.weightOptions,
                           resetToTheme: backToTheme(.weight)) { w in change([.weight]) { $0.weight = w } }
    }

    private var italicRow: some View {
        OverlayPanelRow("Italic", resetToTheme: backToTheme(.italic)) {
            OverlayPanelToggle("Italic", isOn: st.italic) { on in change([.italic]) { $0.italic = on } }
        }
    }

    /// The legibility of the RESOLVED style: a patch writes the whole record
    /// back with the one field changed, as the web's spread does.
    @ViewBuilder
    private var legibilityRows: some View {
        let leg = st.legibility
        let split = P.splitColor(leg.color)
        OverlayPanelPicker("Legibility", selection: leg.mode, options: ElementPanelView.legibilityOptions,
                           resetToTheme: backToTheme(.legibility)) { mode in
            writeLegibility(leg) { $0.mode = mode }
        }
        if leg.mode != .none {
            OverlayPanelColourRow(leg.mode == .box ? "Box" : "Shadow", css: split.hex) { hex in
                writeLegibility(leg) { $0.color = P.rgba(hex, split.alpha) }
            }
            DevelopRangeSlider("Opacity", value: split.alpha, in: 0...1, step: 0.05,
                               reset: P.splitColor(fresh.legibility.color).alpha,
                               printed: P.percent(split.alpha)) { v in
                writeLegibility(leg) { $0.color = P.rgba(split.hex, v) }
            }
        }
    }

    private func writeLegibility(_ leg: LegibilityStyle, _ edit: (inout LegibilityStyle) -> Void) {
        var next = leg
        edit(&next)
        change([.legibility]) { $0.legibility = next }
    }

    // MARK: - the menus' words

    typealias Option = OverlayPanelOption

    static let compassOptions: [Option<CompassMode>] = [
        Option(.absolute, "North-up — ring fixed, arrow rotates"),
        Option(.relative, "Track-up — arrow fixed up, ring rotates"),
    ]

    static let gapOptions: [Option<HeadingGapMode>] = [
        Option(.dim, "Hold the last bearing, fading out"),
        Option(.hold, "Hold it plainly, then drop"),
        Option(.hide, "Drop to the no-data state at once"),
    ]

    static func degrees(_ steps: [Double]) -> [Option<Double>] {
        steps.map { Option($0, "\(DevelopNumbers.plain($0))°") }
    }

    static let reticleOptions: [Option<TapeReticle>] = [
        Option(.both, "Pointer + line"),
        Option(.triangle, "Pointer only"),
        Option(.line, "Line only"),
        Option(.none, "None"),
    ]

    static let tapeReadingOptions: [Option<LabelPlacement>] = [
        Option(.above, "Above the tape"),
        Option(.below, "Below the tape"),
        Option(.left, "Left of the tape"),
        Option(.right, "Right of the tape"),
        Option(.none, "Hidden"),
    ]

    static let batterySourceOptions: [Option<BatterySource>] = [
        Option(.manual, "A value I set"),
        Option(.telemetry, "A telemetry key"),
    ]

    static let batteryReadingOptions: [Option<LabelPlacement>] = [
        Option(.right, "Right of the cell"),
        Option(.left, "Left of the cell"),
        Option(.above, "Above the cell"),
        Option(.below, "Below the cell"),
        Option(.none, "Hidden"),
    ]

    static let turnOptions: [Option<RotateDirection>] = [
        Option(.cw, "Clockwise — onto its right side"),
        Option(.ccw, "Anticlockwise — onto its left side"),
    ]

    static let captionOptions: [Option<LabelPlacement>] = [
        Option(.below, "Below the phone"),
        Option(.above, "Above the phone"),
        Option(.right, "Right of the phone"),
        Option(.left, "Left of the phone"),
    ]

    static let fieldOptions: [Option<TelemetryFieldKey>] = fieldKeys.map { key in
        Option(key, fieldSpecs[key]?.label ?? key.rawValue)
    }

    static let unitOptions: [Option<SpeedUnit>] = SpeedUnit.allCases.map { Option($0, $0.rawValue) }

    static let clockOptions: [Option<Int>] = [Option(24, "24-hour"), Option(12, "12-hour")]

    static let dateOptions: [Option<DateStyle>] = OverlayPanels.dateStyleOptions.map { Option($0.style, $0.label) }

    static let fontOptions: [Option<OverlayFontFamily>] = curatedFonts.map { Option($0, $0.rawValue) }

    static let weightOptions: [Option<FontWeight>] = OverlayPanels.weightOptions.map { Option($0.weight, $0.label) }

    static let legibilityOptions: [Option<LegibilityMode>] = [
        Option(.none, "None"),
        Option(.shadow, "Drop shadow"),
        Option(.box, "Background box"),
    ]
}

// MARK: - previews

private struct ElementPanelPreview: View {
    @State private var element: OverlayElement
    let theme: StyleTheme?

    init(_ id: String, theme: StyleTheme?) {
        _element = State(initialValue: OverlayPanelFixtures.element(id))
        self.theme = theme
    }

    var body: some View {
        DevelopPreviewState(true) { _ in
            ElementPanelView(element: $element, theme: theme)
        }
    }
}

#Preview("Telemetry field, themed") { ElementPanelPreview("deck.0", theme: OverlayPanelFixtures.theme) }
#Preview("Clock") { ElementPanelPreview("deck.clock", theme: nil) }
#Preview("Heading tape, one override") { ElementPanelPreview("deck.tape", theme: OverlayPanelFixtures.theme) }
#Preview("Heading arrow") { ElementPanelPreview("deck.arrow", theme: nil) }
#Preview("Battery") { ElementPanelPreview("deck.battery", theme: nil) }
#Preview("Frame corners") { ElementPanelPreview("deck.corners", theme: nil) }
#Preview("Rotate phone") { ElementPanelPreview("deck.rotate", theme: nil) }
#Preview("Hook title") { ElementPanelPreview("deck.title", theme: OverlayPanelFixtures.theme) }
