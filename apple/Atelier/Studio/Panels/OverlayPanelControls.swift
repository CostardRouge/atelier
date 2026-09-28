// The rows every overlay panel is built from — the native twins of the web's
// inspector controls (`src/shared/ui/Inspector.tsx`: `FieldRow`, `SwitchRow`,
// `SelectField` / `NativeSelect`, `ToggleField`, `NumberField`, `TextField`,
// the colour swatch, `Readout`), in the Develop inspector's dress: a slider is
// ALWAYS `DevelopRangeSlider` (one slider for the whole app), a pill and a
// link are Develop's button styles, and everything reads `\.palette` and
// `Brand`, so a panel is in the darkroom or on paper by where it is placed.
//
// What differs from the web on purpose:
// - a select is a native MENU picker (the phone's own list, the Mac's pop-up);
// - a colour is the system's `ColorPicker`, reading a document's CSS string
//   through `CSSColor` and writing `#rrggbb`, which is what the web's
//   `<input type="color">` writes;
// - a number is a text field that commits as it is typed (the web's
//   `onChange`), with a stepper on the Mac where `<input type="number">` has
//   its arrows; a comma is read as a decimal point, since a French keyboard
//   types one.
// - the "back to theme" dot is the web's `OverrideDot`: drawn after a label
//   only while that property departs from the project style.

import CoreGraphics
import SwiftUI
import AtelierKit

// MARK: - the row

enum OverlayPanelMetrics {
    /// The label column, the web's `FieldRow` label width.
    static let label: CGFloat = 84
    static let gap: CGFloat = 10
}

/// How a row's hint reads: a note, or a problem (the QR link too long).
enum OverlayPanelHintTone {
    case note, problem
}

/// A label, a control, and — under the control — the row's hint.
struct OverlayPanelRow<Content: View>: View {
    private let label: String
    private let hint: String?
    private let tone: OverlayPanelHintTone
    private let alignTop: Bool
    private let resetToTheme: (() -> Void)?
    private let content: Content
    @Environment(\.palette) private var palette

    init(_ label: String, hint: String? = nil, tone: OverlayPanelHintTone = .note, alignTop: Bool = false,
         resetToTheme: (() -> Void)? = nil, @ViewBuilder content: () -> Content) {
        self.label = label
        self.hint = hint
        self.tone = tone
        self.alignTop = alignTop
        self.resetToTheme = resetToTheme
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: alignTop ? .top : .center, spacing: OverlayPanelMetrics.gap) {
                HStack(spacing: 4) {
                    Text(label)
                        .font(Brand.sans(12))
                        .foregroundStyle(palette.muted)
                        .lineLimit(2)
                    if let resetToTheme {
                        OverlayThemeResetDot(about: label, action: resetToTheme)
                    }
                }
                .frame(width: OverlayPanelMetrics.label, alignment: .leading)
                .padding(.top, alignTop ? 4 : 0)
                HStack(spacing: 8) {
                    content
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            if let hint, !hint.isEmpty {
                OverlayPanelHint(hint, tone: tone)
                    .padding(.leading, OverlayPanelMetrics.label + OverlayPanelMetrics.gap)
            }
        }
    }
}

/// The small print under a control.
struct OverlayPanelHint: View {
    private let text: String
    private let tone: OverlayPanelHintTone
    @Environment(\.palette) private var palette

    init(_ text: String, tone: OverlayPanelHintTone = .note) {
        self.text = text
        self.tone = tone
    }

