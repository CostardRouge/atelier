// ONE target's file, made from a picture's one render — the web's `deliverOne`
// (`src/shared/develop/roll-render.ts`) with its canvas, `toBlob` and the DOM
// half of `ultra-hdr-export.ts` turned into Core Graphics and ImageIO:
//
//   the render, brought down to the target's size (never up)
//   → sharpened for a SCREEN, after the resize (`sharpenRows`, in bands)
//   → the watermark, AFTER the sharpening — a mark is not detail
//   → encoded (ImageIO: JPEG, or the HEIC this app adds)
//   → stamped with the ORIGINAL's EXIF, the XMP packet and the sRGB profile
//     (`stampExif` — the kernel's bytes), INSIDE the render, before any
//   → Ultra HDR container, whose MPF entry counts from the base's own bytes.
//
// The sharpening reads each band's upper neighbour from the ORIGINAL row, so
// a band gives the same bytes as the whole picture at once — which the
// kernel's spec holds for `sharpenRows`. (The web's loop reads that row back
// from its canvas after the previous band wrote it, sharpened: a one-row seam
// every 256 rows there, not here.)
//
// The file-system and photo-library halves are here too: a folder written
// under the EXACT name, numbered around a file already there unless the roll
// says to replace it (`unique-name.ts`, `write-files.ts`), and Photos taking
// the file under the same name.

import CoreGraphics
import CoreImage
import CoreText
import Foundation
import ImageIO
import Photos
import UniformTypeIdentifiers
import AtelierKit

/// Why one file could not be made.
enum DeliveryError: LocalizedError {
    case render
    case pixels
    case encode(String)
    case decode

    var errorDescription: String? {
        switch self {
        case .render: return "the picture could not be rendered"
        case .pixels: return "the rendered picture could not be read back"
        case .encode(let what): return "this device could not encode a \(what)"
        case .decode: return "the written file could not be read back"
        }
    }
}

/// The HDR half of one file, as the run reports it.
struct HdrMade: Equatable {
    var ultra: Bool
    var headroom: Double
    var checked: Double?
    var reason: String?
}

/// One target's file.
struct MadeFile {
    let data: Data
    let width: Int
    let height: Int
    let hdr: HdrMade?
    /// What the stamp wrote — the run's account of the capture's metadata.
    let exif: ExportExif
}

enum DeliveredFile {
    /// `composed` — the picture's one render — made into one target's file:
    /// `out` is the file's size (`deliveredLayout`), `sharpen` the target's
    /// screen sharpening, `mark` the watermark when this target draws it,
    /// `exif` the block for the delivered size. `darker` and `stops` make it an
    /// Ultra HDR JPEG (the same picture developed `stops` darker).
    static func make(
        _ composed: CIImage,
        darker: CIImage?,
        out: Size,
        sharpen: Double,
        quality: Double,
        format: ExportFormat,
        mark: (text: String, style: Watermark)?,
        stops: Double?,
        exif: (Size) -> ExportExif
    ) throws -> MadeFile {
        let base = fitted(composed, out)
        guard let rendered = FrameGrader.cgImage(base) else { throw DeliveryError.render }
        let w = rendered.width
        let h = rendered.height
        let delivered = Size(Double(w), Double(h))
        let wantsHdr = format == .jpeg && darker != nil && stops != nil
        let needsPixels = sharpen > 0 || mark != nil || wantsHdr

        var finalImage = rendered
        var sdrBytes: [UInt8]?
        if needsPixels {
            guard let pixels = RGBAPixels(rendered) else { throw DeliveryError.pixels }
            pixels.sharpen(sharpen)
            if let mark {
                WatermarkPainter.draw(mark.text, style: mark.style, in: pixels.context, width: w, height: h)
            }
            guard let made = pixels.makeImage() else { throw DeliveryError.pixels }
            finalImage = made
            if wantsHdr { sdrBytes = pixels.bytes() }
        }

        let meta = exif(delivered)
        if format == .heic {
            let metadata = ImageIOEncoding.metadata(meta, delivered)
            guard let data = ImageIOEncoding.encode(finalImage, type: .heic, quality: quality, metadata: metadata) else {
                throw DeliveryError.encode("HEIC")
            }
            return MadeFile(data: data, width: w, height: h, hdr: nil, exif: meta)
        }

        guard let jpeg = ImageIOEncoding.encode(finalImage, type: .jpeg, quality: quality) else {
            throw DeliveryError.encode("JPEG")
        }
        // Stamped HERE, on the base, before any container is written round it.
        let stamped = try stampExif(jpeg, meta, delivered)
        guard wantsHdr, let darker, let stops, let sdrBytes else {
            return MadeFile(data: stamped, width: w, height: h, hdr: nil, exif: meta)
        }

        // The darker render, cut, sharpened and marked the same, so the map
        // lines up with the base pixel for pixel and is flat under the mark.
        let dark = fitted(darker, out)
        guard let darkImage = FrameGrader.cgImage(dark), darkImage.width == w, darkImage.height == h,
              let darkPixels = RGBAPixels(darkImage) else {
            let why = HdrMade(ultra: false, headroom: 0, checked: nil, reason: "the darker render did not line up with the base")
            return MadeFile(data: stamped, width: w, height: h, hdr: why, exif: meta)
        }
        darkPixels.sharpen(sharpen)
        if let mark {
            WatermarkPainter.draw(mark.text, style: mark.style, in: darkPixels.context, width: w, height: h)
        }
        let sdr = linearFromBytes(sdrBytes, width: w, height: h)
        let darkerLinear = linearFromBytes(darkPixels.bytes(), width: w, height: h)
        let result = try encodeUltraHdr(sdrJpeg: stamped, sdr: sdr, darker: darkerLinear, stops: stops,
                                        encodeMap: ImageIOEncoding.encodeMap, decode: ImageIOEncoding.decodeRGBA)
        let made = HdrMade(ultra: result.ultra, headroom: result.headroom, checked: result.checked, reason: result.reason)
        return MadeFile(data: result.blob, width: w, height: h, hdr: made, exif: meta)
    }

