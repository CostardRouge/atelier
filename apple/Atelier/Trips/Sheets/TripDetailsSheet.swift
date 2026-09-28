// Naming a trip is naming its SPAN — the web's `TripDetailsModal.tsx`, the
// one sheet that creates a trip and, afterwards, edits its dates.
//
// The two dates are what every later badge counts from ("day 27 / 310"), so
// the length is echoed back live — a mistyped year is invisible as a date and
// obvious as "3 862 days". It asks for the dates and nothing else: a trip's
// places belong to its legs, drawn on the calendar once it exists (the
// maintainer, 2026-09-22), and a form must not ask what the tool is about to
// ask again, better.
//
// The SAME sheet edits the span afterwards (`init(trip:store:…)`), rather
// than a second screen asking the same question in another order. What
// editing adds is the consequences, said BEFORE they happen — a shorter span
// trims the legs it still covers, drops the ones it no longer reaches, and
// can leave a piece outside the calendar (kept, never moved: `spanImpact`).
// Editing also carries the COVER, a property of the trip like its dates (the
// maintainer's call). What editing deliberately does not show: the name
// (renamed in place on the overview's heading) and where the trip is kept (a
// move is the gallery's verb).
//
// Creating shows the "Keep on" picker only when there is a choice, and the
// "or seed it from" row only when a Winnow can seed — both hidden rather than
// drawn empty, so the sheet does not grow for a choice that does not exist.
// Return saves from any field, Escape cancels, as the web's dialog keys do.

import SwiftUI
import AtelierKit

/// What the sheet hands back — the web's `TripDetails`.
struct TripDetails: Equatable {
    var name: String
    var startDate: IsoDate
    var endDate: IsoDate
    /// Where the trip is kept — this device, or a connected instance. Creation only.
    var sourceId: String
    /// How the trip shows itself in the gallery. Editing only; pins already pruned.
    var cover: TripCover
}

/// A connected Winnow the sheet may offer as a seed — the web's
/// `TimelineSourceOption`.
struct TripSeedSource: Equatable, Identifiable {
    var id: String
    /// False on an instance with no timeline yet: offered greyed, with the reason.
    var hasTimeline: Bool
}

struct TripDetailsSheet: View {
    /// The trip being edited; nil creates one.
    private let trip: TripDoc?
    /// The editing trip's store — where its hooks are read for the cover panel.
    private let store: TripsStore?
    /// The sources that can hold a trip; with ONE the picker is not drawn.
    private let sources: [SourceInfo]
    /// The Winnows that can seed a trip; empty hides the row entirely.
    private let seedSources: [TripSeedSource]
    private let onSeedFrom: ((String) -> Void)?
    let onCancel: () -> Void
    let onSubmit: (TripDetails) -> Void

    @Environment(\.palette) private var palette
    @State private var name: String
    @State private var cover: TripCover
    @State private var sourceId: String
    /// `""` until a date is picked — the web's empty field.
    @State private var startDate: IsoDate
    @State private var endDate: IsoDate
    @State private var infoOpen = false
    @FocusState private var nameFocused: Bool

    /// Creating a trip.
    init(sources: [SourceInfo], seedSources: [TripSeedSource] = [], onSeedFrom: ((String) -> Void)? = nil,
         onCancel: @escaping () -> Void, onSubmit: @escaping (TripDetails) -> Void) {
        trip = nil
        store = nil
        self.sources = sources
        self.seedSources = seedSources
        self.onSeedFrom = onSeedFrom
        self.onCancel = onCancel
        self.onSubmit = onSubmit
        _name = State(initialValue: "")
        _cover = State(initialValue: defaultTripCover())
        let local = sources.contains { $0.id == defaultSourceId }
        _sourceId = State(initialValue: local ? defaultSourceId : (sources.first?.id ?? defaultSourceId))
        _startDate = State(initialValue: "")
        _endDate = State(initialValue: todayIso(Date(), in: .current))
    }

    /// Editing a trip's dates and its cover.
    init(trip: TripDoc, store: TripsStore, onCancel: @escaping () -> Void,
         onSubmit: @escaping (TripDetails) -> Void) {
        self.trip = trip
        self.store = store
        sources = []
        seedSources = []
        onSeedFrom = nil
        self.onCancel = onCancel
        self.onSubmit = onSubmit
        _name = State(initialValue: trip.name)
        _cover = State(initialValue: trip.cover)
        _sourceId = State(initialValue: trip.sourceId)
        _startDate = State(initialValue: trip.startDate)
        _endDate = State(initialValue: trip.endDate)
    }

    private var editing: Bool { trip != nil }

    private var problem: String? { spanProblem(startDate, endDate) }

    private var length: Int? { problem == nil ? spanLength(startDate, endDate) : nil }