    var body: some View {
        Text(verbatim: text)
            .font(Brand.sans(11))
            .foregroundStyle(tone == .problem ? palette.danger : palette.muted)
            .lineSpacing(1.5)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A standing paragraph at the head of a kind's controls.
struct OverlayPanelNote: View {
    private let text: Text
    @Environment(\.palette) private var palette

    init(_ string: String) { self.text = Text(verbatim: string) }
    init(text: Text) { self.text = text }

    var body: some View {
        text
            .font(Brand.sans(12))
            .foregroundStyle(palette.muted)
            .lineSpacing(2)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// "Back to theme" beside a pinned property's label. The web's `OverrideDot`.
struct OverlayThemeResetDot: View {
    let about: String
    let action: () -> Void
    @Environment(\.palette) private var palette

    var body: some View {
        Button(action: action) {
            Image(systemName: "arrow.uturn.backward.circle.fill")
                .font(Brand.sans(11, weight: .semibold))
                .foregroundStyle(palette.accent)
                .contentShape(Rectangle().inset(by: -6))
        }
        .buttonStyle(.plain)
        .help("Overriding the project style — click to follow the theme again")
        .accessibilityLabel("Reset \(about.lowercased()) to theme")
    }
}

// MARK: - a switch

/// A switch with its words beside it — the web's `ToggleField` (the words are
/// what it says; `label` stays its accessible name).
struct OverlayPanelToggle: View {
    private let label: String
    private let words: String?
    private let isOn: Bool
    private let onChange: (Bool) -> Void
    @Environment(\.palette) private var palette

    init(_ label: String, isOn: Bool, words: String? = nil, onChange: @escaping (Bool) -> Void) {
        self.label = label
        self.words = words
        self.isOn = isOn
        self.onChange = onChange
    }

    var body: some View {
        HStack(spacing: 8) {
            Toggle(label, isOn: Binding(get: { isOn }, set: { onChange($0) }))
                .labelsHidden()
                .toggleStyle(.switch)
                .controlSize(.mini)
                .tint(palette.accent)
            if let words {
                Text(verbatim: words)
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.inkSoft)
                    .lineLimit(1)
                    .onTapGesture { onChange(!isOn) }
            }
        }
    }
}

/// A setting that is on or off, named by its row — the web's `SwitchRow`.
struct OverlayPanelSwitch: View {
    private let label: String
    private let isOn: Bool
    private let hint: String?
    private let onChange: (Bool) -> Void
    @Environment(\.palette) private var palette

    init(_ label: String, isOn: Bool, hint: String? = nil, onChange: @escaping (Bool) -> Void) {
        self.label = label
        self.isOn = isOn
        self.hint = hint
        self.onChange = onChange
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Text(verbatim: label)
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.ink)
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                    .onTapGesture { onChange(!isOn) }
                Toggle(label, isOn: Binding(get: { isOn }, set: { onChange($0) }))
                    .labelsHidden()
                    .toggleStyle(.switch)
                    .controlSize(.mini)
                    .tint(palette.accent)
            }
            if let hint, !hint.isEmpty {
                OverlayPanelHint(hint)
            }
        }
    }
}

// MARK: - a menu

/// One choice of a menu.
struct OverlayPanelOption<Value: Hashable>: Identifiable {
    let value: Value
    let label: String
    var id: Value { value }

    init(_ value: Value, _ label: String) {
        self.value = value
        self.label = label
    }
}

/// A menu of named choices — the web's `SelectField` / `NativeSelect`.
struct OverlayPanelMenu<Value: Hashable>: View {
    private let label: String
    private let selection: Value
    private let options: [OverlayPanelOption<Value>]
    private let onChange: (Value) -> Void
    @Environment(\.palette) private var palette

    init(_ label: String, selection: Value, options: [OverlayPanelOption<Value>], onChange: @escaping (Value) -> Void) {
        self.label = label
        self.selection = selection
        self.options = options
        self.onChange = onChange
    }

    var body: some View {
        Picker(label, selection: Binding(get: { selection }, set: { onChange($0) })) {
            ForEach(options) { option in
                Text(verbatim: option.label).tag(option.value)
            }
        }
        .labelsHidden()
        .pickerStyle(.menu)
        .tint(palette.ink)
        .font(Brand.sans(13))
        .fixedSize(horizontal: false, vertical: true)
    }
}

/// A labelled row holding a menu.
struct OverlayPanelPicker<Value: Hashable>: View {
    private let label: String
    private let selection: Value
    private let options: [OverlayPanelOption<Value>]
    private let hint: String?
    private let resetToTheme: (() -> Void)?
    private let onChange: (Value) -> Void

    init(_ label: String, selection: Value, options: [OverlayPanelOption<Value>], hint: String? = nil,
         resetToTheme: (() -> Void)? = nil, onChange: @escaping (Value) -> Void) {
        self.label = label
        self.selection = selection
        self.options = options
        self.hint = hint
        self.resetToTheme = resetToTheme
        self.onChange = onChange
    }

    var body: some View {
        OverlayPanelRow(label, hint: hint, resetToTheme: resetToTheme) {
            OverlayPanelMenu(label, selection: selection, options: options, onChange: onChange)
        }
    }
}

// MARK: - a colour

enum OverlayPanelColour {
    /// A picked colour as the `#rrggbb` a document stores (sRGB codes).
    static func hex(_ colour: CGColor) -> String {
        let srgb = CGColorSpace(name: CGColorSpace.sRGB)
        let converted = srgb.flatMap { colour.converted(to: $0, intent: .defaultIntent, options: nil) } ?? colour
        let parts = converted.components ?? [0, 0, 0]
        let r = parts.count >= 3 ? parts[0] : (parts.first ?? 0)
        let g = parts.count >= 3 ? parts[1] : (parts.first ?? 0)
        let b = parts.count >= 3 ? parts[2] : (parts.first ?? 0)
        func byte(_ v: CGFloat) -> Int { Int((min(1, max(0, v)) * 255).rounded()) }
        return String(format: "#%02x%02x%02x", byte(r), byte(g), byte(b))
    }

