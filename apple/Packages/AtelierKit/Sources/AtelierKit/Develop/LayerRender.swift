// A stack of adjustment layers, as PASSES. Port of
// `src/shared/develop/layer-render.ts` — the part that is not the GPU's: which
// layers draw, each one's cube, and the list of passes the app's Core Image
// side builds its kernels from (`LayerPass`, the web's `LayerPassOptions` as a
// record; the kernel is the app's, the web's being `render/layer-pass.ts`).
//
// The rules kept:
// - **a layer's develop is baked with NO look and NO output transform**
//   (`layerCube`): the look is applied once after the whole stack, the
//   transform last; a layer carrying either would apply it once PER LAYER;
// - order is bottom to top, each pass reading what the one under it wrote;
// - every pass has its own id (`layer:<id>`) — the web's graph caches programs
//   by id, and two layers sharing one would share one uploaded cube;
// - a layer that draws nothing costs no pass; a subject whose raster has not
//   arrived draws NOTHING (never the whole picture), and a subtraction whose
//   subject has not arrived subtracts nothing;
// - show-the-mask is the same pass with a one-colour cube, never a second
//   implementation of the mask — so it shows what the render really uses;
// - the CACHE hands the same `LayerPass` object back while nothing it was built
//   from moved, keeping each layer's cube while its develop is the same and a
//   painted map while its strokes are.
//
// One deliberate difference from the web, recorded: there a painted mask's map
// is rasterised by the pass only when the caller says nothing (`undefined`),
// and `layerPasses` (the export) and the overlay hand it `null` — so a painted
// layer drew nothing in a delivered file and in show-the-mask. Here a painted
// mask with no map handed over is rasterised from its strokes, which is what
// the pass's own contract describes; a map the caller holds is used as given.

import Foundation

/// How a layer pass finishes: `grade` mixes the develop in by the mask;
/// `outline` draws the line where the mask crosses one half.
public enum LayerPassFinish: String, Sendable {
    case grade, outline
}

/// How show-the-mask draws: a red wash, or the line where the mask crosses one half.
public enum MaskOverlayStyle: String, Sendable {
    case fill, outline
}

/// One layer as the renderer takes it — everything its kernel needs, resolved.
/// A class so the cache can hand the SAME object back (`===`), which is what
/// lets a renderer keep what it built from it.
public final class LayerPass: Sendable {
    /// The most parts one pass evaluates — the web's `PART_SLOTS`.
    public static let partSlots = 4

    /// Distinguishes this pass from the other layers' — `layer:<id>`.
    public let id: String
    /// The layer's develop, baked (`layerCube`), or a one-colour cube for show-the-mask.
    public let lut: CubeLut
    public let mask: Mask?
    public let invert: Bool
    /// 0..1.
    public let opacity: Double
    /// The SOURCE's, since a layer is applied before any crop.
    public let aspectRatio: Double
    public let interpolation: Interpolation
    /// The alpha map of the layer's own mask, for the two RASTER kinds (a
    /// painted mask, a segmented subject); nil covers nothing. Always nil for
    /// the shapes a kernel computes itself.
    public let raster: BrushRaster?
    /// The alpha map of the subject SUBTRACTED from this layer, or nil for none.
    public let except: BrushRaster?
    /// Further masks combined with `mask`, in order, at most `partSlots`.
    public let parts: [MaskPart]
    /// Each part's alpha map, by index — nil for a shape, or an empty painting.
    public let partRasters: [BrushRaster?]
    public let finish: LayerPassFinish

    /// Nil when the pass would change nothing — no cube, or no opacity — so a
    /// caller runs one fewer pass rather than a mix by zero.
    public init?(lut: CubeLut?, mask: Mask?, invert: Bool = false, opacity: Double = 1, aspectRatio: Double = 1,
                 interpolation: Interpolation = .tetrahedral, raster: BrushRaster? = nil, except: BrushRaster? = nil,
                 parts: [MaskPart] = [], partRasters: [BrushRaster?] = [], finish: LayerPassFinish = .grade,
                 id: String = "layer") {
        guard let lut, opacity > 0 else { return nil }
        self.id = id
        self.lut = lut
        self.mask = mask
        self.invert = invert
        self.opacity = min(1, opacity)
        self.aspectRatio = aspectRatio
        self.interpolation = interpolation
        self.raster = isRasterKind(mask) ? raster : nil
        self.except = except
        let kept = Array(parts.prefix(LayerPass.partSlots))
        self.parts = kept
        self.partRasters = kept.indices.map { i in
            isRasterKind(kept[i].mask) && i < partRasters.count ? partRasters[i] : nil
        }
        self.finish = finish
    }
}

