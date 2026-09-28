// Port of `src/shared/develop/run-plan.test.ts`.

import XCTest
@testable import AtelierKit

private let fmt: (Int) -> String = { n in
    n >= 1_000_000 ? "\(Int((Double(n) / 1e6).rounded())) MB" : "\(n) B"
}

private func file(_ name: String, _ bytes: Int = 100) -> SavedMediaRef {
    SavedMediaRef(name: name, size: bytes, lastModified: 0)
}

private func src(_ reach: SensorReach, _ name: String, _ bytes: Int, _ held: Bool) -> SensorSource {
    SensorSource(reach: reach, name: name, bytes: bytes, key: nil, held: held ? file(name, bytes) : nil, fetch: nil)
}

private func roll(_ names: [String]) -> RollDoc {
    var n = 0
    return addPictures(createRollDoc(name: "R4", sourceId: "local", now: 1000, id: "r1"),
                       names.map { SavedMediaRef(name: $0, size: 1, lastModified: 1) }, now: 2000) {
        n += 1
        return "p\(n)"
    }
}

private let onRawDevelop = dev { $0.base = .gain; $0.rawGain = 1 }

final class PlanPictureTests: XCTestCase {
    private func p(_ change: (inout RollPicture) -> Void = { _ in }) -> RollPicture {
        var picture = roll(["DSC08463.JPG"]).pictures[0]
        change(&picture)
        return picture
    }

    func testLeavesFromTheSensorWhenThePictureIsDevelopedOnItAndSaysTheFetch() {
        let onRaw = p { $0.develop = onRawDevelop }
        let plan = planPicture(onRaw, PictureFacts(file: file("DSC08463.webp"), proxy: true,
                                                   sensor: src(.companion, "DSC08463.ARW", 34_600_000, false)), false)
        XCTAssertEqual(plan.kind, .sensor)
        XCTAssertEqual(plan.from, "DSC08463.ARW")
        XCTAssertEqual(plan.fetchBytes, 34_600_000)
        XCTAssertTrue(plan.line.contains("34600000 B to fetch"), plan.line)
    }

    func testLeavesFromTheFileChosenAboveThePhotograph() {
        let chosen = p { $0.rendition = "delivered:dsc08463.jpg" }
        let plan = planPicture(chosen, PictureFacts(file: file("DSC08463.webp"), proxy: true,
                                                    delivered: src(.original, "DSC08463.JPG", 9_000_000, true)), false)
        XCTAssertEqual(plan.kind, .delivered)
        XCTAssertEqual(plan.from, "DSC08463.JPG")
        XCTAssertEqual(plan.fetchBytes, 0)
        XCTAssertTrue(plan.line.contains("in hand"), plan.line)
    }

    func testLeavesFromTheProxyOtherwiseWithAutosArithmeticSaidAsAMaybe() {
        let plan = planPicture(p(), PictureFacts(file: file("DSC08463.webp"), proxy: true,
                                                 original: .init(name: "DSC08463.JPG", bytes: 9_000_000, held: false)), false)
        XCTAssertEqual(plan.kind, .proxy)
        XCTAssertEqual(plan.fetchBytes, 0)
        XCTAssertEqual(plan.maybeBytes, 9_000_000)
        XCTAssertTrue(plan.line.contains("fetched where the frame asks"), plan.line)
    }

    func testProxiesOnlyEverythingLeavesFromWhatIsInHandARAWBaseSetAsideAndSaid() {
        let onRaw = p { $0.develop = onRawDevelop }
        let plan = planPicture(onRaw, PictureFacts(file: file("DSC08463.webp"), proxy: true,
                                                   sensor: src(.companion, "DSC08463.ARW", 34_600_000, false)), true)
        XCTAssertEqual(plan.kind, .proxy)
        XCTAssertEqual(plan.from, "DSC08463.webp")
        XCTAssertEqual(plan.fetchBytes, 0)
        XCTAssertEqual(plan.maybeBytes, 0)
        XCTAssertTrue(plan.line.contains("RAW base set aside"), plan.line)
    }

    func testSaysAPictureThatIsNotInHand() {
        let plan = planPicture(p(), PictureFacts(file: nil), false)
        XCTAssertEqual(plan.kind, .missing)
        XCTAssertNil(plan.from)
    }
}

final class PlanRunTests: XCTestCase {
    func testCountsEachSourceAndTheBytesInOneSentence() {
        let r = roll(["A.JPG", "B.JPG", "C.JPG", "D.JPG"])
        let withRaw = patchPicture(r, "p1") { $0.develop = onRawDevelop }
        let doc = patchPicture(withRaw, "p2") { $0.rendition = "delivered:b.jpg" }
        let facts: [String: PictureFacts] = [
            "p1": PictureFacts(file: file("A.webp"), proxy: true, sensor: src(.companion, "A.DNG", 60_000_000, false)),
            "p2": PictureFacts(file: file("B.webp"), proxy: true, delivered: src(.original, "B.JPG", 9_000_000, false)),
            "p3": PictureFacts(file: file("C.webp"), proxy: true, original: .init(name: "C.JPG", bytes: 8_000_000, held: false)),
            "p4": PictureFacts(file: nil),
        ]
        let plan = planRun(doc.pictures, { facts[$0.id]! }, false, fmt)
        XCTAssertEqual(plan.total, 4)
        XCTAssertEqual(plan.fetchBytes, 69_000_000)
        XCTAssertEqual(plan.maybeBytes, 8_000_000)
        XCTAssertEqual(
            plan.summary,
            "4 pictures · 1 from the sensor · 1 from the file chosen · 1 from the proxy · 1 not in hand · 69 MB to fetch · up to 8 MB more where a frame asks"
        )
        XCTAssertEqual(plan.pictures[0].line, "A.JPG ← A.DNG, the sensor’s data (60 MB to fetch)")
        XCTAssertEqual(plan.pictures[3].line, "D.JPG — not in hand, left out")
    }

    func testProxiesOnlyFetchesNothingAndSaysHowManyBasesItSetsAside() {
        let r = patchPicture(roll(["A.JPG", "B.JPG"]), "p1") { $0.develop = onRawDevelop }
        let plan = planRun(r.pictures, { p in
            PictureFacts(file: file("\(p.ref.name).webp"), proxy: true, sensor: src(.original, "A.DNG", 60_000_000, false))
        }, true, fmt)
        XCTAssertEqual(plan.fetchBytes, 0)
        XCTAssertEqual(plan.summary, "2 pictures · 2 from the proxy · proxies only, 1 RAW base set aside")
    }
}
