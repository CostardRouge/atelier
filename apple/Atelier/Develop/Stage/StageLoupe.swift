// THE LOUPE — the file's own pixels under a magnified view: the web's
// `useDevelopPicture({ loupe: true })` («the loupe», `render-detail.md`;
// `device-memory.md` for the phone).
//
// The stage works to a pixel budget (one 4K frame), so past its 1:1 a smooth
// resample invents a gradient between the preview's pixels and "pixels as
// pixels" merely enlarges them — neither is what a denoise looks like in the
// file. Past the stage's 1:1 the loupe renders the picture WHOLE, at the
// file's own density, through the very plan the stage draws through
// (`RenderBudget.loupe`: the same develop, look, warps, layers, detail and
// film; the stage's held subjects and its ways of looking; a RAW's sensor
// decoded at its own size), and the stage draws it over its own picture
// under the same zoom — so it lands on the stage's picture to the pixel.
//
// Rules kept:
// - Its decode is a TASK: `Looking closer at <file>` · `the file at its own
//   density`, on the picture's edge and in the pill, with a Cancel — a render
//   cannot stop half-way, so a Cancel lets it finish and throws it away
//   (`loupe · cancelled`, not asked again until the view comes back).
// - It is drawn only over the stage render it was made for: a slider moved
//   since shows the stage's own pixels until the loupe has caught up — once
//   the stage has RESTED a moment, one render in flight and one owed, so a
//   drag is never slowed by whole-file renders it would throw away.
// - A file with no more pixels than the stage shows (a proxy, a small JPEG)
//   SAYS so (`loupe · the file has no more`) rather than pretending.
// - A CONSTRAINED device (`DevelopDevice`, the kernel's `DeviceClass`) is
//   never given the file whole, for any picture: the stage already stands at
//   its ceiling, and the loupe says `loupe · as close as this device goes`.
// - The file is let go three seconds after the view comes back under the
//   stage's 1:1, and at once when the picture changes — a 24-megapixel render
//   is not kept for a look that ended; a RAW's held sensor decode goes with it.
//
// What is not the web's, recorded: the web's loupe draws the file's own
// untouched pixels on the BEFORE side of the wipe; here the before side keeps
// the stage's picture as shot, magnified.

import CoreGraphics
import Foundation
import Observation
import AtelierKit

/// Where the loupe is — the web's `LoupeState`.
enum StageLoupeState: String {
    case idle, decoding, ready, same, capped, failed, cancelled
}

@MainActor
@Observable
final class StageLoupe {
    private(set) var state: StageLoupeState = .idle
    /// The view is past the stage's 1:1 and the loupe answers it.
    private(set) var active = false
    /// The picture rendered whole, at the file's own density.
    private(set) var image: CGImage?
    /// The stage render `image` was made over — shown over that one only.
    private(set) var drawnOver: CGImage?

    @ObservationIgnored private var pictureId: String?
    @ObservationIgnored private var wanted = false
    @ObservationIgnored private var work: Task<Void, Never>?
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var owed = false
    @ObservationIgnored private var releasing: Task<Void, Never>?
    @ObservationIgnored private var resting: Task<Void, Never>?
    @ObservationIgnored private weak var editor: RollEditor?

    /// How long the file is held once the view is back under the stage's 1:1.
    static let releaseNanos: UInt64 = 3_000_000_000
    /// How long the stage rests before the loupe renders over it.
    static let restNanos: UInt64 = 250_000_000

    init() {}

    /// The rendered file's long edge, once known.
    var longEdge: Int? {
        image.map { max($0.width, $0.height) }
    }

    /// The pill's words while the loupe answers — the web's, one per state.
    var words: String? {
        guard active else { return nil }
        switch state {
        case .idle: return nil
        case .decoding: return "loupe · decoding…"
        case .ready: return "loupe · \(longEdge.map { String($0) } ?? "") px"
        case .same: return "loupe · the file has no more"
        case .capped: return "loupe · as close as this device goes"
        case .cancelled: return "loupe · cancelled"
        case .failed: return "loupe · could not decode"
        }
    }

    /// What is drawn over `stage` — the file's own pixels, made for this very
    /// render — or nil.
    func shown(over stage: CGImage?) -> CGImage? {
        guard active, state == .ready, let image, let stage, let drawnOver, drawnOver === stage else { return nil }
        return image
    }

    // MARK: - following the stage

