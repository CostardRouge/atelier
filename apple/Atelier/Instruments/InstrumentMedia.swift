// Reading what the instruments show — a picture's preview, its head bytes,
// a clip's poster and length, a flight log parsed — off the main thread, from
// the file where it is. Nothing here is persisted; the web's cards read the
// same things lazily as they scroll into view.

import AVFoundation
import CoreGraphics
import Foundation
import ImageIO
import Observation
import AtelierKit

enum InstrumentImages {
    /// A preview of at most `maxPixel` on its long edge, turned upright by the
    /// file's own orientation — through ImageIO, which decodes a RAW's
    /// embedded render too (the web's cards say "preview unavailable" there;
    /// a device can draw it).
    static func thumbnail(_ url: URL, maxPixel: Int) -> CGImage? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixel,
            kCGImageSourceShouldCacheImmediately: true,
        ]
        return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
    }

    /// The picture's own pixel size as SHOWN (a quarter-turn swaps the axes) —
    /// what fills the Image panel when the EXIF does not say.
    static func shownSize(_ url: URL) -> (width: Int, height: Int)? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = props[kCGImagePropertyPixelWidth] as? Int,
              let height = props[kCGImagePropertyPixelHeight] as? Int else { return nil }
        let orientation = props[kCGImagePropertyOrientation] as? Int ?? 1
        return orientation >= 5 ? (height, width) : (width, height)
    }

    /// The first `count` bytes of a file — the EXIF parser's slice, the RAW
    /// probe's megabyte — never the whole file.
    static func head(_ url: URL, count: Int) -> [UInt8]? {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return nil }
        defer { try? handle.close() }
        guard let data = try? handle.read(upToCount: count) else { return nil }
        return [UInt8](data)
    }

    /// A byte range of a file — what `rawSizes` and `rawCalibration` read with.
    static func range(_ url: URL, _ range: Range<Int>) throws -> [UInt8] {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        try handle.seek(toOffset: UInt64(range.lowerBound))
        let data = try handle.read(upToCount: range.count) ?? Data()
        return [UInt8](data)
    }

    /// The file's size in bytes.
    static func size(_ url: URL) -> Int {
        (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
    }
}

enum InstrumentClips {
    /// A clip's first frame, turned the way it plays.
    static func poster(_ url: URL, maxSize: CGSize) async -> CGImage? {
        let generator = AVAssetImageGenerator(asset: AVURLAsset(url: url))
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = maxSize
        return try? await generator.image(at: .zero).image
    }

    /// Seconds, or nil when the container does not say (the web's
    /// "duration unavailable").
    static func duration(_ url: URL) async -> Double? {
        guard let length = try? await AVURLAsset(url: url).load(.duration), length.isNumeric else { return nil }
        return length.seconds
    }
}

// MARK: - a flight log, parsed once

/// A `.srt` read: its cues (motion attached, the cadence measured), what the
/// cards and panels summarise, and the located track.
struct TelemetryTrack: Sendable {
    let cues: [Cue]
    let summary: TelemetrySummary
    /// Slow motion or time-lapse, measured from the clip's own clocks.
    let reading: TimeScaleReading
    let track: [TrackPoint]

    init(cues: [Cue]) {
        self.cues = cues
        summary = summarizeTelemetry(cues)
        reading = measureTimeScale(cues)
        track = extractTrack(cues)
    }

    /// Parse a `.srt`'s text — the kernel's `parseSrt`, cadence measured.
    init(text: String) {
        self.init(cues: parseSrt(text))
    }

    /// The cadence said as the Studio says it: `120 → 30 fps · 4× slow motion`,
    /// or nil for ordinary footage whose cadence the log does not state.
    var cadenceLine: String? {
        let parts = [formatCadence(reading), describeTimeScale(reading.scale)].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

/// Every log the instruments have read, by the file's identity: the card, the
/// full view, the map and the composer parse one `.srt` once.
@MainActor
@Observable
final class TelemetryTracks {
    static let shared = TelemetryTracks()

    enum State {
        case reading
        case unreadable
        case ready(TelemetryTrack)
    }

    private(set) var states: [String: State] = [:]

    /// What is known of `ref`'s log — nil until `load` is asked for it.
    func state(for ref: SavedMediaRef?) -> State? {
        guard let ref else { return nil }
        return states[fileIdentity(ref)]
    }

    /// The track, once read.
    func track(for ref: SavedMediaRef?) -> TelemetryTrack? {
        guard case .ready(let track)? = state(for: ref) else { return nil }
        return track
    }

    /// Read `ref`'s log from `url`, once: a second ask while it is being read,
    /// or after, costs nothing. Called from a view's `.task`, never its body.
    func load(_ ref: SavedMediaRef, from url: URL) async {
        let key = fileIdentity(ref)
        guard states[key] == nil else { return }
        states[key] = .reading
        let parsed = await Task.detached(priority: .userInitiated) { () -> TelemetryTrack? in
            guard let text = TelemetryTracks.text(url) else { return nil }
            return TelemetryTrack(text: text)
        }.value
        states[key] = parsed.map { State.ready($0) } ?? State.unreadable
    }

    /// A log already parsed — previews and fixtures.
    func seed(_ ref: SavedMediaRef, _ track: TelemetryTrack) {
        states[fileIdentity(ref)] = .ready(track)
    }

    /// A DJI `.srt` is UTF-8; anything else is tried as Latin-1 rather than refused.
    nonisolated static func text(_ url: URL) -> String? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1)
    }
}
