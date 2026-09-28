// Several pictures in one slide's frame — the web's
// `src/tools/roadtrip/panels/LayoutSection.tsx` (`roadtrip.md`, «A slide
// holds SEVERAL pictures»): which layout, how the cells are spaced, what shows
// between them, and which cell the inspector is about.
//
// Rules kept:
// - CELL 1 IS THE SLIDE: its picture, framing and develop are the slide's own,
//   so "One picture" hands the frame back to the lead exactly as it was;
// - picking a layout never loses a picture — a smaller one KEEPS the extras
//   off-stage and says so ("Kept"), a bigger one brings them back;
// - each tile is drawn by the REAL solver (`resolveLayout`) at glyph size;
// - the cells are worked on the stage (tap, drag, hold to swap); the cell
//   stepper here is the keyboard's and VoiceOver's way to the same thing, and
//   the Library follows the SELECTED cell;
// - "Use the ticked picture" is disabled when the ticked picture is already
//   in that cell; the collage's own fetches are said in one line.

import SwiftUI
import AtelierKit

struct PieceLayoutSection: View {
    let model: PieceEditorModel
    @Environment(\.palette) private var palette

    /// The grounds a collage can sit on: the frame's black, the suite's
    /// papers, a sand, the accent — document values, written as the web writes them.
    static let backgrounds: [PieceCollageGround] = [
        PieceCollageGround(color: defaultCollageBackground, name: "Frame black"),
        PieceCollageGround(color: "#1b1813", name: "Ink"),
        PieceCollageGround(color: "#f4f0e7", name: "Paper"),
        PieceCollageGround(color: "#fbf8f1", name: "Surface"),
        PieceCollageGround(color: "#e9d7b0", name: "Sand"),
        PieceCollageGround(color: "#d9442a", name: "Vermilion"),
    ]

    private static let info = [
        "Several pictures in this slide's frame. This slide's own picture is always the first cell; the others are picked here or on the stage, and each keeps its own framing and develop.",
        "On the stage: tap a cell to select it, drag to reframe the picture inside it, hold (or Option-drag) to swap two cells. On a free layout a drag moves the print and Shift-drag reframes it.",
        "A picture can also be dragged straight from the Library onto the cell it belongs in — the cell lights up as you hover it. On a phone, use the cell stepper and “Use the ticked picture”.",
        "A smaller layout keeps the extra pictures rather than dropping them; an empty cell shows the background in the export.",
    ]

    private var collage: SlideCollage? { model.collage }