    private var canSubmit: Bool {
        problem == nil && (editing || !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }

    /// What the new span would do to the legs and pieces already in the trip —
    /// only when it actually moved: the normal case has nothing to say.
    private var impact: SpanImpact? {
        guard let trip, problem == nil else { return nil }
        if startDate == trip.startDate && endDate == trip.endDate { return nil }
        let next = spanImpact(trip, startDate, endDate)
        return hasImpact(next) ? next : nil
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    intro
                    if !editing, !seedSources.isEmpty, let onSeedFrom {
                        seedRow(onSeedFrom)
                    }
                    if !editing {
                        field("Name") {
                            TextField("Australie", text: $name)
                                .font(Brand.sans(16))
                                .textFieldStyle(.roundedBorder)
                                .focused($nameFocused)
                                .onSubmit(submit)
                            hint("Short — it is what a badge says over the picture.")
                        }
                    }
                    dates
                    if !editing && sources.count > 1 {
                        keepOn
                    }
                    spanLine
                    if let impact {
                        impactNote(impact)
                    }
                    if let trip, let store {
                        field("Cover") {
                            TripCoverPanel(trip: trip, cover: $cover, thumbs: store.thumbs, version: store.thumbsVersion)
                        }
                    }
                }
                .padding(24)
            }
            .background(palette.surface)
            .navigationTitle(editing ? "Trip dates" : "New trip")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onCancel)
                        .keyboardShortcut(.cancelAction)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(editing ? "Save" : "Create trip", action: submit)
                        .keyboardShortcut(.defaultAction)
                        .disabled(!canSubmit)
                }
            }
        }
        .onAppear {
            if !editing { nameFocused = true }
        }
        #if os(macOS)
        .frame(minWidth: 480, minHeight: editing ? 620 : 460)
        #endif
    }

    // MARK: - the parts

    private var intro: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Text("All of it stays editable.")
                    .font(Brand.sans(14))
                    .foregroundStyle(palette.muted)
                DevelopInfoDot(about: "the dates", isOpen: $infoOpen)
            }
            if infoOpen {
                DevelopNote(paragraphs: introParagraphs)
            }
        }
    }

    private var introParagraphs: [String] {
        var out = ["The dates are what every badge counts from — “day 27”, “515 days ago” are measured off them."]
        if editing { out.append("Legs follow them; pieces are never moved.") }
        out.append("Where the trip went is its legs’ business, on the calendar.")
        return out
    }

    /// A connected Winnow can seed the trip from its timeline — the legs, the
    /// span, the places — instead of two dates typed by hand.
    private func seedRow(_ seed: @escaping (String) -> Void) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                Text("or seed it from")
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.muted)
                ForEach(seedSources) { source in
                    Button(source.id) { seed(source.id) }
                        .buttonStyle(DevelopPillButtonStyle())
                        .disabled(!source.hasTimeline)
                        .help(source.hasTimeline
                              ? "Create the trip from \(source.id)'s timeline"
                              : "\(source.id) has no timeline yet")
                }
            }
        }
    }

    /// One date per line on a phone: two date pickers side by side do not
    /// fit a narrow sheet.
    private var dates: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: 16) {
                startField
                endField
            }
            VStack(alignment: .leading, spacing: 16) {
                startField
                endField
            }
        }
    }

    private var startField: some View {
        field("Left on") {
            TripDateField(label: "Left on", value: $startDate, min: nil, max: endDate.isEmpty ? nil : endDate)
        }
    }

    private var endField: some View {
        field("Came back") {
            TripDateField(label: "Came back", value: $endDate, min: startDate.isEmpty ? nil : startDate, max: nil)
        }
    }

    /// Only when there is a choice. A remote trip is pushed the moment it is
    /// created — one gesture, one request.
    private var keepOn: some View {
        field("Keep on") {
            Picker("Keep on", selection: $sourceId) {
                ForEach(sources, id: \.id) { source in
                    Text(source.id == defaultSourceId ? "this device (local)" : source.label).tag(source.id)
                }
            }
            .labelsHidden()
            .pickerStyle(.menu)
            hint(sourceId == defaultSourceId
                 ? "Stays on this device. Export a file to move it elsewhere."
                 : "Saved to \(sourceId) as you edit, so it resumes from another device.")
        }
    }

    private var spanLine: some View {
        let text: String
        if let problem {
            text = problem
        } else if let length {
            text = "\(length) day\(length == 1 ? "" : "s") — badges will read “day n / \(length)”."
        } else {
            text = "Pick both dates."
        }
        return Text(text)
            .font(Brand.sans(12))
            .foregroundStyle(problem != nil ? palette.danger : palette.muted)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(problem != nil ? .updatesFrequently : [])
    }

    /// Said BEFORE saving, never after: a trip told over a year must not lose
    /// a leg silently. Pieces are only hidden, never deleted.
    private func impactNote(_ impact: SpanImpact) -> some View {
        var parts: [String] = []
        if impact.droppedStages > 0 {
            let one = impact.droppedStages == 1
            parts.append("\(impact.droppedStages) leg\(one ? "" : "s") fall\(one ? "s" : "") outside these dates and will be removed")
        }
        if impact.trimmedStages > 0 {
            let one = impact.trimmedStages == 1
            parts.append("\(impact.trimmedStages) leg\(one ? "" : "s") will be trimmed to fit")
        }
        if impact.strandedPosts > 0 {
            let one = impact.strandedPosts == 1
            parts.append("\(impact.strandedPosts) piece\(one ? "" : "s") would sit outside the trip — kept, but no longer on the calendar")
        }
        return Text(parts.joined(separator: " · ") + ".")
            .font(Brand.sans(12))
            .foregroundStyle(palette.accentInk)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(palette.accentWash, in: RoundedRectangle(cornerRadius: Brand.controlRadius))
            .overlay(RoundedRectangle(cornerRadius: Brand.controlRadius).stroke(palette.accent, lineWidth: 1))
    }

    private func field<Content: View>(_ label: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Eyebrow(label)
            content()
        }
    }

    private func hint(_ text: String) -> some View {
        Text(text)
            .font(Brand.sans(11))
            .foregroundStyle(palette.faint)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func submit() {
        guard canSubmit else { return }
        onSubmit(TripDetails(
            name: name,
            startDate: startDate,
            endDate: endDate,
            sourceId: sourceId,
            cover: trip.map { prunePins($0, cover) } ?? cover
        ))
    }
}

