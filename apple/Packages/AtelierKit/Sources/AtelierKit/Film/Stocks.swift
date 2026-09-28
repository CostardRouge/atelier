// The film stocks: named parameter sets over the emulsion model, by EMULSION
// CLASS — reversal, negative, cross-process, monochrome — never by a brand.
// Port of `src/shared/film/stocks.ts`. A trademark is a claim no measurement
// here backs, and `photo-develop.md` §8's rule against a fabricated preset
// bites the names, not the transform: each stock below is a documented
// physical shape, the same standing as the generated `classic/` looks.
//
// What the numbers model, so the next person can tune them by reason:
//
// - `gamma` is contrast; a NEGATIVE is shot soft (0.7–0.9) and gets its
//   contrast back from the paper, a REVERSAL is shot at its final contrast
//   (1.1–1.3) and has no paper to rescue its whites, so it clips.
// - Crossover is per-channel gamma: a lower BLUE gamma lifts blue below mid
//   grey (cool shadows) and holds it back above (warm highlights) — the
//   classic negative look. Reversed for a cross-process.
// - `inhibition` is the saturation rolloff; slide film has less of it, which
//   is why its colours clip where a negative's melt.
// - `white` past 2.47 stops clips at display white; a negative's is far
//   higher (its latitude), the paper then decides the print's white.
//
// The numbers are the web's, unchanged: a taste pass on them is the
// maintainer's alone (MEMORY.md, «Film simulation»), and it lands here by
// copying the web's file again, never by tuning in one client.

import Foundation

public enum FilmStockId: String, CaseIterable, Sendable {
    case reversalVivid = "reversal-vivid"
    case reversalNeutral = "reversal-neutral"
    case negativePortrait = "negative-portrait"
    case negativeConsumer = "negative-consumer"
    case crossProcess = "cross-process"
    case monoPanchromatic = "mono-panchromatic"
}

public struct FilmStock: Equatable, Sendable {
    public var id: FilmStockId
    /// On screen: `Reversal · vivid`.
    public var name: String
    /// One line on what the parameters model — the settled row's hint.
    public var note: String
    public var response: FilmResponse
    /// The stock's grain and halation — read by the render graph's film node
    /// on the web; declared here so a stock is one thing.
    public var texture: FilmTexture

    public init(id: FilmStockId, name: String, note: String, response: FilmResponse, texture: FilmTexture) {
        self.id = id; self.name = name; self.note = note; self.response = response; self.texture = texture
    }
}

/// The picker group every stock sits under, beside APPLE / DJI / SONY.
public let filmGroupLabel = "FILM"

/// The web's `c({...})`: the neutral curve with a few dials moved.
private func curve(speed: Double = neutralCurve.speed, gamma: Double = neutralCurve.gamma,
                   toe: Double = neutralCurve.toe, shoulder: Double = neutralCurve.shoulder,
                   black: Double = neutralCurve.black, white: Double = neutralCurve.white) -> FilmCurve {
    FilmCurve(speed: speed, gamma: gamma, toe: toe, shoulder: shoulder, black: black, white: white)
}

/// The web's `t({...})`: the default (silent) texture with a few dials moved.
private func texture(grain: Double = defaultFilmTexture.grain, grainSize: Double = defaultFilmTexture.grainSize,
                     grainChroma: Double = defaultFilmTexture.grainChroma, grainFps: Double = defaultFilmTexture.grainFps,
                     halation: Double = defaultFilmTexture.halation, halationRadius: Double = defaultFilmTexture.halationRadius,
                     halationThreshold: Double = defaultFilmTexture.halationThreshold,
                     halationTint: (Double, Double, Double) = defaultFilmTexture.halationTint,
                     seed: Double = defaultFilmTexture.seed) -> FilmTexture {
    FilmTexture(grain: grain, grainSize: grainSize, grainChroma: grainChroma, grainFps: grainFps,
                halation: halation, halationRadius: halationRadius, halationThreshold: halationThreshold,
                halationTint: halationTint, seed: seed)
}

