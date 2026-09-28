// What the Library's previews draw: a pool of session files that do not
// exist (their covers say so), an instance that answers a day of three rows
// from memory, a Develop verb, a lightbox over drawn pictures. Nothing here is
// read by the app itself, and nothing asks the network.

import CoreGraphics
import Foundation
import SwiftUI
import AtelierKit

enum LibraryFixtures {
    /// A picture drawn in memory — a warm gradient, so a preview shows pixels.
    static func picture(_ width: Int = 480, _ height: Int = 320, hue: CGFloat = 0.06) -> CGImage? {
        guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                      space: CGColorSpaceCreateDeviceRGB(),
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        let top = CGColor(red: 0.95, green: 0.62 + hue, blue: 0.36, alpha: 1)
        let bottom = CGColor(red: 0.18, green: 0.2, blue: 0.32 + hue, alpha: 1)
        if let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: [top, bottom] as CFArray,
                                     locations: [0, 1]) {
            context.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: 0, y: height), options: [])
        }
        return context.makeImage()
    }

    private static func session(_ name: String, _ size: Int, assetId: String? = nil) -> LibraryEntry {
        let ref = SavedMediaRef(name: name, size: size, lastModified: 1_758_000_000_000, assetId: assetId)
        return LibraryEntry(ref: ref, location: .session("/nonexistent/\(name)"))
    }

    /// A pool: a JPEG shot beside its DNG, a clip with its flight log, a photo
    /// from an instance.
    static let entries: [LibraryEntry] = [
        session("DJI_0101.JPG", 683_000),
        session("DJI_0101.DNG", 20_000_000),
        session("DJI_0001.MP4", 1_500_000_000),
        session("DJI_0001.SRT", 42_000),
        session("DSC00123.webp", 480_000, assetId: "winnow.example/123"),
    ]

    static var covers: [String: LibraryCover] {
        let still = picture()
        return [
            "dji_0101": LibraryCover(facts: CoverFacts(status: .ready, isVideo: false, width: 4000, height: 3000,
                                                       imageType: "JPEG"), thumbnail: still),
            "dji_0001": LibraryCover(facts: CoverFacts(status: .ready, isVideo: true, width: 3840, height: 2160,
                                                       duration: 63), thumbnail: picture(hue: 0.2)),
            "dsc00123": LibraryCover(facts: CoverFacts(status: .ready, isVideo: false, width: 2048, height: 1365,
                                                       imageType: "WEBP"), thumbnail: picture(hue: 0.12)),
        ]
    }

    @MainActor
    static var library: LibraryStore {
        LibraryStore.preview(entries, covers: covers)
    }

    /// One instance's day: two photographs (one a RAW + JPEG pair) and a clip.
    static let rows: [JSONValue] = [
        [
            "id": 101, "filename": "DJI_0101.JPG", "session_id": 7, "media_type": "photo",
            "captured_at": "2026-02-12T09:41:07+00:00", "width": 4032, "height": 3024, "file_size": 5_400_000,
            "camera_model": "FC8482", "iso": 100, "shutter": "1/240", "aperture": 1.7, "focal_length": 6.7,
            "group_kind": "raw_jpeg", "companion_id": 102, "companion_filename": "DJI_0101.DNG",
            "companion_media_type": "photo", "companion_file_size": 74_000_000,
        ],
        [
            "id": 103, "filename": "DJI_0103.JPG", "session_id": 7, "media_type": "photo",
            "captured_at": "2026-02-12T10:02:00+00:00", "width": 4032, "height": 3024, "file_size": 5_100_000,
        ],
        [
            "id": 104, "filename": "DJI_0104.MP4", "session_id": 7, "media_type": "video",
            "captured_at": "2026-02-12T18:02:00+00:00", "width": 3840, "height": 2160, "duration_s": 63,
            "file_size": 1_500_000_000, "has_telemetry": true,
        ],
    ]

    /// An instance that answers from memory: the day's rows, a quiet calendar.
    static let transport: WinnowTransport = { request in
        switch request.path {
        case "/api/assets":
            return WinnowResponse.json(["assets": .array(rows), "next_cursor": .null])
        case "/api/assets/calendar":
            return WinnowResponse.json(["days": [["date": "2026-02-12", "count": 3], ["date": "2026-02-14", "count": 8]],
                                        "bounds": ["min": "2025-01-03", "max": "2026-09-20"]])
        case "/api/capabilities":
            return WinnowResponse.json(["api": ["version": 1], "media": ["sidecars": true],
                                        "viewer": ["id": 1, "username": "steeve", "role": "admin"]])
        case "/api/facets":
            return WinnowResponse.json(["media_types": [["value": "photo", "count": 2], ["value": "video", "count": 1]],
                                        "extensions": [["value": "jpg", "count": 2], ["value": "mp4", "count": 1]],
                                        "devices": [["value": "FC8482", "count": 3]]])
        case "/api/sessions":
            return WinnowResponse.json(["sessions": [["id": 7, "name": "DCIM · Kalbarri", "source_path": "/ingest/2026-02-12",
                                                      "device_hint": "FC8482", "captured_at_min": "2026-02-12T09:41:07+00:00",
                                                      "captured_at_max": "2026-02-12T18:02:00+00:00", "asset_count": 3]]])
        default:
            return WinnowResponse(status: 404)
        }
    }

    @MainActor
    static var connections: ConnectionStore {
        ConnectionStore.preview(connections: [(host: "winnow.example", sheet: ConnectionStore.previewSheet)],
                                transport: transport)
    }

    /// A client that refuses every thumbnail — a tile that gives up.
    static let refusingClient = WinnowClient(config: WinnowConfig(baseUrl: "https://winnow.example", auth: .cookie),
                                             transport: { _ in WinnowResponse(status: 503) })

    /// The Develop tool's verb, as the gallery publishes it.
    static var developOffer: MediaActions {
        MediaActions(key: "preview", heading: "starts a new roll with this picture",
                     actions: [MediaAction(id: "new-roll", label: "Develop", hint: "a new roll from this picture") { _ in }])
    }

    /// A lightbox over three drawn pictures, one of them with its capture's files.
    struct LightboxPreview: View {
        @State private var index = 0
        @State private var viewing: String?

        var body: some View {
            MediaLightbox(items: LibraryFixtures.lightboxItems, index: $index, from: "in your library",
                          files: LibraryFixtures.lightboxFiles, viewing: $viewing, onClose: {}) {
                MediaActionRow(offer: LibraryFixtures.developOffer, lead: true) { _ in }
            }
        }
    }

    static var lightboxItems: [LightboxItem] {
        [0.02, 0.12, 0.22].enumerated().map { at, hue in
            var item = LightboxItem(id: "p\(at)", title: "DJI_010\(at + 1)", facts: "4000×3000 · JPEG + DNG · 20.7 MB")
            item.camera = "FC8482 · 6.7 mm · ƒ/1.7 · 1/240 · ISO 100"
            if let image = picture(1200, 800, hue: CGFloat(hue)) {
                item.source = .pixels(LightboxPixels(id: "fixture-\(at)", image: image))
            }
            item.natural = CGSize(width: 1200, height: 800)
            return item
        }
    }

    static var lightboxFiles: [LightboxFile] {
        [
            LightboxFile(id: "delivered:dji_0101.jpg", label: "DJI_0101.JPG", facts: "the file itself · 4000 × 3000 · 683 kB"),
            LightboxFile(id: "delivered:dji_0101.dng", label: "DJI_0101.DNG",
                         facts: "the render the camera wrote inside the RAW · 960 × 540 · 20 MB",
                         unavailable: "this file carries no render a browser can draw"),
        ]
    }
}
