// The suite's INSTRUMENTS — the web registry's `group: 'instrument'` entries
// (`src/app/tools.tsx`), each a small page of its own beside the three
// editors (Develop, Trips, Studio). The web keeps them "until the Studio
// absorbs them"; the design canvas files them under a More section of the
// sidebar and a fifth tab on a phone — honest and small, never dropped.
//
// The words are the web's: label, subtitle and blurb, one for one, in the
// web registry's order.

import SwiftUI
import AtelierKit

/// Where the web's switcher files a tool.
enum ToolGroup: String {
    /// Where the suite is converging: Develop, Trips, Studio.
    case editor
    /// A standalone page kept until the Studio absorbs it.
    case instrument
}

enum InstrumentTool: String, CaseIterable, Identifiable, Hashable {
    case telemetry, overlay, map, composer, exif, compare, lut

    var id: String { rawValue }

    var group: ToolGroup { .instrument }

    /// The web's nav label.
    var title: String {
        switch self {
        case .telemetry: return "DJI Telemetry"
        case .overlay: return "Telemetry Overlay"
        case .map: return "Flight Map"
        case .composer: return "Composer"
        case .exif: return "Photo EXIF"
        case .compare: return "Compare A/B"
        case .lut: return "LUT Studio"
        }
    }

    /// The home card's eyebrow.
    var subtitle: String {
        switch self {
        case .telemetry: return "DJI · SRT telemetry"
        case .overlay: return "Burn-in telemetry"
        case .map: return "GPS flight path"
        case .composer: return "Video + map + telemetry"
        case .exif: return "Camera · lens · GPS"
        case .compare: return "Before/after wipe"
        case .lut: return "Colour grading"
        }
    }

    /// The one-line pitch, as the web's home page card says it.
    var blurb: String {
        switch self {
        case .telemetry:
            return "Play any DJI clip with its flight log in sync — altitude, GPS, ISO and shutter move with the frame."
        case .overlay:
            return "Place altitude, GPS and exposure readouts anywhere on your DJI clip, then export an MP4 with the telemetry burned in."
        case .map:
            return "Trace a DJI clip’s GPS path on a map and scrub the video to walk the aircraft along it. Draws offline; the map background is opt-in."
        case .composer:
            return "Compose a DJI clip with its flight map and a draggable telemetry readout into one frame — pick the aspect, layout and a LUT, and preview the assembly."
        case .exif:
            return "Inspect any photo’s metadata — camera, lens, the full exposure triplet and GPS location — read straight from the file, even RAW."
        case .compare:
            return "Lay any two photos or clips side by side under a draggable divider — two grades, two takes, before and after — with synced playback for clips."
        case .lut:
            return "Preview .cube LUTs on your footage with a before/after wipe, then batch-export the graded clips."
        }
    }

    var symbol: String {
        switch self {
        case .telemetry: return "waveform.path.ecg"
        case .overlay: return "text.below.photo"
        case .map: return "point.topleft.down.to.point.bottomright.curvepath"
        case .composer: return "rectangle.split.2x1"
        case .exif: return "camera.metering.matrix"
        case .compare: return "square.split.2x1"
        case .lut: return "cube.transparent"
        }
    }

    /// The asset kinds it reads — the web registry's `accepts`, matched by
    /// the kernel's `usableAssets` (a video+telemetry clip stands in for a
    /// plain video).
    var accepts: [AssetKind] {
        switch self {
        case .telemetry: return [.videoTelemetry, .telemetry, .video]
        case .overlay: return [.videoTelemetry]
        case .map: return [.videoTelemetry, .telemetry]
        case .composer: return [.videoTelemetry]
        case .exif: return [.photo]
        case .compare: return [.photo, .video]
        // The web's LUT Studio grades clips; the native one previews a photo
        // too, through the same graph.
        case .lut: return [.video, .photo]
        }
    }

    @MainActor @ViewBuilder
    var screen: some View {
        switch self {
        case .telemetry: TelemetryToolView()
        case .overlay: OverlayMovedView()
        case .map: FlightMapToolView()
        case .composer: ComposerToolView()
        case .exif: ExifToolView()
        case .compare: CompareToolView()
        case .lut: LutStudioView()
        }
    }
}

// MARK: - moving between the shell's places

/// A way for a screen to send the person to another tool of the shell — the
/// Telemetry Overlay's "Open the Studio". The shell sets it (`RootView`);
/// the default does nothing, so a preview never navigates.
struct ShellNavigate {
    let open: (Tool) -> Void

    func callAsFunction(_ tool: Tool) { open(tool) }
}

private struct ShellNavigateKey: EnvironmentKey {
    static let defaultValue = ShellNavigate { _ in }
}

extension EnvironmentValues {
    var shellNavigate: ShellNavigate {
        get { self[ShellNavigateKey.self] }
        set { self[ShellNavigateKey.self] = newValue }
    }
}

// MARK: - the More list

/// The instruments as a list: the fifth tab on a phone and an iPad, the
/// sidebar's More section's own page. Each row says what the web's home card
/// says, and opens the instrument.
struct InstrumentsHome: View {
    @Environment(\.palette) private var palette

    var body: some View {
        List {
            Section {
                ForEach(InstrumentTool.allCases.filter { $0.group == .instrument }) { instrument in
                    NavigationLink(value: instrument) {
                        InstrumentRow(instrument: instrument)
                    }
                }
            } footer: {
                Text("Standalone pages, kept until the Studio absorbs them. Everything is read on this device; nothing is uploaded.")
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.muted)
            }
        }
        .navigationTitle("More")
        .navigationDestination(for: InstrumentTool.self) { instrument in
            instrument.screen
        }
    }
}

private struct InstrumentRow: View {
    let instrument: InstrumentTool
    @Environment(\.palette) private var palette

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: instrument.symbol)
                .font(.system(size: 18))
                .foregroundStyle(palette.accent)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 3) {
                Text(instrument.subtitle.uppercased())
                    .font(Brand.eyebrow)
                    .kerning(1.1)
                    .foregroundStyle(palette.muted)
                Text(instrument.title)
                    .font(Brand.display(20))
                    .foregroundStyle(palette.ink)
                Text(instrument.blurb)
                    .font(Brand.sans(13))
                    .foregroundStyle(palette.inkSoft)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 4)
    }
}

#Preview("More") {
    NavigationStack { InstrumentsHome() }
}
