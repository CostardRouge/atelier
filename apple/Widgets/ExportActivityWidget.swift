// The export's Live Activity, three presentations from the design canvas:
// the Lock Screen (and the banner that shows it on a phone without an
// island), the Dynamic Island's compact pair and its expanded face. The
// minimal face — the island shared with another app's activity — is the ring.
//
// Rules kept (`tasks.md`, the web's `TaskEdge` and `TaskPill`):
// - A length nobody measured is never drawn as a fill: a still quarter and
//   the time elapsed (a Live Activity cannot animate a sweep, and a timer the
//   system counts is the one honest motion it has).
// - The words are the task's own: its label, its detail, "N running".
// - An ended run says how it ended — Finished, or stopped with what was
//   kept — and stays a few minutes when it ended while he was away.
// - An activity the app stopped feeding (it was suspended or killed) goes
//   STALE after a minute and says so rather than showing a frozen bar.
//
// [verify on device]: none of it has been seen; the extension is compiled by
// CI's iOS build only. The layout inside the island's regions is reasoned,
// not measured against a real island.

import ActivityKit
import SwiftUI
import WidgetKit

struct ExportActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ExportActivityAttributes.self) { context in
            ExportLockScreenView(context: context)
                .activityBackgroundTint(ExportBrand.paper)
                .activitySystemActionForegroundColor(ExportBrand.ink)
        } dynamicIsland: { context in
            ExportIsland.make(context)
        }
    }
}

/// The Dynamic Island's faces, built apart so the configuration stays short.
enum ExportIsland {
    static func make(_ context: ActivityViewContext<ExportActivityAttributes>) -> DynamicIsland {
        DynamicIsland {
            DynamicIslandExpandedRegion(.leading) {
                ExportRing(state: context.state, tint: ExportBrand.vermilionNight, size: 30)
                    .padding(.leading, 4)
            }
            DynamicIslandExpandedRegion(.trailing) {
                ExportFigure(context: context, tint: ExportBrand.paper, size: 15)
                    .padding(.trailing, 4)
            }
            DynamicIslandExpandedRegion(.center) {
                Text(context.state.title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(ExportBrand.paper)
                    .lineLimit(1)
            }
            DynamicIslandExpandedRegion(.bottom) {
                ExportIslandBottom(context: context)
            }
        } compactLeading: {
            ExportRing(state: context.state, tint: ExportBrand.vermilionNight, size: 16)
        } compactTrailing: {
            ExportFigure(context: context, tint: ExportBrand.paper, size: 13)
                .frame(maxWidth: 48)
        } minimal: {
            ExportRing(state: context.state, tint: ExportBrand.vermilionNight, size: 16)
        }
        .keylineTint(ExportBrand.vermilionNight)
    }
}

/// The expanded island's lower band: the detail, then the bar.
struct ExportIslandBottom: View {
    let context: ActivityViewContext<ExportActivityAttributes>

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(ExportWords.detail(context))
                .font(.system(size: 12))
                .foregroundStyle(ExportBrand.paper.opacity(0.7))
                .lineLimit(1)
            ExportBar(state: context.state, tint: ExportBrand.vermilionNight)
                .frame(height: 4)
        }
        .padding(.horizontal, 4)
        .padding(.bottom, 4)
    }
}
