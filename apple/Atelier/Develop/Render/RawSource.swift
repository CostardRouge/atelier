// A RAW's two halves on this device — the camera's RENDER inside it, which is
// what opens, and the SENSOR, decoded on request at the rung the develop
// stands on (`DevelopSettings.base`: proxy · gain · gainMap · gainMapWarp).
// The web's `photo-frame.ts` (`rawRenderFirst`), `raw-decoder.ts` and
// `raw-budget.ts`, on Apple's own decoder (`raw.md`, `device-memory.md`).
//
// Rules kept:
//
// - **The render first, on every device** (`rawRenderFirst`, 2026-09-24): the
//   JPEG the camera wrote inside the file is sliced out by the kernel
//   (`extractRawPreview`), GIVEN the orientation it left behind
//   (`uprightJpeg`), and decoded like any JPEG. Only a RAW with no render is
//   handed to the system's own developer, at a phone's stage edge where the
//   device is constrained — the web's reason to refuse it there was Safari
//   decoding the whole sensor, which `CIRAWFilter.scaleFactor` does not.
// - **The sensor is decoded to LINEAR light and sRGB-encoded**, sensor white
//   at 1.0, no gain applied: the develop's cube applies the measured `rawGain`,
//   so one decode serves every setting of the sliders. `CIRAWFilter` is asked
//   for the plainest decode it has — no boost curve, no baseline exposure, no
//   gamut mapping, no noise reduction, sharpening, local tone map or lens
//   correction — as the web asks LibRaw for 16-bit, camera white, camera
//   matrix, no auto-bright. The DNG's own `OpcodeList3` is the graph's to
//   apply (the gain-map and warp passes), at the rung the develop names.
// - **The gain is MEASURED once and STORED** (`autoBrightGain`, the brightest
//   1 % at white — dcraw's rule), so the export applies the stage's number.
// - **A decode is a long edge per purpose and per device class**
//   (`rawDecodeEdge`): the stage 2560 on a phone, the GPU's (here: Core
//   Image's tiles, no cap) elsewhere, bounded by the stage's pixel budget; an
//   export 4096 on a phone, whole elsewhere. The stage's decode is rendered
//   ONCE into half floats and held (`SensorCache`), because a demosaic per
//   slider step is what a stage cannot afford.
//
// What is not the web's, recorded rather than hidden: `CIRAWFilter` is Apple's
// demosaic and matrix, not LibRaw's, so a web develop's stored `rawGain` —
// measured on LibRaw's linear output — does not land on the same pixels here
// (`native-app.md`); and the sensor's white after `CIRAWFilter`'s white
// balance is Apple's, unmeasured. Both are for the first run on a device.

import AtelierKit
import CoreImage
import Foundation

/// How much room this device gives the app — the kernel's `DeviceClass`,
/// answered from what the platform knows. `atelier.device` in the defaults
/// overrides it, as `localStorage['atelier.device']` does on the web.
enum DevelopDevice {
    static let overrideKey = "atelier.device"

    static var current: DeviceClass {
        if let forced = UserDefaults.standard.string(forKey: overrideKey), let klass = DeviceClass(rawValue: forced) {
            return klass
        }
        #if os(iOS)
        // A phone or a tablet, whatever it says it has.
        return .constrained
        #else
        let gib = Double(ProcessInfo.processInfo.physicalMemory) / Double(1 << 30)
        return gib <= 4 ? .constrained : .roomy
        #endif
    }
}

/// What a RAW is, kept beside the picture the pool decoded: enough to decode
/// its SENSOR on request, and to say what it holds.
final class RawAccess: @unchecked Sendable {
    /// The file's name — its extension is the decoder's hint.
    let name: String
    let fileSize: Int
    /// The file's bytes, read again: a 74 MB DNG is not held between decodes.
    let reread: () throws -> Data
    /// The sensor plane's pixels as SHOWN — turned the way the camera was held.
    let sensor: CGSize?
    /// What its own `OpcodeList3` asks for, read once from its head; nil when nothing applies.
    let calibration: RawCalibration?

    init(name: String, fileSize: Int, reread: @escaping () throws -> Data, sensor: CGSize?, calibration: RawCalibration?) {
        self.name = name
        self.fileSize = fileSize
        self.reread = reread
        self.sensor = sensor
        self.calibration = calibration
    }

    /// The decoder's hint: the extension, lower case.
    var hint: String { (name as NSString).pathExtension.lowercased() }

    /// The rungs this file can honestly offer (`rungsFor`), lowest first.
    var rungs: [DevelopBase] { rungsFor(calibration) }

