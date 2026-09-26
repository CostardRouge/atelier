// `src/shared/lut/pack-vault.ts` has no spec of its own on the web (it is
// module state over IndexedDB); this one pins its observable rules over the
// in-memory store and the fake instance of `PackFakes.swift`: resolution by
// HASH, cached once and a miss never remembered; a look fetched from the
// instance under its BLOB on first use and kept; a forget that frees only
// what no surviving look names, goes to the instance FIRST, and refuses when
// the instance cannot be reached; the sentences a missing look says.

import XCTest
@testable import AtelierKit

/// A real encoded lattice, distinct per `scale`.
private func latticeBytes(_ scale: Double = 1) -> [UInt8] {
    try! encodeLattice(CubeLut.make(size: 2) { r, g, b in (r * scale, g * scale, b * scale) })
}

private func packOf(_ id: String, _ name: String, hashes: [String], sourceId: String? = nil,
                    author: String = "") -> LutPackIndex {
    var index = buildPackIndex(
        hashes.enumerated().map { PackFileEntry(path: "Creative/Look \($0.offset).cube", lattice: 2, hash: $0.element) },
        BuildPackOptions(id: id, name: name, author: author)
    )
    index.sourceId = sourceId
    return index
}

final class PackVaultTests: XCTestCase {
    private var store = MemoryPackStore()

    override func setUp() {
        super.setUp()
        store = MemoryPackStore()
    }

    private func seed(_ packs: LutPackIndex...) {
        for pack in packs { store.packs[pack.id] = pack.json }
    }

    func testLoadsOnceAndListsThePacksByName() async {
        seed(packOf("pk_z", "Zeta", hashes: []), packOf("pk_a", "alpha", hashes: []),
             packOf("pk_m", "", hashes: [], author: "Mid"))
        let vault = PackVault(store: store)
        let snapshotBefore = await vault.packsSnapshot()
        XCTAssertEqual(snapshotBefore, [])
        let loaded = await vault.loadPacks()
        XCTAssertEqual(loaded.map(\.id), ["pk_a", "pk_m", "pk_z"])
        _ = await vault.loadPacks()
        XCTAssertEqual(store.lists, 1)
    }

    func testSavingReplacesAPackReSortsAndTellsTheSubscribers() async {
        seed(packOf("pk_b", "Beta", hashes: []))
        let vault = PackVault(store: store)
        let counter = PackCounter()
        let token = await vault.subscribePacks { counter.count += 1 }
        _ = await vault.loadPacks()
        XCTAssertEqual(counter.count, 1)
        await vault.savePack(packOf("pk_a", "Alpha", hashes: []))
        await vault.savePack(packOf("pk_b", "Beta 2", hashes: []))
        let names = await vault.packsSnapshot().map(\.name)
        XCTAssertEqual(names, ["Alpha", "Beta 2"])
        XCTAssertEqual(counter.count, 3)
        await vault.unsubscribePacks(token)
        await vault.setPackHidden("pk_a", ["creative"])
        XCTAssertEqual(counter.count, 3)
        XCTAssertEqual(store.stored("pk_a")?.hidden, ["creative"])
    }

    func testResolvesALatticeByItsHashOnceForManyPictures() async throws {
        let bytes = latticeBytes(0.5)
        store.lattices["h1"] = bytes
        seed(packOf("pk_1", "AUTHENTIC", hashes: ["h1"]))
        let vault = PackVault(store: store)
        _ = await vault.loadPacks()
        // A reference that carries no hash is resolved through its look's.
        let ref = PackRef(pack: "pk_1", look: "creative/look-0", hash: "")
        let cube = await vault.resolvePackLattice(ref)
        XCTAssertEqual(cube?.data, decodeLattice(bytes)?.data)
        XCTAssertEqual(cube?.title, "AUTHENTIC · Creative · Look 0")
        _ = await vault.resolvePackLattice(PackRef(pack: "pk_1", look: "creative/look-0", hash: "h1"))
        XCTAssertEqual(store.latticeReads, ["h1"])
    }