    /// Say what the stage shows now: whether the view is past the stage's
    /// 1:1 (`LookingZoom.magnifying`), which picture, which render. Called
    /// whenever one of them moves.
    func sync(wanted: Bool, editor: RollEditor) {
        self.editor = editor
        if editor.openId != pictureId {
            drop()
            pictureId = editor.openId
        }
        self.wanted = wanted
        guard wanted else {
            if active { leave() }
            return
        }
        releasing?.cancel()
        releasing = nil
        active = true
        // A phone is given a stage at its ceiling: nothing closer is decoded,
        // for any picture — said, never tried (`device-memory.md`).
        if DevelopDevice.current == .constrained {
            state = .capped
            return
        }
        // Cancelled, or refused: not asked again until the view comes back.
        if state == .cancelled || state == .failed { return }
        guard let stage = editor.stage, let picture = editor.draftedPicture,
              let read = editor.pool.held(picture.id) else { return }
        if image != nil, let drawnOver, drawnOver === stage {
            state = .ready
            return
        }
        if work != nil {
            owed = true
            return
        }
        let plan = editor.renderPlan
        let source = plan.sourceSize(picture: picture, decoded: read.decoded, budget: .loupe)
        let whole = FullDevelopRenderPlan.frameSize(Double(source.width), Double(source.height), picture.aspect)
        if Int(whole.width.rounded()) <= stage.width {
            // A proxy, a small JPEG: the stage already shows every pixel it has.
            image = nil
            drawnOver = nil
            state = .same
            return
        }
        // Once the stage has rested: a slider mid-drag renders nothing whole.
        state = .decoding
        let decoded = read.decoded
        let clipping = editor.clipping
        resting?.cancel()
        resting = Task { [weak self] in
            try? await Task.sleep(nanoseconds: StageLoupe.restNanos)
            guard !Task.isCancelled, let self, self.wanted, let current = self.editor?.stage, current === stage else { return }
            self.resting = nil
            self.start(picture, decoded, plan: plan, over: stage, clipping: clipping)
        }
    }

    /// The picture changed, or the stage went away: everything let go at once.
    func drop() {
        cancelWork()
        releasing?.cancel()
        releasing = nil
        release()
        active = false
    }

    // MARK: - the render

    private func start(_ picture: RollPicture, _ decoded: DecodedPicture, plan: DevelopRenderPlan,
                       over stage: CGImage, clipping: Bool) {
        generation += 1
        let run = generation
        owed = false
        state = .decoding
        // The loupe is the crop; the stage lays the border under it.
        var looked = picture
        looked.border = nil
        let name = picture.ref.name
        let scope = picture.id
        work = Task { [weak self] in
            let result: Result<CGImage?, Error>
            do {
                let image = try await TaskCenter.run("Looking closer at \(name)", scope: scope,
                                                     detail: "the file at its own density") { _ in
                    try await StageLoupe.render(looked, decoded, plan: plan, clipping: clipping)
                }
                result = .success(image)
            } catch {
                result = .failure(error)
            }
            self?.landed(result, run: run, over: stage)
        }
    }

    /// The picture whole, through the stage's own plan, with the stage's way
    /// of looking (J) — off the main actor.
    nonisolated private static func render(_ picture: RollPicture, _ decoded: DecodedPicture,
                                           plan: DevelopRenderPlan, clipping: Bool) async throws -> CGImage? {
        await plan.prepare(picture: picture, decoded: decoded, budget: .loupe)
        try Task.checkCancellation()
        let image = await Task.detached(priority: .userInitiated) { () -> CGImage? in
            let composed = plan.render(picture: picture, decoded: decoded, budget: .loupe)
            return PictureRenderer.shared.cgImage(plan.looking(composed, clipping: clipping))
        }.value
        // A render cannot stop half-way: a Cancel lets it finish and throws it away.
        try Task.checkCancellation()
        return image
    }

    private func landed(_ result: Result<CGImage?, Error>, run: Int, over stage: CGImage) {
        guard run == generation else { return }
        work = nil
        switch result {
        case .success(let made?):
            image = made
            drawnOver = stage
            state = .ready
        case .success(nil):
            state = .failed
        case .failure(let error):
            state = error is CancellationError ? .cancelled : .failed
        }
        // The stage moved on while it rendered: once more, over the render on screen.
        if owed, wanted, let editor {
            owed = false
            sync(wanted: true, editor: editor)
        }
    }

    // MARK: - letting go

    /// The view came back under the stage's 1:1: what is in flight stops,
    /// and the file goes a moment later — a zoom straight back finds it.
    private func leave() {
        active = false
        cancelWork()
        if state != .ready { state = .idle }
        releasing?.cancel()
        releasing = Task { [weak self] in
            try? await Task.sleep(nanoseconds: StageLoupe.releaseNanos)
            guard !Task.isCancelled else { return }
            self?.release()
        }
    }

    private func cancelWork() {
        generation += 1
        work?.cancel()
        work = nil
        resting?.cancel()
        resting = nil
        owed = false
    }

    private func release() {
        image = nil
        drawnOver = nil
        state = .idle
        editor?.fullRenderPlan?.releaseLoupe()
    }
}
