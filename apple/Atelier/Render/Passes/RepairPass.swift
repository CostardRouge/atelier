// REPAIR as a pass of the graph — the web's `repair-pass.ts`: the whole
// patch list, heal and clone, drawn FIRST on the source, so a copied pixel
// takes the same develop, look, warp and layer as its neighbours and a
// denoise sees a repaired picture (`render-repair.md`). The kernel is
// `Kernels/Repair.metal`; the pure twin the gate holds it to is AtelierKit's
// `repairAt` (`Render/Repair.swift`).
//
// The pass's parameters ARE the pure record: the `Patch` list as
// `readPatches` reads it, capped at `maxPatches` as the web's pass caps it.
// Coordinates are resolution-free (a centre in [0,1] of the frame, a radius
// in the centred space, an offset in frame units), so no scale is needed;
// the FRAME is the picture this pass is drawn on — its extent, and its
// aspect unless the caller names the source's own.
//
// A Core Image kernel takes no arrays, and a centre stored in a half-float
// image would sit a pixel and a half off on a 6000-pixel picture, so the
// list is drawn in BATCHES of four patches handed as exact float vectors,
// one kernel per batch, each over the batch before and reading the ORIGINAL
// — which is exactly the twin's order: every patch reads the original and
// mixes over what the patches before it made.
//
// The ROI is what makes a tiled render right. A tile reads the picture where
// it is drawn, and — for every patch whose disc crosses it — the SOURCE disc
// under it (the tile's share of the disc, moved by the offset) and, for a
// heal, the two rings its means are measured over, wherever in the frame
// they lie. The input is clamped to its extent first, so a source past the
// edge smears the edge exactly as the twin's `sampleAt` does.

import AtelierKit
import CoreImage
import Foundation

struct RepairPass: RenderPass {
    /// How many patches one kernel draws: the kernel's four slots.
    static let batch = 4

    let id = "repair"

    /// The list, in the order it is drawn, capped at `maxPatches`.
    let patches: [Patch]
    /// The frame's width over its height; nil reads it from the picture the
    /// pass is drawn on. The web passes the SOURCE's own, which a fitted
    /// render matches to within its rounding.
    let aspectRatio: Double?

    init(patches: [Patch], aspectRatio: Double? = nil) {
        self.patches = Array(patches.prefix(maxPatches))
        self.aspectRatio = aspectRatio
    }

    func apply(_ image: CIImage, _ ctx: PassContext) -> CIImage {
        do {
            return try drawn(image, ctx)
        } catch {
            Kernels.report(error, pass: id)
            return image
        }
    }

    /// The pass with its failures THROWN — the gate's door.
    func drawn(_ image: CIImage, _ ctx: PassContext) throws -> CIImage {
        let extent = image.extent
        guard !extent.isInfinite, !extent.isEmpty, !patches.isEmpty else { return image }
        let kernel = try Kernels.kernel("repairPatches")
        let own = Double(extent.width / extent.height)
        let ar = RepairPass.usableAspect(aspectRatio) ?? own
        let diagonal = hypot(ar, 1)
        // The frame in the centred space whose half-diagonal is 1 — the web's `u_span`.
        let span = CIVector(x: CGFloat(ar / diagonal * 2), y: CGFloat(1 / diagonal * 2))
        let frame = CIVector(x: extent.minX, y: extent.minY, z: extent.width, w: extent.height)
        let original = image.clampedToExtent()

        var drawnSoFar = image
        var start = 0
        while start < patches.count {
            let slice = Array(patches[start..<min(start + RepairPass.batch, patches.count)])
            start += RepairPass.batch
            let reads = slice.map { RepairPass.reads(of: $0, frame: extent, aspectRatio: ar) }
            var arguments: [Any] = [
                drawnSoFar,
                original,
                frame,
                span,
                // (ringReach, meanGrid, how many of the four slots this batch fills)
                CIVector(x: CGFloat(ringReach), y: CGFloat(meanGrid), z: CGFloat(slice.count)),
            ]
            var centres: [Any] = []
            var froms: [Any] = []
            for slot in 0..<RepairPass.batch {
                if slot < slice.count {
                    let p = slice[slot]
                    centres.append(CIVector(x: CGFloat(p.x), y: CGFloat(p.y), z: CGFloat(p.radius), w: CGFloat(p.feather)))
                    froms.append(CIVector(x: CGFloat(p.dx), y: CGFloat(p.dy), z: p.kind == .heal ? 1 : 0, w: 0))
                } else {
                    centres.append(CIVector(x: 0, y: 0, z: 0, w: 0))
                    froms.append(CIVector(x: 0, y: 0, z: 0, w: 0))
                }
            }
            arguments.append(contentsOf: centres)
            arguments.append(contentsOf: froms)
            guard let out = kernel.apply(extent: extent, roiCallback: { index, rect in
                index == 0 ? rect : RepairPass.originalROI(rect, reads)
            }, arguments: arguments) else {
                throw KernelError.applyFailed(pass: id)
            }
            drawnSoFar = out
        }
        return drawnSoFar
    }

