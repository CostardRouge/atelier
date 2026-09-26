// Port of `src/shared/roadtrip/hooks/hook-context.test.ts` — the calendar a
// hook reads, whether a piece's opener moves, and the scrub read through the
// shared context. Two cases lean on modules not in the kernel yet: `deckSlides`
// (`deck.ts`, ported in parallel) is skipped with its reason, and the web's
// `badgeElements` + `DEFAULT_BADGE_LAYOUT` are stood in for by a builder that
// makes one text element per piece under the same deterministic ids
// (`piece:<key>`), which is all that case reads.

import XCTest
@testable import AtelierKit

/// A ten-day trip with pieces on days 2, 5 (twice, one published) and 8.
private func fixture() -> (trip: TripDoc, hero: TripPost) {
    var trip = createTripDoc("Australia", "2025-03-01", "2025-03-10")
    func on(_ date: String, _ published: Bool = false) -> TripPost {
        var post = createTripPost(.reel, date, "")
        post.publishedAt = published ? 1 : nil
        return post
    }
    let hero = on("2025-03-08")
    let draft5 = on("2025-03-05")
    let published5 = on("2025-03-05", true)
    trip.posts = [on("2025-03-02"), draft5, published5, hero]
    trip.stages = [
        TripStage(id: "s1", name: "", region: "", startDate: "2025-03-01", endDate: "2025-03-04"),
        TripStage(id: "s2", name: "", region: "", startDate: "2025-03-05", endDate: "2025-03-10"),
    ]
    return (trip, hero)
}

private func scrubbing(_ post: TripPost) -> TripPost {
    var out = post
    out.badge.hook = [HookLayer(id: "scrub", options: [:])]
    return out
}

final class HookCalendarTests: XCTestCase {
    func testListsEveryDayAndNeverCountsThePieceBeingComposedAsTellingItsOwnDay() {
        let (trip, hero) = fixture()
        let cal = hookCalendar(trip, hero.id)
        XCTAssertEqual(cal.count, 10)
        XCTAssertEqual(cal.filter(\.told).map(\.dayNumber), [2, 5])
    }

    func testMarksTheDayEachLegStartsOn() {
        let (trip, hero) = fixture()
        XCTAssertEqual(hookCalendar(trip, hero.id).filter(\.legStart).map(\.dayNumber), [1, 5])
    }

    func testLetsAPublishedPieceStandForItsDayOverADraftAndAPicturedOneOverABareOne() {
        let (start, hero) = fixture()
        var trip = start
        let publishedIndex = trip.posts.firstIndex { $0.publishedAt != nil }!
        let draftIndex = trip.posts.firstIndex { $0.date == "2025-03-05" && $0.publishedAt == nil }!
        let published = trip.posts[publishedIndex]
        let draft = trip.posts[draftIndex]
        // Neither has a picture: the published one still stands.
        XCTAssertEqual(standingPiece(hookCalendar(trip, hero.id)[4])?.id, published.id)
        // Only the draft has a picture: a flash with nothing to show helps nobody.
        trip.posts[draftIndex].media = SavedMediaRef(name: "draft.jpg", size: 1, lastModified: 0)
        XCTAssertEqual(standingPiece(hookCalendar(trip, hero.id)[4])?.id, draft.id)
        // Both do: the published one's picture wins again.
        trip.posts[publishedIndex].media = SavedMediaRef(name: "published.jpg", size: 1, lastModified: 0)
        XCTAssertEqual(standingPiece(hookCalendar(trip, hero.id)[4])?.media?.name, "published.jpg")
        // The hero's own day has no OTHER piece, so nothing stands for it.
        XCTAssertNil(standingPiece(hookCalendar(trip, hero.id)[7]))
    }

    func testListsEachDaysOtherPiecesSoAPanelCanOfferAChoice() {
        let (trip, hero) = fixture()
        let cal = hookCalendar(trip, hero.id)
        XCTAssertEqual(cal[4].pieces.map(\.published), [false, true])
        XCTAssertEqual(cal[1].pieces.count, 1)
        XCTAssertEqual(cal[7].pieces, [])
    }
}

final class HookMovesTests: XCTestCase {
    func testIsFalseForThePlainBadge() {
        let (trip, hero) = fixture()
        XCTAssertFalse(hookMoves(trip, hero))
    }

    func testIsTrueForAScrubWithSomewhereToSweepFrom() {
        let (trip, hero) = fixture()
        XCTAssertTrue(hookMoves(trip, scrubbing(hero)))
    }

    func testIsFalseForAScrubOnTheTripsFirstDayItPlaysNothing() {
        var trip = fixture().trip
        var first = scrubbing(createTripPost(.reel, "2025-03-01", ""))
        first.id = "first"
        trip.posts.append(first)
        XCTAssertFalse(hookMoves(trip, first))
    }

    func testMakesAnAutoHookLeaveAsAVideoAsAnAnimatedBadgeWould() throws {
        throw XCTSkip("`deckSlides` is `deck.ts`, ported by a parallel task; `hookMoves` itself is pinned above")
    }
}

final class HookScrubThroughContextTests: XCTestCase {
    private let content = BadgeContent(
        kicker: "Australia",
        label: "Day",
        headline: "8",
        counter: "of 10",
        caption: nil,
        timing: nil,
        exif: nil
    )

    /// Stands in for `badgeElements(content, DEFAULT_BADGE_LAYOUT, …)`: one text
    /// element per present piece, under the web's deterministic ids.
    private func elements(_ c: BadgeContent) -> [OverlayElement] {
        BadgePiece.allCases.compactMap { piece -> OverlayElement? in
            guard let text = c[piece] else { return nil }
            var el = OverlayElement(id: "piece:\(piece.rawValue)", kind: .text, anchor: .bottomLeft, x: 0.07, y: 0.9)
            el.text = text
            return el
        }
    }

    func testStepsTheNumeralWhileItSweepsAndGivesTheBadgeItsOwnValueBackAtRest() {
        let (trip, hero) = fixture()
        let post = scrubbing(hero)
        let hook = resolveHook(post.badge.hook, hookContextFor(trip, post, 9.0 / 16, content))
        XCTAssertTrue(hook.rewrites)
        XCTAssertEqual(hook.contentAt(content, 0)?.headline, "1")
        XCTAssertEqual(hook.contentAt(content, hook.seconds + 1)?.headline, "8")
    }

    func testLeavesTheNumeralAloneUnderAnyCounterButTheDayOfTheTrip() {
        let (trip, hero) = fixture()
        var post = scrubbing(hero)
        post.badge.mode = .stageDay
        let hook = resolveHook(post.badge.hook, hookContextFor(trip, post, 9.0 / 16, content))
        XCTAssertFalse(hook.rewrites)
        XCTAssertGreaterThan(hook.seconds, 0)
    }

    func testBuildsElementsPerFrameOnlyForAHookThatRewrites() {
        let (trip, hero) = fixture()
        let ctx = hookContextFor(trip, hero, 9.0 / 16, content)
        XCTAssertEqual(ctx.car, trip.car)
        let plain = resolveHook(hero.badge.hook, ctx)
        XCTAssertNil(hookElementsAt(plain, content, elements: elements))

        let post = scrubbing(hero)
        let scrub = resolveHook(post.badge.hook, hookContextFor(trip, post, 9.0 / 16, content))
        let at = hookElementsAt(scrub, content, elements: elements)
        func headline(_ t: Double) -> String? {
            at?(t).first { $0.id == "piece:headline" }?.text
        }
        XCTAssertEqual(headline(0), "1")
        XCTAssertEqual(headline(scrub.seconds + 1), "8")
    }
}
