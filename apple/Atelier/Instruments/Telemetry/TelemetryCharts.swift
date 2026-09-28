// The flight log as a chart and as a table — the native app's addition to the
// DJI Telemetry page (the web's panels show ONE cue, under the playhead; a
// device has room to show the whole log beside it). Both read the kernel's
// cues and motion and nothing else: a value the log does not carry is absent
// from the chart and `—` in the table, never interpolated.
//
// A chart of a five-minute clip would be 18 000 marks: the series is thinned
// to one point per step (`chartPoints`), which only drops points — every
// point drawn is a real cue. A tap or drag on the chart seeks the clip, a
// row picked in the table does too.

import Charts
import SwiftUI
import AtelierKit

/// What the chart plots.
enum TelemetrySeries: String, CaseIterable, Identifiable {
    case altitude, speed, vspeed

    var id: String { rawValue }

    var title: String {
        switch self {
        case .altitude: return "Altitude"
        case .speed: return "Speed"
        case .vspeed: return "V/S"
        }
    }

    var unit: String {
        switch self {
        case .altitude: return "m"
        case .speed, .vspeed: return "m/s"
        }
    }

    func value(_ cue: Cue) -> Double? {
        switch self {
        case .altitude:
            guard let text = cue.data["rel_alt"], let v = Double(text), v.isFinite else { return nil }
            return v
        case .speed: return motionAt(cue).groundSpeed
        case .vspeed: return motionAt(cue).verticalSpeed
        }
    }
}

struct TelemetryChartPoint: Identifiable {
    let id: Int
    let t: Double
    let value: Double
}

/// At most `limit` real points of `series`, evenly strided through the log.
func chartPoints(_ cues: [Cue], _ series: TelemetrySeries, limit: Int = 600) -> [TelemetryChartPoint] {
    guard !cues.isEmpty else { return [] }
    let step = max(1, cues.count / max(1, limit))
    var points: [TelemetryChartPoint] = []
    var i = 0
    while i < cues.count {
        if let v = series.value(cues[i]) {
            points.append(TelemetryChartPoint(id: i, t: cues[i].start, value: v))
        }
        i += step
    }
    return points
}

struct TelemetryChart: View {
    let cues: [Cue]
    /// The playhead, in seconds of media.
    let time: Double
    let onSeek: (Double) -> Void
    @State private var series: TelemetrySeries = .altitude
    @Environment(\.palette) private var palette

    var body: some View {
        let points = chartPoints(cues, series)
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Eyebrow("The whole log")
                Spacer()
                Picker("Series", selection: $series) {
                    ForEach(TelemetrySeries.allCases) { s in Text(s.title).tag(s) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(maxWidth: 240)
            }
            if points.isEmpty {
                Text("This log carries no \(series.title.lowercased()) to plot.")
                    .font(Brand.sans(13))
                    .foregroundStyle(palette.muted)
                    .frame(maxWidth: .infinity, minHeight: 120)
            } else {
                Chart {
                    ForEach(points) { p in
                        LineMark(x: .value("Time", p.t), y: .value(series.title, p.value))
                            .foregroundStyle(palette.accent)
                            .interpolationMethod(.linear)
                    }
                    RuleMark(x: .value("Playhead", time))
                        .foregroundStyle(palette.ink.opacity(0.6))
                        .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                }
                .chartXAxisLabel("s")
                .chartYAxisLabel(series.unit)
                .chartOverlay { proxy in
                    GeometryReader { geo in
                        Rectangle()
                            .fill(Color.clear)
                            .contentShape(Rectangle())
                            .gesture(
                                DragGesture(minimumDistance: 0).onChanged { drag in
                                    guard let frame = proxy.plotFrame else { return }
                                    let x = drag.location.x - geo[frame].origin.x
                                    if let t = proxy.value(atX: x, as: Double.self) { onSeek(max(0, t)) }
                                }
                            )
                    }
                }
                .frame(height: 180)
            }
        }
        .padding(16)
        .background(palette.surface, in: RoundedRectangle(cornerRadius: Brand.controlRadius))
        .overlay(RoundedRectangle(cornerRadius: Brand.controlRadius).stroke(palette.line, lineWidth: 1))
    }
}

