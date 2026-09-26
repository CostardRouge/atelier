// What the trip's calendar looks like once its posts are laid over it — the
// data behind the overview grid. Port of `src/shared/roadtrip/trip-coverage.ts`.
//
// The point of the grid is the HOLES: the maintainer is telling a trip a year
// after it happened, from thousands of photos, and what he cannot hold in his
// head is which days he has never told. So the unit here is the day, every day
// of the trip is present whether or not anything was posted from it, and a
// stretch of silence is a first-class result (`gaps`) rather than something the
// caller has to re-derive by scanning.
//
// Rules kept:
// - A post covering days 27–29 tells all three, CLAMPED to the trip: a post may
//   legitimately be dated outside it (a travel day, an arrival shot).
// - Stages may overlap (a travel day belongs to the place you left and the one
//   you reached) and the LAST match wins: stages are kept in lived order, so the
//   later one is where you ended up that day, which is what a badge names.
// - A day number is never printed for a place the trip was not at.
//
// Pure.

import Foundation

/// One day of the trip, with everything told from it.
public struct DayCell: Equatable, Sendable {
    public var date: IsoDate
    /// 1-based day of the trip — the "27" of "jour 27/310".
    public var dayNumber: Int
    public var posts: [TripPost]
    /// How many of those actually went out (the rest are still drafts).
    public var published: Int

    public init(date: IsoDate, dayNumber: Int, posts: [TripPost], published: Int) {
        self.date = date; self.dayNumber = dayNumber; self.posts = posts; self.published = published
    }
}

/// A run of consecutive days — nothing posted from them, no leg over them, or
/// no position for them, as the caller says.
public struct Gap: Equatable, Sendable {
    public var start: IsoDate
    public var end: IsoDate
    public var length: Int

    public init(start: IsoDate, end: IsoDate, length: Int) {
        self.start = start; self.end = end; self.length = length
    }
}

public struct TripCoverage: Equatable, Sendable {
    public var days: [DayCell]
    public var totalDays: Int
    /// Days with at least one post, draft or published.
    public var toldDays: Int
    /// Days with at least one PUBLISHED post.
    public var publishedDays: Int
    public var posts: Int
    public var publishedPosts: Int
    public var gaps: [Gap]
    /// The longest stretch of silence, or nil when every day is told.
    public var longestGap: Gap?

    public init(days: [DayCell], totalDays: Int, toldDays: Int, publishedDays: Int, posts: Int, publishedPosts: Int,
                gaps: [Gap], longestGap: Gap?) {
        self.days = days; self.totalDays = totalDays; self.toldDays = toldDays; self.publishedDays = publishedDays
        self.posts = posts; self.publishedPosts = publishedPosts; self.gaps = gaps; self.longestGap = longestGap
    }
}

/// A post's last day by its own dates: its end date when it has one past its
/// start (`post.endDate && post.endDate > post.date`), else its start.
private func coverageLastDay(_ post: TripPost) -> IsoDate {
    if let end = post.endDate, !end.isEmpty, end > post.date { return end }
    return post.date
}

/// The days a post occupies, clamped to the trip. A post covering days 27–29
/// marks all three: the question the grid answers is "has this day been told",
/// and a three-day post tells three days. Clamping matters because a post may
/// legitimately be dated outside the trip and an unclamped span would walk off
/// the end of the grid.
public func postDays(_ trip: TripDoc, _ post: TripPost) -> [IsoDate] {
    enumerateDays(post.date, coverageLastDay(post)).filter { isWithin(trip.startDate, trip.endDate, $0) }
}

/// Where a post sits in the trip — everything a "Day 27 / 310" badge needs.
public struct PostDayRange: Equatable, Sendable {
    /// 1-based day numbers.
    public var from: Int
    public var to: Int
    /// The trip's length.
    public var total: Int

    public init(from: Int, to: Int, total: Int) { self.from = from; self.to = to; self.total = total }
}