    /// `image` brought inside `out`, never enlarged, at the origin.
    static func fitted(_ image: CIImage, _ out: Size) -> CIImage {
        var source = image
        let origin = source.extent.origin
        if origin != .zero {
            source = source.transformed(by: CGAffineTransform(translationX: -origin.x, y: -origin.y))
        }
        let w = CGFloat(out.width)
        let h = CGFloat(out.height)
        let e = source.extent
        if abs(e.width - w) < 0.5 && abs(e.height - h) < 0.5 { return source }
        return FrameGrader.fit(source, within: CGSize(width: w, height: h)).image
    }
}

// MARK: - the pixels

/// A picture's RGBA bytes (sRGB, top row first) under a Core Graphics context
/// — what the web reads with `getImageData` and writes with `putImageData`.
final class RGBAPixels {
    let width: Int
    let height: Int
    let context: CGContext
    private let buffer: UnsafeMutablePointer<UInt8>

    init?(_ image: CGImage) {
        let w = image.width
        let h = image.height
        guard w > 0, h > 0 else { return nil }
        let count = w * h * 4
        let memory = UnsafeMutablePointer<UInt8>.allocate(capacity: count)
        memory.initialize(repeating: 0, count: count)
        let info = CGImageAlphaInfo.premultipliedLast.rawValue
        guard let ctx = CGContext(data: memory, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                  space: RenderContexts.srgb, bitmapInfo: info) else {
            memory.deinitialize(count: count)
            memory.deallocate()
            return nil
        }
        ctx.interpolationQuality = .high
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
        width = w
        height = h
        context = ctx
        buffer = memory
    }

    deinit {
        buffer.deinitialize(count: width * height * 4)
        buffer.deallocate()
    }

    /// Every byte, as one array — what the gain map is measured from.
    func bytes() -> [UInt8] {
        Array(UnsafeBufferPointer(start: buffer, count: width * height * 4))
    }

    func makeImage() -> CGImage? {
        context.makeImage()
    }

