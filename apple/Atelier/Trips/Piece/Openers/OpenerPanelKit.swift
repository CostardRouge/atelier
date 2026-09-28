// What every opener's own panel shares — the native twin of the web's
// `src/shared/roadtrip/hooks/panel-ui.tsx` (`Group`, `MovedRow`,
// `resetLink`), the three panels' `pictureLine`s, and the one write a panel
// makes: the opener's options, through the piece's funnel.
//
// A panel mounts INSIDE the Look tab's "Opener" section, so it cannot open
// sections of its own — the inspector's grammar is sections of rows — and
// groups its rows under a small mono legend instead, indented behind a rule
// (the web's `pl-3 border-l-2 border-line`). Its rows are the Studio's
// overlay rows (`OverlayPanelRow` & co.) and its sliders the app's one slider
// (`DevelopRangeSlider`), so an opener reads like every other inspector.
//
// Rules kept (`roadtrip.md`, «Every mode … shows the line it would really
// draw»; `hook-engine.md` §3):
// - A panel SAYS what the opener will do for this piece — the real reading,
//   or the reason there is none — and says how its pictures are coming.
// - A panel never writes the trip and never fetches: it writes its own
//   options, and asks the host for pictures (`OpenerPicturesRequest`) and the
//   garage (`configureCar`).
// - A write keeps every key a newer build wrote beside the known ones — the
//   port's "carried field" rule (`native-app.md`): the typed record is laid
//   OVER what the document holds, never in its place.

import SwiftUI
import AtelierKit

// MARK: - the one write

extension PieceEditorModel {
    /// Write the open opener's options: the typed record laid over what the
    /// document holds, so a key this build does not know is carried through.
    /// One undo step per gesture, through the piece's funnel.
    func writeOpenerOptions(_ typed: HookOptions) {
        var next = hookOptions
        for (key, value) in typed { next[key] = value }
        guard next != hookOptions else { return }
        patchBadge { $0.hook = setHookOptions($0.hook, next) }
    }

    /// How the opener's pictures are coming along — the web's
    /// `HookPictureStatus`: a want neither drawn nor refused yet is pending.
    var openerPictureStatus: HookPictureStatus {
        guard let post, let state = hookState else { return HookPictureStatus() }
        let wants = HookPictureLoader.wants(post.badge.hook, state.ctx)
        let pending = wants.filter { hookPictures[$0.key] == nil && hookPictureProblems[$0.key] == nil }.count
        return HookPictureStatus(pending: pending, problems: hookPictureProblems)
    }
}

// MARK: - words

/// The few words a gesture changes by platform — a tap on a phone, a click on
/// the Mac; "this device" where the web says "this computer".
enum OpenerWords {
    #if os(macOS)
    static let click = "Click"
    static let clickLower = "click"
    static let device = "this computer"
    #else
    static let click = "Tap"
    static let clickLower = "tap"
    static let device = "this device"
    #endif

    /// JavaScript's `Math.round`: a half goes UP.
    static func round(_ v: Double) -> Int {
        guard v.isFinite else { return 0 }
        return Int((v + 0.5).rounded(.down))
    }

    /// `Math.round(v * 100)%`.
    static func percent(_ v: Double) -> String { "\(round(v * 100))%" }

    /// `v.toFixed(1)s`.
    static func seconds(_ v: Double) -> String { String(format: "%.1fs", v) }

    /// `v.toFixed(n)`.
    static func fixed(_ v: Double, _ digits: Int) -> String { String(format: "%.\(digits)f", v) }

    /// A tick's pitch: `as designed`, else semitones — `+3 st`, `-2 st`.
    static func pitch(_ v: Double) -> String {
        if v == 1 { return "as designed" }
        let st = round(12 * log2(max(1e-6, v)))
        return "\(v < 1 ? "" : "+")\(st) st"
    }

    /// `none` at 0, else seconds to `digits` places.
    static func noneOrSeconds(_ v: Double, _ digits: Int) -> String {
        v == 0 ? "none" : "\(fixed(v, digits))s"
    }
}

// MARK: - the pictures' line

/// How the host is getting on with the pictures an opener draws — ONE line.
/// The three web panels word it a little differently, and each keeps its own.
enum OpenerPictureLine {
    enum Wording {
        /// Défilé: loading first, "(and others)" after several.
        case scrub
        /// The Itinerary: a failure first, then "still loading".
        case map
        /// Virée: loading first, no "(and others)".
        case drive
    }

