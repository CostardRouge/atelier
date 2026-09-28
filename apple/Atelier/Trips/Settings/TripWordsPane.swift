// ⚙ Trip → Words — every word the badge can say, the web's "words" pane of
// `TripSettingsModal.tsx`: the English / Français presets, the five badge
// words (`wordFields`), the temporal line's (`timeAgoWordFields`), and the
// camera credit's ("Shot on" and one tag per `cameraFields`).
//
// Rules kept (`roadtrip.md`, «Badge copy is English by default»):
// - Every word is an editable field ON THE TRIP, English only by default: a
//   deck in another language is these fields, not a second vocabulary.
// - The trip is written on every keystroke (`store.change`, one undo step per
//   burst of typing under one label), never on a button.
// - A camera word keeps what was TYPED, blanks included — a field that
//   snapped back to its default the moment it was emptied could not be
//   retyped; the drawing reads a blank as the default (`cameraWordsOf`).
// - "English" writes the web's `DEFAULT_BADGE_WORDS`, which carries no camera
//   words, so the credit falls back to its English defaults too.
//
// Native addition (asked by the port's brief, not in the web's sheet): the
// trip's CAMERA NAMES, listed whole. The web edits one alias at a time from a
// piece's Camera panel; here every body the trip renamed is listed, its name
// edited or forgotten. A blank name is kept while typing and reads as the
// body's own (`cameraFacts`); the × forgets it.

import SwiftUI
import AtelierKit

struct TripWordsPane: View {
    let trip: TripDoc
    let write: (TripDoc) -> Void
    @Environment(\.palette) private var palette

    private let columns = [GridItem(.adaptive(minimum: 280), spacing: 24, alignment: .leading)]

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            TripSettingsLegend("Words", paragraphs: [
                "Every word the badge can say. English is only the default — a deck in another language is these fields, not a second vocabulary in the code.",
                "“{n}” is replaced by the quantity, “{date}” by the picture’s own day.",
            ])
            HStack(spacing: 8) {
                Button("English") { setAll(defaultBadgeWords) }
                    .buttonStyle(DevelopPillButtonStyle())
                Button("Français") { setAll(frenchBadgeWords) }
                    .buttonStyle(DevelopPillButtonStyle())
            }
            LazyVGrid(columns: columns, alignment: .leading, spacing: 10) {
                ForEach(wordFields, id: \.key) { field in
                    TripWordRow(field.label, text: TripWordsPane.word(trip.badgeWords, field.key)) { value in
                        var next = trip
                        next.badgeWords = TripWordsPane.withWord(trip.badgeWords, field.key, value)
                        write(next)
                    }
                }
            }
            Eyebrow("Time")
            LazyVGrid(columns: columns, alignment: .leading, spacing: 10) {
                ForEach(timeAgoWordFields, id: \.key) { field in
                    TripWordRow(field.label, text: trip.badgeWords.time[field.key]) { value in
                        var next = trip
                        next.badgeWords.time[field.key] = value
                        write(next)
                    }
                }
            }
            Eyebrow("Camera credit")
            cameraCredit
            cameraNames
        }
    }

    // MARK: - the camera credit

    /// What was typed, blanks included, over the English defaults.
    private var cameraWords: CameraWords {
        let stored = trip.badgeWords.camera
        var tags = defaultCameraWords.tags
        for (field, word) in stored?.tags ?? [:] { tags[field] = word }
        return CameraWords(shotOn: stored?.shotOn ?? defaultCameraWords.shotOn, tags: tags)
    }

    private var cameraCredit: some View {
        let words = cameraWords
        return LazyVGrid(columns: columns, alignment: .leading, spacing: 10) {
            TripWordRow("Shot on", text: words.shotOn) { value in
                var next = words
                next.shotOn = value
                setCamera(next)
            }
            ForEach(cameraFields, id: \.id) { info in
                TripWordRow(info.label, text: words.tags[info.id] ?? "") { value in
                    var next = words
                    next.tags[info.id] = value
                    setCamera(next)
                }
            }
        }
    }

    private func setCamera(_ words: CameraWords) {
        var next = trip
        next.badgeWords.camera = words
        write(next)
    }

    private func setAll(_ words: BadgeWords) {
        var next = trip
        next.badgeWords = words
        write(next)
    }

    // MARK: - the camera names (native addition)

    @ViewBuilder
    private var cameraNames: some View {
        let names = trip.cameraNames ?? [:]
        let bodies = names.keys.sorted()
        Eyebrow("Camera names")
        if bodies.isEmpty {
            DevelopNote(paragraphs: [
                "No camera renamed yet. A piece’s Camera panel names the body its picture was taken with — a DJI still says FC8482, and this trip can call it what you do.",
            ])
        } else {
            DevelopNote(paragraphs: [
                "What this trip’s badges call each camera body, keyed by the name its files give. A blank name credits the body as its files do.",
            ])
            VStack(alignment: .leading, spacing: 10) {
                ForEach(bodies, id: \.self) { camera in
                    HStack(spacing: 10) {
                        Text(verbatim: camera)
                            .font(Brand.mono(12))
                            .foregroundStyle(palette.inkSoft)
                            .lineLimit(1)
                            .truncationMode(.middle)
                            .frame(width: 104, alignment: .leading)
                        TripWordField(label: "Name for \(camera)", text: names[camera] ?? "") { value in
                            var next = trip
                            var table = names
                            table[camera] = value
                            next.cameraNames = table
                            write(next)
                        }
                        Button {
                            var next = trip
                            var table = names
                            table.removeValue(forKey: camera)
                            next.cameraNames = table
                            write(next)
                        } label: {
                            Image(systemName: "xmark")
                                .font(Brand.sans(11, weight: .semibold))
                                .foregroundStyle(palette.muted)
                                .frame(width: 26, height: 26)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .help("Forget this name")
                        .accessibilityLabel("Forget the name for \(camera)")
                    }
                }
            }
            .frame(maxWidth: 560, alignment: .leading)
        }
    }

    // MARK: - the five words by key

    /// One of the badge's five words — the web's `trip.badgeWords[f.key]`.
    static func word(_ words: BadgeWords, _ key: BadgeWordKey) -> String {
        switch key {
        case .day: return words.day
        case .days: return words.days
        case .of: return words.of
        case .at: return words.at
        case .pin: return words.pin
        }
    }

    /// The words with one of the five rewritten.
    static func withWord(_ words: BadgeWords, _ key: BadgeWordKey, _ value: String) -> BadgeWords {
        var out = words
        switch key {
        case .day: out.day = value
        case .days: out.days = value
        case .of: out.of = value
        case .at: out.at = value
        case .pin: out.pin = value
        }
        return out
    }
}

