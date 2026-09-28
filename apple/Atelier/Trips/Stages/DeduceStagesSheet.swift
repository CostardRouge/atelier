// Work the trip's legs out from one position per day, and offer them — the
// native twin of the web's `DeduceStagesPanel.tsx`.
//
// Rules kept (`roadtrip.md`, «The itinerary is DEDUCED from one position per
// day»):
// - ONE request, on open: `geo?by=day` over the trip's own span answers the
//   whole question, declared gaps included. Moving a setting recomputes from
//   the days already read and never asks the instance again.
// - The chain is the kernel's, untouched: `readDayTrack` → `segmentTrack` →
//   `trackChapters` (named from the committed city index, offline) →
//   `importTimeline` → `diffTimeline`. The rows are the timeline sheet's own
//   (`StageDiffListView`).
// - The producer's doubt is SAID and held back: a short stop, or a leg resting
//   only on guessed positions, is left unticked with the reason under it.
// - The settings are this DEVICE's (UserDefaults, the web's `localStorage`
//   key and clamps), never the trip's; a new setting is a new set of legs, so
//   the ticks fall back to their defaults.
// - Nothing changes until something is ticked and accepted; no post is ever
//   created; an accepted leg past the trip's dates grows them, and the host
//   says so.
// - Not behind the timeline switch: it reads a date range, like the day view.

import SwiftUI
import AtelierKit

struct DeduceStagesSheet: View {
    let store: TripsStore
    let tripId: String
    let sourceId: String
    /// Accepted: the trip, and whether its dates grew.
    var onApplied: (TripDoc, Bool) -> Void = { _, _ in }
    let onClose: () -> Void

    @Environment(ConnectionStore.self) private var connections
    @Environment(\.palette) private var palette
    @AppStorage(deduceSettingsKey) private var stored = ""
    @State private var track: DayTrack?
    @State private var cities: [GazetteerCity]?
    @State private var problem: StageReadProblem?
    @State private var accepted: Set<String>?
    @State private var entries: [DiffEntry] = []
    @State private var held: Set<String> = []

    private var options: SegmentOptions { readDeduceSettings(JSONValue.parse(stored)) }

    var body: some View {
        let n = tickedActionableCount(entries, ticked)
        StagesSheetFrame(
            title: "Deduce the itinerary from \(sourceId)",
            lede: "One position per day is enough to work the legs out — no picture is fetched. Nothing changes until you tick it, and no post is ever created.",
            onCancel: onClose
        ) {
            content
        } verb: {
            Button(n > 0 ? "Accept \(n)" : "Accept", action: apply)
                .buttonStyle(StagesButtonStyle(kind: .primary))
                .keyboardShortcut(.defaultAction)
                .disabled(!(entries.count > 0 && n > 0))
        }
        .task(id: sourceId) { await load() }
        .onChange(of: stored) { _, _ in
            accepted = nil
            recompute()
        }
        .onChange(of: track) { _, _ in recompute() }
        .onChange(of: cities) { _, _ in recompute() }
    }

    @ViewBuilder
    private var content: some View {
        if let problem {
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
        } else if let track, let cities, let trip = store.trip(tripId) {
            let total = spanLength(trip.startDate, trip.endDate) ?? 0
            Text(deduceSummary(totalDays: total, placed: track.points.count, blind: track.blind.count,
                               hasCities: !cities.isEmpty))
                .font(Brand.mono(12))
                .monospacedDigit()
                .foregroundStyle(palette.muted)
                .fixedSize(horizontal: false, vertical: true)
            settings
            proposals(placed: track.points.count)
        } else {
            Text("asking \(sourceId)…")
                .font(Brand.mono(12))
                .foregroundStyle(palette.muted)
        }
    }

