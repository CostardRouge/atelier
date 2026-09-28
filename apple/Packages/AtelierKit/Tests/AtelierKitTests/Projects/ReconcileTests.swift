// Port of `src/shared/projects/reconcile.test.ts`, case for case.

import XCTest
@testable import AtelierKit

private func ref(_ name: String, _ size: Int = 100, _ lastModified: Double = 1000,
                 assetId: String? = nil, hash: String? = nil) -> SavedMediaRef {
    SavedMediaRef(name: name, size: size, lastModified: lastModified, assetId: assetId, hash: hash)
}

final class ReconcileMediaTests: XCTestCase {
    func testClassifiesUntouchedMediaAsFound() {
        let saved = [ref("DJI_0001.MP4"), ref("DJI_0001.SRT", 5)]
        let r = reconcileMedia(saved, [ref("DJI_0001.MP4"), ref("DJI_0001.SRT", 5)])
        XCTAssertEqual(r.found, 2)
        XCTAssertEqual(r.changed, 0)
        XCTAssertEqual(r.missing, 0)
    }

    func testMatchesNamesCaseInsensitivelyDJICardsMixCasing() {
        let r = reconcileMedia([ref("DJI_0001.MP4")], [ref("dji_0001.mp4")])
        XCTAssertEqual(r.items[0].status, .found)
    }

    func testFlagsASizeOrMtimeDifferenceAsChanged() {
        let r = reconcileMedia([ref("a.mp4", 100, 1000), ref("b.mp4", 100, 1000)],
                               [ref("a.mp4", 999, 1000), ref("b.mp4", 100, 2000)])
        XCTAssertEqual(r.items.map(\.status), [.changed, .changed])
    }

    func testFlagsAbsentFilesAsMissingWithoutDroppingTheRest() {
        let r = reconcileMedia([ref("kept.mp4"), ref("gone.mp4")], [ref("kept.mp4")])
        XCTAssertEqual(r.found, 1)
        XCTAssertEqual(r.missing, 1)
        XCTAssertEqual(r.items[1].ref.name, "gone.mp4")
    }

    func testIgnoresExtraFilesInTheFolderNewSourcesAreWelcomeNotErrors() {
        let r = reconcileMedia([ref("a.mp4")], [ref("a.mp4"), ref("new.mp4")])
        XCTAssertEqual(r.items.count, 1)
        XCTAssertEqual(r.found, 1)
    }

    func testHandlesAnEmptyFolderListingNoPermissionOrHandleGone() {
        XCTAssertEqual(reconcileMedia([ref("a.mp4")], []).missing, 1)
    }

    func testKeepsTheFirstClaimWhenTheFolderHoldsDuplicateNames() {
        let r = reconcileMedia([ref("a.mp4", 100, 1000)], [ref("A.MP4", 100, 1000), ref("a.mp4", 5, 5)])
        XCTAssertEqual(r.items[0].status, .found)
    }
}

final class ReconcileMediaIdentityTests: XCTestCase {
    func testMatchesByAssetIdBeforeAnythingElse() {
        let r = reconcileMedia([ref("old.mp4", assetId: "1234")], [ref("renamed.mp4", 999, 42, assetId: "1234")])
        XCTAssertEqual(r.items[0].matchedBy, .id)
        XCTAssertEqual(r.items[0].status, .found)
        XCTAssertEqual(r.items[0].actual?.name, "renamed.mp4")
    }

    func testMatchesByHashAcrossARenameAndCallsItFoundRatherThanChanged() {
        // The mtime differs because it is a copy; the content is provably the same.
        let r = reconcileMedia([ref("DJI_0001.MP4", hash: "abc")], [ref("sunset-graded.mp4", 100, 9999, hash: "abc")])
        XCTAssertEqual(r.items[0].matchedBy, .hash)
        XCTAssertEqual(r.items[0].status, .found)
        XCTAssertEqual(r.renamed, 1)
    }