    func testAMissIsNeverRememberedAndNoHashAsksNothing() async {
        let vault = PackVault(store: store)
        _ = await vault.loadPacks()
        let none = await vault.resolvePackLattice(PackRef(pack: "pk_x", look: "a", hash: ""))
        XCTAssertNil(none)
        XCTAssertEqual(store.latticeReads, [])
        let missing = await vault.resolvePackLattice(PackRef(pack: "pk_x", look: "a", hash: "h9"))
        XCTAssertNil(missing)
        // The pack is imported a moment later: the look grades at once.
        store.lattices["h9"] = latticeBytes()
        let found = await vault.resolvePackLattice(PackRef(pack: "pk_x", look: "a", hash: "h9"))
        XCTAssertNotNil(found)
    }

    func testFetchesALookOnFirstUseUnderItsBlobAndKeepsIt() async {
        let bytes = latticeBytes(0.8)
        let blob = sha256Hex(bytes)
        let (host, client) = fakePackHost()
        client.files[blob] = bytes
        var pack = packOf("pk_1", "AUTHENTIC", hashes: ["h1"], sourceId: "winnow.example")
        pack.looks[0].blob = blob
        seed(pack)
        let vault = PackVault(store: store, hosts: { [host] })
        _ = await vault.loadPacks()

        let ref = PackRef(pack: "pk_1", look: "creative/look-0", hash: "h1")
        let cube = await vault.resolvePackLattice(ref)
        XCTAssertEqual(cube?.data, decodeLattice(bytes)?.data)
        // Asked under the BLOB — the id the bytes are stored under there —
        // never under the `.cube`'s hash, which would 404 on every picture.
        XCTAssertEqual(client.calls, ["get-file:\(blob)"])
        // Kept on the way through: the phone grades offline from now on.
        XCTAssertEqual(store.lattices["h1"], bytes)
        _ = await vault.resolvePackLattice(ref)
        XCTAssertEqual(client.calls.count, 1)
    }

    func testAPackNeverPushedOrNotReachableAnswersNotHere() async {
        let (host, client) = fakePackHost()
        // Kept on an instance, but this look was never pushed: no blob to ask for.
        seed(packOf("pk_1", "A", hashes: ["h1"], sourceId: "winnow.example"))
        let vault = PackVault(store: store, hosts: { [host] })
        _ = await vault.loadPacks()
        let unpushed = await vault.resolvePackLattice(PackRef(pack: "pk_1", look: "creative/look-0", hash: "h1"))
        XCTAssertNil(unpushed)
        XCTAssertEqual(client.calls, [])

        // Pushed, but the instance does not answer: still simply not here.
        var pushed = packOf("pk_2", "B", hashes: ["h2"], sourceId: "winnow.example")
        pushed.looks[0].blob = "b2"
        await vault.savePack(pushed)
        client.offline = true
        let offline = await vault.resolvePackLattice(PackRef(pack: "pk_2", look: "creative/look-0", hash: "h2"))
        XCTAssertNil(offline)
        XCTAssertEqual(client.calls, ["get-file:b2"])
    }

    func testForgettingALookFreesOnlyWhatNoOtherLookNames() async throws {
        store.lattices["h1"] = latticeBytes(0.1)
        store.lattices["h2"] = latticeBytes(0.2)
        seed(packOf("pk_a", "A", hashes: ["h1", "h2"]), packOf("pk_b", "B", hashes: ["h2"]))
        let vault = PackVault(store: store)
        _ = await vault.resolvePackLattice(PackRef(pack: "pk_a", look: "creative/look-0", hash: "h1"))

        let freed = try await vault.forgetLook("pk_a", "creative/look-0")
        XCTAssertEqual(freed, ForgetResult(here: encodedBytes(2), instance: 0, keptOn: nil, shared: 0))
        XCTAssertNil(store.lattices["h1"])
        XCTAssertEqual(store.stored("pk_a")?.looks.map(\.id), ["creative/look-1"])
        // The decode cache let the freed lattice go with it.
        let gone = await vault.resolvePackLattice(PackRef(pack: "pk_a", look: "creative/look-0", hash: "h1"))
        XCTAssertNil(gone)

        // Pack B still holds the same `.cube`: forgetting it from A frees nothing.
        let shared = try await vault.forgetLook("pk_a", "creative/look-1")
        XCTAssertEqual(shared, ForgetResult(here: 0, instance: 0, keptOn: nil, shared: 1))
        XCTAssertEqual(forgotten(shared), "no bytes came back: another look holds the same lattice.")
        XCTAssertNotNil(store.lattices["h2"])
    }

