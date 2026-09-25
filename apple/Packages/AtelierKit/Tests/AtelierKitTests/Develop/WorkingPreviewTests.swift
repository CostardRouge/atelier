// Port of `src/shared/develop/working-preview.test.ts`. The web tells a
// preview from the real file by the identity of a `File`; here a preview is
// its own type, so "told apart" is the type — the rest of the case is kept.

import XCTest
@testable import AtelierKit

final class WorkingPreviewTests: XCTestCase {
    func testAreFilesNamedLikeTheirPictureAndToldApartFromTheRealOne() {
        let preview = workingPreviewFile(Data("x".utf8), type: "image/jpeg", name: "IMG_1.jpg", lastModified: 42)
        XCTAssertEqual(preview.name, "IMG_1.jpg")
        XCTAssertEqual(preview.lastModified, 42)
        XCTAssertEqual(preview.type, "image/jpeg")
        XCTAssertEqual(preview.data, Data("x".utf8))
        XCTAssertTrue(isWorkingPreview(preview))
        XCTAssertFalse(isWorkingPreview(Data("x".utf8)))
        XCTAssertFalse(isWorkingPreview(nil))
        // A blob with no type is a JPEG's, as the web's `blob.type || 'image/jpeg'`.
        XCTAssertEqual(workingPreviewFile(Data(), name: "IMG_1.jpg", lastModified: 1).type, "image/jpeg")
    }

    func testKeepTheirOptInPerRoll() {
        XCTAssertNotEqual(workingPreviewsKey("r1"), workingPreviewsKey("r2"))
        XCTAssertEqual(workingPreviewsKey("r1"), "atelier.develop.previews.r1")
        // Made at a Winnow proxy's edge, and weighed before any is made.
        XCTAssertEqual(workingPreviewEdge, 2048)
        XCTAssertEqual(workingPreviewQuality, 0.82)
        XCTAssertEqual(workingPreviewEstimateBytes, 450_000)
    }
}
