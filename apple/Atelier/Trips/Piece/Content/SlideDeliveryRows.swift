// What the open slide is DELIVERED as, and for how long — the web's
// `panels/SlideDelivery.tsx`, decided HERE, where the piece is composed, and
// never at the door (the maintainer's call, 2026-09-09: a deck mixing a video
// hook and three stills is a decision about the post, so the export reads it
// rather than making it).
//
// Rules kept (`roadtrip.md`):
// - Each of Auto · Image · Video says what it would really deliver for THIS
//   slide — `Auto` its medium, the explicit two their cost (settled, one
//   frame, a held card) — and the chosen one's real sentence is under the
//   row (`reasonSentence`, the kernel's).
// - A clip's stretch is READ here (the cut is made on the band under the
//   picture); its speed is one control in both places, writing the same
//   field through `setClipSpeed`, which keeps the footage and re-times the
//   screen seconds. A re-timed clip says it goes out without sound.
// - "On screen" never promises more than the clip holds after its in point
//   at its speed (`screenSecondsCeiling`): a read-out claiming 5 s over a
//   3 s clip is lying about the file it will write.
// - The closing card never gets here: its medium is structural.

import SwiftUI
import AtelierKit

struct SlideDeliveryRows: View {
    let model: PieceEditorModel
    let post: TripPost
    let slide: DeckSlide
    @Environment(\.palette) private var palette

    private var isHook: Bool { slide.kind == .hook }

    /// Something on this slide is animated — a badge piece or the cascade, today.
    private var animated: Bool { isHook && hookAnimates(post.badge.pieceStyles, post.badge.cascade) }

    /// The open slide's clip length, or 0 when its picture is not one (or has
    /// not loaded).
    private var clipSeconds: Double { model.isVideo ? model.duration : 0 }

    private var ceiling: Double { screenSecondsCeiling(slide.videoTimeSeconds, slide.speed, clipSeconds) }

    private var seconds: Double { min(slide.seconds, ceiling) }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            mediumRow
            if model.isClipSlide {
                rangeRow
                speedRow
            }
            secondsRow
        }
    }

    // MARK: - goes out as

    private var mediumRow: some View {
        ContentFieldRow("Goes out as") {
            ContentChoiceStrip("What this slide is delivered as", selection: slide.chosen, options: mediumOptions) { medium in
                writeMedium(medium)
            }
        } hint: {
            ContentHint(reasonSentence(slide.reason, seconds, slide.speed))
        }
    }

    private var mediumOptions: [ContentChoiceOption<SlideMedium>] {
        let name = slide.media?.name
        return slideMediumChoices.map { choice in
            let would = resolveSlideMedium(choice.id, animated, name)
            let detail = slideMediumChoiceHint(choice.id, would.reason, would.medium)
            return ContentChoiceOption(value: choice.id, label: choice.label, detail: detail)
        }
    }

    private func writeMedium(_ medium: SlideMedium) {
        if isHook {
            model.patchBadge { $0.medium = medium }
        } else {
            model.patchSlide { $0.medium = medium }
        }
    }

    // MARK: - the clip's own numbers

    private var rangeRow: some View {
        let range = model.clipRange
        return ContentFieldRow("Range") {
            Text(verbatim: "\(formatTimecode(range.start)) → \(formatTimecode(range.end))")
                .font(Brand.mono(12))
                .monospacedDigit()
                .foregroundStyle(palette.ink)
        }
    }

    private var speedRow: some View {
        let options = clipSpeeds.map { speed in
            ContentChoiceOption(value: speed, label: clipSpeedLabel(speed), detail: nil)
        }
        return ContentFieldRow("Speed") {
            ContentChoiceStrip("Clip speed", selection: slide.speed, options: options) { speed in
                model.setClipSpeed(speed)
            }
        } hint: {
            if let hint = clipSpeedHint(slide.speed) {
                ContentHint(hint)
            }
        }
    }

    // MARK: - on screen

    @ViewBuilder
    private var secondsRow: some View {
        let hint = onScreenHint(slide.medium, clipSeconds: clipSeconds, ceiling: ceiling, speed: slide.speed)
        VStack(alignment: .leading, spacing: 4) {
            if ceiling > minHookSeconds {
                DevelopRangeSlider("On screen", value: seconds, in: minHookSeconds...ceiling, step: 0.5,
                                   reset: resetSeconds, printed: printed(seconds)) { next in
                    writeSeconds(next)
                }
                .accessibilityHint("How long this slide stays on screen")
            } else {
                // Nothing left to choose between: the clip holds the shortest
                // slide and no more. Said, never a slider with no travel.
                ContentFieldRow("On screen") {
                    Text(verbatim: printed(seconds))
                        .font(Brand.mono(12))
                        .foregroundStyle(palette.ink)
                }
            }
            if let hint {
                ContentHint(hint)
            }
        }
    }

    /// Where ↺ puts the length back: the hook's own hold plus a beat, or a
    /// content slide's default — never past what the clip holds.
    private var resetSeconds: Double {
        let wanted = isHook ? defaultHookSeconds(post.badge.durationSeconds) : defaultSlideSeconds
        return min(max(minHookSeconds, wanted), ceiling)
    }

    private func printed(_ value: Double) -> String {
        "\(OverlayPanels.fixed(value, 1)) s"
    }

    private func writeSeconds(_ value: Double) {
        if isHook {
            model.patchBadge { $0.hookSeconds = value }
        } else {
            model.patchSlide { $0.seconds = value }
        }
    }
}

#Preview("Slide delivery") {
    let model = PieceEditorFixtures.model()
    VStack(alignment: .leading) {
        if let post = model.post, let slide = model.slides.dropFirst().first {
            SlideDeliveryRows(model: model, post: post, slide: slide)
        }
    }
    .frame(width: 360)
    .padding(16)
    .darkroom()
}
