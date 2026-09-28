// A look's TILE — the 96-pixel square the picker draws — read, sampled and
// baked. The web's `LutThumb.tsx`, `builtin-thumbs.ts` and `pack-thumbs.ts`.
//
// Three kinds of tile, one reader:
// - a BUILT-IN's (and a film stock's) was baked once by
//   `scripts/gen-lut-thumbs.mjs` and ships in the bundle as a WebP file
//   (`BuiltinLutFiles.thumbs`) — opening the picker parses no `.cube` at all;
// - a PACK look's was baked at IMPORT on the reference its family asks for and
//   lives in the pack's index as a data URL — a WebP one written by the web,
//   a JPEG one written here (ImageIO reads WebP and cannot write it; the web
//   itself falls back to PNG where a browser writes no WebP, and an `<img>`
//   reads any of them);
// - a LIVE tile is a look baked on the host's own picture, or on the
//   synthetic chart where a look has no tile at all.
//
// Every bake goes through the RENDER GRAPH's cube pass (`FrameGrader`,
// tetrahedral unless the person asked otherwise) — the very pass the stage
// and the export draw a look with, so a tile cannot disagree with the
// picture. Which reference a look is judged on is the whole point of a
// tile: a conversion LUT read on a display-referred picture previews
// over-contrasted, so a log look is baked on the D-Log M frame.

import CoreGraphics
import CoreImage
import Foundation
import ImageIO
import UniformTypeIdentifiers
import AtelierKit

final class LookTiles: @unchecked Sendable {
    static let shared = LookTiles()

    /// How many decoded tiles are kept — a screenful of rail nodes, twice.
    static let capacity = 240

    private let lock = NSLock()
    private var images: [String: CGImage] = [:]
    private var order: [String] = []
    private var references: [PackFamily: CIImage] = [:]

    // MARK: - reading a tile

    /// The tile a gallery item carries — a bundled file's path or a data URL —
    /// decoded once and kept; nil when it cannot be read (the grid then says
    /// `failed` or bakes the look live).
    func image(_ thumb: String) -> CGImage? {
        lock.lock()
        if let known = images[thumb] {
            lock.unlock()
            return known
        }
        lock.unlock()
        guard let decoded = LookTiles.decode(thumb) else { return nil }
        lock.lock()
        images[thumb] = decoded
        order.append(thumb)
        if order.count > LookTiles.capacity {
            let evicted = order.removeFirst()
            images[evicted] = nil
        }
        lock.unlock()
        return decoded
    }

    private static func decode(_ thumb: String) -> CGImage? {
        let source: CGImageSource?
        if thumb.hasPrefix("data:") {
            guard let comma = thumb.firstIndex(of: ","),
                  thumb[..<comma].hasSuffix(";base64"),
                  let data = Data(base64Encoded: String(thumb[thumb.index(after: comma)...])) else { return nil }
            source = CGImageSourceCreateWithData(data as CFData, nil)
        } else {
            source = CGImageSourceCreateWithURL(URL(fileURLWithPath: thumb) as CFURL, nil)
        }
        guard let source else { return nil }
        return CGImageSourceCreateImageAtIndex(source, 0, nil)
    }

    // MARK: - samples

    /// The frame a look of `family` is judged on — its reference, centred
    /// square at the tile size — kept for the session: a 25-look import bakes
    /// on two pictures. Nil where the build ships no reference.
    func referenceSample(_ family: PackFamily) -> CIImage? {
        lock.lock()
        if let known = references[family] {
            lock.unlock()
            return known
        }
        lock.unlock()
        guard let url = BuiltinLutFiles.referenceURL(family),
              let picture = CIImage(contentsOf: url, options: [.applyOrientationProperty: true, .colorSpace: NSNull()])
        else { return nil }
        let sample = LookTiles.sample(of: picture)
        lock.lock()
        references[family] = sample
        lock.unlock()
        return sample
    }

    /// `picture`'s centred square, brought down to the tile size — the web's
    /// `sampleFromImage` (a centred crop, drawn into a 96 px canvas).
    static func sample(of picture: CIImage, size: Int = previewSampleSize) -> CIImage {
        let extent = picture.extent
        guard !extent.isInfinite, extent.width > 0, extent.height > 0 else { return syntheticSample(size) }
        let side = min(extent.width, extent.height)
        let square = CGRect(x: extent.midX - side / 2, y: extent.midY - side / 2, width: side, height: side)
        let cropped = picture.cropped(to: square)
            .transformed(by: CGAffineTransform(translationX: -square.minX, y: -square.minY))
        return FrameGrader.resampled(cropped, scale: Double(size) / Double(side)).image
    }

    /// The procedural chart a look is shown on when nothing else is offered —
    /// the kernel's `syntheticPreviewSample`, as an image the graph can read.
    static func syntheticSample(_ size: Int = previewSampleSize) -> CIImage {
        image(of: syntheticPreviewSample(size)).map { CIImage(cgImage: $0, options: [.colorSpace: NSNull()]) }
            ?? CIImage(color: CIColor(red: 0.5, green: 0.5, blue: 0.5)).cropped(to: CGRect(x: 0, y: 0, width: size, height: size))
    }

    /// An RGBA8 bitmap (`RgbBitmap`, `ImageData`'s layout) as a picture.
    static func image(of bitmap: RgbBitmap) -> CGImage? {
        guard bitmap.width > 0, bitmap.height > 0, bitmap.data.count >= bitmap.width * bitmap.height * 4,
              let provider = CGDataProvider(data: Data(bitmap.data) as CFData) else { return nil }
        let info = CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipLast.rawValue)
        return CGImage(width: bitmap.width, height: bitmap.height, bitsPerComponent: 8, bitsPerPixel: 32,
                       bytesPerRow: bitmap.width * 4, space: RenderContexts.srgb, bitmapInfo: info,
                       provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent)
    }

    // MARK: - baking

    /// `lut` on `sample` at `intensity`, through the render graph's cube pass —
    /// `mix(original, graded, intensity)`, the renderer's own blend. A nil
    /// look hands the sample back: the "original" tile.
    static func bake(_ lut: CubeLut?, on sample: CIImage, intensity: Double, interpolation: Interpolation) -> CGImage? {
        guard let lut else { return FrameGrader.cgImage(sample) }
        let grader = FrameGrader(lut: lut, intensity: intensity, interpolation: interpolation)
        return FrameGrader.cgImage(grader.render(source: sample))
    }

    /// A look baked on its family's reference, as a data URL small enough to
    /// live in a pack's index (~5 KB) — what an import stores per look. Nil
    /// when it cannot be baked: a missing tile is never a failed import.
    func bakeThumb(_ lut: CubeLut, _ family: PackFamily, _ interpolation: Interpolation) -> String? {
        let sample = referenceSample(family) ?? LookTiles.syntheticSample()
        guard let tile = LookTiles.bake(lut, on: sample, intensity: 1, interpolation: interpolation) else { return nil }
        return LookTiles.dataURL(tile)
    }

    /// A tile as a JPEG data URL.
    static func dataURL(_ image: CGImage, quality: Double = 0.82) -> String? {
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data as CFMutableData, UTType.jpeg.identifier as CFString, 1, nil)
        else { return nil }
        let options: [CFString: Any] = [kCGImageDestinationLossyCompressionQuality: quality]
        CGImageDestinationAddImage(destination, image, options as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { return nil }
        return "data:image/jpeg;base64," + (data as Data).base64EncodedString()
    }
}
