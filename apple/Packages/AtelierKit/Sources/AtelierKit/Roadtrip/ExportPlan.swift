// What a piece would deliver, and why — read from the deck, never decided
// here. Port of `src/shared/roadtrip/export-plan.ts`.
//
// Rules kept:
// - The medium of every slide is settled where the piece is composed
//   (`Deck.swift`); this module reads that answer, names each file (in swipe
//   order, the extension following what the slide delivers) and says what
//   would stop it being written. An export that chose a format would be
//   making an editorial decision behind the author's back.
// - The panel shows the run BEFORE it starts, one line per slide: a failure
//   discovered at encode time is the same fault as a format with no reason.
// - A re-timed clip ships SILENT (audio is copied, never re-encoded) and the
//   plan says so; a slide that goes out as an image is never called silent.
// - `imagesOnly` is the one override: it changes the medium, never the
//   reason, which stays the deck's own answer about the slide.
// - Only a CLIP has a container a demuxer can refuse: a photograph is painted
//   frame by frame, and checking one would block every animated hook on a still.

import Foundation

public struct PlanItem: Equatable, Sendable {
    public var position: Int
    public var kind: DeckSlideKind
    /// The deck slide this item delivers, for the exporter to render.
    public var slide: DeckSlide
    public var medium: DeckMedium
    public var reason: SlideReason
    /// Screen time; only meaningful for a video item.
    public var seconds: Double
    /// The clip's speed; 1 for anything that is not a clip.
    public var speed: Double
    /// True when the clip ships without sound: it is re-timed.
    public var silent: Bool
    /// The file this item writes.
    public var name: String
    /// Why it cannot be written, in a sentence, or nil.
    public var blocker: String?

    public init(position: Int, kind: DeckSlideKind, slide: DeckSlide, medium: DeckMedium, reason: SlideReason,
                seconds: Double, speed: Double, silent: Bool, name: String, blocker: String?) {
        self.position = position; self.kind = kind; self.slide = slide; self.medium = medium; self.reason = reason
        self.seconds = seconds; self.speed = speed; self.silent = silent; self.name = name; self.blocker = blocker
    }
}

public struct PieceExportPlan: Equatable, Sendable {
    public var items: [PlanItem]
    /// How many files the run would write, blocked items excluded.
    public var files: Int
    public var images: Int
    public var videos: Int
    /// Every distinct reason something cannot be written, in order met.
    public var blockers: [String]

    public init(items: [PlanItem], files: Int, images: Int, videos: Int, blockers: [String]) {
        self.items = items; self.files = files; self.images = images; self.videos = videos; self.blockers = blockers
    }
}

public struct ExportPlanOptions {
    /// False when this device has no video encoder at all.
    public var canEncode: Bool
    /// True when the Library holds this slide's picture.
    public var hasPicture: (DeckSlide) -> Bool
    /// Deliver every slide as an image, whatever the deck says — the one
    /// override the export keeps.
    public var imagesOnly: Bool

    public init(canEncode: Bool, hasPicture: @escaping (DeckSlide) -> Bool, imagesOnly: Bool = false) {
        self.canEncode = canEncode; self.hasPicture = hasPicture; self.imagesOnly = imagesOnly
    }
}

/// What the piece delivers, item by item.
public func exportPlan(_ trip: TripDoc, _ post: TripPost, _ opts: ExportPlanOptions) -> PieceExportPlan {
    let slides = deckSlides(trip, post)
    let title = post.title.trimmingCharacters(in: .whitespacesAndNewlines)
    let slug = title.isEmpty ? "day-\(post.date)" : title
    var blockers: [String] = []
    func note(_ sentence: String) -> String {
        if !blockers.contains(sentence) { blockers.append(sentence) }
        return sentence
    }

    let items = slides.map { slide -> PlanItem in
        let medium: DeckMedium = opts.imagesOnly ? .image : slide.medium
        var blocker: String? = nil

        if medium == .video {
            if !opts.canEncode {
                blocker = note(
                    "This browser cannot encode video, so nothing here can be delivered as a clip. Everything still exports as images."
                )
            } else if let media = slide.media, !opts.hasPicture(slide) {
                // A still can be drawn over the flat ground; a clip cannot be
                // decoded out of thin air, and a photograph cannot be painted either.
                blocker = note("\(media.name) is not in the Library, so this slide has nothing to paint.")
            } else if let media = slide.media, classifyPart(media.name) == .video,
                      let problem = hookSourceProblem(media.name) {
                blocker = note(problem)
            }
        }

        return PlanItem(
            position: slide.position,
            kind: slide.kind,
            slide: slide,
            medium: medium,
            reason: slide.reason,
            seconds: slide.seconds,
            speed: slide.speed,
            silent: medium == .video && slide.speed != 1,
            name: slideFileName(trip.name, slug, slide, slides.count, medium == .video ? .mp4 : .png),
            blocker: blocker
        )
    }

    let live = items.filter { $0.blocker == nil }
    return PieceExportPlan(
        items: items,
        files: live.count,
        images: live.filter { $0.medium == .image }.count,
        videos: live.filter { $0.medium == .video }.count,
        blockers: blockers
    )
}

/// "3 files · 2 images and 1 clip" — what the button is about to write.
public func describePlan(_ plan: PieceExportPlan) -> String {
    if plan.files == 0 { return "nothing can be written" }
    var parts: [String] = []
    if plan.images > 0 { parts.append("\(plan.images) image\(plan.images == 1 ? "" : "s")") }
    if plan.videos > 0 { parts.append("\(plan.videos) clip\(plan.videos == 1 ? "" : "s")") }
    return "\(plan.files) file\(plan.files == 1 ? "" : "s") · \(parts.joined(separator: " and "))"
}
