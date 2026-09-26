// What one photograph says about itself — `src/tools/exif/use-exif.ts`,
// native: the head of the file read (never the whole picture), parsed by the
// kernel's EXIF reader through `readEffectiveExif`, and — for a RAW — the
// kernel's RAW probe on the first megabyte: the sensor plane, the render its
// camera wrote inside it, the calibration its `OpcodeList3` asks for.
//
// No source vouches for anything here yet: the web's "via <instance>" column
// (a Winnow proxy carries no EXIF, the instance's record fills it) waits on
// the native Sources; a file opened from Files or Photos speaks for itself.

import CoreGraphics
import Foundation
import Observation
import AtelierKit

struct ExifPhotoRead: Sendable {
    /// File over source, field by field — today the file alone.
    let effective: EffectiveExif
    /// What the RAW's own IFDs say, when it is a RAW the probe could walk.
    let raw: RawProbe?
    /// Its two sizes as SHOWN (the sensor, the render inside it).
    let rawSizes: RawSizes?
    /// The decoded picture's own size as shown — the Image panel's fallback
    /// when the EXIF does not state one.
    let shownWidth: Int?
    let shownHeight: Int?

    /// Read `url` (blocking: call off the main actor).
    static func read(_ url: URL) -> ExifPhotoRead {
        let head = InstrumentImages.head(url, count: exifSliceBytes)
        let effective = readEffectiveExif(head, nil)
        var probe: RawProbe? = nil
        var sizes: RawSizes? = nil
        if isRawImage(url.lastPathComponent), let rawHead = InstrumentImages.head(url, count: rawProbeBytes) {
            probe = probeRaw(rawHead)
            sizes = rawSizesFrom(rawHead)
        }
        let shown = InstrumentImages.shownSize(url)
        return ExifPhotoRead(effective: effective, raw: probe, rawSizes: sizes,
                             shownWidth: shown?.width, shownHeight: shown?.height)
    }

    /// The EXIF with the decoded size filled in where the file did not state
    /// one — the web's `data` merge in `DetailView.tsx`.
    var panelData: ExifData {
        var data = effective.exif
        if data.pixelWidth == nil, let w = shownWidth { data.pixelWidth = Double(w) }
        if data.pixelHeight == nil, let h = shownHeight { data.pixelHeight = Double(h) }
        return data
    }
}

/// A photo's EXIF and preview, read once per file identity for as long as the
/// screen lives — a card and the full view ask for the same file.
@MainActor
@Observable
final class ExifReads {
    static let shared = ExifReads()

    private(set) var reads: [String: ExifPhotoRead] = [:]
    private var reading: Set<String> = []

    func read(for ref: SavedMediaRef) -> ExifPhotoRead? {
        reads[fileIdentity(ref)]
    }

    func load(_ ref: SavedMediaRef, from url: URL) async {
        let key = fileIdentity(ref)
        guard reads[key] == nil, !reading.contains(key) else { return }
        reading.insert(key)
        let result = await Task.detached(priority: .userInitiated) { ExifPhotoRead.read(url) }.value
        reads[key] = result
        reading.remove(key)
    }

    /// A read already made — previews.
    func seed(_ ref: SavedMediaRef, _ read: ExifPhotoRead) {
        reads[fileIdentity(ref)] = read
    }
}

/// A decoded preview of a picture, held by the view that shows it.
@MainActor
@Observable
final class PicturePreview {
    private(set) var image: CGImage?
    private(set) var failed = false
    private var loaded: URL?

    func load(_ url: URL?, maxPixel: Int) async {
        guard let url, url != loaded else { return }
        loaded = url
        failed = false
        image = nil
        let decoded = await Task.detached(priority: .userInitiated) {
            InstrumentImages.thumbnail(url, maxPixel: maxPixel)
        }.value
        guard loaded == url else { return }
        image = decoded
        failed = decoded == nil
    }

    /// A picture already in hand — previews.
    func adopt(_ image: CGImage?) {
        self.image = image
        failed = image == nil
    }
}
