// The render graph's contract on Core Image — the web's `RenderPass`
// (`src/shared/render/graph.ts`) and the context every pass draws in.
//
// The web grades through a float16 multi-pass WebGL2 graph: a chain of
// fragment-shader passes over two ping-pong targets, each with a pure twin a
// render gate holds it to. Here the same chain is built on Core Image, and
// Core Image is LAZY: a pass returns a RECIPE (a `CIImage`), the graph is the
// composition of recipes, and the `CIContext` renders it in tiles with the
// region of interest each kernel declares. That is what retires the web's
// ~1 GB full-density export — no ping-pong target the size of the picture
// ever exists — and it is also why every general kernel MUST give a correct
// ROI: a neighbourhood pass expands the rect by its radius in SOURCE pixels,
// a warp returns the whole input extent unless it can invert its map cheaply.
//
// Working space = the web's, and it is the one decision in this file: NO
// colour management. The kernels see sRGB-ENCODED codes with headroom above
// 1.0 in half floats, exactly what the web's float16 buffers carry
// (`render-core.md`, «The buffers are float16; the VALUES are unchanged»),
// so every ported formula applies unchanged. Sources enter as codes and
// nothing is clamped where the web does not clamp.

import CoreImage
import Foundation
import Metal

/// One node of the graph. A pass holds its kernel's own pure record (a
/// `Keystone`, a `DetailSettings`, a `CubeLut`…) and turns it into kernel
/// arguments — never a second parameter type.
///
/// A pass whose kernel will not load or run draws NOTHING rather than
/// failing the render: it hands `image` back and says so once
/// (`Kernels.report`). Each pass also exposes a throwing door of its own for
/// the gate, so a broken kernel fails a test instead of passing one on an
/// unprocessed picture.
protocol RenderPass {
    /// The web's pass id, for a message when a kernel will not run.
    var id: String { get }
    /// The recipe for `image` with this pass drawn on it. A pass that has
    /// nothing to do returns `image` itself, so it costs no kernel.
    func apply(_ image: CIImage, _ ctx: PassContext) -> CIImage
}

/// What a pass needs to know about the render it is part of.
struct PassContext {
    /// The picture being rendered, in pixels.
    var renderSize: CGSize
    /// Render pixels per SOURCE pixel. Kernels are sized in source pixels —
    /// a denoise radius, a repair disc, a grain cell — and the stage, which
    /// works to a pixel budget, scales them by this (`render-detail.md`).
    var sourceScale: Double
    /// Which instant of the SOURCE this frame is. The one node that reads it
    /// is the film node's: grain re-rolls per source frame quantised to
    /// `grainFps`, never per repaint (`render-film.md`). A still passes
    /// nothing and stays on field 0.
    var sourceSeconds: Double?
    /// The packed lattices, kept across renders by whoever owns the graph
    /// (`FrameGrader.cubes`): the look's cube, and every adjustment layer's
    /// own develop cube once layers arrive, are packed ONCE per lattice.
    var cubes: CubeCache

    init(renderSize: CGSize, sourceScale: Double = 1, sourceSeconds: Double? = nil, cubes: CubeCache = CubeCache()) {
        self.renderSize = renderSize
        self.sourceScale = sourceScale
        self.sourceSeconds = sourceSeconds
        self.cubes = cubes
    }

    /// A length stated in SOURCE pixels, in this render's pixels.
    func scaled(_ sourcePixels: Double) -> Double {
        sourcePixels * sourceScale
    }
}

/// The ONE way a `CIContext` is made for the graph, so the stage, every
/// export, every thumbnail and the gate render under the same rules.
enum RenderContexts {
    /// The colour space a delivered picture is TAGGED with. The codes are
    /// sRGB codes throughout (nothing converts them); the tag says so.
    static let srgb: CGColorSpace = CGColorSpace(name: CGColorSpace.sRGB)!

    /// The working-space rules, as options: half-float intermediates with
    /// headroom, no colour management in or out, no intermediate caching (a
    /// recipe is rebuilt per edit and a cache would only hold stale tiles).
    ///
    /// With colour management off, a picture's values are never converted on
    /// the way in or out: an 8-bit file enters as its own codes, and a
    /// `CGImage` made through this context is TAGGED with the colour space
    /// asked for, not converted into it.
    static func options(software: Bool = false) -> [CIContextOption: Any] {
        var options: [CIContextOption: Any] = [
            .workingFormat: NSNumber(value: CIFormat.RGBAh.rawValue),
            .workingColorSpace: NSNull(),
            .outputColorSpace: NSNull(),
            .cacheIntermediates: false,
        ]
        // The CPU path, for a machine with no Metal device (a CI runner
        // without a GPU). Only the gate asks for it; the app always has a GPU.
        if software { options[.useSoftwareRenderer] = true }
        return options
    }

    /// A context on the system's Metal device, or on the software renderer
    /// where there is none (or where `software` asks for it).
    static func make(software: Bool = false) -> CIContext {
        if !software, let device = MTLCreateSystemDefaultDevice() {
            return CIContext(mtlDevice: device, options: options())
        }
        return CIContext(options: options(software: true))
    }

    /// The app's one context. A `CIContext` is expensive and thread-safe;
    /// every render goes through this one.
    static let shared: CIContext = make()
}
