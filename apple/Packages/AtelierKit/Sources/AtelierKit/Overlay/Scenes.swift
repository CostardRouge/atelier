// Scenes — a shared lifetime for a group of elements. Port of
// `src/shared/overlay/scenes.ts`, pure.
//
// The founding case is a social clip's introduction: a hook title, maybe a
// subtitle, maybe an invitation to turn the phone, all living for the first
// few seconds and leaving together. Rather than a second class of element, a
// scene is a WINDOW WITH FURNITURE: its elements are ordinary overlay elements
// that borrow the scene's clock (their windows are offsets INTO it, so moving
// the intro moves everything staggered inside it), plus two optional pieces:
// - a SCRIM, painted over the picture and under every element;
// - SOLO, holding back the elements outside the scene and fading them in when
//   it ends, so the telemetry HUD "boots up" after the hook.
// A scene may also carry a STAGGER, a delay ADDED to each member's entrance,
// derived from where they sit on every draw and never stored on an element.
//
// The web's `Scene` is `OverlayScene` here: SwiftUI has a `Scene`. Road Trip's
// hook reaches the Studio as a scene too (`roadtrip-hook`, `hook-scene.ts`,
// ported with Trips); nothing here depends on it.

import Foundation

public struct SceneScrim: Equatable, Sendable {
    /// Any CSS colour the canvas understands.
    public var color: String
    /// 0..1 at full strength.
    public var opacity: Double
    /// Seconds the scrim takes to arrive and to leave.
    public var fade: Double

    public init(color: String, opacity: Double, fade: Double) {
        self.color = color; self.opacity = opacity; self.fade = fade
    }

    /// What the scene panel puts down when the scrim is switched on
    /// (`ScenePanel.tsx`'s `DEFAULT_SCRIM`).
    public static let `default` = SceneScrim(color: "#0b0a09", opacity: 0.55, fade: 0.4)
}

public struct OverlayScene: Equatable, Sendable {
    public var id: String
    /// Shown in the inspector; never rendered.
    public var name: String
    /// Seconds from the first exported frame.
    public var start: Double
    public var end: Double
    public var scrim: SceneScrim?
    /// Hold back every element that is not in this scene while it runs.
    public var solo: Bool
    /// Seconds the held-back elements take to fade out and back in. 0 = a cut.
    public var hudFade: Double
    /// Spread the members' entrances by where they sit. Absent (`.none`) or
    /// `null` (`.some(nil)`): no cascade — every scene written before
    /// 2026-09-16.
    public var stagger: Stagger??
    /// Keys this build does not interpret, written back verbatim.
    public var carried: [String: JSONValue] = [:]

    public init(id: String, name: String, start: Double, end: Double, scrim: SceneScrim? = nil,
                solo: Bool = false, hudFade: Double = 0.5, stagger: Stagger?? = .none) {
        self.id = id; self.name = name; self.start = start; self.end = end; self.scrim = scrim
        self.solo = solo; self.hudFade = hudFade; self.stagger = stagger
    }

    /// The cascade, when there is one.
    public var staggerValue: Stagger? { stagger ?? nil }
}

/// The extra delay each of `scene`'s elements waits before its entrance, by
/// element id — from the elements' positions on a frame of `aspect` (width
/// over height), in the order they are listed. Empty without a stagger.
public func sceneStaggerDelays(_ scene: OverlayScene, _ elements: [OverlayElement], _ aspect: Double) -> [String: Double] {
    var out: [String: Double] = [:]
    guard let stagger = scene.staggerValue else { return out }
    let members = elements.filter { $0.sceneId == scene.id }
    if members.isEmpty { return out }
    // Height units: x is a fraction of the width, sizeFrac of the shorter side.
    let short = min(aspect, 1)
    let boxes = members.map { Rect(x: $0.x * aspect, y: $0.y, width: 0, height: $0.sizeFrac * short) }
    let delays = staggerDelays(boxes, Size(aspect, 1), stagger)
    for (i, el) in members.enumerated() { out[el.id] = delays[i] }
    return out
}

/// An element's animation with the scene's stagger added to its entrance. An
/// element with no entrance of its own gets a cut on its beat, so a stagger
/// moves every member of the scene, not only the animated ones.
public func staggeredAnimation(_ anim: ElementAnimation?, _ extraDelay: Double) -> ElementAnimation? {
    if extraDelay == 0 || extraDelay.isNaN { return anim }
    var base = anim?.inStep ?? AnimStep(preset: .none, duration: 0, easing: .linear)
    base.delay = (base.delay ?? 0) + extraDelay
    var out = anim ?? ElementAnimation()
    out.in = .some(base)
    return out
}

/// The id the studio gives its one scene today; the model already takes N.
public let introSceneId = "intro"

public func createIntroScene(end: Double = 3) -> OverlayScene {
    OverlayScene(id: introSceneId, name: "Introduction", start: 0, end: end, scrim: nil, solo: false, hudFade: 0.5)
}

public func findScene(_ scenes: [OverlayScene]?, _ id: String?) -> OverlayScene? {
    guard let scenes, let id, !id.isEmpty else { return nil }
    return scenes.first { $0.id == id }
}

/// The absolute window an element is on screen for. Outside a scene, the
/// element's own window (absent = the whole clip). Inside one, its window is
/// an offset WITHIN the scene, clamped to it: the scene owns when the group
/// lives, the element only says where in that span it takes its turn.
public func resolveWindow(_ el: OverlayElement, _ scene: OverlayScene?) -> TimeWindow? {
    guard let scene else { return el.window }
    let start = scene.start + max(0, el.window?.start ?? 0)
    let end: Double
    if let rel = el.window?.end { end = min(scene.end, scene.start + rel) } else { end = scene.end }
    return TimeWindow(start: min(start, end), end: end)
}

