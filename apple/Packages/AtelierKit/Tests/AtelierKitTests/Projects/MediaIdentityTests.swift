// Port of `src/shared/projects/media-identity.test.ts`, case for case. The
// web's `File` with deterministic bytes is a `SavedMediaRef` plus a blob that
// counts its reads (Vitest's `vi.spyOn(file, 'slice')`); each spec runs on a
// fresh `MediaIdentities`, where the web's shared the module's memo.

import XCTest
@testable import AtelierKit

private struct Revoked: Error {}

/// A file's bytes, counting the slices read and able to fail like a revoked permission.
private final class CountingBlob: HashableBlob {
    let bytes: Data
    var slices = 0
    var broken = false

    init(_ bytes: Data) { self.bytes = bytes }

    var size: Int { bytes.count }

    func slice(_ start: Int, _ end: Int) throws -> Data {
        slices += 1
        if broken { throw Revoked() }
        return try bytes.slice(start, end)
    }
}

/// `(i + seed) % 251` over `size` bytes.
private func seeded(_ seed: Int, _ size: Int) -> Data {
    Data((0..<size).map { UInt8((($0 + seed) % 251)) })
}

/// A listed file — its ref and the blob `open` hands back for it.
private struct TestFile {
    let ref: SavedMediaRef
    let blob: CountingBlob
}

private func file(_ name: String, _ seed: Int, _ size: Int = 32, _ lastModified: Double = 1000) -> TestFile {
    TestFile(ref: SavedMediaRef(name: name, size: size, lastModified: lastModified), blob: CountingBlob(seeded(seed, size)))
}

/// What the app's `open` is: the bytes of each listed file, by identity.
private func opener(_ files: [TestFile]) -> (SavedMediaRef) throws -> HashableBlob {
    var byIdentity: [String: CountingBlob] = [:]
    for f in files { byIdentity[fileIdentity(f.ref)] = f.blob }
    return { ref in
        guard let blob = byIdentity[fileIdentity(ref)] else { throw Revoked() }
        return blob
    }
}

final class MediaHashTests: XCTestCase {
    func testAgreesWithThePureHash() throws {
        let ids = MediaIdentities()
        let f = file("a.mp4", 1)
        XCTAssertEqual(ids.hash(of: f.ref, open: opener([f])), partialHash(f.blob.bytes))
    }

    func testMemoisesByNameSizeAndMtimeSoAFolderIsReadOncePerSession() {
        let ids = MediaIdentities()
        let f = file("memo.mp4", 2)
        _ = ids.hash(of: f.ref, open: opener([f]))
        XCTAssertGreaterThan(f.blob.slices, 0)

        // A different handle for the same underlying file must not re-read.
        let again = file("memo.mp4", 2)
        _ = ids.hash(of: again.ref, open: opener([again]))
        XCTAssertEqual(again.blob.slices, 0)
    }

    func testReturnsNilInsteadOfThrowingWhenTheBytesCannotBeRead() {
        let ids = MediaIdentities()
        let broken = file("broken.mp4", 3)
        broken.blob.broken = true
        XCTAssertNil(ids.hash(of: broken.ref, open: opener([broken])))
    }
}

final class HashedMediaRefTests: XCTestCase {
    func testCarriesTheHashBesideTheExistingKeys() {
        let ids = MediaIdentities()
        let f = file("clip.mp4", 4, 32, 4242)
        let ref = ids.hashedRef(f.ref, open: opener([f]))
        XCTAssertEqual(ref.name, "clip.mp4")
        XCTAssertEqual(ref.size, 32)
        XCTAssertEqual(ref.lastModified, 4242)
        XCTAssertEqual(ref.hash, partialHash(f.blob.bytes))
    }

    func testOmitsTheHashRatherThanStoringANullWhenReadingFailed() {
        let ids = MediaIdentities()
        let broken = file("unreadable.mp4", 5)
        broken.blob.broken = true
        let ref = ids.hashedRef(broken.ref, open: opener([broken]))
        XCTAssertNil(ref.hash)
        XCTAssertNil(ref.json.objectValue?["hash"])
    }

    func testPreservesOrderAcrossAListing() {
        let ids = MediaIdentities()
        let files = [file("c.mp4", 6), file("a.mp4", 7), file("b.mp4", 8)]
        XCTAssertEqual(ids.hashedRefs(files.map(\.ref), open: opener(files)).map(\.name), ["c.mp4", "a.mp4", "b.mp4"])
    }
}

