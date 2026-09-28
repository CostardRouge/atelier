// What a reconcile would do to a trip's legs, one tick per line — the native
// twin of the web's `StageDiffList.tsx`, shared by the timeline sheet and the
// deduction exactly as on the web.
//
// It is deliberately ignorant of where the legs came from: `diffTimeline`
// speaks one language whether a chapter was read off an instance's timeline
// or worked out from one position per day. A producer that wants to say more
// about a row hands in `noteFor`, and the list never learns what those words
// mean. The rules it keeps for both hosts live in the kernel
// (`StageScreens.swift`): a `dropped` row is never ticked by default, an
// already-linked `unchanged` row is shown INERT rather than hidden, and the
// pairing is named whenever it was not by id.

import SwiftUI
import AtelierKit

struct StageDiffListView: View {
    let entries: [DiffEntry]
    let ticked: Set<String>
    let onToggle: (String) -> Void
    /// A word the producer wants on a row, under its sentence.
    var noteFor: (DiffEntry) -> String? = { _ in nil }

    @Environment(\.palette) private var palette

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(entries.enumerated()), id: \.element.key) { index, entry in
                if index > 0 { Hairline() }
                row(entry)
            }
        }
        .padding(.horizontal, 12)
        .background(RoundedRectangle(cornerRadius: Brand.paperRadius).fill(palette.surface))
        .overlay(RoundedRectangle(cornerRadius: Brand.paperRadius).strokeBorder(palette.line, lineWidth: 1))
    }

    private func row(_ entry: DiffEntry) -> some View {
        let inert = isInertDiffEntry(entry)
        let on = !inert && ticked.contains(entry.key)
        let sentence = describeDiffEntry(entry)
        let note = noteFor(entry)
        let tag = Text(diffEntryTag(entry).uppercased())
            .font(Brand.mono(9, weight: .medium))
            .foregroundStyle(entry.kind == .dropped ? palette.danger : palette.muted)
        let said = Text(sentence)
            .font(Brand.sans(14))
            .foregroundStyle(inert ? palette.muted : palette.ink)
        return Button {
            onToggle(entry.key)
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Image(systemName: on ? "checkmark.square.fill" : "square")
                    .font(.system(size: 16))
                    .foregroundStyle(on ? palette.ink : palette.faint)
                VStack(alignment: .leading, spacing: 3) {
                    (tag + Text("  ") + said)
                        .fixedSize(horizontal: false, vertical: true)
                    if let note {
                        Text(note)
                            .font(Brand.mono(11))
                            .foregroundStyle(palette.warn)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.vertical, 9)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(inert)
        .accessibilityLabel(sentence)
        .accessibilityValue(on ? "ticked" : "not ticked")
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// Three rows of every kind, for the preview.
private enum StageDiffPreview {
    static var entries: [DiffEntry] {
        let trip = StagesFixtures.trip
        var seeded = createTripStage("", "", "2025-11-21", "2025-11-26", places: [createTripPlace("Broome")])
        seeded.origin = StageOrigin(sourceId: "winnow.example", chapterId: "c3", importedAt: 0)
        return [
            DiffEntry(key: "chapter:c1", kind: .add, incoming: seeded, existing: nil, matchedBy: nil, changes: []),
            DiffEntry(key: "chapter:c2", kind: .changed, incoming: seeded, existing: trip.stages[0], matchedBy: .span,
                      changes: [.name, .places]),
            DiffEntry(key: "stage:x", kind: .dropped, incoming: nil, existing: seeded, matchedBy: nil, changes: []),
        ]
    }
}

#Preview("Diff list") {
    StageDiffListView(entries: StageDiffPreview.entries, ticked: ["chapter:c1"], onToggle: { _ in },
                      noteFor: { $0.key == "chapter:c1" ? deduceDoubtNote : nil })
        .padding(16)
}