private func isRasterKind(_ mask: Mask?) -> Bool {
    mask?.kind == .brush || mask?.kind == .subject
}

/// A mask's alpha map: the one handed over when there is one, else — for a
/// painted mask — its strokes rasterised; a subject's is always the caller's.
private func resolveRaster(_ mask: Mask?, _ given: BrushRaster?, _ aspectRatio: Double) -> BrushRaster? {
    switch mask {
    case .brush(let b)?:
        if let given { return given }
        return b.strokes.isEmpty ? nil : rasteriseBrush(b.strokes, aspectRatio)
    case .subject?:
        return given
    default:
        return nil
    }
}

/// Each part's map: the caller's where it gave one for that index, else resolved.
private func resolvePartRasters(_ parts: [MaskPart], _ given: [BrushRaster?]?, _ aspectRatio: Double) -> [BrushRaster?] {
    parts.indices.map { i in
        if let given, i < given.count { return given[i] }
        return resolveRaster(parts[i].mask, nil, aspectRatio)
    }
}

/// One layer's develop as a cube: the correction alone, no look, no transform.
public func layerCube(_ develop: DevelopSettings, interpolation: Interpolation = .tetrahedral) -> CubeLut? {
    composeLutStack([], output: .none, interpolation: interpolation, develop: develop)
}

/// The passes for a stack, bottom to top — built once and thrown away, right
/// for a delivery. Empty when nothing in it draws, so a picture with a parked
/// layer costs exactly what one with no layers costs.
///
/// `aspectRatio` is the SOURCE's: layers apply before any crop. `rasters` holds
/// the maps this module cannot compute — a segmented subject, keyed by layer
/// id; a subject asking for one that is not there draws NOTHING.
public func layerPasses(_ layers: [AdjustLayer]?, aspectRatio: Double, interpolation: Interpolation = .tetrahedral,
                        rasters: [String: BrushRaster]? = nil) -> [LayerPass] {
    drawingLayers(layers).compactMap { layer in
        guard let cube = layerCube(layer.develop, interpolation: interpolation) else { return nil }
        return LayerPass(
            lut: cube,
            mask: layer.mask,
            invert: layer.invert,
            opacity: layer.opacity,
            aspectRatio: aspectRatio,
            interpolation: interpolation,
            raster: resolveRaster(layer.mask, rasters?[layer.id], aspectRatio),
            except: exceptRaster(layer, rasters),
            parts: layer.parts,
            partRasters: resolvePartRasters(layer.parts, nil, aspectRatio),
            id: "layer:\(layer.id)"
        )
    }
}

/// The map of the subject a layer SUBTRACTS — nil when it subtracts nothing,
/// or when that subject's answer has not arrived (the layer then applies whole
/// for the moment the model thinks, rather than vanishing).
public func exceptRaster(_ layer: AdjustLayer, _ rasters: [String: BrushRaster]?) -> BrushRaster? {
    guard let except = layer.except else { return nil }
    return rasters?[except]
}

/// A 2³ cube that maps every colour to one.
private func flatCube(_ r: Float, _ g: Float, _ b: Float, title: String) -> CubeLut {
    var data = [Float](repeating: 0, count: 2 * 2 * 2 * 3)
    for i in 0..<8 {
        data[i * 3] = r
        data[i * 3 + 1] = g
        data[i * 3 + 2] = b
    }
    return CubeLut(size: 2, data: data, title: title)
}

/// Every colour to the same vermilion — the suite's accent, so the overlay
/// reads as ours and not as a warning.
private let redCube = flatCube(0.85, 0.16, 0.1, title: "mask overlay")
/// Brighter than the overlay's wash, so a blink reads over it.
private let flashCube = flatCube(0.94, 0.34, 0.22, title: "mask flash")
/// How strongly the overlay tints — enough to read, not enough to hide the picture.
private let overlayStrength = 0.55

/// SHOW ME THE MASK: the layer's own shape painted over the picture in red —
/// the layer's own pass again with a cube that maps every colour to one, so
/// what is drawn is the mask the render really uses, down to the feather and
/// the invert. Nil for a layer with no mask, no subtraction and no part:
/// tinting the whole frame says nothing.
public func maskOverlayPass(_ layer: AdjustLayer?, aspectRatio: Double, raster: BrushRaster? = nil,
                            style: MaskOverlayStyle = .fill, except: BrushRaster? = nil,
                            partRasters: [BrushRaster?]? = nil) -> LayerPass? {
    guard let layer else { return nil }
    if layer.mask == nil && except == nil && layer.parts.isEmpty { return nil }
    return LayerPass(
        lut: redCube,
        mask: layer.mask,
        invert: layer.invert,
        opacity: style == .outline ? 1 : overlayStrength,
        aspectRatio: aspectRatio,
        // Trilinear: a 2-point cube of one colour, where the lookup cannot matter.
        interpolation: .trilinear,
        raster: resolveRaster(layer.mask, raster, aspectRatio),
        except: except,
        parts: layer.parts,
        partRasters: resolvePartRasters(layer.parts, partRasters, aspectRatio),
        finish: style == .outline ? .outline : .grade,
        // The style is in the id: the two draw with different programs.
        id: "mask-\(style.rawValue):\(layer.id)"
    )
}

