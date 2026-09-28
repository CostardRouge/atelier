// The web's `picture-geometry.test.ts`, ported one for one — the ORDER of the
// warps, the empty list when nothing is corrected, `hasGeometry` and
// `sameGeometry` — plus the family builder over a picture's STORED records:
// what a roll's picture contributes to the graph, and where.

import AtelierKit
import CoreImage
import XCTest
@testable import Atelier

final class PictureGeometryTests: XCTestCase {
    static let withLens = PictureGeometry(lens: LensCorrection(distortion: -30))
    static let withKeystone = PictureGeometry(keystone: Keystone(vertical: 40))
    static let both = PictureGeometry(lens: LensCorrection(distortion: -30), keystone: Keystone(vertical: 40))
    static let dji = DngWarp(planes: [DngWarpPlane(radial: [1.0493, 0, 0, 0], tangential: [0, 0])], centerH: 0.5, centerV: 0.5)
    static let profile = LensProfileTerms(distortion: [0.06, -0.25, 0.1, 0.03], tcaRed: [1.004, 0, 0.002],
                                          tcaBlue: [0.997, 0, -0.001], vignette: [-0.2, 0, 0])

    static func ids(_ passes: [RenderPass]) -> [String] {
        passes.map { $0.id }
    }

    // MARK: - geometryPasses

    func testRunsTheLensBeforeTheKeystone() {
        // The order is the decision this module exists to state once: a lens
        // un-bends the picture, and only then are there straight verticals for
        // a perspective correction to make parallel.
        XCTAssertEqual(Self.ids(geometryPasses(Self.both, aspectRatio: 1.5)), ["lens", "keystone"])
    }

    func testRunsTheCamerasOwnWarpFirstOfAll() {
        var g = Self.both
        g.cameraWarp = Self.dji
        XCTAssertEqual(Self.ids(geometryPasses(g, aspectRatio: 1.5)), ["camera-warp", "lens", "keystone"])
    }

    func testIsEmptyWhenNothingIsCorrectedSoACallerRunsOneFewerPass() {
        XCTAssertTrue(geometryPasses(nil, aspectRatio: 1).isEmpty)
        XCTAssertTrue(geometryPasses(PictureGeometry(), aspectRatio: 1).isEmpty)
        XCTAssertTrue(geometryPasses(PictureGeometry(lens: .default, keystone: .default), aspectRatio: 1).isEmpty)
        // A vignette MIDPOINT alone corrects nothing — it only says where a
        // lift would bite — so it must not cost a resample.
        XCTAssertTrue(geometryPasses(PictureGeometry(lens: LensCorrection(vignetteMidpoint: 20)), aspectRatio: 1).isEmpty)
        // An identity warp is no warp.
        let identity = DngWarp(planes: [DngWarpPlane(radial: [1, 0, 0, 0], tangential: [0, 0])], centerH: 0.5, centerV: 0.5)
        XCTAssertTrue(geometryPasses(PictureGeometry(cameraWarp: identity), aspectRatio: 1).isEmpty)
    }

    func testCarriesJustTheOneThatIsSet() {
        XCTAssertEqual(Self.ids(geometryPasses(Self.withLens, aspectRatio: 1)), ["lens"])
        XCTAssertEqual(Self.ids(geometryPasses(Self.withKeystone, aspectRatio: 1)), ["keystone"])
        XCTAssertEqual(Self.ids(geometryPasses(PictureGeometry(lensProfile: Self.profile), aspectRatio: 1)), ["lens"])
    }

    func testAFilesOwnWarpTakesTheMeasuredProfileOffButKeepsTheSliders() {
        // A file that states its own rectilinear warp has had its distortion
        // taken out: a profile on top would bend it back the other way.
        let profileOnly = PictureGeometry(cameraWarp: Self.dji, lensProfile: Self.profile)
        XCTAssertEqual(Self.ids(geometryPasses(profileOnly, aspectRatio: 1)), ["camera-warp"])
        var sliders = profileOnly
        sliders.lens = LensCorrection(chromaRed: 20)
        let passes = geometryPasses(sliders, aspectRatio: 1)
        XCTAssertEqual(Self.ids(passes), ["camera-warp", "lens"])
        XCTAssertEqual((passes.last as? LensPass)?.profile, noProfileTerms, "the profile rode along under the file's warp")
    }

