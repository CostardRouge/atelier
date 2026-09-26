// A post as the ordered set of pictures that actually goes out — the DECK.
// Port of `src/shared/roadtrip/deck.ts`.
//
// Rules kept:
// - The shape is an INTRO carrying the hook, any number of CONTENT pictures,
//   and a closing CALL TO ACTION taken from the trip's one template. A reel is
//   the same model with a deck of one; nothing branches on the post's kind.
// - The CTA is NOT stored on the post: it is appended at render time from
//   `TripDoc.cta`, so editing it once changes the last slide of every deck —
//   and it is appended only when the post asks for it AND the template says
//   something (a blank last slide is worse than none).
// - `auto` is resolved in ONE place (`resolveSlideMedium`), a clip being told
//   from its file NAME by the Library's own `classifyPart`, so the deck and the
//   sidebar cannot disagree about what a clip is. A forced image over something
//   that moves is obeyed, and the reason says what it costs.
// - An opener that PLAYS (`hookMoves`), a collage whose cells move, and a
//   picture that moves in its frame all make an `auto` slide a video.
// - Only CONTENT slides reorder (`moveItem`, over the post's own list): the
//   hook and the closing card are structural.
// - A caption is one plain element per line under deterministic ids
//   (`caption:<line>`), wrapped here because the engine never wraps; it keeps
//   the trip's font but never its glow or its panel — those are the badge's.
//
// Pure: no picture is decoded here.

import Foundation

public enum DeckSlideKind: String, CaseIterable, Sendable {
    case hook, content, cta
}

/// Why a slide comes out as it does — one enum over both media, so a panel can
/// say the real reason for every line.
public enum SlideReason: String, CaseIterable, Sendable {
    /// A still picture, delivered as one.
    case plain
    /// Video: something on the slide is animated.
    case animated
    /// Video: the picture is a clip.
    case moving
    /// Video: a still held for its seconds, because the author asked.
    case forcedVideo = "forced-video"
    /// Image: it animates, but the author asked for a still — drawn settled.
    case settled
    /// Image: it is a clip, but the author asked for a still — its chosen frame.
    case frozen
}

/// What a slide is DELIVERED as, `auto` resolved — the web's `'image' | 'video'`.
public enum DeckMedium: String, CaseIterable, Sendable {
    case image, video
}

/// One picture of the deck, in the order it is swiped.
public struct DeckSlide: Equatable, Sendable {
    public var kind: DeckSlideKind
    /// Position in the deck, 1-based — what the file name counts.
    public var position: Int
    /// Identifies a content slide for editing; the hook and CTA have none.
    public var slideId: String?
    public var media: SavedMediaRef?
    public var videoTimeSeconds: Double
    /// How this slide's picture sits in the frame. The closing card has none.
    public var framing: Framing
    /// How it MOVES in the frame over the slide, or nil.
    public var motion: FramingMotion?
    /// This picture's own correction, applied before the grade; nil is as shot.
    public var develop: DevelopSettings?
    /// This picture's OWN grade, or nil to follow the piece's (`PostGrade.swift`).
    public var grade: TripGrade?
    /// Several pictures in this slide's frame, or nil for one.
    public var collage: SlideCollage?
    /// The author's own line over a content picture.
    public var caption: String
    /// What this slide is delivered as, `auto` already resolved.
    public var medium: DeckMedium
    /// What the author CHOSE, before resolution. Always `image` for the closing card.
    public var chosen: SlideMedium
    /// Why it came out that way.
    public var reason: SlideReason
    /// How long it is on screen as a video — kept for an image too: the same
    /// slide becomes a video the moment it is combined into a reel.
    public var seconds: Double
    /// The speed its clip plays at (1 for anything that is not a clip).
    public var speed: Double

    public init(kind: DeckSlideKind, position: Int, slideId: String?, media: SavedMediaRef?, videoTimeSeconds: Double,
                framing: Framing, motion: FramingMotion?, develop: DevelopSettings?, grade: TripGrade?,
                collage: SlideCollage?, caption: String, medium: DeckMedium, chosen: SlideMedium,
                reason: SlideReason, seconds: Double, speed: Double) {
        self.kind = kind; self.position = position; self.slideId = slideId; self.media = media
        self.videoTimeSeconds = videoTimeSeconds; self.framing = framing; self.motion = motion
        self.develop = develop; self.grade = grade; self.collage = collage; self.caption = caption
        self.medium = medium; self.chosen = chosen; self.reason = reason; self.seconds = seconds; self.speed = speed
    }
}

