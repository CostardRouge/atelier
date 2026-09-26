// Compare A/B — `src/tools/compare/CompareTool.tsx`: any two photos or clips
// from the instruments' shelf under one divider, A on the left, B on the
// right. The pair is kept valid as the shelf changes by the kernel's
// `reconcilePair` (a lone item goes in A; the two sides are never one), and
// when a side is a clip ONE transport drives both, so two grades or two takes
// of the same shot line up frame for frame. Only the two compared files are
// ever decoded; nothing is uploaded.

import AVFoundation
import SwiftUI
import AtelierKit

struct CompareToolView: View {
    @State private var aId: String?
    @State private var bId: String?
    @State private var split = 0.5
    @State private var view = ViewState.fitted
    @State private var aPlayback = InstrumentPlayback()
    @State private var bPlayback = InstrumentPlayback()
    @State private var aPicture = PicturePreview()
    @State private var bPicture = PicturePreview()
    @State private var files = false
    @State private var photos = false
    @Environment(\.palette) private var palette

    private var shelf: InstrumentShelf { .shared }

    /// A side resolved: a clip wins over a picture, as the web's `resolveSide`.
    private struct Side {
        let asset: Asset
        let isVideo: Bool
        let url: URL?
    }

    private func side(_ id: String?) -> Side? {
        guard let id, let asset = shelf.assets.first(where: { $0.id == id }) else { return nil }
        if let video = asset.parts.video { return Side(asset: asset, isVideo: true, url: shelf.url(for: video)) }
        if let image = asset.parts.image { return Side(asset: asset, isVideo: false, url: shelf.url(for: image)) }
        return nil
    }

