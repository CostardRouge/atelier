// Still capture — the web's `frame-grab.ts`: the composed frame under the
// playhead, at the SOURCE's full resolution rather than the preview's, graded
// and burnt in through the same drawing the export uses. Rendered fresh here,
// never scraped from the stage, so editor chrome (the guides, the A/B divider,
// the selection outline, the ghost of a selected element outside its window)
// cannot leak into it. Named `clip-frame-1m12s.jpg` by the kernel's
// `frameGrabName`, and handed to the system's file exporter — the person picks
// where it goes, the web's chosen folder or download.

import CoreImage
import Foundation
import ImageIO
import UniformTypeIdentifiers
import AtelierKit

extension StudioEditor {
    /// The frame under the playhead as a JPEG file ready to save, or nil when
    /// there is no decoded frame yet (nothing to grab).
    func grabFrame() async -> InstrumentExportFile? {
        guard activeVideo != nil, let source, let active else { return nil }
        let time = sourceTime
        // The clean draw options of an export: no ghost, no chrome.
        let options = OverlayDrawOptions(timeShift: edit.timeShift, cues: cues, scenes: edit.scenes,
                                         originSeconds: range.start, ghostId: nil)
        let job = StudioFrameJob(
            source: source, time: time, size: source.extent.size, cube: stageCube,
            interpolation: LookLibrary.shared.interpolation, film: edit.film,
            elements: edit.elements, cue: findCue(cues, time), theme: edit.theme,
            options: options, wipe: nil, grader: FrameGrader(), painter: OverlayPainter()
        )
        let base = edit.exportFileName.trimmingCharacters(in: .whitespacesAndNewlines)
        let name = frameGrabName(base.isEmpty ? active.baseName : base, time)
        let data = await Task.detached(priority: .userInitiated) { () -> Data? in
            guard let image = job.render() else { return nil }
            return StudioEditor.jpeg(image, quality: 0.92)
        }.value
        return data.map { InstrumentExportFile(data: $0, name: name) }
    }

    /// An image as a JPEG at `quality`, tagged sRGB.
    nonisolated static func jpeg(_ image: CGImage, quality: Double) -> Data? {
        let out = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(out, UTType.jpeg.identifier as CFString, 1, nil) else {
            return nil
        }
        let options: [CFString: Any] = [kCGImageDestinationLossyCompressionQuality: quality]
        CGImageDestinationAddImage(destination, image, options as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { return nil }
        return out as Data
    }
}
