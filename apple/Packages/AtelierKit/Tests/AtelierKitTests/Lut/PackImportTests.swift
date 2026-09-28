// `src/shared/lut/pack-import.ts` has no spec of its own on the web (it reads
// `File`s into IndexedDB); this one pins its observable rules over the
// in-memory vault of `PackFakes.swift`: which files of a folder become looks
// and in which order, one pass per file keyed by the SOURCE hash, every
// failure said with its reason, bytes already held reused, the thumbnail baked
// on its category's reference, and the index written LAST.

import XCTest
@testable import AtelierKit

/// A real 3D `.cube` at grid size 2, scaled so each file's bytes differ.
private func cubeText(_ scale: Double) -> String {
    var lines = ["TITLE \"x\"", "LUT_3D_SIZE 2"]
    for b in 0..<2 { for g in 0..<2 { for r in 0..<2 {
        lines.append("\(Double(r) * scale) \(Double(g) * scale) \(Double(b) * scale)")
    } } }
    return lines.joined(separator: "\n")
}

private struct Unreadable: Error, CustomStringConvertible {
    var description: String { "The file vanished while it was read." }
}

/// What a picked folder hands over: a path, and a way to its bytes (here the
/// text itself, or nil for a file that cannot be read).
private func folder() -> [(path: String, file: String?)] {
    [
        (path: "One Click LUT/DJI/AUTHENTIC_LUT_D-LOG.cube", file: cubeText(0.9)),
        (path: "tutorial.mp4", file: "not a look"),
        (path: "Creative LUT/AUTHENTIC_LUT.cube", file: cubeText(0.8)),
        (path: ".DS_Store", file: ""),
        (path: "Creative LUT/._AUTHENTIC_LUT.cube", file: "AppleDouble"),
        (path: "Conversion LUTs/DJI/DJI_DLOG.cube", file: cubeText(0.7)),
        (path: "Creative LUT/Notes.cube", file: "hello"),
        (path: "Creative LUT/Broken.cube", file: nil),
    ]
}

private func readText(_ file: String?) async throws -> [UInt8] {
    guard let file else { throw Unreadable() }
    return Array(file.utf8)
}

final class PackImportTests: XCTestCase {
    private var store = MemoryPackStore()
    private var vault = PackVault(store: MemoryPackStore())

    override func setUp() {
        super.setUp()
        store = MemoryPackStore()
        vault = PackVault(store: store)
    }

    private func options(_ id: String = "pk_1", thumbs: Bool = true) -> PackImportOptions {
        PackImportOptions(id: id, name: "AUTHENTIC", author: "Victor Jimenes",
                          url: "https://victorjim.gumroad.com/l/authentic_lut", thumbs: thumbs)
    }

    private let bake: (CubeLut, PackFamily) async -> String? = { _, family in
        "data:image/webp;base64,\(family.rawValue)"
    }

    func testCubeEntriesKeepsTheLooksAndSortsThemAsTheWebDoes() {
        let entries = cubeEntries(folder())
        // Hidden segments and non-`.cube` files are not looks; the order is
        // `localeCompare`'s, so `Conversion LUTs` comes before `Creative LUT`.
        XCTAssertEqual(entries.map(\.path), [
            "Conversion LUTs/DJI/DJI_DLOG.cube",
            "Creative LUT/AUTHENTIC_LUT.cube",
            "Creative LUT/Broken.cube",
            "Creative LUT/Notes.cube",
            "One Click LUT/DJI/AUTHENTIC_LUT_D-LOG.cube",
        ])
        XCTAssertEqual(cubeEntries([(path: ".hidden/look.cube", file: 1), (path: "LOOK.CUBE", file: 2)]).map(\.file), [2])
    }

    func testReadsTheFamilyOfAFileFromItsTopFolder() {
        XCTAssertEqual(familyOfPath("Conversion LUTs/DJI/x.cube"), .log)
        XCTAssertEqual(familyOfPath("One Click LUT/x.cube"), .log)
        XCTAssertEqual(familyOfPath("Creative LUT/x.cube"), .rec709)
        // A file at the root has no category, whatever its name says.
        XCTAssertEqual(familyOfPath("Log.cube"), .rec709)
    }

