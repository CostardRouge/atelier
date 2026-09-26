// A spec of its own: `builtin-luts.ts` and `builtin-thumbs.ts` have no web
// twin (one reads a Vite virtual module, the other fetches). What it pins is
// the one thing that must never drift between the two clients — the id a
// `.cube` gets, since a document names a built-in as `builtin:<id>` — checked
// against the plugin's own scan of the repo's 28 built-ins (run in node on
// 2026-09-25), and the tiles' naming rule against `public/lut-thumbs/`.

import XCTest
@testable import AtelierKit

/// `public/luts/`, as a bundle would list it: out of order, with a README, a
/// macOS sidecar and a hidden folder the scan must skip.
private let bundlePaths = [
    "sony/From_SLog2SGumut_To_SLog2-709_.cube",
    "dji/dji_mini_4_pro_d-log_m-to-rec709.cube",
    "apple/BaseLUT - Apple iPhone - Apple Log to Rec709 - Low ISO.cube",
    "classic/README.md",
    "classic/warm.cube",
    "apple/Apple-Log-2-Rec709.cube",
    "sony/4_SGamut3CineSLog3_To_Cine+709.cube",
    "classic/._warm.cube",
    ".git/objects/x.cube",
    "apple/Apple-Log-2-Rec709-low-ISO.cube",
    "sony/From_SLog2SGumut_To_Cine+709.cube",
    "apple/BaseLUT - Apple iPhone - Apple Log to Rec709.cube",
    "sony/From_SLog2SGumut_To_LC-709_.cube",
    "sony/From_SLog2SGumut_To_LC-709TypeA_.cube",
    "classic/black-and-white.cube",
    "sony/1_SGamut3CineSLog3_To_LC-709.cube",
]

/// What the plugin's scan answers for those files, in its order.
private let scanned: [(id: String, name: String, group: String)] = [
    ("apple-apple-log-2-rec709", "Apple Log 2 Rec709", "apple"),
    ("apple-apple-log-2-rec709-low-iso", "Apple Log 2 Rec709 Low ISO", "apple"),
    ("apple-baselut-apple-iphone-apple-log-to-rec709", "BaseLUT Apple IPhone Apple Log To Rec709", "apple"),
    ("apple-baselut-apple-iphone-apple-log-to-rec709-low-iso", "BaseLUT Apple IPhone Apple Log To Rec709 Low ISO", "apple"),
    ("classic-black-and-white", "Black And White", "classic"),
    ("classic-warm", "Warm", "classic"),
    ("dji-dji-mini-4-pro-d-log-m-to-rec709", "Dji Mini 4 Pro D Log M To Rec709", "dji"),
    ("sony-1-sgamut3cineslog3-to-lc-709", "1 SGamut3CineSLog3 To LC 709", "sony"),
    ("sony-4-sgamut3cineslog3-to-cine-709", "4 SGamut3CineSLog3 To Cine+709", "sony"),
    ("sony-from-slog2sgumut-to-cine-709", "From SLog2SGumut To Cine+709", "sony"),
    ("sony-from-slog2sgumut-to-lc-709-", "From SLog2SGumut To LC 709", "sony"),
    ("sony-from-slog2sgumut-to-lc-709typea-", "From SLog2SGumut To LC 709TypeA", "sony"),
    ("sony-from-slog2sgumut-to-slog2-709-", "From SLog2SGumut To SLog2 709", "sony"),
]

final class LutManifestTests: XCTestCase {
    func testDerivesTheWebsIdNameAndGroupAndSortsAsTheScanDoes() {
        let manifest = lutManifest(relativePaths: bundlePaths)
        XCTAssertEqual(manifest.map(\.id), scanned.map(\.id))
        XCTAssertEqual(manifest.map(\.name), scanned.map(\.name))
        XCTAssertEqual(manifest.map(\.group), scanned.map(\.group))
        XCTAssertEqual(manifest.first?.file, "apple/Apple-Log-2-Rec709.cube")
    }

