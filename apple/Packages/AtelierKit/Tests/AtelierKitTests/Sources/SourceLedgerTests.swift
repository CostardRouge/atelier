// Port of `src/shared/sources/source-ledger.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

/// Something thrown that is not the client's — the web's `throw 'boom'`.
private struct Boom: Error {}

final class HealthFromErrorTests: XCTestCase {
    func testReadsA401AsSignInThereNotAsAFailure() {
        let h = healthFromError(WinnowError(.unauthenticated, "nope", status: 401), "w.example", now: 5)
        XCTAssertEqual(h.state, .signin)
        XCTAssertTrue(h.reason?.contains("Sign in there") == true)
        XCTAssertEqual(h.checkedAt, 5)
    }

    func testSaysA403IsTheAccountNotTheBrowser() {
        let h = healthFromError(WinnowError(.forbidden, "nope", status: 403), "w.example", now: 0)
        XCTAssertEqual(h.state, .signin)
        XCTAssertTrue(h.reason?.contains("this account") == true)
    }

    func testNamesTheTwoPlausibleCausesWhenNothingAnswered() {
        let h = healthFromError(WinnowError(.unreachable, "offline"), "w.example", now: 0)
        XCTAssertEqual(h.state, .unreachable)
        XCTAssertTrue(h.reason?.contains("offline") == true)
        XCTAssertTrue(h.reason?.contains("allowed list") == true)
    }

    func testCarriesTheMessageThroughForAnythingElse() {
        let h = healthFromError(WinnowError(.protocol, "bad json", status: 500), "w.example", now: 0)
        XCTAssertEqual(h.state, .unreachable)
        XCTAssertTrue(h.reason?.contains("bad json") == true)
    }

    func testHandlesAThrownNonError() {
        let h = healthFromError(Boom(), "w.example", now: 0)
        XCTAssertEqual(h.state, .unreachable)
        XCTAssertTrue(h.reason?.contains("w.example") == true)
    }
}

final class HealthFromAnswerTests: XCTestCase {
    func testKeepsTheRoundTripSoTheRowCanShowIt() {
        XCTAssertEqual(healthFromAnswer(240, now: 9),
                       SourceHealth(state: .reachable, reason: nil, latencyMs: 240, checkedAt: 9))
    }
}

final class CountBySourceTests: XCTestCase {
    func testCountsProjectsTripsAndRollsPerSource() {
        let counts = countBySource(projects: ["local", "w.example", "w.example"], trips: ["w.example"],
                                   rolls: ["w.example", nil])
        XCTAssertEqual(counts["local"], DocCount(projects: 1, trips: 0, rolls: 1))
        XCTAssertEqual(counts["w.example"], DocCount(projects: 2, trips: 1, rolls: 1))
    }

    func testFilesADocumentWrittenBeforeTheFieldExistedUnderThisBrowser() {
        XCTAssertEqual(countBySource(projects: [nil], trips: [nil])["local"], DocCount(projects: 1, trips: 1, rolls: 0))
    }

    func testLeavesASourceNobodyUsesOutOfTheMap() {
        XCTAssertEqual(countBySource().count, 0)
    }
}

final class DescribeDocsTests: XCTestCase {
    func testNeverSaysZero() {
        XCTAssertEqual(describeDocs(DocCount(projects: 0, trips: 0, rolls: 0)), "nothing yet")
        XCTAssertEqual(describeDocs(DocCount(projects: 2, trips: 0, rolls: 0)), "2 projects")
        XCTAssertEqual(describeDocs(DocCount(projects: 0, trips: 1, rolls: 0)), "one trip")
        XCTAssertEqual(describeDocs(DocCount(projects: 8, trips: 3, rolls: 0)), "8 projects and 3 trips")
        XCTAssertEqual(describeDocs(DocCount(projects: 8, trips: 3, rolls: 1)), "8 projects, 3 trips and one roll")
    }
}

final class ForgetWarningTests: XCTestCase {
    func testSaysWhatStaysWhere() {
        let w = forgetWarning("w.example", DocCount(projects: 8, trips: 3, rolls: 0))
        XCTAssertTrue(w.contains("8 projects and 3 trips"))
        XCTAssertTrue(w.contains("stay on the instance"))
    }

    func testStaysShortWhenTheInstanceHoldsNothingOfOurs() {
        XCTAssertTrue(forgetWarning("w.example", DocCount()).contains("Nothing is deleted"))
    }
}

final class ShortHostTests: XCTestCase {
    func testTakesTheFirstLabel() {
        XCTAssertEqual(shortHost("winnow.steeve.website"), "winnow")
        XCTAssertEqual(shortHost("mika.dm-consulting.tech"), "mika")
        XCTAssertEqual(shortHost("winnow.example"), "winnow")
    }

    func testKeepsAPortWhichIsWhatTellsTwoLocalInstancesApart() {
        XCTAssertEqual(shortHost("localhost:5174"), "localhost:5174")
        XCTAssertEqual(shortHost("winnow.localhost:3000"), "winnow:3000")
    }

    func testLeavesAnIPAddressWhole() {
        XCTAssertEqual(shortHost("192.168.1.4"), "192.168.1.4")
        XCTAssertEqual(shortHost("192.168.1.4:3000"), "192.168.1.4:3000")
    }

    func testSkipsAWww() {
        XCTAssertEqual(shortHost("www.winnow.example"), "winnow")
    }
}

final class ShortHostsTests: XCTestCase {
    func testShortensWhatStaysUnambiguous() {
        let names = shortHosts(["winnow.steeve.website", "mika.dm-consulting.tech"])
        XCTAssertEqual(names["winnow.steeve.website"], "winnow")
        XCTAssertEqual(names["mika.dm-consulting.tech"], "mika")
    }

    func testKeepsBothHostsLongWhenTheirFirstLabelsCollide() {
        let names = shortHosts(["winnow.a.tech", "winnow.b.tech", "mika.c.tech"])
        XCTAssertEqual(names["winnow.a.tech"], "winnow.a.tech")
        XCTAssertEqual(names["winnow.b.tech"], "winnow.b.tech")
        XCTAssertEqual(names["mika.c.tech"], "mika")
    }
}
