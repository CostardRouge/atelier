// Port of `src/shared/roadtrip/post-grade.test.ts` — every case: the chain of
// three rungs, counting departures, sharing a rung, moving a look between
// rungs, writing to one rung, and the looks the bound stack is not editing.

import XCTest
@testable import AtelierKit

private func layer(_ id: String) -> SavedLutLayer {
    SavedLutLayer(id: id, source: "builtin:\(id)", name: id, customText: nil, intensity: 1, enabled: true)
}

private func grade(_ id: String) -> TripGrade {
    SavedGrade(layers: [layer(id)], output: .none)
}

private func trip() -> TripDoc {
    var doc = createTripDoc("Australie", "2025-07-01", "2025-07-31")
    doc.grade = grade("trip")
    return doc
}

private func piece() -> TripPost {
    var post = createTripPost(.carousel, "2025-07-03", "Cliffs")
    post.media = deckRef("hook.jpg")
    post.slides = [createPostSlide(deckRef("a.jpg")), createPostSlide(deckRef("b.jpg"))]
    return post
}

private func keyOf(_ g: TripGrade) -> String { gradeKey(g) }

final class PostGradeChainTests: XCTestCase {
    func testReadsThePicturesOwnElseThePiecesElseTheTrips() {
        let t = trip()
        var p = piece()
        XCTAssertEqual(gradeShownBy(t, p, hookPicture), grade("trip"))
        XCTAssertEqual(gradeScopeOf(p, hookPicture), .trip)

        p.grade = grade("piece")
        XCTAssertEqual(gradeShownBy(t, p, hookPicture), grade("piece"))
        XCTAssertEqual(gradeShownBy(t, p, p.slides[0].id), grade("piece"))
        XCTAssertEqual(gradeScopeOf(p, p.slides[0].id), .post)

        p.slides[0].grade = grade("slide")
        XCTAssertEqual(gradeShownBy(t, p, p.slides[0].id), grade("slide"))
        XCTAssertEqual(gradeScopeOf(p, p.slides[0].id), .slide)
        // The rest of the deck is untouched by one picture departing.
        XCTAssertEqual(gradeShownBy(t, p, p.slides[1].id), grade("piece"))
        XCTAssertEqual(gradeShownBy(t, p, hookPicture), grade("piece"))
    }

    func testAnswersForATripWithNoGradeAtAll() {
        let t = createTripDoc("a", "2025-07-01", "2025-07-31")
        XCTAssertEqual(gradeShownBy(t, piece(), hookPicture), SavedGrade(layers: [], output: .none, film: nil))
    }

    func testNamesTheHookAndEachSlideAndTheClosingCardAsNoPicture() {
        XCTAssertEqual(pictureKeyOf(kind: .hook, slideId: nil), hookPicture)
        XCTAssertEqual(pictureKeyOf(kind: .content, slideId: "s7"), "s7")
        XCTAssertNil(pictureKeyOf(kind: .cta, slideId: nil))
        // The closing card can never depart: there is nothing to own a grade.
        var p = piece()
        p.grade = grade("piece")
        XCTAssertNil(ownGrade(p, nil))
        XCTAssertEqual(gradeScopeOf(p, nil), .post)
    }
}

final class PostGradeCountTests: XCTestCase {
    func testCountsThePicturesThatDepartedNeverThePieceOrTheTrip() {
        var p = piece()
        XCTAssertEqual(countOwnGrades(p), 0)
        p.grade = grade("piece")
        XCTAssertEqual(countOwnGrades(p), 0)
        p.badge.grade = grade("hook")
        p.slides[1].grade = grade("b")
        XCTAssertEqual(countOwnGrades(p), 2)
    }
}

final class PostGradeSameRungTests: XCTestCase {
    func testIsTrueForTwoPicturesThatBothFollowAndForOneWithItself() {
        var p = piece()
        XCTAssertTrue(sameGradeRung(p, hookPicture, p.slides[0].id))
        p.grade = grade("piece")
        XCTAssertTrue(sameGradeRung(p, hookPicture, p.slides[0].id))
        XCTAssertTrue(sameGradeRung(p, hookPicture, hookPicture))
    }

    func testIsFalseForAPictureThatDepartedEvenHoldingAnIdenticalCopy() {
        var p = piece()
        p.grade = grade("piece")
        // Exactly the state `moveGradeScope(.slide)` leaves: an identical copy.
        p.slides[0].grade = grade("piece")
        XCTAssertEqual(gradeKey(p.slides[0].grade), gradeKey(p.grade))
        XCTAssertFalse(sameGradeRung(p, p.slides[0].id, hookPicture))
        XCTAssertTrue(sameGradeRung(p, p.slides[0].id, p.slides[0].id))
        // The picture that departed is not the one being edited, so the others
        // still share their own rung.
        XCTAssertTrue(sameGradeRung(p, hookPicture, p.slides[1].id))
    }
}