    func testEveryPassNamesAKernelTheLibraryHolds() throws {
        // The web's "gives every pass real GLSL": here, a Metal function that loads.
        var g = Self.both
        g.cameraWarp = Self.dji
        for pass in geometryPasses(g, aspectRatio: 1) {
            let name: String
            switch pass {
            case is CameraWarpPass: name = CameraWarpPass.kernelName
            case is LensPass: name = LensPass.kernelName
            case is KeystonePass: name = KeystonePass.kernelName
            default: return XCTFail("an unknown pass \(pass.id)")
            }
            XCTAssertNoThrow(try Kernels.kernel(name), "\(pass.id): no kernel '\(name)'")
        }
    }

    // MARK: - hasGeometry, sameGeometry

    func testHasGeometrySaysWhetherTheGpuIsNeededForTheShape() {
        XCTAssertFalse(hasGeometry(nil))
        XCTAssertFalse(hasGeometry(PictureGeometry()))
        XCTAssertFalse(hasGeometry(PictureGeometry(lens: .default, keystone: .default)))
        XCTAssertTrue(hasGeometry(Self.withLens))
        XCTAssertTrue(hasGeometry(Self.withKeystone))
        XCTAssertTrue(hasGeometry(PictureGeometry(cameraWarp: Self.dji)))
        XCTAssertTrue(hasGeometry(PictureGeometry(lensProfile: Self.profile)))
    }

    func testSameGeometryComparesByValue() {
        XCTAssertTrue(sameGeometry(nil, PictureGeometry()))
        XCTAssertTrue(sameGeometry(Self.both, PictureGeometry(lens: Self.both.lens, keystone: Self.both.keystone)))
        XCTAssertFalse(sameGeometry(Self.both, Self.withLens))
        XCTAssertFalse(sameGeometry(Self.withLens, Self.withKeystone))
        // A neutral record and none are the same picture.
        XCTAssertTrue(sameGeometry(PictureGeometry(lens: .default), PictureGeometry()))
        var drafted = Self.both
        drafted.lens?.distortion = -31
        XCTAssertFalse(sameGeometry(Self.both, drafted))
    }

    // MARK: - the family, from a picture's stored records

    static func picture(_ carried: [String: JSONValue], aspect: String = "original", framing: Framing? = nil) -> RollPicture {
        RollPicture(id: "p1", ref: SavedMediaRef(name: "DJI_0101.DNG", size: 1, lastModified: 0),
                    framing: framing, aspect: aspect, carried: carried)
    }

    static let profileRecord: JSONValue = .object([
        "lens": .string("DJI FC8482"),
        "camera": .string("DJI FC8482"),
        "focal": .number(6.7),
        "aperture": .number(1.7),
        "terms": .object([
            "distortion": .array([.number(0.06), .number(-0.25), .number(0.1), .number(0.03)]),
            "tcaRed": .array([.number(1), .number(0), .number(0)]),
            "tcaBlue": .array([.number(1), .number(0), .number(0)]),
            "vignette": .array([.number(0), .number(0), .number(0)]),
        ]),
        "has": .object(["distortion": .bool(true), "tca": .bool(false), "vignette": .bool(false)]),
        "onRender": .bool(false),
    ])

    func testAnUntouchedPictureContributesNothing() {
        let family = GeometryFamilyPasses(picture: Self.picture([:]), sourceWidth: 6000, sourceHeight: 4000)
        XCTAssertTrue(family.source.isEmpty)
        XCTAssertTrue(family.shape.isEmpty)
        XCTAssertTrue(family.finish.isEmpty)
        XCTAssertTrue(family.looking.isEmpty)
    }

