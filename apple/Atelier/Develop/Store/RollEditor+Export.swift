// Delivering ONE picture — Develop v0's export, kept while the Export task
// builds the web's whole tab (every target of the roll into its folders, the
// run with progress and a Cancel, the metadata groups, the watermark, the
// delivery table, Ultra HDR). It renders through the SAME plan the stage
// draws with (`DevelopRenderPlan`, budget `.whole`), so what leaves is what
// was judged; the name is EXACTLY the picture's (`DJI_0101.JPG` →
// `DJI_0101.jpg`, variants into `Variant N/` being the run's), the original's
// metadata carried (`PictureRenderer.encode`), and the landing marked on
// this device (`export-marks.ts`).

import Foundation
import UniformTypeIdentifiers
import AtelierKit

enum ExportFormat: String, CaseIterable, Identifiable {
    case jpeg, heic
    var id: String { rawValue }
    var title: String { self == .jpeg ? "JPEG" : "HEIC" }
    var type: UTType { self == .jpeg ? .jpeg : .heic }
    var fileExtension: String { self == .jpeg ? "jpg" : "heic" }
}

extension RollEditor {
    /// The delivered pixels of the open picture at the roll's first target —
    /// what the panel says before a byte moves.
    var deliveredSize: (width: Int, height: Int)? {
        guard let size = decodedSize, let pic = picture else { return nil }
        var out = PictureRenderer.deliveredSize(width: Int(size.width), height: Int(size.height), aspect: pic.aspect)
        if let cap = longEdgeFor(roll?.export.primary.size, width: Double(out.width), height: Double(out.height)) {
            let scale = Double(cap) / Double(max(out.width, out.height))
            out = (Int((Double(out.width) * scale).rounded()), Int((Double(out.height) * scale).rounded()))
        }
        return out
    }

    /// `DJI_0101.JPG` → `DJI_0101.jpg`, no word added.
    func exportFileName(_ format: ExportFormat) -> String {
        let base = ((picture?.ref.name ?? "picture") as NSString).deletingPathExtension
        return "\(base).\(format.fileExtension)"
    }

    /// The open picture rendered whole at the first target's cap and encoded,
    /// or nil. Marks the picture as delivered from this device.
    func exportData(_ format: ExportFormat) async -> Data? {
        flushDrafts()
        guard let pic = draftedPicture, let doc = roll else { return nil }
        guard let read = try? await pool.read(rollId, pic) else { return nil }
        let decoded = read.decoded
        let target = doc.export.primary
        let delivered = PictureRenderer.deliveredSize(width: decoded.width, height: decoded.height, aspect: pic.aspect)
        let cap = longEdgeFor(target.size, width: Double(delivered.width), height: Double(delivered.height))
        let quality = target.quality
        let type = format.type
        let plan = renderPlan
        let data = await Task.detached(priority: .userInitiated) { () -> Data? in
            let renderer = PictureRenderer.shared
            let composed = plan.render(picture: pic, decoded: decoded, budget: RenderBudget(longEdge: cap))
            return renderer.encode(composed, as: type, quality: quality, source: decoded)
        }.value
        if data != nil { markExported([pic]) }
        return data
    }
}
