// The places one leg went through, in the order they were lived — the native
// twin of the web's `PlacesEditor.tsx`.
//
// Rules kept (`roadtrip.md`, «A Road Trip stage is a LEG carrying an ORDERED
// list of located places»):
// - The first and the last place ARE the leg's start and end: there is no
//   second pair of fields, because a second copy of a fact is a second thing
//   to keep in sync.
// - A row of chips read left to right with the badge's own `→` between them,
//   so it reads as the route it is; ONE chip is open at a time, its fields
//   underneath; a fresh chip focuses its name.
// - A chip is dragged to reorder, and — drag being unreachable by keyboard —
//   a focused chip also moves with ← / →.
// - A region left empty is the leg's own (shown as the placeholder); a place's
//   coordinates are shown with a `forget`, and a delete takes two presses.
// - Looking a place up online is OPT-IN (`PlaceSearchFieldView`); a place
//   typed by hand, with no coordinates, is a complete place.

import SwiftUI
import AtelierKit

struct PlacesEditorView: View {
    let store: TripsStore
    let tripId: String
    let stageId: String

    @Environment(\.palette) private var palette
    @State private var openId: String?
    /// The chip just added: its name field takes the focus.
    @State private var fresh: String?
    @State private var dropping: Int?

    var body: some View {
        if let stage = store.trip(tripId)?.stages.first(where: { $0.id == stageId }) {
            editor(stage)
        }
    }

