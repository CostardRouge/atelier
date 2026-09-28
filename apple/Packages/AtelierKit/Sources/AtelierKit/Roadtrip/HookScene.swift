// Handing a Road Trip hook to the Studio, as an intro SCENE — and its closing
// card as the project's OUTRO, and its picture's develop. Port of
// `src/shared/roadtrip/hook-scene.ts`.
//
// A translation, not a new pipeline: the badge is already overlay elements,
// the Studio already holds a group of elements for the first seconds of a
// clip (a scene), and its export already burns overlays in over a graded
// frame — so ONE export carries the grade, the telemetry and the hook.
//
// Rules kept:
// - Everything injected is named `roadtrip:…` and belongs to the
//   `roadtrip-hook` scene, so a second send REPLACES the first; nothing else
//   in the project is touched (a grade, a trim, the telemetry, the author's
//   own intro and outro survive a send).
// - The shades do NOT cross: a scene has a flat scrim, so the strongest
//   shade's colour and strength stand in, held back, and the panel says so.
// - The hook picture's DEVELOP crosses under the media's key, marked `via:
//   roadtrip` so a resend replaces only its own; an entry the author set in
//   the Studio is never overwritten (it is `held` and said); a RAW base never
//   crosses; an unlink takes only the marked one back out.
// - The call to action becomes the project's OUTRO through the same
//   `ctaLayout` the carousel's last slide uses; an outro the author composed
//   is never overwritten (`withCtaOutro` answers nil for the panel to say).
// - `updatedAt` is stamped from `now` (ms), a parameter, never the clock.

import Foundation

/// The scene a sent hook lives in. One per project: a clip has one hook.
public let hookSceneId = "roadtrip-hook"

/// Every element the bridge owns carries this prefix, and only those.
public let hookElementPrefix = "roadtrip:"

public func isHookElement(_ el: OverlayElement) -> Bool {
    el.id.hasPrefix(hookElementPrefix)
}

/// The flat scrim that stands in for a stack of gradients: the strongest
/// shade's colour at its own strength, held back, or nil with nothing to
/// stand in for. Lossy on purpose, by exactly where the darkening falls.
public func scrimFromShades(_ shades: [Shade], _ fade: Double = 0.4) -> SceneScrim? {
    var strongest: Shade? = nil
    for shade in shades where shade.strength > 0 {
        if strongest == nil || shade.strength > strongest!.strength { strongest = shade }
    }
    guard let strongest else { return nil }
    // A veil over the whole frame reads far heavier than the same number in a
    // gradient that clears half of it.
    return SceneScrim(color: strongest.color, opacity: min(1, max(0, strongest.strength * 0.6)), fade: fade)
}

public struct HookInjection: Equatable, Sendable {
    public var scene: OverlayScene
    public var elements: [OverlayElement]

    public init(scene: OverlayScene, elements: [OverlayElement]) {
        self.scene = scene; self.elements = elements
    }
}

/// The badge, translated into a scene and the elements inside it. Element
/// windows are offsets WITHIN the scene, so a staggered entrance keeps its
/// stagger and an exit lands on the hook's own duration.
public func hookInjection(_ badgeElements: [OverlayElement], _ durationSeconds: Double, _ shades: [Shade] = [],
                          _ name: String = "Trip hook") -> HookInjection {
    let end = durationSeconds.isFinite && durationSeconds > 0 ? durationSeconds : 4
    // The telemetry HUD holds back while the hook runs, then fades in.
    let scene = OverlayScene(id: hookSceneId, name: name, start: 0, end: end, scrim: scrimFromShades(shades),
                             solo: true, hudFade: 0.5)
    let elements = badgeElements.map { el -> OverlayElement in
        var out = el
        out.id = hookElementPrefix + el.id
        out.sceneId = hookSceneId
        return out
    }
    return HookInjection(scene: scene, elements: elements)
}

/// A project with this hook in it, replacing any hook sent before. The hook is
/// drawn LAST, over the telemetry.
public func withHook(_ doc: ProjectDoc, _ injection: HookInjection, now: Double = nowMillis()) -> ProjectDoc {
    var out = doc
    out.updatedAt = now
    out.elements = doc.elements.filter { !isHookElement($0) } + injection.elements
    out.scenes = doc.scenes.filter { $0.id != hookSceneId } + [injection.scene]
    return out
}

/// The project with the hook taken back out — and the develop it sent — and
/// nothing else changed; the same document when there was nothing to take.
public func withoutHook(_ doc: ProjectDoc, now: Double = nowMillis()) -> ProjectDoc {
    let sent = doc.media.develops.filter { $0.value.via == .roadtrip }.map(\.key)
    if !doc.elements.contains(where: isHookElement) && !doc.scenes.contains(where: { $0.id == hookSceneId })
        && sent.isEmpty {
        return doc
    }
    var out = doc
    out.updatedAt = now
    out.elements = doc.elements.filter { !isHookElement($0) }
    out.scenes = doc.scenes.filter { $0.id != hookSceneId }
    for key in sent { out.media.develops[key] = nil }
    return out
}

