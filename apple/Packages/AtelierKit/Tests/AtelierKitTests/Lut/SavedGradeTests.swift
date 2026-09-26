// Port of `src/shared/lut/saved-grade.test.ts`, case for case, plus a spec of
// the resolver's own (`restoreLayers`), whose web twin fetches and so has none.

import XCTest
@testable import AtelierKit

private func layer(_ change: (inout SavedLutLayer) -> Void = { _ in }) -> SavedLutLayer {
    var l = SavedLutLayer(id: "l1", source: "builtin:dji-dlog-m", name: "DJI D-Log M",
                          customText: nil, intensity: 1, enabled: true)
    change(&l)
    return l
}

private func packLayer(_ change: (inout SavedLutLayer) -> Void = { _ in }) -> SavedLutLayer {
    layer { l in
        l.id = "p1"
        l.source = "pack"
        l.name = "AUTHENTIC · One Click · DJI · D-Log"
        l.customText = "{\"pack\":\"pk_1\",\"look\":\"one-click/dji/d-log\",\"hash\":\"aa\"}"
        change(&l)
    }
}

private func grade(_ layers: [SavedLutLayer], _ output: OutputTransform = .none, film: FilmTexture? = nil) -> SavedGrade {
    SavedGrade(layers: layers, output: output, film: film)
}

final class SavedGradePackLayerTests: XCTestCase {
    func testIsKeyedOnItsReferenceSoTwoLooksNeverShareABakedCube() {
        let a = gradeKey(grade([packLayer()]))
        let b = gradeKey(grade([packLayer { $0.customText = "{\"pack\":\"pk_1\",\"look\":\"creative/authentic\",\"hash\":\"bb\"}" }]))
        XCTAssertNotEqual(a, b)
        // The same reference twice is the same key — one bake for a deck whose
        // pictures all wear the pack's look.
        XCTAssertEqual(gradeKey(grade([packLayer()])), a)
    }

    func testIsNotAnUploadedLookItCarriesAReferenceNeverALattice() {
        XCTAssertFalse(isUploadedLook(packLayer()))
        XCTAssertLessThan(packLayer().customText!.count, 200)
    }
}

final class GradeKeyTests: XCTestCase {
    func testSeparatesTwoGradesThatDifferInAnythingABakeReads() {
        let base = grade([layer()])
        let key = gradeKey(base)
        XCTAssertEqual(gradeKey(grade([layer()])), key)
        var other = base
        other.output = .rec709ToSrgb
        XCTAssertNotEqual(gradeKey(other), key)
        XCTAssertNotEqual(gradeKey(grade([layer { $0.intensity = 0.5 }])), key)
        XCTAssertNotEqual(gradeKey(grade([layer { $0.enabled = false }])), key)
        XCTAssertNotEqual(gradeKey(grade([layer { $0.id = "l2" }])), key)
        XCTAssertNotEqual(gradeKey(grade([])), key)
    }

    func testSeparatesTwoGradesThatDifferOnlyInTheirFilmTexture() {
        // The texture changes nothing about the cube, which is exactly why the
        // key has to read it: a cache keyed on the cube alone serves the
        // pre-film picture, and the grain slider looks dead on a still.
        let base = grade([layer()], film: nil)
        var texture = defaultFilmTexture
        texture.grain = 0.4
        let grainy = grade([layer()], film: texture)
        XCTAssertNotEqual(gradeKey(grainy), gradeKey(base))
        XCTAssertEqual(gradeKey(grainy), gradeKey(grade([layer()], film: texture)))
        var finer = defaultFilmTexture
        finer.grain = 0.41
        XCTAssertNotEqual(gradeKey(grade([layer()], film: finer)), gradeKey(grainy))
        // No texture and an absent one are the same picture, so the same key.
        XCTAssertEqual(gradeKey(base), gradeKey(SavedGrade(layers: [layer()], output: .none)))
    }

    func testKeepsAnOrderChangeApartAndNeverReadsACustomCubesText() {
        let a = layer { $0.id = "a" }
        let b = layer { l in
            l.id = "b"
            l.source = "custom"
            l.customText = "TITLE \"a\"\nLUT_3D_SIZE 2\n"
        }
        XCTAssertNotEqual(gradeKey(grade([a, b])), gradeKey(grade([b, a])))
        // The id IS the text's identity: an uploaded cube never changes under one.
        XCTAssertFalse(gradeKey(grade([b])).contains("LUT_3D_SIZE"))
    }

    func testFoldsAFilmLayersSettingsInItsTextChangesUnderOneId() {
        func film(_ text: String) -> SavedLutLayer {
            layer { l in
                l.id = "f"
                l.source = "film"
                l.customText = text
                l.intensity = 1
            }
        }
        let a = gradeKey(grade([film("{\"stock\":\"a\",\"response\":{\"dye\":0}}")]))
        let b = gradeKey(grade([film("{\"stock\":\"a\",\"response\":{\"dye\":5}}")]))
        XCTAssertNotEqual(a, b)
        XCTAssertTrue(a.contains("\"dye\":0"))
    }

