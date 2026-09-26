// Port of `src/shared/roadtrip/deck.test.ts` — every case: the deck a post
// delivers, its file names, a content slide's caption, reordering, and what
// each slide is delivered as.

import XCTest
@testable import AtelierKit

/// The web spec's `trip()`: a v5 trip with no theme and the default card.
func deckTrip(_ change: (inout TripDoc) -> Void = { _ in }) -> TripDoc {
    var trip = TripDoc(version: 5, id: "t1", name: "Australia", startDate: "2025-03-01", endDate: "2026-01-04",
                       theme: nil, cta: defaultCta, grade: emptyGrade(), sourceId: "local", createdAt: 0, updatedAt: 0)
    change(&trip)
    return trip
}

/// The web spec's `post()`: a carousel on 2025-03-27 over one photograph.
func deckPost(_ kind: PostKind = .carousel, _ change: (inout TripPost) -> Void = { _ in }) -> TripPost {
    var post = TripPost(id: "p1", kind: kind, date: "2025-03-27", title: "Kalbarri cliffs",
                        media: SavedMediaRef(name: "DJI_0001.JPG", size: 10, lastModified: 1),
                        badge: defaultPostBadge(kind), createdAt: 0)
    change(&post)
    return post
}

func deckRef(_ name: String) -> SavedMediaRef {
    SavedMediaRef(name: name, size: 1, lastModified: 1)
}

/// A piece style whose only departure is an entrance.
func enteringStyle(_ preset: AnimPreset) -> BadgePieceStyle {
    BadgePieceStyle(animation: .some(ElementAnimation(in: .some(AnimStep(preset: preset, duration: 0.5, easing: .out)))))
}

private func ctaSaying(_ headline: String) -> CtaSlide {
    var cta = defaultCta
    cta.headline = headline
    return cta
}

final class DeckSlidesTests: XCTestCase {
    func testIsTheHookAloneForAPlainPost() {
        let slides = deckSlides(deckTrip(), deckPost())
        XCTAssertEqual(slides.count, 1)
        XCTAssertEqual(slides[0].kind, .hook)
        XCTAssertEqual(slides[0].position, 1)
    }

    func testCarriesTheHooksOwnPictureAndFrame() {
        let p = deckPost { $0.badge.videoTimeSeconds = 2.5 }
        let hook = deckSlides(deckTrip(), p)[0]
        XCTAssertEqual(hook.media?.name, "DJI_0001.JPG")
        XCTAssertEqual(hook.videoTimeSeconds, 2.5)
    }

    func testNumbersTheDeckInSwipeOrder() {
        let slides = deckSlides(deckTrip(), deckPost {
            $0.slides = [createPostSlide(), createPostSlide()]
            $0.includeCta = true
        })
        XCTAssertEqual(slides.map(\.position), [1, 2, 3, 4])
        XCTAssertEqual(slides.map(\.kind), [.hook, .content, .content, .cta])
    }

    func testAppendsTheCallToActionOnlyWhenThePostAsksForIt() {
        XCTAssertEqual(deckSlides(deckTrip(), deckPost { $0.includeCta = false }).map(\.kind), [.hook])
        XCTAssertEqual(deckSlides(deckTrip(), deckPost { $0.includeCta = true }).map(\.kind), [.hook, .cta])
    }

    func testLeavesOutAnEmptyCallToActionEvenWhenAsked() {
        // A blank last slide is worse than none — the template says nothing.
        let blank = deckTrip {
            $0.cta.headline = ""
            $0.cta.body = ""
            $0.cta.url = ""
        }
        XCTAssertEqual(deckSlides(blank, deckPost { $0.includeCta = true }).map(\.kind), [.hook])
    }

    func testGivesContentSlidesAnIdAndTheHookNone() {
        let slide = createPostSlide()
        let slides = deckSlides(deckTrip(), deckPost { $0.slides = [slide] })
        XCTAssertNil(slides[0].slideId)
        XCTAssertEqual(slides[1].slideId, slide.id)
    }

    func testCarriesEachContentSlidesOwnCaptionAndFrame() {
        var slide = createPostSlide()
        slide.caption = "The gorge at dawn"
        slide.videoTimeSeconds = 4
        let content = deckSlides(deckTrip(), deckPost { $0.slides = [slide] })[1]
        XCTAssertEqual(content.caption, "The gorge at dawn")
        XCTAssertEqual(content.videoTimeSeconds, 4)
    }
}

