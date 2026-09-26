// What the Adjust sections' previews draw: a small synthetic picture measured
// by the kernel's own readers (so the histogram and Auto's statistics are
// real numbers, never typed in), a develop that touches every stage, a RAW's
// white, a capture of three files, and the darkroom column the sections sit
// in. Preview-only data — nothing here reaches a document.

import SwiftUI
import AtelierKit

enum DevelopPanelFixtures {
    /// A 160 × 100 RGBA picture: a warm ramp left to right under a cool sky,
    /// a sun gone to white in the corner and a crushed band at the left edge.
    static let rgba: [UInt8] = {
        var bytes = [UInt8]()
        bytes.reserveCapacity(160 * 100 * 4)
        for y in 0..<100 {
            for x in 0..<160 {
                let t = Double(x) / 159
                var r = t * 268
                var g = t * 230
                var b = t * 196
                if y < 30 {
                    r = 90 + t * 60
                    g = 140 + t * 60
                    b = 210 + t * 45
                }
                if x > 140 && y < 12 {
                    r = 255
                    g = 255
                    b = 255
                }
                if x < 6 {
                    r = 0
                    g = 0
                    b = 0
                }
                bytes.append(DevelopPanelFixtures.byte(r))
                bytes.append(DevelopPanelFixtures.byte(g))
                bytes.append(DevelopPanelFixtures.byte(b))
                bytes.append(255)
            }
        }
        return bytes
    }()

    private static func byte(_ v: Double) -> UInt8 {
        UInt8(Swift.min(255, Swift.max(0, v.rounded())))
    }

    static var histogram: Histogram { luminanceHistogram(rgba) }
    static var stats: SourceStats { measureSource(rgba) }

    /// A develop that touches every stage the Adjust tab draws.
    static var develop: DevelopSettings {
        var d = DevelopSettings.default
        d.exposure = 0.35
        d.contrast = 12
        d.shadows = 24
        d.temperature = -8
        d.vibrance = 15
        d.curves = ToneCurves(luma: [
            CurvePoint(x: 0, y: 0),
            CurvePoint(x: 0.25, y: 0.2),
            CurvePoint(x: 0.75, y: 0.82),
            CurvePoint(x: 1, y: 1),
        ])
        d.levels = Levels(rgb: LevelChannel(inBlack: 8.0 / 255, inWhite: 246.0 / 255, gamma: 1.1))
        d.mixer = withMixerValue(nil, .luminance, .blue, -35)
        d.grading = withWheel(nil, .shadows, GradeWheel(hue: 220, saturation: 30, luminance: 0))
        return d
    }

    /// The same numbers on the sensor, metered +0.7 EV.
    static var rawDevelop: DevelopSettings {
        var d = develop
        d.base = .gain
        d.rawGain = 1.6
        return d
    }

    /// A "camera" that IS linear sRGB, balanced for D65 — the kernel spec's own.
    static let white = RawWhite(
        asShot: [1, 1, 1],
        camXyz: [3.2406, -1.5372, -0.4986, -0.9689, 1.8758, 0.0415, 0.0557, -0.204, 1.057],
        rgbCam: [1, 0, 0, 0, 1, 0, 0, 0, 1]
    )

    static var detail: DetailSettings {
        DetailSettings(luminance: 20, colour: 40, sharpen: 35, sharpenRadius: 1.2, texture: 10, clarity: 15)
    }

    static var vignette: PostCropVignette { PostCropVignette(amount: -30, feather: 60) }

    /// A DJI capture reached through an instance: its 2048 px proxy, the JPEG
    /// the camera delivered, and the DNG whose render is 960 × 540 against an
    /// 8064 × 4536 sensor — the case that made the list a list.
    static var renditions: [Rendition] {
        let proxy = CaptureFile(name: "DJI_0101.JPG", bytes: 820_000, here: true,
                                pixels: PixelSize(width: 2048, height: 1152))
        let delivered = CaptureFile(name: "DJI_0101.JPG", bytes: 9_400_000,
                                    pixels: PixelSize(width: 4032, height: 2268))
        let raw = CaptureFile(name: "DJI_0101.DNG", bytes: 74_000_000,
                              render: .some(PixelSize(width: 960, height: 540)),
                              sensor: PixelSize(width: 8064, height: 4536))
        return renditionsOf(CaptureInput(open: proxy, openIsProxy: true, others: [delivered, raw]))
    }

    /// A readout the stage would have written under the pointer.
    static var readout: ReadoutStore {
        let store = ReadoutStore()
        store.set(StageReadout(readout: .value(r: 212, g: 180, b: 96), before: false))
        return store
    }
}

/// A preview's column: the darkroom's inspector ground, a scroll, and one
/// piece of state the sections under test write through.
struct DevelopPreviewState<Value, Content: View>: View {
    @State private var value: Value
    private let content: (Binding<Value>) -> Content

    init(_ initial: Value, @ViewBuilder content: @escaping (Binding<Value>) -> Content) {
        _value = State(initialValue: initial)
        self.content = content
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                content($value)
            }
            .padding(16)
        }
        .frame(minWidth: 320, idealWidth: 360, minHeight: 480)
        .background(Palette.darkroom.paper2)
        .darkroom()
    }
}