    /// The screen sharpening, in bands of `sharpenBandRows` read with one row
    /// either side — each band's upper neighbour the ORIGINAL row, so the bands
    /// give the bytes the whole picture would.
    func sharpen(_ amount: Double) {
        guard amount > 0 else { return }
        let row = width * 4
        var aboveOriginal: [UInt8] = []
        var y0 = 0
        while y0 < height {
            let y1 = min(height, y0 + sharpenBandRows)
            let bottom = min(height, y1 + 1)
            let hasAbove = y0 > 0
            let top = hasAbove ? y0 - 1 : y0
            var band: [UInt8] = []
            band.reserveCapacity((bottom - top) * row)
            if hasAbove { band += aboveOriginal }
            band += UnsafeBufferPointer(start: buffer + y0 * row, count: (bottom - y0) * row)
            // This band's last row as it WAS — the next band's upper neighbour.
            aboveOriginal = Array(UnsafeBufferPointer(start: buffer + (y1 - 1) * row, count: row))
            let done = sharpenRows(band, width: width, height: bottom - top, from: y0 - top, to: y1 - top, amount: amount)
            done.withUnsafeBufferPointer { written in
                guard let source = written.baseAddress else { return }
                (buffer + y0 * row).update(from: source, count: written.count)
            }
            y0 = y1
        }
    }
}

// MARK: - the watermark

/// One line of text on the file (`watermark.ts`): its tone at its opacity,
/// with a soft shadow of the opposite tone so it reads over a sky and a coat
/// alike, in the suite's own sans — the web's `drawWatermark`. Where the line
/// sits is the kernel's arithmetic (`watermarkLayout`), in the web's top-down
/// pixels; the context counts up from the bottom.
enum WatermarkPainter {
    static func draw(_ text: String, style: Watermark, in context: CGContext, width w: Int, height h: Int) {
        guard !text.isEmpty else { return }
        let at = watermarkLayout(Double(w), Double(h), style)
        let size = CGFloat(at.fontPx)
        let light = style.tone == .light
        let fill = light ? CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 1) : CGColor(srgbRed: 0, green: 0, blue: 0, alpha: 1)
        let shade = light ? CGColor(srgbRed: 0, green: 0, blue: 0, alpha: 0.45) : CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 0.45)
        let attributes: [NSAttributedString.Key: Any] = [
            NSAttributedString.Key(kCTFontAttributeName as String): font(size),
            NSAttributedString.Key(kCTForegroundColorAttributeName as String): fill,
        ]
        let attributed = NSAttributedString(string: text, attributes: attributes)
        let line = CTLineCreateWithAttributedString(attributed as CFAttributedString)
        var ascent: CGFloat = 0
        var descent: CGFloat = 0
        var leading: CGFloat = 0
        let measured = CGFloat(CTLineGetTypographicBounds(line, &ascent, &descent, &leading))
        // `fillText`'s maxWidth: a line wider than the file less its margins is squeezed.
        let margin = (Double(min(w, h)) * 0.02).rounded()
        let maxWidth = CGFloat(Double(w) - 2 * margin)
        let squeeze: CGFloat = measured > maxWidth && maxWidth > 0 ? maxWidth / measured : 1
        let drawn = measured * squeeze
        var x = CGFloat(at.x)
        switch at.align {
        case .left: break
        case .right: x -= drawn
        case .center: x -= drawn / 2
        }
        let anchorDown = CGFloat(at.y)
        let baselineDown = at.baseline == .top ? anchorDown + ascent : anchorDown - descent
        let baselineUp = CGFloat(h) - baselineDown
        context.saveGState()
        context.setAlpha(CGFloat(style.opacity))
        context.setShadow(offset: .zero, blur: max(1, size * 0.18), color: shade)
        context.textMatrix = .identity
        context.translateBy(x: x, y: baselineUp)
        context.scaleBy(x: squeeze, y: 1)
        context.textPosition = .zero
        CTLineDraw(line, context)
        context.restoreGState()
    }

    /// Space Grotesk at weight 500 where it is registered, else the system's sans.
    private static func font(_ size: CGFloat) -> CTFont {
        let named = CTFontCreateWithName(Brand.sansName as CFString, size, nil)
        let postScript = CTFontCopyPostScriptName(named) as String
        guard postScript == Brand.sansName else {
            return CTFontCreateWithName("HelveticaNeue-Medium" as CFString, size, nil)
        }
        let wght = NSNumber(value: 0x77676874)
        let variation: [NSNumber: NSNumber] = [wght: NSNumber(value: 500)]
        let descriptor = CTFontDescriptorCreateWithAttributes([kCTFontVariationAttribute: variation] as CFDictionary)
        return CTFontCreateCopyWithAttributes(named, size, nil, descriptor)
    }
}

// MARK: - ImageIO

