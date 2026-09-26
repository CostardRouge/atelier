// What a trip's gallery card shows of itself. Port of
// `src/shared/roadtrip/trip-cover.ts`.
//
// Two questions, both answered here so the card is pure presentation:
//
// 1. **Which pictures.** The pieces pinned to the cover lead; everything short
//    is filled from the trip's BUSIEST DAYS — the days it was told the most,
//    not the ones last touched. Recency churns (opening a piece would change
//    the cover, and a test crop would become the trip); the busiest days are
//    stable, and a real editorial signal. Recency is not lost, it is subsumed:
//    on a trip where every day holds one piece everything ties at one, the date
//    tie-break takes over, and the cover is the latest days again.
// 2. **The rhythm**, for a trip with no picture to show: one bar per day, or
//    per equal bucket of days once the trip is longer than the strip is wide —
//    derived from the coverage, so it is right on a trip made ten seconds ago.
//
// The whole resolution runs on EVERY render, which is what makes a pin a
// preference rather than a dependency: a deleted piece, a re-exported picture
// and a shrunk span need zero repair — the chain pinned → busiest → rhythm →
// none simply lands one rung further down. The thumbnails themselves are the
// caller's business, handed in as `hasThumb`.
//
// Pure.

import Foundation

/// One picture of the cover, in draw order.
public struct CoverTile: Equatable, Sendable {
    public var postId: String
    public var date: IsoDate
    /// 1-based day of the trip, or nil for a piece the span no longer reaches.
    public var dayNumber: Int?
    /// Pinned by the author, rather than ranked.
    public var pinned: Bool

    public init(postId: String, date: IsoDate, dayNumber: Int?, pinned: Bool) {
        self.postId = postId; self.date = date; self.dayNumber = dayNumber; self.pinned = pinned
    }
}

/// How many pictures `layout` asks for (the web's `COVER_TILES`, `coverTiles` here).
public func coverTileCount(_ layout: CoverLayout) -> Int {
    coverTiles[layout] ?? 0
}

/// The trip's days that were told, best first: pieces on the day, then how
/// many of them went out, then the later date. Deterministic to the last key,
/// so two equally busy days never trade places between two renders.
public func rankedCoverDays(_ coverage: TripCoverage) -> [DayCell] {
    coverage.days.filter { !$0.posts.isEmpty }.sorted { a, b in
        if a.posts.count != b.posts.count { return a.posts.count > b.posts.count }
        if a.published != b.published { return a.published > b.published }
        return a.date > b.date
    }
}

/// The one piece a day puts forward: what actually went out if anything did,
/// else the first with a picture. A day whose pieces have no thumbnail puts
/// nothing forward and is passed over — a cover cannot draw an absence.
private func coverPieceOf(_ day: DayCell, _ hasThumb: (String) -> Bool, _ taken: Set<String>) -> TripPost? {
    let drawable = day.posts.filter { hasThumb($0.id) && !taken.contains($0.id) }
    return drawable.first { $0.publishedAt != nil } ?? drawable.first
}