    func testFallsBackToTheNameWhenTheHashFindsNothing() {
        let r = reconcileMedia([ref("a.mp4", hash: "gone")], [ref("a.mp4", hash: "other")])
        XCTAssertEqual(r.items[0].matchedBy, .name)
        XCTAssertEqual(r.items[0].status, .found)
    }

    func testKeepsTheOldNameOnlyBehaviourForDocumentsWrittenBeforeHashes() {
        let r = reconcileMedia([ref("a.mp4", 100, 1000)], [ref("a.mp4", 999, 1000)])
        XCTAssertEqual(r.items[0].matchedBy, .name)
        XCTAssertEqual(r.items[0].status, .changed)
        XCTAssertEqual(r.renamed, 0)
    }

    func testDoesNotCountACaseOnlyDifferenceAsARename() {
        let r = reconcileMedia([ref("DJI_0001.MP4", hash: "abc")], [ref("dji_0001.mp4", hash: "abc")])
        XCTAssertEqual(r.renamed, 0)
    }
}

private func media(_ change: (inout ProjectMedia) -> Void = { _ in }) -> ProjectMedia {
    var m = ProjectMedia()
    change(&m)
    return m
}

final class AdoptRenamesTests: XCTestCase {
    func testReturnsNilWhenNothingWasRenamedSoTheCallerSkipsTheWrite() {
        let r = reconcileMedia([ref("a.mp4")], [ref("a.mp4")])
        XCTAssertNil(adoptRenames(media { $0.files = [ref("a.mp4")] }, r))
    }

    func testRewritesTheFileListTheActiveClipAndTheTrimKeysTogether() {
        let saved = ref("DJI_0001.MP4", hash: "abc")
        let now = ref("sunset.mp4", 100, 5000, hash: "abc")
        let r = reconcileMedia([saved], [now])

        let adopted = adoptRenames(media {
            $0.files = [saved]
            $0.activeId = "DJI_0001"
            $0.trims = ["DJI_0001": SavedTrim(start: 1, end: 2, duration: 10)]
            $0.develops = ["DJI_0001": SavedDevelop(settings: dev { $0.exposure = 0.5 }, hash: "abc")]
        }, r)

        XCTAssertEqual(adopted?.files[0].name, "sunset.mp4")
        XCTAssertEqual(adopted?.files[0].lastModified, 5000)
        // The hash that found it survives.
        XCTAssertEqual(adopted?.files[0].hash, "abc")
        XCTAssertEqual(adopted?.activeId, "sunset")
        XCTAssertEqual(adopted.map { Array($0.trims.keys) }, ["sunset"])
        // The third base-name key travels with the other two.
        XCTAssertEqual(adopted.map { Array($0.develops.keys) }, ["sunset"])
        XCTAssertEqual(adopted?.develops["sunset"]?.settings.exposure, 0.5)
    }

    func testLeavesAnUntouchedClipAloneWhileRenamingItsNeighbour() {
        let kept = ref("keep.mp4")
        let moved = ref("old.mp4", hash: "h")
        let r = reconcileMedia([kept, moved], [kept, ref("new.mp4", hash: "h")])
        let adopted = adoptRenames(media { $0.files = [kept, moved]; $0.activeId = "keep" }, r)
        XCTAssertEqual(adopted?.files.map(\.name), ["keep.mp4", "new.mp4"])
        XCTAssertEqual(adopted?.activeId, "keep")
    }

    func testRenamesTheSRTWithItsClipSoThePairStaysOneAsset() {
        let video = ref("DJI_0001.MP4", hash: "v")
        let srt = ref("DJI_0001.SRT", 5, hash: "s")
        let r = reconcileMedia([video, srt], [ref("flight.MP4", hash: "v"), ref("flight.SRT", 5, hash: "s")])
        let adopted = adoptRenames(media { $0.files = [video, srt]; $0.activeId = "DJI_0001" }, r)
        XCTAssertEqual(adopted?.files.map(\.name), ["flight.MP4", "flight.SRT"])
        XCTAssertEqual(adopted?.activeId, "flight")
    }
}
