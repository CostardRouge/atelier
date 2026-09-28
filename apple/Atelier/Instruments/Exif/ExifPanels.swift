// The Camera / Exposure / Image / Location panels for one photograph —
// `src/tools/exif/exif-view.tsx`, every field and every word, formatted by the
// kernel's port of `exif-format.ts`. A missing value reads `—`.
//
// Two native additions, each saying only what the file itself said:
// - a RAW panel — the kernel's RAW probe (`RawProbe.swift`): the sensor
//   plane, the render its camera wrote inside it, the calibration its
//   `OpcodeList3` asks for;
// - the GPS on a map, behind the same opt-in as every map in the suite
//   (`BaseMapConsent`); the OpenStreetMap link stays a link, opened only by
//   the person's own click.

import SwiftUI
import AtelierKit

struct ExifPanels: View {
    let data: ExifData
    let raw: RawProbe?
    let rawSizes: RawSizes?
    @State private var mapOn = false
    @Environment(\.palette) private var palette
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    private var columns: Int { sizeClass == .compact ? 1 : 2 }
    #else
    private let columns = 2
    #endif

    var body: some View {
        let grid = Array(repeating: GridItem(.flexible(), spacing: 20, alignment: .top), count: columns)
        LazyVGrid(columns: grid, alignment: .leading, spacing: 20) {
            camera
            exposure
            image
            location
            if let raw { rawPanel(raw) }
        }
    }

    private var camera: some View {
        let lens = [data.lensMake, data.lensModel].compactMap { $0 }.filter { !$0.isEmpty }
            .joined(separator: " ").trimmingCharacters(in: .whitespaces)
        return TelemetryPanelCard(title: "Camera") {
            TelemetryFieldRow(label: "Make", value: data.make)
            TelemetryFieldRow(label: "Model", value: data.model)
            TelemetryFieldRow(label: "Lens", value: lens.isEmpty ? nil : lens)
            TelemetryFieldRow(label: "Software", value: data.software)
            TelemetryFieldRow(label: "Artist", value: data.artist)
        }
    }

    private var exposure: some View {
        TelemetryPanelCard(title: "Exposure") {
            TelemetryFieldRow(label: "Shutter", value: formatShutter(data.exposureTime))
            TelemetryFieldRow(label: "Aperture", value: formatAperture(data.fNumber))
            TelemetryFieldRow(label: "ISO", value: formatIso(data.iso))
            TelemetryFieldRow(label: "Exposure bias", value: formatExposureBias(data.exposureBias))
            TelemetryFieldRow(label: "Focal length", value: formatFocal(data.focalLength))
            TelemetryFieldRow(label: "35 mm equiv.", value: formatFocal(data.focalLength35))
            TelemetryFieldRow(label: "Program", value: exposureProgramLabel(data.exposureProgram))
            TelemetryFieldRow(label: "Metering", value: meteringModeLabel(data.meteringMode))
            TelemetryFieldRow(label: "White balance", value: whiteBalanceLabel(data.whiteBalance))
            TelemetryFieldRow(label: "Flash", value: flashLabel(data.flash))
        }
    }

    private var image: some View {
        let dims: String? = {
            guard let w = data.pixelWidth, let h = data.pixelHeight, w > 0, h > 0 else { return nil }
            return "\(Int(w)) × \(Int(h))"
        }()
        return TelemetryPanelCard(title: "Image") {
            TelemetryFieldRow(label: "Dimensions", value: dims)
            TelemetryFieldRow(label: "Orientation", value: orientationLabel(data.orientation))
            TelemetryFieldRow(label: "Captured", value: formatCaptured(data.dateTimeOriginal))
        }
    }

    private var location: some View {
        VStack(alignment: .leading, spacing: 12) {
            TelemetryPanelCard(title: "Location") {
                TelemetryFieldRow(label: "Coordinates", value: formatCoord(data.gps))
                TelemetryFieldRow(label: "Altitude", value: formatAltitude(data.gpsAltitude))
                if let gps = data.gps, let url = URL(string: mapsUrl(gps)) {
                    GridRow {
                        Text("Map").font(Brand.sans(14)).foregroundStyle(palette.muted)
                        Link("OpenStreetMap ↗", destination: url)
                            .font(Brand.mono(14))
                            .frame(maxWidth: .infinity, alignment: .trailing)
                    }
                }
            }
            if let gps = data.gps {
                BaseMapConsent(on: $mapOn)
                if mapOn {
                    PointBaseMap(lat: gps.lat, lon: gps.lon)
                        .frame(height: 220)
                        .clipShape(RoundedRectangle(cornerRadius: Brand.controlRadius))
                }
            }
        }
    }

    private func rawPanel(_ probe: RawProbe) -> some View {
        let sensor = sensorIfd(probe)
        let calibration = describeOpcodes(probe.calibration)
        return TelemetryPanelCard(title: "RAW") {
            TelemetryFieldRow(label: "Sensor", value: rawSizes?.sensor.map(sizeText))
            TelemetryFieldRow(label: "Sensor data", value: sensor.map { describeCompression($0.compression) })
            TelemetryFieldRow(label: "Camera render", value: rawSizes?.render.map(sizeText) ?? (probe.preview == nil ? "none embedded" : nil))
            TelemetryFieldRow(label: "Calibration", value: calibration.isEmpty ? nil : calibration)
            TelemetryFieldRow(label: "Opcode lists", value: probe.opcodes.isEmpty ? nil : String(probe.opcodes.count))
        }
    }

    private func sizeText(_ size: Size) -> String {
        "\(Int(size.width)) × \(Int(size.height))"
    }
}

#Preview("EXIF panels") {
    ScrollView {
        ExifPanels(data: InstrumentFixtures.exif, raw: nil, rawSizes: nil).padding()
    }
}