private let reversalVivid = FilmStock(
    id: .reversalVivid,
    name: "Reversal · vivid",
    note: "Slide film at full contrast: a hard shoulder that clips its whites, deep blacks, saturated dyes that clip rather than roll off.",
    response: FilmResponse(
        coupling: 10,
        inhibition: 25,
        curve: FilmCurveSet(
            r: curve(gamma: 1.25, toe: 0.4, shoulder: 0.3, black: 5, white: 2.6),
            g: curve(gamma: 1.25, toe: 0.4, shoulder: 0.3, black: 5, white: 2.6),
            b: curve(gamma: 1.18, toe: 0.45, shoulder: 0.3, black: 4.8, white: 2.55)
        ),
        print: false,
        paperGrade: 2,
        dye: 25,
        mono: nil
    ),
    texture: texture(grain: 0.15, grainSize: 0.0012, grainChroma: 0.1, halation: 0.2, halationRadius: 0.03, seed: 101)
)

private let reversalNeutral = FilmStock(
    id: .reversalNeutral,
    name: "Reversal · neutral",
    note: "Slide film that means to be accurate: a little more contrast than the scene, clean neutrals, a gentler shoulder.",
    response: FilmResponse(
        coupling: 15,
        inhibition: 35,
        curve: FilmCurveSet(
            r: curve(gamma: 1.1, toe: 0.5, shoulder: 0.5, black: 5.5, white: 2.8),
            g: curve(gamma: 1.1, toe: 0.5, shoulder: 0.5, black: 5.5, white: 2.8),
            b: curve(gamma: 1.07, toe: 0.5, shoulder: 0.5, black: 5.5, white: 2.8)
        ),
        print: false,
        paperGrade: 2,
        dye: 5,
        mono: nil
    ),
    texture: texture(grain: 0.12, grainSize: 0.0012, grainChroma: 0.1, halation: 0.15, halationRadius: 0.03, seed: 102)
)

private let negativePortrait = FilmStock(
    id: .negativePortrait,
    name: "Negative · portrait",
    note: "A soft negative with wide latitude, printed: cool shadows under warm highlights, strong coupler rolloff that protects skin, dyes held back.",
    response: FilmResponse(
        coupling: 30,
        inhibition: 55,
        curve: FilmCurveSet(
            r: curve(gamma: 0.78, toe: 0.9, shoulder: 1.0, black: 6.5, white: 4),
            g: curve(gamma: 0.75, toe: 0.9, shoulder: 1.0, black: 6.5, white: 4),
            b: curve(gamma: 0.7, toe: 1.1, shoulder: 1.1, black: 6.2, white: 3.8)
        ),
        print: true,
        paperGrade: 2.5,
        dye: -5,
        mono: nil
    ),
    texture: texture(grain: 0.3, grainSize: 0.0016, grainChroma: 0.25, halation: 0.35, halationRadius: 0.04, seed: 103)
)

private let negativeConsumer = FilmStock(
    id: .negativeConsumer,
    name: "Negative · consumer",
    note: "An everyday negative printed on a harder paper: punchier, a green-yellow lean in the highlights, dyes a little louder.",
    response: FilmResponse(
        coupling: 25,
        inhibition: 40,
        curve: FilmCurveSet(
            r: curve(gamma: 0.88, toe: 0.8, shoulder: 0.8, black: 6, white: 3.6),
            g: curve(gamma: 0.85, toe: 0.8, shoulder: 0.8, black: 6, white: 3.6),
            b: curve(gamma: 0.78, toe: 0.9, shoulder: 0.7, black: 5.8, white: 3.2)
        ),
        print: true,
        paperGrade: 3,
        dye: 15,
        mono: nil
    ),
    texture: texture(grain: 0.4, grainSize: 0.002, grainChroma: 0.3, halation: 0.3, halationRadius: 0.04, seed: 104)
)

