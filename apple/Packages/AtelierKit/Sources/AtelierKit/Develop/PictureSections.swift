// A picture's settings in SECTIONS — the one picker every multi-part verb of
// the Develop tool goes through: copy and paste (⌘⇧C / ⌘⇧V), apply to other
// pictures, reset. Port of `src/shared/develop/picture-sections.ts`.
//
// The sections are the ones `pictureEdits` already names, so "edited" and
// "what can be copied" are ONE vocabulary. What never travels, whatever is
// ticked: which FILE the picture is developed from and its RAW base (facts
// about one capture's bytes), its delivery state, and its title and caption
// (its own words).
//
// A section this port carries rather than interprets (border, perspective,
// lens, detail, vignette, repair, layers) is copied and cleared as the JSON
// it is, under `RollPicture.carried` — where "nothing" is the key's ABSENCE,
// as `Roll.swift` reads it.

import Foundation

public typealias PictureSection = PictureEdit

/// One row of the picker: the section, its name and what it carries.
public struct PictureSectionInfo: Equatable, Sendable {
    public let id: PictureSection
    public let label: String
    public let hint: String
    public init(id: PictureSection, label: String, hint: String) { self.id = id; self.label = label; self.hint = hint }
}

/// The sections in the inspector's own order, with what each carries.
public let pictureSections: [PictureSectionInfo] = [
    PictureSectionInfo(id: .develop, label: "Develop", hint: "exposure, tone, colour, curves, levels, mixer, B&W, grading"),
    PictureSectionInfo(id: .look, label: "Look", hint: "LUTs, output transform, grain"),
    PictureSectionInfo(id: .crop, label: "Crop", hint: "aspect, framing, straighten, flip"),
    PictureSectionInfo(id: .border, label: "Border", hint: "the margin round the delivered picture"),
    PictureSectionInfo(id: .perspective, label: "Perspective", hint: "the keystone"),
    PictureSectionInfo(id: .lens, label: "Lens", hint: "distortion, fringing, vignetting"),
    PictureSectionInfo(id: .detail, label: "Detail", hint: "denoise, defringe, sharpen — and texture, clarity, dehaze"),
    PictureSectionInfo(id: .vignette, label: "Vignette", hint: "the post-crop vignette, drawn in the delivered frame"),
    PictureSectionInfo(id: .repair, label: "Repair", hint: "heal and clone spots — for dust on the sensor, the same place on every frame"),
    PictureSectionInfo(id: .layers, label: "Layers", hint: "masks and their adjustments"),
]

/// What a copy ticks until the author says otherwise: the settings a roll
/// SHARES — one light, one look, one lens, one sensor — and not what belongs
/// to one frame's composition or to one frame's objects.
public let defaultCopySections: [PictureSection] = [.develop, .look, .lens, .detail]

/// A stored list of sections, in the inspector's order, unknown ids dropped.
public func readSections(_ raw: JSONValue?, fallback: [PictureSection] = defaultCopySections) -> [PictureSection] {
    guard let list = raw?.arrayValue else { return fallback }
    let wanted = Set(list.compactMap { $0.stringValue.flatMap { PictureSection(rawValue: $0) } })
    return pictureSections.map(\.id).filter { wanted.contains($0) }
}

/// The develop a target keeps under `numbers`: its OWN base and gain, never the source's.
private func developOnto(_ target: RollPicture, _ numbers: DevelopSettings?) -> DevelopSettings? {
    var own: (base: DevelopBase?, rawGain: Double?)? = nil
    if let t = target.develop, isRawDevelop(t) { own = (t.base, t.rawGain) }
    let value = numbers.map(withoutBase)
    let kept: DevelopSettings? = (value != nil && !isDefaultDevelop(value)) ? value : nil
    if kept == nil && own == nil { return nil }
    var out = kept ?? .default
    if let own {
        out.base = own.base
        out.rawGain = own.rawGain
    }
    return out
}

/// The carried keys each section owns.
private let carriedRecords: [PictureSection: String] = [.border: "border", .perspective: "keystone", .lens: "lens", .detail: "detail", .vignette: "vignette"]
private let carriedLists: [PictureSection: String] = [.repair: "repair", .layers: "layers"]

/// A carried value as a picture keeps it: a null record and an empty list are absence.
private func carriedOrNil(_ value: JSONValue?) -> JSONValue? {
    guard let value, value != .null else { return nil }
    if let list = value.arrayValue, list.isEmpty { return nil }
    return value
}

/// `target` wearing `source`'s settings in `sections`, each a copy of its own.
/// Everything else of the target — its file, its base, its words, its delivery
/// state, the sections not ticked — is left exactly as it was.
public func withSections(_ target: RollPicture, _ source: RollPicture, _ sections: [PictureSection]) -> RollPicture {
    let on = Set(sections)
    var next = target
    if on.contains(.develop) { next.develop = developOnto(target, source.develop) }
    if on.contains(.look) { next.grade = source.grade }
    if on.contains(.crop) {
        next.aspect = source.aspect
        next.framing = source.framing
    }
    for (section, key) in carriedRecords where on.contains(section) {
        next.carried[key] = carriedOrNil(source.carried[key])
    }
    for (section, key) in carriedLists where on.contains(section) {
        next.carried[key] = carriedOrNil(source.carried[key])
    }
    return next
}

