// What every Stages screen shares — the leg tints and the told-days ramp as
// colours, the one way a leg edit reaches the trip, which instances the
// itinerary can be read from, the modal that is full-screen on a phone, and the
// small pieces (legend with its ⓘ, pill buttons, a wrapping row). The web
// keeps these in `StageRuler.tsx`, `StagesPanel.tsx`, `heatmap-ramp.ts`,
// `RoadTripTool.tsx` (`completeSources`, `deduceSources`, `handleApplied`) and
// `shared/ui/` (`SectionLegend`, `Button`).
//
// Rules kept (`roadtrip.md`, `frontend.md`):
// - Every leg edit goes through `TripsStore.change` — ONE funnel, one undo
//   step per gesture (edits inside 700 ms under one label merge; a drag seals
//   its step when it ends).
// - A leg's tint is the web's oklch, converted by the kernel
//   (`stageTintSrgb`), so the ruler here and the calendar there never
//   disagree about which leg is which colour.
// - The told-days ramp is five TOKENS (paper-2 → vermilion), night-aware:
//   bare paper is near-black at night, so a fixed hex would draw every untold
//   day as a bright tile.
// - The deduction reads every connected instance (a date range, not a
//   feature); the timeline reads only those `hasTimeline` offers — and that
//   switch is OFF (`timelineSyncEnabled`), so "From <instance>" draws nothing
//   today, exactly as on the web.
// - A modal is full-screen on a phone and a sheet elsewhere.

import SwiftUI
import AtelierKit

// MARK: - colours

enum StagesColor {
    /// A leg's tint, `index` its place in `trip.stages`.
    static func tint(_ index: Int) -> Color {
        let c = stageTintSrgb(index)
        return Color(.sRGB, red: c.red, green: c.green, blue: c.blue, opacity: 1)
    }

    /// The five rungs of a told day (`heatmap-ramp.ts`): nothing · drafted ·
    /// published once · twice · more. Rung 0 is the paper's own second tone.
    static func rung(_ level: Int, _ palette: Palette) -> Color {
        switch level {
        case ...0: return palette.paper2
        case 1: return Color(light: 0xF4CDBD, dark: 0x3F231B)
        case 2: return Color(light: 0xEB9878, dark: 0x7A3624)
        case 3: return Color(light: 0xE26A45, dark: 0xD4583A)
        default: return Color(light: 0xD9442A, dark: 0xEF5638)
        }
    }

    /// Each day's rung, from the trip's coverage — the grid's `levelOf`:
    /// 0 nothing told, 1 drafted only, 2 published once, 3 twice, 4 more.
    static func rungs(_ trip: TripDoc) -> [IsoDate: Int] {
        var out: [IsoDate: Int] = [:]
        for cell in tripCoverage(trip).days {
            if cell.posts.isEmpty {
                out[cell.date] = 0
            } else if cell.published == 0 {
                out[cell.date] = 1
            } else {
                out[cell.date] = min(2 + cell.published - 1, 4)
            }
        }
        return out
    }
}

// MARK: - the one write

enum StagesEdit {
    /// The legs rewritten, the trip stamped — the web's `setStages`. The same
    /// legs back is no write and no step.
    @MainActor
    static func write(_ store: TripsStore, _ tripId: String, _ stages: [TripStage]) {
        guard var doc = store.trip(tripId), store.open?.id == tripId, doc.stages != stages else { return }
        doc.stages = stages
        doc.updatedAt = nowMillis()
        store.change(doc, label: "trip")
    }

    /// One leg rewritten in place.
    @MainActor
    static func write(_ store: TripsStore, _ tripId: String, stage: TripStage) {
        guard let doc = store.trip(tripId) else { return }
        write(store, tripId, doc.stages.map { $0.id == stage.id ? stage : $0 })
    }