    func testRemovingAPackTakesItsIndexAndItsFreeLattices() async throws {
        store.lattices["h1"] = latticeBytes(0.1)
        store.lattices["h2"] = latticeBytes(0.2)
        seed(packOf("pk_a", "A", hashes: ["h1", "h2"]), packOf("pk_b", "B", hashes: ["h2"]))
        let vault = PackVault(store: store)
        let result = try await vault.removePack("pk_a")
        XCTAssertEqual(result.here, encodedBytes(2))
        XCTAssertEqual(result.shared, 1)
        XCTAssertNil(store.packs["pk_a"])
        XCTAssertEqual(Set(store.lattices.keys), ["h2"])
        let ids = await vault.packsSnapshot().map(\.id)
        XCTAssertEqual(ids, ["pk_b"])
    }

    func testRefusesToForgetWhatItCannotReachAndChangesNothing() async {
        store.lattices["h1"] = latticeBytes()
        seed(packOf("pk_a", "A", hashes: ["h1"], sourceId: "winnow.example"))
        let vault = PackVault(store: store)
        do {
            _ = try await vault.forgetLook("pk_a", "creative/look-0")
            XCTFail("an unreachable instance must refuse the forget")
        } catch {
            XCTAssertEqual(error as? PackVaultError, PackVaultError(
                "This pack is kept on winnow.example. Connect it, so the look is forgotten there too and its bytes come back."
            ))
        }
        do {
            _ = try await vault.removePack("pk_a")
            XCTFail("an unreachable instance must refuse the forget")
        } catch {
            XCTAssertTrue(String(describing: error).contains("so the pack is forgotten there too"))
        }
        do {
            _ = try await vault.removePack("pk_nope")
            XCTFail("an unknown pack is refused")
        } catch {
            XCTAssertEqual(error as? PackVaultError, PackVaultError("That pack is not in this browser."))
        }
        XCTAssertNotNil(store.lattices["h1"])
        XCTAssertEqual(store.stored("pk_a")?.looks.count, 1)
    }

    func testForgetsOnTheInstanceFirstThenHere() async throws {
        let (host, client) = fakePackHost()
        store.lattices["h1"] = latticeBytes(0.1)
        store.lattices["h2"] = latticeBytes(0.2)
        seed(packOf("pk_a", "A", hashes: ["h1", "h2"]))
        let vault = PackVault(store: store, hosts: { [host] })
        _ = await vault.loadPacks()
        _ = try await vault.keepPackOn("pk_a", "winnow.example")
        client.calls.removeAll()
        let writesBefore = store.events.count

        let result = try await vault.forgetLook("pk_a", "creative/look-0")
        XCTAssertEqual(result, ForgetResult(here: encodedBytes(2), instance: encodedBytes(2),
                                            keptOn: "winnow.example", shared: 0))
        // There first — the index without the look, then its bytes — and only
        // then here.
        let blob = sha256Hex(latticeBytes(0.1))
        XCTAssertEqual(client.calls, ["get-doc:pk_a", "put-doc:pk_a", "del-file:\(blob)"])
        XCTAssertEqual(Array(store.events.dropFirst(writesBefore)), ["pack:pk_a"])
        XCTAssertEqual(migratePackIndex(client.docs["pk_a"])?.looks.count, 1)
        XCTAssertNil(store.lattices["h1"])
    }

    func testKeepsAPackOnAnInstanceAndSavesTheIndexAsPushed() async throws {
        let (host, client) = fakePackHost()
        store.lattices["h1"] = latticeBytes()
        seed(packOf("pk_a", "A", hashes: ["h1"]))
        let vault = PackVault(store: store, hosts: { [host] })
        _ = await vault.loadPacks()

        let result = try await vault.keepPackOn("pk_a", "winnow.example")
        XCTAssertEqual(result.sent, 1)
        let kept = try XCTUnwrap(store.stored("pk_a"))
        XCTAssertEqual(kept.sourceId, "winnow.example")
        XCTAssertEqual(kept.looks[0].blob, sha256Hex(latticeBytes()))
        XCTAssertEqual(client.files.count, 1)
        let keepers = await vault.packKeepers().map(\.sourceId)
        XCTAssertEqual(keepers, ["winnow.example"])

        do {
            _ = try await vault.keepPackOn("pk_a", "elsewhere.example")
            XCTFail("an instance that cannot keep a pack is refused")
        } catch {
            XCTAssertEqual(error as? PackVaultError,
                           PackVaultError("That instance cannot keep a pack — reconnect it and try again."))
        }
        do {
            _ = try await vault.keepPackOn("pk_nope", "winnow.example")
            XCTFail("an unknown pack is refused")
        } catch {
            XCTAssertEqual(error as? PackVaultError, PackVaultError("That pack is not in this browser."))
        }
    }