    func testTheFamilyReadsEveryStoredRecordAndPutsEachWhereTheWebDoes() throws {
        let carried: [String: JSONValue] = [
            "keystone": .object(["vertical": .number(30)]),
            "lens": .object(["chromaRed": .number(15)]),
            "vignette": .object(["amount": .number(-40)]),
        ]
        let maps = [DngGainMap(rect: DngRect(top: 0, left: 0, bottom: 4000, right: 6000), plane: 0, planes: 3,
                               rows: 2, cols: 2, originV: 0, originH: 0, spacingV: 1, spacingH: 1, mapPlanes: 1,
                               gains: [2, 1, 1, 1])]
        let calibration = CalibrationAt(gain: gainFieldFrom(maps, 6000, 4000), warp: Self.dji)
        let family = GeometryFamilyPasses(picture: Self.picture(carried, aspect: "4:5"), sourceWidth: 6000, sourceHeight: 4000,
                                          calibration: calibration, onSensor: true)
        // The camera's shading FIRST of all, on the source; the warps first
        // after the cube; the vignette on the finished picture.
        XCTAssertEqual(Self.ids(family.source), ["gain-map"])
        XCTAssertEqual(Self.ids(family.shape), ["camera-warp", "lens", "keystone"])
        XCTAssertEqual(Self.ids(family.finish), ["post-vignette"])
        XCTAssertTrue(family.looking.isEmpty, "the clipping view is the stage's to ask for")
        // The warps run at SOURCE density: the keystone is conjugated by the
        // source's aspect, never the crop's.
        let keystone = try XCTUnwrap(family.shape.last as? KeystonePass)
        XCTAssertEqual(keystone.sample, keystoneSampleMatrix(Keystone(vertical: 30), 1.5))
        // The vignette is shaped in the DELIVERED frame: the 4:5 crop's.
        let vignette = try XCTUnwrap(family.finish.first as? PostVignettePass)
        XCTAssertEqual(vignette.frameAspect, 0.8, accuracy: 1e-12)
        XCTAssertEqual(vignette.affine, frameAffine(6000, 4000, 0.8, nil))
        // And the stage's switch adds the one way of LOOKING.
        let looking = GeometryFamilyPasses(picture: Self.picture(carried), sourceWidth: 6000, sourceHeight: 4000, clipping: true)
        XCTAssertEqual(Self.ids(looking.looking), ["clipping"])
    }

    func testAMeasuredProfileAppliesByItselfOnTheSensorOnly() throws {
        // Lensfun measures RAW data; a camera's own render is often corrected
        // in the body, and correcting it again bends it the other way.
        let picture = Self.picture(["lensProfile": Self.profileRecord])
        let render = GeometryFamilyPasses(picture: picture, sourceWidth: 6000, sourceHeight: 4000, onSensor: false)
        XCTAssertTrue(render.shape.isEmpty, "a profile applied itself to a camera render")
        let sensor = GeometryFamilyPasses(picture: picture, sourceWidth: 6000, sourceHeight: 4000, onSensor: true)
        let lens = try XCTUnwrap(sensor.shape.first as? LensPass)
        XCTAssertEqual(lens.profile.distortion, [0.06, -0.25, 0.1, 0.03])
        XCTAssertEqual(lens.lens, LensCorrection.default, "a profile alone brings no slider")
        // Taken off by the author (null) or never decided (absent): nothing.
        let off = GeometryFamilyPasses(picture: Self.picture(["lensProfile": .null]), sourceWidth: 6000, sourceHeight: 4000, onSensor: true)
        XCTAssertTrue(off.shape.isEmpty)
    }

    func testGeometryFromStoredRecordsClampsAsTheWebReadersDo() {
        let picture = Self.picture([
            "keystone": .object(["vertical": .number(400), "rotation": .string("junk")]),
            "lens": .object(["distortion": .number(-250)]),
        ])
        let g = PictureGeometry(picture: picture, onSensor: false)
        XCTAssertEqual(g.keystone, Keystone(vertical: 100))
        XCTAssertEqual(g.lens, LensCorrection(distortion: -100))
        XCTAssertNil(g.cameraWarp, "no calibration, no camera warp")
        XCTAssertNil(g.lensProfile)
    }
}