/// The pictures the cover draws, in order — pinned pieces first, then one piece
/// from each of the busiest days, never twice from the same day. Fewer than
/// asked for is normal: a mosaic of one is a cover. A narrower `limit` is
/// always a PREFIX of a wider one, so a panel resolves once at the widest
/// layout and draws every preview from that answer. `limit` nil is the
/// trip's own layout's count.
public func coverTiles(_ trip: TripDoc, _ coverage: TripCoverage, _ hasThumb: (String) -> Bool,
                       limit: Int? = nil) -> [CoverTile] {
    let cap = limit ?? coverTileCount(trip.cover.layout)
    if cap <= 0 { return [] }
    let byId = Dictionary(trip.posts.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
    var tiles: [CoverTile] = []
    var usedDays: Set<IsoDate> = []
    var usedPosts: Set<String> = []

    func take(_ post: TripPost, _ pinned: Bool) {
        tiles.append(CoverTile(postId: post.id, date: post.date, dayNumber: dayNumberOf(trip, post.date), pinned: pinned))
        usedPosts.insert(post.id)
        usedDays.insert(post.date)
    }

    for id in trip.cover.pinned {
        if tiles.count >= cap { break }
        // A pin naming no post, or a post whose picture is not baked here, is
        // skipped in silence: the sheet is where a dropped pin is worth a word.
        guard let post = byId[id], !usedPosts.contains(id), hasThumb(id) else { continue }
        take(post, true)
    }

    for day in rankedCoverDays(coverage) {
        if tiles.count >= cap { break }
        if usedDays.contains(day.date) { continue }
        if let post = coverPieceOf(day, hasThumb, usedPosts) { take(post, false) }
    }

    return tiles
}

/// The pieces whose thumbnails must be in hand before a cover can be
/// resolved: the pins, plus every piece of the busiest days down to `depth` —
/// deeper than the layout asks for, because a day with no picture is passed
/// over and the next one has to be ready. Bounded on purpose: the store reads
/// them one by one.
public func coverCandidateIds(_ trip: TripDoc, _ coverage: TripCoverage, depth: Int = 6) -> [String] {
    var ids: [String] = []
    var seen: Set<String> = []
    func add(_ id: String) {
        if seen.insert(id).inserted { ids.append(id) }
    }
    trip.cover.pinned.forEach(add)
    let ranked = rankedCoverDays(coverage)
    // `slice(0, depth)`: a negative end counts from the end.
    let end = depth >= 0 ? min(depth, ranked.count) : max(ranked.count + depth, 0)
    for day in ranked[0..<end] {
        for post in day.posts { add(post.id) }
    }
    return ids
}

/// The 1-based day of the trip a date falls on, or nil when the span does not
/// reach it — which happens to a pinned piece after the dates are edited,
/// since a post is never touched by that edit and simply stops being drawn.
public func dayNumberOf(_ trip: TripDoc, _ date: IsoDate) -> Int? {
    guard let from = daysBetween(trip.startDate, date), from >= 0,
          let total = daysBetween(trip.startDate, trip.endDate), from <= total else { return nil }
    return from + 1
}

/// Pinned ids that name no piece of this trip any more.
public func droppedPins(_ trip: TripDoc) -> [String] {
    let ids = Set(trip.posts.map(\.id))
    return trip.cover.pinned.filter { !ids.contains($0) }
}

/// `cover` with every pin that names no piece of `trip` removed. Called when an
/// edit is COMMITTED, never while it is being made: the panel says a pin was
/// dropped, and a note that cleared itself the moment you touched anything
/// else would never be read. A cover with nothing to drop comes back as it was.
public func prunePins(_ trip: TripDoc, _ cover: TripCover) -> TripCover {
    let ids = Set(trip.posts.map(\.id))
    let gone = Set(cover.pinned.filter { !ids.contains($0) })
    if gone.isEmpty { return cover }
    var next = cover
    next.pinned = cover.pinned.filter { !gone.contains($0) }
    return next
}

/// `pinned` with `postId` added or removed, the LAST `max` kept (`slice(-max)`).
public func togglePin(_ pinned: [String], _ postId: String, max cap: Int = 3) -> [String] {
    if pinned.contains(postId) { return pinned.filter { $0 != postId } }
    let next = pinned + [postId]
    // `slice(-cap)`: a negative start counts from the end, and −0 is 0.
    let start = cap > 0 ? Swift.max(next.count - cap, 0) : Swift.min(-cap, next.count)
    return Array(next[start...])
}

// MARK: - the rhythm

/// One bar of the rhythm strip: a stretch of days and what came out of it.
public struct RhythmBucket: Equatable, Sendable {
    public var from: IsoDate
    public var to: IsoDate
    /// Days in the bucket — 1 on a trip short enough to draw day by day.
    public var days: Int
    /// How many of them were told at all.
    public var told: Int
    /// Pieces across the bucket, drafts included.
    public var posts: Int

    public init(from: IsoDate, to: IsoDate, days: Int, told: Int, posts: Int) {
        self.from = from; self.to = to; self.days = days; self.told = told; self.posts = posts
    }
}

/// The trip's days folded onto at most `max` bars. Under that many days the
/// strip is the trip itself, one bar per day; over it, EQUAL buckets — never a
/// calendar week, because a bucket that does not divide the span leaves a
/// ragged last bar that reads as a hole rather than as arithmetic.
public func rhythmBuckets(_ coverage: TripCoverage, max cap: Int = 49) -> [RhythmBucket] {
    let days = coverage.days
    if days.isEmpty || cap <= 0 { return [] }
    let size = Swift.max(1, (days.count + cap - 1) / cap)
    var out: [RhythmBucket] = []
    var i = 0
    while i < days.count {
        let slice = days[i..<Swift.min(i + size, days.count)]
        out.append(RhythmBucket(
            from: slice.first!.date,
            to: slice.last!.date,
            days: slice.count,
            told: slice.filter { !$0.posts.isEmpty }.count,
            posts: slice.reduce(0) { $0 + $1.posts.count }
        ))
        i += size
    }
    return out
}

/// The bucket's rung on the heatmap's own five-step ramp, so the card and the
/// overview's grid say the same thing about the same day. Nothing told is
/// rung zero — bare paper, and a bar still drawn, because a day that produced
/// nothing is exactly what the strip exists to show.
public func rhythmLevel(_ bucket: RhythmBucket) -> Int {
    if bucket.told == 0 { return 0 }
    let share = (Double(bucket.told) / Double(bucket.days) * 4).rounded(.down)
    return 1 + Int(Swift.min(3, share))
}
