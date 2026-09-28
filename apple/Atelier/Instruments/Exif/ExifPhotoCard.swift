// One photograph in the Photo EXIF gallery — `src/tools/exif/PhotoCard.tsx`:
// its number, a GPS chip when it is geotagged, its preview, its name, type and
// weight, and the three lines a photographer reads at speed (the body, the
// exposure triplet, the moment the shutter fired — never the file's date).
//
// A RAW's preview is DRAWN here, where the web says "preview unavailable
// (browser can't decode it)": ImageIO reads the render inside the file.

import SwiftUI
import AtelierKit

struct ExifPhotoCard: View {
    let asset: Asset
    let index: Int
    let onOpen: () -> Void
    let onRemove: () -> Void

    @State private var preview = PicturePreview()
    @Environment(\.palette) private var palette

    private var shelf: InstrumentShelf { .shared }
    private var reads: ExifReads { .shared }

    var body: some View {
        let image = asset.parts.image
        let read = image.flatMap { reads.read(for: $0) }
        let exif = read?.effective.exif
        let typeLabel = imageTypeLabel(image?.name ?? "")

        VStack(alignment: .leading, spacing: 0) {
            ZStack {
                palette.frame
                if let picture = preview.image {
                    Image(decorative: picture, scale: 1)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                } else {
                    Text(preview.failed ? "\(typeLabel) — preview unavailable on this device" : "…")
                        .font(Brand.mono(12))
                        .foregroundStyle(palette.muted)
                        .multilineTextAlignment(.center)
                        .padding()
                }
            }
            .aspectRatio(4 / 3, contentMode: .fit)
            .clipped()
            .overlay(alignment: .topLeading) {
                MediaChip(text: "NO. " + String(format: "%02d", index + 1)).padding(10)
            }
            .overlay(alignment: .topTrailing) {
                if exif?.gps != nil { MediaChip(text: "GPS", dot: true).padding(10).help("Geotagged") }
            }

            VStack(alignment: .leading, spacing: 10) {
                Text(asset.baseName)
                    .font(Brand.sans(16, weight: .semibold))
                    .foregroundStyle(palette.ink)
                    .lineLimit(1)
                    .truncationMode(.middle)
                HStack(spacing: 8) {
                    Text(typeLabel)
                    Text("·").foregroundStyle(palette.faint)
                    Text(formatBytes(image?.size ?? 0))
                }
                .font(Brand.mono(12))
                .foregroundStyle(palette.muted)

                if let exif {
                    if exif.isEmpty {
                        Text("No EXIF metadata.").font(Brand.sans(14)).foregroundStyle(palette.muted)
                    } else {
                        VStack(alignment: .leading, spacing: 4) {
                            if let camera = cameraLine(exif) {
                                Text(camera).font(Brand.sans(14, weight: .medium)).foregroundStyle(palette.ink).lineLimit(1)
                            }
                            if let exposure = exposureLine(exif) {
                                Text(exposure).font(Brand.mono(12)).monospacedDigit().foregroundStyle(palette.inkSoft)
                            }
                            // The shutter's own moment, not the file's date.
                            if let captured = formatCaptured(exif.dateTimeOriginal) {
                                let via = read?.effective.file.isEmpty == true ? read?.effective.via : nil
                                Text(via.map { "\(captured) · via \($0)" } ?? captured)
                                    .font(Brand.mono(12)).monospacedDigit().foregroundStyle(palette.muted)
                            }
                        }
                    }
                } else {
                    Text("Reading EXIF…").font(Brand.sans(14)).foregroundStyle(palette.muted)
                }
                Spacer(minLength: 0)
                Button(action: onOpen) {
                    Text("View metadata").font(Brand.sans(14, weight: .semibold)).frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.capsule)
                .tint(palette.ink)
                .controlSize(.large)
            }
            .padding(EdgeInsets(top: 16, leading: 18, bottom: 18, trailing: 18))
        }
        .background(palette.surface)
        .clipShape(RoundedRectangle(cornerRadius: Brand.paperRadius))
        .overlay(RoundedRectangle(cornerRadius: Brand.paperRadius).stroke(palette.line, lineWidth: 1))
        .contextMenu {
            Button(role: .destructive, action: onRemove) { Label("Remove from the instruments", systemImage: "minus.circle") }
        }
        .task(id: image?.name) {
            guard let image, let url = shelf.url(for: image) else { return }
            // The metadata first — it is a slice of the head and answers at
            // once; the preview decodes after it.
            await reads.load(image, from: url)
            await preview.load(url, maxPixel: 640)
        }
    }
}

#Preview("Photo card") {
    InstrumentFixtures.shelf()
    ExifReads.shared.seed(InstrumentFixtures.photoRef, ExifPhotoRead(
        effective: EffectiveExif(exif: InstrumentFixtures.exif, file: InstrumentFixtures.exif, via: nil),
        raw: nil, rawSizes: nil, shownWidth: 7008, shownHeight: 4672))
    let photo = InstrumentShelf.shared.usable([.photo]).first!
    return ExifPhotoCard(asset: photo, index: 2, onOpen: {}, onRemove: {})
        .frame(width: 300)
        .padding()
}