enum ImageIOEncoding {
    /// `image` encoded as `type` at `quality`, with `metadata` where given.
    static func encode(_ image: CGImage, type: UTType, quality: Double, metadata: CGImageMetadata? = nil) -> Data? {
        let out = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(out, type.identifier as CFString, 1, nil) else { return nil }
        let options: [CFString: Any] = [kCGImageDestinationLossyCompressionQuality: quality]
        if let metadata {
            CGImageDestinationAddImageAndMetadata(destination, image, metadata, options as CFDictionary)
        } else {
            CGImageDestinationAddImage(destination, image, options as CFDictionary)
        }
        guard CGImageDestinationFinalize(destination) else { return nil }
        return out as Data
    }

    /// The metadata a HEIC carries: the kernel's block and packet stamped on a
    /// tiny JPEG and read back by ImageIO, which then writes them into the
    /// HEIC — so the choice of groups, the rights, the words and the place
    /// leave a HEIC as they leave a JPEG. The maker notes may stay behind:
    /// ImageIO writes what it maps.
    static func metadata(_ exif: ExportExif, _ delivered: Size) -> CGImageMetadata? {
        guard let tiny = tinyJPEG(), let stamped = try? stampExif(tiny, exif, delivered),
              let source = CGImageSourceCreateWithData(stamped as CFData, nil) else { return nil }
        return CGImageSourceCopyMetadataAtIndex(source, 0, nil)
    }

    private static func tinyJPEG() -> Data? {
        let side = 8
        var bytes = [UInt8](repeating: 128, count: side * side * 4)
        let image: CGImage? = bytes.withUnsafeMutableBytes { raw in
            let info = CGImageAlphaInfo.premultipliedLast.rawValue
            guard let ctx = CGContext(data: raw.baseAddress, width: side, height: side, bitsPerComponent: 8,
                                      bytesPerRow: side * 4, space: RenderContexts.srgb, bitmapInfo: info) else { return nil }
            return ctx.makeImage()
        }
        guard let image else { return nil }
        return encode(image, type: .jpeg, quality: 0.5)
    }

    /// The gain map's grey pixels as its own JPEG — the web's `mapCanvas` + `toBlob`.
    static func encodeMap(_ pixels: DecodedPixels) throws -> Data {
        var bytes = pixels.data
        let w = pixels.width
        let h = pixels.height
        let image: CGImage? = bytes.withUnsafeMutableBytes { raw in
            let info = CGImageAlphaInfo.premultipliedLast.rawValue
            guard let ctx = CGContext(data: raw.baseAddress, width: w, height: h, bitsPerComponent: 8,
                                      bytesPerRow: w * 4, space: RenderContexts.srgb, bitmapInfo: info) else { return nil }
            return ctx.makeImage()
        }
        guard let image, let data = encode(image, type: .jpeg, quality: gainMapQuality) else {
            throw DeliveryError.encode("gain map")
        }
        return data
    }

    /// A JPEG's pixels as a viewer decodes them — the web's `createImageBitmap`
    /// drawn into a 2D canvas.
    static func decodeRGBA(_ data: Data) throws -> DecodedPixels {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { throw DeliveryError.decode }
        let w = image.width
        let h = image.height
        var bytes = [UInt8](repeating: 0, count: w * h * 4)
        let drawn: Bool = bytes.withUnsafeMutableBytes { raw in
            let info = CGImageAlphaInfo.premultipliedLast.rawValue
            guard let ctx = CGContext(data: raw.baseAddress, width: w, height: h, bitsPerComponent: 8,
                                      bytesPerRow: w * 4, space: RenderContexts.srgb, bitmapInfo: info) else { return false }
            ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
            return true
        }
        guard drawn else { throw DeliveryError.decode }
        return DecodedPixels(width: w, height: h, data: bytes)
    }

