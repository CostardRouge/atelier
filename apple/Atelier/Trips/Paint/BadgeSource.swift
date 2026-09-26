// A decoded picture a badge is painted over — the web's `BadgeSource`
// (`src/shared/roadtrip/badge-render.ts`): a photograph decoded once, or a
// clip's frame that SEEKS rather than re-decoding (`roadtrip.md`, «A clip's
// frame picker SEEKS the open video element»), plus the picture as graded.
//
// Rules kept:
// - Decoded UPRIGHT, as every file decode in the suite is, and as CODES (the
//   render graph's working space, `RenderPass.swift`): the same bytes the
//   Develop stage and every export read.
// - A RAW is read from the camera's render inside it first
//   (`PictureDecoder`, `device-memory.md`); a file nothing here can draw is
//   refused with a sentence a person can act on, never "nothing happened".
// - An EDITOR bounds a still to its pixel budget (`stageFrameSize`, one 4K
//   frame) and never enlarges; every deliverable decodes the file again at
//   its own density (`budget: nil`).
// - GRADED ONCE PER CHANGE, never per redraw (`holdGrades`): the graded
//   picture is kept under the grade's key and handed back until the key — or
//   the frame, after a seek — changes. The grade is applied at the SOURCE's
//   own density, before any crop (the photo-frame rule), so a still graded at
//   480 px and at 2160 px is one picture.

import AtelierKit
import CoreGraphics
import CoreImage
import Foundation

enum BadgeSourceError: LocalizedError {
    case undecodable(String)
    case clip(String)

    var errorDescription: String? {
        switch self {
        case .undecodable(let name):
            return "This device cannot decode \(name), and the file carries no render of its own — point this at an exported JPEG instead."
        case .clip(let name):
            return "This device cannot decode \(name)."
        }
    }
}

final class BadgeSource: @unchecked Sendable {
    /// The picture as decoded — codes, upright, its extent at the origin.
    private(set) var image: CIImage
    /// Its natural size, what the framing is computed on.
    let width: Double
    let height: Double
    /// The clip's length, or 0 for a photograph.
    let duration: Double
    /// Where the clip's frame is, on the author's clock; 0 for a photograph.
    private(set) var seconds: Double

    private let stills: ClipStills?
    private let lock = NSLock()
    /// The picture as last graded, and the key it was graded under.
    private var held: (key: String, picture: CGImage)?

    init(image: CIImage, duration: Double = 0, stills: ClipStills? = nil, seconds: Double = 0) {
        let origin = image.extent.origin
        let placed = origin == .zero ? image
            : image.transformed(by: CGAffineTransform(translationX: -origin.x, y: -origin.y))
        self.image = placed
        width = Double(placed.extent.width)
        height = Double(placed.extent.height)
        self.duration = duration
        self.stills = stills
        self.seconds = seconds
    }

    var isClip: Bool { stills != nil }

    /// Move a CLIP to another moment; the picture held is dropped with the
    /// frame it was graded from. A photograph has only one moment.
    func seek(_ to: Double) async throws {
        guard let stills else { return }
        let still = try await stills.frame(at: to)
        let origin = still.image.extent.origin
        let placed = origin == .zero ? still.image
            : still.image.transformed(by: CGAffineTransform(translationX: -origin.x, y: -origin.y))
        lock.lock()
        image = placed
        seconds = still.seconds
        held = nil
        lock.unlock()
    }

