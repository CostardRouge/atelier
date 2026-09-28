// The open picture's LOOK — the web's `use-roll-grade.ts`: since roll v5 a
// look is the picture's OWN, like its develop (the maintainer's *"c'est le
// média qui décide"*), so the grade panel follows the filmstrip, edits the
// picture that is open and writes back to that picture only.
//
// Where the web keeps a live stack and writes its saved form back when it
// settles, the app's panel edits the stored look directly
// (`Look/GradeStackView.swift`), so there is nothing to agree and nothing to
// race: every write goes through the ONE updater (`update`) — one undo step,
// merged while the same picture is worked on — and an empty look is stored
// as nil, the roll reader's one spelling of "no look". A look is never
// inherited by the next picture; `Apply look to…` (`lookApplyVerbs`) is the
// one way to dress others with it.

import SwiftUI
import AtelierKit

extension RollEditor {
    /// The open picture's look, as the grade panel edits it.
    var gradeBinding: Binding<RollGrade?> {
        Binding(
            get: { self.picture?.grade },
            set: { value in
                guard let id = self.openId else { return }
                let stored = storedLook(value)
                self.update { roll in
                    guard let current = roll.pictures.first(where: { $0.id == id }), current.grade != stored else {
                        return roll
                    }
                    return patchPicture(roll, id) { $0.grade = stored }
                }
            }
        )
    }

    /// The picture on the stage, handed to the look gallery so its SCENE
    /// grades THIS photograph rather than a reference frame — the source as
    /// decoded, before its develop: the scene shows the look alone, and says so.
    var lookPicture: LookPicture? {
        guard let picture, let read = pool.held(picture.id) else { return nil }
        let decoded = read.decoded
        return LookPicture(image: decoded.image, label: picture.ref.name,
                           key: "\(picture.id)|\(decoded.width)x\(decoded.height)")
    }

    /// The stage render's own height in pixels — what tells the texture
    /// section whether its grain can be SEEN here.
    var lookPreviewHeight: Double? {
        stageSize.height > 0 ? Double(stageSize.height) : nil
    }

    /// Whether the stage draws the look (and so its grain) — while the stage
    /// says it does not, the texture's dials say so too, never a dead slider.
    var lookPreviewDraws: Bool {
        !unrendered.contains("look")
    }
}
