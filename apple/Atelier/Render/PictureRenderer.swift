// The pixel path: a picture decoded once, then composed — crop, cap, and the
// develop as ONE cube — through Core Image, for the stage and for the export
// alike. The rule that shapes it is the web's: preview = export by
// construction, because both take the very same recipe through the very same
// function, and the cube is the kernel's own bake (`composeLutStack`), so the
// numbers are the web app's numbers.
//
// Known gap, recorded: `CIColorCubeWithColorSpace` samples its lattice
// TRILINEARLY, while the web's shader samples tetrahedrally by default. On a
// develop-only cube every grey maps to a grey either way (the lattice is
// neutral on its axis); the difference is bounded by the cell and shows only
// on an asymmetric LOOK — a Metal kernel with tetrahedral sampling is the
// remedy when a look layer arrives here.

import CoreImage
import CoreImage.CIFilterBuiltins
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
    static func decode(_ data: Data, name: String) -> DecodedPicture? {
        let properties = fileProperties(data)
        if isRaw(name),
           let raw = CIRAWFilter(imageData: data, identifierHint: (name as NSString).pathExtension.lowercased()),
           let image = raw.outputImage {
            return DecodedPicture(image: image, properties: properties, isRaw: true)
        }
        guard let image = CIImage(data: data, options: [.applyOrientationProperty: true]) else { return nil }
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

    private let context = CIContext(options: [.cacheIntermediates: false])
    private let srgb = CGColorSpace(name: CGColorSpace.sRGB)!
    private let lock = NSLock()
    private var cubeCache: (develop: DevelopSettings, data: Data, size: Int)?

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
        //    stage inside its budget.
        if let cap = recipe.longEdge, max(delivered.width, delivered.height) > cap {
            image = scaled(image, longEdge: cap)
        }

        // 3. The develop, as the ONE cube the kernel bakes.
        if let cube = composeLutStack([], output: OutputTransform.none, interpolation: .tetrahedral, develop: recipe.develop) {
            image = applyCube(cube, develop: recipe.develop ?? .default, to: image)
        }
        return image
    }

    /// Lanczos-resampled to `longEdge`, the extent kept integral.
    func scaled(_ image: CIImage, longEdge: Int) -> CIImage {
        let w = image.extent.width
        let h = image.extent.height
        let scale = CGFloat(longEdge) / max(w, h)
        guard scale < 1 else { return image }
        let filter = CIFilter.lanczosScaleTransform()
        filter.inputImage = image
        filter.scale = Float(scale)
        filter.aspectRatio = 1
        let out = filter.outputImage ?? image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        return out.cropped(to: CGRect(x: 0, y: 0, width: (w * scale).rounded(), height: (h * scale).rounded()))
    }

    private func applyCube(_ cube: CubeLut, develop: DevelopSettings, to image: CIImage) -> CIImage {
        let data = cubeData(cube, develop: develop)
        let filter = CIFilter.colorCubeWithColorSpace()
        filter.inputImage = image
        filter.cubeDimension = Float(cube.size)
        filter.cubeData = data
        // The cube is defined on sRGB CODES, as the web's is: Core Image
        // converts from its working space to sRGB around the lookup.
        filter.colorSpace = srgb
        return filter.outputImage ?? image
    }

    /// The lattice as Core Image wants it — RGBA float32, red fastest — kept
    /// for the develop it was baked from, so a repaint does not re-pack it.
    private func cubeData(_ cube: CubeLut, develop: DevelopSettings) -> Data {
        lock.lock()
        defer { lock.unlock() }
        if let hit = cubeCache, hit.size == cube.size, sameDevelop(hit.develop, develop) { return hit.data }
        let n = cube.size * cube.size * cube.size
        var rgba = [Float](repeating: 1, count: n * 4)
        for i in 0..<n {
            rgba[i * 4] = cube.data[i * 3]
            rgba[i * 4 + 1] = cube.data[i * 3 + 1]
            rgba[i * 4 + 2] = cube.data[i * 3 + 2]
        }
        let data = rgba.withUnsafeBufferPointer { Data(buffer: $0) }
        cubeCache = (develop, data, cube.size)
        return data
    }

    // MARK: - out

    func cgImage(_ image: CIImage) -> CGImage? {
        context.createCGImage(image, from: image.extent, format: .RGBA8, colorSpace: srgb)
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