    var body: some View {
        let options = shelf.usable(InstrumentTool.compare.accepts)
        let ids = options.map(\.id)
        let a = side(aId)
        let b = side(bId)
        let hasBoth = a != nil && b != nil
        let hasVideo = (a?.isVideo ?? false) || (b?.isVideo ?? false)

        VStack(spacing: 10) {
            InstrumentBar {
                if options.isEmpty {
                    Text("Open two photos or clips to compare.")
                        .font(Brand.sans(14))
                        .foregroundStyle(palette.muted)
                } else {
                    HStack(spacing: 8) {
                        sideLabel("A")
                        sidePicker(options, selection: $aId, label: "Side A")
                        Button {
                            let previous = aId
                            aId = bId
                            bId = previous
                        } label: {
                            Image(systemName: "arrow.left.arrow.right")
                        }
                        .buttonStyle(.bordered)
                        .buttonBorderShape(.circle)
                        .disabled(!hasBoth)
                        .accessibilityLabel("Swap A and B")
                        .help("Swap A and B")
                        sidePicker(options, selection: $bId, label: "Side B")
                        sideLabel("B")
                        Spacer(minLength: 0)
                        if hasVideo && hasBoth {
                            Text("synced playback")
                                .font(Brand.mono(11))
                                .foregroundStyle(palette.muted)
                        }
                    }
                }
            }

            ZStack {
                if a != nil {
                    CompareStage(a: media(a, playback: aPlayback, picture: aPicture),
                                 b: media(b, playback: bPlayback, picture: bPicture),
                                 aName: a?.asset.baseName, bName: b?.asset.baseName,
                                 natural: natural(a),
                                 split: $split, view: $view)
                    if b == nil {
                        VStack {
                            Spacer()
                            MediaChip(text: "Pick a second asset (B) to compare.").padding(.bottom, 12)
                        }
                    }
                } else {
                    palette.frame
                    Text(options.isEmpty ? "Open two photos or clips." : "Choose A and B above.")
                        .font(Brand.mono(13))
                        .foregroundStyle(palette.muted)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: Brand.controlRadius))
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .frame(minHeight: 260)

            if hasBoth && hasVideo {
                let lead = (a?.isVideo ?? false) ? aPlayback : bPlayback
                InstrumentTransport(playback: lead, showsTimecode: false,
                                    onSeek: { seekBoth($0, a: a, b: b) },
                                    onToggle: { toggleBoth(a: a, b: b) })
            }
        }
        .padding(16)
        .background(palette.paper)
        .navigationTitle(InstrumentTool.compare.title)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                InstrumentOpenMenu(title: "Open", onPhotos: { photos = true }, onFiles: { files = true })
            }
        }
        .onChange(of: ids, initial: true) { _, available in
            let pair = reconcilePair(aId, bId, available)
            if pair.a != aId { aId = pair.a }
            if pair.b != bId { bId = pair.b }
        }
        .task(id: a?.url) { await load(a, playback: aPlayback, picture: aPicture) }
        .task(id: b?.url) { await load(b, playback: bPlayback, picture: bPicture) }
        .onChange(of: aPlayback.time) { _, _ in follow(a: a, b: b) }
        .onDisappear {
            aPlayback.pause()
            bPlayback.pause()
        }
        .instrumentImporters(files: $files, photos: $photos, types: InstrumentFileTypes.media, photoFilter: .any(of: [.images, .videos]))
        .instrumentProblemAlert()
    }

    // MARK: - sides

    private func sideLabel(_ text: String) -> some View {
        Text(text)
            .font(Brand.mono(11, weight: .medium))
            .kerning(1.4)
            .foregroundStyle(palette.accentInk)
    }

    private func sidePicker(_ options: [Asset], selection: Binding<String?>, label: String) -> some View {
        Picker(label, selection: selection) {
            ForEach(options, id: \.id) { option in
                Text(option.baseName).tag(Optional(option.id))
            }
        }
        .labelsHidden()
        .frame(maxWidth: 200)
        .accessibilityLabel(label)
    }

    private func media(_ side: Side?, playback: InstrumentPlayback, picture: PicturePreview) -> CompareMedia {
        guard let side else { return .empty }
        if side.isVideo {
            if playback.failure != nil { return .failed("This clip can't be played on this device.") }
            return .clip(playback.player)
        }
        if picture.failed { return .failed("This file can't be previewed on this device.") }
        return .picture(picture.image)
    }

    /// A's own size — the picture decoded, or the clip's frame — for the pan limits.
    private func natural(_ side: Side?) -> Size? {
        guard let side, !side.isVideo, let image = aPicture.image else { return nil }
        return Size(Double(image.width), Double(image.height))
    }

    private func load(_ side: Side?, playback: InstrumentPlayback, picture: PicturePreview) async {
        guard let side else {
            playback.load(nil)
            return
        }
        if side.isVideo {
            playback.load(side.url)
            playback.player.isMuted = true
        } else {
            playback.load(nil)
            await picture.load(side.url, maxPixel: PictureRenderer.stageLongEdge)
        }
    }

    // MARK: - one transport for two clips

    private func toggleBoth(a: Side?, b: Side?) {
        let playing = aPlayback.playing || bPlayback.playing
        for (side, playback) in [(a, aPlayback), (b, bPlayback)] where side?.isVideo == true {
            if playing { playback.pause() } else { playback.togglePlay() }
        }
    }

    private func seekBoth(_ t: Double, a: Side?, b: Side?) {
        if a?.isVideo == true { aPlayback.seek(to: t) }
        if b?.isVideo == true { bPlayback.seek(to: t) }
    }

    /// B follows A's clock: a drift past a tenth of a second is seeked back.
    private func follow(a: Side?, b: Side?) {
        guard a?.isVideo == true, b?.isVideo == true, aPlayback.playing else { return }
        if abs(bPlayback.time - aPlayback.time) > 0.1 { bPlayback.seek(to: aPlayback.time) }
    }
}

#Preview("Compare") {
    InstrumentFixtures.shelf()
    return NavigationStack { CompareToolView() }
}
