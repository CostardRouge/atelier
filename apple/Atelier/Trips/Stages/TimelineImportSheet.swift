// Seed a trip from a Winnow timeline, or complete one — the native twin of the
// web's `TimelineImportPanel.tsx`: two screens over ONE piece of arithmetic
// (the kernel's `TimelineImport.swift`).
//
// Rules kept (`roadtrip.md`, «A Winnow timeline chapter and a Road Trip stage
// are the same object reached from two ends»; `docs/winnow-timeline.md`):
// - Both show exactly what they will do and do nothing until the person says
//   so. A seed lists the legs (every one ticked, or a link's preselection when
//   it names real legs), the span, the days no leg covers and every chapter it
//   could not use; a completion lists what the timeline gained, renamed, moved
//   or lost, each line a tick — adds and changes ticked, a drop NEVER.
// - No post is ever created; nothing the author wrote is overwritten
//   silently.
// - ONE request, on open: the chapters. A timeline is metadata.
// - A timeline link names a HOST the shell resolves, never a URL it fetches:
//   this sheet takes the instance's id and finds its connection.
// - Seeded, the trip wears the bundled HOUSE STYLE (when the app bundles it)
//   and is kept on this device, like one made by hand.
//
// Behind the kernel's `timelineSyncEnabled`, which is OFF: the Stages screens
// offer "From <instance>" only where `hasTimeline` says so, so today this sheet
// is reached by no button — exactly the web's state.

import SwiftUI
import AtelierKit

/// What the sheet is for.
enum TimelineImportMode: Equatable {
    /// A new trip, narrowed to the legs a link named (empty = all).
    case seed(preselect: [String])
    /// Reconcile the timeline into a trip that exists.
    case complete(tripId: String)
}

struct TimelineImportSheet: View {
    let store: TripsStore
    let sourceId: String
    let mode: TimelineImportMode
    /// A seeded trip was written here: open it.
    var onSeeded: (TripDoc) -> Void = { _ in }
    /// A completion was applied: the trip, and whether its dates grew.
    var onApplied: (TripDoc, Bool) -> Void = { _, _ in }
    /// The sheet is done, either way.
    let onClose: () -> Void

    @Environment(ConnectionStore.self) private var connections
    @Environment(\.palette) private var palette
    @State private var chapters: [WinnowChapter]?
    @State private var problem: StageReadProblem?
    @State private var name = ""
    @State private var selected: Set<String>?
    @State private var accepted: Set<String>?
    /// The import, read once per change of what goes in — its ids and its
    /// stamp are minted there, never per render.
    @State private var imported: TimelineImport?
    @State private var entries: [DiffEntry] = []

    private var connection: WinnowConnection? { connections.connection(sourceId) }
    private var offered: Bool { hasTimeline(connection?.capabilities) }
    private var isSeed: Bool {
        if case .seed = mode { return true }
        return false
    }

    var body: some View {
        let title = isSeed ? "New trip from \(sourceId)" : "Complete from \(sourceId)"
        let lede = isSeed
            ? "The timeline’s legs become the trip’s stages — its span, its places. No post is created: the grid stays yours to fill."
            : "What the timeline has that the trip does not, and the reverse. Nothing you wrote changes unless you tick it."
        StagesSheetFrame(title: title, lede: lede, onCancel: onClose) {
            content
            warnings
        } verb: {
            if isSeed {
                Button("Create trip", action: seed)
                    .buttonStyle(StagesButtonStyle(kind: .primary))
                    .keyboardShortcut(.defaultAction)
                    .disabled(!canSeed)
            } else {
                let n = tickedActionableCount(entries, ticked)
                Button(n > 0 ? "Apply \(n)" : "Apply", action: apply)
                    .buttonStyle(StagesButtonStyle(kind: .primary))
                    .keyboardShortcut(.defaultAction)
                    .disabled(!canApply)
            }
        }
        .task(id: sourceId) { await load() }
        .onChange(of: selected) { _, _ in recompute() }
        .onChange(of: chapters) { _, _ in recompute() }
    }

