// Where a remote document stands — one sentence, always the true one, and the
// buttons that state calls for. The native twin of the web's `SyncPill.tsx`:
// it reads the record `DocumentSync` writes, so every screen of a tool says
// the same thing, and every word is the kernel's (`pillText`, `pillLabel`,
// `pillNeedsAction`).
//
// A HEADER PILL, not a header row: a dot and — only where the state waits on
// the author (sign in, read-only, conflict, deleted) — one word, at every
// width, because a decision nobody is asked to make does not get made. A tap
// opens the sentence and its verbs in a popover (a popover on the phone too,
// never a sheet). "Take theirs" and "Delete here" drop something that cannot
// be recovered, so each is a two-step inside the popover, as on the web. The
// sentence is the pill's accessibility label, so VoiceOver reads the state
// whether or not the popover is up; on the Mac it is also the tooltip, where
// the web opened the panel on hover.
//
// `documentSyncLifecycle` is the web's "push on unmount / when the tab
// hides": leaving the screen or the foreground pushes what is dirty — on iOS
// inside a background task, so the request has the seconds it needs.

import SwiftUI
import AtelierKit
#if os(iOS)
import UIKit
#endif

struct SyncPill: View {
    let record: SyncRecord
    /// The host, as the pill prints it.
    let sourceLabel: String
    /// Where to sign in when the session there has ended.
    let loginUrl: String?
    var onSaveNow: () -> Void = {}
    /// Conflict: re-push over the server's copy.
    var onKeepMine: () -> Void = {}
    /// Conflict: replace the mirror with the server's copy, dropping local edits.
    var onTakeTheirs: () -> Void = {}
    /// Gone: keep the document on this device as a local one.
    var onKeepLocal: () -> Void = {}
    /// Gone: delete the mirror here too.
    var onDeleteHere: () -> Void = {}

    @Environment(\.palette) private var palette
    @State private var open = false
    @State private var confirming: Confirming?

    private enum Confirming { case theirs, delete }

    var body: some View {
        // A clock that ticks slowly, so "2 min ago" stays true without a
        // re-render per second.
        TimelineView(.periodic(from: .now, by: 30)) { context in
            trigger(pillText(record, sourceLabel: sourceLabel, now: context.date.timeIntervalSince1970 * 1000))
        }
    }

    private var needsAction: Bool { pillNeedsAction(record.status) }

    private var dotColor: Color {
        switch record.status {
        case .synced: return palette.ok
        case .dirty, .saving: return palette.warn
        case .offline: return palette.faint
        case .unauthenticated: return palette.accent
        case .forbidden, .conflict, .gone: return palette.danger
        }
    }

    @ViewBuilder
    private var dot: some View {
        let shape = Circle().fill(dotColor).frame(width: 7, height: 7)
        if record.status == .saving {
            shape.phaseAnimator([1.0, 0.3]) { view, phase in view.opacity(phase) }
        } else {
            shape
        }
    }

    private func trigger(_ text: String) -> some View {
        Button {
            confirming = nil
            open.toggle()
        } label: {
            HStack(spacing: 6) {
                dot
                if needsAction {
                    Text(pillLabel(record.status).uppercased())
                        .font(Brand.mono(11, weight: .medium))
                        .kerning(0.6)
                }
            }
            .foregroundStyle(needsAction ? palette.danger : palette.inkSoft)
            .padding(.horizontal, needsAction ? 10 : 0)
            .frame(minWidth: 34, minHeight: 34)
            .background(RoundedRectangle(cornerRadius: Brand.controlRadius).fill(palette.paper))
            .overlay(
                RoundedRectangle(cornerRadius: Brand.controlRadius)
                    .strokeBorder(needsAction ? palette.danger.opacity(0.45) : palette.lineStrong, lineWidth: 1)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(text)
        .help(text)
        .popover(isPresented: $open, arrowEdge: .bottom) {
            panel(text)
                .presentationCompactAdaptation(.popover)
        }
    }

    private func panel(_ text: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(text)
                .font(Brand.mono(12))
                .foregroundStyle(palette.muted)
                .fixedSize(horizontal: false, vertical: true)
            verbs
        }
        .padding(14)
        .frame(width: 300, alignment: .leading)
        .background(palette.surface)
    }

    @ViewBuilder
    private var verbs: some View {
        let status = record.status
        if record.canSaveNow || status == .unauthenticated || status == .conflict || status == .gone {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 14) {
                    if record.canSaveNow {
                        verb("Save now") { run(onSaveNow) }
                    }
                    if status == .unauthenticated, let loginUrl, let url = URL(string: loginUrl) {
                        Link(destination: url) { verbLabel("Sign in") }
                    }
                }
                if status == .unauthenticated {
                    Text("A new token goes in Sources → Reconnect.")
                        .font(Brand.sans(12))
                        .foregroundStyle(palette.faint)
                }
                if status == .conflict {
                    if confirming == .theirs {
                        confirm("drop the edits made here?", yes: "Yes, take theirs") { run(onTakeTheirs) }
                    } else {
                        HStack(spacing: 14) {
                            verb("Keep mine") { run(onKeepMine) }
                            verb("Take theirs") { confirming = .theirs }
                        }
                    }
                }
                if status == .gone {
                    if confirming == .delete {
                        confirm("delete it here too?", yes: "Yes, delete") { run(onDeleteHere) }
                    } else {
                        HStack(spacing: 14) {
                            verb("Keep here as local") { run(onKeepLocal) }
                            verb("Delete here") { confirming = .delete }
                        }
                    }
                }
            }
        }
    }

    /// A verb was used: the state it belonged to is over, so the popover goes.
    private func run(_ action: () -> Void) {
        open = false
        confirming = nil
        action()
    }

    private func verbLabel(_ title: String, danger: Bool = false) -> some View {
        Text(title)
            .font(Brand.sans(13, weight: .semibold))
            .underline()
            .foregroundStyle(danger ? palette.danger : palette.accentInk)
    }

    private func verb(_ title: String, danger: Bool = false, _ action: @escaping () -> Void) -> some View {
        Button(action: action) { verbLabel(title, danger: danger) }
            .buttonStyle(.plain)
    }

    private func confirm(_ question: String, yes: String, _ action: @escaping () -> Void) -> some View {
        HStack(spacing: 10) {
            Text(question)
                .font(Brand.mono(12))
                .foregroundStyle(palette.muted)
            verb(yes, danger: true, action)
            verb("No") { confirming = nil }
        }
    }
}

