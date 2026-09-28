// The deck and its transport as ONE band under the picture — «Aiguille», the
// maintainer's pick of 2026-09-14 (`roadtrip.md`): the web's `DeckStrip.tsx`
// with the band's half of `use-deck-transport.ts` and `use-hook-sound.ts`.
//
// The needle never moves: the piece slides under it (`PieceDeckStrip`), and
// the slide under the needle IS the open slide. ▶ plays the whole piece on the
// stage, slide after slide, and LOOPS — over the piece, or over the open
// slide alone when the loop pill (or `L`) says so; the clock that does it is
// the landed `PieceDeckClock`, driven here through the model's verbs. What
// the three things this band replaced carried is still here: a clip's cut
// opens the Studio's own trim bar IN the band (✂, `StudioTrimBar`, looping
// its stretch while open; `I` / `O` cut at the playhead), its speed is a pill
// on the row, and the deck's verbs (move, remove, the closing card) sit
// behind ⋯ with +.
//
// It also HEARS the opener (`PieceHookSound`): off by default, `M` or the
// ticks pill turns it on, and each pass starts with the transport on the hook
// and again each time the loop comes round. And it keeps each slide's
// thumbnail as delivered (`PieceRailThumbs`), which its cells tile.

import SwiftUI
import AtelierKit

/// What the opener's sound follows, frame by frame.
private struct PieceSoundInput: Equatable {
    var score: [SoundEvent]
    var running: Bool
    var time: Double
}

struct PieceDeckBand: View {
    let model: PieceEditorModel
    let compact: Bool

    @State private var driver = PieceStripDriver()
    @State private var thumbs = PieceRailThumbs()
    @State private var sound = PieceHookSound()
    @Environment(\.palette) private var palette

    var body: some View {
        let score = sound.score(of: model)
        let hasSound = model.isHook && !score.isEmpty
        let hearing = PieceSoundInput(score: hasSound ? score : [],
                                      running: model.isHook && model.stagePlaying && model.soundOn,
                                      time: model.badgeTime)
        return VStack(spacing: 6) {
            PieceTransportRow(model: model, compact: compact, shown: driver.held ?? model.deck.time,
                              hasSound: hasSound)
            if model.trimOpen {
                trimBar
            } else {
                PieceDeckStrip(model: model, compact: compact, driver: driver, thumbs: thumbs)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("The piece")
        .onChange(of: hearing, initial: true) { _, next in
            sound.update(next.score, running: next.running, time: next.time)
        }
        .onChange(of: railToken, initial: true) { _, _ in thumbs.refresh(model) }
        .onAppear {
            driver.model = model
            driver.pxPerSecond = PieceStripMetrics.pxPerSecond(compact: compact)
        }
        .onDisappear {
            sound.close()
            thumbs.close()
            driver.stop()
        }
    }

    /// The Studio's trim bar in the band's place while the cut is open: the
    /// handles write the in point and the screen time, the playhead seeks.
    private var trimBar: some View {
        let shape = RoundedRectangle(cornerRadius: 10)
        return StudioTrimBar(
            duration: model.duration,
            time: model.playhead,
            range: model.clipRange,
            minLength: PieceEditorModel.minCut,
            step: 1.0 / 30,
            onSeek: { model.setPlayhead($0) },
            onScrub: { scrubbing in if scrubbing { model.setClipPlaying(false) } },
            onRangeChange: { model.setClipRange($0) }
        )
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity)
        .frame(height: PieceStripMetrics.bandHeight)
        .background(shape.fill(palette.paper2))
        .overlay(shape.strokeBorder(palette.line, lineWidth: 1))
    }

    /// What the thumbnails are drawn from moved: the document (its revision),
    /// the opener's pictures and the camera credit, the looks resolved, the
    /// Library's files. Reading the stage's frame re-reads this after every
    /// render — which is when a look resolved by the vault shows.
    private var railToken: String {
        _ = model.stage.frame?.slideKey
        let pool = model.library?.tickKey ?? "-"
        let looks = ObjectIdentifier(model.looks).hashValue
        return "\(model.revision)|\(model.hookInputs)|\(looks)|\(pool)|\(model.hookPictures.count)|\(model.aspect)"
    }
}

#Preview("The band") {
    PieceDeckBand(model: PieceEditorFixtures.model(), compact: false)
        .frame(width: 640)
        .padding(16)
        .darkroom()
}

#Preview("The band, on a phone") {
    PieceDeckBand(model: PieceEditorFixtures.model(), compact: true)
        .frame(width: 374)
        .padding(8)
        .darkroom()
}