/// A label and its word, the label in a fixed column — the web's word row.
private struct TripWordRow: View {
    let label: String
    let text: String
    let onChange: (String) -> Void
    @Environment(\.palette) private var palette

    init(_ label: String, text: String, onChange: @escaping (String) -> Void) {
        self.label = label
        self.text = text
        self.onChange = onChange
    }

    var body: some View {
        HStack(spacing: 10) {
            Text(verbatim: label)
                .font(Brand.sans(12))
                .foregroundStyle(palette.muted)
                .lineLimit(2)
                .frame(width: 104, alignment: .leading)
            TripWordField(label: label, text: text, onChange: onChange)
        }
    }
}

/// One word, typed as it is: no capital forced on "of", no correction of "sur".
private struct TripWordField: View {
    let label: String
    let text: String
    let onChange: (String) -> Void

    var body: some View {
        TextField(label, text: Binding(get: { text }, set: { onChange($0) }))
            .textFieldStyle(.roundedBorder)
            .font(Brand.sans(14))
            #if os(iOS)
            .textInputAutocapitalization(.never)
            #endif
            .autocorrectionDisabled()
            .frame(maxWidth: .infinity)
    }
}

// MARK: - previews

private struct TripWordsPreview: View {
    let store: TripsStore

    var body: some View {
        ScrollView {
            if let trip = store.trip(TripSettingsFixtures.tripId) {
                TripWordsPane(trip: trip) { store.change($0, label: "trip:words") }
                    .padding(24)
            }
        }
        .frame(minWidth: 360, minHeight: 640)
        .background(Palette.paper.surface)
    }
}

#Preview("Words") { TripWordsPreview(store: TripSettingsFixtures.store()) }
