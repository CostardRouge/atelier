// Port of `src/shared/lib/decode-queue.test.ts`. The web's tasks are promises
// settled by a deferred; here a task keeps the `settle` it was handed and the
// spec calls it when the web would have resolved the gate.

import Foundation
import XCTest
@testable import AtelierKit

private struct Undecodable: Error {}

final class DecodeQueueTests: XCTestCase {
    func testRunsAtMostSlotsTasksAtOnceAndStartsTheRestAsSlotsFreeUp() throws {
        let q = try makeDecodeQueue(2)
        var gates: [DecodeQueue.Settle<String>?] = [nil, nil, nil]
        var started: [Int] = []
        var results: [Result<String, Error>?] = [nil, nil, nil]
        for i in 0..<3 {
            q.enqueue({ settle in
                started.append(i)
                gates[i] = settle
            }, completion: { results[i] = $0 })
        }
        XCTAssertEqual(q.running, 2)
        XCTAssertEqual(q.waiting, 1)
        XCTAssertEqual(started, [0, 1])

        gates[0]?(.success("a"))
        XCTAssertEqual(try results[0]?.get(), "a")
        XCTAssertEqual(q.running, 2)
        XCTAssertEqual(q.waiting, 0)
        XCTAssertEqual(started, [0, 1, 2])

        gates[1]?(.success("b"))
        gates[2]?(.success("c"))
        XCTAssertEqual(try results.map { try $0?.get() }, ["a", "b", "c"])
        XCTAssertEqual(q.running, 0)
    }

    func testStartsTheMostRecentlyQueuedTaskFirstWhenASlotFrees() throws {
        let q = try makeDecodeQueue(1)
        var gate: DecodeQueue.Settle<Void>?
        var order: [String] = []
        q.enqueue({ settle in gate = settle }, completion: { _ in })
        var finished = 0
        for name in ["second", "third", "fourth"] {
            q.enqueue({ (settle: @escaping DecodeQueue.Settle<Void>) in
                order.append(name)
                settle(.success(()))
            }, completion: { _ in finished += 1 })
        }
        XCTAssertEqual(q.waiting, 3)
        gate?(.success(()))
        XCTAssertEqual(finished, 3)
        XCTAssertEqual(order, ["fourth", "third", "second"])
        XCTAssertEqual(q.running, 0)
    }

    func testFreesTheSlotWhenATaskRejectsAndPassesTheRejectionOn() throws {
        let q = try makeDecodeQueue(1)
        var failing: DecodeQueue.Settle<String>?
        var failed: Result<String, Error>?
        var after: Result<String, Error>?
        q.enqueue({ settle in failing = settle }, completion: { failed = $0 })
        q.enqueue({ (settle: @escaping DecodeQueue.Settle<String>) in settle(.success("fine")) }, completion: { after = $0 })
        XCTAssertEqual(q.waiting, 1)

        failing?(.failure(Undecodable()))
        guard case .failure(let error)? = failed else { return XCTFail("the rejection was not passed on") }
        XCTAssertTrue(error is Undecodable)
        XCTAssertEqual(try after?.get(), "fine")
        XCTAssertEqual(q.running, 0)
    }

    func testSettlesOnceASecondCallIsIgnored() throws {
        let q = try makeDecodeQueue(1)
        var gate: DecodeQueue.Settle<Int>?
        var completions = 0
        q.enqueue({ settle in gate = settle }, completion: { _ in completions += 1 })
        gate?(.success(1))
        gate?(.success(2))
        XCTAssertEqual(completions, 1)
        XCTAssertEqual(q.running, 0)
    }

    func testRefusesAPoolWithNoSlot() {
        XCTAssertThrowsError(try makeDecodeQueue(0)) { error in
            XCTAssertEqual(error as? DecodeQueueError, .noSlot)
        }
        XCTAssertThrowsError(try DecodeQueue(slots: -1))
    }
}
