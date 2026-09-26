// The suite's tools, as the app's four tabs: the tab bar IS the home. The
// web app's registry (`src/app/tools.tsx`) lists more — the instrument pages
// kept until the Studio absorbs them — and those are `InstrumentTool`
// (`Instruments/InstrumentTool.swift`), reached from the sidebar's second
// section and, on a phone, the fifth tab (`RootView`).

import SwiftUI

enum Tool: String, CaseIterable, Identifiable {
    case develop, trips, studio, sources

    var id: String { rawValue }

    var title: String {
        switch self {
        case .develop: return "Develop"
        case .trips: return "Trips"
        case .studio: return "Studio"
        case .sources: return "Sources"
        }
    }

    /// One line under the name on a Mac's sidebar and in an empty state.
    var tagline: String {
        switch self {
        case .develop: return "Rolls of pictures, each with its own develop, crop and look."
        case .trips: return "A journey by calendar day, and the pieces it publishes."
        case .studio: return "Clips graded and dressed with their own telemetry."
        case .sources: return "Where your documents live: this device, a Winnow."
        }
    }

    var symbol: String {
        switch self {
        case .develop: return "camera.aperture"
        case .trips: return "map"
        case .studio: return "film.stack"
        case .sources: return "externaldrive.connected.to.line.below"
        }
    }

    @ViewBuilder
    var screen: some View {
        switch self {
        case .develop: RollGallery()
        case .trips: PlannedToolView(tool: .trips)
        case .studio: PlannedToolView(tool: .studio)
        case .sources: SourcesView()
        }
    }
}
