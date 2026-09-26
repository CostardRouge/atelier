// The pixel path: a picture decoded once, then composed — crop, cap, and the
// develop as ONE cube — through Core Image, for the stage and for the export
// alike. The rule that shapes it is the web's: preview = export by
// construction, because both take the very same recipe through the very same
// function, and the cube is the kernel's own bake (`composeLutStack`), so the
// numbers are the web app's numbers.
//
// The cube is drawn by the render graph (`Graph/FrameGrader.swift`): its
// `CubePass` samples the lattice TETRAHEDRALLY in a Metal kernel
// (`Kernels/Cube.metal`), the web shader's own maths — which retired
// `CIColorCubeWithColorSpace` and its trilinear lookup, the one measured gap
// there was in "preview = the web". The context is the graph's
// (`RenderContexts.shared`): half-float, no colour management, so the cube
// sees sRGB codes with headroom above white exactly as the web's float16
// buffers carry them.

import CoreImage
import ImageIO
import UniformTypeIdentifiers
import AtelierKit

/// A picture decoded once: oriented, full size, with the file's own metadata.
final class DecodedPicture {
    let image: CIImage
    let width: Int
    let height: Int
    /// ImageIO's read of the file: `{TIFF}`, `{Exif}`, `{GPS}` and the rest.
    let properties: [String: Any]
    let isRaw: Bool

    init(image: CIImage, properties: [String: Any], isRaw: Bool) {
        // Every extent starts at the origin, whatever the orientation did.
        let origin = image.extent.origin
        self.image = origin == .zero ? image : image.transformed(by: CGAffineTransform(translationX: -origin.x, y: -origin.y))
        self.width = Int(image.extent.width.rounded())
        self.height = Int(image.extent.height.rounded())
        self.properties = properties
        self.isRaw = isRaw
    }
}

enum PictureDecoder {
    static let rawExtensions: Set<String> = ["dng", "arw", "cr2", "cr3", "nef", "nrw", "raf", "orf", "rw2", "pef", "srw", "3fr", "erf", "x3f", "iiq"]

    static func isRaw(_ name: String) -> Bool {
        rawExtensions.contains((name as NSString).pathExtension.lowercased())
    }

    /// Decode a file's bytes. A RAW goes through Apple's own developer
    /// (`CIRAWFilter`, the sensor demosaiced by the system), the rest through
    /// ImageIO, oriented by the file's tag.
    ///
    /// Either way the picture enters the graph as CODES, the values the web's
    /// float16 buffers carry (`RenderContexts`). An 8-bit file enters as its
    /// own codes, never converted — right for an sRGB file; a Display P3 file
    /// (an iPhone's) has its P3 codes read AS sRGB ones, a little flatter than
    /// the browser, which converts to sRGB at decode. Not converted here yet,
    /// and recorded. A RAW's LINEAR light is brought onto the sRGB curve,
    /// which the colour-managed context used to do on the way out and a
    /// context with colour management off no longer does — reasoned, not
    /// measured: the RAW task measures `CIRAWFilter`'s output on CI.
    static func decode(_ data: Data, name: String) -> DecodedPicture? {
        let properties = fileProperties(data)
        if isRaw(name),
           let raw = CIRAWFilter(imageData: data, identifierHint: (name as NSString).pathExtension.lowercased()),
           let linear = raw.outputImage {
            let image = linear.applyingFilter("CILinearToSRGBToneCurve")
            return DecodedPicture(image: image, properties: properties, isRaw: true)
        }
        guard let image = CIImage(data: data, options: [.applyOrientationProperty: true, .colorSpace: NSNull()]) else {
            return nil
        }
        return DecodedPicture(image: image, properties: properties, isRaw: false)
    }

    private static func fileProperties(_ data: Data) -> [String: Any] {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [String: Any] else { return [:] }
        return props
    }
}

/// An aspect a roll may store, as the renderer reads it.
struct AspectOption: Identifiable, Equatable {
    let id: String
    let label: String
    let w: Double
    let h: Double