    /// Read a RAW's head once: its sensor's shown size and its calibration.
    static func read(_ data: Data, name: String, reread: @escaping () throws -> Data) -> RawAccess {
        let head = [UInt8](data.prefix(rawProbeBytes))
        let sizes = rawSizesFrom(head)
        let sensor = sizes.sensor.map { CGSize(width: $0.width, height: $0.height) }
        return RawAccess(name: name, fileSize: data.count, reread: reread, sensor: sensor,
                         calibration: rawCalibrationFrom(head: head))
    }
}

/// The SENSOR's data, decoded — what the graph takes as its source above the proxy.
struct SensorDecode {
    /// sRGB-ENCODED codes, sensor white at 1.0, upright, at the origin.
    let image: CIImage
    let width: Int
    let height: Int
    /// Decoded pixels per SENSOR pixel (≤ 1).
    let scale: Double
    /// The picture's own exposure, measured on this decode (`autoBrightGain`)
    /// — nil when it was not asked for: a develop that stores one never re-measures.
    let gain: Double?
    /// The sensor's own long edge, as `CIRAWFilter` reports it.
    let sensorLongEdge: Double
}

enum SensorDecoder {
    /// The long edge the stage decodes a sensor at: the device's ceiling for
    /// the stage, and never more than one 4K frame of pixels
    /// (`maxStagePixels`), whatever the GPU could take.
    static func stageEdge(sensorWidth: Double, sensorHeight: Double, klass: DeviceClass) -> Double {
        let long = max(sensorWidth, sensorHeight)
        let short = max(1, min(sensorWidth, sensorHeight))
        // The long edge whose frame of this shape holds `maxStagePixels`.
        let budget = (maxStagePixels * long / short).squareRoot()
        return min(long, budget, rawDecodeEdge(.stage, klass, .infinity))
    }

    /// Decode `data`'s sensor at most `maxEdge` on its long side (nil: whole),
    /// or nil when Apple's decoder refuses the file. `materialize` renders it
    /// ONCE into half floats — the stage's decode, read on every repaint — and
    /// leaves the export's as a recipe Core Image draws in tiles. `measure`
    /// meters its exposure: on the held half floats where there are some,
    /// else on a subsample of the linear decode.
    static func decode(_ data: Data, hint: String, maxEdge: Double?, materialize: Bool, measure: Bool,
                       context: CIContext = RenderContexts.shared) -> SensorDecode? {
        guard let filter = CIRAWFilter(imageData: data, identifierHint: hint) else { return nil }
        plain(filter)
        let native = filter.nativeSize
        let nativeLong = Double(max(native.width, native.height))
        if let maxEdge, nativeLong > 0, maxEdge < nativeLong {
            filter.scaleFactor = Float(maxEdge / nativeLong)
        }
        guard let output = filter.outputImage else { return nil }
        let linear = atOrigin(output)
        guard !linear.extent.isInfinite, !linear.extent.isEmpty else { return nil }
        var encoded = linear.applyingFilter("CILinearToSRGBToneCurve")
        var metered = linear
        if materialize, let held = SensorDecoder.materialize(encoded, context: context) {
            encoded = held
            // Metered on what is held: no second demosaic for one number.
            metered = held.applyingFilter("CISRGBToneCurveToLinear")
        }
        let gain: Double? = measure ? measureGain(metered, context: context) : nil
        let width = Int(encoded.extent.width.rounded())
        let height = Int(encoded.extent.height.rounded())
        let long = Double(max(width, height))
        let scale = nativeLong > 0 ? min(1, long / nativeLong) : 1
        return SensorDecode(image: encoded, width: width, height: height, scale: scale, gain: gain,
                            sensorLongEdge: nativeLong)
    }

    /// Apple's decoder asked for its plainest decode — the web's LibRaw
    /// settings as near as `CIRAWFilter` lets: linear (no boost), no baseline
    /// exposure, the camera's matrix without gamut mapping, and nothing of its
    /// own processing on top. Its lens correction OFF: a DNG's `OpcodeList3`
    /// is applied by the graph, at the rung the develop names, never twice.
    static func plain(_ filter: CIRAWFilter) {
        filter.boostAmount = 0
        filter.baselineExposure = 0
        filter.exposure = 0
        filter.isGamutMappingEnabled = false
        if filter.isLensCorrectionSupported { filter.isLensCorrectionEnabled = false }
        if filter.isLuminanceNoiseReductionSupported { filter.luminanceNoiseReductionAmount = 0 }
        if filter.isColorNoiseReductionSupported { filter.colorNoiseReductionAmount = 0 }
        if filter.isSharpnessSupported { filter.sharpnessAmount = 0 }
        if filter.isContrastSupported { filter.contrastAmount = 0 }
        if filter.isDetailSupported { filter.detailAmount = 0 }
        if filter.isMoireReductionSupported { filter.moireReductionAmount = 0 }
        if filter.isLocalToneMapSupported { filter.localToneMapAmount = 0 }
    }