/// Where a post sits in the trip, with no formatting decided here. Nil when
/// the trip's own span is unusable.
public func postDayRange(_ trip: TripDoc, _ post: TripPost) -> PostDayRange? {
    guard let total = spanLength(trip.startDate, trip.endDate), let from = dayNumber(trip.startDate, post.date) else {
        return nil
    }
    var rawTo: Int? = from
    if let end = post.endDate, !end.isEmpty, end > post.date { rawTo = dayNumber(trip.startDate, end) }
    return PostDayRange(from: from, to: rawTo ?? from, total: total)
}

/// Posts grouped by every day they occupy, trip days only.
public func postsByDay(_ trip: TripDoc) -> [IsoDate: [TripPost]] {
    var map: [IsoDate: [TripPost]] = [:]
    for post in trip.posts {
        for date in postDays(trip, post) { map[date, default: []].append(post) }
    }
    return map
}

/// The whole calendar with its posts, its counts and its silences. Days are in
/// order and every day of the trip is present, so the caller can lay them into
/// a grid without filling anything in.
public func tripCoverage(_ trip: TripDoc) -> TripCoverage {
    let byDay = postsByDay(trip)
    let days = enumerateDays(trip.startDate, trip.endDate).enumerated().map { i, date -> DayCell in
        let posts = byDay[date] ?? []
        return DayCell(date: date, dayNumber: i + 1, posts: posts, published: posts.filter { $0.publishedAt != nil }.count)
    }

    var gaps: [Gap] = []
    var run: [DayCell] = []
    func closeRun() {
        guard let first = run.first, let last = run.last else { return }
        gaps.append(Gap(start: first.date, end: last.date, length: run.count))
        run = []
    }
    for day in days {
        if day.posts.isEmpty { run.append(day) } else { closeRun() }
    }
    closeRun()

    // The FIRST of the longest, as the web's reduce keeps it.
    var longestGap: Gap? = nil
    for gap in gaps where longestGap == nil || gap.length > longestGap!.length { longestGap = gap }

    return TripCoverage(
        days: days,
        totalDays: days.count,
        toldDays: days.filter { !$0.posts.isEmpty }.count,
        publishedDays: days.filter { $0.published > 0 }.count,
        posts: trip.posts.count,
        publishedPosts: trip.posts.filter { $0.publishedAt != nil }.count,
        gaps: gaps,
        longestGap: longestGap
    )
}

/// The index in `trip.stages` of the stage covering a date — the LAST match.
func tripStageIndexAt(_ trip: TripDoc, _ date: IsoDate) -> Int? {
    var found: Int? = nil
    for (i, stage) in trip.stages.enumerated() where isWithin(stage.startDate, stage.endDate, date) { found = i }
    return found
}

/// The stage covering a date. Stages may legitimately overlap (a travel day
/// belongs to the place you left and the one you reached), and the LAST match
/// wins — stages are kept in the order the trip was lived, so the later one is
/// where you ended up that day, which is what a badge should name.
public func stageAt(_ trip: TripDoc, _ date: IsoDate) -> TripStage? {
    tripStageIndexAt(trip, date).map { trip.stages[$0] }
}

/// Where a date sits inside its stage — the "day 2/3" of "Kalbarri · day 2/3".
public struct StageDay: Equatable, Sendable {
    public var day: Int
    public var total: Int

    public init(day: Int, total: Int) { self.day = day; self.total = total }
}

/// Where a date sits inside its stage. Nil when the date is outside the stage,
/// so a caller never prints a day number for a place the trip was not at.
public func stageDayNumber(_ stage: TripStage, _ date: IsoDate) -> StageDay? {
    guard isWithin(stage.startDate, stage.endDate, date),
          let day = dayNumber(stage.startDate, date),
          let total = spanLength(stage.startDate, stage.endDate) else { return nil }
    return StageDay(day: day, total: total)
}