    static func line(_ keys: [String], _ status: HookPictureStatus?, _ wording: Wording) -> (text: String, danger: Bool)? {
        guard let status, !keys.isEmpty else { return nil }
        let failing = keys.filter { status.problems[$0] != nil }
        let pending = status.pending
        let loading = wording == .map
            ? "\(pending) picture\(pending == 1 ? "" : "s") still loading…"
            : "Loading \(pending) \(pending == 1 ? "picture" : "pictures")…"
        if wording != .map && pending > 0 { return (loading, false) }
        guard let firstKey = failing.first else {
            return wording == .map && pending > 0 ? (loading, false) : nil
        }
        let first = status.problems[firstKey] ?? ""
        if failing.count == 1 { return ("One picture cannot be shown: \(first)", true) }
        let tail = wording == .drive ? "" : " (and others)"
        return ("\(failing.count) pictures cannot be shown — \(first)\(tail)", true)
    }
}

// MARK: - the panel's frame and its groups

/// The whole panel: indented behind a rule, one gap between its groups.
struct OpenerPanelFrame<Content: View>: View {
    @ViewBuilder let content: () -> Content
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.leading, 12)
        .overlay(alignment: .leading) {
            Rectangle().fill(palette.line).frame(width: 2)
        }
    }
}

/// A small mono legend over a group of rows — the web's `Group`.
struct OpenerGroup<Content: View>: View {
    let title: String
    @ViewBuilder let content: () -> Content
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(verbatim: title.uppercased())
                .font(Brand.mono(10))
                .kerning(1.4)
                .foregroundStyle(palette.muted)
                .accessibilityAddTraits(.isHeader)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A sentence of a panel, in one of the web's tones.
struct OpenerNote: View {
    enum Tone {
        /// `text-ink-soft` — what the opener will do.
        case soft
        /// `text-accent-ink` — what the author should know before exporting.
        case accent
        /// `text-muted`.
        case muted
        /// `text-faint`.
        case faint
        /// `text-danger`, announced.
        case danger
    }

    let text: String
    var tone: Tone = .soft
    var small = false
    @Environment(\.palette) private var palette

    init(_ text: String, tone: Tone = .soft, small: Bool = false) {
        self.text = text
        self.tone = tone
        self.small = small
    }

    var body: some View {
        Text(verbatim: text)
            .font(Brand.sans(small ? 11 : 12))
            .foregroundStyle(colour)
            .lineSpacing(1.5)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var colour: Color {
        switch tone {
        case .soft: return palette.inkSoft
        case .accent: return palette.accentInk
        case .muted: return palette.muted
        case .faint: return palette.faint
        case .danger: return palette.danger
        }
    }
}

/// The pictures' line, drawn — muted while loading, red when one will not come.
struct OpenerPictureLineView: View {
    let line: (text: String, danger: Bool)?

    var body: some View {
        if let line {
            OpenerNote(line.text, tone: line.danger ? .danger : .muted)
        }
    }
}

// MARK: - rows

/// A slider row: the row's name over the app's one slider, the value in the
/// web's own words, a ↺ back to the variant's default, the hint under it.
struct OpenerRange: View {
    let label: String
    let value: Double
    let range: ClosedRange<Double>
    let step: Double
    let reset: Double
    var hint: String? = nil
    let format: (Double) -> String
    let onChange: (Double) -> Void

    var body: some View {
        let shown = min(range.upperBound, max(range.lowerBound, value))
        VStack(alignment: .leading, spacing: 4) {
            DevelopRangeSlider(label, value: shown, in: range, step: step, reset: reset, printed: format(shown),
                               onChange: onChange)
            if let hint, !hint.isEmpty {
                OverlayPanelHint(hint)
            }
        }
    }
}

/// A labelled segmented choice — the web's `Segmented` inside a `FieldRow`.
struct OpenerSegmented<Value: Hashable>: View {
    let label: String
    /// What a screen reader calls the control — the web's `label` on it.
    let name: String
    let selection: Value
    let options: [OverlayPanelOption<Value>]
    var hint: String? = nil
    var alignTop = false
    let onChange: (Value) -> Void