final class FindMediaTests: XCTestCase {
    func testFindsByNameWithoutReadingAByte() {
        let ids = MediaIdentities()
        let f = file("same.mp4", 9)
        let ref = ids.hashedRef(f.ref, open: opener([f]))
        let candidate = file("same.mp4", 9, 32, 2000)
        XCTAssertEqual(ids.find(ref, in: [candidate.ref], open: opener([candidate])), candidate.ref)
        XCTAssertEqual(candidate.blob.slices, 0)
    }

    func testFindsARenamedFileByItsHash() {
        let ids = MediaIdentities()
        let original = file("DJI_0001.MP4", 10)
        let ref = ids.hashedRef(original.ref, open: opener([original]))
        let renamed = TestFile(ref: SavedMediaRef(name: "sunset-graded.mp4", size: 32, lastModified: 5555),
                               blob: CountingBlob(original.blob.bytes))
        XCTAssertEqual(ids.find(ref, in: [renamed.ref], open: opener([renamed])), renamed.ref)
    }

    func testOnlyHashesTheSameSizeCandidates() {
        let ids = MediaIdentities()
        let original = file("gone.mp4", 11, 32)
        let ref = ids.hashedRef(original.ref, open: opener([original]))
        let wrongSize = file("other.mp4", 12, 64)
        _ = ids.find(ref, in: [wrongSize.ref], open: opener([wrongSize]))
        XCTAssertEqual(wrongSize.blob.slices, 0)
    }

    func testReturnsNilWhenTheRefCarriesNoHashAndTheNameIsGone() {
        let ids = MediaIdentities()
        let ref = SavedMediaRef(name: "vanished.mp4", size: 32, lastModified: 1)
        let other = file("other.mp4", 13)
        XCTAssertNil(ids.find(ref, in: [other.ref], open: opener([other])))
    }

    func testReturnsNilRatherThanGuessingWhenNothingMatches() {
        let ids = MediaIdentities()
        let a = file("a.mp4", 14)
        let ref = ids.hashedRef(a.ref, open: opener([a]))
        let b = file("b.mp4", 15)
        XCTAssertNil(ids.find(ref, in: [b.ref], open: opener([b])))
    }
}

// No web spec: what a SOURCE vouches for, which the web's registry holds.
final class KnownIdentityTests: XCTestCase {
    func testAFileASourceVouchedForAnswersWithTheSourcesHashAndReadsNothing() {
        let ids = MediaIdentities()
        let proxy = file("DJI_0001.webp", 16)
        let origin = MediaOrigin(sourceId: "winnow.example", fidelity: .proxy, width: 4000, height: 3000, name: "DJI_0001.DNG")
        ids.register(proxy.ref, KnownIdentity(assetId: "winnow.example/7", hash: "original-hash", origin: origin))
        XCTAssertEqual(ids.hash(of: proxy.ref, open: opener([proxy])), "original-hash")
        XCTAssertEqual(proxy.blob.slices, 0)
        let ref = ids.hashedRef(proxy.ref, open: opener([proxy]))
        XCTAssertEqual(ref.assetId, "winnow.example/7")
        XCTAssertEqual(ref.hash, "original-hash")
        XCTAssertEqual(ids.origin(of: proxy.ref), origin)
        // A file the person opened themselves has no origin.
        XCTAssertNil(ids.origin(of: file("mine.jpg", 17).ref))
        XCTAssertNil(ids.origin(of: nil))
    }

    func testTakesTheWinnowPortsIdentityWhole() {
        let origin = MediaOrigin(sourceId: "winnow.example", fidelity: .proxy)
        var exif = ExifData()
        exif.make = "DJI"
        let winnow = WinnowIdentity(assetId: "winnow.example/7", hash: "h", origin: origin, exif: exif,
                                    originalUrl: "https://winnow.example/api/assets/7/download")
        let known = KnownIdentity(winnow)
        XCTAssertEqual(known.assetId, "winnow.example/7")
        XCTAssertEqual(known.hash, "h")
        XCTAssertEqual(known.origin, origin)
        XCTAssertEqual(known.exif?.make, "DJI")
        XCTAssertEqual(known.originalUrl, "https://winnow.example/api/assets/7/download")
        XCTAssertEqual(winnow.asKnown, known)
    }
}
