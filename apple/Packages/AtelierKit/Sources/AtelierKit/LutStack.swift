// LUT stacking — several looks applied in order, each with its own strength
// and a bypass, resolved into ONE `CubeLut`. Port of `src/shared/lut/lut-stack.ts`.
//
// Order is fixed and is the whole point: develop → each layer, in order →
// output transform. A correction belongs before a look, a delivery curve after
// it. Everything downstream — the stage, every export, every thumbnail — takes
// exactly one cube and never learns that stacking exists. On Apple that one
// cube is what the render graph's cube pass is handed
// (`apple/Atelier/Render/Passes/CubePass.swift`), read tetrahedrally.

import Foundation

/// Upper bound on the composed lattice: 64³ of floats, plenty.
let maxComposedSize = 64
/// Floor when an output transform or a develop is baked in — a transfer curve
/// is steepest near black, where a coarse lattice bands.
let transformMinSize = 33

/// A layer's strength runs 0..3 — above 1 it extrapolates past the look.
public let maxLayerIntensity = 3.0

/// One entry of the stack, with its parsed LUT resolved.
public struct LutLayer: Sendable {
    public var id: String
    /// `builtin:<id>`, `custom`, `film`, `pack` — how the layer is restored.
    public var source: String
    public var name: String
    public var lut: CubeLut
    /// Strength: 0 = original, 1 = the look as authored, up to 3.
    public var intensity: Double
    /// Off keeps the layer in the stack but skips it — the A/B of grading.
    public var enabled: Bool
    /// Why this layer cannot grade on this device, when it cannot. The layer
    /// STAYS and is skipped by the bake; `lut` then holds an identity cube.
    public var missing: String?

    public init(id: String, source: String = "builtin:test", name: String = "test", lut: CubeLut,
                intensity: Double = 1, enabled: Bool = true, missing: String? = nil) {
        self.id = id; self.source = source; self.name = name; self.lut = lut
        self.intensity = intensity; self.enabled = enabled; self.missing = missing
    }
}

/// The layers that actually affect the image.
public func activeLayers(_ layers: [LutLayer]) -> [LutLayer] {
    layers.filter { $0.enabled && $0.intensity > 0 && $0.missing == nil }
}

/// Bake the stack into one LUT, or nil when nothing is active AND no output
/// transform is asked for AND no develop is set. A single full-strength layer
/// with neither is returned as-is (no resampling round-trip) — the common case
/// pays nothing.
public func composeLutStack(_ layers: [LutLayer], output: OutputTransform = .none,
                            interpolation: Interpolation = .trilinear,
                            develop: DevelopSettings? = nil) -> CubeLut? {
    let active = activeLayers(layers)
    let transform = output != OutputTransform.none
    let developed = !isDefaultDevelop(develop)
    let transfer = makeTransfer(output)
    var correct: ((Double, Double, Double) -> (Double, Double, Double))? = nil
    if developed, let develop { correct = developStage(develop) }
    if active.isEmpty && !transform && !developed { return nil }
    if !transform && !developed && active.count == 1 && active[0].intensity == 1 {
        return active[0].lut
    }

    let largest = active.reduce(2) { max($0, $1.lut.size) }
    // A RAW develop takes the densest lattice: its [0,1] is the SENSOR's range.
    let size = min(
        maxComposedSize,
        developed && isRawDevelop(develop)
            ? maxComposedSize
            : (transform || developed ? max(largest, transformMinSize) : largest)
    )
    let last = Double(size - 1)
    var data = [Float](repeating: 0, count: size * size * size * 3)

    for bi in 0..<size {
        for gi in 0..<size {
            for ri in 0..<size {
                var r = Double(ri) / last
                var g = Double(gi) / last
                var b = Double(bi) / last

                if let correct {
                    (r, g, b) = correct(r, g, b)
                }

                for layer in active {
                    let (lr, lg, lb) = sampleWith(layer.lut, r, g, b, interpolation)
                    let t = layer.intensity
                    r = r + (lr - r) * t
                    g = g + (lg - g) * t
                    b = b + (lb - b) * t
                }

                if transform {
                    r = transfer(r)
                    g = transfer(g)
                    b = transfer(b)
                }

                let o = (ri + gi * size + bi * size * size) * 3
                data[o] = Float(r)
                data[o + 1] = Float(g)
                data[o + 2] = Float(b)
            }
        }
    }

    var names = active.map(\.name)
    if developed { names.insert("Develop", at: 0) }
    if transform { names.append(output.label) }

    return CubeLut(size: size, data: data, title: names.joined(separator: " → "))
}

/// Move the layer at `index` one slot up (−1) or down (+1); pure.
public func reorderLayer<T>(_ layers: [T], _ index: Int, _ delta: Int) -> [T] {
    let target = index + delta
    guard index >= 0, index < layers.count, target >= 0, target < layers.count else { return layers }
    var next = layers
    next.swapAt(index, target)
    return next
}
