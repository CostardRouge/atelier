// A LOOK edited as the document stores it — the verbs of the web's
// `useLutStack` (`src/shared/lut/use-lut-stack.ts`: add a built-in, a film
// stock or a pack look, remove, move, strength, bypass, re-dial a film layer,
// the output transform, the texture) and `use-roll-grade.ts`'s "an empty look
// is stored as null", written over the SAVED shape (`RollGrade` /
// `SavedLutLayer`) rather than over parsed cubes.
//
// Why the saved shape: on the web the stack holds parsed lattices and a
// separate `customText` map, and `toSaved` folds them back on every write. The
// app's grade panel edits the document directly — the binding IS the stored
// look — and resolves lattices only to draw (`restoreLayers`), so the stored
// text and the layer's identity can never drift apart. Every rule the web's
// verbs keep is kept here:
//
// - a strength handed to a new layer is CLAMPED where the layer is made
//   (`layerIntensity`), never trusted per caller — it comes from a slider;
// - a film stock is stored as its settings, its name says where it stands
//   (`describeFilm`), and adding one brings the stock's grain and halation
//   ONLY where the look carries no texture yet — a texture the author dialled
//   is theirs, and a second stock must not overwrite it;
// - a pack look (an upload included) stores its REFERENCE, never a lattice;
// - a look with no layer, no output transform and no texture is NO look, and
//   is stored as nil — the roll reader's one spelling of it. A texture alone
//   IS a look.

import Foundation

/// A strength a caller asked for, held inside what a layer may carry —
/// `use-lut-stack.ts`'s `layerIntensity`.
public func lookLayerIntensity(_ value: Double) -> Double {
    guard value.isFinite else { return 1 }
    return min(maxLayerIntensity, max(0, value))
}

/// A built-in look as a new layer — `source: builtin:<id>`, its manifest name,
/// no text.
public func builtinLookLayer(id: String, builtinId: String, name: String, intensity: Double = 1) -> SavedLutLayer {
    SavedLutLayer(id: id, source: "builtin:\(builtinId)", name: name, customText: nil,
                  intensity: lookLayerIntensity(intensity), enabled: true)
}

/// A film stock as a new layer, seeded from the stock's own numbers.
public func filmLookLayer(id: String, stock: FilmStockId, intensity: Double = 1) -> SavedLutLayer {
    let settings = filmSettingsFor(stock)
    return SavedLutLayer(id: id, source: filmSource, name: describeFilm(settings),
                         customText: writeFilmSettings(settings), intensity: lookLayerIntensity(intensity), enabled: true)
}

/// A pack look — a purchased one, or an upload of the personal pack — as a
/// new layer carrying its REFERENCE. `name` is what the vault calls it;
/// empty falls back to `Pack look`, as the web's does.
public func packLookLayer(id: String, ref: PackRef, name: String, intensity: Double = 1) -> SavedLutLayer {
    SavedLutLayer(id: id, source: packSource, name: name.isEmpty ? "Pack look" : name,
                  customText: writePackRef(ref), intensity: lookLayerIntensity(intensity), enabled: true)
}

extension RollGrade {
    /// No layer, no output transform, no texture: what is stored as nil.
    public var isNoLook: Bool {
        layers.isEmpty && output == OutputTransform.none && (film == nil || film == .null)
    }

    /// The layer at the END of the stack — a new look applies after the others.
    public func adding(_ layer: SavedLutLayer) -> RollGrade {
        var next = self
        next.layers.append(layer)
        return next
    }

    /// A film layer, plus the stock's own grain and halation where the look
    /// carries no texture yet.
    public func addingFilm(_ layer: SavedLutLayer, stock: FilmStockId) -> RollGrade {
        var next = adding(layer)
        if film == nil || film == .null { next.film = textureOf(stock.rawValue).json }
        return next
    }

    public func removing(_ layerId: String) -> RollGrade {
        var next = self
        next.layers.removeAll { $0.id == layerId }
        return next
    }

    /// One slot earlier (−1) or later (+1); unchanged at an end.
    public func moving(_ layerId: String, _ delta: Int) -> RollGrade {
        guard let index = layers.firstIndex(where: { $0.id == layerId }) else { return self }
        var next = self
        next.layers = reorderLayer(layers, index, delta)
        return next
    }

    public func settingIntensity(_ layerId: String, _ intensity: Double) -> RollGrade {
        patchingLayer(layerId) { $0.intensity = intensity }
    }

    public func settingEnabled(_ layerId: String, _ enabled: Bool) -> RollGrade {
        patchingLayer(layerId) { $0.enabled = enabled }
    }

    /// Re-dial a FILM layer: its text becomes the new settings and its name
    /// says whether it is still on its stock. Any other layer is left alone.
    public func settingFilm(_ layerId: String, _ settings: FilmSettings) -> RollGrade {
        patchingLayer(layerId) { layer in
            guard layer.source == filmSource else { return }
            layer.name = describeFilm(settings)
            layer.customText = writeFilmSettings(settings)
        }
    }

    public func settingOutput(_ output: OutputTransform) -> RollGrade {
        var next = self
        next.output = output
        return next
    }

    /// The grade's grain and halation — nil for none. Never a layer's: it
    /// cascades with the look (`render-film.md`).
    public func settingTexture(_ texture: FilmTexture?) -> RollGrade {
        var next = self
        next.film = texture?.json
        return next
    }

    private func patchingLayer(_ layerId: String, _ patch: (inout SavedLutLayer) -> Void) -> RollGrade {
        guard let index = layers.firstIndex(where: { $0.id == layerId }) else { return self }
        var next = self
        patch(&next.layers[index])
        return next
    }
}

/// The look as it is stored: nil when it is no look.
public func storedLook(_ grade: RollGrade?) -> RollGrade? {
    guard let grade, !grade.isNoLook else { return nil }
    return grade
}