    func testAdoptsAnInstancesPackAsAnIndexOnly() async throws {
        let (host, client) = fakePackHost()
        seed(packOf("pk_here", "Here", hashes: []))
        client.setDoc("pk_here", packOf("pk_here", "Here", hashes: []).json)
        client.setDoc("pk_there", packOf("pk_there", "There", hashes: ["h1"]).json)
        let vault = PackVault(store: store, hosts: { [host] })
        _ = await vault.loadPacks()

        let missing = try await vault.remotePacksNotHere(host)
        XCTAssertEqual(missing.map(\.id), ["pk_there"])
        await vault.adoptRemotePack(missing[0], "winnow.example")
        XCTAssertEqual(store.stored("pk_there")?.sourceId, "winnow.example")
        // 40 MB is not downloaded because a list was opened.
        XCTAssertFalse(client.calls.contains { $0.hasPrefix("get-file") })
        XCTAssertTrue(store.lattices.isEmpty)
    }

    func testSaysWhyALookCannotGradeHere() async {
        let (host, _) = fakePackHost()
        seed(packOf("pk_local", "Local", hashes: ["h1"]),
             packOf("pk_kept", "", hashes: ["h2"], sourceId: "winnow.example", author: "Victor"),
             packOf("pk_far", "Far", hashes: ["h3"], sourceId: "far.example"))
        let vault = PackVault(store: store, hosts: { [host] })
        _ = await vault.loadPacks()

        let noPack = await vault.missingLookReason(PackRef(pack: "pk_nope", look: "a", hash: ""))
        XCTAssertEqual(noPack, "This look comes from a pack this browser does not hold.")
        let forgotten = await vault.missingLookReason(PackRef(pack: "pk_kept", look: "gone", hash: ""))
        XCTAssertEqual(forgotten, "That look is no longer in Victor — forgotten, or gone from the pack.")
        let far = await vault.missingLookReason(PackRef(pack: "pk_far", look: "creative/look-0", hash: ""))
        XCTAssertEqual(far, "Kept on far.example — connect it to grade with this look.")
        let notYet = await vault.missingLookReason(PackRef(pack: "pk_local", look: "creative/look-0", hash: ""))
        XCTAssertEqual(notYet, "This look is not in this browser’s vault yet.")
        let name = await vault.packLookName(PackRef(pack: "pk_local", look: "creative/look-0", hash: ""))
        XCTAssertEqual(name, "Local · Creative · Look 0")
        let noName = await vault.packLookName(PackRef(pack: "pk_local", look: "nope", hash: ""))
        XCTAssertNil(noName)
    }

    func testReadStoredPacksLeavesJunkBehindAndSorts() {
        let rows: [JSONValue] = [packOf("pk_b", "beta", hashes: []).json, ["not": "a pack"],
                                 packOf("pk_a", "Alpha", hashes: []).json]
        XCTAssertEqual(readStoredPacks(rows).map(\.id), ["pk_a", "pk_b"])
        XCTAssertEqual(sortPacks([packOf("2", "Same", hashes: []), packOf("1", "Same", hashes: [])]).map(\.id), ["2", "1"])
    }

    func testMeasuresWhatItHolds() async {
        store.lattices["h1"] = latticeBytes()
        let vault = PackVault(store: store)
        let sizes = await vault.storedLatticeSizes()
        XCTAssertEqual(sizes, ["h1": encodedBytes(2)])
        let hashes = await vault.storedLatticeHashes()
        XCTAssertEqual(hashes, ["h1"])
        let ok = await vault.saveLookLattice("pk", "h2", [1, 2])
        XCTAssertTrue(ok)
        XCTAssertEqual(store.lattices["h2"], [1, 2])
    }
}
