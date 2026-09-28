// The Studio inspector's Info tab — port of `src/tools/studio/InfoPanel.tsx`:
// the media's facts, then the telemetry under the playhead, as STACKED
// sections of label/value rows (the inspector is a column, and a long live
// list reads fine vertically).
//
// A clip: its name, weight, detail (resolution · codec · fps, assembled by
// the host), duration, CADENCE (a conformed clip's speeds are divided by
// capture seconds, said once here rather than beside each readout; when the
// log cannot answer, which rate IS quoted) and a flight summary; then Flight
// and Camera at the playhead. A photograph: its camera and lens, then its
// exposure and its place and time read through the very cue the overlay
// elements draw from, so what the tab states and what a badge burns in can
// never drift apart. A missing value reads `—` in the faint ink — a still
// has no speed, no heading and no relative altitude.

import SwiftUI
import AtelierKit

struct InfoPanelView: View {
    private let baseName: String
    private let fileBytes: Int?
    private let detail: String
    private let duration: Double
    private let cues: [Cue]
    private let cue: Cue?
    private let timing: TimeScaleReading
    private let scale: Double
    private let overridden: Bool
    private let photo: ExifData?
    @Environment(\.palette) private var palette

    private typealias P = OverlayPanels

    /// - Parameters:
    ///   - baseName: the media's name.
    ///   - fileBytes: its weight on disk, when known.
    ///   - detail: resolution · codec · fps (or · type, for a still), assembled by the host.
    ///   - cues: the clip's telemetry (a photograph's ONE cue from its EXIF, `cueFromExif`).
    ///   - cue: the cue under the playhead, or nil.
    ///   - timing: the cadence measured from the clip's own telemetry (`measureTimeScale`).
    ///   - scale: the scale in force — the measurement, or the author's override.
    ///   - overridden: that scale came from the settings rather than from the log.
    ///   - photo: the media's EXIF when it is a photograph, nil for a clip; an
    ///     EMPTY record is a photo whose EXIF is still being read or holds nothing.
    init(baseName: String, fileBytes: Int? = nil, detail: String = "", duration: Double = 0, cues: [Cue] = [],
         cue: Cue? = nil, timing: TimeScaleReading = .realtime, scale: Double = 1, overridden: Bool = false,
         photo: ExifData? = nil) {
        self.baseName = baseName
        self.fileBytes = fileBytes
        self.detail = detail
        self.duration = duration
        self.cues = cues
        self.cue = cue
        self.timing = timing
        self.scale = scale
        self.overridden = overridden
        self.photo = photo
    }

