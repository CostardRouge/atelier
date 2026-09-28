// Port of `src/shared/lens/lensfun.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

/// Real entries from Lensfun's `mil-sony.xml` (CC BY-SA 3.0), trimmed.
private let xml = """
<!DOCTYPE lensdatabase SYSTEM "lensfun-database.dtd">
<lensdatabase version="2">
    <mount><name>Sony E</name></mount>
    <camera>
        <maker>Sony</maker>
        <model>ILCE-7CM2</model>
        <model lang="en">Alpha 7C II</model>
        <mount>Sony E</mount>
        <cropfactor>1</cropfactor>
    </camera>
    <camera>
        <maker>Sony</maker>
        <model>ILCE-6000</model>
        <mount>Sony E</mount>
        <cropfactor>1.534</cropfactor>
    </camera>
    <lens>
        <maker>Sony</maker>
        <model>FE 24-70mm f/4 ZA OSS</model>
        <mount>Sony E</mount>
        <cropfactor>1.534</cropfactor>
        <calibration>
            <!-- Taken with Sony A6000 -->
            <distortion model="ptlens" focal="24" a="0.01086" b="-0.05129" c="0.0454"/>
        </calibration>
    </lens>
    <lens>
        <maker>Sony</maker>
        <model>FE 24-70mm f/4 ZA OSS</model>
        <mount>Sony E</mount>
        <cropfactor>1</cropfactor>
        <calibration>
            <!-- Taken with Sony A7II -->
            <!--distortion model="ptlens" focal="24" a="9" b="9" c="9"/-->
            <distortion model="ptlens" focal="24" a="0.02797" b="-0.09138" c="0.04487"/>
            <distortion model="ptlens" focal="33" a="0.01741" b="-0.03649" c="0.02297"/>
            <distortion model="ptlens" focal="50" a="0.01325" b="-0.0102" c="0.0103"/>
            <distortion model="ptlens" focal="70" a="0.01335" b="-0.01629" c="0.02605"/>
            <tca model="poly3" focal="24" br="0.0001620" vr="1.0002925" bb="-0.0000592" vb="1.0000445"/>
            <tca model="poly3" focal="33" br="-0.0000376" vr="1.0003144" bb="0.0000309" vb="1.0000261"/>
            <vignetting model="pa" focal="24" aperture="4" distance="1000" k1="-0.4905" k2="0.1735" k3="-0.1133"/>
            <vignetting model="pa" focal="24" aperture="8" distance="1000" k1="-0.2046" k2="-0.0395" k3="0.0226"/>
        </calibration>
    </lens>
    <lens>
        <maker>Sony</maker>
        <model>FE 24-70mm f/2.8 GM II</model>
        <mount>Sony E</mount>
        <cropfactor>1</cropfactor>
        <calibration><distortion model="poly3" focal="24" k1="-0.012"/></calibration>
    </lens>
    <lens>
        <maker>Sony</maker>
        <model>FE 12-24mm f/4 G</model>
        <mount>Sony E</mount>
        <cropfactor>1</cropfactor>
        <type>fisheye</type>
    </lens>
</lensdatabase>
"""

private let db = parseLensfunXml(xml)
private let a7c2 = findCamera([db], "SONY", "ILCE-7CM2")!
private let fe2470 = db.lenses[1]

/// Lensfun's own correction of ONE pixel, transcribed from modifier.cpp and
/// mod-coord.cpp (ptlens, Reverse = false): pixel → normalised by NormScale →
/// the rescaled polynomial → back to pixels. Independent of `profileTerms`, so
/// the two agreeing is the conversion being right.
private func lensfunSource(_ px: Double, _ py: Double, _ W: Double, _ H: Double, _ crop: Double,
                           _ lens: LensfunLens, _ focal: Double) -> (Double, Double) {
    let width = W - 1
    let height = H - 1
    let norm = hypot(36, 24) / crop / hypot(width + 1, height + 1) / focal
    let cx = (width / 2) * norm
    let cy = (height / 2) * norm
    let d = interpolateDistortion(lens, focal)!
    let a = d.terms[0]
    let b = d.terms[1]
    let c = d.terms[2]
    let huginMm = hypot(36, 24) / lens.crop / hypot(lens.aspect, 1) / 2
    let hs = focal / huginMm
    let dd = 1 - a - b - c
    let a_ = (a * pow(hs, 3)) / pow(dd, 4)
    let b_ = (b * pow(hs, 2)) / pow(dd, 3)
    let c_ = (c * hs) / pow(dd, 2)
    let x = px * norm - cx
    let y = py * norm - cy
    let ru = hypot(x, y)
    let poly = a_ * pow(ru, 3) + b_ * pow(ru, 2) + c_ * ru + 1
    return ((x * poly + cx) / norm, (y * poly + cy) / norm)
}

