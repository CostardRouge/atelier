// The card a pointer resting on a day shows — the web's `DayCard`
// (`DayHeatmap.tsx`): the day's number, its date, the LEG with its tint as a
// dot (the day's place is what the calendar is swept to remember — a leg
// that names nothing shows its rank alone, never an invented place), the
// kinds told and what went out, or "nothing told yet". Ink on the frame's
// near-black, pointer-transparent, so a sweep across the calendar is never
// interrupted.

import SwiftUI
import AtelierKit

struct DayHoverCard: View {
    let cell: DayCell
    let stage: OverviewDayStage?
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 2) {
                Text("DAY \(cell.dayNumber)")
                    .font(Brand.mono(10))
                    .kerning(1.2)
                    .foregroundStyle(palette.onMedia.opacity(0.62))
                Text(formatIsoDate(cell.date))
                    .font(Brand.sans(14))
                    .foregroundStyle(palette.onMedia)
                if let stage {
                    HStack(spacing: 6) {
                        Circle().fill(OverviewLegTint.color(stage.index)).frame(width: 6, height: 6)
                        Text(stage.line)
                            .font(Brand.sans(12))
                            .foregroundStyle(palette.onMedia.opacity(0.82))
                            .lineLimit(1)
                    }
                }
                told
                    .padding(.top, 2)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(minWidth: 144, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: Brand.paperRadius).fill(palette.frame))
            .shadow(color: Color.black.opacity(0.28), radius: 9, y: 6)
        }
        .accessibilityHidden(true)
    }

    @ViewBuilder
    private var told: some View {
        if cell.posts.isEmpty {
            Text("nothing told yet")
                .font(Brand.mono(10))
                .foregroundStyle(palette.onMedia.opacity(0.62))
        } else {
            VStack(alignment: .leading, spacing: 1) {
                Text(OverviewWords.kinds(cell.posts))
                    .foregroundStyle(palette.onMedia.opacity(0.82))
                Text(OverviewWords.publishedLine(cell))
                    .foregroundStyle(palette.onMedia.opacity(0.62))
            }
            .font(Brand.mono(10))
        }
    }
}

#Preview("Hover card") {
    let fixture = TripOverviewFixtures.trip()
    let coverage = tripCoverage(fixture)
    let told = coverage.days.first { !$0.posts.isEmpty } ?? coverage.days[0]
    HStack(alignment: .top, spacing: 24) {
        DayHoverCard(cell: told, stage: OverviewDayStage(label: "Perth → Kalbarri", index: 0, day: 2, total: 5))
        DayHoverCard(cell: coverage.days[40], stage: nil)
    }
    .padding(40)
}