    /// A document's CSS colour for a well — black when a canvas could not read it.
    static func cgColor(_ css: String) -> CGColor {
        CSSColor.parse(css) ?? CSSColor.black
    }
}

/// The colour well alone, reading a CSS string and writing `#rrggbb`.
struct OverlayPanelColourWell: View {
    private let label: String
    private let css: String
    private let onChange: (String) -> Void

    init(_ label: String, css: String, onChange: @escaping (String) -> Void) {
        self.label = label
        self.css = css
        self.onChange = onChange
    }

    var body: some View {
        ColorPicker(label, selection: Binding<CGColor>(
            get: { OverlayPanelColour.cgColor(css) },
            set: { onChange(OverlayPanelColour.hex($0)) }
        ), supportsOpacity: false)
        .labelsHidden()
        .fixedSize()
    }
}

/// A labelled colour row, the value read beside the well when asked.
struct OverlayPanelColourRow: View {
    private let label: String
    private let css: String
    private let readout: String?
    private let hint: String?
    private let resetToTheme: (() -> Void)?
    private let onChange: (String) -> Void
    @Environment(\.palette) private var palette

    init(_ label: String, css: String, readout: String? = nil, hint: String? = nil,
         resetToTheme: (() -> Void)? = nil, onChange: @escaping (String) -> Void) {
        self.label = label
        self.css = css
        self.readout = readout
        self.hint = hint
        self.resetToTheme = resetToTheme
        self.onChange = onChange
    }

    var body: some View {
        OverlayPanelRow(label, hint: hint, resetToTheme: resetToTheme) {
            OverlayPanelColourWell(label, css: css, onChange: onChange)
            if let readout {
                Text(verbatim: readout)
                    .font(Brand.mono(11))
                    .foregroundStyle(palette.muted)
                    .lineLimit(1)
            }
        }
    }
}

// MARK: - text

/// One line of text, committed as it is typed.
struct OverlayPanelTextInput: View {
    private let label: String
    private let text: String
    private let placeholder: String?
    private let isLink: Bool
    private let onChange: (String) -> Void

    init(_ label: String, text: String, placeholder: String? = nil, isLink: Bool = false,
         onChange: @escaping (String) -> Void) {
        self.label = label
        self.text = text
        self.placeholder = placeholder
        self.isLink = isLink
        self.onChange = onChange
    }

    var body: some View {
        TextField(label, text: Binding(get: { text }, set: { onChange($0) }),
                  prompt: placeholder.map { Text(verbatim: $0) })
            .textFieldStyle(.roundedBorder)
            .font(Brand.sans(13))
            .overlayPanelLinkEntry(isLink)
            .frame(maxWidth: .infinity)
    }
}

/// A labelled text row — the web's `FieldRow` + `TextField`.
struct OverlayPanelTextField: View {
    private let label: String
    private let text: String
    private let placeholder: String?
    private let hint: String?
    private let onChange: (String) -> Void

    init(_ label: String, text: String, placeholder: String? = nil, hint: String? = nil,
         onChange: @escaping (String) -> Void) {
        self.label = label
        self.text = text
        self.placeholder = placeholder
        self.hint = hint
        self.onChange = onChange
    }

    var body: some View {
        OverlayPanelRow(label, hint: hint) {
            OverlayPanelTextInput(label, text: text, placeholder: placeholder, onChange: onChange)
        }
    }
}

extension View {
    /// A link typed on a phone: the URL keyboard, no capitals, no corrections.
    @ViewBuilder
    func overlayPanelLinkEntry(_ on: Bool) -> some View {
        if on {
            #if os(iOS)
            self.keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
            #else
            self.autocorrectionDisabled()
            #endif
        } else {
            self
        }
    }

    /// A number typed on a phone: the decimal pad.
    @ViewBuilder
    func overlayPanelDecimalEntry() -> some View {
        #if os(iOS)
        self.keyboardType(.decimalPad)
        #else
        self
        #endif
    }
}

// MARK: - a number

/// A number typed rather than dragged — a time in seconds. Empty is a value
/// of its own where `onClear` is given (an end that follows the scene or the
/// clip). The web's `NumberField`.
struct OverlayPanelNumberField: View {
    private let label: String
    private let value: Double?
    private let step: Double
    private let range: ClosedRange<Double>?
    private let unit: String?
    private let placeholder: String?
    private let onChange: (Double) -> Void
    private let onClear: (() -> Void)?

    @State private var text = ""
    @FocusState private var focused: Bool
    @Environment(\.palette) private var palette

    init(_ label: String, value: Double?, step: Double = 1, range: ClosedRange<Double>? = nil, unit: String? = nil,
         placeholder: String? = nil, onClear: (() -> Void)? = nil, onChange: @escaping (Double) -> Void) {
        self.label = label
        self.value = value
        self.step = step
        self.range = range
        self.unit = unit
        self.placeholder = placeholder
        self.onChange = onChange
        self.onClear = onClear
    }