    var body: some View {
        OverlayPanelRow(label, hint: hint, alignTop: alignTop) {
            Picker(name, selection: Binding(get: { selection }, set: { onChange($0) })) {
                ForEach(options) { option in
                    Text(verbatim: option.label).tag(option.value)
                }
            }
            .labelsHidden()
            .pickerStyle(.segmented)
            .accessibilityLabel(name)
        }
    }
}

/// A labelled switch with its words beside it — `FieldRow` + `ToggleField`.
struct OpenerToggleRow: View {
    let label: String
    let name: String
    let words: String
    let isOn: Bool
    var hint: String? = nil
    let onChange: (Bool) -> Void

    var body: some View {
        OverlayPanelRow(label, hint: hint) {
            OverlayPanelToggle(name, isOn: isOn, words: words, onChange: onChange)
        }
    }
}

/// Two colour wells side by side and a Reset once either departs from its
/// default — the tape's, the path's, the trail's and the paper's pairs.
struct OpenerColourPair: View {
    let label: String
    var hint: String? = nil
    let first: (name: String, css: String)
    let second: (name: String, css: String)
    let changed: Bool
    let onFirst: (String) -> Void
    let onSecond: (String) -> Void
    let onReset: () -> Void

    var body: some View {
        OverlayPanelRow(label, hint: hint) {
            OverlayPanelColourWell(first.name, css: first.css, onChange: onFirst)
            OverlayPanelColourWell(second.name, css: second.css, onChange: onSecond)
            if changed {
                Button("Reset", action: onReset)
                    .buttonStyle(DevelopLinkButtonStyle())
            }
        }
    }
}

/// The way back from a drag on the stage: where the opener was moved to, and
/// "Put it back" — the web's `MovedRow`. Drawn only once there is something
/// to undo: a drag must have one, or the coarse placement above it stops
/// meaning anything.
struct OpenerMovedRow: View {
    let offsetX: Double
    let offsetY: Double
    let onReset: () -> Void
    @Environment(\.palette) private var palette

    var body: some View {
        OverlayPanelRow("Moved", hint: "Dragged away from the placement above.") {
            Text(verbatim: "\(signed(offsetX)), \(signed(offsetY))")
                .font(Brand.mono(12))
                .foregroundStyle(palette.muted)
            Button("Put it back", action: onReset)
                .buttonStyle(DevelopLinkButtonStyle())
        }
    }

    private func signed(_ v: Double) -> String {
        "\(v >= 0 ? "+" : "")\(OpenerWords.round(v * 100))%"
    }
}

/// The tick kits and the easings as menu options.
enum OpenerChoices {
    static var easings: [OverlayPanelOption<HookEasing>] {
        hookEasingIds.map { OverlayPanelOption($0, hookEasings[$0]?.label ?? $0.rawValue) }
    }

    static func easingHint(_ id: HookEasing) -> String {
        hookEasings[id]?.hint ?? ""
    }

    static var kits: [OverlayPanelOption<TickKit>] {
        kitIds.map { OverlayPanelOption($0, $0.spec.label) }
    }

    static let distances: [OverlayPanelOption<DistanceUnit>] = [
        OverlayPanelOption(.off, "Off"), OverlayPanelOption(.km, "km"), OverlayPanelOption(.mi, "mi"),
    ]
}

#Preview("Panel kit") {
    OpenerPanelFrame {
        OpenerNote("12 stops from day 1 · 6 told days flash · 1.9s")
        OpenerNote("The hook is on screen for 3.0s, shorter than the sweep.", tone: .accent)
        OpenerGroup(title: "Sweep") {
            OpenerRange(label: "Length", value: 1.9, range: 0.8...4, step: 0.1, reset: 1.9,
                        format: OpenerWords.seconds, onChange: { _ in })
            OpenerSegmented(label: "Runs", name: "Where the tape runs", selection: "bottom",
                            options: [OverlayPanelOption("bottom", "Bottom"), OverlayPanelOption("top", "Top")],
                            onChange: { _ in })
            OpenerMovedRow(offsetX: 0.12, offsetY: -0.04, onReset: {})
        }
        OpenerPictureLineView(line: OpenerPictureLine.line(["a"], HookPictureStatus(pending: 0, problems: ["a": "DJI_0101.JPG is not in the Library."]), .scrub))
    }
    .frame(width: 340)
    .padding(16)
    .darkroom()
}