    func testSkipsWhatTheScanSkips() {
        XCTAssertNil(lutManifestEntry(relativePath: "classic/README.md"))
        XCTAssertNil(lutManifestEntry(relativePath: "classic/._warm.cube"))
        XCTAssertNil(lutManifestEntry(relativePath: ".hidden/look.cube"))
        // A file at the root has no group, and the extension's case is free.
        XCTAssertEqual(lutManifestEntry(relativePath: "My_Look.CUBE"),
                       LutManifestEntry(id: "my-look", name: "My Look", group: "", file: "My_Look.CUBE"))
        // Nested folders are one group, posix-joined.
        XCTAssertEqual(lutManifestEntry(relativePath: "apple/log/x.cube")?.group, "apple/log")
    }

    func testReadsThePluginsJSONAndLeavesJunkBehind() {
        let manifest: JSONValue = [
            ["id": "classic-warm", "name": "Warm", "group": "classic", "file": "classic/warm.cube"],
            ["id": "no-file", "name": "x", "group": ""],
            "junk",
            ["id": "root", "name": "Root", "group": "", "file": "root.cube"],
        ]
        let luts = builtinLuts(from: manifest, base: "Luts/")
        XCTAssertEqual(luts, [
            BuiltinLut(id: "classic-warm", name: "Warm", group: "classic", url: "Luts/classic/warm.cube"),
            BuiltinLut(id: "root", name: "Root", group: "", url: "Luts/root.cube"),
        ])
        XCTAssertEqual(builtinLuts(from: nil), [])
        XCTAssertEqual(builtinLuts(from: ["not": "a list"]), [])
    }
}

final class LutGroupsTests: XCTestCase {
    func testListsTheRootApartAndGroupsTheRestByFolderUppercased() {
        let luts = [
            BuiltinLut(id: "z", name: "Z", group: "sony", url: ""),
            BuiltinLut(id: "r", name: "R", group: "", url: ""),
            BuiltinLut(id: "a", name: "A", group: "apple/log", url: ""),
            BuiltinLut(id: "s2", name: "S2", group: "sony", url: ""),
        ]
        XCTAssertEqual(ungroupedLuts(luts).map(\.id), ["r"])
        let groups = lutGroups(luts)
        XCTAssertEqual(groups.map(\.label), ["APPLE / LOG", "SONY"])
        // Within a group, the manifest's own order.
        XCTAssertEqual(groups[1].luts.map(\.id), ["z", "s2"])
    }
}

final class BuiltinThumbsTests: XCTestCase {
    func testNamesATileTheWayTheGeneratorDoes() {
        XCTAssertEqual(builtinThumbFile("film:negative-portrait"), "film-negative-portrait.webp")
        XCTAssertEqual(builtinThumbFile("none"), "none.webp")
        XCTAssertEqual(builtinThumbFile("Weird ID/+x"), "weird-id-x.webp")
        // Every built-in's tile is named after its id — as `public/lut-thumbs/` holds them.
        XCTAssertEqual(builtinThumbFile("sony-from-slog2sgumut-to-lc-709-"), "sony-from-slog2sgumut-to-lc-709-.webp")
        XCTAssertEqual(builtinThumbFile("apple-apple-log-2-rec709-low-iso"), "apple-apple-log-2-rec709-low-iso.webp")
    }

    func testReadsTheIndexAndLetsOnlyAPlainFileNameThrough() {
        let index: JSONValue = [
            "note": "Generated by scripts/gen-lut-thumbs.mjs — do not edit by hand.",
            "version": 1,
            "thumbs": [
                "none": "none.webp",
                "film:reversal-vivid": "film-reversal-vivid.webp",
                "escape": "../secret.webp",
                "nested": "a/b.webp",
                "scheme": "https://example.com/x.webp",
                "number": 3,
                "empty": "",
            ],
        ]
        XCTAssertEqual(readBuiltinThumbs(index, dir: "lut-thumbs/"), [
            "none": "lut-thumbs/none.webp",
            "film:reversal-vivid": "lut-thumbs/film-reversal-vivid.webp",
        ])
    }

    func testAMissingOrMalformedIndexIsAValidStateNotAnError() {
        XCTAssertEqual(readBuiltinThumbs(nil, dir: "d/"), [:])
        XCTAssertEqual(readBuiltinThumbs(["thumbs": []], dir: "d/"), [:])
        XCTAssertEqual(readBuiltinThumbs("junk", dir: "d/"), [:])
    }
}
