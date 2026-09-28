// The adjustment layers' contribution to the graph — from a picture's stored
// layers (`RollPicture.layers`, read through `Develop/Layer.swift`) to the
// passes the grader draws, with the SUBJECT maps injected: the web's
// `layerPasses` / `layerPassCache` (`src/shared/develop/layer-render.ts`) as
// the Develop stage and the roll export call them.
//
// WHERE they go — the one thing a caller must not choose: AFTER the cube, and
// after the geometry, in `FrameGrader`'s `after` slot —
//
//     [camera warp, lens, keystone] → LAYERS → [presence, sharpen] → [post-crop vignette]
//
// the order of `roll-render.ts` (`[...geometryPasses, ...layerPasses, ...post,
// ...vignette]`). After the cube, so a local slider does what the screen shows
// rather than acting in the log space a conversion LUT reads; after the
// geometry, so a mask's coordinates are the WARPED frame the author places it
// on (`render-layers.md`). Nothing goes `before`.
//
// Which layers draw, each one's cube, and what the pass is resolved from are
// the kernel's rules (`drawingLayers`, `layerCube`, `LayerPass`), never
// re-decided here: a parked layer (off, transparent, untouched develop) costs
// no pass; a subject whose map is not in `subjects` draws NOTHING; a layer
// subtracting such a subject subtracts nothing; bottom to top, each pass
// reading what the one under it wrote.

import AtelierKit
import CoreImage
import Foundation

enum LayerPasses {
    /// The passes for a stack, bottom to top — built once and thrown away,
    /// right for a DELIVERY. `aspectRatio` is the SOURCE's (layers apply
    /// before any crop); `subjects` holds each subject layer's map by LAYER
    /// id, as `SubjectMasks.resolve(…, forRender: true)` hands it over.
    static func build(_ layers: [AdjustLayer]?, aspectRatio: Double, interpolation: Interpolation = .tetrahedral,
                      subjects: [String: CIImage] = [:]) -> [RenderPass] {
        let byPass = drawingByPassId(layers)
        return layerPasses(layers, aspectRatio: aspectRatio, interpolation: interpolation).map { pass -> RenderPass in
            let layer = byPass[pass.id]
            return LayerRenderPass(pass, subject: layer.flatMap { subjectMap($0, subjects) },
                                   except: layer.flatMap { exceptMap($0, subjects) })
        }
    }

    /// The same, from the picture the roll stores.
    static func build(_ picture: RollPicture, aspectRatio: Double, interpolation: Interpolation = .tetrahedral,
                      subjects: [String: CIImage] = [:]) -> [RenderPass] {
        build(picture.layers, aspectRatio: aspectRatio, interpolation: interpolation, subjects: subjects)
    }

    /// SHOW ME THE MASK for one layer — the layer's own pass again with a
    /// one-colour cube (`maskOverlayPass`), as a wash or as the line where the
    /// mask crosses one half. A way of LOOKING: never part of a delivery.
    static func overlay(_ layer: AdjustLayer?, in layers: [AdjustLayer]?, aspectRatio: Double,
                        style: MaskOverlayStyle = .outline, subjects: [String: CIImage] = [:]) -> RenderPass? {
        guard let layer else { return nil }
        let cut = exceptMap(layer, subjects)
        // The kernel's rule decides whether there is anything to show: a mask,
        // a part, or a subtraction whose map has arrived.
        let placeholder = cut == nil ? nil : BrushRaster(data: [0], width: 1, height: 1)
        guard let pass = maskOverlayPass(layer, aspectRatio: aspectRatio, style: style, except: placeholder) else {
            return nil
        }
        return LayerRenderPass(pass, subject: subjectMap(layer, subjects), except: cut)
    }

    /// One point's own region, BLINKED when the model answers a tap — its map
    /// alone, never the layer's union: what the tap added.
    static func flash(_ map: CIImage, aspectRatio: Double) -> RenderPass? {
        // The kernel's pass carries the colour and the strength; the map is ours.
        guard let pass = maskFlashPass(BrushRaster(data: [0], width: 1, height: 1), aspectRatio: aspectRatio) else {
            return nil
        }
        return LayerRenderPass(pass, subject: map)
    }

    // MARK: - the maps a layer reads

    /// A SUBJECT layer's own map, by its id.
    static func subjectMap(_ layer: AdjustLayer, _ subjects: [String: CIImage]) -> CIImage? {
        guard layer.mask?.kind == .subject else { return nil }
        return subjects[layer.id]
    }

    /// The map of the subject a layer SUBTRACTS (`except`), by that subject's id.
    static func exceptMap(_ layer: AdjustLayer, _ subjects: [String: CIImage]) -> CIImage? {
        guard let except = layer.except else { return nil }
        return subjects[except]
    }

    /// The drawing layers by the id their pass carries (`layer:<id>`).
    private static func drawingByPassId(_ layers: [AdjustLayer]?) -> [String: AdjustLayer] {
        var out: [String: AdjustLayer] = [:]
        for layer in drawingLayers(layers) where out["layer:\(layer.id)"] == nil {
            out["layer:\(layer.id)"] = layer
        }
        return out
    }
}

/// The passes for ONE picture's stack, REMEMBERED between calls — what the
/// stage needs, where every slider step asks again. Over the kernel's
/// `LayerPassCache`, which hands the SAME `LayerPass` back while nothing it was
/// built from moved (its cube while the develop is the same, its painted map
/// while the strokes are); a pass is rebuilt here only when that object or a
/// subject map changed, so a painted map is turned into an image once per
/// stroke, not once per repaint. One per surface that renders (the stage, the
/// loupe).
final class LayerStack {
    private let cache = LayerPassCache()
    private let lock = NSLock()
    private struct Held {
        let source: LayerPass
        let subject: CIImage?
        let except: CIImage?
        let pass: LayerRenderPass
    }
    private var held: [String: Held] = [:]

    func passes(_ layers: [AdjustLayer]?, aspectRatio: Double, interpolation: Interpolation = .tetrahedral,
                subjects: [String: CIImage] = [:]) -> [RenderPass] {
        lock.lock()
        defer { lock.unlock() }
        var byPass: [String: AdjustLayer] = [:]
        for layer in drawingLayers(layers) where byPass["layer:\(layer.id)"] == nil {
            byPass["layer:\(layer.id)"] = layer
        }
        var keep: [String: Held] = [:]
        var out: [RenderPass] = []
        for source in cache.passes(layers, aspectRatio: aspectRatio, interpolation: interpolation) {
            let layer = byPass[source.id]
            let subject = layer.flatMap { LayerPasses.subjectMap($0, subjects) }
            let except = layer.flatMap { LayerPasses.exceptMap($0, subjects) }
            let pass: LayerRenderPass
            if let prev = held[source.id], prev.source === source, prev.subject === subject, prev.except === except {
                pass = prev.pass
            } else {
                pass = LayerRenderPass(source, subject: subject, except: except)
            }
            keep[source.id] = Held(source: source, subject: subject, except: except, pass: pass)
            out.append(pass)
        }
        // Layers no longer in the list are forgotten, so a picture change
        // cannot pin the last picture's maps.
        held = keep
        return out
    }
}