    private var settings: some View {
        let o = options
        let radius = Binding<Double>(get: { o.radiusKm }, set: { v in change { $0.radiusKm = v } })
        let nights = Binding<Double>(get: { Double(o.minNights) }, set: { v in change { $0.minNights = Int(v.rounded()) } })
        let short = Binding<ShortLegs>(get: { o.shortLegs }, set: { v in change { $0.shortLegs = v } })
        let bridge = Binding<Bool>(get: { o.bridgeBlind }, set: { v in change { $0.bridgeBlind = v } })
        let invent = Binding<Bool>(get: { o.interpolateMoves }, set: { v in change { $0.interpolateMoves = v } })
        return VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                valueRow("Radius of one halt", "\(TripDaysText.number(o.radiusKm)) km")
                Slider(value: radius, in: 5...120, step: 5)
                    .accessibilityLabel("Radius of one halt")
                    .accessibilityValue("\(TripDaysText.number(o.radiusKm)) km")
                note("Two days this close are the same place. Beyond it, you drove.")
            }
            VStack(alignment: .leading, spacing: 4) {
                valueRow("A halt is at least", "\(o.minNights) day\(o.minNights == 1 ? "" : "s")")
                Slider(value: nights, in: 1...6, step: 1)
                    .accessibilityLabel("A halt is at least")
                    .accessibilityValue("\(o.minNights) day\(o.minNights == 1 ? "" : "s")")
            }
            VStack(alignment: .leading, spacing: 6) {
                Eyebrow("Shorter than that")
                Picker("What to do with a short halt", selection: short) {
                    Text("List it").tag(ShortLegs.list)
                    Text("Fold it in").tag(ShortLegs.merge)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            }
            toggle(bridge, "Cover a blind day between two days in one place", "Nothing invented — a leg is a span.")
            toggle(invent, "Invent the days of a move", "A guess between two places — off, and what it makes is marked.")
        }
    }

    @ViewBuilder
    private func proposals(placed: Int) -> some View {
        if entries.isEmpty {
            muted(deduceEmptySentence(placed: placed))
        } else if actionableDiffEntries(entries).isEmpty {
            muted(alreadyMatchesSentence(entries.count, deduced: true))
        } else {
            StageDiffListView(entries: entries, ticked: ticked, onToggle: { key in
                var next = ticked
                if next.contains(key) { next.remove(key) } else { next.insert(key) }
                accepted = next
            }, noteFor: { entry in held.contains(entry.key) ? deduceDoubtNote : nil })
        }
    }

    // MARK: - small pieces

    private func valueRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Eyebrow(label)
            Spacer()
            Text(value)
                .font(Brand.mono(12))
                .monospacedDigit()
                .foregroundStyle(palette.accentInk)
        }
    }

    private func note(_ text: String) -> some View {
        Text(text)
            .font(Brand.sans(11))
            .foregroundStyle(palette.faint)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func muted(_ text: String) -> some View {
        Text(text)
            .font(Brand.sans(14))
            .foregroundStyle(palette.muted)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func toggle(_ value: Binding<Bool>, _ title: String, _ hint: String) -> some View {
        Toggle(isOn: value) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(Brand.sans(14))
                    .foregroundStyle(palette.ink)
                note(hint)
            }
        }
        .toggleStyle(.switch)
    }

    // MARK: - the arithmetic, held

    private var ticked: Set<String> {
        accepted ?? defaultAcceptedDiff(entries, holdBack: held)
    }

    private func change(_ edit: (inout SegmentOptions) -> Void) {
        var next = options
        edit(&next)
        stored = deduceSettingsJSON(next).serialized()
    }

    /// ONE pass over the days: the proposals, and the producer's own doubt
    /// about some of them — deriving the two apart is how the marks and the
    /// rows start disagreeing.
    private func recompute() {
        guard let track, let cities, let trip = store.trip(tripId) else {
            entries = []
            held = []
            return
        }
        let legs = segmentTrack(track.points, options).legs
        let proposed = trackChapters(legs, cities)
        let imported = importTimeline(chaptersOf(proposed), ImportOptions(sourceId: sourceId, importedAt: nowMillis()))
        entries = diffTimeline(trip, imported, sourceId)
        held = deduceHeldKeys(proposed)
    }

    // MARK: - the one request

    private func load() async {
        guard let trip = store.trip(tripId) else { return }
        guard let connection = connections.connection(sourceId) else {
            problem = StageReadProblem(text: "\(sourceId) is not connected on this device.")
            return
        }
        track = nil
        problem = nil
        let client = connections.client(for: connection)
        let span = DaySpan(from: trip.startDate, to: trip.endDate)
        // The index comes with it and is allowed to fail: a leg with no name
        // still has its dates. Read off the main thread — it is 6 MB of JSON.
        async let index: [GazetteerCity] = Task.detached(priority: .userInitiated) { PlaceIndex.cities ?? [] }.value
        do {
            let days = try await TaskCenter.tracked("Reading where each day was on \(sourceId)") {
                try await client.geoDays(span)
            }
            track = readDayTrack(days.map(geoDayRow))
        } catch is CancellationError {
            return
        } catch {
            problem = geoDaysReadProblem(error, client)
        }
        cities = await index
    }

    private func apply() {
        guard let trip = store.trip(tripId) else { return }
        let n = tickedActionableCount(entries, ticked)
        guard !entries.isEmpty, n > 0 else { return }
        let result = applyTimelineDiff(trip, entries, ticked)
        StagesEdit.apply(store, result)
        onApplied(result.trip, result.spanWidened)
        onClose()
    }
}

/// A day as the instance answered it, handed to the kernel's reader in the
/// wire's own shape — `readDayTrack` takes rows, the client hands them typed.
private func geoDayRow(_ day: WinnowGeoDay) -> JSONValue {
    var o: [String: JSONValue] = [
        "date": .string(day.date),
        "count": .number(Double(day.count)),
        "measured": .number(Double(day.measured)),
    ]
    o["lat"] = day.lat.map(JSONValue.number) ?? .null
    o["lon"] = day.lon.map(JSONValue.number) ?? .null
    o["source"] = day.source.map { JSONValue.string($0.rawValue) } ?? .null
    return .object(o)
}

/// `${n}` for a setting read back: a whole number prints without `.0`.
private enum TripDaysText {
    static func number(_ x: Double) -> String {
        x == x.rounded() && abs(x) < 1e15 ? String(Int64(x)) : String(x)
    }
}

#Preview("Deduce") {
    StagesPreviewHost { store, _ in
        DeduceStagesSheet(store: store, tripId: StagesFixtures.trip.id, sourceId: "winnow.example", onClose: {})
    }
}