/// `picture` with `sections` back to as shot — its file, base, words and delivery state untouched.
public func withoutSections(_ picture: RollPicture, _ sections: [PictureSection]) -> RollPicture {
    let on = Set(sections)
    var next = picture
    if on.contains(.develop) { next.develop = developOnto(picture, nil) }
    if on.contains(.look) { next.grade = nil }
    if on.contains(.crop) {
        next.aspect = "original"
        next.framing = nil
    }
    for (section, key) in carriedRecords where on.contains(section) { next.carried[key] = nil }
    for (section, key) in carriedLists where on.contains(section) { next.carried[key] = nil }
    return next
}

/// What the sections say, as JSON — the web compares `JSON.stringify` of the same list.
private func pictureSnapshot(_ p: RollPicture) -> JSONValue {
    .array([
        p.develop?.json ?? .null,
        p.grade?.json ?? .null,
        .string(p.aspect),
        p.framing?.json ?? .null,
        carriedOrNil(p.carried["border"]) ?? .null,
        carriedOrNil(p.carried["keystone"]) ?? .null,
        carriedOrNil(p.carried["lens"]) ?? .null,
        carriedOrNil(p.carried["detail"]) ?? .null,
        carriedOrNil(p.carried["vignette"]) ?? .null,
        carriedOrNil(p.carried["repair"]) ?? .array([]),
        carriedOrNil(p.carried["layers"]) ?? .array([]),
    ])
}

private func sameSections(_ a: RollPicture, _ b: RollPicture) -> Bool {
    pictureSnapshot(a) == pictureSnapshot(b)
}

/// The roll with `source`'s `sections` written onto every picture of `ids` — the
/// same roll when nothing changed. The source picture itself is skipped when it
/// IS one of the roll's pictures (an apply-to); a copied SNAPSHOT pastes back
/// onto the picture it came from, which is how a copy undoes later edits. The
/// web skips the source by object identity; a value that EQUALS the source is
/// the same picture here, and the same answer — pasting it onto itself changes
/// nothing.
public func applySections(_ roll: RollDoc, _ source: RollPicture, _ ids: [String], _ sections: [PictureSection],
                          now: Double = nowMillis()) -> RollDoc {
    if sections.isEmpty { return roll }
    var changed = false
    let pictures = roll.pictures.map { p -> RollPicture in
        if !ids.contains(p.id) || p == source { return p }
        let next = withSections(p, source, sections)
        if sameSections(next, p) { return p }
        changed = true
        return next
    }
    if !changed { return roll }
    var out = roll
    out.pictures = pictures
    out.updatedAt = now
    return out
}

/// The roll with one picture's `sections` reset — the same roll when there was nothing to reset.
public func resetSections(_ roll: RollDoc, _ id: String, _ sections: [PictureSection], now: Double = nowMillis()) -> RollDoc {
    var changed = false
    let pictures = roll.pictures.map { p -> RollPicture in
        if p.id != id { return p }
        let next = withoutSections(p, sections)
        if sameSections(next, p) { return p }
        changed = true
        return next
    }
    if !changed { return roll }
    var out = roll
    out.pictures = pictures
    out.updatedAt = now
    return out
}

/// Which of `sections` a picture actually has something in — what a copy would carry, a reset would clear.
public func sectionsWithEdits(_ picture: RollPicture) -> Set<PictureSection> {
    Set(pictureEdits(picture))
}

// MARK: - the settings clipboard

/// What ⌘⇧C holds: a picture's settings as they were, and which sections of them.
public struct CopiedSettings: Equatable, Sendable {
    /// The picture as it was when copied — a snapshot, so a later edit of it changes nothing.
    public var from: RollPicture
    public var sections: [PictureSection]
    public init(from: RollPicture, sections: [PictureSection]) { self.from = from; self.sections = sections }
}

/// The settings clipboard: one snapshot held for the session, never persisted
/// — a clipboard that outlived the app would paste yesterday's settings. The
/// web's module state; the app keeps `shared` or one of its own.
public final class SettingsClipboard {
    public static let shared = SettingsClipboard()

    private var held: CopiedSettings?
    private var listeners: [Int: () -> Void] = [:]
    private var nextToken = 0

    public init() {}

    /// Hold `picture`'s `sections`; an empty list clears the clipboard.
    public func copy(_ picture: RollPicture, _ sections: [PictureSection]) {
        held = sections.isEmpty ? nil : CopiedSettings(from: picture, sections: sections)
        for listener in listeners.values { listener() }
    }

    public var copied: CopiedSettings? { held }

    /// The listener runs on every copy; the closure returned takes it off.
    public func subscribe(_ listener: @escaping () -> Void) -> () -> Void {
        let token = nextToken
        nextToken += 1
        listeners[token] = listener
        return { [weak self] in self?.listeners[token] = nil }
    }
}

/// The web's names, over the shared clipboard.
public func copySettings(_ picture: RollPicture, _ sections: [PictureSection]) {
    SettingsClipboard.shared.copy(picture, sections)
}

public func copiedSettings() -> CopiedSettings? {
    SettingsClipboard.shared.copied
}

public func subscribeCopiedSettings(_ listener: @escaping () -> Void) -> () -> Void {
    SettingsClipboard.shared.subscribe(listener)
}