/// How far into a fade of `span` seconds `t` sits, 0..1 (1 when span is 0).
private func ramp(_ t: Double, _ span: Double) -> Double {
    // A zero-length fade is a step, not a constant: without the guard a scrim
    // with no fade would read as "fully out" from the first frame.
    if span <= 0 { return t >= 0 ? 1 : 0 }
    let p = t / span
    return p < 0 ? 0 : (p > 1 ? 1 : p)
}

public struct SceneScrimRender: Equatable, Sendable {
    public var color: String
    public var opacity: Double
    public init(color: String, opacity: Double) { self.color = color; self.opacity = opacity }
}

public struct SceneRender: Equatable, Sendable {
    /// Colour + live opacity of the scrim to paint, or nil.
    public var scrim: SceneScrimRender?
    /// Alpha multiplier for every element that belongs to no scene.
    public var outsideAlpha: Double
    public init(scrim: SceneScrimRender?, outsideAlpha: Double) { self.scrim = scrim; self.outsideAlpha = outsideAlpha }
}

private let noScenes = SceneRender(scrim: nil, outsideAlpha: 1)

/// What the scene layer contributes at time `t` (seconds from the first
/// exported frame): the scrim's current strength, and how visible the
/// elements outside every scene are. With several scenes the strongest scrim
/// and the dimmest `outsideAlpha` win — adding veils up to something opaque is
/// never what an author means.
public func resolveScenes(_ scenes: [OverlayScene]?, _ t: Double) -> SceneRender {
    guard let scenes, !scenes.isEmpty else { return noScenes }
    var scrim: SceneScrimRender? = nil
    var outsideAlpha = 1.0

    for scene in scenes {
        let len = scene.end - scene.start
        if len <= 0 { continue }

        if let s = scene.scrim, t > scene.start - s.fade, t < scene.end + s.fade {
            let fade = min(s.fade, len / 2)
            let rise = ramp(t - scene.start, fade)
            let fall = 1 - ramp(t - (scene.end - fade), fade)
            let strength = max(0, min(rise, fall))
            let opacity = s.opacity * strength
            if opacity > 0, scrim.map({ opacity > $0.opacity }) ?? true {
                scrim = SceneScrimRender(color: s.color, opacity: opacity)
            }
        }

        if scene.solo {
            // Held back from `hudFade` before the scene opens, back to full
            // `hudFade` after it closes — one knob, both directions.
            let before = 1 - ramp(t - (scene.start - scene.hudFade), scene.hudFade)
            let after = ramp(t - scene.end, scene.hudFade)
            let alpha = t < scene.start ? before : (t >= scene.end ? after : 0)
            outsideAlpha = min(outsideAlpha, max(0, alpha))
        }
    }
    return SceneRender(scrim: scrim, outsideAlpha: outsideAlpha)
}

// MARK: - JSON

private let sceneKeys: Set<String> = ["id", "name", "start", "end", "scrim", "solo", "hudFade", "stagger"]

/// A stored scrim read back — nil when it is not a record; a missing field
/// takes the scene panel's default.
public func readSceneScrim(_ v: JSONValue?) -> SceneScrim? {
    guard let o = v?.objectValue else { return nil }
    let d = SceneScrim.default
    return SceneScrim(color: OverlayJSON.string(o, "color") ?? d.color,
                      opacity: OverlayJSON.number(o, "opacity") ?? d.opacity,
                      fade: OverlayJSON.number(o, "fade") ?? d.fade)
}

/// A stored scene read back — nil when it is not a record or carries no id.
/// A missing field takes `createIntroScene`'s value; a stagger is read
/// through `normaliseStagger`, as every stored cascade is.
public func readOverlayScene(_ v: JSONValue?) -> OverlayScene? {
    guard let o = v?.objectValue, let id = o["id"]?.stringValue else { return nil }
    let d = createIntroScene()
    var scene = OverlayScene(
        id: id,
        name: OverlayJSON.string(o, "name") ?? d.name,
        start: OverlayJSON.number(o, "start") ?? d.start,
        end: OverlayJSON.number(o, "end") ?? d.end,
        scrim: readSceneScrim(o["scrim"]),
        solo: OverlayJSON.bool(o, "solo") ?? d.solo,
        hudFade: OverlayJSON.number(o, "hudFade") ?? d.hudFade
    )
    if let s = o["stagger"] {
        if s.isNull { scene.stagger = .some(nil) } else if s.objectValue != nil { scene.stagger = .some(normaliseStagger(s)) }
    }
    scene.carried = o.filter { !sceneKeys.contains($0.key) }
    return scene
}

/// A stored list read back, unreadable entries left out.
public func readOverlayScenes(_ v: JSONValue?) -> [OverlayScene] {
    (v?.arrayValue ?? []).compactMap { readOverlayScene($0) }
}

extension SceneScrim {
    public var json: JSONValue {
        .object(["color": .string(color), "opacity": .number(opacity), "fade": .number(fade)])
    }
}

extension OverlayScene {
    /// `scrim` is written `null` when off, as the web writes it.
    public var json: JSONValue {
        var o = carried
        o["id"] = .string(id)
        o["name"] = .string(name)
        o["start"] = .number(start)
        o["end"] = .number(end)
        o["scrim"] = scrim?.json ?? .null
        o["solo"] = .bool(solo)
        o["hudFade"] = .number(hudFade)
        switch stagger {
        case .none: break
        case .some(.none): o["stagger"] = .null
        case .some(.some(let s)): o["stagger"] = s.json
        }
        return .object(o)
    }
}