    /// What a file says about its capture, read by ImageIO — for a container
    /// the kernel's parser does not walk (a HEIC from Photos above all). It is
    /// the ORIGINAL's own account, handed to the stamp as the web hands it a
    /// source's record: rebuilt from its fields, the maker notes left behind.
    static func exifData(_ properties: [String: Any]) -> ExifData? {
        let tiff = properties[kCGImagePropertyTIFFDictionary as String] as? [String: Any] ?? [:]
        let exif = properties[kCGImagePropertyExifDictionary as String] as? [String: Any] ?? [:]
        let gps = properties[kCGImagePropertyGPSDictionary as String] as? [String: Any] ?? [:]
        var out = ExifData()
        out.make = text(tiff[kCGImagePropertyTIFFMake as String])
        out.model = text(tiff[kCGImagePropertyTIFFModel as String])
        out.software = text(tiff[kCGImagePropertyTIFFSoftware as String])
        out.artist = text(tiff[kCGImagePropertyTIFFArtist as String])
        out.copyright = text(tiff[kCGImagePropertyTIFFCopyright as String])
        out.imageDescription = text(tiff[kCGImagePropertyTIFFImageDescription as String])
        out.lensMake = text(exif[kCGImagePropertyExifLensMake as String])
        out.lensModel = text(exif[kCGImagePropertyExifLensModel as String])
        if let isos = exif[kCGImagePropertyExifISOSpeedRatings as String] as? [NSNumber], let first = isos.first {
            out.iso = first.doubleValue
        }
        out.exposureTime = number(exif[kCGImagePropertyExifExposureTime as String])
        out.fNumber = number(exif[kCGImagePropertyExifFNumber as String])
        out.focalLength = number(exif[kCGImagePropertyExifFocalLength as String])
        out.focalLength35 = number(exif[kCGImagePropertyExifFocalLenIn35mmFilm as String])
        out.exposureBias = number(exif[kCGImagePropertyExifExposureBiasValue as String])
        out.exposureProgram = number(exif[kCGImagePropertyExifExposureProgram as String])
        out.meteringMode = number(exif[kCGImagePropertyExifMeteringMode as String])
        out.whiteBalance = number(exif[kCGImagePropertyExifWhiteBalance as String])
        out.flash = number(exif[kCGImagePropertyExifFlash as String])
        out.dateTimeOriginal = text(exif[kCGImagePropertyExifDateTimeOriginal as String])
        if let lat = number(gps[kCGImagePropertyGPSLatitude as String]),
           let lon = number(gps[kCGImagePropertyGPSLongitude as String]) {
            let south = text(gps[kCGImagePropertyGPSLatitudeRef as String])?.uppercased() == "S"
            let west = text(gps[kCGImagePropertyGPSLongitudeRef as String])?.uppercased() == "W"
            out.gps = GpsCoord(lat: south ? -lat : lat, lon: west ? -lon : lon)
        }
        if let altitude = number(gps[kCGImagePropertyGPSAltitude as String]) {
            let below = number(gps[kCGImagePropertyGPSAltitudeRef as String]) == 1
            out.gpsAltitude = below ? -altitude : altitude
        }
        return isEmptyExif(out) ? nil : out
    }

    private static func text(_ value: Any?) -> String? {
        guard let s = value as? String else { return nil }
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }

    private static func number(_ value: Any?) -> Double? {
        if let n = value as? NSNumber { return n.doubleValue }
        if let d = value as? Double { return d }
        return nil
    }
}

// MARK: - where the files land

enum FolderDelivery {
    /// `data` into `folder` (a `/` path, `""` for the chosen folder itself)
    /// under `root`, under its own name — numbered `-1`, `-2` around a file
    /// the folder already holds unless `replace` says otherwise. The question
    /// goes to the real file system, so a volume that ignores capitals answers
    /// about `DJI_0101.JPG` when asked about `DJI_0101.jpg`. Returns the name
    /// written.
    static func write(_ data: Data, name: String, folder: String, root: URL, replace: Bool) throws -> String {
        var dir = root
        for level in folder.split(separator: "/") where !level.isEmpty {
            dir = dir.appendingPathComponent(String(level), isDirectory: true)
        }
        if !folder.isEmpty {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        let target = dir
        let written: String
        if replace {
            written = name
        } else {
            written = try uniqueName(name) { candidate in
                FileManager.default.fileExists(atPath: target.appendingPathComponent(candidate).path)
            }
        }
        let options: Data.WritingOptions = replace ? [] : [.withoutOverwriting]
        try data.write(to: dir.appendingPathComponent(written), options: options)
        return written
    }
}

enum PhotosDelivery {
    /// Asked at the click, before a pixel is rendered.
    static func authorised() async -> Bool {
        let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
        return status == .authorized || status == .limited
    }

    /// One file into the library, under the picture's own name.
    static func save(_ data: Data, name: String) async throws {
        try await PHPhotoLibrary.shared().performChanges {
            let request = PHAssetCreationRequest.forAsset()
            let options = PHAssetResourceCreationOptions()
            options.originalFilename = name
            request.addResource(with: .photo, data: data, options: options)
        }
    }
}