// MARK: - the table

/// One cue as a row.
struct TelemetryCueRow: Identifiable {
    let id: Int
    let cue: Cue
    let motion: Motion

    var time: String { formatTimecode(cue.start) }
    var frame: String { cue.frame.map { String($0) } ?? "—" }
    var relAlt: String { telemetryText(cue.data["rel_alt"], " m") }
    var absAlt: String { telemetryText(cue.data["abs_alt"], " m") }
    var speed: String { formatGroundSpeed(motion.groundSpeed) ?? "—" }
    var vspeed: String { formatVerticalSpeed(motion.verticalSpeed) ?? "—" }
    var heading: String { formatHeading(motion.heading) ?? "—" }
    var latitude: String { telemetryText(cue.data["latitude"]) }
    var longitude: String { telemetryText(cue.data["longitude"]) }
    var exposure: String {
        let parts = [cue.data["iso"].map { "ISO \($0)" }, cue.data["shutter"], cue.data["fnum"].map { "f/\($0)" }]
            .compactMap { $0 }
        return parts.isEmpty ? "—" : parts.joined(separator: " · ")
    }
}

func telemetryRows(_ cues: [Cue]) -> [TelemetryCueRow] {
    cues.enumerated().map { TelemetryCueRow(id: $0.offset, cue: $0.element, motion: motionAt($0.element)) }
}

/// Every cue of the log: a sortable-looking `Table` where there is room, a
/// plain list on a phone (a `Table` there shows its first column only).
struct TelemetryCueTable: View {
    let rows: [TelemetryCueRow]
    let onSeek: (Double) -> Void
    @State private var selection: TelemetryCueRow.ID?
    @Environment(\.palette) private var palette
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    private var compact: Bool { sizeClass == .compact }
    #else
    private let compact = false
    #endif

    var body: some View {
        Group {
            if compact { list } else { table }
        }
        .onChange(of: selection) { _, id in
            if let id, id < rows.count { onSeek(rows[id].cue.start) }
        }
    }

    private var table: some View {
        Table(rows, selection: $selection) {
            TableColumn("Time") { Text($0.time).font(Brand.mono(11)) }
            TableColumn("FrameCnt") { Text($0.frame).font(Brand.mono(11)) }
            TableColumn("Rel. alt") { Text($0.relAlt).font(Brand.mono(11)) }
            TableColumn("Abs. alt") { Text($0.absAlt).font(Brand.mono(11)) }
            TableColumn("Speed") { Text($0.speed).font(Brand.mono(11)) }
            TableColumn("V/S") { Text($0.vspeed).font(Brand.mono(11)) }
            TableColumn("Heading") { Text($0.heading).font(Brand.mono(11)) }
            TableColumn("Latitude") { Text($0.latitude).font(Brand.mono(11)) }
            TableColumn("Longitude") { Text($0.longitude).font(Brand.mono(11)) }
            TableColumn("Exposure") { Text($0.exposure).font(Brand.mono(11)) }
        }
        .frame(minHeight: 280)
    }

    private var list: some View {
        LazyVStack(alignment: .leading, spacing: 0) {
            ForEach(rows) { row in
                Button {
                    selection = row.id
                } label: {
                    HStack(spacing: 10) {
                        Text(row.time).frame(width: 70, alignment: .leading)
                        Text(row.relAlt).frame(width: 70, alignment: .trailing)
                        Text(row.speed).frame(maxWidth: .infinity, alignment: .trailing)
                    }
                    .font(Brand.mono(12))
                    .monospacedDigit()
                    .foregroundStyle(selection == row.id ? palette.accentInk : palette.ink)
                    .padding(.vertical, 6)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                Hairline()
            }
        }
    }
}

#Preview("Chart") {
    TelemetryChart(cues: InstrumentFixtures.track.cues, time: 8) { _ in }
        .padding()
}

#Preview("Table") {
    ScrollView {
        TelemetryCueTable(rows: telemetryRows(Array(InstrumentFixtures.track.cues.prefix(60)))) { _ in }
            .padding()
    }
}
