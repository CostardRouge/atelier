// The Studio's recovery of a project's instance media, and the capture day it
// publishes — no web twin (see `Projects/StudioRecovery.swift`), so these pin
// the rules it keeps: connected instances only, one capture per id, a save
// keeping what is out of reach, the folder banner leaving it to the
// recovery, and a day that is measured or absent.

import XCTest
@testable import AtelierKit

private func ref(_ name: String, _ size: Int = 100, _ lastModified: Double = 1000,
                 assetId: String? = nil, hash: String? = nil) -> SavedMediaRef {
    SavedMediaRef(name: name, size: size, lastModified: lastModified, assetId: assetId, hash: hash)
}

private let host = "winnow.example.com"

/// A reconciliation where `saved` are all missing but `present`.
private func reconciled(_ saved: [SavedMediaRef], present: [SavedMediaRef] = []) -> Reconciliation {
    reconcileMedia(saved, present)
}

final class StudioRecoveryTests: XCTestCase {
    // MARK: which captures

    func testOneItemPerCaptureNamedByItsClipNotItsLog() {
        let saved = [
            ref("DJI_0101.SRT", assetId: "\(host)/7"),
            ref("DJI_0101.MP4", 900, assetId: "\(host)/7"),
            ref("DJI_0102.JPG", assetId: "\(host)/8"),
        ]
        let items = remoteMissingMedia(reconciled(saved), connected: { _ in true })
        XCTAssertEqual(items.map(\.key), ["\(host)/7", "\(host)/8"])
        XCTAssertEqual(items.map(\.name), ["DJI_0101.MP4", "DJI_0102.JPG"])
        XCTAssertEqual(items.map(\.phase), [.fetching, .fetching])
        XCTAssertEqual(items[0].sourceId, host)
    }

    func testAnInstanceNotConnectedHereIsOutOfReachNeverAsked() {
        let saved = [ref("a.mp4", assetId: "\(host)/1"), ref("b.mp4", assetId: "other.example/2")]
        let items = remoteMissingMedia(reconciled(saved), connected: { $0 == host })
        XCTAssertEqual(items.map(\.phase), [.fetching, .unreachable])
    }

    func testFolderFilesLocalIdsAndFoundMediaAreNotTheRecoverys() {
        let saved = [
            ref("folder.mp4"),
            ref("local.mp4", assetId: "local/3"),
            ref("here.mp4", assetId: "\(host)/4"),
            ref("gone.mp4", assetId: "\(host)/5"),
        ]
        let items = remoteMissingMedia(reconciled(saved, present: [ref("here.mp4", assetId: "\(host)/4")]),
                                       connected: { _ in true })
        XCTAssertEqual(items.map(\.name), ["gone.mp4"])
        XCTAssertTrue(remoteMissingMedia(nil, connected: { _ in true }).isEmpty)
    }

    // MARK: what a save keeps

    func testASaveKeepsWhatIsOutOfReachButNotWhatIsGone() {
        let saved = [
            ref("a.mp4", assetId: "\(host)/1"), ref("a.srt", assetId: "\(host)/1"),
            ref("b.mp4", assetId: "\(host)/2"),
            ref("c.mp4", assetId: "\(host)/3"),
            ref("d.mp4", assetId: "\(host)/4"),
        ]
        let items = [
            StudioRecoveryItem(key: "\(host)/1", sourceId: host, name: "a.mp4", phase: .fetching),
            StudioRecoveryItem(key: "\(host)/2", sourceId: host, name: "b.mp4", phase: .failed, reason: "timed out"),
            StudioRecoveryItem(key: "\(host)/3", sourceId: host, name: "c.mp4", phase: .unreachable),
            StudioRecoveryItem(key: "\(host)/4", sourceId: host, name: "d.mp4", phase: .gone),
        ]
        XCTAssertEqual(refsKeptThroughRecovery(saved, items).map(\.name), ["a.mp4", "a.srt", "b.mp4", "c.mp4"])
        let working = [ref("folder.mp4"), ref("A.MP4", 555, assetId: "\(host)/1")]
        let written = filesKeepingRecovery(working, saved: saved, items)
        // The working set first; a kept ref it already holds by name is not doubled.
        XCTAssertEqual(written.map(\.name), ["folder.mp4", "A.MP4", "a.srt", "b.mp4", "c.mp4"])
    }

    func testAnEmptyWorkingSetStaysEmptySoTheStoredListIsKeptWhole() {
        let saved = [ref("a.mp4", assetId: "\(host)/1")]
        let items = [StudioRecoveryItem(key: "\(host)/1", sourceId: host, name: "a.mp4", phase: .fetching)]
        XCTAssertTrue(filesKeepingRecovery([], saved: saved, items).isEmpty)
    }

    // MARK: the folder banner

    func testTheFolderBannerCountsOnlyWhatTheRecoveryDoesNotSay() {
        let saved = [
            ref("folder.mp4"),
            ref("a.mp4", assetId: "\(host)/1"), ref("a.srt", assetId: "\(host)/1"),
            ref("gone.mp4", assetId: "\(host)/2"),
        ]
        let rec = reconciled(saved)
        let items = [
            StudioRecoveryItem(key: "\(host)/1", sourceId: host, name: "a.mp4", phase: .fetching),
            StudioRecoveryItem(key: "\(host)/2", sourceId: host, name: "gone.mp4", phase: .gone),
        ]
        XCTAssertEqual(rec.missing, 4)
        XCTAssertEqual(missingOutsideRecovery(rec, items), 2)
        XCTAssertEqual(missingOutsideRecovery(rec, []), 4)
        XCTAssertEqual(missingOutsideRecovery(nil, items), 0)
    }