    /// The picture as painted: through `grader` at the source's own density,
    /// kept under `gradeKey` so a redraw costs no render; as decoded when
    /// there is no grader. Nil when nothing could be rendered.
    ///
    /// `gradeKey` must change whenever the grader's passes do — a grader is
    /// kept and its passes swapped, so its identity alone says nothing. A
    /// grader with no key is keyed by its identity.
    func picture(grader: FrameGrader?, gradeKey: String? = nil) -> PaintPicture? {
        let key: String
        if let grader {
            key = "g:" + (gradeKey ?? String(describing: ObjectIdentifier(grader)))
        } else {
            key = "as-shot"
        }
        lock.lock()
        if let held, held.key == key {
            lock.unlock()
            return PaintPicture(held.picture, width: width, height: height)
        }
        let source = image
        let at = seconds
        lock.unlock()

        let rendered: CGImage?
        if let grader {
            let recipe = grader.render(source: source, sourceSeconds: isClip ? at : nil)
            rendered = FrameGrader.cgImage(recipe)
        } else {
            rendered = FrameGrader.cgImage(source)
        }
        guard let rendered else { return nil }
        lock.lock()
        held = (key, rendered)
        lock.unlock()
        return PaintPicture(rendered, width: width, height: height)
    }

    /// Let go of the graded picture (a new look is coming, memory is short).
    func release() {
        lock.lock()
        held = nil
        lock.unlock()
    }
}

// MARK: - loading

enum BadgeSources {
    /// Whether a file is a clip, by the Library's own reading of its name.
    static func isClip(_ name: String) -> Bool {
        classifyPart(name) == .video
    }

    /// Decode a file into something a badge can be painted over. A photograph
    /// is decoded upright; within `budget` pixels when one is given (an
    /// editor's stage), at its own density otherwise (every deliverable). A
    /// clip is opened and seeked to `videoSeconds`; it keeps its reader, so
    /// the frame picker seeks instead of re-decoding.
    static func load(_ url: URL, name: String? = nil, videoSeconds: Double = 0,
                     budget: Double? = nil) async throws -> BadgeSource {
        let fileName = name ?? url.lastPathComponent
        if isClip(fileName) {
            let source: VideoSource
            do {
                source = try await VideoSource.open(url)
            } catch {
                throw BadgeSourceError.clip(fileName)
            }
            let meta = source.metadata
            var longEdge: Int? = nil
            if let budget {
                let fitted = stageFrameSize(Double(meta.displayWidth), Double(meta.displayHeight), budget: budget)
                let long = Int(max(fitted.width, fitted.height))
                if long > 0 && long < max(meta.displayWidth, meta.displayHeight) { longEdge = long }
            }
            let stills = ClipStills(source: source, longEdge: longEdge)
            let first = try await stills.frame(at: videoSeconds)
            return BadgeSource(image: first.image, duration: meta.duration, stills: stills, seconds: first.seconds)
        }

        let data = try await Task.detached(priority: .userInitiated) { () throws -> Data in
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            return try Data(contentsOf: url)
        }.value
        guard let decoded = PictureDecoder.decode(data, name: fileName) else {
            throw BadgeSourceError.undecodable(fileName)
        }
        var image = decoded.image
        if let budget {
            let fitted = stageFrameSize(Double(decoded.width), Double(decoded.height), budget: budget)
            if Int(fitted.width) < decoded.width || Int(fitted.height) < decoded.height {
                image = FrameGrader.fit(image, within: CGSize(width: fitted.width, height: fitted.height)).image
            }
        }
        return BadgeSource(image: image)
    }

    /// A collage's pictures, cell by cell, the lead's first — each cell whose
    /// file is gone or cannot be decoded is an EMPTY cell, not a failed slide:
    /// losing one photograph of six must never cost the piece. The lead's
    /// frame is taken at the slide's own second when it is a clip.
    static func loadCollage(_ lead: CollageLead, videoSeconds: Double, _ collage: SlideCollage,
                            resolve: (SavedMediaRef) async -> URL?, budget: Double? = nil) async -> [BadgeSource?] {
        var out: [BadgeSource?] = []
        for i in 0..<collageCellCount(collage) {
            let cell = collageCellAt(lead, collage, i)
            guard let ref = cell.media, let url = await resolve(ref) else {
                out.append(nil)
                continue
            }
            let source = try? await load(url, name: ref.name, videoSeconds: i == 0 ? videoSeconds : 0, budget: budget)
            out.append(source)
        }
        return out
    }
}
