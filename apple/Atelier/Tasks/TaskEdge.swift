// The media's own surface — the web's `TaskEdge.tsx` (and its `TaskBar`):
// a 2 pt hairline along a media's edge, a fill in the accent where the length
// is known and a sweeping sliver where it is not (the lightbox's
// `deck-load`: a quarter of the bar crossing it in 1.15 s). It costs the
// picture nothing and says only that something is happening TO THIS MEDIA —
// the words and the Cancel are the pill's (`TaskPill`).
//
// It draws the tasks whose `scope` is that media (a picture id, the capture's
// asset id), and nothing under 400 ms or when nothing runs. It lies over its
// stage box — the Develop stage's bottom edge, a filmstrip cell's — and takes
// no touch.
//
// Reduce Motion: no sweep. A length nobody knows is then a still sliver in
// the MIDDLE of the bar — never at its start, where it would read as a
// quarter done.
//
// `TaskCancelLink` is the modal sheet's own Cancel (`tasks.md` T2): a sheet
// covers the toolbar the pill sits in, so a sheet showing a media draws the
// edge on it and this link beside it.

import SwiftUI
import AtelierKit

struct TaskEdge: View {
    /// The media whose tasks this edge draws; nil draws nothing.
    let scope: String?
    /// Which edge of the box: the bottom by default.
    var edge: VerticalEdge = .bottom

    var body: some View {
        let tasks = TaskCenter.shared.scoped(scope)
        if !tasks.isEmpty {
            TaskBar(tasks: tasks)
                .frame(maxHeight: .infinity, alignment: edge == .top ? .top : .bottom)
                .allowsHitTesting(false)
        }
    }
}

/// The bar itself, for the edge and for the pill's list alike.
struct TaskBar: View {
    let tasks: [RunningTask]
    var height: CGFloat = 2

    @Environment(\.palette) private var palette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let ratio = overallProgress(tasks)
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                palette.accent.opacity(0.18)
                if let ratio {
                    Rectangle()
                        .fill(palette.accent)
                        .frame(width: geo.size.width * CGFloat(ratio))
                        .animation(.linear(duration: 0.2), value: ratio)
                } else if reduceMotion {
                    Rectangle()
                        .fill(palette.accent)
                        .frame(width: geo.size.width / 4)
                        .offset(x: geo.size.width * 3 / 8)
                } else {
                    TaskSweep(color: palette.accent, width: geo.size.width)
                }
            }
        }
        .frame(height: height)
        .clipShape(Capsule())
        .accessibilityElement()
        .accessibilityLabel(label)
        .accessibilityValue(ratio.map { "\(Int(($0 * 100).rounded())) %" } ?? "no length to measure")
    }

    private var label: String {
        tasks.count == 1 ? tasks[0].label : "\(tasks.count) things running"
    }
}

/// The sliver crossing a bar whose length nobody knows — from just before
/// its start to just past its end, eased in and out, again and again.
private struct TaskSweep: View {
    let color: Color
    let width: CGFloat

    private static let period = 1.15

    var body: some View {
        TimelineView(.animation) { context in
            let seconds = context.date.timeIntervalSinceReferenceDate
            let phase = seconds.truncatingRemainder(dividingBy: TaskSweep.period) / TaskSweep.period
            let eased = easeAt(.inOut, phase)
            let sliver = width / 4
            // The web's keyframes: translateX(-110 %) → translateX(410 %) of the sliver.
            let shift = CGFloat(-1.1 + 5.2 * eased)
            Rectangle()
                .fill(color)
                .frame(width: sliver)
                .offset(x: sliver * shift)
        }
    }
}

/// A modal sheet's own Cancel for the media it shows: drawn only while a task
/// of that media can really stop, and said once pressed.
struct TaskCancelLink: View {
    let scope: String?

    @Environment(\.palette) private var palette

    var body: some View {
        let center = TaskCenter.shared
        let tasks = center.scoped(scope).filter { $0.cancel != nil }
        let open = tasks.filter { !center.cancelling.contains($0.id) }
        let what: String = open.count == 1 ? open[0].label : "\(open.count) things running"
        if !open.isEmpty {
            Button {
                for t in open { center.cancel(t.id) }
            } label: {
                Text("cancel")
                    .font(Brand.mono(11, weight: .semibold))
                    .underline()
                    .foregroundStyle(palette.accentInk)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Cancel \(what)"))
        } else if !tasks.isEmpty {
            Text("cancelling…")
                .font(Brand.mono(11))
                .foregroundStyle(palette.faint)
        }
    }
}

#Preview("Edges") {
    let _ = TaskFixtures.seed()
    VStack(spacing: 18) {
        ZStack {
            Palette.darkroom.frame
            TaskEdge(scope: TaskFixtures.measuredScope)
        }
        .frame(width: 320, height: 180)
        .clipShape(RoundedRectangle(cornerRadius: Brand.paperRadius))
        ZStack {
            Palette.darkroom.frame
            TaskEdge(scope: TaskFixtures.sweepingScope)
        }
        .frame(width: 320, height: 180)
        .clipShape(RoundedRectangle(cornerRadius: Brand.paperRadius))
        HStack {
            Text("DJI_0202.JPG")
                .font(Brand.mono(11))
            TaskCancelLink(scope: TaskFixtures.measuredScope)
        }
    }
    .padding(24)
    .darkroom()
}
