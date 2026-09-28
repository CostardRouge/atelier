// What is running, as one pill in the toolbar — the web's `TaskPill.tsx`, of
// the `SyncPill` family (`frontend.md`, «a status whose sentence nobody
// controls the length of»): a pulsing dot and one word, the list in a popover
// with a bar per task and a Cancel where the work can really stop. His pop-up
// without being a modal that blocks the screen: the reason he wanted a Cancel
// is to go on doing something else, and a modal forbids exactly that
// (`docs/progress-feedback.md` §4, question 1).
//
// Where: the web's masthead is the one row every screen keeps; here that row
// is the navigation bar (the Mac's window toolbar), so the pill is a toolbar
// item — `.taskPill()` on the root of every stack of the shell (`RootView`)
// and on a screen PUSHED over one that keeps its own bar (the Develop editor,
// an instrument opened from More). A sheet covers the bar: a sheet showing a
// media draws `TaskEdge` and `TaskCancelLink` on it instead (`tasks.md` T2).
//
// Draws nothing when nothing runs, and nothing under 400 ms — the toolbar
// item itself is left out, so no empty button waits in the bar. On a phone
// (a compact width) the word goes and the dot stays; the media's own edge is
// the surface a thumb reads there. The word is `Working`, `2 running`, or the
// whole's percentage where every task is measured (`overallProgress`).
//
// Native, not the web's: a tap toggles the popover (a popover on the phone
// too, never a sheet), and on the Mac the sentence is the tooltip where the
// web opened the panel on hover — the `SyncPill` precedent. A Cancel once
// pressed says "cancelling…" until the work reaches its safe point, and
// VoiceOver hears the sentence when a task appears or leaves, never on every
// percent. Under Reduce Motion the dot does not pulse.

import SwiftUI
import AtelierKit

struct TaskPill: View {
    /// Force the dot alone (true) or the word (false); nil follows the width.
    var compact: Bool?

    @Environment(\.palette) private var palette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    #endif
    @State private var open = false

    var body: some View {
        let tasks = TaskCenter.shared.visible
        ZStack {
            if !tasks.isEmpty {
                trigger(tasks)
            }
        }
        // The popover goes with the last task: a popover over nothing is a ghost.
        .onChange(of: tasks.isEmpty) { _, empty in
            if empty { open = false }
        }
        // Heard when the pill appears and when a task joins or leaves — never
        // on every percent.
        .onChange(of: tasks.map(\.id), initial: true) { _, _ in
            guard !tasks.isEmpty else { return }
            AccessibilityNotification.Announcement(tasksSentence(tasks)).post()
        }
    }

    private var dotAlone: Bool {
        if let compact { return compact }
        #if os(iOS)
        return sizeClass == .compact
        #else
        return false
        #endif
    }

    /// `Working`, `2 running`, or `42 %` — nil on a phone.
    private func word(_ tasks: [RunningTask]) -> String? {
        guard !dotAlone else { return nil }
        guard let whole = overallProgress(tasks) else { return pillWord(tasks) }
        return "\(Int((whole * 100).rounded())) %"
    }

    @ViewBuilder
    private var dot: some View {
        let shape = Circle().fill(palette.accent).frame(width: 7, height: 7)
        if reduceMotion {
            shape
        } else {
            shape.phaseAnimator([1.0, 0.4]) { view, phase in
                view.opacity(phase)
            } animation: { _ in
                .easeInOut(duration: 1)
            }
        }
    }

