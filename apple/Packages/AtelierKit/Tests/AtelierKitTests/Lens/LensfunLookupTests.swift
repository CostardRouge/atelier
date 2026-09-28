// The observable rules of `src/shared/lens/lensfun-store.ts` (which has no web
// spec of its own): the crop a picture was exposed at, the profile a found lens
// gives one picture, the ORDER a lookup asks its questions in and what it
// keeps, and the kept record's round trip.

import Foundation
import XCTest
@testable import AtelierKit

/// A trimmed `mil-sony.xml`: one body, one of Sony's lenses.
private let sonyXml = """
<lensdatabase version="2">
    <camera>
        <maker>Sony</maker>
        <model>ILCE-7CM2</model>
        <mount>Sony E</mount>
        <cropfactor>1</cropfactor>
    </camera>
    <lens>
        <maker>Sony</maker>
        <model>FE 24-70mm f/4 ZA OSS</model>
        <mount>Sony E</mount>
        <cropfactor>1</cropfactor>
        <calibration>
            <distortion model="ptlens" focal="24" a="0.02797" b="-0.09138" c="0.04487"/>
            <distortion model="ptlens" focal="70" a="0.01335" b="-0.01629" c="0.02605"/>
            <vignetting model="pa" focal="24" aperture="4" distance="1000" k1="-0.4905" k2="0.1735" k3="-0.1133"/>
        </calibration>
    </lens>
    <lens>
        <maker>Sony</maker>
        <model>FE 50mm f/1.8</model>
        <mount>Sony E</mount>
        <cropfactor>1</cropfactor>
    </lens>
</lensdatabase>
"""

/// A trimmed `mil-sigma.xml`: an independent maker's lens for the same mount.
private let sigmaXml = """
<lensdatabase version="2">
    <lens>
        <maker>Sigma</maker>
        <model>35mm f/1.4 DG DN | A</model>
        <mount>Sony E</mount>
        <cropfactor>1</cropfactor>
        <calibration>
            <distortion model="poly3" focal="35" k1="-0.012"/>
        </calibration>
    </lens>
</lensdatabase>
"""

private let sonyDb = parseLensfunXml(sonyXml)
private let sigmaDb = parseLensfunXml(sigmaXml)
private let a7c2 = sonyDb.cameras[0]
private let fe2470 = sonyDb.lenses[0]

private let shot2470 = ShotLens(make: "SONY", model: "ILCE-7CM2", lensModel: "FE 24-70mm F4 ZA OSS",
                                focalLength: 24, focalLength35: 24, fNumber: 4)

/// A device with nothing kept, the network answering from `files`, and a
/// ledger of what was asked and kept.
private final class FakeDevice {
    var kept: [String: LensMatchRecord] = [:]
    var files: [String: LensfunDb] = [:]
    var asked: [String] = []
    var written: [LensMatchRecord] = []

    func look(_ shot: ShotLens, now: Double = 1_000_000, allowed: Bool = true) async -> LensLookUp {
        await lookUpLens(shot, now: now, allowed: allowed,
                         readMatch: { self.kept[$0] },
                         writeMatch: { record in
                             self.written.append(record)
                             self.kept[record.id] = record
                         },
                         fileDb: { file in
                             self.asked.append(file)
                             return self.files[file]
                         })
    }
}

final class LensfunLookupTests: XCTestCase {
    // MARK: - the crop a picture was exposed at

    func testTheBodysCropUnlessThe35mmEquivalentSaysACropMode() {
        let body = LensfunCamera(maker: "Sony", models: ["ILCE-7CM2"], mount: "Sony E", crop: 1)
        XCTAssertEqual(lensImageCrop(body, ShotLens(focalLength: 50, focalLength35: 50)), 1)
        // A full-frame body in its APS-C mode.
        assertClose(lensImageCrop(body, ShotLens(focalLength: 50, focalLength35: 75)), 1.5)
        // Nothing said, or something absurd, is the body's own.
        XCTAssertEqual(lensImageCrop(body, ShotLens(focalLength: 50)), 1)
        XCTAssertEqual(lensImageCrop(body, ShotLens(focalLength: 10, focalLength35: 400)), 1)
        XCTAssertEqual(lensImageCrop(body, ShotLens(focalLength: 50, focalLength35: 52)), 1)
    }

