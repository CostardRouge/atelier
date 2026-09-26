// Port of `src/shared/sources/winnow/finals.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

private let host = "winnow.example"
private let files = [
    FinalCandidate(name: "DJI_0001-9x16-1080p.mp4", size: 40_000_000),
    FinalCandidate(name: "DJI_0001-clean.mp4", size: 90_000_000),
]

final class SplitAssetIdTests: XCTestCase {
    func testSplitsTheHostOffTheIdTheSourceVouchedWith() throws {
        let a = try XCTUnwrap(splitAssetId("winnow.example/42"))
        XCTAssertEqual(a.host, "winnow.example")
        XCTAssertEqual(a.id, 42)
        let b = try XCTUnwrap(splitAssetId("winnow.example:8443/7"))
        XCTAssertEqual(b.host, "winnow.example:8443")
        XCTAssertEqual(b.id, 7)
    }

    func testIsNilForAnythingThatIsNotHostSlashId() {
        for bad: String? in [nil, "", "42", "/42", "host/", "host/abc", "host/0", "host/-1"] {
            XCTAssertNil(splitAssetId(bad), String(describing: bad))
        }
    }
}

final class FinalsPathTests: XCTestCase {
    func testNestsUnderTheChapterWhenOneIsKnownElseAtTheRoot() {
        XCTAssertEqual(finalsPath("12", "a.mp4"), "12/a.mp4")
        XCTAssertEqual(finalsPath(nil, "a.mp4"), "a.mp4")
        XCTAssertEqual(finalsPath("", "a.mp4"), "a.mp4")
    }

    func testNeverLetsAFileNameCarryADirectoryOfItsOwn() {
        XCTAssertEqual(finalsPath("12", "../x/a.mp4"), "12/.._x_a.mp4")
    }
}

final class FinalsPlanTests: XCTestCase {
    func testSendsTheNumericIdWhenTheClipCameFromTheTarget() {
        let plan = finalsPlan(FinalsInput(files: files, assetId: "\(host)/42", targetSourceId: host, maxUploadBytes: nil))
        XCTAssertEqual(plan.problems, [])
        XCTAssertEqual(plan.originalAssetId, 42)
        XCTAssertEqual(plan.items.map(\.path), files.map(\.name))
        XCTAssertEqual(plan.totalBytes, 130_000_000)
        XCTAssertEqual(plan.notes, [])
    }

    func testRefusesToLinkAClipFromAnotherInstance() {
        let plan = finalsPlan(FinalsInput(files: files, assetId: "other.example/42", targetSourceId: host, maxUploadBytes: nil))
        XCTAssertNil(plan.originalAssetId)
        XCTAssertTrue(plan.problems[0].contains("other.example"))
        XCTAssertTrue(plan.problems[0].contains(host))
    }

    func testLetsReconcileMatchByNameWhenThereIsNoIdAndSaysSo() {
        let plan = finalsPlan(FinalsInput(files: files, assetId: nil, targetSourceId: host, maxUploadBytes: nil))
        XCTAssertEqual(plan.problems, [])
        XCTAssertNil(plan.originalAssetId)
        XCTAssertTrue(plan.notes[0].contains("by name and capture time"))
    }

    func testChecksTheUploadLimitBeforeAByteMovesNamingTheFileAndTheLimit() {
        let plan = finalsPlan(FinalsInput(files: files, assetId: "\(host)/42", targetSourceId: host, maxUploadBytes: 50_000_000))
        XCTAssertEqual(plan.problems.count, 1)
        XCTAssertTrue(plan.problems[0].contains("DJI_0001-clean.mp4"))
        XCTAssertTrue(plan.problems[0].contains("at most"))
    }

    func testIgnoresALimitTheInstanceDidNotSet() {
        XCTAssertEqual(finalsPlan(FinalsInput(files: files, assetId: nil, targetSourceId: host, maxUploadBytes: 0)).problems, [])
    }

    func testPutsTheFinalsUnderTheChapterWhenOneIsKnown() {
        let plan = finalsPlan(FinalsInput(files: files, assetId: nil, targetSourceId: host, chapterId: "7", maxUploadBytes: nil))
        XCTAssertEqual(plan.chapterId, "7")
        XCTAssertEqual(plan.items[0].path, "7/DJI_0001-9x16-1080p.mp4")
    }

    func testHasNothingToSendFromAnEmptyRun() {
        let plan = finalsPlan(FinalsInput(files: [], assetId: nil, targetSourceId: host, maxUploadBytes: nil))
        XCTAssertTrue(plan.problems[0].contains("export first"))
    }

    func testLinksEachFileOfAMixedRunToItsOwnCaptureAndNamesTheRunsOneOnlyWhenTheyAgree() {
        let mixed = [
            FinalCandidate(name: "a-developed.jpg", size: 10, assetId: "\(host)/1"),
            FinalCandidate(name: "b-developed.jpg", size: 10, assetId: "\(host)/2"),
            FinalCandidate(name: "c-developed.jpg", size: 10, assetId: .some(nil)),
        ]
        let plan = finalsPlan(FinalsInput(files: mixed, assetId: nil, targetSourceId: host, maxUploadBytes: nil))
        XCTAssertEqual(plan.items.map(\.originalAssetId), [1, 2, nil])
        XCTAssertNil(plan.originalAssetId)
        XCTAssertTrue(plan.notes[0].contains("1 of these carry no Winnow id"))
        XCTAssertEqual(plan.problems, [])
        let same = finalsPlan(FinalsInput(files: Array(mixed.prefix(1)), assetId: nil, targetSourceId: host, maxUploadBytes: nil))
        XCTAssertEqual(same.originalAssetId, 1)
    }

    func testRefusesTheOneFileOfARunThatCameFromAnotherInstanceByName() {
        let plan = finalsPlan(FinalsInput(
            files: [
                FinalCandidate(name: "a.jpg", size: 10, assetId: "\(host)/1"),
                FinalCandidate(name: "b.jpg", size: 10, assetId: "other.example/9"),
            ],
            assetId: nil, targetSourceId: host, maxUploadBytes: nil
        ))
        XCTAssertEqual(plan.problems.count, 1)
        XCTAssertTrue(plan.problems[0].contains("b.jpg"))
        XCTAssertTrue(plan.problems[0].contains("other.example"))
    }
}