    private func trigger(_ tasks: [RunningTask]) -> some View {
        let sentence = tasksSentence(tasks)
        let said = word(tasks)
        return Button {
            open.toggle()
        } label: {
            HStack(spacing: 6) {
                dot
                if let said {
                    Text(said.uppercased())
                        .font(Brand.mono(11, weight: .medium))
                        .kerning(0.6)
                        .monospacedDigit()
                        .lineLimit(1)
                        .fixedSize()
                }
            }
            .foregroundStyle(palette.inkSoft)
            .padding(.horizontal, said == nil ? 0 : 10)
            .frame(minWidth: 34, minHeight: 34)
            .background(RoundedRectangle(cornerRadius: Brand.controlRadius).fill(palette.paper))
            .overlay(
                RoundedRectangle(cornerRadius: Brand.controlRadius)
                    .strokeBorder(open ? palette.accent : palette.lineStrong, lineWidth: 1)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(sentence)
        .accessibilityHint("Shows what is running")
        .help(sentence)
        .popover(isPresented: $open, arrowEdge: .bottom) {
            TaskList()
                .presentationCompactAdaptation(.popover)
        }
    }
}

/// The popover's list — each task's line, its bar, its second line and its
/// Cancel, oldest first. Read live, so a bar moves while it is open.
struct TaskList: View {
    @Environment(\.palette) private var palette

    /// The web's `w-[min(20rem, 100vw - 2rem)]`.
    static let width: CGFloat = 320
    /// Past this many rows the list scrolls rather than outgrowing the screen.
    private static let rowsBeforeScroll = 5

    var body: some View {
        let center = TaskCenter.shared
        let tasks = center.visible
        Group {
            if tasks.count > TaskList.rowsBeforeScroll {
                ScrollView { rows(tasks, center) }
                    .frame(height: 360)
            } else {
                rows(tasks, center)
            }
        }
        .frame(width: TaskList.width, alignment: .leading)
        .background(palette.surface)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("What is running")
    }

    private func rows(_ tasks: [RunningTask], _ center: TaskCenter) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            if tasks.isEmpty {
                Text("Nothing running")
                    .font(Brand.mono(11))
                    .foregroundStyle(palette.faint)
            }
            ForEach(tasks, id: \.id) { task in
                TaskRow(task: task, cancelling: center.cancelling.contains(task.id)) {
                    center.cancel(task.id)
                }
            }
        }
        .padding(12)
    }
}

/// One task in the list.
private struct TaskRow: View {
    let task: RunningTask
    let cancelling: Bool
    let onCancel: () -> Void

    @Environment(\.palette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text(task.label)
                    .font(Brand.mono(11))
                    .foregroundStyle(palette.ink)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .help(task.label)
                Spacer(minLength: 0)
                if let progress = task.progress {
                    Text("\(Int((progress * 100).rounded())) %")
                        .font(Brand.mono(11))
                        .monospacedDigit()
                        .foregroundStyle(palette.muted)
                        .fixedSize()
                }
            }
            TaskBar(tasks: [task])
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text(second)
                    .font(Brand.mono(11))
                    .foregroundStyle(palette.faint)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 0)
                stop
            }
        }
    }

    /// The detail, else what a sweep means.
    private var second: String {
        if let detail = task.detail { return detail }
        return task.progress == nil ? "no length to measure" : ""
    }

    /// Drawn only where the work can really stop: a button that does nothing
    /// is worse than no button.
    @ViewBuilder
    private var stop: some View {
        if task.cancel != nil {
            if cancelling {
                Text("cancelling…")
                    .font(Brand.mono(11))
                    .foregroundStyle(palette.faint)
                    .fixedSize()
            } else {
                Button(action: onCancel) {
                    Text("Cancel")
                        .font(Brand.sans(12, weight: .semibold))
                        .underline()
                        .foregroundStyle(palette.accentInk)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Cancel \(task.label)")
                .fixedSize()
            }
        }
    }
}

// MARK: - where the pill goes

extension View {
    /// The task pill in this screen's toolbar — the web's masthead pill. Put on
    /// the root of a navigation stack, and on a pushed screen that keeps its
    /// own bar. The item is left out while nothing is running.
    func taskPill() -> some View {
        modifier(TaskPillToolbar())
    }
}

private struct TaskPillToolbar: ViewModifier {
    func body(content: Content) -> some View {
        let running = TaskCenter.shared.anyVisible
        content.toolbar {
            if running {
                ToolbarItem(placement: TaskPillToolbar.placement) {
                    TaskPill()
                }
            }
        }
    }

    private static var placement: ToolbarItemPlacement {
        #if os(iOS)
        return .topBarTrailing
        #else
        return .automatic
        #endif
    }
}

#Preview("The pill and its list") {
    let _ = TaskFixtures.seed()
    NavigationStack {
        VStack(alignment: .leading, spacing: 24) {
            HStack(spacing: 12) {
                TaskPill(compact: false)
                TaskPill(compact: true)
            }
            TaskList()
                .clipShape(RoundedRectangle(cornerRadius: Brand.paperRadius))
        }
        .padding(24)
        .navigationTitle("Rolls")
        .taskPill()
    }
}