    func testAnswersForNoGradeAtAll() {
        XCTAssertEqual(gradeKey(nil), "-")
        XCTAssertNotEqual(gradeKey(nil), gradeKey(grade([])))
    }

    /// Not in the web spec: the key spells a strength the way JavaScript's
    /// template literal does, so a key written on either client is one string.
    func testSpellsTheStrengthAsJavaScriptDoes() {
        XCTAssertEqual(gradeKey(grade([layer()])), "none|-|l1:builtin:dji-dlog-m:1:1")
        XCTAssertEqual(gradeKey(grade([layer { $0.intensity = 0.25 }])), "none|-|l1:builtin:dji-dlog-m:0.25:1")
    }
}

final class IsUploadedLookTests: XCTestCase {
    func testIsAnUploadedCubeNeverABuiltInAndNeverAFilmStock() {
        XCTAssertFalse(isUploadedLook(layer()))
        XCTAssertTrue(isUploadedLook(layer { $0.source = "custom"; $0.customText = "LUT_3D_SIZE 2" }))
        XCTAssertFalse(isUploadedLook(layer { $0.source = "film"; $0.customText = "{\"stock\":\"x\"}" }))
    }
}

final class GradeOrNullTests: XCTestCase {
    func testReadsASoundGradeBackAsItself() {
        let sound = grade([layer()], .rec709ToSrgb)
        // JSON.parse(JSON.stringify(grade)) — through the text, as a file would.
        let text = sound.json.serialized()
        XCTAssertEqual(gradeOrNull(JSONValue.parse(text)), SavedGrade(layers: [layer()], output: .rec709ToSrgb, film: nil))
    }

    func testKeepsAnEmptyGradeItIsARealDepartureNotJunk() {
        XCTAssertEqual(gradeOrNull(["layers": [], "output": "none"]), SavedGrade(layers: [], output: .none, film: nil))
    }

    func testIsNothingAtAllForAnythingThatIsNotAGrade() {
        let junk: [JSONValue?] = [nil, .null, 0, "none", [], ["output": "none"], ["layers": [:]]]
        for value in junk {
            XCTAssertNil(gradeOrNull(value), "\(String(describing: value))")
        }
    }

    func testDropsALayerWithNoIdentityAndClampsTheRestToSomethingBakeable() {
        let read = gradeOrNull([
            "layers": [["id": "l1"], ["source": "custom"], nil, ["id": "l2", "source": "custom"]],
            "output": "made-up",
        ])
        XCTAssertEqual(read?.layers.map(\.id), ["l2"])
        XCTAssertEqual(read?.layers.first, SavedLutLayer(id: "l2", source: "custom", name: "", customText: nil,
                                                         intensity: 1, enabled: true))
        // An unknown transform is not applied on a guess.
        XCTAssertEqual(read?.output, OutputTransform.none)
    }

    func testTakesALayerNobodySwitchedOffAsOnAndRefusesANaNStrength() {
        let read = gradeOrNull([
            "layers": [["id": "l1", "source": "custom", "intensity": .number(.nan)]],
            "output": "none",
        ])
        XCTAssertEqual(read?.layers.first?.enabled, true)
        XCTAssertEqual(read?.layers.first?.intensity, 1)
        let off = gradeOrNull(["layers": [["id": "l1", "source": "c", "enabled": false]], "output": "none"])
        XCTAssertEqual(off?.layers.first?.enabled, false)
    }
}

// MARK: - the resolver (no web twin: `restore-grade.ts` fetches)

private let tinyCube = """
TITLE "tiny"
LUT_3D_SIZE 2
0 0 0
1 0 0
0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
1 1 1
"""

private let dlog = CubeLut.make(size: 3) { r, g, b in (r * 0.9, g, b) }
private let packCube = CubeLut.make(size: 3) { r, g, b in (r, g * 0.8, b) }

private func noBuiltin(_ id: String) -> (lut: CubeLut, name: String)? { nil }
private func noPack(_ ref: PackRef) -> PackLookAnswer { .missing(reason: "not here", lookName: nil) }

final class RestoreLayersTests: XCTestCase {
    func testResolvesABuiltInByItsIdWithoutThePrefixAndNamesItFromTheLayerFirst() {
        var asked: [String] = []
        let restored = restoreLayers([layer(), layer { $0.id = "l2"; $0.name = "" }], builtin: { id in
            asked.append(id)
            return (dlog, "DJI D-Log M (manifest)")
        }, pack: noPack)
        XCTAssertEqual(asked, ["dji-dlog-m", "dji-dlog-m"])
        XCTAssertEqual(restored.layers.map(\.name), ["DJI D-Log M", "DJI D-Log M (manifest)"])
        XCTAssertEqual(restored.layers.first?.lut, dlog)
        XCTAssertEqual(restored.layers.first?.source, "builtin:dji-dlog-m")
        // A built-in carries no text.
        XCTAssertEqual(restored.customText, [:])
    }

