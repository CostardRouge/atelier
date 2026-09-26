// Port of `src/shared/lut/upload-pack.test.ts`, case for case. The web mocks
// the vault's storage and its thumbnail baker; here the vault is the real
// `PackVault` over the in-memory store of `PackFakes.swift`, and no baker is
// handed in (a missing thumbnail is never a failed upload). What is checked is
// the three claims step 7 rests on (`docs/lut-packs.md` §3.1): the LATTICE
// goes to the vault keyed by the file's SHA-256; what comes back for the
// document is a REFERENCE of a couple of hundred bytes; the same file uploaded
// twice is one look, matched on the hash.

import XCTest
@testable import AtelierKit

/// A minimal but real 3D `.cube`: identity at grid size 2.
private let identityCube = [
    "LUT_3D_SIZE 2",
    "0 0 0",
    "1 0 0",
    "0 1 0",
    "1 1 0",
    "0 0 1",
    "1 0 1",
    "0 1 1",
    "1 1 1",
].joined(separator: "\n")

final class UploadPackTests: XCTestCase {
    private var store = MemoryPackStore()
    private var vault = PackVault(store: MemoryPackStore())

    override func setUp() {
        super.setUp()
        store = MemoryPackStore()
        vault = PackVault(store: store)
    }

    private func upload(_ name: String, _ text: String = identityCube) async throws -> UploadedLook {
        try await uploadLookIntoVault(Array(text.utf8), fileName: name, vault: vault)
    }

    private func lastSaved() -> LutPackIndex? { store.stored(uploadPackId) }

    func testStoresTheLatticeAndAnswersAReferenceNotALattice() async throws {
        let result = try await upload("My Teal Grade.cube")

        // The bytes went to the vault, keyed by the file's own hash.
        XCTAssertEqual(store.lattices.count, 1)
        XCTAssertEqual(result.ref.hash.count, 64)
        XCTAssertTrue(result.ref.hash.unicodeScalars.allSatisfy { ("0"..."9").contains($0) || ("a"..."f").contains($0) })
        XCTAssertEqual(store.lattices[result.ref.hash]?.count, encodedBytes(2))

        // What a document would store: three short strings, no lattice anywhere.
        XCTAssertEqual(result.ref.pack, uploadPackId)
        XCTAssertEqual(result.ref.look, "my-teal-grade")
        XCTAssertLessThan(writePackRef(result.ref).count, 200)
        XCTAssertFalse(writePackRef(result.ref).contains("LUT_3D_SIZE"))

        // And the caller can grade at once, without a round trip through storage.
        XCTAssertEqual(result.lut.size, 2)
        XCTAssertEqual(result.name, "My Teal Grade")
    }

    func testFilesTheLookInTheOnePersonalPackAtItsRoot() async throws {
        _ = try await upload("Sunset.cube")
        let index = try XCTUnwrap(lastSaved())
        XCTAssertEqual(index.id, uploadPackId)
        XCTAssertEqual(index.looks.count, 1)
        XCTAssertEqual(index.looks[0].node, "")
        // No category above it, so the reference is read from the NAME (§7).
        XCTAssertEqual(index.looks[0].family, .rec709)
    }

    func testReadsAConversionLookOnTheLogReference() async throws {
        _ = try await upload("DJI D-Log M to Rec709.cube")
        XCTAssertEqual(lastSaved()?.looks[0].family, .log)
    }

    func testRecognisesTheSameBytesAgainRatherThanStoringThemTwice() async throws {
        let first = try await upload("Teal.cube")
        let writes = store.packWrites
        // A renamed copy of the same file: the HASH is what is matched, so it
        // is the same look and the index does not grow.
        let again = try await upload("Teal copy.cube")

        XCTAssertEqual(again.ref, first.ref)
        XCTAssertEqual(store.lattices.count, 1)
        XCTAssertEqual(store.packWrites, writes)
    }

    func testGivesTwoDifferentLooksTwoDifferentIds() async throws {
        let a = try await upload("Look.cube")
        let b = try await upload("Look.cube", identityCube.replacingOccurrences(of: "1 1 1", with: "0.9 0.9 0.9"))
        XCTAssertEqual(a.ref.look, "look")
        XCTAssertEqual(b.ref.look, "look-2")
        XCTAssertEqual(store.lattices.count, 2)
    }

    func testRefusesAFileThatIsNotA3DCubeRatherThanStoringJunk() async {
        do {
            _ = try await upload("notes.cube", "hello")
            XCTFail("junk must be refused")
        } catch {
            XCTAssertTrue(String(describing: error).contains("3D .cube"))
        }
        XCTAssertEqual(store.lattices.count, 0)
        XCTAssertEqual(store.packWrites, 0)
    }

    func testUploadedLabelKeepsTheAuthorsOwnNameMinusTheExtension() {
        XCTAssertEqual(uploadedLabel("My Teal Grade.cube"), "My Teal Grade")
        XCTAssertEqual(uploadedLabel("AUTHENTIC_LUT_D-LOG.CUBE"), "AUTHENTIC_LUT_D-LOG")
        XCTAssertEqual(uploadedLabel(".cube"), ".cube")
    }

    /// Not in the web spec: a refused store REFUSES the upload — falling back
    /// to an inlined lattice would quietly reopen the leak — and writes no index.
    func testARefusedStoreRefusesTheUploadAndWritesNoIndex() async {
        store.refuseLattices = true
        do {
            _ = try await upload("Teal.cube")
            XCTFail("a refused store must refuse the upload")
        } catch {
            XCTAssertEqual(error as? PackVaultError, PackVaultError("This browser refused to store the look (storage full?)."))
        }
        XCTAssertEqual(store.packWrites, 0)
    }

    /// Not in the web spec: the thumbnail is baked on the family the name
    /// asks for, only for a look the pack does not hold yet, and kept.
    func testBakesTheThumbnailOnceOnTheFamilyTheNameAsksFor() async throws {
        var asked: [PackFamily] = []
        let bake: (CubeLut, PackFamily) async -> String? = { _, family in
            asked.append(family)
            return "data:image/webp;base64,\(family.rawValue)"
        }
        _ = try await uploadLookIntoVault(Array(identityCube.utf8), fileName: "VLog_to_709.cube", vault: vault,
                                          bakeThumb: bake)
        _ = try await uploadLookIntoVault(Array(identityCube.utf8), fileName: "again.cube", vault: vault,
                                          bakeThumb: bake)
        XCTAssertEqual(asked, [.log])
        XCTAssertEqual(lastSaved()?.looks.map(\.thumb), ["data:image/webp;base64,log"])
        XCTAssertEqual(lastSaved()?.name, uploadPackName)
    }

    /// Not in the web spec: the pure half, as the app may call it alone.
    func testNewUploadLookIsUniqueInThePackAndAtItsRoot() {
        var pack = emptyUploadPack()
        let first = newUploadLook(in: pack, fileName: "Look.cube", size: 10, lattice: 33, hash: "h1")
        pack.looks.append(first)
        let second = newUploadLook(in: pack, fileName: "LOOK.cube", size: 10, lattice: 33, hash: "h2", thumb: "")
        XCTAssertEqual(first.id, "look")
        XCTAssertEqual(second.id, "look-2")
        XCTAssertEqual(second.label, "LOOK")
        XCTAssertEqual(second.file, "LOOK.cube")
        XCTAssertNil(second.thumb)
        XCTAssertEqual(first.lattice, 33)
        XCTAssertEqual(first.bytes, 10)
    }
}
