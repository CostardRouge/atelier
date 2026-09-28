// Port of `src/shared/lut/gallery-nodes.test.ts`, plus a few cases of its own
// for what the web spec could not reach (it runs with an EMPTY `virtual:luts`,
// while here the built-ins are an argument).
//
// The web builds its fixture with `buildPackIndex` (the lut-pack task's, not
// ported yet); `pack` below is exactly what that builder returns for the
// spec's three paths — measured by running it in node on 2026-09-25.

import XCTest
@testable import AtelierKit

private let pack = LutPackIndex(
    id: "pk_1",
    name: "AUTHENTIC",
    author: "Victor Jimenes",
    tree: [
        PackNode(id: "creative", label: "Creative"),
        PackNode(id: "one-click", label: "One Click", children: [
            PackNode(id: "one-click/dji", label: "DJI", hint: "D-Log, not D-Log M — check your camera’s profile."),
            PackNode(id: "one-click/sony", label: "Sony"),
        ]),
    ],
    looks: [
        PackLook(id: "creative/authentic", label: "AUTHENTIC", node: "creative",
                 file: "Creative LUT/AUTHENTIC.cube", family: .rec709, hash: "h-creative"),
        PackLook(id: "one-click/dji/d-log", label: "D-Log", node: "one-click/dji",
                 file: "One Click LUT/DJI/AUTHENTIC_D-LOG.cube", family: .log, hash: "h-dji"),
        PackLook(id: "one-click/sony/s-log3", label: "S-Log3", node: "one-click/sony",
                 file: "One Click LUT/SONY/AUTHENTIC_SLOG3.cube", family: .log, hash: "h-sony"),
    ]
)

/// Thumbnails as the import bakes them, so the pre-baked path has something to draw.
private let withThumbs: LutPackIndex = {
    var p = pack
    p.looks = p.looks.map { l in
        var t = l
        t.thumb = "data:image/webp;base64,\(l.id)"
        return t
    }
    return p
}()

private func dji() -> PackLook { withThumbs.looks.first { $0.node == "one-click/dji" }! }
private func sony() -> PackLook { withThumbs.looks.first { $0.node == "one-click/sony" }! }

final class GalleryRailTests: XCTestCase {
    func testDrawsNoFavouritesRowWhenNothingIsStarred() {
        let nodes = galleryNodes([withThumbs], includeFilm: false, builtins: [])
        XCTAssertFalse(nodes.contains { $0.id == favouritesNode })
    }

    func testPutsTheStarredLooksFirstInTheOrderTheyWereStarred() {
        let a = packPickId("pk_1", sony().id)
        let b = packPickId("pk_1", dji().id)
        let nodes = galleryNodes([withThumbs], includeFilm: false, builtins: [], thumbs: [:], favourites: [a, b])

        XCTAssertEqual(nodes[0].id, favouritesNode)
        XCTAssertEqual(nodes[0].items.map(\.id), [a, b])
        // It repeats what other rows own — `aggregate` — which keeps a search
        // from listing every starred look twice.
        XCTAssertTrue(nodes[0].aggregate)
        XCTAssertTrue(matchingItems(nodes, "log").allSatisfy { $0.node.id != favouritesNode })
    }

    func testLeavesOutAStarWhoseLookIsGoneRatherThanDrawingAHole() {
        let live = packPickId("pk_1", dji().id)
        let nodes = galleryNodes([withThumbs], includeFilm: false, builtins: [], thumbs: [:],
                                 favourites: ["pack:pk_gone/whatever", live])
        XCTAssertEqual(nodes[0].id, favouritesNode)
        XCTAssertEqual(nodes[0].items.map(\.id), [live])
    }

    func testDrawsNoRowAtAllWhenEveryStarIsGone() {
        let nodes = galleryNodes([withThumbs], includeFilm: false, builtins: [], thumbs: [:],
                                 favourites: ["pack:pk_gone/whatever"])
        XCTAssertFalse(nodes.contains { $0.id == favouritesNode })
    }

    func testCarriesTheBakedThumbnailAndAResolveTheGridWillNotCall() {
        let nodes = galleryNodes([withThumbs], includeFilm: false, builtins: [])
        let item = nodes.flatMap(\.items).first { $0.id == packPickId("pk_1", dji().id) }!
        XCTAssertEqual(item.thumb, "data:image/webp;base64,\(dji().id)")
        // The tile draws the thumbnail and decodes nothing; the source is here
        // for the ONE look the scene aims at.
        XCTAssertEqual(item.resolve, .pack(pack: "pk_1", look: dji().id, hash: "h-dji"))
    }

    func testGivesEveryItemTheFamilyItsTileWasBakedOn() {
        let nodes = galleryNodes([withThumbs], includeFilm: true, builtins: [])
        let items = nodes.filter { !$0.aggregate }.flatMap(\.items)
        XCTAssertGreaterThan(items.count, 0)
        XCTAssertTrue(items.allSatisfy { $0.family == .log || $0.family == .rec709 })
        // A film stock is a response to a photograph, never a conversion.
        let film = items.first { $0.id.hasPrefix("film:") }
        XCTAssertEqual(film?.family, .rec709)
    }

