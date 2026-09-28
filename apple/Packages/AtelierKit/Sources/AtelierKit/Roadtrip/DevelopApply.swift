// Applying one develop to MANY pictures of a trip — a time-saver of
// `docs/photo-develop.md` §8. Port of `src/shared/roadtrip/develop-apply.ts`.
//
// Rules kept:
// - Every write is a COPY into each target's own field, never a reference: a
//   correction is about a picture and is never inherited, so a preset edited
//   later changes no piece. (Value types make the copy by construction.)
// - As shot is written as nil, never as a record of zeros.
// - The slide the sheet is on (`except`: a slide id, or `hook`) is left to
//   the sheet, which writes it itself on Done; a slide with no picture is
//   left alone — there is nothing to correct.
// - A day is the largest set one light is likely to hold, so the day batch
//   reaches the OTHER pieces of the day and never the whole trip; with none
//   to reach, the same document comes back.

import Foundation

/// A develop as stored: a copy, or nil for as shot.
private func storedDevelop(_ settings: DevelopSettings?) -> DevelopSettings? {
    guard let settings, !isDefaultDevelop(settings) else { return nil }
    return cloneDevelop(settings)
}

/// The post with `settings` written onto every picture it holds — the hook and
/// each content slide that names a picture — except `except`.
public func applyDevelopToPost(_ post: TripPost, _ settings: DevelopSettings?, _ except: String? = nil) -> TripPost {
    let value = storedDevelop(settings)
    var out = post
    if except != hookPicture && post.media != nil { out.badge.develop = value }
    out.slides = post.slides.map { slide in
        guard slide.id != except, slide.media != nil else { return slide }
        var next = slide
        next.develop = value
        return next
    }
    return out
}

/// How many pictures `applyDevelopToPost` would write, with the same `except`.
public func countPostPictures(_ post: TripPost, _ except: String? = nil) -> Int {
    var n = except != hookPicture && post.media != nil ? 1 : 0
    for slide in post.slides where slide.id != except && slide.media != nil { n += 1 }
    return n
}

/// The other pieces telling the same day as `post` — the day's set.
public func otherPostsOfDay(_ trip: TripDoc, _ post: TripPost) -> [TripPost] {
    trip.posts.filter { $0.id != post.id && $0.date == post.date }
}

/// The trip with `settings` written onto every picture of the OTHER pieces of
/// `post`'s day. The post itself is left alone — its pictures are the sheet's.
public func applyDevelopToDay(_ trip: TripDoc, _ post: TripPost, _ settings: DevelopSettings?) -> TripDoc {
    let others = Set(otherPostsOfDay(trip, post).map(\.id))
    if others.isEmpty { return trip }
    var out = trip
    out.posts = trip.posts.map { others.contains($0.id) ? applyDevelopToPost($0, settings) : $0 }
    return out
}

/// How many pictures `applyDevelopToDay` would write.
public func countDayPictures(_ trip: TripDoc, _ post: TripPost) -> Int {
    otherPostsOfDay(trip, post).reduce(0) { $0 + countPostPictures($1) }
}