    // MARK: - the profile one picture gets

    func testAFoundLensGivesThisPictureItsTermsAndNames() throws {
        let p = try XCTUnwrap(lensProfileFor(a7c2, fe2470, shot2470))
        XCTAssertEqual(p.lens, "Sony FE 24-70mm f/4 ZA OSS")
        XCTAssertEqual(p.camera, "Sony ILCE-7CM2")
        XCTAssertEqual(p.focal, 24)
        XCTAssertEqual(p.aperture, 4)
        XCTAssertEqual(p.has, LensProfileHas(distortion: true, tca: false, vignette: true))
        XCTAssertFalse(p.onRender)
        let direct = profileTerms(fe2470, LensShot(focal: 24, aperture: 4, imageCrop: 1))
        XCTAssertEqual(p.terms, direct.terms)
        XCTAssertTrue(try XCTUnwrap(lensProfileFor(a7c2, fe2470, shot2470, onRender: true)).onRender)
    }

    func testNoFocalNoApertureAndNothingMeasured() {
        var noFocal = shot2470
        noFocal.focalLength = nil
        XCTAssertNil(lensProfileFor(a7c2, fe2470, noFocal))
        var noAperture = shot2470
        noAperture.fNumber = 0
        let p = lensProfileFor(a7c2, fe2470, noAperture)
        XCTAssertNil(p?.aperture)
        // Without an aperture the vignetting cannot be read.
        XCTAssertEqual(p?.has.vignette, false)
        // A lens the database knows but never calibrated gives nothing.
        XCTAssertNil(lensProfileFor(a7c2, sonyDb.lenses[1], ShotLens(make: "SONY", model: "ILCE-7CM2", focalLength: 50)))
    }

    // MARK: - the lookup

    func testAPictureThatSaysNothingAsksNothing() async {
        let device = FakeDevice()
        let answer = await device.look(ShotLens(make: "SONY", model: "ILCE-7CM2"))
        XCTAssertEqual(answer, .missing(.noExif))
        XCTAssertEqual(device.asked, [])
    }

    func testWithoutConsentNothingIsFetched() async {
        let device = FakeDevice()
        device.files["mil-sony.xml"] = sonyDb
        let answer = await device.look(shot2470, allowed: false)
        XCTAssertEqual(answer, .notAllowed)
        XCTAssertEqual(device.asked, [])
        XCTAssertEqual(device.written, [])
    }

    func testTheMakersFileAloneAnswersAndTheAnswerIsKept() async {
        let device = FakeDevice()
        device.files["mil-sony.xml"] = sonyDb
        let answer = await device.look(shot2470)
        XCTAssertEqual(answer, .found(camera: a7c2, lens: fe2470))
        XCTAssertEqual(device.asked, ["mil-sony.xml"])
        XCTAssertEqual(device.written.count, 1)
        XCTAssertEqual(device.written[0].id, lensKey("SONY", "ILCE-7CM2", "FE 24-70mm F4 ZA OSS"))
        XCTAssertEqual(device.written[0].lens, fe2470)
        // The second picture from that lens — any focal length, no consent — asks nothing.
        device.asked = []
        var at70 = shot2470
        at70.focalLength = 70
        let again = await device.look(at70, allowed: false)
        XCTAssertEqual(again, .found(camera: a7c2, lens: fe2470))
        XCTAssertEqual(device.asked, [])
    }

    func testALensNotInTheMakersFileIsLookedForAmongTheIndependentsForThatBody() async {
        let device = FakeDevice()
        device.files["mil-sony.xml"] = sonyDb
        device.files["mil-sigma.xml"] = sigmaDb
        let sigma = ShotLens(make: "SONY", model: "ILCE-7CM2", lensModel: "35mm F1.4 DG DN | A", focalLength: 35, fNumber: 2)
        let answer = await device.look(sigma)
        guard case .found(let camera, let lens) = answer else { return XCTFail("not found: \(answer)") }
        XCTAssertEqual(camera, a7c2)
        XCTAssertEqual(lens.maker, "Sigma")
        // The maker's file, then the mirrorless independents in their order, stopping at the answer.
        XCTAssertEqual(device.asked, ["mil-sony.xml", "mil-sigma.xml"])
    }