/// What `resolveSlideMedium` answers: the medium, and why.
public struct SlideMediumResolution: Equatable, Sendable {
    public var medium: DeckMedium
    public var reason: SlideReason

    public init(medium: DeckMedium, reason: SlideReason) {
        self.medium = medium; self.reason = reason
    }
}

/// What a slide is delivered as, and why: the one place `auto` is resolved.
public func resolveSlideMedium(_ medium: SlideMedium, _ animated: Bool, _ mediaName: String?) -> SlideMediumResolution {
    let moving = mediaName.map { classifyPart($0) == .video } ?? false
    if medium == .image {
        if animated { return SlideMediumResolution(medium: .image, reason: .settled) }
        if moving { return SlideMediumResolution(medium: .image, reason: .frozen) }
        return SlideMediumResolution(medium: .image, reason: .plain)
    }
    // Forced video and auto agree wherever something already moves; the reason
    // then names what actually moves rather than the author's click.
    if animated { return SlideMediumResolution(medium: .video, reason: .animated) }
    if moving { return SlideMediumResolution(medium: .video, reason: .moving) }
    if medium == .video { return SlideMediumResolution(medium: .video, reason: .forcedVideo) }
    return SlideMediumResolution(medium: .image, reason: .plain)
}

/// True when any badge piece carries an animation, or the pieces cascade — what makes a hook move.
public func hookAnimates(_ styles: BadgePieceStyles, _ cascade: BadgeCascade? = nil) -> Bool {
    if cascade != nil { return true }
    return styles.values.contains { style in
        if case .some(.some) = style.animation { return true }
        return false
    }
}

/// Whether a media name is a clip, by the Library's own reading of it.
private func deckIsClip(_ mediaName: String?) -> Bool {
    mediaName.map { classifyPart($0) == .video } ?? false
}

/// A framing read back through the document's own reader, as the web's
/// `normaliseFraming` does on every stored one.
private func deckFraming(_ framing: Framing) -> Framing {
    normaliseFraming(framing.json)
}

/// The deck a post delivers. Always at least the hook; the CTA only when the
/// post asks for it AND the trip's template says something.
public func deckSlides(_ trip: TripDoc, _ post: TripPost) -> [DeckSlide] {
    let badge = post.badge
    // An opener that plays (the scrub) moves the hook exactly as an animated
    // piece does: left as `auto`, it must leave as a video. Evaluated in the
    // web's order, so the opener is prepared only when nothing cheaper moves.
    let hookMovesAtAll = hookAnimates(badge.pieceStyles, badge.cascade)
        || hookMoves(trip, post)
        || collageAnimates(badge.collage)
        || hasMotion(badge.motion)
        || collageCellsMove(badge.collage)
    let hookMedium = resolveSlideMedium(badge.medium, hookMovesAtAll, post.media?.name)
    var slides: [DeckSlide] = [
        DeckSlide(
            kind: .hook, position: 1, slideId: nil, media: post.media, videoTimeSeconds: badge.videoTimeSeconds,
            framing: deckFraming(badge.framing), motion: badge.motion, develop: badge.develop, grade: badge.grade,
            collage: badge.collage, caption: "", medium: hookMedium.medium, chosen: badge.medium,
            reason: hookMedium.reason, seconds: badge.hookSeconds,
            speed: deckIsClip(post.media?.name) ? clipSpeed(badge.videoSpeed) : 1
        ),
    ]

    for slide in post.slides {
        // A content slide moves when its collage's cells do, or when a picture
        // moves in its frame.
        let animated = collageAnimates(slide.collage) || hasMotion(slide.motion) || collageCellsMove(slide.collage)
        let resolved = resolveSlideMedium(slide.medium, animated, slide.media?.name)
        slides.append(DeckSlide(
            kind: .content, position: slides.count + 1, slideId: slide.id, media: slide.media,
            videoTimeSeconds: slide.videoTimeSeconds, framing: deckFraming(slide.framing), motion: slide.motion,
            develop: slide.develop, grade: slide.grade, collage: slide.collage, caption: slide.caption,
            medium: resolved.medium, chosen: slide.medium, reason: resolved.reason, seconds: slide.seconds,
            speed: deckIsClip(slide.media?.name) ? clipSpeed(slide.videoSpeed) : 1
        ))
    }

    let cta = trip.cta
    let says = !deckTrim(cta.headline).isEmpty || !deckTrim(cta.body).isEmpty || !deckTrim(cta.url).isEmpty
    if post.includeCta && says {
        // The closing card carries no picture and nothing animated, so it is a
        // still — and, inside a reel, the tail the Studio already appends, at
        // the length that outro has always used. Drawn, not photographed:
        // nothing to grade.
        slides.append(DeckSlide(
            kind: .cta, position: slides.count + 1, slideId: nil, media: nil, videoTimeSeconds: 0,
            framing: .default, motion: nil, develop: nil, grade: nil, collage: nil, caption: "",
            medium: .image, chosen: .image, reason: .plain, seconds: outroSecondsDefault, speed: 1
        ))
    }
    return slides
}

