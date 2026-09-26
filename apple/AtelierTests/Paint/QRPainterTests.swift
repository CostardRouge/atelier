// A QR painted and read BACK from the bitmap, module by module: the grid on
// the pixels must be `encodeQr`'s matrix exactly, every module a whole
// number of pixels with a hard edge, and the four-module quiet zone light —
// the web verifies the same by decoding its canvas (`docs/memory/roadtrip.md`).

import AtelierKit
import CoreGraphics
import XCTest
@testable import Atelier

final class QRPainterTests: XCTestCase {
    /// A code as a card resolves one (`prepareOutro` → `QrDraw`, the kernel's
    /// encode), which is the path every painted QR takes.
    private func code(_ url: String, x: Double, y: Double, sizeFrac: Double, dark: String, light: String) throws -> QrDraw {
        var card = createOutroCard("")
        card.qr = OutroQr(url: url, x: x, y: y, sizeFrac: sizeFrac, dark: dark, light: light)
        return try XCTUnwrap(prepareOutro(card).qr)
    }

    private func draw(_ qr: QrDraw, _ width: Int, _ height: Int) -> PaintRaster {
        PaintRaster.render(width, height) { cg, size in
            QRPainter.drawQr(in: cg, size: size, qr)
        }
    }

    func testTheModuleGridReadBackIsTheEncodersMatrix() throws {
        let url = "https://steeve.website/atelier/trips/2026-australia"
        let matrix = try XCTUnwrap(encodeQr(url))
        let qr = try code(url, x: 0.1, y: 0.2, sizeFrac: 0.8, dark: "#1b1813", light: "#f4f0e7")
        XCTAssertEqual(qr.matrix, matrix)
        let raster = draw(qr, 1080, 1350)
        let place = OverlayGeometry.qrPlacement(1080, 1350, qr)
        let module = Int(place.module)
        XCTAssertEqual(Double(module), place.module, "whole pixels")
        let quiet = OverlayGeometry.qrQuietModules
        let dark = PaintRaster.Pixel(r: 0x1b, g: 0x18, b: 0x13, a: 255)
        let light = PaintRaster.Pixel(r: 0xf4, g: 0xf0, b: 0xe7, a: 255)
        var mismatches = 0
        for row in 0..<matrix.size {
            for col in 0..<matrix.size {
                let x0 = Int(place.left) + (col + quiet) * module
                let y0 = Int(place.top) + (row + quiet) * module
                let want = matrix.modules[row * matrix.size + col] ? dark : light
                // Every pixel of the module, corners included: a hard edge.
                for (dx, dy) in [(0, 0), (module - 1, 0), (0, module - 1), (module - 1, module - 1), (module / 2, module / 2)]
                where raster.pixel(x0 + dx, y0 + dy) != want {
                    mismatches += 1
                }
            }
        }
        XCTAssertEqual(mismatches, 0)
    }

    func testTheQuietZoneIsFourLightModulesOnEverySide() throws {
        let qr = try code("https://example.com", x: 0.25, y: 0.25, sizeFrac: 0.5, dark: "#000000", light: "#ffffff")
        let raster = draw(qr, 800, 800)
        let place = OverlayGeometry.qrPlacement(800, 800, qr)
        let module = Int(place.module)
        let left = Int(place.left)
        let top = Int(place.top)
        let drawn = Int(place.drawn)
        let white = PaintRaster.Pixel(r: 255, g: 255, b: 255, a: 255)
        for i in stride(from: 0, to: drawn, by: max(1, module / 2)) {
            for depth in [0, 4 * module - 1] {
                XCTAssertEqual(raster.pixel(left + i, top + depth), white)
                XCTAssertEqual(raster.pixel(left + i, top + drawn - 1 - depth), white)
                XCTAssertEqual(raster.pixel(left + depth, top + i), white)
                XCTAssertEqual(raster.pixel(left + drawn - 1 - depth, top + i), white)
            }
        }
        XCTAssertEqual(raster.pixel(left - 1, top + drawn / 2).a, 0, "nothing outside the square")
    }
}