    // MARK: - where a patch reads the original

    /// What one patch reads of the original, in working space.
    struct Reads {
        /// The destination disc's bounding box: a tile outside it reads nothing for this patch.
        var disc: CGRect
        /// Where the source sits, from the destination: (dx, −dy) of the frame, y flipped.
        var offset: CGVector
        /// A heal's two rings — around the destination and around the source; empty for a clone.
        var rings: [CGRect]
    }

    /// The reads of `patch` over `frame`: the disc and the ring reach from
    /// the twin's own `radiusExtent`, grown by a pixel and a half for the
    /// bilinear taps at their edge.
    static func reads(of patch: Patch, frame: CGRect, aspectRatio: Double) -> Reads {
        let w = Double(frame.width)
        let h = Double(frame.height)
        let extent = radiusExtent(patch.radius, aspectRatio)
        let cx = Double(frame.minX) + patch.x * w
        let cy = Double(frame.minY) + (1 - patch.y) * h
        func box(_ halfW: Double, _ halfH: Double) -> CGRect {
            CGRect(x: cx - halfW, y: cy - halfH, width: 2 * halfW, height: 2 * halfH).insetBy(dx: -2, dy: -2)
        }
        let disc = box(extent.ru * w, extent.rv * h)
        let offset = CGVector(dx: patch.dx * w, dy: -patch.dy * h)
        var rings: [CGRect] = []
        if patch.kind == .heal {
            let ring = box(extent.ru * ringReach * w, extent.rv * ringReach * h)
            rings = [ring, ring.offsetBy(dx: offset.dx, dy: offset.dy)]
        }
        return Reads(disc: disc, offset: offset, rings: rings)
    }

    /// The original's ROI for a tile `rect`: the tile itself, and for every
    /// patch whose disc crosses it, the source under the tile's share of the
    /// disc and — for a heal — both rings, rounded OUT to whole pixels.
    ///
    /// Whole pixels because a chain of `CGRect.union`s cannot promise to
    /// contain what it was handed: a rect stores an origin and a size, so each
    /// union's far edge comes back as `origin + (max − origin)`, which can land
    /// an ulp inside the edge it was built from — on the gate's heal, a ROI
    /// whose maxX read 60.38398767333628 against its source ring's
    /// 60.383987673336286, so `CGRect.contains` said the ROI did not hold the
    /// ring it was grown for (and a sweep of random patches and tiles missed
    /// 275 of 8640 reads that way). The edges are gathered as numbers from
    /// each read's own `minX` / `maxX` and floored / ceiled once: integers are
    /// exact, so the result holds every read with no rounding left, and a
    /// tile already in whole pixels comes back unchanged when no patch
    /// crosses it. A GPU reads whole texels anyway, so this asks for less
    /// than a pixel more at most.
    static func originalROI(_ rect: CGRect, _ reads: [Reads]) -> CGRect {
        guard !rect.isNull, !rect.isInfinite else { return rect }
        var minX = rect.minX
        var minY = rect.minY
        var maxX = rect.maxX
        var maxY = rect.maxY
        var reached: [CGRect] = []
        for read in reads {
            let covered = rect.intersection(read.disc)
            if covered.isNull || covered.isEmpty { continue }
            reached.append(covered.offsetBy(dx: read.offset.dx, dy: read.offset.dy).insetBy(dx: -2, dy: -2))
            reached.append(contentsOf: read.rings)
        }
        for r in reached {
            minX = min(minX, r.minX)
            minY = min(minY, r.minY)
            maxX = max(maxX, r.maxX)
            maxY = max(maxY, r.maxY)
        }
        let x0 = minX.rounded(.down)
        let y0 = minY.rounded(.down)
        return CGRect(x: x0, y: y0, width: maxX.rounded(.up) - x0, height: maxY.rounded(.up) - y0)
    }

    private static func usableAspect(_ ar: Double?) -> Double? {
        guard let ar, ar.isFinite, ar > 0 else { return nil }
        return ar
    }
}
