// What the Crop tab keeps that the ROLL does not say — the web's
// `use-crop-zone.ts` state, minus the zone itself.
//
// The zone is DERIVED from what the roll stores (the aspect and the framing),
// never kept beside it (`develop-roll.md`, «The crop is a ZONE»): an undo, a
// batch verb or a copy from another device moves it with no wiring. What is
// kept here is only what the document does not say:
//
// - which chip is lit — Free and a preset can store the same ratio;
// - the INTENT a rotation shrinks from (the zone last DRAWN), and what this
//   session last WROTE, to tell its own writes from an undo or a batch — after
//   which the intent is re-read from the zone on screen;
// - the dense grid's moment after the angle moved, the Level tool armed;
// - how closely the crop STAGE looks (`CropView`, inspection only);
// - the Borders section's memory of the last border this visit, and whether
//   its two margins move together.
//
// It is the web's hook, which is keyed per picture: the editor re-seeds it
// when another picture is opened (`RollEditor.ensureCropSession`), so a chip
// or a view never follows the author to the next picture — and a picture read
// BEFORE it is re-seeded answers with its own opening chip, never this one's.

import Foundation
import Observation
import AtelierKit

@MainActor
@Observable
final class CropSession {
    /// The picture this state is about. Any other picture reads as fresh.
    var pictureId: String?
    /// The lit format chip — `free`, `original` or a preset id.
    var chip: CropChip = "free"
    /// The zone last DRAWN (not fitted after a rotation) — what a straighten shrinks from.
    @ObservationIgnored var intent: CropZone?
    /// What this session last wrote: the aspect and the framing.
    @ObservationIgnored var writtenAspect: String?
    @ObservationIgnored var writtenFraming: Framing?
    /// True for a moment after the angle moved — the stage draws its dense grid.
    var rotating = false
    @ObservationIgnored var rotatingTask: Task<Void, Never>?
    /// The Level tool is armed: the next drag on the stage draws a line.
    var levelling = false
    /// How closely the crop stage looks — held inside `box` on every write.
    var view: CropView = .fit
    /// The crop stage's measured size, in points; nil while unmeasured.
    @ObservationIgnored var box: AtelierKit.Size?
    /// The stage render on screen when the crop tool went up — the CROPPED
    /// picture, which the stage replaces with the whole one on its next render.
    /// The crop stage never draws it as if it were whole.
    @ObservationIgnored var framedStage: ObjectIdentifier?
    /// What turning the border back ON restores: the last one this picture
    /// wore in this visit, not the default — off and on is a comparison.
    @ObservationIgnored var lastBorder: RollBorder?
    /// The two margins move together.
    var linkedMargins = true

    /// How long the dense grid stays after the angle last moved (the web's `ROTATING_MS`).
    static let rotatingNanos: UInt64 = 700_000_000

    /// Back to a fresh picture's state.
    func reseed(for id: String?, chip: CropChip, border: RollBorder?) {
        pictureId = id
        self.chip = chip
        intent = nil
        writtenAspect = nil
        writtenFraming = nil
        rotatingTask?.cancel()
        rotating = false
        levelling = false
        view = .fit
        lastBorder = border
        linkedMargins = border.map { $0.margin.x == $0.margin.y } ?? true
    }

    /// The dense grid, for a moment.
    func pulse() {
        rotating = true
        rotatingTask?.cancel()
        rotatingTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: CropSession.rotatingNanos)
            guard !Task.isCancelled else { return }
            self?.rotating = false
        }
    }
}