    static let original = AspectOption(id: "original", label: "Original", w: 0, h: 0)
    static let all: [AspectOption] = [original] + aspectPresets.map { AspectOption(id: $0.id, label: $0.label, w: $0.w, h: $0.h) }

    static func named(_ id: String) -> AspectOption {
        all.first { $0.id == id } ?? original
    }
}

final class PictureRenderer {
    static let shared = PictureRenderer()

    /// The stage's pixel budget — one 4K frame, never the media's own density
    /// (`device-memory.md`): a 48-megapixel still must not put its whole
    /// bitmap through the graph on every slider step.
    static let stageLongEdge = 2560
    static let thumbnailLongEdge = 240

    struct Recipe {
        var develop: DevelopSettings?
        var framing: Framing?
        var aspect: String = "original"
        /// A cap on the long edge, or nil for the picture's own size.
        var longEdge: Int?
    }

    /// The graph's own context (`RenderContexts`): half-float, no colour
    /// management — the cube sees sRGB codes with headroom, as the web's do.
    private let context = RenderContexts.shared
    private let srgb = RenderContexts.srgb
    private let lock = NSLock()
    /// The graph: today the cube alone; the passes come with their tasks.
    private let grader = FrameGrader()
    /// The develop baked once per develop: a repaint with the same numbers
    /// pays neither the bake nor the repack — the SAME `CubeLut` goes back to
    /// the grader, whose cube cache then answers on identity.
    private var bakeCache: (develop: DevelopSettings?, cube: CubeLut?)?

    /// The delivered frame for an aspect: the largest box of it inside the picture.
    static func deliveredSize(width: Int, height: Int, aspect: String) -> (width: Int, height: Int) {
        let option = AspectOption.named(aspect)
        guard option.w > 0, option.h > 0, width > 0, height > 0 else { return (width, height) }
        let want = option.w / option.h
        if Double(width) / Double(height) > want {
            return (Int((Double(height) * want).rounded()), height)
        }
        return (width, Int((Double(width) / want).rounded()))
    }

    /// The whole recipe on a decoded picture: crop, cap, develop.
    func compose(_ picture: DecodedPicture, recipe: Recipe) -> CIImage {
        var image = picture.image
        let framing = recipe.framing ?? .default
        let delivered = PictureRenderer.deliveredSize(width: picture.width, height: picture.height, aspect: recipe.aspect)

        // 1. The crop — the kernel's framing transform, in Core Image's y-up
        //    coordinates: the web's clockwise angle and downward pan flip sign.
        if !isDefaultFraming(framing) || delivered.width != picture.width || delivered.height != picture.height {
            let t = framingTransform(Double(picture.width), Double(picture.height), Double(delivered.width), Double(delivered.height), framing)
            var m = CGAffineTransform(translationX: -CGFloat(picture.width) / 2, y: -CGFloat(picture.height) / 2)
            m = m.concatenating(CGAffineTransform(scaleX: t.scale * t.mirrorX, y: t.scale * t.mirrorY))
            m = m.concatenating(CGAffineTransform(rotationAngle: -t.angle))
            m = m.concatenating(CGAffineTransform(translationX: t.panX, y: -t.panY))
            m = m.concatenating(CGAffineTransform(translationX: CGFloat(delivered.width) / 2, y: CGFloat(delivered.height) / 2))
            image = image.transformed(by: m).cropped(to: CGRect(x: 0, y: 0, width: delivered.width, height: delivered.height))
        }

        // 2. The cap. The develop is per pixel, so it commutes with a resample
        //    to within the resample's own rounding — and this is what keeps the
        //    stage inside its budget. The scale it took is handed to the graph,
        //    for a pass whose kernel is sized in SOURCE pixels.
        var scale = 1.0
        if let cap = recipe.longEdge, max(delivered.width, delivered.height) > cap {
            let fitted = FrameGrader.fit(image, longEdge: cap)
            image = fitted.image
            scale = fitted.scale
        }

        // 3. The develop, as the ONE cube the kernel bakes, drawn by the
        //    graph's cube pass — tetrahedrally, the web shader's way. The
        //    recipe is built under the lock and owes nothing to the grader
        //    afterwards, so the render itself runs outside it.
        lock.lock()
        defer { lock.unlock() }
        grader.setCube(bakedCubeLocked(for: recipe.develop))
        return grader.render(source: image, sourceScale: scale)
    }

