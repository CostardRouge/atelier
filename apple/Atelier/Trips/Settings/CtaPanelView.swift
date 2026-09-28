// The closing slide, edited once for the whole trip — port of
// `src/tools/roadtrip/CtaPanel.tsx`. A controlled panel: it shows the card and
// hands every change back; ⚙ Trip writes it on the trip, keystroke by
// keystroke.
//
// Rules kept (`roadtrip.md`, «A Road Trip post is a DECK»):
// - Everything here is published copy, so nothing is computed and nothing is
//   fixed — the two colours included, because a QR only scans when it
//   contrasts with its own ground.
// - The link's length is counted in UTF-8 bytes of the trimmed text, the
//   web's `TextEncoder`, against `qrMaxBytes`; past it the count turns red.
// - A QR the author asked for and that cannot be drawn is SAID
//   (`ctaLayout(...).qrProblem`), never a blank square.
// - A tap on a line of the card on the stage opens the sheet AT that line:
//   `focusRole` focuses its field once it is up (the web's `ctaFieldRefs`).

import SwiftUI
import AtelierKit

struct CtaPanelView: View {
    let cta: CtaSlide
    let onChange: (CtaSlide) -> Void
    /// Why the QR could not be drawn, when the author asked for one.
    let problem: String?
    /// The line whose field a tap on the card asked for.
    var focusRole: CtaRole? = nil

    @FocusState private var focused: CtaRole?
    @Environment(\.palette) private var palette

    var body: some View {
        let urlLength = cta.url.trimmingCharacters(in: .whitespacesAndNewlines).utf8.count
        let tooLong = urlLength > qrMaxBytes
        return VStack(alignment: .leading, spacing: 12) {
            labelled("Headline") {
                TextField("Headline", text: text(\.headline))
                    .textFieldStyle(.roundedBorder)
                    .font(Brand.sans(14))
                    .focused($focused, equals: .headline)
            }
            labelled("Body") {
                TextField("Body", text: text(\.body), axis: .vertical)
                    .lineLimit(3...8)
                    .textFieldStyle(.roundedBorder)
                    .font(Brand.sans(14))
                    .focused($focused, equals: .body)
            }
            labelled("Link") {
                TextField("Link", text: text(\.url), prompt: Text(verbatim: "https://…"))
                    .textFieldStyle(.roundedBorder)
                    .font(Brand.sans(14))
                    .overlayPanelLinkEntry(true)
                    .focused($focused, equals: .url)
                Text(verbatim: "\(urlLength)/\(qrMaxBytes) characters a QR code can hold")
                    .font(Brand.sans(11))
                    .foregroundStyle(tooLong ? palette.danger : palette.faint)
            }
            Toggle(isOn: Binding(get: { cta.showQr }, set: { on in patch { $0.showQr = on } })) {
                Text("Show a QR code for the link")
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.inkSoft)
            }
            .toggleStyle(.switch)
            .controlSize(.mini)
            .tint(palette.accent)
            .fixedSize()
            if let problem {
                Text(verbatim: problem)
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.danger)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isStaticText)
            }
            HStack(spacing: 16) {
                colour("Ground", css: cta.background, accessibility: "Card background") { hex in
                    patch { $0.background = hex }
                }
                colour("Ink", css: cta.ink, accessibility: "Card ink") { hex in
                    patch { $0.ink = hex }
                }
            }
            Text("The QR is drawn in the ink on the ground — a code the same colour as its surround scans as nothing at all.")
                .font(Brand.sans(11))
                .foregroundStyle(palette.faint)
                .fixedSize(horizontal: false, vertical: true)
        }
        .task(id: focusRole) {
            // The field only takes the focus once whatever holds it is up.
            guard let role = focusRole else { return }
            try? await Task.sleep(nanoseconds: 350_000_000)
            focused = role
        }
    }

    // MARK: - the pieces

    private func labelled<Content: View>(_ label: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Eyebrow(label)
            content()
        }
    }

    private func colour(_ label: String, css: String, accessibility: String,
                        onChange: @escaping (String) -> Void) -> some View {
        HStack(spacing: 8) {
            Text(verbatim: label)
                .font(Brand.sans(12))
                .foregroundStyle(palette.inkSoft)
            OverlayPanelColourWell(accessibility, css: css, onChange: onChange)
        }
    }

    private func text(_ key: WritableKeyPath<CtaSlide, String>) -> Binding<String> {
        Binding(get: { cta[keyPath: key] }, set: { value in patch { $0[keyPath: key] = value } })
    }

    private func patch(_ change: (inout CtaSlide) -> Void) {
        var next = cta
        change(&next)
        onChange(next)
    }
}

// MARK: - previews

private struct CtaPanelPreview: View {
    @State private var cta: CtaSlide

    init(_ cta: CtaSlide) {
        _cta = State(initialValue: cta)
    }

    var body: some View {
        ScrollView {
            CtaPanelView(cta: cta, onChange: { cta = $0 }, problem: ctaLayout(cta, 0.8).qrProblem)
                .padding(24)
        }
        .frame(minWidth: 360, minHeight: 560)
        .background(Palette.paper.surface)
    }
}

#Preview("Closing card") { CtaPanelPreview(defaultCta) }

#Preview("A link too long for a QR") {
    var cta = defaultCta
    cta.url = "https://atelier.steeve.website/" + String(repeating: "a-very-long-path/", count: 14)
    return CtaPanelPreview(cta)
}
