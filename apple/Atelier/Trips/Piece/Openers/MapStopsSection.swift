// The Itinerary's STOPS — the first group of the panel in
// `src/shared/roadtrip/hooks/map.tsx`: the picking map, the trip's own places
// as one-press chips, the list in order, and the stop in hand — its name
// (with the opt-in place search the trip's legs use), its position as two
// number fields, its ONE picture, its place in the order.
//
// Rules kept (`roadtrip.md`, «The Itinerary», «The chooser had to learn one
// thing»):
// - A stop is the author's: picked, ordered and given its picture by hand.
// - A stop's chooser opens on the piece's own day too (`includeThisDay`) and
//   keeps a picture shot after it (`keepsLater`). A pick of several is
//   generous rather than clever: the first lands on the stop asked from, the
//   rest fill the stops AFTER it that have none — never one that already
//   holds a picture, never one before it — and what had nowhere to go is
//   COUNTED here (`assignPictures`).
// - Twenty-four stops is as many as one opener draws; the panel says so
//   rather than refusing in silence.
// - Every gesture on the map has its keyboard twin here.

import SwiftUI
import AtelierKit

struct MapStopsSection: View {
    let model: PieceEditorModel
    let ctx: HookContext
    /// Open the host's picture chooser; nil where there is no host.
    let choose: ((OpenerPicturesRequest) -> Void)?

    @Environment(\.palette) private var palette
    /// The stop in hand — the panel's own, as the web's `useState`.
    @State private var selectedId: String?
    /// What the last pick did, when it did more than the stop it was asked from.
    @State private var spread: String?

    private var o: MapOptions { mapOptions(model.hookOptions) }

    /// The stops rewritten, laid over the options as the document holds them now.
    private func setStops(_ change: ([MapStop]) -> [MapStop]) {
        var next = mapOptions(model.hookOptions)
        next.stops = change(next.stops)
        model.writeOpenerOptions(next.json.objectValue ?? [:])
    }

    var body: some View {
        let options = o
        let places = tripPlaces(ctx.stages)
        let free = otherPlaces(ctx.stages, options.stops)
        let full = options.stops.count >= mapMaxStops
        let keys = options.stops.compactMap { stopPictureKey($0) }
        let line = options.media == .off ? nil : OpenerPictureLine.line(keys, model.openerPictureStatus, .map)
        OpenerGroup(title: "Stops") {
            MapFieldView(stops: options.stops, places: free, selectedId: selectedId, curve: options.curve,
                         onSelect: { selectedId = $0 },
                         onDrop: { at in if !full { add(at, name: nil) } },
                         onAdopt: { place in if !full { add(GeoPoint(lat: place.lat, lon: place.lon), name: place.name) } },
                         onMove: { id, at in
                             setStops { stops in
                                 patchStop(stops, id) {
                                     $0.lat = at.lat
                                     $0.lon = at.lon
                                 }
                             }
                         })
            OpenerNote("\(OpenerWords.click) the map to drop a stop, drag one to move it, \(OpenerWords.clickLower) a hollow ring to take one of the trip’s own places. Nothing here is fetched — no tiles, no basemap.",
                       tone: .faint, small: true)
            if options.stops.isEmpty && places.count > 1 {
                Button("Take the trip’s \(places.count) places") {
                    setStops { _ in stopsFromPlaces(places) { _ in newTripId() } }
                }
                .buttonStyle(StagesButtonStyle(kind: .primary, small: true))
            }
            if !free.isEmpty && !full { chips(free) }
            if !options.stops.isEmpty { list(options.stops) }
            if full {
                OpenerNote("\(mapMaxStops) stops is as many as one opener draws — past that the dots merge and every picture is another decode.",
                           tone: .muted, small: true)
            }
            if let index = options.stops.firstIndex(where: { $0.id == selectedId }) {
                editor(options, index)
            }
            if let spread { OpenerNote(spread, tone: .muted, small: true) }
            OpenerPictureLineView(line: line)
        }
    }

    private func add(_ at: GeoPoint, name: String?) {
        let id = newTripId()
        setStops { addStop($0, at, name: name, id) }
        selectedId = id
    }

    // MARK: - the trip's places, the list

    /// The trip's located places not yet stops, one press each — the
    /// keyboard twin of pressing a hollow ring.
    private func chips(_ free: [MapPlace]) -> some View {
        StagesFlow(spacing: 6) {
            ForEach(Array(free.prefix(12).enumerated()), id: \.offset) { _, place in
                Button("+ \(place.name.isEmpty ? "Unnamed place" : place.name)") {
                    add(GeoPoint(lat: place.lat, lon: place.lon), name: place.name)
                }
                .buttonStyle(StagesButtonStyle(small: true))
            }
        }
    }

