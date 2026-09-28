// The Content tab's three HOOK sections — the web's `panels/ContentTab.tsx`
// «Counter», «Time» and «Camera»: the number the badge leads with, the line
// about when, and what took the picture.
//
// Rules kept (`roadtrip.md`, «Never offer a fabricated example — show the real
// line or the reason»):
// - Every option of a mode's menu reads `<label> · <the line it would really
//   draw for THIS piece>`, or the reason it cannot — the list is one click
//   away — and the chosen one is repeated under the menu, in mono, in ink.
//   A counter mode that cannot count says what is counted meanwhile.
// - The temporal line is worked out for the day the piece goes OUT ("Read
//   on", today unless set), never the clock inside the kernel; `anniversary`
//   is offered only on the real anniversary, and says so otherwise.
// - The marker says the place it would be set before, or that no stage
//   covers the day.
// - The camera credit is measured from the hook picture and never stored
//   (`CameraPlatePanel`).
// - Each standing paragraph folds behind the section's ⓘ.

import SwiftUI
import AtelierKit

// MARK: - Counter

struct PieceCounterSection: View {
    let model: PieceEditorModel
    let trip: TripDoc
    let post: TripPost

    var body: some View {
        let choices = pieceCounterChoices(trip, post)
        let options = choices.map { OverlayPanelOption($0.id, $0.menuLabel) }
        DevelopSection(id: "piece.counter", title: "Counter", info: [
            "The number the badge leads with. Every way of counting says the line it would really draw for this piece, or the reason it cannot draw one.",
        ], remember: .local) {
            ContentFieldRow("Mode") {
                OverlayPanelMenu("Counter", selection: post.badge.mode, options: options) { mode in
                    model.patchBadge { $0.mode = mode }
                }
            } hint: {
                ContentModeHint(hint: pieceCounterHint(choices, post.badge.mode))
            }
            ContentFieldRow("Marker") {
                OverlayPanelToggle("Marker before the place", isOn: post.badge.showPin, words: "Before the place") { on in
                    model.patchBadge { $0.showPin = on }
                }
            } hint: {
                ContentHint(markerHint(pieceMarkerPlace(trip, post)))
            }
        }
    }
}

// MARK: - Time

struct PieceTimeSection: View {
    let model: PieceEditorModel
    let trip: TripDoc
    let post: TripPost

    /// The real today, read by the view — the kernel never reads the clock.
    private var today: IsoDate { todayIso(Date(), in: .current) }

    var body: some View {
        let reference = post.badge.referenceDate ?? today
        let choices = pieceTimeChoices(post.date, reference, trip.badgeWords.time)
        let options = choices.map { OverlayPanelOption($0.id, $0.menuLabel) }
        DevelopSection(id: "piece.time", title: "Time", info: [
            "The line about when, drawn under the place. It is worked out for the day the piece goes out — set that day ahead and it reads correctly then, not now.",
        ], remember: .local) {
            ContentFieldRow("Mode") {
                OverlayPanelMenu("Time", selection: post.badge.timeAgo, options: options) { mode in
                    model.patchBadge { $0.timeAgo = mode }
                }
            } hint: {
                ContentModeHint(hint: pieceTimeHint(choices, post.badge.timeAgo))
            }
            ContentFieldRow("Read on") {
                TripDateField(label: "Read on", value: referenceBinding, min: nil, max: nil)
                if post.badge.referenceDate != nil {
                    Button("Today") { model.patchBadge { $0.referenceDate = nil } }
                        .buttonStyle(DevelopLinkButtonStyle())
                }
            }
        }
    }

    /// The day the line is read on — today until one is set; picking a day
    /// writes it, "Today" clears it.
    private var referenceBinding: Binding<IsoDate> {
        Binding(
            get: { model.post?.badge.referenceDate ?? today },
            set: { next in model.patchBadge { $0.referenceDate = next } }
        )
    }
}

// MARK: - Camera

struct PieceCameraSection: View {
    let model: PieceEditorModel
    let trip: TripDoc
    let post: TripPost
    /// The tab's one focus — the body's name types.
    let focus: FocusState<ContentTextField?>.Binding

    var body: some View {
        DevelopSection(id: "piece.camera", title: "Camera", info: [
            "What took the picture, credited on it. Every value is read from the picture itself and never stored: pick the facts, their order, a layout and where it sits. A picture that records nothing credits nothing.",
        ], remember: .local) {
            CameraPlatePanel(model: model, trip: trip, post: post, focus: focus)
        }
    }
}

#Preview("Counter and time") {
    let model = PieceEditorFixtures.model()
    ScrollView {
        VStack(alignment: .leading, spacing: 0) {
            if let trip = model.trip, let post = model.post {
                PieceCounterSection(model: model, trip: trip, post: post)
                PieceTimeSection(model: model, trip: trip, post: post)
            }
        }
        .padding(16)
    }
    .frame(width: 360, height: 520)
    .darkroom()
}
