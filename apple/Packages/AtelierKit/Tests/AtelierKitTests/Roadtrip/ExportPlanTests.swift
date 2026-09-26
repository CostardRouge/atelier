// Port of `src/shared/roadtrip/export-plan.test.ts` — every case: what the
// header's one button delivers, in swipe order, and what would stop it.

import XCTest
@testable import AtelierKit

/// The web spec's `post()`: its hook picture is `IMG_HOOK.JPG`.
private func post(_ change: (inout TripPost) -> Void = { _ in }) -> TripPost {
    deckPost {
        $0.media = SavedMediaRef(name: "IMG_HOOK.JPG", size: 10, lastModified: 1)
        change(&$0)
    }
}

/// The web spec's `trip()`: v14, no theme, the default card.
private func trip(_ change: (inout TripDoc) -> Void = { _ in }) -> TripDoc {
    deckTrip {
        $0.version = 14
        change(&$0)
    }
}

private let allThere = ExportPlanOptions(canEncode: true, hasPicture: { _ in true })

final class ExportPlanTests: XCTestCase {
    func testReadsTheDeckRatherThanDecidingAPlainPhotoIsOnePng() {
        let plan = exportPlan(trip(), post(), allThere)
        XCTAssertEqual(plan.items.count, 1)
        XCTAssertEqual(plan.items[0].medium, .image)
        XCTAssertNil(plan.items[0].blocker)
        XCTAssertTrue(plan.items[0].name.hasSuffix(".png"))
        XCTAssertEqual(describePlan(plan), "1 file · 1 image")
    }

    func testGivesAVideoSlideAnMp4NameInTheDecksOwnNumbering() {
        let p = post { $0.slides = [createPostSlide(deckRef("CLIP.MP4"))] }
        let plan = exportPlan(trip(), p, allThere)
        XCTAssertEqual(plan.items.map(\.name), [
            "australia-kalbarri-cliffs-01-hook.png",
            "australia-kalbarri-cliffs-02.mp4",
        ])
        XCTAssertEqual(describePlan(plan), "2 files · 1 image and 1 clip")
    }

    func testCountsAnAnimatedHookAsTheClipItIs() {
        let p = post { $0.badge.pieceStyles = [.headline: enteringStyle(.fade)] }
        let plan = exportPlan(trip(), p, allThere)
        XCTAssertEqual(plan.items[0].medium, .video)
        XCTAssertEqual(plan.items[0].reason, .animated)
        XCTAssertEqual(plan.videos, 1)
    }

    func testBlocksEveryClipWhenTheBrowserCannotEncodeAndSaysSoOnce() {
        let p = post {
            $0.slides = [createPostSlide(deckRef("CLIP.MP4"))]
            $0.badge.medium = .video
        }
        let plan = exportPlan(trip(), p, ExportPlanOptions(canEncode: false, hasPicture: { _ in true }))
        XCTAssertEqual(plan.videos, 0)
        XCTAssertEqual(plan.files, 0)
        XCTAssertEqual(plan.blockers.count, 1)
        XCTAssertNotNil(plan.blockers[0].range(of: "cannot encode video", options: .caseInsensitive))
    }

    func testRefusesAContainerTheDemuxerCannotReadNamingTheFile() {
        let p = post { $0.media = deckRef("CLIP.WEBM") }
        let plan = exportPlan(trip(), p, allThere)
        XCTAssertEqual(plan.items[0].medium, .video)
        XCTAssertTrue(plan.items[0].blocker?.contains("CLIP.WEBM") == true)
        XCTAssertEqual(plan.files, 0)
    }

    func testBlocksAVideoSlideWhosePictureTheLibraryHasLost() {
        let p = post { $0.media = deckRef("CLIP.MP4") }
        let plan = exportPlan(trip(), p, ExportPlanOptions(canEncode: true, hasPicture: { _ in false }))
        XCTAssertTrue(plan.items[0].blocker?.contains("not in the Library") == true)
    }

    func testLeavesAMissingStillAloneItRendersOverTheFlatGround() {
        let plan = exportPlan(trip(), post(), ExportPlanOptions(canEncode: true, hasPicture: { _ in false }))
        XCTAssertNil(plan.items[0].blocker)
    }

    func testTurnsEverythingIntoImagesWhenTheOverrideIsOn() {
        let p = post { $0.media = deckRef("CLIP.MP4") }
        let plan = exportPlan(trip(), p, ExportPlanOptions(canEncode: true, hasPicture: { _ in true }, imagesOnly: true))
        XCTAssertEqual(plan.items[0].medium, .image)
        XCTAssertNil(plan.items[0].blocker)
        XCTAssertTrue(plan.items[0].name.hasSuffix(".png"))
        // The reason still describes the SLIDE, not the override.
        XCTAssertEqual(plan.items[0].reason, .moving)
    }

    func testDeliversTheClosingCardAsAStillWhateverTheRestDoes() {
        let p = post {
            $0.includeCta = true
            $0.badge.medium = .video
        }
        let plan = exportPlan(trip { $0.cta.headline = "Follow" }, p, allThere)
        let last = plan.items[plan.items.count - 1]
        XCTAssertEqual(last.kind, .cta)
        XCTAssertEqual(last.medium, .image)
    }

    func testSaysAReTimedClipShipsSilentAndAnAsShotOneDoesNot() {
        let fast = post {
            $0.media = deckRef("CLIP.MP4")
            $0.badge.videoSpeed = 2
        }
        let item = exportPlan(trip(), fast, allThere).items[0]
        XCTAssertEqual(item.medium, .video)
        XCTAssertEqual(item.speed, 2)
        XCTAssertTrue(item.silent)

        let plain = post { $0.media = deckRef("CLIP.MP4") }
        let asShot = exportPlan(trip(), plain, allThere).items[0]
        XCTAssertEqual(asShot.speed, 1)
        XCTAssertFalse(asShot.silent)
    }

    func testDoesNotCallAReTimedClipSilentOnceItGoesOutAsAnImage() {
        let fast = post {
            $0.media = deckRef("CLIP.MP4")
            $0.badge.videoSpeed = 2
        }
        let plan = exportPlan(trip(), fast, ExportPlanOptions(canEncode: true, hasPicture: { _ in true }, imagesOnly: true))
        XCTAssertFalse(plan.items[0].silent)
    }

    func testSaysPlainlyWhenNothingCanBeWritten() {
        let p = post { $0.media = deckRef("CLIP.WEBM") }
        XCTAssertEqual(describePlan(exportPlan(trip(), p, allThere)), "nothing can be written")
    }
}
