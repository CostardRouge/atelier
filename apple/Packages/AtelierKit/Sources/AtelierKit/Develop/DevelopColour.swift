// The develop's COLOUR STAGES — the mixer, black and white, the grading — as
// the web's `developLinear` applies them (`src/shared/develop/develop.ts`,
// its last lines, and `developLines`' last three): after saturation and
// vibrance, black and white TAKING THE MIXER'S PLACE (the mixer is kept, not
// applied), then the wheels over the picture as it now is.
//
// `developLinear` (`Develop.swift`) ends on `applyColourStages`, and
// `developStage` resolves the stages once per bake beside the curves' shapers —
// so the stage, every export and every layer's cube take them for nothing.
// What makes the resolving worth a type: the three records live as JSON in
// `DevelopSettings.carried` and are DECODED by their typed fields, which a
// lattice of 35 937 points must not pay per point.

import Foundation

/// The colour stages a develop asks for, resolved once from its records.
/// `mixer` is nil when it is default OR while black and white is on; `grading`
/// is nil when default.
public struct ColourStages: Equatable, Sendable {
    public let mono: MonoMix?
    public let mixer: ColourMixer?
    public let grading: ColourGrading?

    public init(mono: MonoMix?, mixer: ColourMixer?, grading: ColourGrading?) {
        self.mono = mono; self.mixer = mixer; self.grading = grading
    }

    /// Nothing colours — the develop pays nothing for these stages.
    public static let uncoloured = ColourStages(mono: nil, mixer: nil, grading: nil)

    public var isEmpty: Bool { mono == nil && mixer == nil && grading == nil }
}

/// Resolve a develop's colour stages ONCE — a bake calls it per lattice, never
/// per point, the way `makeDevelopShapers` resolves the curves.
public func makeColourStages(_ d: DevelopSettings) -> ColourStages {
    let mono = d.mono
    let mixer = mono == nil ? d.mixer.flatMap { isDefaultMixer($0) ? nil : $0 } : nil
    let grading = d.grading.flatMap { isDefaultGrading($0) ? nil : $0 }
    if mono == nil && mixer == nil && grading == nil { return .uncoloured }
    return ColourStages(mono: mono, mixer: mixer, grading: grading)
}

/// One pixel in LINEAR light through the resolved stages, in the web's order:
/// black and white, else the mixer; then the grading. The very same values
/// when none is set.
public func applyColourStages(_ rgb: (Double, Double, Double), _ stages: ColourStages) -> (Double, Double, Double) {
    var out = rgb
    if let mono = stages.mono {
        out = monoLinear(out, mono)
    } else if let mixer = stages.mixer {
        out = mixLinear(out, mixer)
    }
    if let grading = stages.grading {
        out = gradeLinear(out, grading)
    }
    return out
}

/// The same, resolving the stages from the develop — for a one-off call; in a
/// loop resolve them once with `makeColourStages`.
public func applyColourStages(_ rgb: (Double, Double, Double), _ d: DevelopSettings) -> (Double, Double, Double) {
    applyColourStages(rgb, makeColourStages(d))
}

/// What the colour stages say, one fact per entry, in the order the web's
/// `developLines` appends them: `B&W` / `B&W mix` OR `mixer sat+lum` (black
/// and white takes the mixer's place in the line too), then `grading shadows`.
public func colourStageLines(_ d: DevelopSettings) -> [String] {
    var parts: [String] = []
    let mono = describeMono(d.mono)
    let mixer = mono == nil ? describeMixer(d.mixer) : nil
    if let mono { parts.append(mono) }
    if let mixer { parts.append(mixer) }
    if let grading = describeGrading(d.grading) { parts.append(grading) }
    return parts
}