private func deckTrim(_ s: String) -> String {
    s.trimmingCharacters(in: .whitespacesAndNewlines)
}

/// The extension a slide's file is written with — what it DELIVERS.
public enum DeckFileExtension: String, CaseIterable, Sendable {
    case png, mp4
}

/// `australia-day-27-01-hook.png` — ordered, so a file listing swipes right.
/// The extension follows what the slide DELIVERS; the numbering keeps a mixed
/// deck in swipe order.
public func slideFileName(_ tripName: String, _ postSlug: String, _ slide: DeckSlide, _ total: Int,
                          _ ext: DeckFileExtension = .png) -> String {
    let width = String(total).count
    let n = TripJS.pad(slide.position, max(2, width))
    let suffix = slide.kind == .content ? "" : "-\(slide.kind.rawValue)"
    let stem = [tripName, postSlug].map(TripJS.fileSlug).filter { !$0.isEmpty }.joined(separator: "-")
    return "\(stem.isEmpty ? "" : "\(stem)-")\(n)\(suffix).\(ext.rawValue)"
}

/// A caption's size, as a fraction of the shorter side.
private let deckCaptionSize = 0.045

private let captionIdPrefix = "caption:"

/// A caption line's element id: `caption:<line index>` — deterministic, so a
/// stage that hit-tests the repainted elements gets the same line back.
public func captionElementId(_ line: Int) -> String {
    "\(captionIdPrefix)\(line)"
}

/// The caption line an element id names, or nil for any other id. The rest is
/// read as JavaScript's `Number()` reads it.
public func captionLineFromElementId(_ id: String) -> Int? {
    guard id.hasPrefix(captionIdPrefix) else { return nil }
    let n = JSLoose.number(.string(String(id.dropFirst(captionIdPrefix.count))))
    guard n.isFinite, n == n.rounded(), n >= 0, n < 9e15 else { return nil }
    return Int(n)
}

/// A content slide's overlay: the author's line, or nothing — one plain
/// element per wrapped line, the block's foot at 0.93 whatever it holds.
public func contentSlideElements(_ caption: String, _ aspect: Double = 4.0 / 5, _ color: String = "#ffffff") -> [OverlayElement] {
    let text = deckTrim(caption)
    if text.isEmpty { return [] }

    let w = aspect >= 1 ? 1000 : 1000 * aspect
    let h = aspect >= 1 ? 1000 / aspect : 1000
    let lines = wrapText(text, maxChars: charBudget(widthPx: w * 0.86, fontPx: deckCaptionSize * min(w, h)))

    let lineHeight = deckCaptionSize * 1.3 * min(aspect, 1)
    return lines.enumerated().map { i, line in
        var el = createTextElement(line, id: captionElementId(i))
        el.anchor = .topLeft
        el.x = 0.07
        // A two-line caption grows upward rather than off the bottom edge.
        el.y = 0.93 - lineHeight * Double(lines.count - i)
        el.sizeFrac = deckCaptionSize
        el.color = color
        el.legibility = LegibilityStyle(mode: .shadow, color: "rgba(0,0,0,0.7)", padFrac: 0.35)
        // A caption follows the trip's font and weight but never its glow or
        // its panel: those are the badge's signature.
        el.styleOverrides = ["legibility", "glow"]
        el.glowAmount = 0
        return el
    }
}

/// Move one item of an ordered list to another index, returning a new list.
/// Indices are into the POST's own slide list; out-of-range ones are clamped
/// (a drop past the last slide means "put it last").
public func moveItem<T>(_ items: [T], _ from: Int, _ to: Int) -> [T] {
    var next = items
    if next.count < 2 { return next }
    let src = max(0, min(next.count - 1, from))
    let dst = max(0, min(next.count - 1, to))
    if src == dst { return next }
    let moved = next.remove(at: src)
    next.insert(moved, at: dst)
    return next
}