    private var hasTelemetry: Bool { !cues.isEmpty }
    private var data: [String: String] { cue?.data ?? [:] }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            mediaSection
            if photo != nil {
                photoSections
            } else {
                clipSections
            }
        }
    }

    // MARK: - the media

    private var mediaSection: some View {
        DevelopSection(id: "studio.info.media", title: photo != nil ? "Photo" : "Clip", remember: .local) {
            OverlayPanelRow("Name") {
                Text(verbatim: baseName)
                    .font(Brand.sans(13))
                    .foregroundStyle(palette.ink)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .help(baseName)
            }
            if let fileBytes {
                StudioInfoRow("Size", formatBytes(fileBytes))
            }
            if !detail.isEmpty {
                StudioInfoRow("Detail", detail)
            }
            if let photo {
                StudioInfoRow("Camera", P.infoCamera(photo))
                if let lens = P.infoLens(photo) {
                    StudioInfoRow("Lens", lens)
                }
            } else {
                clipFacts
            }
        }
    }

    @ViewBuilder
    private var clipFacts: some View {
        if duration > 0 {
            StudioInfoRow("Duration", formatDuration(duration))
        }
        let cadence = P.infoCadence(timing, scale: scale, overridden: overridden)
        if !cadence.isEmpty {
            StudioInfoRow("Cadence", cadence)
        }
        if let flight = P.infoFlight(cues) {
            StudioInfoRow("Flight", flight)
        }
    }

    // MARK: - a photograph

    @ViewBuilder
    private var photoSections: some View {
        if hasTelemetry {
            DevelopSection(id: "studio.info.exposure", title: "Exposure", badge: "EXIF", remember: .local) {
                exposureRows
            }
            DevelopSection(id: "studio.info.place", title: "Place and time", badge: "EXIF", remember: .local) {
                StudioInfoRow("Lat", data["latitude"])
                StudioInfoRow("Lon", data["longitude"])
                StudioInfoRow("Altitude", data["abs_alt"], suffix: " m")
                StudioInfoRow("Taken", cue?.timestamp)
            }
        } else {
            DevelopSection(id: "studio.info.exposure", title: "Exposure", remember: .local) {
                StudioInfoEmpty("No EXIF in this file.")
            }
        }
    }

    @ViewBuilder
    private var exposureRows: some View {
        StudioInfoRow("ISO", data["iso"])
        StudioInfoRow("Shutter", data["shutter"])
        StudioInfoRow("Aperture", aperture)
        StudioInfoRow("EV", data["ev"])
        StudioInfoRow("Focal", data["focal_len"], suffix: " mm")
    }

    private var aperture: String? {
        guard let fnum = data["fnum"], !fnum.isEmpty else { return nil }
        return "f/\(fnum)"
    }

    // MARK: - a clip

    @ViewBuilder
    private var clipSections: some View {
        if hasTelemetry {
            let motion = motionAt(cue)
            DevelopSection(id: "studio.info.flight", title: "Flight", badge: "At playhead", remember: .local) {
                StudioInfoRow("Rel. alt", data["rel_alt"], suffix: " m")
                StudioInfoRow("Abs. alt", data["abs_alt"], suffix: " m")
                StudioInfoRow("Speed", formatGroundSpeed(motion.groundSpeed))
                StudioInfoRow("V. speed", formatVerticalSpeed(motion.verticalSpeed))
                StudioInfoRow("Heading", formatHeading(motion.heading))
                StudioInfoRow("Lat", data["latitude"])
                StudioInfoRow("Lon", data["longitude"])
                StudioInfoRow("Frame", cue?.frame.map { String($0) })
                StudioInfoRow("Time", cue?.timestamp)
            }
            DevelopSection(id: "studio.info.camera", title: "Camera", badge: "At playhead", remember: .local) {
                exposureRows
                StudioInfoRow("Profile", data["color_md"])
                StudioInfoRow("WB", data["ct"], suffix: " K")
            }
        } else {
            DevelopSection(id: "studio.info.flight", title: "Flight", remember: .local) {
                StudioInfoEmpty("No flight log (.srt) with this clip — the inspector shows live telemetry when one is present.")
            }
        }
    }
}

/// One label/value row; a missing value reads `—` in the faint ink.
private struct StudioInfoRow: View {
    let label: String
    let value: String?
    let suffix: String?
    @Environment(\.palette) private var palette

    init(_ label: String, _ value: String?, suffix: String? = nil) {
        self.label = label
        self.value = value
        self.suffix = suffix
    }

    var body: some View {
        let empty = (value ?? "").isEmpty
        let shown = empty ? "—" : "\(value ?? "")\(suffix ?? "")"
        return OverlayPanelRow(label) {
            Text(verbatim: shown)
                .font(Brand.mono(12))
                .monospacedDigit()
                .foregroundStyle(empty ? palette.faint : palette.ink)
                .lineLimit(1)
                .truncationMode(.tail)
                .textSelection(.enabled)
                .help(empty ? "" : shown)
        }
    }
}

private struct StudioInfoEmpty: View {
    let text: String
    @Environment(\.palette) private var palette

    init(_ text: String) { self.text = text }

    var body: some View {
        Text(verbatim: text)
            .font(Brand.sans(12))
            .foregroundStyle(palette.muted)
            .fixedSize(horizontal: false, vertical: true)
    }
}

// MARK: - previews

#Preview("Info — a DJI clip at the playhead") {
    DevelopPreviewState(true) { _ in
        InfoPanelView(baseName: "DJI_0001", fileBytes: 412_000_000, detail: "3840 × 2160 · HEVC · 29.97 fps",
                      duration: 4, cues: OverlayPanelFixtures.cues, cue: OverlayPanelFixtures.cue,
                      timing: OverlayPanelFixtures.timing, scale: OverlayPanelFixtures.timing.scale)
    }
}

#Preview("Info — a photograph") {
    DevelopPreviewState(true) { _ in
        let cue = OverlayPanelFixtures.photoCue
        InfoPanelView(baseName: "DSC00123", fileBytes: 9_800_000, detail: "7008 × 4672 · JPEG",
                      cues: cue.map { [$0] } ?? [], cue: cue, photo: OverlayPanelFixtures.photo)
    }
}

#Preview("Info — a clip with no log") {
    DevelopPreviewState(true) { _ in
        InfoPanelView(baseName: "IMG_0420", fileBytes: 88_000_000, detail: "1920 × 1080 · H.264 · 30 fps", duration: 12)
    }
}
