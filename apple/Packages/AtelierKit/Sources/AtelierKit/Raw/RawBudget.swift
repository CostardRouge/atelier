// How big a RAW decode may be on THIS device, by what it is for. Port of
// `src/shared/raw/raw-budget.ts` (`docs/memory/device-memory.md`).
//
// A RAW is the one source whose decoded plane the app allocates itself — six
// bytes a pixel of 16-bit RGB, then everything made from it — so a RAW is
// where a phone runs out of memory, and on the web it did (2026-09-23).
//
// The rule is a LONG EDGE per purpose and per device class, applied by the
// decoder as its `maxEdge` — the same box average the GPU's own cap uses, so
// the two limits compose as one `min`:
// - **stage** — what a develop is judged on. A constrained device works its
//   RAW at 2560 px; a roomy device keeps the GPU's limit.
// - **loupe** — the file's own density under a magnified view. On a phone the
//   whole file is exactly what cannot be decoded, so the loupe is capped to the
//   stage's edge and SAYS so rather than trying.
// - **export** — deliberate, one picture at a time. A constrained device
//   decodes to 4096 px (a 36-megapixel sensor's half, nine megapixels).
//
// Bytes, so a page can say what a decode will cost: the half image is six
// bytes a pixel, the as-shot bytes four. Pure; the device class is an argument.

import Foundation

public enum RawPurpose: String, Sendable, CaseIterable {
    case stage, loupe, export
}

/// Which of the two limits a long edge ran into.
public enum RawDecodeLimit: String, Sendable, CaseIterable {
    case device, gpu
}

/// The long edge a constrained device works a RAW at on the stage (and in the loupe).
public let constrainedStageEdge = 2560.0
/// The long edge a constrained device delivers a RAW at.
public let constrainedExportEdge = 4096.0

/// The most pixels a decode may have on one edge for `purpose` — the device's
/// own ceiling, or the GPU's cap, whichever is smaller. `gpuMax` is the GPU's
/// largest texture edge, `.infinity` where there is no GPU to fit.
public func rawDecodeEdge(_ purpose: RawPurpose, _ klass: DeviceClass, _ gpuMax: Double) -> Double {
    let gpu = gpuMax.isFinite && gpuMax > 0 ? gpuMax : .infinity
    if klass != .constrained { return gpu }
    let device = purpose == .export ? constrainedExportEdge : constrainedStageEdge
    return min(gpu, device)
}

/// Which of the two limits a long edge of `edge` pixels ran into, if any.
public func rawDecodeCap(_ edge: Double, _ purpose: RawPurpose, _ klass: DeviceClass, _ gpuMax: Double) -> RawDecodeLimit? {
    let allowed = rawDecodeEdge(purpose, klass, gpuMax)
    if edge <= allowed { return nil }
    let device: Double
    if klass == .constrained {
        device = purpose == .export ? constrainedExportEdge : constrainedStageEdge
    } else {
        device = .infinity
    }
    // Against the GPU's number as given, as the web compares it.
    return device <= gpuMax ? .device : .gpu
}

private let mib = 1024 * 1024

/// How much decoded RAW the session may hold for a picture to be re-opened without a second decode.
public func decodedCacheCeiling(_ klass: DeviceClass) -> Int {
    klass == .constrained ? 64 * mib : 256 * mib
}

/// The bytes a decode of `width`×`height` holds once its 16-bit plane is gone.
public func decodedBytes(_ width: Int, _ height: Int, _ withBytes: Bool) -> Int {
    let pixels = max(0, width) * max(0, height)
    return pixels * (6 + (withBytes ? 4 : 0))
}

/// How long the decoder — and its heap — is kept after a decode, in ms. A
/// phone lets it go after a short rest; a roomy device keeps it (nil).
public func decoderIdleMs(_ klass: DeviceClass) -> Double? {
    klass == .constrained ? 8000 : nil
}
