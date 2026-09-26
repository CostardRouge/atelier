// The app's seam, held to the web's numbers: `PictureRenderer.compose` — what
// the stage, the histogram and the export all call — runs a develop through
// the graph's TETRAHEDRAL cube pass, so its pixels are the twin's
// (`sampleTetrahedral` over the kernel's own `composeLutStack` bake) to one
// code, where the retired `CIColorCubeWithColorSpace` was trilinear. A
// picture as shot draws through no kernel at all.

import AtelierKit
import CoreImage
import XCTest
@testable import Atelier

final class PictureRendererTests: XCTestCase {
    private func picture(_ fixture: CubePassTests.Gradient) -> DecodedPicture {
        DecodedPicture(image: fixture.image, properties: [:], isRaw: false)
    }

    func testAPictureAsShotIsHandedBackUntouched() {
        let fixture = CubePassTests.gradient()
        let decoded = picture(fixture)
        let out = PictureRenderer.shared.compose(decoded, recipe: PictureRenderer.Recipe(develop: nil))
        XCTAssertTrue(out === decoded.image, "no develop, no crop, no cap: no node")
        let zeroed = PictureRenderer.shared.compose(decoded, recipe: PictureRenderer.Recipe(develop: .default))
        XCTAssertTrue(zeroed === decoded.image, "every slider at 0 is the identity, and costs no kernel")
    }

    func testADevelopIsDrawnThroughTheTetrahedralCube() throws {
        var develop = DevelopSettings()
        develop.exposure = 0.6
        develop.contrast = 25
        develop.temperature = 30
        develop.saturation = 20
        develop.shadows = -15
        let cube = try XCTUnwrap(composeLutStack([], output: .none, interpolation: .tetrahedral, develop: develop))

        let fixture = CubePassTests.gradient()
        let recipe = PictureRenderer.shared.compose(picture(fixture), recipe: PictureRenderer.Recipe(develop: develop))
        let got = CubePassTests.read(recipe, width: fixture.width, height: fixture.height)
        if !CubePassTests.hasMetal, got.allSatisfy({ $0.isNaN }) {
            throw XCTSkip("no Metal device here, and the software renderer drew nothing through the cube kernel")
        }
        var worst = 0.0
        for i in 0..<fixture.pixels.count {
            let (r, g, b) = fixture.pixels[i]
            let want = sampleTetrahedral(cube, r, g, b)
            let d0 = abs(Double(got[i * 4]) - want.0)
            let d1 = abs(Double(got[i * 4 + 1]) - want.1)
            let d2 = abs(Double(got[i * 4 + 2]) - want.2)
            let d = max(d0, d1, d2)
            worst = d.isNaN ? .infinity : max(worst, d)
        }
        XCTAssertLessThanOrEqual(worst, CubePassTests.tolerance,
                                 "\(CubePassTests.renderer): worst \(worst * 255) codes from the tetrahedral twin")
    }
}
