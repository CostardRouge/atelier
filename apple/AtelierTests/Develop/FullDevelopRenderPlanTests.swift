// The Develop tool's COMPLETE pixel path, held to the web's order: a picture
// carrying a develop, a film stock for its look, a keystone and a lens, an
// adjustment layer, detail, a repair patch, a post-crop vignette and grain is
// assembled by `FullDevelopRenderPlan` into ONE graph whose passes run in
// the order `use-develop-picture.ts` and `roll-render.ts` lay them —
//
//     repair → denoise → CUBE → lens → keystone → layer → presence → sharpen
//     → post-vignette → film
//
// — and the picture it draws is not the picture as shot, while the wipe's
// left half (`renderBefore`) IS the picture as shot, untouched. Around it:
// the budget's arithmetic, the crop, what the stage says it does not draw,
// the bundled built-ins and the vault's disk store.

import AtelierKit
import CoreImage
import XCTest
@testable import Atelier

final class FullDevelopRenderPlanTests: XCTestCase {
    private var scratch: URL!

    override func setUpWithError() throws {
        scratch = FileManager.default.temporaryDirectory.appendingPathComponent("develop-plan-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: scratch)
    }

    /// A plan over the bundle's built-ins and a vault in a scratch folder.
    private func plan() -> FullDevelopRenderPlan {
        let looks = DevelopLooks(folder: DevelopLooks.bundledFolder(), store: DiskPackStore(root: scratch))
        return FullDevelopRenderPlan(looks: looks, device: .roomy, context: CubePassTests.context)
    }

    private func decoded(_ fixture: CubePassTests.Gradient) -> DecodedPicture {
        DecodedPicture(image: fixture.image, properties: [:], isRaw: false)
    }

    private func bare() -> RollPicture {
        RollPicture(id: "p", ref: SavedMediaRef(name: "DJI_0101.JPG", size: 1, lastModified: 0))
    }

    /// Everything the web's order has a place for, on one picture.
    private func everything() -> RollPicture {
        var p = bare()
        var develop = DevelopSettings.default
        develop.exposure = 0.6
        develop.contrast = 25
        p.develop = develop
        // The look: a generated film stock, and its grain on the grade.
        let stock = newFilmLayer("stock", .reversalVivid)
        let saved = SavedLutLayer(id: "stock", source: filmSource, name: stock.layer.name, customText: stock.text)
        var grain = defaultFilmTexture
        grain.grain = 0.4
        grain.halation = 0
        p.grade = RollGrade(layers: [saved], output: .none, film: grain.json)
        // Geometry: the lens, then the keystone.
        let keystone: JSONValue = .object(["vertical": .number(30), "horizontal": .number(0), "rotation": .number(0),
                                           "aspect": .number(0), "scale": .number(1.1)])
        p.carried["keystone"] = keystone
        let lens: JSONValue = .object(["distortion": .number(-20), "distortion2": .number(0), "chromaRed": .number(0),
                                       "chromaBlue": .number(0), "vignette": .number(0), "vignetteMidpoint": .number(50)])
        p.carried["lens"] = lens
        // A layer: the left of the frame darkened.
        var local = DevelopSettings.default
        local.exposure = -1
        p.layers = [AdjustLayer(id: "a", mask: .linear(LinearMask.default), except: nil, develop: local,
                                opacity: 1, enabled: true)]
        // Detail: luminance noise before the cube; clarity and a sharpen after.
        var detail = DetailSettings.default
        detail.luminance = 30
        detail.sharpen = 40
        detail.clarity = 20
        p.carried["detail"] = detail.json
        // A repair patch, drawn first on the source.
        let patch = Patch(id: "r1", kind: .heal, x: 0.3, y: 0.4, radius: 0.05, feather: 0.5, dx: 0.1, dy: 0)
        p.carried["repair"] = .array([patch.json])
        // The post-crop vignette, after the sharpen.
        p.carried["vignette"] = .object(["amount": .number(-40), "midpoint": .number(50), "roundness": .number(0),
                                         "feather": .number(50), "highlights": .number(0)])
        return p
    }

    // MARK: - the order

    func testEveryPassRunsInTheWebsOrder() {
        let fixture = CubePassTests.gradient()
        let made = plan().assemble(everything(), decoded(fixture), .whole)
        let ids = made.grader.passes.map { $0.id }
        let want = ["repair", "denoise", "cube", "lens", "keystone", "layer:a", "presence-clarity", "sharpen",
                    "post-vignette", "film"]
        XCTAssertEqual(ids, want, "the web's order: \(want.joined(separator: " → "))")
        // The cube carries the develop AND the stock: neither is left out.
        XCTAssertNotNil(made.grader.cube)
        XCTAssertEqual(made.scale, 1, "a delivery draws the source whole")
    }

    func testThePictureAsShotRunsNothingTheAuthorDid() {
        let fixture = CubePassTests.gradient()
        let shot = asShotForCompare(everything())
        XCTAssertNil(shot.develop)
        XCTAssertNil(shot.grade)
        for key in ["keystone", "lens", "detail", "vignette", "repair", "layers"] {
            XCTAssertNil(shot.carried[key], "\(key) is the author's, not the capture's")
        }
        let made = plan().assemble(shot, decoded(fixture), .stage, asShot: true)
        XCTAssertEqual(made.grader.passes.map { $0.id }, [], "as shot: no pass at all")
        // A RAW base is a fact about the bytes: it stays, with its gain.
        var raw = bare()
        var onSensor = DevelopSettings.default
        onSensor.base = .gainMap
        onSensor.rawGain = 1.5
        onSensor.exposure = 1
        raw.develop = onSensor
        let kept = asShotForCompare(raw).develop
        XCTAssertEqual(kept?.base, .gainMap)
        XCTAssertEqual(kept?.rawGain, 1.5)
        XCTAssertEqual(kept?.exposure, 0)
    }

    // MARK: - the pixels

    func testTheDevelopedPictureIsNotThePictureAsShotAndTheBeforeIs() throws {
        let fixture = CubePassTests.gradient()
        let plan = self.plan()
        let picture = everything()
        let after = plan.render(picture: picture, decoded: decoded(fixture), budget: .whole)
        XCTAssertEqual(after.extent.width, CGFloat(fixture.width), "no crop: the delivered frame is the source's")
        XCTAssertEqual(after.extent.height, CGFloat(fixture.height))
        let got = CubePassTests.read(after, width: fixture.width, height: fixture.height)
        if !CubePassTests.hasMetal, got.allSatisfy({ $0.isNaN }) {
            throw XCTSkip("no Metal device here, and the software renderer drew nothing through the kernels")
        }
        var moved = 0
        for i in 0..<fixture.pixels.count {
            let (r, g, b) = fixture.pixels[i]
            let d0 = abs(Double(got[i * 4]) - r)
            let d1 = abs(Double(got[i * 4 + 1]) - g)
            let d2 = abs(Double(got[i * 4 + 2]) - b)
            XCTAssertFalse(d0.isNaN || d1.isNaN || d2.isNaN, "pixel \(i) drew nothing")
            if max(d0, d1, d2) > 4.0 / 255.0 { moved += 1 }
        }
        XCTAssertGreaterThan(moved, fixture.pixels.count / 2,
                             "\(CubePassTests.renderer): the developed picture is not the picture as shot (\(moved) moved)")

        // The wipe's left half: the picture as shot, pixel for pixel.
        let before = plan.renderBefore(picture: picture, decoded: decoded(fixture), budget: .whole)
        let shot = CubePassTests.read(before, width: fixture.width, height: fixture.height)
        var worst = 0.0
        for i in 0..<fixture.pixels.count {
            let (r, g, b) = fixture.pixels[i]
            let d = max(abs(Double(shot[i * 4]) - r), abs(Double(shot[i * 4 + 1]) - g), abs(Double(shot[i * 4 + 2]) - b))
            worst = d.isNaN ? .infinity : max(worst, d)
        }
        XCTAssertLessThanOrEqual(worst, 1.0 / 255.0, "the picture as shot is the source, untouched")
    }

    // MARK: - the budget and the crop

    func testTheBudgetCapsTheDeliveredFrameAndAPreviewTheSource() {
        // The whole picture: its long edge to the cap.
        XCTAssertEqual(FullDevelopRenderPlan.budgetScale(.stage, width: 8000, height: 6000, aspect: "original"),
                       2560.0 / 8000, accuracy: 1e-12)
        // A square crop: the FRAME's long edge (6000) to the cap.
        XCTAssertEqual(FullDevelopRenderPlan.budgetScale(.stage, width: 8000, height: 6000, aspect: "1:1"),
                       2560.0 / 6000, accuracy: 1e-12)
        // A delivery's cap is on what it delivers, never held to the source:
        // a square out of a panorama is 3000 source pixels high.
        XCTAssertEqual(FullDevelopRenderPlan.budgetScale(RenderBudget(longEdge: 1000), width: 12000, height: 3000,
                                                         aspect: "1:1"), 1000.0 / 3000, accuracy: 1e-12)
        // A preview is: the whole source within twice the cap.
        XCTAssertEqual(FullDevelopRenderPlan.budgetScale(.stage, width: 12000, height: 3000, aspect: "1:1"),
                       2 * 2560.0 / 12000, accuracy: 1e-12)
        // Never up, and whole with no cap.
        XCTAssertEqual(FullDevelopRenderPlan.budgetScale(.stage, width: 800, height: 600, aspect: "original"), 1)
        XCTAssertEqual(FullDevelopRenderPlan.budgetScale(.whole, width: 8000, height: 6000, aspect: "1:1"), 1)
    }

    func testAZoomedFramingIsDrawnFromThePixelsItMagnifies() {
        // The web grades at source density and draws the frame down: a frame
        // zoomed 2× is rendered from twice the pixels, then cut and brought
        // down — never upsampled from a source already brought down.
        var zoomed = Framing.default
        zoomed.scale = 2
        let cap = RenderBudget(longEdge: 1000)
        XCTAssertEqual(FullDevelopRenderPlan.renderScale(cap, width: 8000, height: 6000, aspect: "original", framing: zoomed),
                       2 * 1000.0 / 8000, accuracy: 1e-12)
        XCTAssertEqual(FullDevelopRenderPlan.renderScale(cap, width: 8000, height: 6000, aspect: "original", framing: nil),
                       1000.0 / 8000, accuracy: 1e-12)
        // Never past the source's own pixels, nor a preview's ceiling.
        var deep = Framing.default
        deep.scale = 8
        XCTAssertEqual(FullDevelopRenderPlan.renderScale(RenderBudget(longEdge: 4000), width: 8000, height: 6000,
                                                         aspect: "original", framing: deep), 1)
        XCTAssertEqual(FullDevelopRenderPlan.renderScale(.stage, width: 8000, height: 6000, aspect: "original", framing: deep),
                       2 * 2560.0 / 8000, accuracy: 1e-12)
        XCTAssertEqual(FullDevelopRenderPlan.renderScale(.whole, width: 8000, height: 6000, aspect: "original", framing: deep), 1)
    }

    func testAZoomedFrameIsCutThenBroughtToTheCap() {
        let fixture = CubePassTests.gradient()
        var p = bare()
        var zoomed = Framing.default
        zoomed.scale = 2
        p.framing = zoomed
        let out = plan().render(picture: p, decoded: decoded(fixture), budget: RenderBudget(longEdge: 32))
        XCTAssertEqual(out.extent.size, CGSize(width: 32, height: 24), "the delivered frame at the cap")
        let made = plan().assemble(p, decoded(fixture), RenderBudget(longEdge: 32))
        XCTAssertEqual(made.scale, 1, "drawn from the source's own pixels")
        XCTAssertEqual(made.deliver, 0.5, accuracy: 1e-12)
    }

    func testTheCropCutsTheDeliveredFrameAfterTheGraph() {
        let fixture = CubePassTests.gradient()
        var p = bare()
        p.aspect = "1:1"
        let out = plan().render(picture: p, decoded: decoded(fixture), budget: .whole)
        XCTAssertEqual(out.extent, CGRect(x: 0, y: 0, width: 48, height: 48), "the largest square inside 64 × 48")
        // The stage's budget scales the whole source, then cuts: 48 stays under 2560.
        let staged = plan().render(picture: p, decoded: decoded(fixture), budget: .stage)
        XCTAssertEqual(staged.extent.size, CGSize(width: 48, height: 48))
    }

    // MARK: - what the stage says

    func testWhatIsNotDrawnIsSaid() {
        let plan = self.plan()
        let p = bare()
        XCTAssertEqual(plan.unrendered(picture: p), [], "nothing carried, nothing said")
        // A RAW develop on a JPEG: the numbers are drawn, the material cannot be.
        var q = bare()
        var onSensor = DevelopSettings.default
        onSensor.base = .gain
        q.develop = onSensor
        XCTAssertTrue(plan.unrendered(picture: q).contains("RAW base"))
        // A built-in this build lacks is named, never silently neutral.
        var r = bare()
        r.grade = RollGrade(layers: [SavedLutLayer(id: "x", source: "builtin:no-such-look", name: "Gone")])
        XCTAssertEqual(plan.unrendered(picture: r), ["Gone (not in this build)"])
        // The rest of the old list is drawn now.
        var bordered = everything()
        bordered.border = RollBorder.default
        let drawn = plan.unrendered(picture: bordered)
        for word in ["look", "border", "perspective", "lens", "detail", "vignette", "repair", "layers"] {
            XCTAssertFalse(drawn.contains(word), "\(word) is drawn")
        }
    }

    func testTheBorderIsDrawnInADeliveryAndNeverOnTheStage() throws {
        let fixture = CubePassTests.gradient()
        var p = bare()
        p.border = RollBorder(aspect: nil, fill: "#ffffff", margin: RollBorder.Margin(x: 0.25, y: 0.25))
        let plan = self.plan()
        // Margins of a quarter of the crop's short side (48): 12 each way.
        let file = plan.render(picture: p, decoded: decoded(fixture), budget: .whole)
        XCTAssertEqual(file.extent, CGRect(x: 0, y: 0, width: 88, height: 72), "the crop on its canvas")
        let stage = plan.render(picture: p, decoded: decoded(fixture), budget: .stage)
        XCTAssertEqual(stage.extent.size, CGSize(width: 64, height: 48), "the stage shows the crop alone")
        let got = CubePassTests.read(file, width: 88, height: 72)
        if !CubePassTests.hasMetal, got.allSatisfy({ $0.isNaN }) {
            throw XCTSkip("no Metal device here, and the software renderer drew nothing")
        }
        // The canvas's corner is the border's white; the crop's centre is the picture's.
        XCTAssertEqual(Double(got[0]), 1, accuracy: 1.0 / 255)
        XCTAssertEqual(Double(got[1]), 1, accuracy: 1.0 / 255)
        XCTAssertEqual(Double(got[2]), 1, accuracy: 1.0 / 255)
        let at = (36 * 88 + 44) * 4
        let want = fixture.pixels[24 * 64 + 32]
        XCTAssertEqual(Double(got[at]), want.0, accuracy: 1.0 / 255)
        XCTAssertEqual(Double(got[at + 1]), want.1, accuracy: 1.0 / 255)
        XCTAssertEqual(Double(got[at + 2]), want.2, accuracy: 1.0 / 255)
        // A blurred fill covers the whole canvas with the crop's own colours.
        p.border = RollBorder(aspect: nil, fill: borderBlurFill, margin: RollBorder.Margin(x: 0.25, y: 0.25))
        let blurred = plan.render(picture: p, decoded: decoded(fixture), budget: .whole)
        XCTAssertEqual(blurred.extent, CGRect(x: 0, y: 0, width: 88, height: 72))
        let fill = CubePassTests.read(blurred, width: 88, height: 72)
        XCTAssertFalse(fill[0].isNaN || fill[1].isNaN || fill[2].isNaN, "the corner is filled")
        XCTAssertEqual(Double(fill[3]), 1, accuracy: 1.0 / 255, "and opaque")
    }

    // MARK: - the looks

    func testTheBundledBuiltInsResolveByTheWebsIds() throws {
        let looks = DevelopLooks(folder: DevelopLooks.bundledFolder(), store: DiskPackStore(root: scratch))
        XCTAssertNotNil(looks.folder, "the app bundle carries `luts/` (project.yml's folder reference)")
        let list = looks.builtinLooks
        XCTAssertFalse(list.isEmpty)
        // `classic/warm.cube` is `classic-warm`, as the web's scan names it.
        let warm = try XCTUnwrap(looks.builtin("classic-warm"))
        XCTAssertGreaterThan(warm.lut.size, 1)
        let grade = RollGrade(layers: [SavedLutLayer(id: "w", source: "builtin:classic-warm", name: "")])
        let resolved = looks.resolve(grade)
        XCTAssertEqual(resolved.layers.map(\.id), ["w"])
        XCTAssertEqual(resolved.missing, [])
        XCTAssertEqual(looks.missingWords(grade), [])
    }

    func testAPackLookIsReadFromTheVaultOnDiskOrSaidMissing() async throws {
        let store = DiskPackStore(root: scratch)
        let looks = DevelopLooks(folder: nil, store: store)
        let ref = PackRef(pack: "authentic", look: "kodak", hash: "abc123")
        let grade = RollGrade(layers: [SavedLutLayer(id: "k", source: packSource, name: "Kodak",
                                                     customText: writePackRef(ref))])
        // Not asked yet: missing, but nothing said until the vault answers.
        XCTAssertEqual(looks.missingWords(grade), [])
        await looks.prepare(grade)
        XCTAssertEqual(looks.resolve(grade).layers.first?.missing != nil, true, "the vault holds no such look")
        XCTAssertEqual(looks.missingWords(grade).count, 1)
        // The store round-trips an index and a lattice.
        let index = LutPackIndex(id: "authentic", name: "AUTHENTIC", author: "Victor Jimenes")
        let wrote = await store.putStoredPack(index)
        XCTAssertTrue(wrote)
        let listed = await store.listStoredPacks()
        XCTAssertEqual(listed.map(\.id), ["authentic"])
        let bytes: [UInt8] = [1, 2, 3, 4]
        let kept = await store.putStoredLattice("abc123", packId: "authentic", bytes: bytes)
        XCTAssertTrue(kept)
        let back = await store.getStoredLattice("abc123")
        XCTAssertEqual(back, bytes)
        let hashes = await store.storedLatticeHashes()
        XCTAssertEqual(hashes, ["abc123"])
        let sizes = await store.storedLatticeSizes()
        XCTAssertEqual(sizes["abc123"], 4)
        await store.deleteStoredLattices(["abc123"])
        let gone = await store.getStoredLattice("abc123")
        XCTAssertNil(gone)
    }
}