    private func editor(_ stage: TripStage) -> some View {
        let places = stage.places
        let open = places.firstIndex { $0.id == openId }
        return VStack(alignment: .leading, spacing: 8) {
            StagesFlow(spacing: 6, lineSpacing: 6) {
                ForEach(Array(places.enumerated()), id: \.element.id) { index, place in
                    HStack(spacing: 6) {
                        if index > 0 {
                            Text(placeArrow)
                                .font(Brand.mono(12))
                                .foregroundStyle(palette.faint)
                                .accessibilityHidden(true)
                        }
                        chip(place, index, stage)
                    }
                }
                Button {
                    add(stage)
                } label: {
                    Text("+ Place")
                        .font(Brand.sans(12))
                        .foregroundStyle(palette.muted)
                        .padding(.horizontal, 10)
                        .frame(height: 30)
                        .overlay(Capsule().strokeBorder(palette.lineStrong, style: StrokeStyle(lineWidth: 1, dash: [3, 3])))
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Places of this stage, in the order they were lived")
            if let open {
                PlaceFieldsView(
                    stage: stage,
                    place: places[open],
                    index: open,
                    autoFocus: places[open].id == fresh,
                    onChange: { next in write(stage) { list in list = list.map { $0.id == next.id ? next : $0 } } },
                    onDelete: {
                        let gone = places[open].id
                        write(stage) { list in list.removeAll { $0.id == gone } }
                        store.sealHistory()
                        openId = nil
                    }
                )
                .id(places[open].id)
            }
        }
    }

    private func chip(_ place: TripPlace, _ index: Int, _ stage: TripStage) -> some View {
        let isOpen = place.id == openId
        let name = place.name.trimmingCharacters(in: .whitespacesAndNewlines)
        let isDropping = dropping == index
        let border: Color = isDropping || isOpen ? palette.accent : palette.lineStrong
        let fill: Color = isDropping ? palette.paper : (isOpen ? palette.accentWash : palette.surface)
        let stroke = StrokeStyle(lineWidth: 1, dash: isDropping ? [3, 3] : [])
        return Button {
            openId = isOpen ? nil : place.id
        } label: {
            HStack(spacing: 6) {
                Text("⠿")
                    .font(Brand.mono(12))
                    .foregroundStyle(palette.faint)
                    .accessibilityHidden(true)
                Text(name.isEmpty ? "Unnamed" : name)
                    .font(Brand.sans(12, weight: isOpen ? .semibold : .regular))
                    .italic(name.isEmpty)
                    .foregroundStyle(isOpen ? palette.accentInk : (name.isEmpty ? palette.muted : palette.ink))
                    .lineLimit(1)
            }
            .padding(.leading, 8)
            .padding(.trailing, 10)
            .frame(height: 30)
            .background(Capsule().fill(fill))
            .overlay(Capsule().strokeBorder(border, style: stroke))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .draggable(place.id) {
            Text(name.isEmpty ? "Unnamed" : name)
                .font(Brand.sans(12))
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(Capsule().fill(palette.surface))
        }
        .dropDestination(for: String.self) { items, _ in
            dropping = nil
            guard let id = items.first, let from = stage.places.firstIndex(where: { $0.id == id }) else { return false }
            move(stage, from, index)
            return true
        } isTargeted: { inside in
            dropping = inside ? index : (dropping == index ? nil : dropping)
        }
        .onKeyPress(keys: [.leftArrow, .rightArrow]) { press in
            let mods = press.modifiers
            if mods.contains(.command) || mods.contains(.control) || mods.contains(.option) { return .ignored }
            move(stage, index, press.key == .leftArrow ? index - 1 : index + 1)
            return .handled
        }
        .accessibilityLabel(name.isEmpty ? "Unnamed place" : name)
        .accessibilityHint("Drag it, or move it with the arrow keys")
        .accessibilityAddTraits(isOpen ? .isSelected : [])
        .help("\(name.isEmpty ? "Unnamed place" : name) — drag it, or move it with the arrow keys")
    }

    // MARK: - writes

    private func add(_ stage: TripStage) {
        let place = createTripPlace()
        write(stage) { $0.append(place) }
        store.sealHistory()
        openId = place.id
        fresh = place.id
    }

    private func move(_ stage: TripStage, _ from: Int, _ to: Int) {
        let current = store.trip(tripId)?.stages.first { $0.id == stage.id } ?? stage
        guard current.places.count > 1, to >= 0, to < current.places.count, from != to else { return }
        write(current) { $0 = moveItem($0, from, to) }
        store.sealHistory()
    }

    /// The places rewritten, on the leg as it now stands.
    private func write(_ stage: TripStage, _ change: (inout [TripPlace]) -> Void) {
        var next = store.trip(tripId)?.stages.first { $0.id == stage.id } ?? stage
        change(&next.places)
        StagesEdit.write(store, tripId, stage: next)
    }
}

/// The open place's fields: its name (with the opt-in lookup), its region
/// (the leg's own as the placeholder), a two-step delete, and its coordinates
/// with `forget`.
private struct PlaceFieldsView: View {
    let stage: TripStage
    let place: TripPlace
    let index: Int
    let autoFocus: Bool
    let onChange: (TripPlace) -> Void
    let onDelete: () -> Void

    @Environment(\.palette) private var palette
    @State private var confirming = false

    var body: some View {
        let who = place.name.trimmingCharacters(in: .whitespacesAndNewlines)
        let spoken = who.isEmpty ? "this place" : who
        // An empty field means "the stage's", never blank.
        let inherited = stageRegionLabel(stage)
        let name = Binding<String>(get: { place.name }, set: { next in
            var p = place
            p.name = next
            onChange(p)
        })
        let region = Binding<String>(get: { place.region }, set: { next in
            var p = place
            p.region = next
            onChange(p)
        })
        VStack(alignment: .leading, spacing: 6) {
            PlaceSearchFieldView(value: name, onPick: pick, placeholder: "Kalbarri",
                                 label: "Place \(index + 1)", autoFocus: autoFocus)
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                TextField("Region of \(spoken)", text: region,
                          prompt: Text(inherited.isEmpty ? "Western Australia" : inherited))
                    .textFieldStyle(.roundedBorder)
                    .font(Brand.sans(13))
                    .accessibilityLabel("Region of \(spoken)")
                if confirming {
                    Button("Delete", action: onDelete)
                        .buttonStyle(StagesButtonStyle(kind: .danger, small: true))
                    Button("Keep") { confirming = false }
                        .buttonStyle(StagesButtonStyle(kind: .ghost, small: true))
                } else {
                    Button("Delete") { confirming = true }
                        .buttonStyle(StagesButtonStyle(kind: .ghost, small: true))
                        .accessibilityLabel("Delete \(spoken)")
                }
            }
            if let coords = place.coords {
                HStack(spacing: 8) {
                    Text(formatCoords(coords))
                        .font(Brand.mono(11))
                        .monospacedDigit()
                        .foregroundStyle(palette.faint)
                        .textSelection(.enabled)
                    Button("forget") {
                        var p = place
                        p.coords = nil
                        onChange(p)
                    }
                    .buttonStyle(.plain)
                    .font(Brand.sans(11))
                    .underline()
                    .foregroundStyle(palette.faint)
                }
            }
        }
        .padding(.leading, 4)
    }

    /// A candidate chosen: its name and coordinates, and its region only where
    /// the author wrote none.
    private func pick(_ result: PlaceResult) {
        var p = place
        p.name = result.name
        let own = place.region.trimmingCharacters(in: .whitespacesAndNewlines)
        p.region = own.isEmpty ? result.region : own
        p.coords = GeoPoint(lat: result.lat, lon: result.lon)
        onChange(p)
    }
}

#Preview("Places") {
    StagesPreviewHost { store, _ in
        PlacesEditorView(store: store, tripId: StagesFixtures.trip.id, stageId: StagesFixtures.trip.stages[0].id)
            .padding(16)
    }
}