final class PostGradeMoveScopeTests: XCTestCase {
    func testSeedsFromWhatThePictureShowsWhenItGoesDownARung() {
        let t = trip()
        let onPiece = moveGradeScope(t, piece(), hookPicture, .post)
        XCTAssertEqual(onPiece.grade, grade("trip"))
        // The web also asserts the seed is not the trip's own object; a value
        // type is a copy by construction.
        XCTAssertEqual(gradeShownBy(t, onPiece, hookPicture), grade("trip"))

        let onPicture = moveGradeScope(t, onPiece, hookPicture, .slide)
        XCTAssertEqual(onPicture.badge.grade, grade("trip"))
        XCTAssertNil(onPicture.slides[0].grade)
        // Departing changes nothing until the author changes something.
        XCTAssertEqual(gradeShownBy(t, onPicture, hookPicture), grade("trip"))
    }

    func testDropsWhatIsBelowItWhenItGoesUp() {
        let t = trip()
        var p = piece()
        p.grade = grade("piece")
        p.badge.grade = grade("hook")

        let toPiece = moveGradeScope(t, p, hookPicture, .post)
        XCTAssertNil(toPiece.badge.grade)
        XCTAssertEqual(toPiece.grade, grade("piece"))

        let toTrip = moveGradeScope(t, p, hookPicture, .trip)
        XCTAssertNil(toTrip.badge.grade)
        XCTAssertNil(toTrip.grade)
        XCTAssertEqual(gradeShownBy(t, toTrip, hookPicture), grade("trip"))
    }

    func testGivesThePieceAGradeWhenItHadNoneSoTheChipDoesSomething() {
        let t = trip()
        var p = piece()
        p.badge.grade = grade("hook")
        let toPiece = moveGradeScope(t, p, hookPicture, .post)
        XCTAssertEqual(gradeScopeOf(toPiece, hookPicture), .post)
        XCTAssertEqual(toPiece.grade, grade("hook"))
    }

    func testTouchesOnePictureOnly() {
        let t = trip()
        let p = piece()
        let moved = moveGradeScope(t, p, p.slides[1].id, .slide)
        XCTAssertEqual(moved.slides[1].grade, grade("trip"))
        XCTAssertNil(moved.slides[0].grade)
        XCTAssertNil(moved.badge.grade)
    }
}

final class PostGradeWriteTests: XCTestCase {
    func testWritesToExactlyOneRungNeverBothInATick() {
        let t = trip()
        let p = piece()
        let next = grade("next")

        let onTrip = writeGrade(t, p, hookPicture, .trip, next)
        XCTAssertNil(onTrip.post)
        XCTAssertEqual(onTrip.trip?.grade, next)

        let onPost = writeGrade(t, p, hookPicture, .post, next)
        XCTAssertNil(onPost.trip)
        XCTAssertEqual(onPost.post?.grade, next)

        let onHook = writeGrade(t, p, hookPicture, .slide, next)
        XCTAssertEqual(onHook.post?.badge.grade, next)
        XCTAssertNil(onHook.post?.grade)

        let onSlide = writeGrade(t, p, p.slides[1].id, .slide, next)
        XCTAssertEqual(onSlide.post?.slides.map(\.grade), [nil, next])
    }
}

final class PostGradeUnboundTests: XCTestCase {
    func testIsEmptyWhileEveryPictureFollowsTheRungBeingEdited() {
        let t = trip()
        var p = piece()
        XCTAssertEqual(unboundGrades(t, p, hookPicture, keyOf), [])
        p.grade = grade("piece")
        XCTAssertEqual(unboundGrades(t, p, p.slides[0].id, keyOf), [])
    }

    func testNamesTheLooksTheDeckWearsThatTheStackIsNotEditing() {
        let t = trip()
        var p = piece()
        p.badge.grade = grade("hook")
        p.slides[0].grade = grade("a")
        // Editing the HOOK's own look leaves everything else unbound — including
        // the slide that merely follows, whose look is the trip's.
        XCTAssertEqual(unboundGrades(t, p, hookPicture, keyOf), [grade("a"), grade("trip")])
        // From a following picture, the two that departed are both unbound.
        XCTAssertEqual(unboundGrades(t, p, p.slides[1].id, keyOf), [grade("hook"), grade("a")])
    }

    func testAsksForOneBakeWhenSeveralPicturesWearTheSameLook() {
        let t = trip()
        var p = piece()
        p.badge.grade = grade("dlog")
        p.slides[0].grade = grade("dlog")
        p.slides[1].grade = grade("dlog")
        XCTAssertEqual(unboundGrades(t, p, nil, keyOf), [grade("dlog")])
    }
}