    /// The picture's own exposure (`autoBrightGain`): read on a NEAREST
    /// subsample of the linear decode at most `gainSampleEdge` on its long
    /// side — a stride over the frame, as the web's measurement is, never an
    /// average that would pull the brightest percent down.
    static func measureGain(_ linear: CIImage, context: CIContext) -> Double {
        let extent = linear.extent
        let long = max(extent.width, extent.height)
        guard long > 0 else { return 1 }
        let s = min(1, CGFloat(gainSampleEdge) / long)
        let small = linear.samplingNearest().transformed(by: CGAffineTransform(scaleX: s, y: s))
        let w = Int((extent.width * s).rounded(.down))
        let h = Int((extent.height * s).rounded(.down))
        guard w > 0, h > 0 else { return 1 }
        let bounds = CGRect(x: small.extent.minX, y: small.extent.minY, width: CGFloat(w), height: CGFloat(h))
        var floats = [Float](repeating: 0, count: w * h * 4)
        floats.withUnsafeMutableBytes { raw in
            guard let base = raw.baseAddress else { return }
            context.render(small, toBitmap: base, rowBytes: w * 16, bounds: bounds, format: .RGBAf, colorSpace: nil)
        }
        var rgb = [Float](repeating: 0, count: w * h * 3)
        for i in 0..<(w * h) {
            rgb[i * 3] = floats[i * 4]
            rgb[i * 3 + 1] = floats[i * 4 + 1]
            rgb[i * 3 + 2] = floats[i * 4 + 2]
        }
        return autoBrightGain(LinearRgb(width: w, height: h, data: rgb), autoBrightClip, 1)
    }

    /// The long edge the gain is measured on.
    static let gainSampleEdge = 1024

    /// `image` rendered once into half floats and read back as a picture of
    /// its own — the stage's source, so a repaint never demosaics again.
    static func materialize(_ image: CIImage, context: CIContext) -> CIImage? {
        let extent = image.extent
        let w = Int(extent.width.rounded())
        let h = Int(extent.height.rounded())
        guard w > 0, h > 0 else { return nil }
        var data = Data(count: w * h * 8)
        data.withUnsafeMutableBytes { raw in
            guard let base = raw.baseAddress else { return }
            context.render(image, toBitmap: base, rowBytes: w * 8,
                           bounds: CGRect(x: extent.minX, y: extent.minY, width: CGFloat(w), height: CGFloat(h)),
                           format: .RGBAh, colorSpace: nil)
        }
        return CIImage(bitmapData: data, bytesPerRow: w * 8, size: CGSize(width: w, height: h),
                       format: .RGBAh, colorSpace: nil)
    }

    /// `image` moved so its extent starts at the origin.
    static func atOrigin(_ image: CIImage) -> CIImage {
        let origin = image.extent.origin
        if origin == .zero || image.extent.isInfinite { return image }
        return image.transformed(by: CGAffineTransform(translationX: -origin.x, y: -origin.y))
    }
}

/// The stage's sensor decodes, held — a RAW is the one source decoded in the
/// app's own memory, so a phone keeps ONE and a computer a few
/// (`decodedCacheCeiling`, `device-memory.md`).
final class SensorCache: @unchecked Sendable {
    private let lock = NSLock()
    private var held: [(key: String, decode: SensorDecode)] = []

    func get(_ key: String) -> SensorDecode? {
        lock.lock()
        defer { lock.unlock() }
        guard let index = held.firstIndex(where: { $0.key == key }) else { return nil }
        let hit = held.remove(at: index)
        held.insert(hit, at: 0)
        return hit.decode
    }

    func put(_ key: String, _ decode: SensorDecode, klass: DeviceClass) {
        lock.lock()
        defer { lock.unlock() }
        held.removeAll { $0.key == key }
        held.insert((key, decode), at: 0)
        // Within the session's ceiling, and never fewer than the one open.
        let ceiling = decodedCacheCeiling(klass)
        var total = 0
        var keep = 0
        for entry in held {
            total += entry.decode.width * entry.decode.height * 8
            if keep > 0 && total > ceiling { break }
            keep += 1
        }
        if held.count > keep { held.removeLast(held.count - keep) }
    }
}
