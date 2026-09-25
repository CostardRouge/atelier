// Port of `src/shared/sources/source.test.ts`.

import XCTest
@testable import AtelierKit

/// A document-shaped value with the one field `groupBySource` reads.
private struct Doc: Equatable {
    var sourceId: String? = nil
}

private func grouped(_ docs: [Doc]) -> [SourceGroup<Doc>] {
    groupBySource(docs) { $0.sourceId }
}

final class SourceRegistryTests: XCTestCase {
    func testHoldsExactlyTheLocalSourceToday() {
        XCTAssertEqual(SourceRegistry().listSources(), [localSource])
    }

    func testResolvesTheLocalIdAndRefusesAnUnknownOne() {
        let registry = SourceRegistry()
        XCTAssertEqual(registry.sourceById("local"), localSource)
        XCTAssertNil(registry.sourceById("winnow.steeve.website"))
    }

    func testDocumentsWrittenBeforeSourceIdExistedBelongToThisDevice() {
        XCTAssertEqual(defaultSourceId, "local")
        XCTAssertEqual(localSource.id, defaultSourceId)
    }

    func testLocalAnswersHonestlyMediaAndDocumentsYesSchedulingNo() {
        // A browser tab cannot run reminders; false here is what keeps the UI
        // from offering a button that would not work (bridge §3.5).
        XCTAssertEqual(localSource.capabilities, SourceCapabilities(media: true, documents: true, scheduling: false))
    }

    func testARemoteSourceListsAfterLocalAndLocalIsNeverMirroredTwice() {
        let winnow = SourceInfo(id: "winnow.steeve.website", label: "winnow.steeve.website", kind: .winnow,
                                capabilities: SourceCapabilities(media: true, documents: true, scheduling: false))
        var registry = SourceRegistry()
        registry.setRemoteSources([localSource, winnow])
        XCTAssertEqual(registry.listSources(), [localSource, winnow])
        XCTAssertEqual(registry.sourceById(winnow.id), winnow)
        registry.setRemoteSources([])
        XCTAssertEqual(registry.listSources(), [localSource])
    }
}

final class GroupBySourceTests: XCTestCase {
    func testKeepsTheLocalGroupEvenWhenItIsEmptyAndLocalAlwaysLeads() {
        let groups = grouped([Doc(sourceId: "winnow.steeve.website")])
        XCTAssertEqual(groups.map(\.id), ["local", "winnow.steeve.website"])
        XCTAssertEqual(groups[0].items, [])
    }

    func testFilesADocumentWithNoSourceIdUnderThisDevice() {
        let groups = grouped([Doc(), Doc(sourceId: "local")])
        XCTAssertEqual(groups, [SourceGroup(id: "local", items: [Doc(), Doc(sourceId: "local")])])
    }

    func testNeverHidesAnUnknownSourceItsDocumentsGetTheirOwnGroup() {
        let groups = grouped([Doc(sourceId: "local"), Doc(sourceId: "mika.dm-consulting.tech")])
        XCTAssertEqual(groups.map(\.id), ["local", "mika.dm-consulting.tech"])
    }

    func testKeepsFirstSeenOrderAmongRemoteSources() {
        let groups = grouped([Doc(sourceId: "b.example"), Doc(sourceId: "a.example"), Doc(sourceId: "b.example")])
        XCTAssertEqual(groups.map(\.id), ["local", "b.example", "a.example"])
        XCTAssertEqual(groups[1].items.count, 2)
    }
}