/// The pill for the document a `DocumentSync` is working for — nothing at
/// all for a document kept on this device.
struct DocumentSyncPill<D: StoredDocument>: View {
    let sync: DocumentSync<D>

    var body: some View {
        if sync.showsPill, let record = sync.record, let doc = sync.current() {
            let remote = sync.remote
            SyncPill(
                record: record,
                sourceLabel: remote?.label ?? doc.sourceId,
                loginUrl: remote?.client.loginUrl(),
                onSaveNow: { Task { await sync.saveNow() } },
                onKeepMine: { Task { await sync.keepMine() } },
                onTakeTheirs: { Task { await sync.takeTheirs() } },
                onKeepLocal: { sync.keepLocal() },
                onDeleteHere: { sync.deleteHere() }
            )
        }
    }
}

// MARK: - pushing on the way out

private struct DocumentSyncLifecycle<D: StoredDocument>: ViewModifier {
    let sync: DocumentSync<D>
    @Environment(\.scenePhase) private var scenePhase

    func body(content: Content) -> some View {
        content
            .onChange(of: scenePhase) { _, phase in
                if phase != .active { flushOnTheWayOut() }
            }
            .onDisappear { flushOnTheWayOut() }
    }

    /// Push what is dirty — best effort; the dirty record covers what does not land.
    @MainActor
    private func flushOnTheWayOut() {
        #if os(iOS)
        let box = BackgroundTaskBox()
        box.id = UIApplication.shared.beginBackgroundTask(withName: "Atelier: saving a \(D.noun)") {
            box.end()
        }
        Task { @MainActor in
            await sync.flushAll()
            box.end()
        }
        #else
        Task { @MainActor in await sync.flushAll() }
        #endif
    }
}

#if os(iOS)
/// The identifier of the seconds iOS grants a push after the app leaves the screen.
private final class BackgroundTaskBox: @unchecked Sendable {
    var id: UIBackgroundTaskIdentifier = .invalid

    /// Called on the main thread — by the expiration handler or after the push.
    func end() {
        MainActor.assumeIsolated {
            guard id != .invalid else { return }
            UIApplication.shared.endBackgroundTask(id)
            id = .invalid
        }
    }
}
#endif

extension View {
    /// Push the document's pending edit when this screen goes or the app
    /// leaves the foreground — the web's unmount and hidden-tab flushes.
    func documentSyncLifecycle<D: StoredDocument>(_ sync: DocumentSync<D>) -> some View {
        modifier(DocumentSyncLifecycle(sync: sync))
    }
}

// MARK: - previews

#Preview("Every state") {
    let now = nowMillis()
    let states: [SyncRecord] = [
        SyncRecord(id: "a", sourceId: "winnow.steeve.website", etag: "e1", syncedAt: now - 120_000, status: .synced),
        SyncRecord(id: "b", sourceId: "winnow.steeve.website", dirtyAt: now, status: .dirty),
        SyncRecord(id: "c", sourceId: "winnow.steeve.website", dirtyAt: now, status: .offline),
        SyncRecord(id: "d", sourceId: "winnow.steeve.website", dirtyAt: now, status: .unauthenticated),
        SyncRecord(id: "e", sourceId: "winnow.steeve.website", dirtyAt: now, status: .conflict,
                   theirs: TheirCopy(etag: "e9", updatedAt: "2026-09-26T12:02:00.000Z")),
        SyncRecord(id: "f", sourceId: "winnow.steeve.website", status: .gone),
    ]
    return HStack(spacing: 10) {
        ForEach(states, id: \.id) { record in
            SyncPill(record: record, sourceLabel: "winnow.steeve.website", loginUrl: "https://winnow.steeve.website/login")
        }
    }
    .padding(24)
}