/// One point's own region, washed — what BLINKS when the model answers a tap
/// (twice, like a macOS menu item). The point's raster alone, never the
/// layer's union: the blink says what this tap ADDED.
public func maskFlashPass(_ raster: BrushRaster, aspectRatio: Double) -> LayerPass? {
    LayerPass(
        lut: flashCube,
        mask: .subject(SubjectMask(points: [], model: "flash")),
        opacity: 0.7,
        aspectRatio: aspectRatio,
        interpolation: .trilinear,
        raster: raster,
        id: "mask-flash"
    )
}

// MARK: - the cache

/// The passes for ONE picture's stack, REMEMBERED between calls — what the
/// stage needs, where every slider step asks again. Kept per layer id: the
/// CUBE while the develop is `sameDevelop`, the painted RASTER while the
/// strokes are the same at the same aspect, and the PASS itself while
/// everything it was built from is unchanged, so a renderer handed the same
/// object rebuilds nothing. Layers no longer in the list are forgotten on the
/// next call, so a picture change cannot pin the last picture's cubes.
public final class LayerPassCache {
    private struct Held {
        var develop: DevelopSettings
        var interpolation: Interpolation
        var cube: CubeLut?
        /// The strokes the raster was walked from, and at what aspect.
        var strokes: [BrushStroke]?
        var rasterAspect: Double
        var raster: BrushRaster?
        /// What the pass was built from.
        var mask: Mask?
        var invert: Bool
        var opacity: Double
        var aspectRatio: Double
        var passRaster: BrushRaster?
        var passExcept: BrushRaster?
        /// Each part's painted map and the strokes it was walked from, by index.
        var partStrokes: [[BrushStroke]?]
        var partRasters: [BrushRaster?]
        var parts: [MaskPart]
        var pass: LayerPass?
    }

    private struct HeldOverlay {
        var mask: Mask?
        var parts: [MaskPart]
        var partRasters: [BrushRaster?]
        var invert: Bool
        var aspectRatio: Double
        var raster: BrushRaster?
        var style: MaskOverlayStyle
        var except: BrushRaster?
        var pass: LayerPass?
    }

    private var held: [String: Held] = [:]
    private var heldOverlay: (id: String, held: HeldOverlay)?
    private var heldFlash: (raster: BrushRaster, aspectRatio: Double, pass: LayerPass?)?

    public init() {}

    /// Each painted part's map, reused from the last call while its strokes are
    /// the same at the same aspect — a part being painted re-walks itself alone.
    private func partRasterFor(_ parts: [MaskPart], _ strokes: [[BrushStroke]?], _ prev: Held?, _ aspectRatio: Double) -> [BrushRaster?] {
        parts.indices.map { i in
            guard let s = strokes[i] else { return nil }
            if let prev, i < prev.partStrokes.count, prev.partStrokes[i] == s, prev.rasterAspect == aspectRatio {
                return prev.partRasters[i]
            }
            return s.isEmpty ? nil : rasteriseBrush(s, aspectRatio)
        }
    }

