// One photograph, full view — `src/tools/exif/DetailView.tsx`: a large
// preview beside the complete panels, its name, type and weight above. When
// the file states no pixel size, the decoded picture's own fills the Image
// panel; when it carries no EXIF at all, the page says so rather than
// showing a column of dashes as if it had looked and found nothing wrong.

import SwiftUI
import AtelierKit

struct ExifDetailView: View {
    let assetId: String
    @State private var preview = PicturePreview()
    @Environment(\.palette) private var palette
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    private var sideBySide: Bool { sizeClass != .compact }
    #else
    private let sideBySide = true
    #endif

    private var shelf: InstrumentShelf { .shared }
    private var reads: ExifReads { .shared }

    var body: some View {
        let asset = shelf.assets.first { $0.id == assetId }
        let image = asset?.parts.image
        let read = image.flatMap { reads.read(for: $0) }
        let typeLabel = imageTypeLabel(image?.name ?? "")

        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(image?.name ?? asset?.baseName ?? "")
                        .font(Brand.display(34))
                        .foregroundStyle(palette.ink)
                        .textSelection(.enabled)
                    HStack(spacing: 8) {
                        Text(typeLabel)
                        Text("·").foregroundStyle(palette.faint)
                        Text(formatBytes(image?.size ?? 0))
                        if let siblings = asset.map({ siblingTypes($0.parts) }), !siblings.isEmpty {
                            Text("·").foregroundStyle(palette.faint)
                            Text("+ " + siblings.joined(separator: " + "))
                        }
                    }
                    .font(Brand.mono(12))
                    .foregroundStyle(palette.muted)
                }

                let layout = sideBySide
                    ? AnyLayout(HStackLayout(alignment: .top, spacing: 24))
                    : AnyLayout(VStackLayout(alignment: .leading, spacing: 24))
                layout {
                    previewPane(typeLabel: typeLabel)
                        .frame(maxWidth: sideBySide ? CGFloat(560) : CGFloat.infinity)
                    VStack(alignment: .leading, spacing: 14) {
                        if let read {
                            if read.effective.exif.isEmpty {
                                InstrumentNotice(text: "No EXIF metadata found in this file. Dimensions (if shown) come from the decoded image.")
                            }
                            // Where the values came from, when not from the
                            // bytes on screen — never today (a file opened
                            // here speaks for itself), kept for the day a
                            // source vouches for a proxy's missing EXIF.
                            if let via = read.effective.via, !read.effective.exif.isEmpty, read.effective.file.isEmpty {
                                InstrumentNotice(text: "This file is \(via)’s editing rendition and carries no EXIF of its own. The values below are what \(via) read from the original capture.")
                            }
                            ExifPanels(data: read.panelData, raw: read.raw, rawSizes: read.rawSizes)
                        } else {
                            Text("Reading EXIF…").font(Brand.sans(14)).foregroundStyle(palette.muted)
                        }
                    }
                }
            }
            .padding(16)
        }
        .background(palette.paper)
        .navigationTitle(asset?.baseName ?? InstrumentTool.exif.title)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task(id: image?.name) {
            guard let image, let url = shelf.url(for: image) else { return }
            await reads.load(image, from: url)
            await preview.load(url, maxPixel: 2048)
        }
    }

    private func previewPane(typeLabel: String) -> some View {
        ZStack {
            palette.frame
            if let picture = preview.image {
                Image(decorative: picture, scale: 1)
                    .resizable()
                    .interpolation(.high)
                    .aspectRatio(contentMode: .fit)
            } else if preview.failed {
                Text("\(typeLabel) — this device can't decode a preview. The metadata beside it is still read straight from the file.")
                    .font(Brand.mono(12))
                    .foregroundStyle(palette.muted)
                    .multilineTextAlignment(.center)
                    .padding(32)
            } else {
                ProgressView().tint(palette.onMedia)
            }
        }
        .frame(minHeight: 200)
        .clipShape(RoundedRectangle(cornerRadius: Brand.paperRadius))
        .overlay(RoundedRectangle(cornerRadius: Brand.paperRadius).stroke(palette.line, lineWidth: 1))
    }
}

#Preview("Metadata") {
    InstrumentFixtures.shelf()
    ExifReads.shared.seed(InstrumentFixtures.photoRef, ExifPhotoRead(
        effective: EffectiveExif(exif: InstrumentFixtures.exif, file: InstrumentFixtures.exif, via: nil),
        raw: nil, rawSizes: nil, shownWidth: 7008, shownHeight: 4672))
    return NavigationStack { ExifDetailView(assetId: "dsc00123") }
}