    func testABuiltInThisBuildNoLongerHasDoesNotComeBack() {
        let restored = restoreLayers([layer(), layer { $0.id = "l2"; $0.source = "custom"; $0.customText = tinyCube }],
                                     builtin: noBuiltin, pack: noPack)
        XCTAssertEqual(restored.layers.map(\.id), ["l2"])
    }

    func testReadsAnInlinedCubeFromAnOldDocumentAndHandsItsTextBack() {
        let old = layer { l in
            l.id = "c1"
            l.source = "custom"
            l.name = "My upload"
            l.customText = tinyCube
            l.intensity = 0.6
            l.enabled = false
        }
        let restored = restoreLayers([old, layer { $0.id = "c2"; $0.source = "custom"; $0.customText = "not a cube" }],
                                     builtin: noBuiltin, pack: noPack)
        XCTAssertEqual(restored.layers.map(\.id), ["c1"])
        let back = restored.layers[0]
        XCTAssertEqual(back.name, "My upload")
        XCTAssertEqual(back.lut.size, 2)
        XCTAssertEqual(back.intensity, 0.6)
        XCTAssertFalse(back.enabled)
        XCTAssertEqual(restored.customText, ["c1": tinyCube])
    }

    func testGeneratesAFilmLayerFromItsSettingsAndDropsOneWhoseTextIsNotSettings() {
        let text = writeFilmSettings(filmSettingsFor(.negativePortrait))
        let film = layer { l in
            l.id = "f1"
            l.source = "film"
            l.name = "stale name"
            l.customText = text
        }
        let junk = layer { l in
            l.id = "f2"
            l.source = "film"
            l.customText = "{\"not\":\"film\"}"
        }
        let restored = restoreLayers([film, junk], builtin: noBuiltin, pack: noPack)
        XCTAssertEqual(restored.layers.map(\.id), ["f1"])
        XCTAssertEqual(restored.layers[0].name, describeFilm(filmSettingsFor(.negativePortrait)))
        XCTAssertEqual(restored.layers[0].lut, filmCubeFor(filmSettingsFor(.negativePortrait)))
        XCTAssertEqual(restored.customText, ["f1": text])
    }

    func testResolvesAPackLookAndNamesItLayerFirstThenTheVaultThenPackLook() {
        var asked: [PackRef] = []
        let answer: (PackRef) -> PackLookAnswer = { ref in
            asked.append(ref)
            return .lattice(packCube, lookName: ref.look == "one-click/dji/d-log" ? "D-Log" : nil)
        }
        let named = packLayer()
        let unnamed = packLayer { $0.id = "p2"; $0.name = "" }
        let bare = packLayer { l in
            l.id = "p3"
            l.name = ""
            l.customText = writePackRef(PackRef(pack: "pk_1", look: "creative/authentic", hash: ""))
        }
        let restored = restoreLayers([named, unnamed, bare], builtin: noBuiltin, pack: answer)
        XCTAssertEqual(asked.first, PackRef(pack: "pk_1", look: "one-click/dji/d-log", hash: "aa"))
        XCTAssertEqual(restored.layers.map(\.name), ["AUTHENTIC · One Click · DJI · D-Log", "D-Log", "Pack look"])
        XCTAssertTrue(restored.layers.allSatisfy { $0.missing == nil && $0.lut == packCube })
        XCTAssertEqual(restored.customText["p1"], named.customText)
    }

    func testKeepsAPackLookThisDeviceCannotResolveInItsPlaceAndSaysWhy() {
        let restored = restoreLayers(
            [layer { $0.id = "a" }, packLayer(), layer { $0.id = "c" }],
            builtin: { _ in (dlog, "x") },
            pack: { _ in .missing(reason: "Import the AUTHENTIC pack on this device.", lookName: "D-Log") }
        )
        XCTAssertEqual(restored.layers.map(\.id), ["a", "p1", "c"])
        let missing = restored.layers[1]
        XCTAssertEqual(missing.missing, "Import the AUTHENTIC pack on this device.")
        XCTAssertEqual(missing.lut, CubeLut.identity())
        // Skipped by the bake, never graded as identity silently.
        XCTAssertEqual(activeLayers(restored.layers).map(\.id), ["a", "c"])
    }

    func testDropsAPackLayerWhoseReferenceSaysNothing() {
        let restored = restoreLayers([packLayer { $0.customText = "{\"size\":33}" }, packLayer { $0.id = "p2"; $0.customText = nil }],
                                     builtin: noBuiltin, pack: { _ in .lattice(packCube, lookName: nil) })
        XCTAssertTrue(restored.layers.isEmpty)
        XCTAssertEqual(restored.customText, [:])
    }

    func testAStoredRollLookReadsAsTheSameStructuralGrade() {
        var texture = defaultFilmTexture
        texture.halation = 0.3
        let roll = RollGrade(layers: [layer()], output: .rec709ToSrgb, film: texture.json)
        let saved = SavedGrade(roll)
        XCTAssertEqual(saved, SavedGrade(layers: [layer()], output: .rec709ToSrgb, film: texture))
        XCTAssertEqual(gradeOrNull(saved.json), saved)
    }
}
