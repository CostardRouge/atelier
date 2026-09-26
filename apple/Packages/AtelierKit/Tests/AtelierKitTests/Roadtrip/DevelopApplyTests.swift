// Port of `src/shared/roadtrip/develop-apply.test.ts` — every case: one light
// written onto every picture of a piece, and onto the other pieces of its day.

import XCTest
@testable import AtelierKit

private let lifted = dev { $0.exposure = 0.7 }

private func piece(_ date: String = "2025-07-03", _ withHook: Bool = true) -> TripPost {
    var p = createTripPost(.carousel, date, "Cliffs")
    if withHook { p.media = deckRef("hook.jpg") }
    p.slides = [createPostSlide(deckRef("a.jpg")), createPostSlide(nil), createPostSlide(deckRef("c.jpg"))]
    return p
}

final class DevelopApplyToPostTests: XCTestCase {
    func testWritesACopyOntoTheHookAndEverySlideThatHasAPicture() {
        let p = applyDevelopToPost(piece(), lifted)
        XCTAssertEqual(p.badge.develop, lifted)
        // The web also asserts the copy is not the same object; a value type is
        // a copy by construction.
        XCTAssertEqual(p.slides.map(\.develop), [lifted, nil, lifted])
        XCTAssertEqual(countPostPictures(piece()), 3)
    }

    func testSkipsTheSlideTheSheetIsOnAndAHookWithNoPicture() {
        let src = piece()
        let skipSlide = applyDevelopToPost(src, lifted, src.slides[0].id)
        XCTAssertNil(skipSlide.slides[0].develop)
        XCTAssertEqual(skipSlide.badge.develop, lifted)
        XCTAssertEqual(countPostPictures(src, src.slides[0].id), 2)
        let skipHook = applyDevelopToPost(src, lifted, "hook")
        XCTAssertNil(skipHook.badge.develop)
        XCTAssertEqual(countPostPictures(src, "hook"), 2)
        XCTAssertNil(applyDevelopToPost(piece("2025-07-03", false), lifted).badge.develop)
    }

    func testWritesAsShotAsNil() {
        let p = applyDevelopToPost(applyDevelopToPost(piece(), lifted), DevelopSettings.default)
        XCTAssertNil(p.badge.develop)
        XCTAssertNil(p.slides[0].develop)
    }
}

final class DevelopApplyToDayTests: XCTestCase {
    func testReachesTheOtherPiecesOfTheSameDayAndNothingElse() {
        var trip = createTripDoc("T", "2025-07-01", "2025-07-10")
        let me = piece()
        let sameDay = piece()
        let otherDay = piece("2025-07-04")
        trip.posts = [me, sameDay, otherDay]
        XCTAssertEqual(otherPostsOfDay(trip, me).map(\.id), [sameDay.id])
        XCTAssertEqual(countDayPictures(trip, me), 3)
        let next = applyDevelopToDay(trip, me, lifted)
        XCTAssertNil(next.posts[0].badge.develop)
        XCTAssertEqual(next.posts[1].badge.develop, lifted)
        XCTAssertEqual(next.posts[1].slides[0].develop, lifted)
        XCTAssertNil(next.posts[2].badge.develop)
        // Nothing to write: the same document comes back.
        XCTAssertEqual(applyDevelopToDay(trip, otherDay, lifted), trip)
    }
}