    // MARK: - the body

    @ViewBuilder
    private var content: some View {
        if !offered {
            muted("\(sourceId) has no timeline yet. Reconnect it once it does, and this screen will list its legs.")
        } else if let problem {
            problemView(problem)
        } else if let chapters {
            if chapters.isEmpty {
                muted("The timeline has no chapter yet.")
            } else if isSeed {
                seedBody(chapters)
            } else {
                completeBody
            }
        } else {
            Text("asking \(sourceId)…")
                .font(Brand.mono(12))
                .foregroundStyle(palette.muted)
        }
    }

    private func seedBody(_ chapters: [WinnowChapter]) -> some View {
        let picked = pickedSet(chapters)
        let all = picked.count == chapters.count
        return VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Eyebrow("legs · \(picked.count) of \(chapters.count)")
                    Button(all ? "none" : "all") {
                        selected = all ? [] : Set(chapters.map(\.id))
                    }
                    .buttonStyle(.plain)
                    .font(Brand.mono(10, weight: .medium))
                    .foregroundStyle(palette.muted)
                }
                VStack(spacing: 0) {
                    ForEach(Array(chapters.enumerated()), id: \.element.id) { index, chapter in
                        if index > 0 { Hairline() }
                        chapterRow(chapter, on: picked.contains(chapter.id), picked: picked)
                    }
                }
                .padding(.horizontal, 12)
                .background(RoundedRectangle(cornerRadius: Brand.paperRadius).fill(palette.surface))
                .overlay(RoundedRectangle(cornerRadius: Brand.paperRadius).strokeBorder(palette.line, lineWidth: 1))
            }
            if let imported {
                summary(imported)
            }
            VStack(alignment: .leading, spacing: 6) {
                Eyebrow("Name")
                TextField("Name", text: $name, prompt: Text("Australie"))
                    .textFieldStyle(.roundedBorder)
                    .font(Brand.sans(16))
                    .onSubmit { if canSeed { seed() } }
                Text("Short — it is what a badge says over the picture.")
                    .font(Brand.sans(11))
                    .foregroundStyle(palette.faint)
            }
        }
    }

    private func chapterRow(_ chapter: WinnowChapter, on: Bool, picked: Set<String>) -> some View {
        Button {
            var next = picked
            if next.contains(chapter.id) { next.remove(chapter.id) } else { next.insert(chapter.id) }
            selected = next
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Image(systemName: on ? "checkmark.square.fill" : "square")
                    .font(.system(size: 16))
                    .foregroundStyle(on ? palette.ink : palette.faint)
                VStack(alignment: .leading, spacing: 2) {
                    Text(timelineChapterName(chapter))
                        .font(Brand.sans(14, weight: .medium))
                        .foregroundStyle(palette.ink)
                        .lineLimit(1)
                    Text(timelineChapterLine(chapter))
                        .font(Brand.mono(11))
                        .monospacedDigit()
                        .foregroundStyle(palette.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Include \(timelineChapterName(chapter))")
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    /// What will be created — the real numbers, or why none.
    @ViewBuilder
    private func summary(_ imported: TimelineImport) -> some View {
        if let span = imported.span {
            let n = imported.stages.count
            let count = Text("\(n) stage\(n == 1 ? "" : "s")").font(Brand.sans(14, weight: .semibold))
            let destination = imported.destination.isEmpty ? "" : " · \(imported.destination)"
            let rest = Text(" · " + diffSpanText(span.startDate, span.endDate) + destination).font(Brand.sans(14))
            VStack(alignment: .leading, spacing: 6) {
                (count + rest)
                    .foregroundStyle(palette.ink)
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(imported.stages, id: \.id) { stage in
                        let label = stageLabel(stage)
                        let when = diffSpanText(stage.startDate, stage.endDate)
                        let what = label.isEmpty ? "no place — the badge will count the day of the trip" : label
                        Text(what + " · " + when)
                            .font(Brand.sans(12))
                            .italic(label.isEmpty)
                            .foregroundStyle(palette.muted)
                    }
                }
                .padding(.leading, 14)
                if let uncovered = uncoveredSentence(imported) {
                    Text(uncovered)
                        .font(Brand.sans(12))
                        .foregroundStyle(palette.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        } else {
            muted("No dated leg is ticked — there is no span to make a trip from.")
        }
    }

    @ViewBuilder
    private var completeBody: some View {
        if actionableDiffEntries(entries).isEmpty {
            muted(alreadyMatchesSentence(entries.count, deduced: false))
        } else {
            StageDiffListView(entries: entries, ticked: ticked) { key in
                var next = ticked
                if next.contains(key) { next.remove(key) } else { next.insert(key) }
                accepted = next
            }
        }
    }

    @ViewBuilder
    private var warnings: some View {
        let list = imported?.warnings ?? []
        if !list.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(list.enumerated()), id: \.offset) { _, warning in
                    Text("•  \(warning.message)")
                        .font(Brand.sans(12))
                        .foregroundStyle(palette.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private func muted(_ text: String) -> some View {
        Text(text)
            .font(Brand.sans(14))
            .foregroundStyle(palette.muted)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func problemView(_ problem: StageReadProblem) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(deviceWords(problem.text))
                .font(Brand.sans(14))
                .foregroundStyle(palette.danger)
                .fixedSize(horizontal: false, vertical: true)
            if let login = problem.loginUrl, let url = URL(string: login) {
                Link("Sign in there", destination: url)
                    .font(Brand.sans(14, weight: .semibold))
                    .underline()
                    .foregroundStyle(palette.danger)
            }
        }
    }

    // MARK: - the arithmetic, held

    private func pickedSet(_ chapters: [WinnowChapter]) -> Set<String> {
        if let selected { return selected }
        if case .seed(let preselect) = mode { return seedPreselection(chapters, preselect) }
        return Set(chapters.map(\.id))
    }

    private var ticked: Set<String> {
        accepted ?? defaultAcceptedDiff(entries)
    }

    private var canSeed: Bool {
        imported?.span != nil && !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var canApply: Bool {
        !entries.isEmpty && tickedActionableCount(entries, ticked) > 0
    }

    private func recompute() {
        guard let chapters else {
            imported = nil
            entries = []
            return
        }
        let input: [WinnowChapter]
        if isSeed {
            let picked = pickedSet(chapters)
            input = chapters.filter { picked.contains($0.id) }
        } else {
            input = chapters
        }
        let next = importTimeline(input, ImportOptions(sourceId: sourceId, importedAt: nowMillis()))
        imported = next
        if case .complete(let tripId) = mode, let trip = store.trip(tripId) {
            entries = diffTimeline(trip, next, sourceId)
        } else {
            entries = []
        }
    }

    // MARK: - the one request

    private func load() async {
        guard offered else { return }
        guard let connection else {
            problem = StageReadProblem(text: "\(sourceId) is not connected on this device.")
            return
        }
        chapters = nil
        problem = nil
        let client = connections.client(for: connection)
        do {
            let list = try await TaskCenter.tracked("Reading \(sourceId)’s timeline") {
                try await client.timeline()
            }
            chapters = list
        } catch is CancellationError {
            return
        } catch {
            problem = timelineReadProblem(error, client)
        }
    }

    // MARK: - the verbs

    private func seed() {
        guard canSeed, let imported, let doc = tripFromTimeline(name, imported) else { return }
        let styled = applyHouseStyle(doc, TripsShell.houseStyle)
        _ = store.documents.put(styled)
        store.reload()
        onSeeded(styled)
        onClose()
    }

    private func apply() {
        guard canApply, case .complete(let tripId) = mode, let trip = store.trip(tripId) else { return }
        let result = applyTimelineDiff(trip, entries, ticked)
        StagesEdit.apply(store, result)
        onApplied(result.trip, result.spanWidened)
        onClose()
    }
}

#Preview("Timeline — seed") {
    StagesPreviewHost { store, _ in
        TimelineImportSheet(store: store, sourceId: "winnow.example", mode: .seed(preselect: []), onClose: {})
    }
}
