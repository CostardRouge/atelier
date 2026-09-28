// ⚙ Trip → House style — READ-ONLY here. On the web this pane exists on the
// dev server alone (`HouseStylePanel.tsx`): saving writes
// `src/shared/roadtrip/house-style.json` into the REPOSITORY, to be committed
// so the deployed site's new trips start from it. This app has no repository
// to write into, so the writer is not ported; the pane says so, and shows
// what this trip's look would carry if it were saved there — the same rows the
// web's panel draws (`houseStyleFrom`, `rowsOf`), and what it would leave out.

import SwiftUI
import AtelierKit

struct HouseStylePane: View {
    let trip: TripDoc
    @Environment(\.palette) private var palette

    var body: some View {
        let snapshot = houseStyleFrom(trip)
        let rows = HouseStylePane.rows(snapshot.file.style)
        return VStack(alignment: .leading, spacing: 14) {
            TripSettingsLegend("House style", paragraphs: [
                "The house style is the look a new trip starts from: its words, title style, closing card, the look saved for each kind of piece, its grade and its car. Never its name, dates, legs or pieces, nor the pictures an opener was given. Trips that already exist never change.",
            ])
            Text("Saving a trip’s look as the house style writes \(houseStylePath) into the repository, from the web app’s dev server alone. This app cannot write it; here is what this trip’s look would carry.")
                .font(Brand.sans(12))
                .foregroundStyle(palette.inkSoft)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .frame(maxWidth: 560, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: Brand.controlRadius).fill(palette.paper))
                .overlay(RoundedRectangle(cornerRadius: Brand.controlRadius).strokeBorder(palette.line, lineWidth: 1))
            VStack(alignment: .leading, spacing: 0) {
                ForEach(rows, id: \.label) { row in
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Text(verbatim: row.label)
                            .font(Brand.sans(12))
                            .foregroundStyle(palette.muted)
                            .frame(width: 104, alignment: .leading)
                        Text(verbatim: row.value)
                            .font(Brand.sans(13))
                            .foregroundStyle(palette.ink)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(.vertical, 8)
                    Hairline()
                }
            }
            .frame(maxWidth: 560, alignment: .leading)
            if !snapshot.uploadedLooks.isEmpty {
                Text("Left out: \(snapshot.uploadedLooks.joined(separator: ", ")) — an uploaded look carries its whole .cube.")
                    .font(Brand.sans(11))
                    .foregroundStyle(palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    struct Row {
        let label: String
        let value: String
    }

    /// What each block of the style will actually say — the web's `rowsOf`.
    static func rows(_ style: TripHouseStyle) -> [Row] {
        let colour = carColours.first { $0.hex.lowercased() == style.car.color.lowercased() }
        let looks = style.grade.layers.map(\.name)
        let theme = style.theme.map { presetById($0.presetId)?.name ?? $0.presetId } ?? "None"
        let words = [style.badgeWords.day, style.badgeWords.days, style.badgeWords.of, style.badgeWords.at]
        let headline = style.cta.headline.trimmingCharacters(in: .whitespacesAndNewlines)
        let kinds = postKinds.map { kind -> String in
            let state = style.hookDefaults[kind.id] == nil ? "factory" : "saved look"
            return "\(kind.label): \(state)"
        }
        return [
            Row(label: "Title style", value: theme),
            Row(label: "Words", value: words.joined(separator: " · ")),
            Row(label: "Closing card", value: headline.isEmpty ? "(no headline)" : headline),
            Row(label: "New pieces", value: kinds.joined(separator: " · ")),
            Row(label: "Grade", value: looks.isEmpty ? "None" : looks.joined(separator: " + ")),
            Row(label: "Car", value: colour?.name ?? style.car.color),
        ]
    }
}

#Preview("House style") {
    ScrollView {
        HouseStylePane(trip: TripSettingsFixtures.trip())
            .padding(24)
    }
    .frame(minWidth: 360, minHeight: 480)
    .background(Palette.paper.surface)
}