    func testDropsEveryThumbnailAndResolvesInsteadWhenAskedToBakeLive() {
        let nodes = galleryNodes([withThumbs], includeFilm: false, builtins: [], thumbs: nil)
        let items = nodes.filter { !$0.aggregate }.flatMap(\.items)
        XCTAssertGreaterThan(items.count, 0)
        XCTAssertTrue(items.allSatisfy { $0.thumb == nil })
    }

    func testGivesABuiltInItsShippedTileWhenTheBuildHasOne() {
        // The web asserts this on the pack's side (it has no manifest): a look
        // with no baked thumb of its own still falls back to resolving.
        let nodes = galleryNodes([pack], includeFilm: false, builtins: [])
        let item = nodes.flatMap(\.items).first { $0.id.hasPrefix("pack:") }!
        XCTAssertNil(item.thumb)
        if case .pack = item.resolve {} else { XCTFail("a pack look resolves from the vault") }
    }
}

// MARK: - beyond the web spec

private let builtins = builtinLuts([
    LutManifestEntry(id: "root-look", name: "Root Look", group: "", file: "root-look.cube"),
    LutManifestEntry(id: "dji-mini", name: "Dji Mini 4 Pro D Log M To Rec709", group: "dji", file: "dji/mini.cube"),
    LutManifestEntry(id: "classic-warm", name: "Warm", group: "classic", file: "classic/warm.cube"),
])

final class GalleryBuiltinsTests: XCTestCase {
    func testListsFilmThenTheBuiltInsAndTheirFoldersThenEachPackBranch() {
        let nodes = galleryNodes([pack], includeFilm: true, builtins: builtins)
        XCTAssertEqual(nodes.map(\.id), [
            "film", "builtin", "builtin/CLASSIC", "builtin/DJI",
            "pack/pk_1", "pack/pk_1/creative", "pack/pk_1/one-click", "pack/pk_1/one-click/dji", "pack/pk_1/one-click/sony",
        ])
        XCTAssertEqual(nodes.map(\.depth), [0, 0, 1, 1, 0, 1, 1, 2, 2])
        XCTAssertEqual(nodes.first?.label, filmGroupLabel)
        XCTAssertEqual(nodes.first?.items.map(\.id), filmStocks.map { "film:\($0.id.rawValue)" })
        // The pack's root node carries the credits and, holding no look of its
        // own, shows its whole branch.
        let root = nodes[4]
        XCTAssertEqual(root.pack?.author, "Victor Jimenes")
        XCTAssertTrue(root.aggregate)
        XCTAssertEqual(root.items.count, 3)
        // A category whose looks hang from its cameras shows the branch, and a
        // node carries its caution.
        XCTAssertEqual(nodes[6].items.map(\.name), ["D-Log", "S-Log3"])
        XCTAssertEqual(nodes[7].hint, "D-Log, not D-Log M — check your camera’s profile.")
    }

    func testGivesABuiltInItsShippedTileItsSourceAndTheFamilyItsNameSays() {
        let nodes = galleryNodes([], includeFilm: false, builtins: builtins,
                                 thumbs: ["dji-mini": "lut-thumbs/dji-mini.webp"])
        let items = nodes.filter { !$0.aggregate }.flatMap(\.items)
        let mini = items.first { $0.id == "dji-mini" }!
        XCTAssertEqual(mini.thumb, "lut-thumbs/dji-mini.webp")
        XCTAssertEqual(mini.resolve, .builtin(id: "dji-mini"))
        XCTAssertEqual(mini.family, .log)
        let warm = items.first { $0.id == "classic-warm" }!
        XCTAssertNil(warm.thumb)
        XCTAssertEqual(warm.family, .rec709)
        // The root holds the looks at `luts/`'s own level.
        XCTAssertEqual(nodes.first { $0.id == "builtin" }?.items.map(\.id), ["root-look"])
    }

    func testAggregatesTheBuiltInRootWhenEveryLookIsInAFolder() {
        let foldered = builtins.filter { !$0.group.isEmpty }
        let root = galleryNodes([], includeFilm: false, builtins: foldered).first { $0.id == "builtin" }!
        XCTAssertTrue(root.aggregate)
        XCTAssertEqual(root.items.map(\.id), ["classic-warm", "dji-mini"])
    }

    func testSearchesTheNodesThatOwnTheirLooksIgnoringCaseAndSpace() {
        let nodes = galleryNodes([pack], includeFilm: false, builtins: builtins)
        let found = matchingItems(nodes, "  S-LOG ")
        XCTAssertEqual(found.map(\.node.id), ["pack/pk_1/one-click", "pack/pk_1/one-click/sony"])
        XCTAssertTrue(matchingItems(nodes, "   ").isEmpty)
    }

    func testReadsAPackPickBackIntoItsPackAndLook() {
        let id = packPickId("pk_1", "one-click/dji/d-log")
        XCTAssertEqual(id, "pack:pk_1/one-click/dji/d-log")
        let read = readPackPick(id)
        XCTAssertEqual(read?.pack, "pk_1")
        XCTAssertEqual(read?.look, "one-click/dji/d-log")
        XCTAssertNil(readPackPick("film:reversal-vivid"))
        XCTAssertNil(readPackPick("pack:/look"))
        XCTAssertNil(readPackPick("pack:nolook"))
    }
}
