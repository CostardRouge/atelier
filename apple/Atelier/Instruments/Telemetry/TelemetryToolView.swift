// DJI Telemetry — `src/tools/telemetry/TelemetryTool.tsx`: the clips on the
// instruments' shelf as a gallery of cards, and one of them opened full view.
// A video pairs with its `.srt` sibling by name, as the web's library pairs
// them; a clip missing its half offers it, and the half joins by name.
//
// The web keeps the open clip in local state, not a route, because a `File`
// does not survive a reload; here it is a pushed page, and the shelf is a
// session's too.

import SwiftUI
import UniformTypeIdentifiers
import AtelierKit

struct TelemetryToolView: View {
    @State private var files = false
    @State private var photos = false
    @State private var importTypes: [UTType] = InstrumentFileTypes.footage
    @State private var opened: String?
    @Environment(\.palette) private var palette

    private var shelf: InstrumentShelf { .shared }

    var body: some View {
        let clips = shelf.usable(InstrumentTool.telemetry.accepts)
        ScrollView {
            if clips.isEmpty {
                InstrumentEmpty(text: "Open your footage, then read each clip here. Videos pair with their .srt siblings automatically.") {
                    HStack {
                        Button("From Files…") { openFiles(InstrumentFileTypes.footage) }
                            .buttonStyle(.borderedProminent)
                        Button("From Photos…") { photos = true }
                            .buttonStyle(.bordered)
                    }
                    .tint(palette.accent)
                }
                .padding(16)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: 24)], spacing: 24) {
                    ForEach(Array(clips.enumerated()), id: \.element.id) { i, clip in
                        TelemetryClipCard(
                            asset: clip,
                            index: i,
                            onOpen: { opened = clip.id },
                            onAdd: { video in openFiles(video ? TelemetryToolView.videoTypes : [InstrumentFileTypes.srt]) },
                            onRemove: { shelf.remove(clip) }
                        )
                    }
                }
                .padding(16)
            }
        }
        .background(palette.paper)
        .navigationTitle(InstrumentTool.telemetry.title)
        .navigationDestination(item: $opened) { id in
            TelemetryDetailView(assetId: id)
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                InstrumentOpenMenu(title: "Open footage",
                                   onPhotos: { photos = true },
                                   onFiles: { openFiles(InstrumentFileTypes.footage) })
            }
        }
        .instrumentImporters(files: $files, photos: $photos, types: importTypes, photoFilter: .videos)
        .instrumentProblemAlert()
    }

    static let videoTypes: [UTType] = [.movie, .mpeg4Movie, .quickTimeMovie]

    private func openFiles(_ types: [UTType]) {
        importTypes = types
        files = true
    }
}

extension View {
    /// Say once, in an alert, a file the shelf could not read.
    func instrumentProblemAlert() -> some View {
        modifier(InstrumentProblemAlert())
    }
}

private struct InstrumentProblemAlert: ViewModifier {
    func body(content: Content) -> some View {
        let shelf = InstrumentShelf.shared
        return content.alert("Could not open", isPresented: Binding(get: { shelf.problem != nil },
                                                                  set: { if !$0 { shelf.problem = nil } })) {
            Button("OK") { shelf.problem = nil }
        } message: {
            Text(shelf.problem ?? "")
        }
    }
}

#Preview("Gallery") {
    InstrumentFixtures.shelf()
    return NavigationStack { TelemetryToolView() }
}
