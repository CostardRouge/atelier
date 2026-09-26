// A spec of its own for `GradeEdits.swift` — the web keeps these verbs inside
// a React hook (`use-lut-stack.ts`) with no spec; these pin the rules its
// comments and `use-roll-grade.ts` state.

import XCTest
@testable import AtelierKit

private func builtin(_ id: String = "l1", intensity: Double = 1) -> SavedLutLayer {
    builtinLookLayer(id: id, builtinId: "classic-warm", name: "Warm", intensity: intensity)
}

final class GradeEditsLayerTests: XCTestCase {
    func testABuiltInStoresItsIdentityAndNoText() {
        let layer = builtin()
        XCTAssertEqual(layer.source, "builtin:classic-warm")
        XCTAssertEqual(layer.name, "Warm")
        XCTAssertNil(layer.customText)
        XCTAssertTrue(layer.enabled)
    }

    func testAStrengthIsClampedWhereTheLayerIsMade() {
        XCTAssertEqual(builtin(intensity: 7).intensity, maxLayerIntensity)
        XCTAssertEqual(builtin(intensity: -1).intensity, 0)
        XCTAssertEqual(builtin(intensity: .nan).intensity, 1)
        XCTAssertEqual(builtin(intensity: 0.6).intensity, 0.6)
    }

    func testAFilmStockStoresItsSettingsAndNamesItsStock() {
        let layer = filmLookLayer(id: "f1", stock: .reversalVivid)
        XCTAssertEqual(layer.source, filmSource)
        XCTAssertEqual(layer.name, filmStock(.reversalVivid)?.name)
        let settings = readFilmSettings(layer.customText)
        XCTAssertEqual(settings?.stock, FilmStockId.reversalVivid.rawValue)
        XCTAssertNotNil(filmLayerFromSaved(layer))
    }

    func testAPackLookStoresItsReferenceNeverALattice() {
        let ref = PackRef(pack: "pk_uploads", look: "teal", hash: "ab12")
        let layer = packLookLayer(id: "p1", ref: ref, name: "Teal")
        XCTAssertEqual(layer.source, packSource)
        XCTAssertEqual(readPackRef(layer.customText), ref)
        XCTAssertLessThan(layer.customText?.count ?? 0, 200)
        XCTAssertEqual(packLookLayer(id: "p2", ref: ref, name: "").name, "Pack look")
    }
}

final class GradeEditsStackTests: XCTestCase {
    func testANewLookAppliesAfterTheOthers() {
        let grade = RollGrade().adding(builtin("a")).adding(builtin("b"))
        XCTAssertEqual(grade.layers.map(\.id), ["a", "b"])
    }

    func testMovesOneSlotAndStaysPutAtAnEnd() {
        let grade = RollGrade(layers: [builtin("a"), builtin("b"), builtin("c")])
        XCTAssertEqual(grade.moving("c", -1).layers.map(\.id), ["a", "c", "b"])
        XCTAssertEqual(grade.moving("a", -1).layers.map(\.id), ["a", "b", "c"])
        XCTAssertEqual(grade.moving("zz", 1), grade)
    }

    func testRemovesSetsStrengthAndBypassesOneLayerOnly() {
        let grade = RollGrade(layers: [builtin("a"), builtin("b")])
        XCTAssertEqual(grade.removing("a").layers.map(\.id), ["b"])
        XCTAssertEqual(grade.settingIntensity("b", 0.4).layers.map(\.intensity), [1, 0.4])
        XCTAssertEqual(grade.settingEnabled("a", false).layers.map(\.enabled), [false, true])
    }

    func testAStockBringsItsTextureOnlyWhereTheLookHasNone() {
        let bare = RollGrade().addingFilm(filmLookLayer(id: "f1", stock: .negativePortrait), stock: .negativePortrait)
        XCTAssertEqual(filmTextureOrNull(bare.film), textureOf(FilmStockId.negativePortrait.rawValue))

        var dialled = defaultFilmTexture
        dialled.grain = 0.8
        let own = RollGrade().settingTexture(dialled)
            .addingFilm(filmLookLayer(id: "f2", stock: .crossProcess), stock: .crossProcess)
        XCTAssertEqual(filmTextureOrNull(own.film)?.grain, 0.8)
    }

    func testReDiallingAFilmLayerRenamesItAndLeavesAnyOtherLayerAlone() {
        let film = filmLookLayer(id: "f1", stock: .reversalNeutral)
        let grade = RollGrade(layers: [builtin("a"), film])
        var settings = filmSettingsFor(.reversalNeutral)
        settings.response.coupling = 77
        let next = grade.settingFilm("f1", settings).settingFilm("a", settings)
        XCTAssertTrue(next.layers[1].name.hasSuffix("· adjusted"))
        XCTAssertEqual(readFilmSettings(next.layers[1].customText)?.response.coupling, 77)
        XCTAssertEqual(next.layers[0], grade.layers[0])
    }

    func testTheTextureIsTheGradesAndNilTakesItOff() {
        let grade = RollGrade().settingTexture(defaultFilmTexture)
        XCTAssertNotNil(grade.film)
        XCTAssertNil(grade.settingTexture(nil).film)
    }
}

final class GradeEditsStoredTests: XCTestCase {
    func testNoLayerNoOutputNoTextureIsStoredAsNil() {
        XCTAssertNil(storedLook(RollGrade()))
        XCTAssertNil(storedLook(nil))
        XCTAssertNil(storedLook(RollGrade(layers: [], output: .none, film: .null)))
    }

    func testATextureAloneIsALook() {
        XCTAssertNotNil(storedLook(RollGrade().settingTexture(defaultFilmTexture)))
    }

    func testAnOutputTransformAloneIsALook() {
        XCTAssertNotNil(storedLook(RollGrade().settingOutput(.rec709ToSrgb)))
    }

    func testWhatIsStoredReadsBackAsItself() {
        let grade = RollGrade(layers: [builtin("a")], output: .rec709ToSrgb)
            .addingFilm(filmLookLayer(id: "f1", stock: .monoPanchromatic), stock: .monoPanchromatic)
        XCTAssertEqual(readRollGrade(grade.json), grade)
    }
}
