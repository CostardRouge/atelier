// The pieces the export's Live Activity is drawn from: the brand's colours,
// the Lock Screen card, the ring, the bar, the figure and the words.

import ActivityKit
import SwiftUI
import WidgetKit

/// The brand's three colours, COPIED from `apple/Atelier/Theme/Theme.swift`
/// (`Palette.paper`'s day values — the web's `src/index.css`): the extension
/// cannot import the app's module. Ink on warm paper, one vermilion accent;
/// on the island's black the accent takes its night value, as the app's does
/// under a dark appearance.
enum ExportBrand {
    /// `ink`, day: 0x1B1813.
    static let ink = rgb(0x1B1813)
    /// `paper`, day: 0xF4F0E7 — also the light ink laid on the island's black.
    static let paper = rgb(0xF4F0E7)
    /// `accent`, day: 0xD9442A — the vermilion.
    static let vermilion = rgb(0xD9442A)
    /// `accent`, night: 0xEF5638 — the vermilion on black.
    static let vermilionNight = rgb(0xEF5638)

    private static func rgb(_ hex: UInt32) -> Color {
        Color(red: Double((hex >> 16) & 0xFF) / 255,
              green: Double((hex >> 8) & 0xFF) / 255,
              blue: Double(hex & 0xFF) / 255)
    }
}

/// The words a face says beyond the title.
enum ExportWords {
    /// "NN %" — the progress pill's own figure.
    static func percent(_ state: ExportActivityAttributes.ContentState) -> String? {
        guard state.phase == .running, let p = state.progress else { return nil }
        return "\(Int((p * 100).rounded())) %"
    }

    /// "2 of 3 done" where the run holds more than one export.
    static func count(_ state: ExportActivityAttributes.ContentState) -> String? {
        guard let done = state.done, let total = state.total, total > 1 else { return nil }
        return "\(done) of \(total) done"
    }

    /// The line under the title: the detail and the count — or, once the app
    /// stopped feeding a running activity, that it did.
    static func detail(_ context: ActivityViewContext<ExportActivityAttributes>) -> String {
        let state = context.state
        if context.isStale, state.phase == .running {
            return "No word from Atelier for a minute — open it to see where the export is"
        }
        let parts = [state.detail, count(state)].compactMap { $0 }.filter { !$0.isEmpty }
        return parts.joined(separator: " · ")
    }
}

/// The Lock Screen card (and the banner): the brand's mark, the figure, the
/// title, the detail and the bar, ink on paper.
struct ExportLockScreenView: View {
    let context: ActivityViewContext<ExportActivityAttributes>

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            Text(context.state.title)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(ExportBrand.ink)
                .lineLimit(1)
            Text(ExportWords.detail(context))
                .font(.system(size: 13))
                .foregroundStyle(ExportBrand.ink.opacity(0.6))
                .lineLimit(2)
            ExportBar(state: context.state, tint: ExportBrand.vermilion)
                .frame(height: 4)
                .padding(.top, 2)
        }
        .padding(16)
    }

    private var header: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(ExportBrand.vermilion)
                .frame(width: 7, height: 7)
            Text("ATELIER")
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .tracking(1.2)
                .foregroundStyle(ExportBrand.ink.opacity(0.6))
            Spacer(minLength: 8)
            ExportFigure(context: context, tint: ExportBrand.ink, size: 13)
        }
    }
}

/// The figure at a face's right: the percentage where it is measured, the
/// time elapsed where it is not, a word once the run ended.
struct ExportFigure: View {
    let context: ActivityViewContext<ExportActivityAttributes>
    let tint: Color
    let size: CGFloat

    var body: some View {
        figure
            .font(.system(size: size, weight: .medium, design: .monospaced))
            .monospacedDigit()
            .foregroundStyle(tint)
            .multilineTextAlignment(.trailing)
            .lineLimit(1)
    }

    @ViewBuilder
    private var figure: some View {
        switch context.state.phase {
        case .running:
            if let percent = ExportWords.percent(context.state) {
                Text(percent)
            } else {
                // Counted up by the system from the run's start.
                Text(context.attributes.startedAt, style: .timer)
            }
        case .finished:
            Image(systemName: "checkmark")
        case .stopped:
            Image(systemName: "xmark")
        }
    }
}

/// A thin ring: the measured fill, a still quarter where nobody measured a
/// length, a check or a cross once the run ended.
struct ExportRing: View {
    let state: ExportActivityAttributes.ContentState
    let tint: Color
    let size: CGFloat

    private var line: CGFloat { max(2, size / 9) }

    var body: some View {
        ZStack {
            Circle()
                .stroke(tint.opacity(0.25), lineWidth: line)
            mark
        }
        .frame(width: size, height: size)
    }

    @ViewBuilder
    private var mark: some View {
        switch state.phase {
        case .running:
            Circle()
                .trim(from: start, to: end)
                .stroke(tint, style: StrokeStyle(lineWidth: line, lineCap: .round))
                .rotationEffect(.degrees(-90))
        case .finished:
            Image(systemName: "checkmark")
                .font(.system(size: size * 0.45, weight: .bold))
                .foregroundStyle(tint)
        case .stopped:
            Image(systemName: "xmark")
                .font(.system(size: size * 0.4, weight: .bold))
                .foregroundStyle(tint)
        }
    }

    /// Where the arc starts: the top for a fill, off it for the still quarter
    /// (never at the start, where it would read as a quarter done).
    private var start: CGFloat { state.progress == nil ? 0.125 : 0 }

    private var end: CGFloat {
        guard let p = state.progress else { return 0.375 }
        return CGFloat(max(0.02, min(1, p)))
    }
}

/// The 4-pt bar: the accent at 18 % for the track, the measured fill over it,
/// a still quarter in the MIDDLE where nobody measured a length (the app's
/// `TaskEdge` under Reduce Motion), full once finished, the track alone for
/// a run stopped with no length.
struct ExportBar: View {
    let state: ExportActivityAttributes.ContentState
    let tint: Color

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(tint.opacity(0.18))
                fill(width: geo.size.width, height: geo.size.height)
            }
        }
    }

    @ViewBuilder
    private func fill(width: CGFloat, height: CGFloat) -> some View {
        if let ratio = measured {
            Capsule()
                .fill(tint)
                .frame(width: max(height, width * CGFloat(ratio)))
        } else if state.phase == .running {
            Capsule()
                .fill(tint)
                .frame(width: width * 0.25)
                .offset(x: width * 0.375)
        }
    }

    /// The fill's measure, or nil for none.
    private var measured: Double? {
        if state.phase == .finished { return 1 }
        guard let p = state.progress else { return nil }
        return max(0, min(1, p))
    }
}
