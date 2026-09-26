// The ONE place a hook's context is built from the document. Port of
// `src/shared/roadtrip/hooks/hook-context.ts`.
//
// Every surface that paints a hook — the stage, the PNG deck, the rail's
// thumbnails, both video exports — and the deck's own "does this slide
// move?" question need the same `HookContext`. Building it in each of them is
// how a thumbnail starts disagreeing with the export, which is the fault
// `slide-render.ts` exists to stop for the rest of a slide.
//
// Pure: the pictures are decoded elsewhere (by the app) and handed in.

import Foundation

/// The context a piece's opener is prepared against.
public func hookContextFor(_ trip: TripDoc, _ post: TripPost, _ aspect: Double, _ content: BadgeContent?,
                           _ pictures: [String: HookPicture]? = nil) -> HookContext {
    HookContext(
        aspect: aspect,
        durationSeconds: post.badge.durationSeconds,
        date: post.date,
        content: content,
        counterMode: post.badge.mode,
        screenSeconds: post.badge.hookSeconds,
        calendar: hookCalendar(trip, post.id),
        stages: hookStages(trip),
        pictures: pictures,
        car: trip.car
    )
}

/// Whether the piece's opener plays anything — what makes an `auto` hook
/// leave as a video even when no badge piece is animated. Measured by
/// preparing it, never guessed from its id: a scrub on the trip's first day
/// has nowhere to sweep from and plays nothing.
public func hookMoves(_ trip: TripDoc, _ post: TripPost) -> Bool {
    resolveHook(post.badge.hook, hookContextFor(trip, post, 1, nil)).seconds > 0
}