    var body: some View {
        let entry = collage.flatMap(collageEntry)
        let count = collage.map(collageCellCount) ?? 1
        let badge = entry.map { "\($0.name) · \(count)" }
        DevelopSection(id: "piece.layout", title: "Layout", badge: badge, info: Self.info, remember: .local,
                       actions: { oneAction }) {
            PieceLayoutShelf(current: collage?.template, onPick: pick)
            if let collage, let entry {
                if entry.template.kind != .free {
                    spacingSliders(collage)
                }
                behindRow(collage)
                PieceLayoutCellRow(model: model, count: count)
                if let summary = model.refetchSummary {
                    Text(summary)
                        .font(Brand.sans(12))
                        .foregroundStyle(palette.muted)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.updatesFrequently)
                }
                keptRow(collage)
            }
        }
    }

    @ViewBuilder
    private var oneAction: some View {
        if collage != nil {
            Button("One picture") { pick(nil) }
                .buttonStyle(DevelopLinkButtonStyle())
        }
    }

    /// Pick a layout, or nil for one picture — a cell past the new count
    /// hands the inspector back to the lead.
    private func pick(_ id: String?) {
        guard let id else {
            model.setCollage(nil)
            model.selectCell(0)
            return
        }
        let next: SlideCollage?
        if let collage {
            next = retemplateCollage(collage, id)
        } else {
            next = createCollage(id)
        }
        model.setCollage(next)
        if let next, model.cellIndex >= collageCellCount(next) { model.selectCell(0) }
    }

    // MARK: - spacing, ground

    @ViewBuilder
    private func spacingSliders(_ collage: SlideCollage) -> some View {
        let spacing = collage.spacing
        DevelopRangeSlider("Gap", value: spacing.gap, in: 0...0.06, step: 0.002, reset: defaultLayoutSpacing.gap,
                           printed: Self.percent(spacing.gap)) { v in
            write(collage) { $0.spacing.gap = v }
        }
        DevelopRangeSlider("Padding", value: spacing.padding, in: 0...0.1, step: 0.002,
                           reset: defaultLayoutSpacing.padding, printed: Self.percent(spacing.padding)) { v in
            write(collage) { $0.spacing.padding = v }
        }
        DevelopRangeSlider("Corners", value: spacing.radius, in: 0...0.08, step: 0.002,
                           reset: defaultLayoutSpacing.radius, printed: Self.percent(spacing.radius)) { v in
            write(collage) { $0.spacing.radius = v }
        }
    }

    private func behindRow(_ collage: SlideCollage) -> some View {
        OverlayPanelRow("Behind", hint: "Shows between the cells and in an empty one.") {
            HStack(spacing: 6) {
                ForEach(Self.backgrounds, id: \.color) { b in
                    swatch(b.color, b.name, on: collage.background.lowercased() == b.color.lowercased()) {
                        write(collage) { $0.background = b.color }
                    }
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Background")
        }
    }

    private func swatch(_ css: String, _ name: String, on: Bool, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            RoundedRectangle(cornerRadius: 7)
                .fill(Color(cgColor: CSSColor.parse(css) ?? CSSColor.black))
                .overlay(RoundedRectangle(cornerRadius: 7).stroke(palette.lineStrong, lineWidth: 1))
                .frame(width: 28, height: 28)
                .padding(2)
                .overlay(RoundedRectangle(cornerRadius: 9).stroke(on ? palette.accent : Color.clear, lineWidth: 2))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(name)
        .accessibilityLabel(name)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    // MARK: - kept pictures

    @ViewBuilder
    private func keptRow(_ collage: SlideCollage) -> some View {
        let kept = collageKept(collage)
        if !kept.isEmpty {
            OverlayPanelRow("Kept", hint: "Not drawn by this layout; a bigger one brings them back.", alignTop: true) {
                FlowChips(items: kept.map { "cell \($0.cell) · \($0.media.name)" })
            }
        }
    }

    private func write(_ collage: SlideCollage, _ change: (inout SlideCollage) -> Void) {
        var next = collage
        change(&next)
        model.setCollage(next)
    }

    /// `2.4%` — the web's `(v * 100).toFixed(1)%`.
    static func percent(_ v: Double) -> String {
        String(format: "%.1f%%", v * 100)
    }
}

/// A ground a collage can sit on, and its name.
struct PieceCollageGround: Hashable {
    let color: String
    let name: String
}

// MARK: - the shelf of layouts

/// "One" and every layout of the registry, grouped the way the picker shows
/// them, each tile drawn by the real solver.
struct PieceLayoutShelf: View {
    let current: String?
    let onPick: (String?) -> Void
    @Environment(\.palette) private var palette

    private static let columns = Array(repeating: GridItem(.flexible(), spacing: 6), count: 4)

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            LazyVGrid(columns: Self.columns, spacing: 6) {
                tile(label: "One", on: current == nil, help: "One picture") { onPick(nil) } glyph: {
                    PieceLayoutGlyph(entry: nil)
                }
            }
            ForEach(layoutGroups, id: \.self) { group in
                groupShelf(group)
            }
        }
    }

    private func groupShelf(_ group: LayoutGroup) -> some View {
        let entries = layoutTemplates.filter { $0.group == group }
        return VStack(alignment: .leading, spacing: 4) {
            Text(group.rawValue.uppercased())
                .font(Brand.mono(9))
                .kerning(0.8)
                .foregroundStyle(palette.muted)
            LazyVGrid(columns: Self.columns, spacing: 6) {
                ForEach(entries, id: \.id) { t in
                    let cells = resolveLayout(t.template, 9, 16).count
                    tile(label: t.name, on: current == t.id, help: "\(t.name) · \(cells) cells") { onPick(t.id) } glyph: {
                        PieceLayoutGlyph(entry: t)
                    }
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("\(group.rawValue) layouts")
        }
    }

    private func tile<Glyph: View>(label: String, on: Bool, help: String, _ action: @escaping () -> Void,
                                   @ViewBuilder glyph: () -> Glyph) -> some View {
        let shape = RoundedRectangle(cornerRadius: 10)
        return Button(action: action) {
            VStack(spacing: 4) {
                glyph()
                    .foregroundStyle(on ? palette.accent : palette.inkSoft)
                Text(label)
                    .font(Brand.sans(10))
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(on ? palette.ink : palette.inkSoft)
            }
            .padding(.horizontal, 4)
            .padding(.top, 6)
            .padding(.bottom, 4)
            .frame(maxWidth: .infinity)
            .background(shape.fill(on ? palette.accentWash : palette.paper))
            .overlay(shape.stroke(on ? palette.accent : palette.line, lineWidth: 1))
            .contentShape(shape)
        }
        .buttonStyle(.plain)
        .help(help)
        .accessibilityLabel(label)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// A template drawn as its cells, 26 × 46 — the same solver at glyph size;
/// nil draws the one-picture tile, the frame whole.
struct PieceLayoutGlyph: View {
    let entry: LayoutTemplateEntry?
    @Environment(\.palette) private var palette

    private static let w: CGFloat = 26
    private static let h: CGFloat = 46

    var body: some View {
        let cells = entry.map {
            resolveLayout($0.template, Double(Self.w), Double(Self.h), LayoutSpacing(gap: 0.1, padding: 0.1, radius: 0))
        }
        let ground = palette.line
        return Canvas { ctx, _ in
            let frame = CGRect(x: 0, y: 0, width: PieceLayoutGlyph.w, height: PieceLayoutGlyph.h)
            ctx.fill(Path(roundedRect: frame, cornerRadius: 3), with: .color(ground))
            guard let cells else {
                let whole = CGRect(x: 2.6, y: 4.6, width: 20.8, height: 36.8)
                ctx.fill(Path(roundedRect: whole, cornerRadius: 1.2), with: .foreground)
                return
            }
            for c in cells {
                var cell = ctx
                cell.opacity = 0.8
                let cx = CGFloat(c.x + c.width / 2)
                let cy = CGFloat(c.y + c.height / 2)
                cell.translateBy(x: cx, y: cy)
                cell.rotate(by: .degrees(c.rotation))
                let w = CGFloat(c.width)
                let h = CGFloat(c.height)
                let rect = CGRect(x: -w / 2, y: -h / 2, width: w, height: h)
                cell.fill(Path(roundedRect: rect, cornerRadius: 1.2), with: .foreground)
            }
        }
        .frame(width: Self.w, height: Self.h)
        .accessibilityHidden(true)
    }
}

// MARK: - the cell in hand

/// The cell stepper — "i of N", the cell's file, "Use the ticked picture" and
/// "Empty this cell" — with what became of the cell's picture under it.
struct PieceLayoutCellRow: View {
    let model: PieceEditorModel
    let count: Int
    @Environment(\.palette) private var palette

    var body: some View {
        let index = model.cellIndex
        let cell = model.cell
        let fileName = model.cellRef?.name ?? cell?.media?.name
        let active = model.library?.active
        let here = PieceLayoutCellRow.holds(cell, active)
        let hint = hintFor(index: index, cell: cell)
        OverlayPanelRow("Cell", hint: hint.text, tone: hint.problem ? .problem : .note, alignTop: true) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    step(-1, symbol: "chevron.left", label: "Previous cell", index: index)
                    Text("\(index + 1) of \(count)")
                        .font(Brand.mono(12))
                        .monospacedDigit()
                        .foregroundStyle(palette.inkSoft)
                        .fixedSize()
                    step(1, symbol: "chevron.right", label: "Next cell", index: index)
                    Text(fileName ?? "Empty")
                        .font(Brand.mono(11))
                        .foregroundStyle(model.cellRef != nil ? palette.inkSoft : palette.muted)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                HStack(spacing: 8) {
                    Button("Use the ticked picture") { model.useActiveInCell() }
                        .buttonStyle(DevelopPillButtonStyle())
                        .disabled(active == nil || here)
                        .help(active.map { "Put \($0.name) in this cell" } ?? "Tick a picture in the Library first")
                    Button("Empty this cell") { model.clearCell() }
                        .buttonStyle(DevelopLinkButtonStyle())
                        .disabled(cell?.media == nil)
                }
            }
        }
    }

    private func step(_ by: Int, symbol: String, label: String, index: Int) -> some View {
        Button {
            model.selectCell((index + count + by) % max(1, count))
        } label: {
            Image(systemName: symbol)
                .font(Brand.sans(11, weight: .semibold))
                .frame(width: 14, height: 14)
        }
        .buttonStyle(DevelopPillButtonStyle())
        .disabled(count < 2)
        .accessibilityLabel(label)
    }

    /// The ticked picture is already in this cell — "Use the ticked picture" would do nothing.
    private static func holds(_ cell: CollageCell?, _ active: SavedMediaRef?) -> Bool {
        guard let active, let media = cell?.media else { return false }
        return media.name.lowercased() == active.name.lowercased()
    }

    /// What the row says under the cell: its own fetch, else which cell the Library follows.
    private func hintFor(index: Int, cell: CollageCell?) -> (text: String, problem: Bool) {
        if let fetch = model.collageRecovery(cell?.media) {
            if fetch.state == .fetching {
                return ("This cell’s picture lives on \(fetch.sourceId) — fetching it back…", false)
            }
            return (fetch.problem ?? "It could not be fetched back.", true)
        }
        if index == 0 { return ("The first cell is this slide’s own picture — the Library follows it.", false) }
        return ("The Library follows the selected cell: tick a picture there to put it here.", false)
    }
}

/// Small mono chips that wrap — the Kept pictures.
private struct FlowChips: View {
    let items: [String]
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(items, id: \.self) { item in
                Text(item)
                    .font(Brand.mono(10))
                    .foregroundStyle(palette.inkSoft)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Capsule().fill(palette.paper2))
                    .overlay(Capsule().stroke(palette.line, lineWidth: 1))
            }
        }
    }
}

#Preview("Layout shelf") {
    DevelopPreviewState(Optional("grid-2x2")) { current in
        PieceLayoutShelf(current: current.wrappedValue) { current.wrappedValue = $0 }
    }
}

#Preview("Layout section") {
    DevelopPreviewState(0) { _ in
        PieceLayoutSection(model: PieceEditorFixtures.model())
    }
}
