// How a Winnow thumbnail asks again instead of staying black — the schedule
// inside `src/shared/sources/winnow/WinnowThumb.tsx`, lifted out so it is
// pinned by a spec (`architecture.md`, «A thumbnail retries»).
//
// A grid of a busy day fires a hundred-odd requests at once down a tunnel to a
// home server, and some lose. So a tile retries, and the FIRST retry is not a
// second helping of the same question: attempt 0 is the plain URL (cacheable —
// Winnow serves these immutable for a year); on its failure the entry is
// HEALED (asked once past the cache, which replaces it), then the plain URL is
// asked again (attempt 1) — or, when the heal says the instance is simply not
// answering, a discriminated `?retry=N` URL at once (attempt 2). Past that
// every failure waits a little longer (`attempt × 400 ms`), since hammering a
// shedding server makes it worse, and past `thumbRetries` the tile gives up
// and says what it would have shown. The URLs are `WinnowClient.thumbRetryUrl`.

import Foundation

/// How many times a thumbnail is asked for again before the tile gives up.
public let thumbRetries = 3

/// What a tile does after attempt `attempt` failed.
public enum ThumbStep: Equatable, Sendable {
    /// Replace the cache entry, then go on at `thumbAfterHeal(healed)`.
    case heal
    /// Ask again as attempt `attempt`, after `afterMs` milliseconds.
    case retry(attempt: Int, afterMs: Double)
}

public func thumbAfterFailure(_ attempt: Int) -> ThumbStep {
    if attempt <= 0 { return .heal }
    let next = attempt + 1
    return .retry(attempt: next, afterMs: Double(next) * 400)
}

/// The attempt that follows a heal: the plain URL again when the entry now
/// holds something worth asking for, a discriminated one when not.
public func thumbAfterHeal(_ healed: Bool) -> Int {
    healed ? 1 : 2
}

/// True once the tile has given up and draws its label instead.
public func thumbGaveUp(_ attempt: Int) -> Bool {
    attempt > thumbRetries
}