    /// The develop's cube, baked once per develop (`sameDevelop`) — nil for
    /// a picture as shot, which the graph then leaves untouched. The lock is
    /// the caller's.
    private func bakedCubeLocked(for develop: DevelopSettings?) -> CubeLut? {
        if let hit = bakeCache, sameDevelop(hit.develop, develop) { return hit.cube }
        let cube = composeLutStack([], output: OutputTransform.none, interpolation: .tetrahedral, develop: develop)
        bakeCache = (develop, cube)
        return cube
    }

    /// Lanczos-resampled to `longEdge`, never up, the extent kept integral —
    /// the graph's own resampler.
    func scaled(_ image: CIImage, longEdge: Int) -> CIImage {
        FrameGrader.fit(image, longEdge: longEdge).image
    }

    // MARK: - out

    /// 8-bit pixels through the graph's context, tagged sRGB.
    func cgImage(_ image: CIImage) -> CGImage? {
        FrameGrader.cgImage(image, context: context)
    }

    /// RGBA bytes of the image shrunk to `longEdge` — what the histogram and
    /// the Auto verbs read, never the whole picture.
    func rgbaBytes(_ image: CIImage, longEdge: Int) -> [UInt8]? {
        let small = scaled(image, longEdge: longEdge)
        let width = Int(small.extent.width.rounded())
        let height = Int(small.extent.height.rounded())
        guard width > 0, height > 0 else { return nil }
        var bytes = [UInt8](repeating: 0, count: width * height * 4)
        bytes.withUnsafeMutableBytes { raw in
            guard let base = raw.baseAddress else { return }
            context.render(small, toBitmap: base, rowBytes: width * 4,
                           bounds: CGRect(x: 0, y: 0, width: width, height: height), format: .RGBA8, colorSpace: srgb)
        }
        return bytes
    }

    /// The composed picture encoded, carrying the ORIGINAL's metadata the way
    /// the web's `stamp-exif` does — orientation reset (the pixels are
    /// upright now), the size fields told the truth, and `Software: Atelier`
    /// so a derivative we wrote is never mistaken for a camera's file.
    func encode(_ image: CIImage, as type: UTType, quality: Double, source: DecodedPicture) -> Data? {
        guard let cg = cgImage(image) else { return nil }
        let out = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(out, type.identifier as CFString, 1, nil) else { return nil }

        var properties: [CFString: Any] = [
            kCGImageDestinationLossyCompressionQuality: quality,
            kCGImagePropertyOrientation: 1,
        ]
        var tiff = source.properties[kCGImagePropertyTIFFDictionary as String] as? [String: Any] ?? [:]
        tiff[kCGImagePropertyTIFFSoftware as String] = "Atelier"
        tiff[kCGImagePropertyTIFFOrientation as String] = 1
        properties[kCGImagePropertyTIFFDictionary] = tiff
        if var exif = source.properties[kCGImagePropertyExifDictionary as String] as? [String: Any] {
            exif[kCGImagePropertyExifPixelXDimension as String] = cg.width
            exif[kCGImagePropertyExifPixelYDimension as String] = cg.height
            properties[kCGImagePropertyExifDictionary] = exif
        }
        if let gps = source.properties[kCGImagePropertyGPSDictionary as String] {
            properties[kCGImagePropertyGPSDictionary] = gps
        }

        CGImageDestinationAddImage(destination, cg, properties as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { return nil }
        return out as Data
    }
}
