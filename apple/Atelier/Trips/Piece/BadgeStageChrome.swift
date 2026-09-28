// What the badge stage draws OVER the paint — editor chrome that never
// reaches a file, since the hook thumbnail is taken from the paint alone
// (`roadtrip.md`, «Two traps»: an outline on the paint would burn a dashed
// rectangle into every row of the list):
//
// - a collage's cells: a number on each, a slot where one is empty, the
//   selected one outlined;
// - a shade's centre being placed: its line (a band) or its point (a
//   radial), dashed, with a disc where the hand is;
// - the selection: the element's box as the paint measured it, or the
//   opener's rect as its variant reports it — the same dashes either way;
// - the Library drop: every cell a target while a picture is dragged over
//   the stage, the hovered one saying what the drop WILL do, then what it
//   became (the web's `DropZones.tsx`, its words the kernel's).

import SwiftUI
import UniformTypeIdentifiers
import AtelierKit

// MARK: - the chrome over the paint

struct BadgeStageChrome: View {
    let model: PieceEditorModel
    /// The stage box, in points.
    let size: CGSize
    @Environment(\.palette) private var palette

    var body: some View {
        Canvas { ctx, canvas in
            guard let frame = model.stage.frame, frame.size.width > 0 else { return }
            let k = Double(canvas.width) / frame.size.width
            if model.collage != nil { drawCells(ctx, frame, k, canvas) }
            drawShadeHandle(ctx, canvas)
            drawSelection(ctx, frame, k, canvas)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private func drawCells(_ ctx: GraphicsContext, _ frame: PieceStageFrame, _ k: Double, _ canvas: CGSize) {
        let short = Double(min(canvas.width, canvas.height))
        for (i, c) in frame.cells.enumerated() {
            let has = i == 0 ? model.leadSource != nil : (i < model.cellSources.count && model.cellSources[i] != nil)
            let isSelected = i == model.cellIndex && model.selectedId == nil
            let w = c.width * k
            let h = c.height * k
            var cell = ctx
            cell.translateBy(x: CGFloat((c.x + c.width / 2) * k), y: CGFloat((c.y + c.height / 2) * k))
            if c.rotation != 0 { cell.rotate(by: .degrees(c.rotation)) }
            let rect = CGRect(x: -w / 2, y: -h / 2, width: w, height: h)
            if !has { drawSlot(cell, rect, short) }
            if isSelected {
                cell.stroke(Path(rect), with: .color(palette.accent), lineWidth: CGFloat(max(2, short * 0.005)))
            }
            let r = CGFloat(max(9, short * 0.026))
            let centre = CGPoint(x: rect.minX + r * 1.3, y: rect.minY + r * 1.3)
            let disc = Path(ellipseIn: CGRect(x: centre.x - r, y: centre.y - r, width: 2 * r, height: 2 * r))
            cell.fill(disc, with: .color(isSelected ? palette.accent : palette.frame.opacity(0.66)))
            let number = Text("\(i + 1)").font(Brand.mono(r * 1.05, weight: .semibold)).foregroundColor(palette.onMedia)
            cell.draw(number, at: centre, anchor: .center)
        }
    }

    /// An empty cell: a wash, a dashed inset outline and a small landscape glyph.
    private func drawSlot(_ ctx: GraphicsContext, _ rect: CGRect, _ short: Double) {
        ctx.fill(Path(rect), with: .color(palette.muted.opacity(0.16)))
        let inset = CGFloat(short * 0.006)
        let dash = StrokeStyle(lineWidth: CGFloat(max(1, short * 0.003)), dash: [CGFloat(short * 0.012), CGFloat(short * 0.01)])
        ctx.stroke(Path(rect.insetBy(dx: inset, dy: inset)), with: .color(palette.faint.opacity(0.85)), style: dash)
        let u = Double(min(rect.width, rect.height)) * 0.14
        var glyph = Path()
        glyph.move(to: CGPoint(x: -u * 0.8, y: u * 0.5))
        glyph.addLine(to: CGPoint(x: -u * 0.2, y: -u * 0.15))
        glyph.addLine(to: CGPoint(x: u * 0.2, y: u * 0.25))
        glyph.addLine(to: CGPoint(x: u * 0.45, y: 0))
        glyph.addLine(to: CGPoint(x: u * 0.8, y: u * 0.5))
        ctx.stroke(glyph, with: .color(palette.faint.opacity(0.95)), lineWidth: CGFloat(max(1.2, u * 0.08)))
    }

    private func drawShadeHandle(_ ctx: GraphicsContext, _ canvas: CGSize) {
        guard let handle = model.shadeHandle else { return }
        let w = Double(canvas.width)
        let h = Double(canvas.height)
        let short = min(w, h)
        let hx = handle.x * w
        let hy = handle.y * h
        var line = Path()
        switch handle.axis {
        case .y:
            line.move(to: CGPoint(x: 0, y: hy))
            line.addLine(to: CGPoint(x: w, y: hy))
        case .x:
            line.move(to: CGPoint(x: hx, y: 0))
            line.addLine(to: CGPoint(x: hx, y: h))
        case .both:
            let r = short * 0.06
            line.move(to: CGPoint(x: hx - r, y: hy))
            line.addLine(to: CGPoint(x: hx + r, y: hy))
            line.move(to: CGPoint(x: hx, y: hy - r))
            line.addLine(to: CGPoint(x: hx, y: hy + r))
        }
        var shadowed = ctx
        shadowed.addFilter(.shadow(color: palette.frame.opacity(0.45), radius: CGFloat(short * 0.006)))
        let dash = StrokeStyle(lineWidth: CGFloat(max(1.5, short * 0.003)), dash: [CGFloat(short * 0.014), CGFloat(short * 0.01)])
        shadowed.stroke(line, with: .color(palette.onMedia.opacity(0.92)), style: dash)
        // A band's disc sits mid-frame on its own line.
        let r = max(7, short * 0.018)
        let dx = handle.axis == .y ? w / 2 : hx
        let dy = handle.axis == .x ? h / 2 : hy
        let disc = Path(ellipseIn: CGRect(x: dx - r, y: dy - r, width: 2 * r, height: 2 * r))
        shadowed.fill(disc, with: .color(palette.accent))
        ctx.stroke(disc, with: .color(palette.onMedia), lineWidth: CGFloat(max(1.5, r * 0.28)))
    }

    private func drawSelection(_ ctx: GraphicsContext, _ frame: PieceStageFrame, _ k: Double, _ canvas: CGSize) {
        guard let id = model.selectedId else { return }
        let box: AtelierKit.Rect?
        if id == PieceEditorModel.hookId {
            box = model.hookRect(frame.size)
        } else {
            box = OverlayGeometry.boxForId(frame.boxes, id).map { AtelierKit.Rect($0.x, $0.y, $0.w, $0.h) }
        }
        guard let box else { return }
        let rect = CGRect(x: box.x * k, y: box.y * k, width: box.width * k, height: box.height * k)
        let h = Double(canvas.height)
        let style = StrokeStyle(lineWidth: CGFloat(max(1.5, h * 0.003)), dash: [CGFloat(h * 0.012), CGFloat(h * 0.012)])
        ctx.stroke(Path(rect), with: .color(palette.accent), style: style)
    }
}

// MARK: - the stage's corner word, and "decoding…"

struct BadgeStageCaption: View {
    let caption: PieceStageCaption
    @Environment(\.palette) private var palette

    var body: some View {
        Text(caption.text)
            .font(Brand.mono(11))
            .monospacedDigit()
            .lineLimit(1)
            .truncationMode(.tail)
            .foregroundStyle(palette.onMedia.opacity(caption.tone == .muted ? 0.8 : 1))
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(Capsule().fill(fill))
            .padding(8)
            .allowsHitTesting(false)
            .accessibilityAddTraits(.updatesFrequently)
    }

    private var fill: Color {
        switch caption.tone {
        case .plain: return palette.frame.opacity(0.7)
        case .accent: return palette.accent
        case .muted: return palette.frame.opacity(0.55)
        }
    }
}

// MARK: - the Library drop

/// A drop's state as the stage reports it — the web's `DropState`.
@MainActor
@Observable
final class PieceDropState {
    /// What a drop became, for a moment.
    struct Settled: Equatable {
        var cell: Int
        var phase: DropPhase
        var reason: String?
    }

    /// A picture is dragged over the stage.
    var armed = false
    /// The zone under the pointer, while there is one.
    var over: Int?
    var settled: Settled?
    /// The picture being (or just) dropped, and where it is fetched from.
    var label = ""
    var source: String?
    @ObservationIgnored private var seq = 0
    @ObservationIgnored private var clearing: Task<Void, Never>?

    /// A drop let go on `cell`: a picture already in the pool lands at once,
    /// one an instance still holds is fetched first and the cell says so.
    func begin(cell: Int, label: String, source: String?, fetching: Bool) -> Int {
        seq += 1
        clearing?.cancel()
        self.label = label
        self.source = source
        settled = fetching ? Settled(cell: cell, phase: .fetching, reason: nil) : nil
        return seq
    }

    /// What the drop became: "Placed" for 1.1 s, or why not for 3.2 s.
    func finish(_ s: Int, cell: Int, _ result: PieceDropResult) {
        guard s == seq else { return }
        settled = Settled(cell: cell, phase: result.ok ? .placed : .failed, reason: result.reason)
        let hold: UInt64 = result.ok ? 1_100_000_000 : 3_200_000_000
        clearing = Task { [weak self] in
            try? await Task.sleep(nanoseconds: hold)
            guard let self, !Task.isCancelled, self.seq == s else { return }
            self.settled = nil
        }
    }

    var active: Bool { armed || settled != nil }
}

/// The stage's drop target: a picture from the Library lands on the cell
/// under it; BETWEEN cells the drop is refused, so the system shows its
/// no-drop badge and animates the picture back.
@MainActor
struct BadgeStageDrop: DropDelegate {
    let model: PieceEditorModel
    let state: PieceDropState
    /// The stage box, in points.
    let box: CGSize

    func validateDrop(info: DropInfo) -> Bool {
        !model.isCta && model.library != nil && info.hasItemsConforming(to: PieceDropReader.types)
    }

    func dropEntered(info: DropInfo) {
        state.armed = true
        state.over = cell(info.location)
    }

    func dropUpdated(info: DropInfo) -> DropProposal? {
        let i = cell(info.location)
        state.over = i
        return DropProposal(operation: i == nil ? .forbidden : .copy)
    }

    func dropExited(info: DropInfo) {
        state.armed = false
        state.over = nil
    }

    func performDrop(info: DropInfo) -> Bool {
        state.armed = false
        let i = cell(info.location)
        state.over = nil
        guard let i else { return false }
        // The item, not the transfer: it carries the picture's name and a way
        // to the file, where the transfer only carries a key — read through
        // the Library's own registry.
        let providers = info.itemProviders(for: PieceDropReader.types)
        let model = self.model
        let state = self.state
        Task { @MainActor in
            guard let item = await PieceDropReader.item(providers) else { return }
            let seq = state.begin(cell: i, label: item.label, source: item.sourceLabel,
                                  fetching: item.origin == .instance)
            let result = await model.dropAsset(i, item)
            state.finish(seq, cell: i, result)
        }
        return true
    }

    /// The cell under a point of the stage box: 0 on a slide without a
    /// collage, nil between two cells.
    private func cell(_ location: CGPoint) -> Int? {
        guard let frame = model.stage.frame, !frame.cells.isEmpty, box.width > 0 else { return 0 }
        let k = frame.size.width / Double(box.width)
        let i = cellAt(frame.cells, Double(location.x) * k, Double(location.y) * k)
        return i < 0 ? nil : i
    }
}

/// The drop targets over the stage while a picture is dragged onto it.
struct PieceDropZonesView: View {
    let zones: [DropZone]
    let state: PieceDropState
    let collage: Bool
    @Environment(\.palette) private var palette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack(alignment: .topLeading) {
            if state.active {
                ForEach(zones, id: \.index) { zone in
                    zoneView(zone)
                        .frame(width: CGFloat(zone.w), height: CGFloat(zone.h))
                        .rotationEffect(.degrees(zone.rotation))
                        .offset(x: CGFloat(zone.x), y: CGFloat(zone.y))
                }
            }
            if state.armed && state.over == nil && state.settled == nil {
                hint
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .allowsHitTesting(false)
        .onChange(of: announcement) { _, line in
            guard !line.isEmpty else { return }
            AccessibilityNotification.Announcement(line).post()
        }
    }

    // MARK: - one zone

    private func phase(_ zone: DropZone) -> DropPhase? {
        if let settled = state.settled { return settled.cell == zone.index ? settled.phase : nil }
        return state.over == zone.index ? .over : nil
    }

    @ViewBuilder
    private func zoneView(_ zone: DropZone) -> some View {
        let here = phase(zone)
        let dimmed = state.settled == nil && state.over != nil && state.over != zone.index
        ZStack {
            outline(here, dimmed: dimmed)
            if state.armed && here == nil {
                Image(systemName: "plus")
                    .font(.system(size: 17, weight: .medium))
                    .foregroundStyle(palette.onMedia)
                    .frame(width: 36, height: 36)
                    .background(Circle().fill(palette.frame.opacity(0.55)))
                    .overlay(Circle().stroke(palette.onMedia.opacity(0.6), lineWidth: 1))
                    .opacity(dimmed ? 0.4 : 0.9)
            }
            if here == .fetching {
                // The fetch has no length anyone can know: a sweep along the foot.
                VStack {
                    Spacer(minLength: 0)
                    PieceSweepBar()
                        .frame(height: 4)
                }
            }
            if let here { chipView(dropChip(chipInput(zone, here))) }
        }
    }

    @ViewBuilder
    private func outline(_ here: DropPhase?, dimmed: Bool) -> some View {
        let shape = RoundedRectangle(cornerRadius: 4)
        switch here {
        case .failed?:
            shape.fill(palette.danger.opacity(0.15)).overlay(shape.stroke(palette.danger, lineWidth: 2))
        case .fetching?:
            shape.fill(palette.frame.opacity(0.45)).overlay(shape.stroke(palette.accent, lineWidth: 2))
        case .placed?:
            shape.fill(palette.accent.opacity(0.1)).overlay(shape.stroke(palette.accent, lineWidth: 2))
        case .over?:
            shape.fill(palette.accent.opacity(0.25))
                .overlay(shape.stroke(palette.accent, lineWidth: 3))
                .shadow(color: palette.accent.opacity(0.3), radius: 4)
        case nil:
            if state.armed {
                shape.fill(palette.accent.opacity(0.15))
                    .overlay(shape.stroke(palette.onMedia, style: StrokeStyle(lineWidth: 2, dash: [6, 4])))
                    .opacity(dimmed ? 0.4 : 1)
            } else {
                Color.clear
            }
        }
    }

    private func chipInput(_ zone: DropZone, _ phase: DropPhase) -> DropChipInput {
        DropChipInput(phase: phase, zone: zone, collage: collage, label: state.label, source: state.source,
                      reason: state.settled?.reason)
    }

    private func chipView(_ chip: DropChip) -> some View {
        HStack(spacing: 6) {
            chipIcon(chip.icon)
            Text(chip.title).font(Brand.sans(12, weight: .semibold)).lineLimit(1)
            if let detail = chip.detail {
                Text(detail.uppercased())
                    .font(Brand.mono(9))
                    .kerning(0.8)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .opacity(0.75)
            }
        }
        .foregroundStyle(chipInk(chip.tone))
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Capsule().fill(chipFill(chip.tone)))
        .padding(8)
        .transition(reduceMotion ? .identity : .scale(scale: 0.9).combined(with: .opacity))
    }

    @ViewBuilder
    private func chipIcon(_ icon: DropChipIcon) -> some View {
        switch icon {
        case .wait:
            ProgressView().controlSize(.mini).tint(palette.onMedia)
        case .plus:
            Image(systemName: "plus").font(.system(size: 12, weight: .semibold))
        case .swap:
            Image(systemName: "arrow.left.arrow.right").font(.system(size: 12, weight: .semibold))
        case .check:
            Image(systemName: "checkmark").font(.system(size: 12, weight: .semibold))
        case .warning:
            Image(systemName: "exclamationmark.triangle").font(.system(size: 12, weight: .semibold))
        }
    }

    private func chipFill(_ tone: ChipTone) -> Color {
        switch tone {
        case .accent, .muted: return palette.frame
        case .ok: return palette.ok
        case .danger: return palette.danger
        }
    }

    private func chipInk(_ tone: ChipTone) -> Color {
        switch tone {
        case .accent, .muted: return palette.onMedia
        case .ok, .danger: return palette.paper
        }
    }

    // MARK: - the hint, and what a screen reader hears

    private var hint: some View {
        HStack(spacing: 6) {
            Image(systemName: "plus").font(.system(size: 11, weight: .semibold))
            Text(dropHint(collage: collage, cellCount: zones.count).uppercased())
                .font(Brand.mono(9))
                .kerning(1)
        }
        .foregroundStyle(palette.onMedia)
        .padding(.horizontal, 12)
        .padding(.vertical, 4)
        .background(Capsule().fill(palette.frame.opacity(0.85)))
        .frame(maxWidth: .infinity)
        .padding(.top, 8)
    }

    private var announcement: String {
        let zone: DropZone?
        let phase: DropPhase
        if let settled = state.settled {
            zone = zones.first { $0.index == settled.cell }
            phase = settled.phase
        } else if let over = state.over {
            zone = zones.first { $0.index == over }
            phase = .over
        } else {
            return ""
        }
        guard let zone else { return "" }
        return dropAnnouncement(chipInput(zone, phase))
    }
}

/// An indeterminate bar: a quarter of it crossing in 1.15 s — the suite's
/// `deck-load`. Reduce Motion: a still sliver in the MIDDLE, never at the
/// start, where it would read as a quarter done.
struct PieceSweepBar: View {
    @Environment(\.palette) private var palette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            ZStack(alignment: .leading) {
                Rectangle().fill(palette.onMedia.opacity(0.2))
                if reduceMotion {
                    Rectangle().fill(palette.accent).frame(width: w / 4).offset(x: w * 3 / 8)
                } else {
                    TimelineView(.animation(minimumInterval: 1.0 / 30)) { context in
                        let t = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1.15) / 1.15
                        Rectangle().fill(palette.accent).frame(width: w / 4).offset(x: (w * 1.25) * CGFloat(t) - w / 4)
                    }
                }
            }
        }
        .clipped()
        .allowsHitTesting(false)
    }
}

#Preview("Drop zones, caption, sweep") {
    let state: PieceDropState = {
        let s = PieceDropState()
        s.armed = true
        s.over = 1
        return s
    }()
    let cells = [
        CellRect(x: 0, y: 0, width: 180, height: 450, rotation: 0, mount: .none),
        CellRect(x: 180, y: 0, width: 180, height: 450, rotation: 0, mount: .none),
    ]
    let zones = dropZones(cells, canvasW: 360, cssW: 360, cssH: 450, holding: ["DJI_0101", nil])
    VStack(spacing: 16) {
        ZStack(alignment: .topLeading) {
            Color.gray
            PieceDropZonesView(zones: zones, state: state, collage: true)
            BadgeStageCaption(caption: PieceStageCaption(text: "Start · 1 of 3", tone: .accent))
        }
        .frame(width: 360, height: 450)
        PieceSweepBar().frame(width: 360, height: 4)
    }
    .padding(16)
    .darkroom()
}