    func testPreviewsTheFoldersBeforeAByteIsStored() {
        let preview = importPreview(cubeEntries(folder()).map(\.path) + ["Root.cube"])
        XCTAssertEqual(preview.map(\.folder), ["Conversion LUTs · DJI", "Creative LUT", "One Click LUT · DJI", "—"])
        XCTAssertEqual(preview.map(\.looks), [1, 3, 1, 1])
    }

    func testImportsAFolderIntoTheVaultAndSaysWhatItCouldNotTake() async throws {
        var progress: [ImportProgress] = []
        let result = await importPackFromFolder(folder(), options(), vault: vault, read: readText,
                                                bakeThumb: bake, onProgress: { progress.append($0) })

        XCTAssertEqual(result.index.looks.map(\.id), ["conversion/dji/d-log", "creative/authentic", "one-click/dji/d-log"])
        XCTAssertEqual(result.failed, [
            ImportFailure(file: "Creative LUT/Broken.cube", reason: "The file vanished while it was read."),
            ImportFailure(file: "Creative LUT/Notes.cube", reason: "Not a 3D .cube LUT (1D LUTs are not supported)."),
        ])
        XCTAssertEqual(result.reused, 0)
        XCTAssertEqual(result.stored, 3 * encodedBytes(2))

        // Keyed by the SOURCE file's hash, holding the encoded lattice.
        let dLog = try XCTUnwrap(lookIn(result.index, "one-click/dji/d-log"))
        XCTAssertEqual(dLog.hash, sha256Hex(Array(cubeText(0.9).utf8)))
        XCTAssertEqual(dLog.bytes, cubeText(0.9).utf8.count)
        XCTAssertEqual(dLog.lattice, 2)
        XCTAssertEqual(store.lattices[dLog.hash!].flatMap { decodeLattice($0)?.size }, 2)
        // Each thumbnail on the reference its category asks for.
        XCTAssertEqual(dLog.thumb, "data:image/webp;base64,log")
        XCTAssertEqual(lookIn(result.index, "creative/authentic")?.thumb, "data:image/webp;base64,rec709")

        // The index is written LAST, once, and is what the vault now offers.
        XCTAssertEqual(store.events.last, "pack:pk_1")
        XCTAssertEqual(store.packWrites, 1)
        XCTAssertEqual(store.stored("pk_1"), result.index)
        let held = await vault.packsSnapshot().map(\.id)
        XCTAssertEqual(held, ["pk_1"])

        // One call per file, before it is read, then the end.
        XCTAssertEqual(progress.map(\.done), [0, 1, 2, 3, 4, 5])
        XCTAssertEqual(progress.first, ImportProgress(done: 0, total: 5, file: "Conversion LUTs/DJI/DJI_DLOG.cube"))
        XCTAssertEqual(progress.last, ImportProgress(done: 5, total: 5, file: ""))
    }

    func testReusesTheBytesThisDeviceAlreadyHolds() async {
        _ = await importPackFromFolder(folder(), options(thumbs: false), vault: vault, read: readText)
        let again = await importPackFromFolder(folder(), options("pk_2", thumbs: false), vault: vault, read: readText)
        XCTAssertEqual(again.reused, 3)
        XCTAssertEqual(again.stored, 0)
        XCTAssertEqual(again.index.looks.count, 3)
        XCTAssertEqual(store.lattices.count, 3)
        // Thumbnails off: none baked even with nothing to bake them.
        XCTAssertTrue(again.index.looks.allSatisfy { $0.thumb == nil })
    }

    func testReportsARefusedStoreAndLeavesThatLookOut() async {
        store.refuseLattices = true
        let result = await importPackFromFolder([(path: "Creative/Look.cube", file: cubeText(0.5) as String?)],
                                                options(), vault: vault, read: readText, bakeThumb: bake)
        XCTAssertEqual(result.failed, [ImportFailure(file: "Creative/Look.cube",
                                                     reason: "This browser refused to store it (storage full?).")])
        XCTAssertEqual(result.index.looks, [])
        XCTAssertEqual(result.stored, 0)
    }

    func testReadsTheTextPastAByteOrderMark() async {
        let withBom: [UInt8] = [0xEF, 0xBB, 0xBF] + Array(cubeText(0.5).utf8)
        XCTAssertEqual(parseCube(packCubeText(withBom))?.size, 2)
        XCTAssertEqual(packCubeText(Array("abc".utf8)), "abc")
    }
}