// MARK: - the hook picture's develop

/// The hook picture as the bridge sends it: which media, and its correction.
public struct HookDevelop: Equatable, Sendable {
    /// The picture's file name — the project keys a media by its base name.
    public var name: String
    public var hash: String?
    /// Nil or as shot: the project keeps nothing of Trips' for it.
    public var settings: DevelopSettings?

    public init(name: String, hash: String? = nil, settings: DevelopSettings?) {
        self.name = name; self.hash = hash; self.settings = settings
    }
}

/// The key a project gives a media: its asset id, the lowercased base name.
public func projectMediaKey(_ name: String) -> String {
    fileBaseName(name).lowercased()
}

/// What `withHookDevelop` answers: the document, and whether the author's own
/// develop for that media was there and left alone.
public struct HookDevelopWrite: Equatable, Sendable {
    public var doc: ProjectDoc
    public var held: Bool

    public init(doc: ProjectDoc, held: Bool) { self.doc = doc; self.held = held }
}

/// The project with the hook picture's develop written — `held` when the
/// author's own develop for that media is there and was left alone. A RAW
/// base (`base`, `rawGain`, `rawWb`) never crosses.
public func withHookDevelop(_ doc: ProjectDoc, _ hook: HookDevelop?, now: Double = nowMillis()) -> HookDevelopWrite {
    guard let hook else { return HookDevelopWrite(doc: doc, held: false) }
    let key = projectMediaKey(hook.name)
    let there = doc.media.develops[key]
    if let there, there.via != .roadtrip { return HookDevelopWrite(doc: doc, held: true) }
    let settings = hook.settings.map(withoutBase)
    var out = doc
    if let settings, !isDefaultDevelop(settings) {
        let hash = hook.hash.flatMap { $0.isEmpty ? nil : $0 }
        out.media.develops[key] = SavedDevelop(settings: settings, hash: hash, via: .roadtrip)
    } else if there != nil {
        out.media.develops[key] = nil
    } else {
        return HookDevelopWrite(doc: doc, held: false)
    }
    out.updatedAt = now
    return HookDevelopWrite(doc: out, held: false)
}

// MARK: - the call to action, as the project's OUTRO

/// True when a project's outro is one this bridge put there.
public func isRoadtripOutro(_ outro: OutroCard?) -> Bool {
    guard let outro else { return false }
    return outro.elements.contains { $0.id.hasPrefix(hookElementPrefix) }
}

/// The trip's call to action as an outro card, laid out for the piece's own
/// frame by the same `ctaLayout` the carousel's closing slide uses. Nil when
/// the card has nothing to say — a blank end card is worse than none.
public func ctaOutro(_ cta: CtaSlide, _ aspect: Double, _ seconds: Double = outroSecondsDefault) -> OutroCard? {
    let trim = { (s: String) in s.trimmingCharacters(in: .whitespacesAndNewlines) }
    if trim(cta.headline).isEmpty && trim(cta.body).isEmpty && trim(cta.url).isEmpty { return nil }
    let layout = ctaLayout(cta, aspect)
    let qr = layout.qr.map {
        OutroQr(url: trim(cta.url), x: $0.x, y: $0.y, sizeFrac: $0.sizeFrac, dark: cta.ink, light: cta.background)
    }
    let elements = layout.elements.map { el -> OverlayElement in
        var out = el
        out.id = hookElementPrefix + el.id
        return out
    }
    return OutroCard(seconds: seconds, background: cta.background, elements: elements, qr: qr)
}

/// A project with this call-to-action outro — replacing one this bridge sent
/// before, or filling an empty slot; `card` nil takes a sent card back out.
/// Nil instead of a document when the project carries an outro of its OWN,
/// which a send must not overwrite — the caller says so in the panel.
public func withCtaOutro(_ doc: ProjectDoc, _ card: OutroCard?, now: Double = nowMillis()) -> ProjectDoc? {
    let current = doc.outro
    let foreign = current != nil && !isRoadtripOutro(current)
    if foreign { return card == nil ? doc : nil }
    if card == nil && current == nil { return doc }
    var out = doc
    out.updatedAt = now
    out.outro = card
    return out
}

/// The project without a bridge-sent outro; the author's own is left alone.
public func withoutCtaOutro(_ doc: ProjectDoc, now: Double = nowMillis()) -> ProjectDoc {
    if !isRoadtripOutro(doc.outro) { return doc }
    var out = doc
    out.updatedAt = now
    out.outro = nil
    return out
}

/// Whether a project is currently carrying a sent hook.
public func hasHook(_ doc: ProjectDoc) -> Bool {
    doc.scenes.contains { $0.id == hookSceneId }
}
