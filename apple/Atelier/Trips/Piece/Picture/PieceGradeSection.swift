// The grade of the open picture, through the suite's one look panel — the
// Grade rows of the web's `src/tools/roadtrip/panels/PictureTab.tsx` and its
// `GradeScopeChips` (`roadtrip.md`, «A look sits on one of three rungs, and
// one PICTURE may depart»).
//
// Rules kept:
// - THREE rungs, in order of reach: the trip, this piece, this one picture —
//   because a deck mixing a D-Log clip with a phone photograph cannot wear one
//   conversion LUT. Down a rung seeds from what the picture shows; up drops
//   what is below (`setGradeScope` over the kernel's `moveGradeScope`);
// - the closing card cannot depart (it has no photograph), so its Picture
//   chip is NOT DRAWN rather than drawn dead;
// - the panel edits the look shown on the open picture, on the rung it is on
//   (`writeGrade`); an emptied look on a picture's own rung stays a real
//   departure — the picture that wears no look while the piece wears one;
// - the grade sits on the Picture tab because it is the picture that gets
//   treated, not the typography.

import SwiftUI
import AtelierKit

struct PieceGradeSection: View {
    let model: PieceEditorModel

    private var info: [String] {
        let rung: String
        switch model.gradeScope {
        case .trip:
            rung = "Every piece of the trip that has no grade of its own wears this one — the look that makes the feed read as one journey."
        case .post:
            rung = "This piece’s own look, on every picture of its deck. It started from the trip’s; “Trip” sends it back and drops this one."
        case .slide:
            rung = "This one picture’s own look — for a slide that comes off another camera, or out of another profile, than the rest of the deck. It started from what the piece was wearing; “Piece” sends it back and drops this one."
        }
        var engine = "The preview, the rail, the PNG deck and the hook clip all grade through the same engine, each picture through the grade it wears."
        if model.post?.projectId != nil {
            engine += " A reel exported from the linked Studio project uses that project’s grade, not this one — the Export tab says which."
        }
        return [rung, engine]
    }

    private var badge: String? {
        switch model.gradeScope {
        case .trip: return "Trip"
        case .post: return "Piece"
        case .slide: return nil
        }
    }

    var body: some View {
        DevelopSection(id: "piece.grade", title: "Grade", badge: badge, info: info, remember: .local) {
            OverlayPanelRow("Grade of") {
                PieceGradeScopeChips(model: model)
            }
            GradeStackView(grade: PieceGradeSection.binding(model), picture: stagePicture,
                           previewHeight: Double(model.framePixels.height))
            ForEach(model.lookMissing, id: \.self) { line in
                OverlayPanelHint(line, tone: .problem)
            }
        }
    }

    /// The open picture as the stage decoded it — the look gallery's truest
    /// preview, the look alone on THIS photograph.
    private var stagePicture: LookPicture? {
        guard !model.isCta, let source = model.leadSource, let info = model.leadInfo else { return nil }
        return LookPicture(image: source.image, label: info.name, key: "\(info.url.absoluteString)|\(source.seconds)")
    }

    /// The look shown on the open picture, as the panel edits it; a write
    /// lands on the rung it is on.
    static func binding(_ model: PieceEditorModel) -> Binding<RollGrade?> {
        Binding(
            get: { TripSlideLooks.rollGrade(model.gradeShown) },
            set: { next in model.writeGrade(SavedGrade(next ?? RollGrade())) }
        )
    }
}

/// The chips that say WHOSE grade the stack is editing — the trip's, this
/// piece's, or this one picture's. Three short words: the help says the rest.
struct PieceGradeScopeChips: View {
    let model: PieceEditorModel

    private var scopes: [GradeScope] {
        model.isCta ? [.trip, .post] : [.trip, .post, .slide]
    }

    var body: some View {
        Picker("Grade scope", selection: Binding(get: { model.gradeScope }, set: { model.setGradeScope($0) })) {
            ForEach(scopes, id: \.self) { scope in
                Text(PieceGradeScopeChips.label(scope)).tag(scope)
            }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .help(PieceGradeScopeChips.title(model.gradeScope))
    }

    static func label(_ scope: GradeScope) -> String {
        switch scope {
        case .trip: return "Trip"
        case .post: return "Piece"
        case .slide: return "Picture"
        }
    }

    static func title(_ scope: GradeScope) -> String {
        switch scope {
        case .trip: return "The trip’s grade — worn by every piece that has none of its own"
        case .post: return "This piece’s own grade — every picture of the deck"
        case .slide: return "This one picture’s own grade — the rest of the deck is unchanged"
        }
    }
}

#Preview("Grade") {
    DevelopPreviewState(0) { _ in
        PieceGradeSection(model: PieceEditorFixtures.model())
    }
    .environment(LookLibrary.shared)
}
