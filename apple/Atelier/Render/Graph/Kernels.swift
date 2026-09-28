// The kernels — the app's `default.metallib`, loaded ONCE, vended by function
// name.
//
// Every pass of the graph is a Core Image kernel written in Metal
// (`Render/Kernels/*.metal`, one file per pass family, functions declared in
// `extern "C" { namespace coreimage { … } }`), compiled at BUILD time into the
// app's `default.metallib` under `MTL_COMPILER_FLAGS = -fcikernel` and
// `MTLLINKER_FLAGS = -cikernel` (`project.yml`, both targets). A typo in a
// kernel therefore fails CI's `xcodebuild` — which is the whole reason for
// Metal over a runtime string: the web's GLSL is a template literal nothing
// compiles, and a broken shader there degrades silently to an un-graded
// picture with every gate green (`media-pipeline.md`).
//
// What CAN still fail at run time is the lookup by NAME — a function that was
// renamed, or a library that did not make it into the bundle — and both are
// said in one line a reviewer can act on, then said ONCE more in the log when
// a pass falls back to drawing nothing. A silent fallback is the failure the
// render core exists to prevent.

import CoreImage
import Foundation

/// Why a kernel could not be had, in words that name the fix.
enum KernelError: Error, CustomStringConvertible {
    /// `default.metallib` is not in the bundle: the `.metal` files did not
    /// compile into the app, or were compiled without the Core Image flags.
    case libraryMissing(bundle: String)
    /// The library loaded but holds no function of that name.
    case functionMissing(name: String, underlying: Error)
    /// The kernel loaded but Core Image produced no image for these
    /// arguments — a wrong argument count or type, or an infinite extent.
    case applyFailed(pass: String)

    var description: String {
        switch self {
        case .libraryMissing(let bundle):
            return "default.metallib is not in \(bundle): the Render/Kernels/*.metal files did not compile into the app"
                + " — check MTL_COMPILER_FLAGS = -fcikernel and MTLLINKER_FLAGS = -cikernel in apple/project.yml"
        case .functionMissing(let name, let underlying):
            return "no Core Image kernel named '\(name)' in default.metallib (\(underlying.localizedDescription))"
                + " — the Metal function must be declared inside extern \"C\" { namespace coreimage { … } } under exactly that name"
        case .applyFailed(let pass):
            return "the '\(pass)' pass produced no image: Core Image refused the kernel's arguments or its extent"
        }
    }
}

/// A class in the app's own binary, so `Bundle(for:)` finds the app bundle
/// even when the code runs inside a hosted test.
private final class KernelBundleAnchor {}

enum Kernels {
    private static let lock = NSLock()
    private static var library: Result<Data, KernelError>?
    /// Loaded kernels, keyed by class and name: a `CIKernel` is thread-safe
    /// and immutable, so one instance serves every render.
    private static var loaded: [String: CIKernel] = [:]
    /// The passes whose failure has already been said.
    private static var reported: Set<String> = []

    /// The bundle the metallib lives in — the app's.
    static var bundle: Bundle { Bundle(for: KernelBundleAnchor.self) }

    /// The compiled library's bytes, read once and kept.
    static func libraryData() throws -> Data {
        lock.lock()
        defer { lock.unlock() }
        return try libraryDataLocked()
    }

    private static func libraryDataLocked() throws -> Data {
        if let held = library { return try held.get() }
        let result: Result<Data, KernelError>
        if let url = bundle.url(forResource: "default", withExtension: "metallib"),
           let data = try? Data(contentsOf: url) {
            result = .success(data)
        } else {
            result = .failure(.libraryMissing(bundle: bundle.bundlePath))
        }
        library = result
        return try result.get()
    }

    /// A general kernel: samples its inputs where it likes, declares an ROI.
    static func kernel(_ name: String) throws -> CIKernel {
        try load(name) { try CIKernel(functionName: $0, fromMetalLibraryData: $1) }
    }

    /// A colour kernel: one output pixel from the input pixels under it.
    static func colorKernel(_ name: String) throws -> CIColorKernel {
        try load(name) { try CIColorKernel(functionName: $0, fromMetalLibraryData: $1) }
    }

    /// A warp kernel: where each output pixel reads from, in one input.
    static func warpKernel(_ name: String) throws -> CIWarpKernel {
        try load(name) { try CIWarpKernel(functionName: $0, fromMetalLibraryData: $1) }
    }

    /// A blend kernel: two pixels in, one out.
    static func blendKernel(_ name: String) throws -> CIBlendKernel {
        try load(name) { try CIBlendKernel(functionName: $0, fromMetalLibraryData: $1) }
    }

    private static func load<K: CIKernel>(_ name: String, _ make: (String, Data) throws -> K) throws -> K {
        lock.lock()
        defer { lock.unlock() }
        let key = "\(K.self):\(name)"
        if let hit = loaded[key] as? K { return hit }
        let data = try libraryDataLocked()
        let kernel: K
        do {
            kernel = try make(name, data)
        } catch let error as KernelError {
            throw error
        } catch {
            throw KernelError.functionMissing(name: name, underlying: error)
        }
        loaded[key] = kernel
        return kernel
    }

    /// Say a pass's failure ONCE, loudly — the picture is then drawn without
    /// that pass, which beats a stage that will not render, but must never
    /// happen in silence.
    static func report(_ error: Error, pass: String) {
        lock.lock()
        defer { lock.unlock() }
        guard !reported.contains(pass) else { return }
        reported.insert(pass)
        NSLog("%@", "[render] pass \"\(pass)\": \(error) — the picture is drawn without it")
    }
}
