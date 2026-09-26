// A piece's deck as stills — the web's `renderDeck` (`deck-export.ts`) and
// `badgeToPng`: the same render the stage draws (`SlideRenderer`), run once
// per slide at the deliverable's size, each slide's picture decoded again at
// its OWN density (a preview budget is a preview's alone).
//
// Rules kept (`DeckExport.swift`, `roadtrip.md`):
// - One long edge for every still of a deck (`deckLongEdge`, 1920).
// - A file is numbered against the WHOLE deck, never against the subset
//   being written (`deckStills`): a carousel's third picture is `03` even
//   when it is the only still.
// - A still is SETTLED: the hook past its badge's entrances, any collage
//   past its cells' entrance — no clock is handed to the renderer.
// - A slide that cannot be decoded costs THAT slide, never the run; a slide
//   whose picture is gone still renders its badge or caption over the flat
//   ground. The caller compares what came back with the deck to say how many
//   fell out.
// - PNG by default — lossless, since text is the point; JPEG on request, the
//   name's extension following what the file is.
// - Cancellable between two slides (T4 of `docs/progress-feedback.md`): what
//   rendered is kept, and the caller says how many.

import AtelierKit
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// What a still is written as.
enum TripStillFormat: Equatable {
    case png
    case jpeg(quality: Double)

    var fileExtension: String {
        switch self {
        case .png: return "png"
        case .jpeg: return "jpg"
        }
    }
}

/// One file a delivery wrote, under the name it goes out with.
struct TripDeliveredFile: Equatable {
    let name: String
    let url: URL
}

enum TripStillEncoding {
    /// A rendered frame as a file's bytes, tagged sRGB (the codes are sRGB
    /// codes throughout). Nil when the encoder refused.
    static func encode(_ image: CGImage, _ format: TripStillFormat) -> Data? {
        let out = NSMutableData()
        let type: UTType
        var options: [CFString: Any] = [:]
        switch format {
        case .png:
            type = .png
        case .jpeg(let quality):
            type = .jpeg
            options[kCGImageDestinationLossyCompressionQuality] = max(0, min(1, quality))
        }
        guard let destination = CGImageDestinationCreateWithData(out as CFMutableData, type.identifier as CFString, 1, nil)
        else { return nil }
        CGImageDestinationAddImage(destination, image, options as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { return nil }
        return out as Data
    }

    /// `slideFileName`'s `.png` name turned into the format's own extension.
    static func name(_ pngName: String, _ format: TripStillFormat) -> String {
        guard format != .png, pngName.hasSuffix(".png") else { return pngName }
        return String(pngName.dropLast(4)) + "." + format.fileExtension
    }
}

/// Where a delivery is written: a fresh folder under the temporary directory,
/// which the caller moves or shares — and removes.
enum TripDeliveryFolder {
    static func make(_ label: String) throws -> URL {
        let slug = label.isEmpty ? "trip" : label
        let folder = FileManager.default.temporaryDirectory
            .appendingPathComponent("Atelier-Trips", isDirectory: true)
            .appendingPathComponent("\(slug)-\(UUID().uuidString.prefix(8))", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder
    }
}

enum DeckStillsExport {
    /// The decoded pictures one slide is painted over, at their own density.
    static func sources(_ slide: DeckSlide, resolve: (SavedMediaRef) async -> URL?) async -> SlideSources {
        if let collage = slide.collage {
            let lead = CollageLead(media: slide.media, framing: slide.framing, develop: slide.develop, motion: slide.motion)
            let cells = await BadgeSources.loadCollage(lead, videoSeconds: slide.videoTimeSeconds, collage, resolve: resolve)
            return SlideSources(cells: cells)
        }
        guard let ref = slide.media, let url = await resolve(ref) else { return .empty }
        let lead = try? await BadgeSources.load(url, name: ref.name, videoSeconds: slide.videoTimeSeconds)
        return SlideSources(lead: lead)
    }

    /// Every still of the deck `include` keeps (all, absent), in swipe order,
    /// written into `folder`. `hookSeconds` is the badge's settled second — a
    /// still is taken there, never mid-entrance. `renderer` carries the trip,
    /// the piece, the opener's pictures and the camera credit, exactly as the
    /// stage drew them.
    static func render(_ renderer: SlideRenderer, hookSeconds: Double, longEdge: Double = Double(deckLongEdge),
                       format: TripStillFormat = .png, include: ((DeckSlide) -> Bool)? = nil, into folder: URL,
                       resolve: (SavedMediaRef) async -> URL?,
                       onProgress: ((_ done: Int, _ total: Int) -> Void)? = nil,
                       isCancelled: () -> Bool = { false }) async -> [TripDeliveredFile] {
        let stills = deckStills(renderer.trip, renderer.post, renderer.aspect, hookSeconds, include: include)
        let size = frameSize(renderer.aspect, longEdge)
        let width = Int(size.width)
        let height = Int(size.height)
        await renderer.looks.prepare(renderer.trip, renderer.post)
        var out: [TripDeliveredFile] = []
        for (i, still) in stills.enumerated() {
            if isCancelled() { break }
            let decoded = await DeckStillsExport.sources(still.slide, resolve: resolve)
            if let image = renderer.image(still.slide, decoded, at: still.timeSeconds, width: width, height: height),
               let data = TripStillEncoding.encode(image, format) {
                let name = TripStillEncoding.name(still.name, format)
                let url = folder.appendingPathComponent(name)
                if (try? data.write(to: url, options: .atomic)) != nil {
                    out.append(TripDeliveredFile(name: name, url: url))
                }
            }
            // Each slide's pictures go with it: a deck of ten must not hold ten.
            decoded.lead?.release()
            for cell in decoded.cells { cell?.release() }
            onProgress?(i + 1, stills.count)
        }
        return out
    }
}
