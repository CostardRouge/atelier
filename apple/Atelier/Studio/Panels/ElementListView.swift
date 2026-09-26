// The list of placed elements — port of `src/shared/overlay/ElementList.tsx`
// (the Studio's use of it: the legacy overlay page's add row retired with that
// page, the palette being how an element is added now).
//
// A row per element, in the deck's own order — the DRAW order, the last one
// on top: an eye that hides it, what it currently says (the value the stage
// draws at this cue, or a shape's name), a mono tag, and a remove. A tap
// selects; the host scrolls, outlines and edits the selection.
//
// The rules it keeps:
// - the remove is ALWAYS there on a touch screen, at a finger's size — a
//   hover-only × on a phone left no way to delete an element — and on the
//   Mac it shows on hover and on the selected row;
// - a hidden element reads struck through, never dropped from the list;
// - a text that says nothing reads `(empty)`, and a field with no value `—`,
//   never an invented reading (`OverlayPanels.listRow`).
//
// Native additions: a context menu repeating the row's verbs, and — only
// when the host passes `onMove` — Bring forward / Send backward, which move
// an element in the draw order (the web offers no reordering).

import SwiftUI
import AtelierKit

struct ElementListView: View {
    private let elements: [OverlayElement]
    private let selectedId: String?
    private let cue: Cue?
    private let timeShift: TimeShift?
    private let onSelect: (String) -> Void
    private let onRemove: (String) -> Void
    private let onToggleVisible: (String) -> Void
    private let onMove: ((IndexSet, Int) -> Void)?
    @Environment(\.palette) private var palette

    /// - Parameters:
    ///   - cue: the cue at the playhead, so each row previews its current value.
    ///   - timeShift: the project's capture-time correction, so rows read what the stage draws.
    ///   - onMove: SwiftUI's `move(fromOffsets:toOffset:)` arguments; nil hides the verbs.
    init(elements: [OverlayElement], selectedId: String?, cue: Cue?, timeShift: TimeShift? = nil,
         onSelect: @escaping (String) -> Void, onRemove: @escaping (String) -> Void,
         onToggleVisible: @escaping (String) -> Void, onMove: ((IndexSet, Int) -> Void)? = nil) {
        self.elements = elements
        self.selectedId = selectedId
        self.cue = cue
        self.timeShift = timeShift
        self.onSelect = onSelect
        self.onRemove = onRemove
        self.onToggleVisible = onToggleVisible
        self.onMove = onMove
    }

    var body: some View {
        if elements.isEmpty {
            Text("No elements yet. Add a telemetry field or text, then drag it onto the frame.")
                .font(Brand.sans(12))
                .foregroundStyle(palette.muted)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 4)
                .padding(.vertical, 12)
        } else {
            VStack(spacing: 2) {
                ForEach(elements.indices, id: \.self) { i in
                    ElementListRowView(
                        element: elements[i],
                        row: OverlayPanels.listRow(elements[i], cue, timeShift: timeShift),
                        active: elements[i].id == selectedId,
                        onSelect: onSelect,
                        onRemove: onRemove,
                        onToggleVisible: onToggleVisible,
                        forward: move(i, by: 1),
                        backward: move(i, by: -1)
                    )
                    // A host's `ScrollViewReader` scrolls the selection into view by id.
                    .id(elements[i].id)
                }
            }
        }
    }

    /// The row one step up or down the draw order, when the host takes moves
    /// and there is room.
    private func move(_ i: Int, by step: Int) -> (() -> Void)? {
        guard let onMove else { return nil }
        let target = i + step
        guard target >= 0, target < elements.count else { return nil }
        // `move(fromOffsets:toOffset:)` counts the destination before the removal.
        let destination = step > 0 ? i + 2 : i - 1
        return { onMove(IndexSet(integer: i), destination) }
    }
}

private struct ElementListRowView: View {
    let element: OverlayElement
    let row: OverlayPanels.ListRow
    let active: Bool
    let onSelect: (String) -> Void
    let onRemove: (String) -> Void
    let onToggleVisible: (String) -> Void
    let forward: (() -> Void)?
    let backward: (() -> Void)?

    @State var hovering = false
    @Environment(\.palette) private var palette

    private var showsRemove: Bool {
        #if os(iOS)
        return true
        #else
        return hovering || active
        #endif
    }

    var body: some View {
        HStack(spacing: 8) {
            Button {
                onToggleVisible(element.id)
            } label: {
                Image(systemName: element.visible ? "eye" : "eye.slash")
                    .font(Brand.sans(12))
                    .foregroundStyle(element.visible ? palette.inkSoft : palette.faint)
                    .frame(width: 22, height: 22)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help(element.visible ? "Hide" : "Show")
            .accessibilityLabel(element.visible ? "Hide element" : "Show element")

            Text(verbatim: row.preview)
                .font(Brand.sans(13))
                .foregroundStyle(element.visible ? palette.ink : palette.faint)
                .strikethrough(!element.visible, color: palette.faint)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
                .help(row.preview)

            Text(verbatim: row.tag.uppercased())
                .font(Brand.mono(9))
                .kerning(0.9)
                .foregroundStyle(palette.muted)
                .lineLimit(1)

            Button {
                onRemove(element.id)
            } label: {
                Image(systemName: "xmark")
                    .font(Brand.sans(11, weight: .semibold))
                    .foregroundStyle(palette.muted)
                    .frame(width: removeSide, height: removeSide)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .opacity(showsRemove ? 1 : 0)
            .allowsHitTesting(showsRemove)
            .help("Remove")
            .accessibilityLabel("Remove element")
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(background, in: RoundedRectangle(cornerRadius: 10))
        .contentShape(RoundedRectangle(cornerRadius: 10))
        .onTapGesture { onSelect(element.id) }
        .onHover { hovering = $0 }
        .accessibilityAddTraits(active ? .isSelected : [])
        .contextMenu { menu }
    }

    /// A finger's size on a phone, the pointer's on the Mac.
    private var removeSide: CGFloat {
        #if os(iOS)
        return 32
        #else
        return 18
        #endif
    }

    private var background: Color {
        if active { return palette.accentWash }
        return hovering ? palette.paper2 : Color.clear
    }

    @ViewBuilder
    private var menu: some View {
        Button(element.visible ? "Hide" : "Show") { onToggleVisible(element.id) }
        if forward != nil || backward != nil {
            Divider()
            if let forward {
                Button("Bring forward", action: forward)
            }
            if let backward {
                Button("Send backward", action: backward)
            }
        }
        Divider()
        Button("Remove", role: .destructive) { onRemove(element.id) }
    }
}

// MARK: - previews

private struct ElementListPreview: View {
    @State private var deck = OverlayPanelFixtures.deck
    @State private var selected: String? = "deck.tape"

    init() {}

    var body: some View {
        DevelopPreviewState(true) { _ in
            ElementListView(elements: deck, selectedId: selected, cue: OverlayPanelFixtures.cue,
                            onSelect: { selected = $0 },
                            onRemove: { id in deck.removeAll { $0.id == id } },
                            onToggleVisible: { id in
                                if let i = deck.firstIndex(where: { $0.id == id }) { deck[i].visible.toggle() }
                            },
                            onMove: { from, to in deck.move(fromOffsets: from, toOffset: to) })
        }
    }
}

#Preview("Element list") {
    ElementListPreview()
}

#Preview("Element list — empty") {
    DevelopPreviewState(true) { _ in
        ElementListView(elements: [], selectedId: nil, cue: nil, onSelect: { _ in }, onRemove: { _ in },
                        onToggleVisible: { _ in })
    }
}
