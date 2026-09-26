// One roll in the gallery — the web's `RollCard`: the first four pictures'
// thumbnails as a mosaic (what a roll is recognised by), its name, how far it
// has got (`rollProgress`: an ignored picture is in neither number), when it
// last moved, how many wear a look. The WHOLE card opens the roll; the rest
// is behind its ⋯, the destructive verb behind a confirmation that says what
// goes with it — and what does not: the files stay where they are.

import SwiftUI
import AtelierKit

struct RollCard: View {
    let roll: RollDoc
    let isOpen: Bool
    let compact: Bool
    let onOpen: () -> Void
    let onRename: () -> Void
    let onExport: () -> Void
    let onDelete: () -> Void

    @Environment(RollStore.self) private var store
    @Environment(\.palette) private var palette
    @State private var cover: [CGImage] = []
    @State private var confirmingDelete = false

    var body: some View {
        let progress = rollProgress(roll)
        let withLook = roll.pictures.filter { $0.grade != nil }.count
        VStack(alignment: .leading, spacing: 0) {
            RollCover(images: cover, roll: roll)
                .aspectRatio(4 / 3, contentMode: .fit)
                .background(palette.frame)
                .clipShape(UnevenRoundedRectangle(topLeadingRadius: Brand.paperRadius, topTrailingRadius: Brand.paperRadius))
            VStack(alignment: .leading, spacing: compact ? 6 : 8) {
                HStack(spacing: 8) {
                    Text(roll.name.isEmpty ? "Untitled roll" : roll.name)
                        .font(Brand.sans(compact ? 14 : 16, weight: .semibold))
                        .foregroundStyle(palette.ink)
                        .lineLimit(1)
                        .truncationMode(.tail)
                    Spacer(minLength: 0)
                    if isOpen {
                        Text("OPEN")
                            .font(Brand.mono(9))
                            .kerning(0.8)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .foregroundStyle(palette.accentInk)
                            .background(palette.accentWash, in: RoundedRectangle(cornerRadius: 6))
                    }
                    Menu {
                        Button(isOpen ? "Resume" : "Open", action: onOpen)
                        Button("Rename…", action: onRename)
                        Button("Export \(rollFileExtension)", action: onExport)
                        Divider()
                        Button("Delete…", role: .destructive) { confirmingDelete = true }
                    } label: {
                        Image(systemName: "ellipsis")
                            .frame(width: 28, height: 28)
                            .contentShape(Rectangle())
                    }
                    .menuStyle(.button)
                    .buttonStyle(.plain)
                    .menuIndicator(.hidden)
                    .fixedSize()
                    .foregroundStyle(palette.muted)
                    .accessibilityLabel("More actions for \(roll.name)")
                }
                facts(progress: progress, withLook: withLook)
            }
            .padding(compact ? 10 : 14)
        }
        .background(palette.surface, in: RoundedRectangle(cornerRadius: Brand.paperRadius))
        .overlay(
            RoundedRectangle(cornerRadius: Brand.paperRadius)
                .stroke(isOpen ? palette.accent : palette.line, lineWidth: 1)
        )
        .contentShape(RoundedRectangle(cornerRadius: Brand.paperRadius))
        .onTapGesture(perform: onOpen)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Open \(roll.name)")
        .task(id: coverKey) { await loadCover() }
        .confirmationDialog("Delete “\(roll.name)”?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive, action: onDelete)
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Every picture's develop and look go with it. The files stay where they are.")
        }
    }

    private func facts(progress: (total: Int, developed: Int, ignored: Int), withLook: Int) -> some View {
        HStack(spacing: 6) {
            Text(progress.total == 0 ? "empty" : "\(progress.developed) of \(progress.total) developed")
                .foregroundStyle(palette.inkSoft)
            Text("·").foregroundStyle(palette.faint)
            Text(Date(timeIntervalSince1970: roll.updatedAt / 1000), format: .dateTime.day().month(.abbreviated))
            if withLook > 0 {
                Text("·").foregroundStyle(palette.faint)
                Text(withLook == progress.total ? "each with a look" : "\(withLook) with a look")
            }
        }
        .font(Brand.mono(compact ? 10 : 11))
        .foregroundStyle(palette.muted)
        .lineLimit(1)
    }

    private var coverIds: [String] { Array(roll.pictures.prefix(4).map(\.id)) }
    private var coverKey: String { coverIds.joined(separator: "|") + "@\(roll.updatedAt)" }

    private func loadCover() async {
        let ids = coverIds
        let folder = store.thumbsDirectory
        let images = await Task.detached(priority: .utility) { () -> [CGImage] in
            PicturePool.storedThumbnails(ids, in: folder)
        }.value
        cover = images
    }
}

/// The first four thumbnails as a mosaic — one alone, else two columns, a
/// third picture spanning the first column. Words where there is none yet.
struct RollCover: View {
    let images: [CGImage]
    let roll: RollDoc
    @Environment(\.palette) private var palette

    var body: some View {
        GeometryReader { geo in
            if images.isEmpty {
                Text(roll.pictures.isEmpty ? "no pictures yet" : "pictures drawn once opened")
                    .font(Brand.mono(11))
                    .foregroundStyle(palette.muted)
                    .frame(width: geo.size.width, height: geo.size.height)
            } else if images.count == 1 {
                cell(images[0], geo.size)
            } else {
                let half = CGSize(width: (geo.size.width - 1) / 2, height: (geo.size.height - 1) / 2)
                let tall = CGSize(width: half.width, height: geo.size.height)
                HStack(spacing: 1) {
                    if images.count == 2 {
                        cell(images[0], tall)
                        cell(images[1], tall)
                    } else {
                        VStack(spacing: 1) {
                            if images.count == 3 {
                                cell(images[0], tall)
                            } else {
                                cell(images[0], half)
                                cell(images[2], half)
                            }
                        }
                        VStack(spacing: 1) {
                            cell(images[1], half)
                            cell(images[images.count == 3 ? 2 : 3], half)
                        }
                    }
                }
            }
        }
    }

    private func cell(_ image: CGImage, _ size: CGSize) -> some View {
        Image(decorative: image, scale: 1, orientation: .up)
            .resizable()
            .aspectRatio(contentMode: .fill)
            .frame(width: max(0, size.width), height: max(0, size.height))
            .clipped()
    }
}