    /// A reconcile accepted: the whole trip back from the kernel
    /// (`applyTimelineDiff`), its dates perhaps grown. One step, sealed.
    @MainActor
    static func apply(_ store: TripsStore, _ applied: AppliedDiff) {
        store.change(applied.trip, label: "trip")
        store.sealHistory()
    }
}

// MARK: - where the itinerary can be read from

/// A reconcile sheet the Stages screens open.
enum StagesSheet: Identifiable, Equatable {
    /// Work the legs out from one position per day on this instance.
    case deduce(sourceId: String)
    /// Compare the legs with this instance's timeline.
    case complete(sourceId: String)

    var id: String {
        switch self {
        case .deduce(let s): return "deduce:\(s)"
        case .complete(let s): return "complete:\(s)"
        }
    }
}

extension ConnectionStore {
    /// Instances whose timeline can complete the legs (`hasTimeline`; the
    /// switch is off, so none today).
    var stagesTimelineSources: [String] {
        connections.filter { hasTimeline($0.capabilities) }.map(\.id)
    }

    /// Every connected instance can answer for a day's position: it is a date
    /// filter, not a feature. Nothing is asked until the button is pressed.
    var stagesDeduceSources: [String] {
        connections.map(\.id)
    }
}

// MARK: - the modal

private struct StagesModal<Item: Identifiable, Sheet: View>: ViewModifier {
    @Binding var item: Item?
    let content: (Item) -> Sheet
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    #endif

    @ViewBuilder
    func body(content base: Content) -> some View {
        #if os(iOS)
        if sizeClass == .compact {
            base.fullScreenCover(item: $item, content: content)
        } else {
            base.sheet(item: $item, content: content)
        }
        #else
        base.sheet(item: $item, content: content)
        #endif
    }
}

extension View {
    /// A modal the Stages screens open: full-screen on a phone, a sheet elsewhere.
    func stagesModal<Item: Identifiable, Sheet: View>(item: Binding<Item?>,
                                                      @ViewBuilder content: @escaping (Item) -> Sheet) -> some View {
        modifier(StagesModal(item: item, content: content))
    }
}

// MARK: - small pieces

/// The web's `Button` family, as the Stages screens use it.
struct StagesButtonStyle: ButtonStyle {
    enum Kind { case primary, plain, danger, ghost }
    var kind: Kind = .plain
    var small = false

    func makeBody(configuration: Configuration) -> some View {
        StagesButtonBody(configuration: configuration, kind: kind, small: small)
    }
}

private struct StagesButtonBody: View {
    let configuration: ButtonStyleConfiguration
    let kind: StagesButtonStyle.Kind
    let small: Bool
    @Environment(\.palette) private var palette
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        let pressed = configuration.isPressed
        configuration.label
            .font(Brand.sans(small ? 12 : 13, weight: .semibold))
            .lineLimit(1)
            .padding(.horizontal, small ? 10 : 13)
            .padding(.vertical, small ? 4 : 6)
            .foregroundStyle(foreground(pressed))
            .background(Capsule().fill(background(pressed)))
            .overlay(Capsule().strokeBorder(border(pressed), lineWidth: kind == .ghost ? 0 : 1))
            .opacity(isEnabled ? 1 : 0.45)
            .contentShape(Capsule())
    }

    private func foreground(_ pressed: Bool) -> Color {
        switch kind {
        case .primary: return palette.paper
        case .plain: return pressed ? palette.accentInk : palette.ink
        case .danger: return palette.danger
        case .ghost: return pressed ? palette.ink : palette.muted
        }
    }

    private func background(_ pressed: Bool) -> Color {
        switch kind {
        case .primary: return pressed ? palette.accent : palette.ink
        case .plain: return palette.surface
        case .danger: return pressed ? palette.danger.opacity(0.12) : .clear
        case .ghost: return pressed ? palette.paper2 : .clear
        }
    }

    private func border(_ pressed: Bool) -> Color {
        switch kind {
        case .primary: return pressed ? palette.accent : palette.ink
        case .plain: return pressed ? palette.accent : palette.lineStrong
        case .danger: return palette.danger.opacity(0.45)
        case .ghost: return .clear
        }
    }
}

