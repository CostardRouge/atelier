// Which look a picture of a piece actually wears — the chain, and the moves
// between its rungs. Port of `src/shared/roadtrip/post-grade.ts`.
//
// Rules kept:
// - THREE rungs: the trip (one grade so the feed reads as one journey), a
//   piece, and ONE PICTURE — because a deck mixing a D-Log clip with a phone
//   photograph cannot wear one conversion LUT. Resolved on every read:
//   **empty means computed, never blank** — a picture that never departed is
//   a nil, never a copy of the trip's grade.
// - A picture is named by its KEY: `hook` for the opener, a slide id for a
//   content picture, nil for the closing card (which can never depart).
// - Going DOWN a rung seeds the new one from what the picture shows, so
//   departing changes nothing until the author changes something; going UP
//   drops what was below. Picking "this piece's" gives the PIECE a grade when
//   it had none, or the control would do nothing.
// - A write lands on exactly ONE rung — two in one tick is how two edits
//   clobber each other.
// - Two pictures share a rung by WHERE their look is written, never by
//   comparing values: a picture that has just departed holds a byte-identical
//   copy, and must be deaf to the next slider step on the rung it left.

import Foundation

/// Which picture of a piece a grade is read for. Nil is the closing card.
public typealias PictureKey = String?

/// The key that names a piece's opener. The web's `HOOK_PICTURE`.
public let hookPicture = "hook"

/// Where a look is written: the trip, one piece, or one picture of it.
public enum GradeScope: String, CaseIterable, Sendable {
    case trip, post, slide
}

/// What grading one picture of a deck needs to know about it. `DeckSlide`
/// is one; the web's interface of the same name.
public protocol GradedPicture {
    var kind: DeckSlideKind { get }
    var slideId: String? { get }
    var grade: TripGrade? { get }
    var develop: DevelopSettings? { get }
}

extension DeckSlide: GradedPicture {}

/// The key of the picture a deck slide draws.
public func pictureKeyOf(kind: DeckSlideKind, slideId: String?) -> PictureKey {
    kind == .hook ? hookPicture : slideId
}

public func pictureKeyOf<P: GradedPicture>(_ picture: P) -> PictureKey {
    pictureKeyOf(kind: picture.kind, slideId: picture.slideId)
}

/// The grade this one picture carries of its own, or nil when it follows.
public func ownGrade(_ post: TripPost, _ picture: PictureKey) -> TripGrade? {
    guard let picture else { return nil }
    if picture == hookPicture { return post.badge.grade }
    return post.slides.first { $0.id == picture }?.grade
}

/// Which rung the look shown on a picture is written on.
public func gradeScopeOf(_ post: TripPost, _ picture: PictureKey) -> GradeScope {
    if ownGrade(post, picture) != nil { return .slide }
    return post.grade != nil ? .post : .trip
}

/// The grade a picture actually wears: its own, else the piece's, else the trip's.
public func gradeShownBy(_ trip: TripDoc, _ post: TripPost, _ picture: PictureKey) -> TripGrade {
    ownGrade(post, picture) ?? post.grade ?? trip.grade
}

/// Whether two pictures of a piece read their look from the SAME rung — so a
/// stack bound to one of them is the live answer for the other too.
public func sameGradeRung(_ post: TripPost, _ a: PictureKey, _ b: PictureKey) -> Bool {
    if a == b { return true }
    return ownGrade(post, a) == nil && ownGrade(post, b) == nil
}

/// How many pictures of a piece carry a look of their own.
public func countOwnGrades(_ post: TripPost) -> Int {
    var n = post.badge.grade != nil ? 1 : 0
    for slide in post.slides where slide.grade != nil { n += 1 }
    return n
}

/// The post with one picture's own grade set or cleared.
private func setOwnGrade(_ post: TripPost, _ picture: PictureKey, _ grade: TripGrade?) -> TripPost {
    guard let picture else { return post }
    var out = post
    if picture == hookPicture {
        out.badge.grade = grade
        return out
    }
    out.slides = post.slides.map { slide in
        guard slide.id == picture else { return slide }
        var next = slide
        next.grade = grade
        return next
    }
    return out
}

/// Move a picture's look onto another rung, and say what the piece becomes.
/// Down a rung seeds from what is shown; up drops what is below.
public func moveGradeScope(_ trip: TripDoc, _ post: TripPost, _ picture: PictureKey, _ scope: GradeScope) -> TripPost {
    let shown = gradeShownBy(trip, post, picture)
    if scope == .slide { return setOwnGrade(post, picture, shown) }
    var dropped = setOwnGrade(post, picture, nil)
    if scope == .post {
        dropped.grade = dropped.grade ?? shown
        return dropped
    }
    dropped.grade = nil
    return dropped
}

/// The documents to write when the bound stack has changed. Exactly one of
/// the two is non-nil: a grade lives on one rung.
public struct GradeWrite: Equatable, Sendable {
    public var trip: TripDoc?
    public var post: TripPost?

    public init(trip: TripDoc?, post: TripPost?) { self.trip = trip; self.post = post }
}

public func writeGrade(_ trip: TripDoc, _ post: TripPost, _ picture: PictureKey, _ scope: GradeScope,
                       _ grade: TripGrade) -> GradeWrite {
    switch scope {
    case .slide:
        return GradeWrite(trip: nil, post: setOwnGrade(post, picture, grade))
    case .post:
        var next = post
        next.grade = grade
        return GradeWrite(trip: nil, post: next)
    case .trip:
        var next = trip
        next.grade = grade
        return GradeWrite(trip: next, post: nil)
    }
}

/// Every grade a piece's pictures wear that the bound stack is NOT editing —
/// what has to be resolved and baked so a picture that departed is drawn
/// through its own look. Deduplicated by `keyOf`, first seen first.
public func unboundGrades(_ trip: TripDoc, _ post: TripPost, _ bound: PictureKey,
                          _ keyOf: (TripGrade) -> String) -> [TripGrade] {
    var seen: Set<String> = []
    var out: [TripGrade] = []
    func add(_ picture: PictureKey) {
        if sameGradeRung(post, picture, bound) { return }
        let grade = gradeShownBy(trip, post, picture)
        let key = keyOf(grade)
        if seen.insert(key).inserted { out.append(grade) }
    }
    add(hookPicture)
    for slide in post.slides { add(slide.id) }
    return out
}
