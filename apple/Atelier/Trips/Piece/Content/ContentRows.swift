// The rows the Content tab is laid out in — the web's inspector grammar
// (`src/shared/ui/Inspector.tsx`: `FieldRow` — a label column, the control,
// the hint under it; `Segmented`) in the overlay panels' dress
// (`OverlayPanelControls.swift`: the same label column, the same small print).
//
// What the Content tab's hints need that a plain string row cannot say: a
// hint that IS the line the badge would draw (mono, in ink — the web's
// `font-mono text-ink`), a reason (muted), or a problem (danger). And a
// segmented choice whose every option says what it would really give under
// its label: the web puts that in a tooltip, a phone has no hover, so it is
// drawn.

import SwiftUI
import AtelierKit

// MARK: - the row

/// A label, a control, and what the row says under the control.
struct ContentFieldRow<Control: View, Hint: View>: View {
    private let label: String
    private let alignTop: Bool
    private let control: Control
    private let hint: Hint
    @Environment(\.palette) private var palette

    init(_ label: String, alignTop: Bool = false, @ViewBuilder control: () -> Control,
         @ViewBuilder hint: () -> Hint) {
        self.label = label
        self.alignTop = alignTop
        self.control = control()
        self.hint = hint()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: alignTop ? .top : .center, spacing: OverlayPanelMetrics.gap) {
                Text(verbatim: label)
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.muted)
                    .lineLimit(2)
                    .frame(width: OverlayPanelMetrics.label, alignment: .leading)
                    .padding(.top, alignTop ? 4 : 0)
                    .accessibilityHidden(label.isEmpty)
                HStack(spacing: 8) {
                    control
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            if !(hint is EmptyView) {
                VStack(alignment: .leading, spacing: 4) {
                    hint
                }
                .padding(.leading, OverlayPanelMetrics.label + OverlayPanelMetrics.gap)
            }
        }
    }
}

extension ContentFieldRow where Hint == EmptyView {
    init(_ label: String, alignTop: Bool = false, @ViewBuilder control: () -> Control) {
        self.init(label, alignTop: alignTop, control: control, hint: { EmptyView() })
    }
}

// MARK: - the small print

enum ContentHintTone {
    /// A standing note or a reason — muted.
    case note
    /// The line the badge would draw — mono, in ink.
    case line
    /// A problem — the danger ink.
    case danger
}

struct ContentHint: View {
    private let text: String
    private let tone: ContentHintTone
    @Environment(\.palette) private var palette

    init(_ text: String, tone: ContentHintTone = .note) {
        self.text = text
        self.tone = tone
    }

    var body: some View {
        Text(verbatim: text)
            .font(tone == .line ? Brand.mono(11) : Brand.sans(11))
            .foregroundStyle(ink)
            .lineSpacing(1.5)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .textSelection(.enabled)
    }

    private var ink: Color {
        switch tone {
        case .note: return palette.muted
        case .line: return palette.ink
        case .danger: return palette.danger
        }
    }
}

/// A mode's hint from the kernel: its real line, or why there is none.
struct ContentModeHint: View {
    let hint: PieceModeHint?

    var body: some View {
        switch hint {
        case .some(.line(let text)): ContentHint(text, tone: .line)
        case .some(.reason(let text)): ContentHint(text)
        case .none: EmptyView()
        }
    }
}

// MARK: - a segmented choice that says what each option gives

struct ContentChoiceOption<Value: Hashable>: Identifiable {
    let value: Value
    let label: String
    /// What choosing it would really give, drawn under the label; nil when
    /// the label already says it.
    let detail: String?
    var id: Value { value }
}

/// The web's `Segmented` (fill, small): one tile per option, the chosen one
/// in the accent. Each tile draws its `detail` under its label — the web's
/// `title`, which a finger cannot hover.
struct ContentChoiceStrip<Value: Hashable>: View {
    private let label: String
    private let selection: Value
    private let options: [ContentChoiceOption<Value>]
    private let onChange: (Value) -> Void
    /// Counts the HAND's picks — never a new slide's choice arriving, which
    /// would buzz on every slide opened.
    @State private var picks = 0
    @Environment(\.palette) private var palette

    init(_ label: String, selection: Value, options: [ContentChoiceOption<Value>],
         onChange: @escaping (Value) -> Void) {
        self.label = label
        self.selection = selection
        self.options = options
        self.onChange = onChange
    }

    var body: some View {
        HStack(spacing: 2) {
            ForEach(options) { option in
                tile(option)
            }
        }
        .padding(2)
        .background(RoundedRectangle(cornerRadius: 8).fill(palette.paper))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(palette.lineStrong, lineWidth: 1))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(label)
        .sensoryFeedback(.selection, trigger: picks)
    }

    private func tile(_ option: ContentChoiceOption<Value>) -> some View {
        let on = option.value == selection
        return Button {
            guard !on else { return }
            picks += 1
            onChange(option.value)
        } label: {
            VStack(spacing: 1) {
                Text(verbatim: option.label)
                    .font(Brand.sans(12, weight: on ? .semibold : .regular))
                    .foregroundStyle(on ? palette.accentInk : palette.inkSoft)
                    .lineLimit(1)
                if let detail = option.detail {
                    Text(verbatim: detail)
                        .font(Brand.mono(9))
                        .foregroundStyle(on ? palette.accentInk : palette.muted)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 30)
            .padding(.horizontal, 4)
            .background(RoundedRectangle(cornerRadius: 6).fill(on ? palette.accentWash : Color.clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(option.detail ?? option.label)
        .accessibilityLabel(option.label)
        .accessibilityValue(option.detail ?? "")
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

#Preview("Content rows") {
    VStack(alignment: .leading, spacing: 12) {
        ContentFieldRow("Goes out as") {
            ContentChoiceStrip("What this slide is delivered as", selection: SlideMedium.auto, options: [
                ContentChoiceOption(value: SlideMedium.auto, label: "Auto", detail: "image"),
                ContentChoiceOption(value: SlideMedium.image, label: "Image", detail: nil),
                ContentChoiceOption(value: SlideMedium.video, label: "Video", detail: "a held card"),
            ]) { _ in }
        } hint: {
            ContentHint("A still picture, delivered as one.")
        }
        ContentFieldRow("Mode") {
            Text("Day of trip · Day · 2 · of 81")
        } hint: {
            ContentModeHint(hint: .line("Day · 2 · of 81"))
        }
        ContentFieldRow("Text") {
            Text("(nothing here)")
        } hint: {
            ContentHint("This trip’s dates read backwards, so there is no total to count towards. Fix them and the badge comes back.",
                        tone: .danger)
        }
    }
    .frame(width: 360)
    .padding(16)
    .darkroom()
}