/// A section's mono legend with its ⓘ — what a panel IS sits behind it, the
/// web's `SectionLegend` + `InfoDot`.
struct StagesLegend: View {
    let label: String
    var paragraphs: [String] = []
    @Environment(\.palette) private var palette
    @State private var open = false

    var body: some View {
        HStack(spacing: 6) {
            Text(label.uppercased())
                .font(Brand.mono(11, weight: .medium))
                .kerning(1.4)
                .foregroundStyle(palette.muted)
                .lineLimit(1)
                .truncationMode(.tail)
            if !paragraphs.isEmpty {
                Button {
                    open.toggle()
                } label: {
                    Image(systemName: "info.circle")
                        .font(.system(size: 12))
                        .foregroundStyle(open ? palette.accentInk : palette.faint)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("About \(label)")
                .popover(isPresented: $open, arrowEdge: .bottom) {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(Array(paragraphs.enumerated()), id: \.offset) { _, text in
                            Text(verbatim: text)
                                .font(Brand.sans(13))
                                .foregroundStyle(palette.inkSoft)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .padding(14)
                    .frame(idealWidth: 320, maxWidth: 360, alignment: .leading)
                    .background(palette.surface)
                    .presentationCompactAdaptation(.popover)
                }
            }
        }
    }
}

/// Children left to right, wrapping onto a new line when the row is full.
struct StagesFlow: Layout {
    var spacing: CGFloat = 6
    var lineSpacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let limit = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var line: CGFloat = 0
        var widest: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > limit {
                x = 0
                y += line + lineSpacing
                line = 0
            }
            x += size.width + spacing
            line = max(line, size.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: min(widest, limit), height: y + line)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var line: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX && x + size.width > bounds.maxX {
                x = bounds.minX
                y += line + lineSpacing
                line = 0
            }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            line = max(line, size.height)
        }
    }
}

/// A dismissable note — what the tool says after an accepted leg grew the trip.
struct StagesNote: View {
    let text: String
    let onDismiss: () -> Void
    @Environment(\.palette) private var palette

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(text)
                .font(Brand.sans(12))
                .foregroundStyle(palette.muted)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button(action: onDismiss) {
                Image(systemName: "xmark").font(.system(size: 11, weight: .semibold))
            }
            .buttonStyle(.plain)
            .foregroundStyle(palette.faint)
            .accessibilityLabel("Dismiss")
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .background(RoundedRectangle(cornerRadius: Brand.paperRadius).fill(palette.surface))
        .overlay(RoundedRectangle(cornerRadius: Brand.paperRadius).strokeBorder(palette.line, lineWidth: 1))
    }
}

/// A date on the trip's calendar, as a `Date` a picker takes: noon UTC, so no
/// zone the device sits in can move it a day.
enum StagesDate {
    static let utc = TimeZone(identifier: "UTC") ?? TimeZone(secondsFromGMT: 0)!

    static func date(_ iso: IsoDate) -> Date? {
        parseIsoDate(iso).map { Date(timeIntervalSince1970: $0 / 1000 + 12 * 3600) }
    }

    static func iso(_ date: Date) -> IsoDate {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = utc
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        let y = c.year ?? 1970
        let m = c.month ?? 1
        let d = c.day ?? 1
        return String(format: "%04d-%02d-%02d", y, m, d)
    }

    /// `lo...hi` when both are dates in order, else nil — a picker's range must
    /// never be built reversed, and a stored leg outside its trip is ordinary.
    static func range(_ lo: IsoDate, _ hi: IsoDate) -> ClosedRange<Date>? {
        guard let a = date(lo), let b = date(hi), a <= b else { return nil }
        return a...b
    }
}