final class LensfunReadingTests: XCTestCase {
    func testReadsCamerasLensesAndTheirCalibrationsAndIgnoresWhatIsCommentedOut() {
        XCTAssertEqual(db.cameras.count, 2)
        XCTAssertEqual(a7c2.maker, "Sony")
        XCTAssertEqual(a7c2.mount, "Sony E")
        XCTAssertEqual(a7c2.crop, 1)
        XCTAssertEqual(a7c2.models, ["ILCE-7CM2", "Alpha 7C II"])
        XCTAssertEqual(fe2470.distortion.map { $0.focal }, [24, 33, 50, 70])
        XCTAssertEqual(fe2470.distortion[0].terms, [0.02797, -0.09138, 0.04487])
        XCTAssertEqual(fe2470.tca[0].terms, [1.0002925, 1.0000445, 0, 0, 0.000162, -0.0000592])
        XCTAssertEqual(fe2470.vignetting.count, 2)
        XCTAssertEqual(fe2470.aspect, 1.5)
    }
}

final class LensfunFindingTests: XCTestCase {
    func testFindsABodyByItsExifMakeAndModelWhateverTheMakersCase() {
        XCTAssertEqual(findCamera([db], "SONY", "ILCE-7CM2")?.crop, 1)
        XCTAssertEqual(findCamera([db], "Sony", "ILCE-6000")?.crop, 1.534)
        XCTAssertNil(findCamera([db], "Canon", "ILCE-7CM2"))
    }

    func testMatchesALensNameAsSonyWritesItAgainstLensfunsAndNeverADifferentFocalRange() {
        XCTAssertEqual(lensNameScore("FE 24-70mm F2.8 GM II", "FE 24-70mm f/2.8 GM II"), 1)
        XCTAssertEqual(lensNameScore("FE 24-70mm F2.8 GM II", "FE 24-70mm f/4 ZA OSS"), 0)
        XCTAssertEqual(lensNameScore("FE 24-105mm F4 G OSS", "FE 24-70mm f/4 ZA OSS"), 0)
        XCTAssertEqual(findLens([db], a7c2, "FE 24-70mm F2.8 GM II")?.lens.models[0], "FE 24-70mm f/2.8 GM II")
    }

    func testTakesTheCalibrationMadeOnTheSensorClosestFromAboveNeverASmallerOne() {
        // On a full-frame body the A6000 calibration (crop 1.534) says nothing about the corners.
        XCTAssertEqual(findLens([db], a7c2, "FE 24-70mm F4 ZA OSS")?.lens.crop, 1)
        let a6000 = findCamera([db], "SONY", "ILCE-6000")!
        XCTAssertEqual(findLens([db], a6000, "FE 24-70mm F4 ZA OSS")?.lens.crop, 1.534)
    }

    func testRefusesAFisheyeAChangeOfProjectionNotARadius() {
        XCTAssertNil(findLens([db], a7c2, "FE 12-24mm F4 G"))
    }
}

final class LensfunInterpolatingTests: XCTestCase {
    func testTakesAnExactFocalAsItIsAndSplinesBetweenTheOthersOnTermTimesFocal() {
        XCTAssertEqual(interpolateDistortion(fe2470, 33)?.terms, [0.01741, -0.03649, 0.02297])
        let at40 = interpolateDistortion(fe2470, 40)!
        let t = (40.0 - 33) / (50 - 33)
        let b = Lensfun.hermite(-0.09138 * 24, -0.03649 * 33, -0.0102 * 50, -0.01629 * 70, t) / 40
        assertClose(at40.terms[1], b, 12)
        // Past the last entry it holds the nearest.
        XCTAssertEqual(interpolateDistortion(fe2470, 90)?.terms, [0.01335, -0.01629, 0.02605])
    }

    func testInterpolatesTcasScaleTermsAsTheyAreAndItsRadiusTermsTimesFocal() {
        let at28 = interpolateTca(fe2470, 28)!
        XCTAssertGreaterThan(at28.terms[0], 1.0002925)
        XCTAssertLessThan(at28.terms[0], 1.0003144)
    }

    func testWeighsVignettingByDistanceInFocalApertureAndDistanceAndTakesAnExactOneAsIs() {
        XCTAssertEqual(interpolateVignetting(fe2470, 24, 4), [-0.4905, 0.1735, -0.1133])
        let f56 = interpolateVignetting(fe2470, 24, 5.6)!
        XCTAssertGreaterThan(f56[0], -0.4905)
        XCTAssertLessThan(f56[0], -0.2046)
    }
}

final class LensfunIntoOurUnitsTests: XCTestCase {
    private let W = 6000.0
    private let H = 4000.0
    private var halfDiag: Double { hypot(W, H) / 2 }

