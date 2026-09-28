// The Intro palette group — port of `src/shared/overlay/intro-presets.ts`,
// pure data.
//
// These cells are PRESETS, NOT KINDS: a hook title and a subtitle are both
// ordinary text elements, told apart by size, placement, window and entrance.
// That is what lets the intro reuse everything an element already has (the
// style cascade, the theme, dragging, the burn-in export) instead of growing a
// second class of element beside it.
//
// Every preset lands in the intro scene, so it borrows that scene's clock and
// moves as a block — the windows below are offsets INSIDE the scene, never
// absolute times (`Scenes.swift`). The ids are stored nowhere, but the palette
// names them, so they keep the web's strings.

import Foundation

public enum IntroPresetId: String, CaseIterable, Sendable {
    case hookTitle = "hook-title"
    case subtitle
    case question
    case rotatePhone = "rotate-phone"
}

public struct IntroPreset: Sendable {
    public let id: IntroPresetId
    /// Cell name — short, it sits over a third of a narrow column.
    public let label: String
    public let create: @Sendable () -> OverlayElement
}

/// Hook title: the statement, centred, arriving from below.
private func hookTitle() -> OverlayElement {
    var el = createTextElement("Your hook here")
    el.anchor = .center
    el.x = 0.5
    el.y = 0.42
    el.sizeFrac = 0.085
    el.weight = 700
    el.sceneId = introSceneId
    el.window = TimeWindow(start: 0, end: nil)
    el.animation = ElementAnimation(
        in: AnimStep(preset: .slide, duration: 0.6, easing: .out, direction: .up, distanceFrac: 0.05),
        out: AnimStep(preset: .fade, duration: 0.45, easing: .in)
    )
    return el
}

/// Subtitle: the second line, entering after the title has landed.
private func subtitle() -> OverlayElement {
    var el = createTextElement("the line underneath")
    el.anchor = .center
    el.x = 0.5
    el.y = 0.52
    el.sizeFrac = 0.036
    el.weight = 500
    el.sceneId = introSceneId
    el.window = TimeWindow(start: 0.45, end: nil)
    el.animation = ElementAnimation(
        in: AnimStep(preset: .fade, duration: 0.5, easing: .out),
        out: AnimStep(preset: .fade, duration: 0.35, easing: .in)
    )
    return el
}

/// Question: typed out rather than faded in — the reveal IS the hook.
private func question() -> OverlayElement {
    var el = createTextElement("What if you could…?")
    el.anchor = .center
    el.x = 0.5
    el.y = 0.45
    el.sizeFrac = 0.062
    el.weight = 600
    el.sceneId = introSceneId
    el.window = TimeWindow(start: 0, end: nil)
    el.animation = ElementAnimation(
        in: AnimStep(preset: .typewriter, duration: 1.1, easing: .linear),
        out: AnimStep(preset: .fade, duration: 0.4, easing: .in)
    )
    return el
}

/// The invitation to turn the phone, held a little longer than a title.
private func rotatePhone() -> OverlayElement {
    var el = createRotateDeviceElement()
    el.sceneId = introSceneId
    el.window = TimeWindow(start: 0.2, end: nil)
    el.animation = ElementAnimation(
        in: AnimStep(preset: .scale, duration: 0.45, easing: .out, scaleFrom: 0.8),
        out: AnimStep(preset: .fade, duration: 0.4, easing: .in)
    )
    return el
}

/// The web's `INTRO_PRESETS`.
public let introPresets: [IntroPreset] = [
    IntroPreset(id: .hookTitle, label: "Hook title", create: { hookTitle() }),
    IntroPreset(id: .subtitle, label: "Subtitle", create: { subtitle() }),
    IntroPreset(id: .question, label: "Question", create: { question() }),
    IntroPreset(id: .rotatePhone, label: "Rotate phone", create: { rotatePhone() }),
]

/// The preset for an id. The web throws on an unknown id; the enum has none.
public func introPreset(_ id: IntroPresetId) -> IntroPreset {
    // Every case is in `introPresets`; a list that missed one is a build error, not a document's.
    introPresets.first { $0.id == id }!
}
