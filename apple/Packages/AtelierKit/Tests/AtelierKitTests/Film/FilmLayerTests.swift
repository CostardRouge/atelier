// Port of `src/shared/film/film-layer.test.ts`. Where the web pins "the very
// same object" (`toBe`) out of the cache, a Swift `CubeLut` is a value and the
// spec pins the same VALUE (the `LutStackTests` rule).

import XCTest
@testable import AtelierKit

private func saved(_ change: (inout SavedLutLayer) -> Void = { _ in }) -> SavedLutLayer {
    var s = SavedLutLayer(
        id: "f1", source: filmSource, name: "whatever",
        customText: writeFilmSettings(filmSettingsFor(.negativePortrait)),
        intensity: 0.8, enabled: true
    )
    change(&s)
    return s
}

final class FilmCubeCacheTests: XCTestCase {
    override func setUp() {
        super.setUp()
        clearFilmCubeCache()
    }

    func testGeneratesOncePerDistinctSettingsAndHandsTheSameCubeBack() {
        var a = filmSettingsFor(.reversalVivid)
        let first = filmCubeFor(a)
        XCTAssertEqual(filmCubeFor(filmSettingsFor(.reversalVivid)), first)
        a.response.dye = 40
        XCTAssertNotEqual(filmCubeFor(a), first)
    }

    func testNamesTheCubeAfterWhereTheSettingsStand() {
        var s = filmSettingsFor(.reversalNeutral)
        XCTAssertEqual(filmCubeFor(s).title, "Reversal · neutral")
        s.response.coupling = 50
        XCTAssertEqual(filmCubeFor(s).title, "Reversal · neutral · adjusted")
    }
}

final class FilmLayerFromSavedTests: XCTestCase {
    override func setUp() {
        super.setUp()
        clearFilmCubeCache()
    }

    func testRebuildsAStoredFilmLayerWithItsStrengthAndSwitchNamedFromItsSettings() {
        let layer = filmLayerFromSaved(saved { $0.enabled = false })
        XCTAssertNotNil(layer)
        XCTAssertEqual(layer?.id, "f1")
        XCTAssertEqual(layer?.source, filmSource)
        XCTAssertEqual(layer?.name, "Negative · portrait")
        XCTAssertEqual(layer?.intensity, 0.8)
        XCTAssertEqual(layer?.enabled, false)
        XCTAssertEqual(layer?.lut.size, 33)
    }

    func testIsNothingForALayerThatIsNotFilmOrWhoseTextIsNotSettings() {
        XCTAssertNil(filmLayerFromSaved(saved { $0.source = "custom" }))
        XCTAssertNil(filmLayerFromSaved(saved { $0.customText = nil }))
        XCTAssertNil(filmLayerFromSaved(saved { $0.customText = "LUT_3D_SIZE 2" }))
    }

    func testReadsADepartedStockBackAsDeparted() {
        var s = filmSettingsFor(.crossProcess)
        s.response.dye = 0
        XCTAssertEqual(filmLayerFromSaved(saved { $0.customText = writeFilmSettings(s) })?.name, "Cross-process · adjusted")
    }
}

final class FilmNewLayerTests: XCTestCase {
    override func setUp() {
        super.setUp()
        clearFilmCubeCache()
    }

    func testSeedsAFullStrengthEnabledLayerAndTheTextThatRestoresIt() {
        let (layer, text) = newFilmLayer("n1", .monoPanchromatic)
        XCTAssertEqual(layer.id, "n1")
        XCTAssertEqual(layer.source, filmSource)
        XCTAssertEqual(layer.intensity, 1)
        XCTAssertTrue(layer.enabled)
        XCTAssertTrue(isFilmLayer(layer))
        let stored = SavedLutLayer(id: layer.id, source: layer.source, name: layer.name, customText: text,
                                   intensity: layer.intensity, enabled: layer.enabled)
        XCTAssertEqual(filmLayerFromSaved(stored)?.name, layer.name)
    }

    func testKeepsTheLayerIdentityStrengthAndSwitchWhileSwappingTheNumbers() {
        let (layer, _) = newFilmLayer("n1", .reversalVivid)
        var dimmed = layer
        dimmed.intensity = 0.4
        dimmed.enabled = false
        let next = filmSettingsFor(.negativeConsumer)
        let (swapped, text) = withFilmSettings(dimmed, next)
        XCTAssertEqual(swapped.id, "n1")
        XCTAssertEqual(swapped.intensity, 0.4)
        XCTAssertFalse(swapped.enabled)
        XCTAssertEqual(swapped.name, "Negative · consumer")
        XCTAssertNotEqual(swapped.lut, layer.lut)
        XCTAssertEqual(text, writeFilmSettings(next))
    }
}
