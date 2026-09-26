// Photo EXIF — `src/tools/exif/ExifTool.tsx`: the photographs on the
// instruments' shelf as a gallery of cards, and one of them opened on its full
// metadata. Only the head of each file is read to parse it; nothing is
// uploaded. A RAW and its JPEG are one photograph, as the web's library
// groups them (`buildAssets`), and the full view says the other half is there.

import SwiftUI
import AtelierKit

struct ExifToolView: View {
    @State private var files = false
    @State private var photos = false
    @State private var opened: String?
    @Environment(\.palette) private var palette

    private var shelf: InstrumentShelf { .shared }

    var body: some View {
        let pictures = shelf.usable(InstrumentTool.exif.accepts).filter { $0.parts.image != nil }
        ScrollView {
            if pictures.isEmpty {
                InstrumentEmpty(text: "Open your photos, then inspect each one here. EXIF is read straight from each file — JPEG and most RAW formats carry it.") {
                    HStack {
                        Button("From Photos…") { photos = true }
                            .buttonStyle(.borderedProminent)
                        Button("From Files…") { files = true }
                            .buttonStyle(.bordered)
                    }
                    .tint(palette.accent)
                }
                .padding(16)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: 24)], spacing: 24) {
                    ForEach(Array(pictures.enumerated()), id: \.element.id) { i, picture in
                        ExifPhotoCard(asset: picture, index: i,
                                      onOpen: { opened = picture.id },
                                      onRemove: { shelf.remove(picture) })
                    }
                }
                .padding(16)
            }
        }
        .background(palette.paper)
        .navigationTitle(InstrumentTool.exif.title)
        .navigationDestination(item: $opened) { id in
            ExifDetailView(assetId: id)
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                InstrumentOpenMenu(title: "Open photos", onPhotos: { photos = true }, onFiles: { files = true })
            }
        }
        .instrumentImporters(files: $files, photos: $photos, types: InstrumentFileTypes.pictures, photoFilter: .images)
        .instrumentProblemAlert()
    }
}

#Preview("Photos") {
    InstrumentFixtures.shelf()
    return NavigationStack { ExifToolView() }
}