    func testLandsEveryPointWhereLensfunsOwnModifierWouldOnTheFullFrame() {
        for focal in [24.0, 40, 70] {
            let terms = profileTerms(fe2470, LensShot(focal: focal, aperture: nil, imageCrop: 1)).terms
            for (px, py) in [(5999.0, 3999.0), (3000, 10), (100, 2000), (4500, 3000)] {
                let (lx, ly) = lensfunSource(px, py, W, H, 1, fe2470, focal)
                let cx = (W - 1) / 2
                let cy = (H - 1) / 2
                let r = hypot(px - cx, py - cy) / halfDiag
                let rs = profileSourceRadius(r, terms.distortion) * halfDiag
                let want = hypot(lx - cx, ly - cy)
                XCTAssertLessThan(abs(rs - want), 0.05, "focal \(focal) at (\(px), \(py))")
            }
        }
    }

    func testMovesACornerByWhatA24mmWideAngleBendsAndLeavesTheCentreAlone() {
        let terms = profileTerms(fe2470, LensShot(focal: 24, aperture: nil, imageCrop: 1)).terms
        XCTAssertEqual(profileSourceRadius(0, terms.distortion), 0)
        let corner = profileSourceRadius(1, terms.distortion)
        XCTAssertGreaterThan(abs(corner - 1), 0.005)
        XCTAssertLessThan(abs(corner - 1), 0.08)
    }

    func testScalesRedAndBlueByTheMeasuredAmountsAndLiftsACornerByTheMeasuredVignetting() {
        let (terms, has) = profileTerms(fe2470, LensShot(focal: 24, aperture: 4, imageCrop: 1))
        XCTAssertEqual(has, LensProfileHas(distortion: true, tca: true, vignette: true))
        // At the frame's corner: s = hypot(1.5, 1) = 1.803 Hugin units.
        let s = hypot(1.5, 1)
        assertClose(profileChannelRadius(1, terms.tcaRed), 1.0002925 + 0.000162 * s * s, 9)
        // pa's r = 1 IS the corner on a full-frame body: the gain undoes 1 + k1 + k2 + k3.
        assertClose(profileVignetteGain(1, terms.vignette), 1 / (1 - 0.4905 + 0.1735 - 0.1133), 9)
    }
}

/// Not in the web's spec — pins the scanner's twin-of-the-regex rules the
/// Lensfun files lean on: entities, `lang` variants after the plain name, the
/// first `<focal>` only, and JavaScript's `Number` on an attribute.
final class LensfunScannerTests: XCTestCase {
    func testReadsTheDatabasesShapeAsTheWebsExpressionsDo() {
        let db = parseLensfunXml("""
        <lensdatabase>
            <lens>
                <maker lang="de">Zeiß</maker>
                <maker>Carl Zeiss &amp; Co</maker>
                <model lang="en">Batis 25</model>
                <model>Batis 2/25</model>
                <mount>Sony E</mount>
                <mount>Sony E2</mount>
                <aspect-ratio>16:9</aspect-ratio>
                <focal value="25" />
                <focal min="10" max="20" />
                <calibration>
                    <distortion model="poly5" focal="25" k1="" k2="0x10"/>
                    <distortion model="poly3" focal="0" k1="1"/>
                    <tca model="linear" focal="25" kr="1.0002" kb="nope"/>
                    <vignetting model="pa" focal="25" aperture="" k1="-0.3" k2="0" k3="0"/>
                </calibration>
            </lens>
        </lensdatabase>
        """)
        let lens = db.lenses[0]
        XCTAssertEqual(lens.maker, "Carl Zeiss & Co")
        XCTAssertEqual(lens.models, ["Batis 2/25", "Batis 25"])
        XCTAssertEqual(lens.mounts, ["Sony E", "Sony E2"])
        assertClose(lens.aspect, 16.0 / 9, 12)
        XCTAssertEqual(lens.focalMin, 25)
        XCTAssertEqual(lens.focalMax, 25)
        // `Number("")` is 0 and `Number("0x10")` 16; a focal of 0 is no entry.
        XCTAssertEqual(lens.distortion, [DistortionEntry(model: .poly5, focal: 25, terms: [0, 16])])
        // An attribute that is not a number takes the model's own default.
        XCTAssertEqual(lens.tca.first?.terms, [1.0002, 1])
        // An aperture of `""` is 0, which no vignetting entry survives.
        XCTAssertEqual(lens.vignetting, [])
        XCTAssertEqual(lens.type, "rectilinear")
    }

    func testSquashesAndAliasesAMakerAsExifSpellsIt() {
        XCTAssertEqual(Lensfun.squash("NIKON CORPORATION"), "nikoncorporation")
        XCTAssertEqual(makerKey("NIKON CORPORATION"), "nikon")
        XCTAssertEqual(lensWords("FE 24-70mm F2.8 GM II"), ["fe", "24", "70", "mm", "f", "2.8", "gm", "ii"])
    }
}
