// Port of `src/shared/sources/document-gallery.test.ts`, plus a spec of
// `documentSourcesFor`, which the web reads from its stores and this port
// takes as arguments.

import Foundation
import XCTest
@testable import AtelierKit

private struct GalleryDoc: Equatable {
    var id: String
    var sourceId: String
}

private func doc(_ id: String, _ sourceId: String = "local") -> GalleryDoc { GalleryDoc(id: id, sourceId: sourceId) }

private func row(_ id: String, _ sourceId: String) -> RemoteDocRow<GalleryDoc> {
    RemoteDocRow(doc: doc(id, sourceId), etag: "\"\(id)\"", updatedAt: "2026-09-15T10:00:00Z")
}

private func group(_ docs: [GalleryDoc], _ remote: [String],
                   _ lists: [String: RemoteList<RemoteDocRow<GalleryDoc>>]) -> [DocumentGroup<GalleryDoc>] {
    groupDocuments(docs, id: \.id, sourceId: { $0.sourceId }, remoteSourceIds: remote, remoteLists: lists)
}

final class GroupDocumentsTests: XCTestCase {
    func testDrawsThisBrowserFirstEvenEmptyAndEveryInstanceWithABucketEvenWithNothingMirrored() {
        let groups = group([], ["winnow.example"], [:])
        XCTAssertEqual(groups.map(\.id), ["local", "winnow.example"])
        XCTAssertEqual(groups.map(\.items.count), [0, 0])
        XCTAssertTrue(groups.allSatisfy { $0.list == nil && $0.remoteOnly.isEmpty })
    }

    func testShowsADocumentMirroredHereOnceAndOneOnlyThereAsRemoteOnly() throws {
        let lists: [String: RemoteList<RemoteDocRow<GalleryDoc>>] = [
            "winnow.example": .ok(rows: [row("a", "winnow.example"), row("b", "winnow.example")]),
        ]
        let groups = group([doc("l1"), doc("a", "winnow.example")], ["winnow.example"], lists)
        let remote = try XCTUnwrap(groups.first { $0.id == "winnow.example" })
        XCTAssertEqual(remote.items.map(\.id), ["a"])
        XCTAssertEqual(remote.remoteOnly.map(\.doc.id), ["b"])
        XCTAssertEqual(groups.first { $0.id == "local" }?.items.map(\.id), ["l1"])
    }

    func testOffersNothingRemoteOnlyWhileAnInstanceIsLoadingOrHasFailed() {
        let groups = group([doc("a", "x.host")], ["x.host", "y.host"], [
            "x.host": .loading,
            "y.host": .failed(text: "x.host is unreachable", login: nil),
        ])
        XCTAssertEqual(groups.map(\.id), ["local", "x.host", "y.host"])
        XCTAssertEqual(groups.map(\.remoteOnly.count), [0, 0, 0])
        XCTAssertEqual(groups.map { $0.list?.status }, [nil, "loading", "failed"])
    }

    func testNamesThisBrowserInWords() {
        XCTAssertEqual(sourceLabel("local"), "this browser")
        XCTAssertEqual(sourceLabel("unknown.host"), "unknown.host")
    }
}

final class AbsentSourcesTests: XCTestCase {
    private let connections = ["winnow.example", "other.example"]

    func testSaysNothingWhileTheStaleSheetIsStillBeingReAsked() {
        // The group may be about to appear: a sentence here would flash and lie.
        XCTAssertEqual(absentSources(connections, ["winnow.example"], "roll", [:]),
                       [AbsentSource(sourceId: "other.example", text: nil)])
    }

    func testNamesTheInstanceOnceTheSheetHasBeenReReadAndStillLacksTheKind() throws {
        let absent = try XCTUnwrap(absentSources(connections, ["winnow.example"], "roll", ["other.example": .read]).first)
        XCTAssertEqual(absent.sourceId, "other.example")
        XCTAssertTrue(absent.text?.contains("does not keep rolls") == true)
        // The point of the sentence: it rules out this device's own staleness.
        XCTAssertTrue(absent.text?.contains("asked again just now") == true)
    }

    func testSaysItCouldNotBeAskedRatherThanWhatItKeepsWhenTheProbeWasRefused() throws {
        let absent = try XCTUnwrap(absentSources(connections, [], "trip", [
            "winnow.example": .refused(problem: "Not signed in."),
            "other.example": .read,
        ]).first)
        XCTAssertEqual(absent.text, "winnow.example could not be asked what it keeps: Not signed in.")
    }

    func testIsEmptyWhenEveryConnectedInstanceKeepsTheKind() {
        XCTAssertEqual(absentSources(connections, ["winnow.example", "other.example"], "project", [:]), [])
    }
}

final class DocumentSourcesForTests: XCTestCase {
    func testOffersThisDeviceAndEveryInstanceWhoseBucketKeepsTheKind() {
        let trips = readWinnowCapabilities(["documents": ["bucket": true]])
        let all = readWinnowCapabilities(["documents": ["bucket": true, "kinds": ["trip", "project", "roll"]]])
        let sheets = ["old.example": trips, "new.example": all]
        let registry = SourceRegistry(remote: sheets.keys.sorted().map { id in
            toSourceInfo(WinnowConnection(id: id, baseUrl: "https://\(id)", capabilities: sheets[id], connectedAt: 0))
        })
        XCTAssertEqual(documentSourcesFor("roll", registry: registry) { sheets[$0] }.map(\.id), ["local", "new.example"])
        XCTAssertEqual(documentSourcesFor("trip", registry: registry) { sheets[$0] }.map(\.id),
                       ["local", "new.example", "old.example"])
        // The label a sentence uses is the registry's.
        XCTAssertEqual(sourceLabel("new.example", registry: registry), "new.example")
    }
}
