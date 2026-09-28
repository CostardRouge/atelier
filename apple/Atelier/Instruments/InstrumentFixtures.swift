// Fixture data for the instruments' previews: a DJI flight log written in the
// `.srt`'s own format (and parsed by the kernel's own parser, so a preview
// shows what a real file would), a photograph's EXIF, a picture drawn in code,
// and a shelf holding them. Never read by the app outside a `#Preview`.

import CoreGraphics
import Foundation
import AtelierKit

enum InstrumentFixtures {
    /// A flight of `count` cues at 30 fps: a loop over Guadeloupe's coast,
    /// climbing from 20 to 60 m, the exposure a D-Log clip's.
    static func srt(count: Int = 600) -> String {
        var blocks: [String] = []
        for i in 0..<count {
            let t0 = Double(i) / 30
            let t1 = Double(i + 1) / 30
            let angle = Double(i) / Double(count) * 2 * Double.pi
            let lat = 16.05687 + 0.0012 * sin(angle)
            let lon = -61.748979 + 0.0018 * (1 - cos(angle))
            let rel = 20 + 40 * Double(i) / Double(count)
            let clock = 34.609 + t0
            let seconds = Int(clock)
            let millis = Int(((clock - Double(seconds)) * 1000).rounded())
            let stamp = String(format: "2026-05-30 05:49:%02d.%03d", seconds, min(999, millis))
            let block = """
            \(i + 1)
            \(timecode(t0)) --> \(timecode(t1))
            <font size="28">FrameCnt: \(i + 1), DiffTime: 33ms
            \(stamp)
            [iso: 100] [shutter: 1/500.0] [fnum: 1.7] [ev: 0] [color_md: dlog_m] [focal_len: 24.00] [latitude: \(String(format: "%.6f", lat))] [longitude: \(String(format: "%.6f", lon))] [rel_alt: \(String(format: "%.3f", rel)) abs_alt: \(String(format: "%.3f", rel + 45))] [ct: 5300] </font>
            """
            blocks.append(block)
        }
        return blocks.joined(separator: "\n\n")
    }

    private static func timecode(_ seconds: Double) -> String {
        let total = Int((seconds * 1000).rounded())
        let h = total / 3_600_000
        let m = (total / 60_000) % 60
        let s = (total / 1000) % 60
        let ms = total % 1000
        return String(format: "%02d:%02d:%02d,%03d", h, m, s, ms)
    }

    static let track = TelemetryTrack(text: srt())

    static let videoRef = SavedMediaRef(name: "DJI_0001.MP4", size: 412_000_000, lastModified: 1_780_000_000_000)
    static let srtRef = SavedMediaRef(name: "DJI_0001.SRT", size: 180_000, lastModified: 1_780_000_000_000)
    static let photoRef = SavedMediaRef(name: "DSC00123.JPG", size: 9_800_000, lastModified: 1_780_000_000_000)
    static let rawRef = SavedMediaRef(name: "DJI_0202.DNG", size: 74_000_000, lastModified: 1_780_000_000_000)

    static let exif = ExifData(
        make: "SONY", model: "ILCE-7CM2", lensMake: "Sony", lensModel: "FE 24-70mm F2.8 GM II",
        software: "ILCE-7CM2 v1.01", artist: "Steeve Pommier",
        iso: 400, exposureTime: 0.005, fNumber: 2.8, focalLength: 35, focalLength35: 35,
        exposureBias: -0.7, exposureProgram: 3, meteringMode: 5, whiteBalance: 0, flash: 16,
        pixelWidth: 7008, pixelHeight: 4672, orientation: 1,
        dateTimeOriginal: "2026:05:30 05:49:34", gps: GpsCoord(lat: 16.05687, lon: -61.748979), gpsAltitude: 80.2
    )

    /// The shared shelf holding a DJI clip + its log and a photograph; the
    /// log is seeded into the cache so a preview shows a parsed track at
    /// once. The URLs point nowhere: a preview draws its placeholders for the
    /// media.
    @MainActor
    @discardableResult
    static func shelf() -> InstrumentShelf {
        let folder = URL(fileURLWithPath: "/fixtures", isDirectory: true)
        let entries = [videoRef, srtRef, photoRef].map { ref in
            InstrumentShelf.Entry(ref: ref, url: folder.appendingPathComponent(ref.name), scoped: false, owned: false)
        }
        TelemetryTracks.shared.seed(srtRef, track)
        InstrumentShelf.shared.adopt(fixture: entries)
        return InstrumentShelf.shared
    }

    /// A picture drawn in code: a warm-to-cool gradient with a horizon, so a
    /// look or a wipe has something to act on.
    static func picture(width: Int = 1200, height: Int = 800, warm: Bool = true) -> CGImage? {
        guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                      space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        let top: [CGFloat] = warm ? [0.95, 0.62, 0.32, 1] : [0.35, 0.55, 0.85, 1]
        let bottom: [CGFloat] = warm ? [0.22, 0.16, 0.12, 1] : [0.08, 0.12, 0.2, 1]
        let colors = [CGColor(srgbRed: top[0], green: top[1], blue: top[2], alpha: 1),
                      CGColor(srgbRed: bottom[0], green: bottom[1], blue: bottom[2], alpha: 1)] as CFArray
        if let gradient = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: colors, locations: [0, 1]) {
            context.drawLinearGradient(gradient, start: CGPoint(x: 0, y: CGFloat(height)), end: .zero, options: [])
        }
        context.setFillColor(CGColor(srgbRed: 0.1, green: 0.1, blue: 0.1, alpha: 0.6))
        context.fill(CGRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height) * 0.3))
        return context.makeImage()
    }
}
