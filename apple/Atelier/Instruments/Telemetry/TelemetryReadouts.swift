// The telemetry readouts — `src/shared/telemetry/telemetry-view.tsx`, native:
// the full Flight and Camera panels of the detail view, and the compact live
// readout of a gallery card. A missing value reads as an em-dash, the one
// spelling of "the log does not say" across the suite; the motion is the
// kernel's (`motionAt`: measured backward, the opening window filled forward).

import SwiftUI
import AtelierKit

/// `fmt`: a raw value with its unit, or `—`.
func telemetryText(_ value: String?, _ suffix: String = "") -> String {
    guard let value, !value.isEmpty else { return "—" }
    return suffix.isEmpty ? value : value + suffix
}

/// One label/value row of a panel — the web's `Field`.
struct TelemetryFieldRow: View {
    let label: String
    let value: String?
    var suffix: String = ""
    var highlight = false
    @Environment(\.palette) private var palette

    var body: some View {
        let shown = telemetryText(value, suffix)
        let empty = shown == "—"
        GridRow {
            Text(label)
                .font(highlight ? Brand.sans(17, weight: .semibold) : Brand.sans(14))
                .foregroundStyle(highlight ? palette.accentInk : palette.muted)
            Text(shown)
                .font(highlight ? Brand.mono(17, weight: .semibold) : Brand.mono(14))
                .monospacedDigit()
                .foregroundStyle(highlight ? palette.accentInk : (empty ? palette.faint : palette.ink))
                .frame(maxWidth: .infinity, alignment: .trailing)
                .textSelection(.enabled)
        }
    }
}

/// A panel card: the accent-dashed mono title, then a two-column grid.
struct TelemetryPanelCard<Rows: View>: View {
    let title: String
    @ViewBuilder let rows: () -> Rows
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                Rectangle().fill(palette.accent).frame(width: 14, height: 1)
                Eyebrow(title)
            }
            Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 9) {
                rows()
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(palette.surface, in: RoundedRectangle(cornerRadius: Brand.controlRadius))
        .overlay(RoundedRectangle(cornerRadius: Brand.controlRadius).stroke(palette.line, lineWidth: 1))
    }
}

/// The full Flight + Camera panels for one cue, side by side where there is room.
struct TelemetryPanels: View {
    let cue: Cue?
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    private var sideBySide: Bool { sizeClass != .compact }
    #else
    private let sideBySide = true
    #endif

    var body: some View {
        let layout = sideBySide ? AnyLayout(HStackLayout(alignment: .top, spacing: 20)) : AnyLayout(VStackLayout(spacing: 20))
        layout {
            flight
            camera
        }
    }

    private var data: [String: String] { cue?.data ?? [:] }

    private var flight: some View {
        let motion = motionAt(cue)
        return TelemetryPanelCard(title: "Flight") {
            TelemetryFieldRow(label: "Rel. altitude", value: data["rel_alt"], suffix: " m", highlight: true)
            TelemetryFieldRow(label: "Abs. altitude", value: data["abs_alt"], suffix: " m")
            TelemetryFieldRow(label: "Ground speed", value: formatGroundSpeed(motion.groundSpeed))
            TelemetryFieldRow(label: "Vertical speed", value: formatVerticalSpeed(motion.verticalSpeed))
            TelemetryFieldRow(label: "Heading", value: formatHeading(motion.heading))
            TelemetryFieldRow(label: "Latitude", value: data["latitude"])
            TelemetryFieldRow(label: "Longitude", value: data["longitude"])
            TelemetryFieldRow(label: "FrameCnt", value: cue?.frame.map { String($0) })
            TelemetryFieldRow(label: "Timestamp", value: cue?.timestamp)
        }
    }

    private var camera: some View {
        TelemetryPanelCard(title: "Camera") {
            TelemetryFieldRow(label: "ISO", value: data["iso"])
            TelemetryFieldRow(label: "Shutter", value: data["shutter"])
            TelemetryFieldRow(label: "Aperture", value: data["fnum"].map { "f/\($0)" })
            TelemetryFieldRow(label: "EV", value: data["ev"])
            TelemetryFieldRow(label: "Focal length", value: data["focal_len"], suffix: " mm")
            TelemetryFieldRow(label: "Color profile", value: data["color_md"])
            TelemetryFieldRow(label: "Color temp.", value: data["ct"], suffix: " K")
        }
    }
}

/// The compact live readout of a card: altitude as the headline, speed and
/// heading, GPS and the exposure triplet beneath — `LiveTelemetry`.
struct LiveTelemetryReadout: View {
    let cue: Cue?
    @Environment(\.palette) private var palette

    var body: some View {
        let data = cue?.data ?? [:]
        let motion = motionAt(cue)
        let gps: String = {
            guard let lat = data["latitude"], !lat.isEmpty, let lon = data["longitude"], !lon.isEmpty else { return "—" }
            return "\(lat), \(lon)"
        }()
        let speed = [formatGroundSpeed(motion.groundSpeed), formatHeading(motion.heading)]
            .compactMap { $0 }.joined(separator: "  ·  ")
        let exposure = [data["iso"].map { "ISO \($0)" }, data["shutter"], data["fnum"].map { "f/\($0)" }]
            .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: "  ·  ")

        Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 6) {
            GridRow(alignment: .firstTextBaseline) {
                label("Altitude")
                Text(telemetryText(data["rel_alt"], " m"))
                    .font(Brand.display(30))
                    .foregroundStyle(palette.accentInk)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            row("Speed", speed.isEmpty ? "—" : speed)
            row("GPS", gps)
            row("Exposure", exposure.isEmpty ? "—" : exposure)
        }
        .padding(.horizontal, 15)
        .padding(.vertical, 13)
        .background(palette.paper, in: RoundedRectangle(cornerRadius: Brand.controlRadius))
        .overlay(RoundedRectangle(cornerRadius: Brand.controlRadius).stroke(palette.line, lineWidth: 1))
    }

    private func label(_ text: String) -> some View {
        Text(text.uppercased())
            .font(Brand.mono(10))
            .kerning(1.3)
            .foregroundStyle(palette.muted)
    }

    private func row(_ title: String, _ value: String) -> some View {
        GridRow(alignment: .firstTextBaseline) {
            label(title)
            Text(value)
                .font(Brand.mono(13))
                .monospacedDigit()
                .foregroundStyle(palette.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
    }
}

#Preview("Panels") {
    ScrollView {
        TelemetryPanels(cue: InstrumentFixtures.track.cues[240]).padding()
    }
}

#Preview("Live readout") {
    LiveTelemetryReadout(cue: InstrumentFixtures.track.cues[120])
        .frame(width: 320)
        .padding()
}
