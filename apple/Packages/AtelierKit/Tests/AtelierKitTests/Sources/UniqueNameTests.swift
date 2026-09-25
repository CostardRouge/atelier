// Port of `src/shared/sources/unique-name.test.ts`.

import XCTest
@testable import AtelierKit

final class SplitNameTests: XCTestCase {
    func testSplitsOnTheLastDotAndKeepsALeadingOneInTheBase() {
        XCTAssertEqual(splitName("DJI_0101.jpg"), SplitName(base: "DJI_0101", ext: ".jpg"))
        XCTAssertEqual(splitName("a.b.jpg"), SplitName(base: "a.b", ext: ".jpg"))
        XCTAssertEqual(splitName("README"), SplitName(base: "README", ext: ""))
        XCTAssertEqual(splitName(".gitignore"), SplitName(base: ".gitignore", ext: ""))
    }
}

final class NumberedNameTests: XCTestCase {
    func testNumbersBeforeTheExtension() {
        XCTAssertEqual(numberedName("DJI_0101.jpg", 1), "DJI_0101-1.jpg")
        XCTAssertEqual(numberedName("DJI_0101.jpg", 12), "DJI_0101-12.jpg")
        XCTAssertEqual(numberedName("README", 2), "README-2")
        XCTAssertEqual(numberedName("DJI_0101.jpg", 0), "DJI_0101.jpg")
    }
}

final class UniqueNameTests: XCTestCase {
    func testGivesTheNameBackWhenNothingHasIt() throws {
        XCTAssertEqual(try uniqueName("DJI_0101.jpg") { _ in false }, "DJI_0101.jpg")
    }

    func testWalksUpToTheFirstFreeNumber() throws {
        let held: Set<String> = ["dji_0101.jpg", "dji_0101-1.jpg"]
        XCTAssertEqual(try uniqueName("DJI_0101.jpg") { held.contains($0.lowercased()) }, "DJI_0101-2.jpg")
    }

    func testGivesUpRatherThanLoopingWhenEverythingIsTaken() {
        XCTAssertThrowsError(try uniqueName("x.jpg") { _ in true }) { error in
            XCTAssertTrue("\(error)".contains(String(uniqueNameLimit)), "\(error)")
        }
    }
}

final class UniqueNameAsyncTests: XCTestCase {
    func testAnswersLikeItsSyncTwinWhenTheQuestionHasToBeAskedOfTheDisk() async throws {
        let held: Set<String> = ["dji_0101.jpg", "dji_0101-1.jpg"]
        let taken = { (c: String) async throws -> Bool in held.contains(c.lowercased()) }
        let first = try await uniqueNameAsync("DJI_0101.jpg", taken: taken)
        XCTAssertEqual(first, "DJI_0101-2.jpg")
        let other = try await uniqueNameAsync("other.jpg", taken: taken)
        XCTAssertEqual(other, "other.jpg")
        do {
            _ = try await uniqueNameAsync("x.jpg") { _ in true }
            XCTFail("a folder of a thousand twins is refused")
        } catch {
            XCTAssertTrue("\(error)".contains(String(uniqueNameLimit)), "\(error)")
        }
    }
}

final class DedupeNamesTests: XCTestCase {
    func testNumbersTheRepeatsAndLeavesTheFirstPlain() throws {
        XCTAssertEqual(try dedupeNames(["a.jpg", "b.jpg", "a.jpg", "a.jpg"]), ["a.jpg", "b.jpg", "a-1.jpg", "a-2.jpg"])
    }

    func testReadsTwoSpellingsOfOneNameAsTheSameLikeTheVolumeWill() throws {
        XCTAssertEqual(try dedupeNames(["A.jpg", "a.JPG"]), ["A.jpg", "a-1.JPG"])
    }

    func testDoesNotCollideWithANumberedNameTheCallerAlreadyAskedFor() throws {
        XCTAssertEqual(try dedupeNames(["a.jpg", "a-1.jpg", "a.jpg"]), ["a.jpg", "a-1.jpg", "a-2.jpg"])
    }
}