    func testForgettingMissingMediaLeavesWhatIsBeingFetchedBack() {
        let saved = [ref("folder.mp4"), ref("kept.mp4"), ref("a.mp4", assetId: "\(host)/1")]
        let media = ProjectMedia(files: saved)
        let rec = reconciled(saved, present: [ref("kept.mp4")])
        let items = [StudioRecoveryItem(key: "\(host)/1", sourceId: host, name: "a.mp4", phase: .fetching)]
        guard let pruned = forgetMissingMedia(media, rec, keeping: items) else {
            return XCTFail("folder.mp4 is missing and forgettable")
        }
        XCTAssertEqual(pruned.media.files.map(\.name), ["kept.mp4", "a.mp4"])
        XCTAssertEqual(pruned.reconciliation.missing, 1)
        XCTAssertEqual(pruned.reconciliation.found, 1)
        XCTAssertEqual(pruned.reconciliation.items.map(\.ref.name), ["kept.mp4", "a.mp4"])
        // Nothing else missing: nothing to forget.
        XCTAssertNil(forgetMissingMedia(pruned.media, pruned.reconciliation, keeping: items))
    }

    // MARK: the words

    func testTheLinesSayFetchingOutOfReachRefusedAndGoneInThatOrder() {
        let items = [
            StudioRecoveryItem(key: "\(host)/1", sourceId: host, name: "a.mp4", phase: .gone),
            StudioRecoveryItem(key: "\(host)/2", sourceId: host, name: "b.mp4", phase: .fetching),
            StudioRecoveryItem(key: "\(host)/3", sourceId: host, name: "c.mp4", phase: .fetching),
            StudioRecoveryItem(key: "other/4", sourceId: "other", name: "d.mp4", phase: .unreachable),
            StudioRecoveryItem(key: "\(host)/5", sourceId: host, name: "e.mp4", phase: .failed, reason: "Not signed in",
                               signIn: true),
            StudioRecoveryItem(key: "\(host)/6", sourceId: host, name: "f.mp4", phase: .failed, reason: "answered 500"),
        ]
        let lines = studioRecoveryLines(items)
        XCTAssertEqual(lines.map(\.text), [
            "Fetching 2 media files back from \(host)…",
            "1 media file of this project lives on other, which this device is not connected to — connect it in Sources to fetch it back.",
            "Not signed in to \(host) — e.mp4 could not be fetched back.",
            "f.mp4 could not be fetched back from \(host) — answered 500.",
            "\(host) no longer has a.mp4 — it stays missing from this project.",
        ])
        XCTAssertEqual(lines.map(\.alarm), [false, false, true, true, true])
        XCTAssertEqual(lines[1].connect, true)
        XCTAssertEqual(lines[2].signIn, host)
        XCTAssertNil(lines[3].signIn)
        // Asking again cures neither a fetch in flight nor a capture that is gone.
        XCTAssertEqual(lines.map(\.retry), [false, true, true, true, false])
    }

    func testSeveralOutOfReachOnOneInstanceAreOneLine() {
        let items = [
            StudioRecoveryItem(key: "other/1", sourceId: "other", name: "a.mp4", phase: .unreachable),
            StudioRecoveryItem(key: "other/2", sourceId: "other", name: "b.mp4", phase: .unreachable),
            StudioRecoveryItem(key: "other/3", sourceId: "other", name: "c.mp4", phase: .failed, signIn: true),
            StudioRecoveryItem(key: "other/4", sourceId: "other", name: "d.mp4", phase: .failed, signIn: true),
        ]
        XCTAssertEqual(studioRecoveryLines(items).map(\.text), [
            "2 media files of this project live on other, which this device is not connected to — connect it in Sources to fetch them back.",
            "Not signed in to other — 2 media files could not be fetched back.",
        ])
        XCTAssertTrue(studioRecoveryLines([]).isEmpty)
    }

    // MARK: the capture day

    func testTheDayIsTheLogsThenTheExifsThenTheSourcesInstant() {
        let utc = TimeZone(identifier: "UTC")!
        XCTAssertEqual(studioCaptureDay(logTimestamp: "2025-03-14 18:02:11,120", exifDateTime: "2024:01:01 10:00:00",
                                        vouchedStamp: 0, timeZone: utc), "2025-03-14")
        XCTAssertEqual(studioCaptureDay(logTimestamp: nil, exifDateTime: "2024:01:01 23:59:59",
                                        vouchedStamp: 1_700_000_000_000, timeZone: utc), "2024-01-01")
        XCTAssertEqual(studioCaptureDay(logTimestamp: "no clock here", exifDateTime: "0000:00:00 00:00:00",
                                        vouchedStamp: 1_700_000_000_000, timeZone: utc), "2023-11-14")
    }

    func testALocalFilesModifiedTimeIsNoCaptureDay() {
        XCTAssertNil(studioCaptureDay(logTimestamp: nil, exifDateTime: nil, vouchedStamp: nil))
        XCTAssertNil(studioMediaScope(nil))
    }

    func testTheScopeIsOneDaySaidAsTheStudiosAndWaitsOnNothing() {
        let scope = studioMediaScope("2025-03-14")
        XCTAssertEqual(scope?.from, "2025-03-14")
        XCTAssertEqual(scope?.to, "2025-03-14")
        XCTAssertEqual(scope?.label, "14 Mar 2025")
        XCTAssertEqual(scope?.publisher, "Studio")
        XCTAssertNil(scope?.intent)
        XCTAssertNil(studioMediaScope("2025-02-30"))
    }
}