private let crossProcess = FilmStock(
    id: .crossProcess,
    name: "Cross-process",
    note: "Slide film run through the wrong chemistry: contrast run up, the crossover broken the other way — cyan shadows, yellow highlights, little rolloff.",
    response: FilmResponse(
        coupling: 5,
        inhibition: 10,
        curve: FilmCurveSet(
            r: curve(speed: -0.1, gamma: 1.4, toe: 0.3, shoulder: 0.3, black: 4.5, white: 2.5),
            g: curve(gamma: 1.2, toe: 0.3, shoulder: 0.3, black: 4.5, white: 2.5),
            b: curve(speed: 0.3, gamma: 0.8, toe: 0.3, shoulder: 0.3, black: 4.5, white: 2.5)
        ),
        print: false,
        paperGrade: 2,
        dye: 30,
        mono: nil
    ),
    texture: texture(grain: 0.35, grainSize: 0.0018, grainChroma: 0.35, halation: 0.2, halationRadius: 0.035, seed: 105)
)

private let monoPanchromatic = FilmStock(
    id: .monoPanchromatic,
    name: "Monochrome · panchromatic",
    note: "One panchromatic layer behind an orange filter, printed: skies darken, skin lightens, a long toe and a crisp paper white.",
    response: FilmResponse(
        coupling: 0,
        inhibition: 0,
        curve: FilmCurveSet(
            r: curve(gamma: 1.15, toe: 0.6, shoulder: 0.6, black: 6, white: 3.5),
            g: curve(gamma: 1.15, toe: 0.6, shoulder: 0.6, black: 6, white: 3.5),
            b: curve(gamma: 1.15, toe: 0.6, shoulder: 0.6, black: 6, white: 3.5)
        ),
        print: true,
        paperGrade: 2.5,
        dye: 0,
        mono: FilmMono(sensitivity: (0.3, 0.45, 0.25), filter: (1, 0.55, 0.2))
    ),
    texture: texture(grain: 0.45, grainSize: 0.0018, grainChroma: 0, halation: 0.15, halationRadius: 0.035,
                     halationTint: (1, 0.92, 0.8), seed: 106)
)

public let filmStocks: [FilmStock] = [
    reversalVivid, reversalNeutral, negativePortrait, negativeConsumer, crossProcess, monoPanchromatic,
]

private let byId: [String: FilmStock] = Dictionary(uniqueKeysWithValues: filmStocks.map { ($0.id.rawValue, $0) })

/// A stock's own grain and halation — a COPY (a struct is one by itself),
/// since the record is mutable state the moment a grade holds it and the
/// stock's must not be edited in place. The default texture (none at all)
/// for a stock this build does not know.
public func textureOf(_ id: String) -> FilmTexture {
    byId[id]?.texture ?? defaultFilmTexture
}

public func filmStock(_ id: String) -> FilmStock? {
    byId[id]
}

public func filmStock(_ id: FilmStockId) -> FilmStock? {
    byId[id.rawValue]
}

/// Fresh settings seeded from a stock — the numbers copied, so a dial never edits the registry.
public func filmSettingsFor(_ id: FilmStockId) -> FilmSettings {
    FilmSettings(stock: id.rawValue, response: byId[id.rawValue]!.response)
}

/// True when the settings still carry their stock's own numbers.
public func onStock(_ settings: FilmSettings) -> Bool {
    guard let stock = byId[settings.stock] else { return false }
    return sameResponse(stock.response, settings.response)
}

/// The one line a settled row prints: the stock's name, `· adjusted` once a
/// dial moved it, `Film · adjusted` for settings whose stock this build no
/// longer knows.
public func describeFilm(_ settings: FilmSettings) -> String {
    guard let stock = byId[settings.stock] else { return "Film · adjusted" }
    return onStock(settings) ? stock.name : "\(stock.name) · adjusted"
}