    private func list(_ stops: [MapStop]) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(stops.enumerated()), id: \.element.id) { index, stop in
                if index > 0 { Hairline() }
                row(stop, index)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: Brand.paperRadius))
        .overlay(RoundedRectangle(cornerRadius: Brand.paperRadius).strokeBorder(palette.line, lineWidth: 1))
    }

    private func row(_ stop: MapStop, _ index: Int) -> some View {
        let on = stop.id == selectedId
        let name = stop.name.trimmingCharacters(in: .whitespacesAndNewlines)
        return Button {
            selectedId = on ? nil : stop.id
        } label: {
            HStack(spacing: 8) {
                Text(verbatim: "\(index + 1)")
                    .font(Brand.mono(9))
                    .foregroundStyle(palette.onMedia)
                    .frame(width: 20, height: 20)
                    .background(Circle().fill(palette.frame))
                Text(verbatim: name.isEmpty ? "Unnamed stop" : name)
                    .font(Brand.sans(12))
                    .foregroundStyle(name.isEmpty ? palette.muted : palette.ink)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text(verbatim: stop.picture == nil ? "—" : "photo")
                    .font(Brand.mono(9))
                    .foregroundStyle(palette.faint)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .background(on ? palette.accentWash : palette.paper)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    // MARK: - the stop in hand

    private func editor(_ o: MapOptions, _ index: Int) -> some View {
        let stop = o.stops[index]
        return VStack(alignment: .leading, spacing: 8) {
            PlaceSearchFieldView(
                value: Binding(get: { stop.name }, set: { name in setStops { patchStop($0, stop.id) { $0.name = name } } }),
                onPick: { result in
                    setStops { stops in
                        patchStop(stops, stop.id) {
                            $0.name = result.name
                            $0.lat = result.lat
                            $0.lon = result.lon
                        }
                    }
                },
                placeholder: "Kalbarri",
                label: "Name of stop \(index + 1)"
            )
            coordinates(stop)
            pictureRow(o, stop, index)
            orderRow(o, stop, index)
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: Brand.paperRadius).fill(palette.paper))
        .overlay(RoundedRectangle(cornerRadius: Brand.paperRadius).strokeBorder(palette.line, lineWidth: 1))
    }

    /// One coordinate a row — the keyboard twin of dragging the stop on the map.
    @ViewBuilder
    private func coordinates(_ stop: MapStop) -> some View {
        OverlayPanelRow("Latitude") {
            OverlayPanelNumberField("Latitude", value: stop.lat, step: 0.0001, range: -90...90, unit: "°N") { lat in
                setStops { patchStop($0, stop.id) { $0.lat = min(90, max(-90, lat)) } }
            }
        }
        OverlayPanelRow("Longitude", hint: formatCoords(GeoPoint(lat: stop.lat, lon: stop.lon))) {
            OverlayPanelNumberField("Longitude", value: stop.lon, step: 0.0001, range: -180...180, unit: "°E") { lon in
                setStops { patchStop($0, stop.id) { $0.lon = min(180, max(-180, lon)) } }
            }
        }
    }

    private func pictureRow(_ o: MapOptions, _ stop: MapStop, _ index: Int) -> some View {
        let hint: String
        if let picture = stop.picture {
            hint = picture.ref.name
        } else if o.media == .off {
            hint = "The pictures are switched off below, so nothing a stop holds is drawn."
        } else {
            hint = "One picture, shown as the pen reaches this stop."
        }
        return OverlayPanelRow("Picture", hint: hint, alignTop: true) {
            if choose != nil {
                Button(stop.picture == nil ? "Pick…" : "Change…") { ask(stop, index) }
                    .buttonStyle(StagesButtonStyle(small: true))
            } else {
                OpenerNoChooser()
            }
            if stop.picture != nil {
                Button("Remove picture") {
                    setStops { patchStop($0, stop.id) { $0.picture = nil } }
                }
                .buttonStyle(DevelopLinkButtonStyle())
            }
        }
    }

    private func orderRow(_ o: MapOptions, _ stop: MapStop, _ index: Int) -> some View {
        HStack(spacing: 8) {
            Button("↑ Earlier") { setStops { moveStop($0, stop.id, -1) } }
                .buttonStyle(StagesButtonStyle(small: true))
                .disabled(index <= 0)
            Button("↓ Later") { setStops { moveStop($0, stop.id, 1) } }
                .buttonStyle(StagesButtonStyle(small: true))
                .disabled(index >= o.stops.count - 1)
            Spacer(minLength: 8)
            Button(role: .destructive) {
                setStops { removeStop($0, stop.id) }
                selectedId = nil
            } label: {
                Text(verbatim: "Remove stop")
                    .font(Brand.sans(12))
                    .underline()
                    .foregroundStyle(palette.danger)
            }
            .buttonStyle(.plain)
        }
    }

    /// The chooser for ONE stop: its own picture ticked, the piece's day in
    /// the span, a later picture kept; what comes back lands from this stop on.
    private func ask(_ stop: MapStop, _ index: Int) {
        let selected = stop.picture.map { [$0] } ?? []
        let choice = HookPictureChoice(includeThisDay: true, keepsLater: true)
        choose?(OpenerPicturesRequest(selected: selected, choice: choice) { picked in
            var next = mapOptions(model.hookOptions)
            // The stop may have moved in the order since the chooser opened.
            let at = next.stops.firstIndex { $0.id == stop.id } ?? index
            let assigned = assignPictures(next.stops, at, picked)
            next.stops = assigned.stops
            model.writeOpenerOptions(next.json.objectValue ?? [:])
            spread = MapStopsSection.spreadLine(picked.count, used: assigned.used)
        })
    }

    /// What a pick of several did, or nil for one.
    static func spreadLine(_ count: Int, used: Int) -> String? {
        guard count > 1 else { return nil }
        if used < count {
            return "\(used) of \(count) kept pictures landed on stops — the rest had nowhere free to go."
        }
        return "\(used) pictures landed on this stop and the \(used - 1) after it that had none."
    }
}