    public func passes(_ layers: [AdjustLayer]?, aspectRatio: Double, rasters: [String: BrushRaster]? = nil,
                       interpolation: Interpolation = .tetrahedral) -> [LayerPass] {
        var keep = Set<String>()
        var out: [LayerPass] = []
        for layer in drawingLayers(layers) {
            keep.insert(layer.id)
            let prev = held[layer.id]

            let cubeKept = prev.map { $0.interpolation == interpolation && sameDevelop($0.develop, layer.develop) } ?? false
            let cube = cubeKept ? prev?.cube : layerCube(layer.develop, interpolation: interpolation)

            var strokes: [BrushStroke]? = nil
            let raster: BrushRaster?
            switch layer.mask {
            case .brush(let b)?:
                strokes = b.strokes
                if let prev, prev.strokes == b.strokes, prev.rasterAspect == aspectRatio {
                    raster = prev.raster
                } else {
                    raster = b.strokes.isEmpty ? nil : rasteriseBrush(b.strokes, aspectRatio)
                }
            case .subject?:
                raster = rasters?[layer.id]
            default:
                raster = nil
            }

            let except = exceptRaster(layer, rasters)
            let parts = layer.parts
            let partStrokes: [[BrushStroke]?] = parts.map { p in
                if case .brush(let b) = p.mask { return b.strokes }
                return nil
            }
            let partRasters = partRasterFor(parts, partStrokes, prev, aspectRatio)

            var pass: LayerPass? = nil
            if let prev, let prevPass = prev.pass, cubeKept,
               prev.passRaster == raster,
               prev.passExcept == except,
               prev.partRasters == partRasters,
               sameParts(prev.parts, parts),
               prev.invert == layer.invert,
               prev.opacity == layer.opacity,
               prev.aspectRatio == aspectRatio,
               sameMask(prev.mask, layer.mask) {
                pass = prevPass
            } else if let cube {
                pass = LayerPass(
                    lut: cube,
                    mask: layer.mask,
                    invert: layer.invert,
                    opacity: layer.opacity,
                    aspectRatio: aspectRatio,
                    interpolation: interpolation,
                    raster: raster,
                    except: except,
                    parts: parts,
                    partRasters: partRasters,
                    id: "layer:\(layer.id)"
                )
            }

            held[layer.id] = Held(
                develop: cloneDevelop(layer.develop),
                interpolation: interpolation,
                cube: cube,
                strokes: strokes,
                rasterAspect: aspectRatio,
                raster: raster,
                mask: cloneMask(layer.mask),
                invert: layer.invert,
                opacity: layer.opacity,
                aspectRatio: aspectRatio,
                passRaster: raster,
                passExcept: except,
                partStrokes: partStrokes,
                partRasters: partRasters,
                parts: cloneParts(parts),
                pass: pass
            )
            if let pass { out.append(pass) }
        }
        for id in Array(held.keys) where !keep.contains(id) { held[id] = nil }
        return out
    }

    /// The show-me-the-mask pass for a layer, kept the same way.
    public func overlay(_ layer: AdjustLayer?, aspectRatio: Double, raster: BrushRaster? = nil,
                        style: MaskOverlayStyle = .fill, except: BrushRaster? = nil) -> LayerPass? {
        guard let layer, layer.mask != nil || except != nil || !layer.parts.isEmpty else {
            heldOverlay = nil
            return nil
        }
        let prev = heldOverlay?.id == layer.id ? heldOverlay?.held : nil
        // The painted parts' maps come from the layer's own held entry when it
        // draws, so showing the mask of a layer being painted walks nothing twice.
        let own = held[layer.id]
        let parts = layer.parts
        let partRasters: [BrushRaster?] = parts.indices.map { i in
            guard case .brush(let b) = parts[i].mask else { return nil }
            if let own, i < own.partStrokes.count, own.partStrokes[i] == b.strokes, own.rasterAspect == aspectRatio {
                return own.partRasters[i]
            }
            if let prev, i < prev.parts.count, prev.parts[i].mask.kind == .brush,
               sameMask(prev.parts[i].mask, parts[i].mask), prev.aspectRatio == aspectRatio {
                return prev.partRasters[i]
            }
            return b.strokes.isEmpty ? nil : rasteriseBrush(b.strokes, aspectRatio)
        }
        if let prev, let prevPass = prev.pass,
           sameParts(prev.parts, parts),
           prev.partRasters == partRasters,
           prev.raster == raster,
           prev.style == style,
           prev.except == except,
           prev.invert == layer.invert,
           prev.aspectRatio == aspectRatio,
           sameMask(prev.mask, layer.mask) {
            return prevPass
        }
        let pass = maskOverlayPass(layer, aspectRatio: aspectRatio, raster: raster, style: style, except: except,
                                   partRasters: partRasters)
        heldOverlay = (layer.id, HeldOverlay(mask: cloneMask(layer.mask), parts: cloneParts(parts), partRasters: partRasters,
                                             invert: layer.invert, aspectRatio: aspectRatio, raster: raster, style: style,
                                             except: except, pass: pass))
        return pass
    }

    /// The blink over one point's region, kept while it is the same raster.
    public func flash(_ raster: BrushRaster?, aspectRatio: Double) -> LayerPass? {
        guard let raster else {
            heldFlash = nil
            return nil
        }
        if let f = heldFlash, f.raster == raster, f.aspectRatio == aspectRatio { return f.pass }
        let pass = maskFlashPass(raster, aspectRatio: aspectRatio)
        heldFlash = (raster, aspectRatio, pass)
        return pass
    }
}

/// A fresh cache — one per surface that renders (the stage, the loupe).
public func makeLayerPassCache() -> LayerPassCache {
    LayerPassCache()
}
