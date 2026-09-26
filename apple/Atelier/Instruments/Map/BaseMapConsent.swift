// The map background, asked for — the suite's ONE network exception on the
// web (OpenStreetMap tiles, `local-first.md`): off by default, turned on per
// visit by the person, and said plainly. The native app keeps the same rule
// with Apple's tiles: every instrument draws its map on a BLANK canvas until
// this chip is pressed, and the chip says what pressing it does.
//
// The consent is the screen's own `@State`, never stored — the web's is a
// component's state too, so a map background is asked for again on each
// visit, and nothing that could be exported ever carries it.

import MapKit
import SwiftUI
import AtelierKit

/// `Load map background` / `Map background: on`, with the reason it matters.
struct BaseMapConsent: View {
    @Binding var on: Bool
    @Environment(\.palette) private var palette

    var body: some View {
        InstrumentChip(title: on ? "Map background: on" : "Load map background", pressed: on) {
            on.toggle()
        }
        .help(BaseMapConsent.why)
        .accessibilityHint(BaseMapConsent.why)
    }

    /// The web's title — "Load OpenStreetMap tiles — the only feature that
    /// makes a network request" — with Apple's tiles, and without the "only":
    /// the app also talks to a Winnow the person connected.
    static let why = "Loads map tiles from Apple — a network request, made only once you turn this on"
}

/// The chip over a blank map, so an offline map never reads as a broken one.
struct OfflineMapBadge: View {
    var body: some View {
        MediaChip(text: "Offline · no tiles loaded")
    }
}

/// A flight path on Apple's map — drawn only once the person asked for the
/// background. The path and the aircraft are the web's: the accent line,
/// 3 pt, round joins; a 14 pt accent dot ringed in white.
struct FlightBaseMap: View {
    let track: [TrackPoint]
    let position: LonLat?
    @State private var camera: MapCameraPosition = .automatic
    @Environment(\.palette) private var palette

    var body: some View {
        Map(position: $camera) {
            if track.count > 1 {
                MapPolyline(coordinates: track.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon) })
                    .stroke(palette.accent.opacity(0.9), style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))
            }
            if let position {
                Annotation("Aircraft", coordinate: CLLocationCoordinate2D(latitude: position.lat, longitude: position.lon), anchor: .center) {
                    AircraftDot()
                }
                .annotationTitles(.hidden)
            }
        }
        .mapStyle(.standard(elevation: .flat))
        .overlay(alignment: .topTrailing) {
            Button {
                withAnimation { camera = .automatic }
            } label: {
                Image(systemName: "arrow.up.left.and.down.right.magnifyingglass")
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .help("Frame the whole flight")
            .accessibilityLabel("Frame the whole flight")
            .padding(10)
        }
    }
}

/// The live aircraft: an accent dot with a white ring.
struct AircraftDot: View {
    @Environment(\.palette) private var palette

    var body: some View {
        Circle()
            .fill(palette.accent)
            .frame(width: 14, height: 14)
            .overlay(Circle().stroke(Color.white, lineWidth: 2))
            .shadow(color: .black.opacity(0.4), radius: 1)
    }
}

/// A single point on Apple's map — the Photo EXIF panel's GPS, when asked for.
struct PointBaseMap: View {
    let lat: Double
    let lon: Double

    var body: some View {
        let centre = CLLocationCoordinate2D(latitude: lat, longitude: lon)
        Map(initialPosition: .region(MKCoordinateRegion(center: centre, latitudinalMeters: 1200, longitudinalMeters: 1200))) {
            Annotation("Photo", coordinate: centre, anchor: .center) { AircraftDot() }
                .annotationTitles(.hidden)
        }
        .mapStyle(.standard(elevation: .flat))
    }
}

#Preview("Consent") {
    VStack(spacing: 16) {
        BaseMapConsent(on: .constant(false))
        BaseMapConsent(on: .constant(true))
        OfflineMapBadge().padding().background(Color.black)
    }
    .padding()
}