    var body: some View {
        HStack(spacing: 4) {
            TextField(label, text: $text, prompt: placeholder.map { Text(verbatim: $0) })
                .textFieldStyle(.roundedBorder)
                .font(Brand.mono(13))
                .monospacedDigit()
                .multilineTextAlignment(.trailing)
                .focused($focused)
                .overlayPanelDecimalEntry()
                .onAppear { text = OverlayPanelNumberField.shown(value) }
                .onChange(of: value) { _, next in
                    if !focused { text = OverlayPanelNumberField.shown(next) }
                }
                .onChange(of: text) { _, next in commit(next) }
                .onChange(of: focused) { _, isFocused in
                    if !isFocused { text = OverlayPanelNumberField.shown(value) }
                }
                .onSubmit { text = OverlayPanelNumberField.shown(value) }
                .frame(minWidth: 56, maxWidth: 96)
            if let unit {
                Text(verbatim: unit)
                    .font(Brand.mono(11))
                    .foregroundStyle(palette.muted)
            }
            #if os(macOS)
            Stepper(label, onIncrement: { bump(1) }, onDecrement: { bump(-1) })
                .labelsHidden()
                .controlSize(.small)
            #endif
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(label)
    }

    /// The value as the field shows it: `3`, `0.5`, empty for none.
    private static func shown(_ value: Double?) -> String {
        guard let value, value.isFinite else { return "" }
        return DevelopNumbers.plain(value)
    }

    /// Typing writes as it goes, the web's `onChange`; a field emptied calls
    /// `onClear`, and a half-typed number ("1.", "-") waits.
    private func commit(_ raw: String) {
        let trimmed = raw.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
        if trimmed.isEmpty {
            if let onClear, value != nil { onClear() }
            return
        }
        guard let parsed = Double(trimmed), parsed.isFinite, parsed != value else { return }
        onChange(parsed)
    }

    /// The Mac's stepper arrows, a step at a time, on the step's own decimals.
    private func bump(_ direction: Double) {
        var next = (value ?? range?.lowerBound ?? 0) + direction * step
        if let range { next = min(range.upperBound, max(range.lowerBound, next)) }
        let decimals = max(0, Int((-log10(step)).rounded(.up)))
        let scale = pow(10, Double(decimals))
        next = (next * scale).rounded() / scale
        onChange(next)
        text = OverlayPanelNumberField.shown(next)
    }
}

// MARK: - verbs

/// A small destructive pill — the web's `Button variant="danger" size="sm"`.
struct OverlayPanelDangerButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        DangerBody(configuration: configuration)
    }

    private struct DangerBody: View {
        let configuration: ButtonStyleConfiguration
        @Environment(\.palette) private var palette
        @Environment(\.isEnabled) private var isEnabled

        var body: some View {
            configuration.label
                .font(Brand.sans(12, weight: .semibold))
                .foregroundStyle(palette.danger)
                .lineLimit(1)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(Capsule().fill(configuration.isPressed ? palette.accentWash : palette.paper))
                .overlay(Capsule().stroke(palette.danger.opacity(0.6), lineWidth: 1))
                .opacity(isEnabled ? 1 : 0.5)
                .contentShape(Capsule())
        }
    }
}

// MARK: - the anchor grid

/// The nine anchors, a 3 × 3 grid of dots — the web's anchor picker.
struct OverlayAnchorGrid: View {
    let selection: OverlayAnchor
    let onChange: (OverlayAnchor) -> Void
    @Environment(\.palette) private var palette

    private static let rows: [[OverlayAnchor]] = [
        [.topLeft, .topCenter, .topRight],
        [.centerLeft, .center, .centerRight],
        [.bottomLeft, .bottomCenter, .bottomRight],
    ]

    var body: some View {
        Grid(horizontalSpacing: 4, verticalSpacing: 4) {
            ForEach(0..<3, id: \.self) { r in
                GridRow {
                    ForEach(OverlayAnchorGrid.rows[r], id: \.self) { anchor in
                        cell(anchor)
                    }
                }
            }
        }
    }

    private func cell(_ anchor: OverlayAnchor) -> some View {
        let on = anchor == selection
        return Button {
            onChange(anchor)
        } label: {
            RoundedRectangle(cornerRadius: 6)
                .fill(on ? palette.accentWash : palette.paper)
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(on ? palette.accent : palette.lineStrong, lineWidth: 1))
                .overlay(Circle().fill(on ? palette.accent : palette.muted).frame(width: 6, height: 6))
                .frame(width: 26, height: 26)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(anchor.rawValue)
        .accessibilityLabel("Anchor \(anchor.rawValue)")
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}