/// A calendar day picked natively — the web's `DateField`. An `IsoDate` is a
/// day on the wall, not an instant: it is shown and read through the user's
/// own calendar at noon (so no zone offset or summer-time change can move it
/// a day), and written back as `YYYY-MM-DD`. An empty value is a button that
/// picks the nearest allowed day, the web's empty field — never a date
/// invented without a gesture.
struct TripDateField: View {
    let label: String
    @Binding var value: IsoDate
    let min: IsoDate?
    let max: IsoDate?
    @Environment(\.palette) private var palette

    var body: some View {
        if let date = TripDateField.localDate(value) {
            DatePicker(label, selection: Binding(get: { date }, set: { value = TripDateField.isoDate($0) }),
                       in: range, displayedComponents: .date)
                .labelsHidden()
                .accessibilityLabel(label)
                .accessibilityValue(formatIsoDate(value))
        } else {
            Button("Pick a date") {
                value = max ?? min ?? todayIso(Date(), in: .current)
            }
            .buttonStyle(DevelopPillButtonStyle())
            .accessibilityLabel("\(label): pick a date")
        }
    }

    private var range: ClosedRange<Date> {
        let lower = min.flatMap(TripDateField.localDate) ?? Date.distantPast
        let upper = max.flatMap(TripDateField.localDate) ?? Date.distantFuture
        return lower <= upper ? lower...upper : upper...upper
    }

    /// `YYYY-MM-DD` at noon on the user's calendar, or nil when it is not a date.
    static func localDate(_ iso: IsoDate) -> Date? {
        guard let f = isoDateFields(iso) else { return nil }
        var parts = DateComponents()
        parts.year = f.year
        parts.month = f.month
        parts.day = f.day
        parts.hour = 12
        return Calendar.current.date(from: parts)
    }

    /// The day `date` falls on, on the user's calendar.
    static func isoDate(_ date: Date) -> IsoDate {
        let parts = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 1970, parts.month ?? 1, parts.day ?? 1)
    }
}

// MARK: - the answer, written

extension TripsStore {
    /// The dates sheet's answer written to the OPEN trip — the web overview's
    /// `saveDetails`: the new span with its legs brought inside it
    /// (`applyTripDetails`), the cover as the sheet pruned it, stamped, one
    /// undo step. Nil when no trip is open. The open DAY is the caller's to
    /// move: it may no longer be in the trip.
    @discardableResult
    func saveDetails(_ details: TripDetails, now: Double = nowMillis()) -> TripDoc? {
        guard let trip = open else { return nil }
        var next = applyTripDetails(trip, TripDetailsEdit(startDate: details.startDate, endDate: details.endDate))
        next.cover = details.cover
        next.updatedAt = now
        change(next)
        return next
    }
}

#Preview("New trip") {
    TripDetailsSheet(sources: [], onCancel: {}, onSubmit: { _ in })
}

#Preview("Trip dates") {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("atelier-preview")
    let store = TripsStore(root: root, connections: ConnectionStore.shared)
    var trip = createTripDoc("Australie", "2025-03-01", "2025-05-30")
    trip.stages = [createTripStage("Perth → Broome", "WA", "2025-03-01", "2025-03-20")]
    return TripDetailsSheet(trip: trip, store: store, onCancel: {}, onSubmit: { _ in })
}
