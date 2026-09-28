// Telemetry Overlay — `src/tools/overlay/OverlayStudio.tsx`, the web's
// LEGACY page: it places altitude, GPS and exposure readouts on a DJI clip
// and exports an MP4 with them burned in. The Studio does all of it — the
// same overlay engine (`shared/overlay/`: the element list, the style panel,
// the guides, the burn-in export), the same look picker — and more: plain
// clips and photos, intro and outro, timing, variants. The web keeps the
// page only "until the Studio absorbs it" (`docs/memory/studio.md`, phase 4:
// "don't polish it"), so the native app starts where the web is going: a
// pointer to the Studio, never a second copy of its editor.

import SwiftUI
import AtelierKit

struct OverlayMovedView: View {
    @Environment(\.palette) private var palette
    @Environment(\.shellNavigate) private var navigate

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Eyebrow(InstrumentTool.overlay.subtitle)
                Text("Moved to the Studio")
                    .font(Brand.display(34))
                    .foregroundStyle(palette.ink)
                Text("Placing altitude, GPS and exposure readouts on a DJI clip, then exporting an MP4 with the telemetry burned in, is the Studio's work now. It does everything this page did — the same elements, the same style panel, the same look and the same export — and takes plain clips and photos too.")
                    .font(Brand.sans(15))
                    .foregroundStyle(palette.inkSoft)
                    .fixedSize(horizontal: false, vertical: true)
                Text("The web app keeps this page only until the Studio absorbs it; the native app starts where the web is going.")
                    .font(Brand.sans(13))
                    .foregroundStyle(palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
                Button {
                    navigate(.studio)
                } label: {
                    Label("Open the Studio", systemImage: Tool.studio.symbol)
                        .font(Brand.sans(15, weight: .semibold))
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.capsule)
                .tint(palette.ink)
                .controlSize(.large)
            }
            .frame(maxWidth: 560, alignment: .leading)
            .padding(24)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(palette.paper)
        .navigationTitle(InstrumentTool.overlay.title)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}

#Preview("Moved to the Studio") {
    NavigationStack { OverlayMovedView() }
}
