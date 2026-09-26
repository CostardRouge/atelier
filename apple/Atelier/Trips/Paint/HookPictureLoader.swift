// The pictures a piece's opener asked for, decoded — the loading half of the
// web's `use-hook-pictures.ts`: what a sweep flashes, what an itinerary pins,
// what a drive pops as prints.
//
// Rules kept (`roadtrip.md`, «A hook's flashed pictures are SOURCE pictures»):
// - The SOURCE picture, asked for by REF (`wantsPictures`), never the thumbs
//   store: those hold finished hooks with another badge burned in.
// - Found by the caller's resolver (the Library, else the instance the ref
//   names) — a picture that cannot be found is REPORTED, one line per
//   picture, never replaced by a stand-in; a clip not in the Library is said
//   as such, since its frame cannot be fetched on its own.
// - Cropped to the frame's shape AT decode (a flash is cover-cropped, a print
//   keeps its own shape — `coverCrop`, `wholeCrop`), sized to what a
//   delivered frame shows, inside ONE pixel budget the whole set shares
//   (`perPicturePixels`), split in steps so one more picture does not decode
//   the thirty others again at a hair smaller.
// - Graded with the piece's look, so the flashes and the picture they land
//   on wear the same one; an ungraded flash is better than a dark one.

import AtelierKit
import CoreGraphics
import CoreImage
import Foundation

/// The decoded pictures and what could not be drawn, each with why.
struct HookPictureSet {
    var pictures: [String: HookPicture]
    var problems: [String: String]

    static let empty = HookPictureSet(pictures: [:], problems: [:])
}

enum HookPictureLoader {
    /// What the opener's layers will actually draw, each once, under the key
    /// it will be looked up by — only variants that want the DAY's pictures.
    static func wants(_ layers: [HookLayer], _ ctx: HookContext) -> [HookPictureWant] {
        var seen: Set<String> = []
        var out: [HookPictureWant] = []
        for layer in layers {
            guard let variant = hookVariantById(layer.id), variant.needs.media == .day,
                  let wantsPictures = variant.wantsPictures else { continue }
            for want in wantsPictures(layer.options, ctx) where seen.insert(want.key).inserted {
                out.append(want)
            }
        }
        return out
    }

    /// The count a set's budget is split by, in steps: up to fifteen, every
    /// picture already decodes at a delivered frame's size.
    static func budgetCount(_ count: Int) -> Int {
        if count <= 15 { return 15 }
        return [20, 24, 32, 40].first { count <= $0 } ?? count
    }

    /// Find, decode, crop and grade every want. `cube` is the piece's look
    /// (the hook's); nil leaves the pictures as shot.
    static func load(_ wants: [HookPictureWant], aspect: Double, cube: CubeLut?,
                     interpolation: Interpolation = .tetrahedral,
                     resolve: (SavedMediaRef) async -> URL?,
                     isCancelled: () -> Bool = { false }) async -> HookPictureSet {
        let cap = perPicturePixels(budgetCount(wants.count))
        let grader = cube.map { FrameGrader(lut: $0, interpolation: interpolation) }
        var set = HookPictureSet.empty
        for want in wants {
            if isCancelled() { break }
            do {
                let image = try await decode(want, resolve: resolve)
                let cropped = crop(image, want, aspect: aspect, cap: cap)
                let graded = grader.map { $0.render(source: cropped) } ?? cropped
                guard let cg = FrameGrader.cgImage(graded) ?? FrameGrader.cgImage(cropped) else {
                    set.problems[want.key] = "\(want.ref.name): the picture could not be drawn."
                    continue
                }
                set.pictures[want.key] = HookBitmap.picture(cg)
            } catch {
                set.problems[want.key] = describe(error, want)
            }
        }
        return set
    }

    /// One line a person can act on, for a picture that will not be drawn.
    private static func describe(_ error: Error, _ want: HookPictureWant) -> String {
        if let problem = error as? HookPictureProblem { return problem.message }
        return "\(want.ref.name): \(error.localizedDescription)"
    }

    private struct HookPictureProblem: Error {
        let message: String
    }

    /// The picture a want names, decoded upright as codes.
    private static func decode(_ want: HookPictureWant, resolve: (SavedMediaRef) async -> URL?) async throws -> CIImage {
        let name = want.ref.name
        let clip = BadgeSources.isClip(name)
        guard let url = await resolve(want.ref) else {
            throw HookPictureProblem(message: clip
                ? "\(name) is a clip that is not in the Library — add it to flash its frame."
                : "\(name) is not in the Library, and no connected instance holds it.")
        }
        do {
            // A clip's frame at the want's second, a photograph at its own
            // density — the crop below brings either down to the budget.
            let source = try await BadgeSources.load(url, name: name, videoSeconds: want.atSeconds ?? 0)
            return source.image
        } catch {
            throw HookPictureProblem(message: clip
                ? "This device cannot show a frame of \(name)."
                : "This device cannot decode \(name).")
        }
    }

    /// Cropped to the frame's shape (a flash) or kept whole (a print), and
    /// sized to the crop's decode size — never enlarged.
    private static func crop(_ image: CIImage, _ want: HookPictureWant, aspect: Double, cap: Double) -> CIImage {
        let e = image.extent
        let w = Double(e.width)
        let h = Double(e.height)
        let c = want.shape == .own ? wholeCrop(w, h, cap) : coverCrop(w, h, aspect, cap)
        let sw = max(1, c.sw.rounded())
        let sh = max(1, c.sh.rounded())
        // Top-left source pixels, turned into Core Image's bottom-left ones.
        let rect = CGRect(x: e.minX + c.sx.rounded(), y: e.minY + (h - c.sy.rounded() - sh), width: sw, height: sh)
        let region = image.cropped(to: rect).transformed(by: CGAffineTransform(translationX: -rect.minX, y: -rect.minY))
        let scaleX = Double(c.width) / sw
        let scaleY = Double(c.height) / sh
        guard scaleX < 1 || scaleY < 1 else { return region }
        let filter = CIFilter(name: "CILanczosScaleTransform")
        filter?.setValue(region.clampedToExtent(), forKey: kCIInputImageKey)
        filter?.setValue(scaleY, forKey: kCIInputScaleKey)
        filter?.setValue(scaleX / scaleY, forKey: kCIInputAspectRatioKey)
        let scaled = filter?.outputImage
            ?? region.transformed(by: CGAffineTransform(scaleX: CGFloat(scaleX), y: CGFloat(scaleY)))
        return scaled.cropped(to: CGRect(x: 0, y: 0, width: c.width, height: c.height))
    }
}