    func testALensNowhereIsKeptAsMissingAndBelievedForAMonth() async {
        let device = FakeDevice()
        device.files["mil-sony.xml"] = sonyDb
        let odd = ShotLens(make: "SONY", model: "ILCE-7CM2", lensModel: "Laowa 9mm f/5.6", focalLength: 9)
        let answer = await device.look(odd, now: 0)
        XCTAssertEqual(answer, .missing(.lens))
        XCTAssertEqual(device.asked.first, "mil-sony.xml")
        XCTAssertEqual(device.asked.count, 1 + lensFiles("mil-sony.xml").count)
        XCTAssertEqual(device.written.last?.camera, a7c2)
        XCTAssertNil(device.written.last?.lens)
        // Within the month: believed, not asked.
        device.asked = []
        let soon = await device.look(odd, now: lensMissTtlMs - 1)
        XCTAssertEqual(soon, .missing(.lens))
        XCTAssertEqual(device.asked, [])
        // After it: asked again.
        _ = await device.look(odd, now: lensMissTtlMs + 1)
        XCTAssertEqual(device.asked.first, "mil-sony.xml")
    }

    func testANetworkThatAnswersNothingIsOfflineAndKeepsNothing() async {
        let device = FakeDevice()
        let answer = await device.look(shot2470)
        XCTAssertEqual(answer, .offline)
        XCTAssertEqual(device.asked, cameraFiles("sony"))
        XCTAssertEqual(device.written, [])
    }

    func testABodyLensfunDoesNotKnowIsMissingAndKept() async {
        let device = FakeDevice()
        device.files["mil-sony.xml"] = sonyDb
        device.files["slr-sony.xml"] = LensfunDb()
        device.files["compact-sony.xml"] = LensfunDb()
        let answer = await device.look(ShotLens(make: "SONY", model: "ILCE-9", focalLength: 24))
        XCTAssertEqual(answer, .missing(.camera))
        XCTAssertNil(device.written.last?.camera)
        // A maker Lensfun has no file for: nothing to fetch, and said so.
        let unknown = FakeDevice()
        let none = await unknown.look(ShotLens(make: "Zorki", model: "4K", focalLength: 50))
        XCTAssertEqual(none, .missing(.camera))
        XCTAssertEqual(unknown.asked, [])
        XCTAssertEqual(unknown.written.count, 1)
    }

    // MARK: - what the device keeps

    func testTheKeptRecordReadsBackAsWritten() {
        let record = LensMatchRecord(id: "sony|ilce7cm2|fe2470mmf4zaoss", camera: a7c2, lens: fe2470, at: 1234)
        let text = record.json.serialized()
        XCTAssertEqual(readLensMatchRecord(JSONValue.parse(text)), record)
        let miss = LensMatchRecord(id: "x", camera: nil, lens: nil, at: 5)
        XCTAssertEqual(readLensMatchRecord(JSONValue.parse(miss.json.serialized())), miss)
        XCTAssertNil(readLensMatchRecord(.string("junk")))
    }

    func testAShotIsReadFromTheRecordThatNamesACamera() {
        var exif = ExifData()
        XCTAssertNil(ShotLens(exif: exif))
        exif.make = "SONY"
        exif.model = "ILCE-7CM2"
        exif.lensModel = "FE 24-70mm F4 ZA OSS"
        exif.focalLength = 24
        exif.fNumber = 4
        let shot = ShotLens(exif: exif)
        XCTAssertEqual(shot?.focalLength, 24)
        XCTAssertEqual(shot?.key, "\(lensKey("SONY", "ILCE-7CM2", "FE 24-70mm F4 ZA OSS"))|24.0|4.0")
    }
}