final class DeckSlideFileNameTests: XCTestCase {
    private let slides = deckSlides(deckTrip(), deckPost {
        $0.slides = [createPostSlide(), createPostSlide()]
        $0.includeCta = true
    })

    func testSortsInSwipeOrderInAFileListing() {
        let names = slides.map { slideFileName("Australia", "day-27", $0, slides.count) }
        XCTAssertEqual(names, [
            "australia-day-27-01-hook.png",
            "australia-day-27-02.png",
            "australia-day-27-03.png",
            "australia-day-27-04-cta.png",
        ])
        XCTAssertEqual(names.sorted(), names)
    }

    func testPadsToAtLeastTwoDigitsSoTenNeverSortsBeforeTwo() {
        let many = deckSlides(deckTrip(), deckPost { $0.slides = (0..<11).map { _ in createPostSlide() } })
        let names = many.map { slideFileName("T", "p", $0, many.count) }
        XCTAssertEqual(names.sorted(), names)
    }

    func testSlugifiesWhateverTheAuthorTyped() {
        let name = slideFileName("Australie / 2025!", "Jour 27 — Kalbarri", slides[0], 4)
        XCTAssertNotNil(name.range(of: #"^[a-z0-9-]+\.png$"#, options: .regularExpression))
        XCTAssertTrue(name.contains("australie-2025"))
    }

    func testCopesWithANamelessTripAndAnUntitledPost() {
        XCTAssertEqual(slideFileName("", "", slides[0], 4), "01-hook.png")
    }
}

final class DeckContentSlideElementsTests: XCTestCase {
    func testDrawsNothingWithoutACaption() {
        XCTAssertEqual(contentSlideElements(""), [])
        XCTAssertEqual(contentSlideElements("   "), [])
    }

    func testIsOnePlainLineSoAContentPictureStaysTheSubject() {
        let els = contentSlideElements("The gorge at dawn")
        XCTAssertEqual(els.count, 1)
        XCTAssertEqual(els[0].kind, .text)
        XCTAssertEqual(els[0].text, "The gorge at dawn")
    }

    func testNeverInheritsTheBadgesGlowThatSignatureBelongsToTheHook() {
        let els = contentSlideElements("The gorge at dawn")
        XCTAssertEqual(els[0].glowAmount, 0)
        XCTAssertTrue(els[0].styleOverrides?.contains("glow") == true)
        XCTAssertTrue(els[0].styleOverrides?.contains("legibility") == true)
    }

    func testKeepsAShadowSinceItLandsOnAnUnvettedPhotograph() {
        XCTAssertEqual(contentSlideElements("x")[0].legibility.mode, .shadow)
    }

    func testGivesEachLineAStableIdThatNamesItsLine() {
        let long = "A sentence long enough to be wrapped onto more than one line of the frame"
        let a = contentSlideElements(long, 9.0 / 16)
        let b = contentSlideElements(long, 9.0 / 16)
        XCTAssertGreaterThan(a.count, 1)
        XCTAssertEqual(a.map(\.id), b.map(\.id))
        XCTAssertEqual(Set(a.map(\.id)).count, a.count)
        for (i, el) in a.enumerated() {
            XCTAssertEqual(el.id, captionElementId(i))
            XCTAssertEqual(captionLineFromElementId(el.id), i)
        }
    }

    func testRefusesAnIdThatIsNotACaptionLines() {
        XCTAssertNil(captionLineFromElementId("piece:kicker"))
        XCTAssertNil(captionLineFromElementId("caption:x"))
        XCTAssertNil(captionLineFromElementId("caption:-1"))
    }
}

final class DeckMoveItemTests: XCTestCase {
    private let abc = ["a", "b", "c", "d"]

    func testMovesAnItemLaterClosingTheHoleBehindIt() {
        XCTAssertEqual(moveItem(abc, 0, 2), ["b", "c", "a", "d"])
    }

    func testMovesAnItemEarlier() {
        XCTAssertEqual(moveItem(abc, 3, 1), ["a", "d", "b", "c"])
    }

    func testLeavesTheListAloneWhenNothingMoves() {
        XCTAssertEqual(moveItem(abc, 2, 2), abc)
    }

    func testNeverMutatesTheListItWasGiven() {
        let source = abc
        _ = moveItem(source, 0, 3)
        XCTAssertEqual(source, abc)
    }

    func testClampsADropPastEitherEndInsteadOfDroppingTheItem() {
        XCTAssertEqual(moveItem(abc, 0, 99), ["b", "c", "d", "a"])
        XCTAssertEqual(moveItem(abc, 3, -5), ["d", "a", "b", "c"])
    }

    func testKeepsEveryItemWhateverTheIndices() {
        for from in [-1, 0, 1, 2, 3, 9] {
            for to in [-1, 0, 1, 2, 3, 9] {
                XCTAssertEqual(moveItem(abc, from, to).sorted(), abc.sorted())
            }
        }
    }

    func testIsANoOpOnAListTooShortToReorder() {
        XCTAssertEqual(moveItem(["only"], 0, 1), ["only"])
        XCTAssertEqual(moveItem([String](), 0, 0), [])
    }
}

final class DeckResolveSlideMediumTests: XCTestCase {
    func testLeavesAPlainPhotographAnImage() {
        XCTAssertEqual(resolveSlideMedium(.auto, false, "IMG_1.JPG"), SlideMediumResolution(medium: .image, reason: .plain))
    }

    func testMakesAnAnimatedSlideAVideo() {
        XCTAssertEqual(resolveSlideMedium(.auto, true, "IMG_1.JPG"), SlideMediumResolution(medium: .video, reason: .animated))
    }

    func testMakesAClipAVideoAnimatedOrNot() {
        XCTAssertEqual(resolveSlideMedium(.auto, false, "DJI_0001.MP4"), SlideMediumResolution(medium: .video, reason: .moving))
    }

    func testHoldsAStillAsVideoWhenTheAuthorAsks() {
        XCTAssertEqual(resolveSlideMedium(.video, false, "IMG_1.JPG"), SlideMediumResolution(medium: .video, reason: .forcedVideo))
    }

    func testNamesWhatReallyMovesRatherThanTheClickWhenBothAgree() {
        XCTAssertEqual(resolveSlideMedium(.video, true, "IMG_1.JPG").reason, .animated)
        XCTAssertEqual(resolveSlideMedium(.video, false, "a.mov").reason, .moving)
    }

    func testObeysAForcedImageAndSaysWhatItCosts() {
        XCTAssertEqual(resolveSlideMedium(.image, true, "IMG_1.JPG"), SlideMediumResolution(medium: .image, reason: .settled))
        XCTAssertEqual(resolveSlideMedium(.image, false, "DJI_0001.MP4"), SlideMediumResolution(medium: .image, reason: .frozen))
    }

    func testTreatsASlideWithNoPictureAsAStill() {
        XCTAssertEqual(resolveSlideMedium(.auto, false, nil).medium, .image)
    }
}

final class DeckHookAnimatesTests: XCTestCase {
    func testIsFalseForAnUnstyledBadge() {
        XCTAssertFalse(hookAnimates([:]))
        XCTAssertFalse(hookAnimates([.headline: BadgePieceStyle(textCase: .upper)]))
    }

    func testIsTrueAsSoonAsOnePieceAnimates() {
        XCTAssertTrue(hookAnimates([.headline: enteringStyle(.fade)]))
    }
}

final class DeckMediumAndScreenTimeTests: XCTestCase {
    private let still = FramingMotion(keys: [FramingKey(at: 0, scale: 1.5, x: 0, y: 0)], easing: .linear, start: .slide)

    func testResolvesTheHookFromItsBadgeAndItsPicture() {
        let p = deckPost { $0.media = deckRef("DJI_0001.MP4") }
        let hook = deckSlides(deckTrip(), p)[0]
        XCTAssertEqual(hook.medium, .video)
        XCTAssertEqual(hook.reason, .moving)
        XCTAssertEqual(hook.chosen, .auto)
        XCTAssertEqual(hook.seconds, p.badge.hookSeconds)
    }

    func testFollowsAnAnimatedBadgeOverAPhotographTheCaseThatStartedThis() {
        let p = deckPost { $0.badge.pieceStyles = [.headline: enteringStyle(.slide)] }
        let hook = deckSlides(deckTrip(), p)[0]
        XCTAssertEqual(hook.medium, .video)
        XCTAssertEqual(hook.reason, .animated)
    }

    func testCarriesEachContentSlidesOwnChoiceAndLength() {
        var slide = createPostSlide(deckRef("IMG_2.JPG"))
        slide.medium = .video
        slide.seconds = 4.5
        let deck = deckSlides(deckTrip(), deckPost { $0.slides = [slide] })
        XCTAssertEqual(deck[1].medium, .video)
        XCTAssertEqual(deck[1].chosen, .video)
        XCTAssertEqual(deck[1].seconds, 4.5)
    }

    func testKeepsTheClosingCardAStillWhateverElseTheDeckDoes() {
        let p = deckPost {
            $0.includeCta = true
            $0.badge.medium = .video
        }
        let deck = deckSlides(deckTrip { $0.cta = ctaSaying("Follow") }, p)
        let last = deck[deck.count - 1]
        XCTAssertEqual(last.kind, .cta)
        XCTAssertEqual(last.medium, .image)
        XCTAssertEqual(last.reason, .plain)
    }

    func testCarriesAClipsSpeedAndOneForAnythingThatIsNotAClip() {
        var slide = createPostSlide(deckRef("IMG_2.JPG"))
        slide.videoSpeed = 0.5 // a photograph has no speed, whatever is stored
        var clip = createPostSlide(deckRef("DJI_0002.MOV"))
        clip.videoSpeed = 0.5
        let p = deckPost {
            $0.media = deckRef("DJI_0001.MP4")
            $0.badge.videoSpeed = 2
            $0.slides = [slide, clip]
            $0.includeCta = true
        }
        let deck = deckSlides(deckTrip { $0.cta = ctaSaying("Follow") }, p)
        XCTAssertEqual(deck.map(\.speed), [2, 1, 0.5, 1])
    }

    func testDeliversAPhotographThatMovesInItsFrameAsAVideoUnderAuto() {
        let hookMotion = FramingMotion(keys: [FramingKey(at: 0, scale: 1.2, x: 0, y: 0)], easing: .linear, start: .slide)
        var slide = createPostSlide(deckRef("IMG_2.JPG"))
        slide.motion = still
        let plain = createPostSlide(deckRef("IMG_3.JPG"))
        let p = deckPost {
            $0.badge.motion = hookMotion
            $0.slides = [slide, plain]
        }
        let deck = deckSlides(deckTrip(), p)
        XCTAssertEqual(deck[0].medium, .video)
        XCTAssertEqual(deck[0].reason, .animated)
        XCTAssertEqual(deck[0].motion, hookMotion)
        XCTAssertEqual(deck[1].medium, .video)
        XCTAssertEqual(deck[1].reason, .animated)
        XCTAssertEqual(deck[2].medium, .image)
        XCTAssertNil(deck[2].motion)
    }

    func testKeepsAMovingPictureAStillWhenTheAuthorAsksForOneDrawnAtRest() {
        var slide = createPostSlide(deckRef("IMG_2.JPG"))
        slide.motion = still
        slide.medium = .image
        let content = deckSlides(deckTrip(), deckPost { $0.slides = [slide] })[1]
        XCTAssertEqual(content.medium, .image)
        XCTAssertEqual(content.reason, .settled)
    }

    func testReadsAnOddStoredSpeedAsAsShot() {
        let p = deckPost {
            $0.media = deckRef("DJI_0001.MP4")
            $0.badge.videoSpeed = .nan
        }
        XCTAssertEqual(deckSlides(deckTrip(), p)[0].speed, 1)
    }
}

final class DeckPictureDevelopTests: XCTestCase {
    func testCarriesTheHooksAndEachSlidesDevelopAndNoneForTheClosingCard() {
        var slide = createPostSlide(deckRef("IMG_2.JPG"))
        slide.develop = dev { $0.highlights = -40 }
        let p = deckPost {
            $0.includeCta = true
            $0.badge.develop = dev { $0.exposure = 0.7 }
            $0.slides = [slide, createPostSlide()]
        }
        let slides = deckSlides(deckTrip { $0.cta = ctaSaying("Follow the trip") }, p)
        XCTAssertEqual(slides[0].develop, dev { $0.exposure = 0.7 })
        XCTAssertEqual(slides[1].develop, dev { $0.highlights = -40 })
        XCTAssertNil(slides[2].develop)
        XCTAssertEqual(slides[3].kind, .cta)
        XCTAssertNil(slides[3].develop)
    }

    func testCarriesThePicturesOwnGradeTheSameWayTheDeckResolvesTheChain() {
        let own = SavedGrade(layers: [], output: .rec709ToSrgb)
        let p = deckPost {
            $0.includeCta = true
            $0.badge.grade = own
            $0.slides = [createPostSlide(deckRef("IMG_2.JPG"))]
        }
        let slides = deckSlides(deckTrip { $0.cta = ctaSaying("Follow the trip") }, p)
        XCTAssertEqual(slides[0].grade, own)
        // A slide that never departed says so with a nil, never with a copy of
        // the piece's — the chain is resolved on read (`PostGrade.swift`).
        XCTAssertNil(slides[1].grade)
        XCTAssertNil(slides[2].grade)
    }
}
