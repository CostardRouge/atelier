// One roll in the gallery — the web's `RollCard`: the first four pictures'
// thumbnails as a mosaic (what a roll is recognised by), its name, how far it
// has got (`rollProgress`: an ignored picture is in neither number), when it
// last moved, how many wear a look. The WHOLE card opens the roll; the rest
// is behind its ⋯ — Move to another source among them — the destructive verb
// behind a confirmation that says what goes with it — and what does not: the
// files stay where they are. A roll kept only on an instance is greyed and
// says so; opening it mirrors it first. A card busy crossing a source says
// what it is doing and takes no tap meanwhile.

import SwiftUI
import AtelierKit

struct RollCard: View {
    let roll: RollDoc
    let isOpen: Bool
    /// Kept on an instance and not yet mirrored here: opening mirrors it first.
    var remoteOnly = false
    /// The other sources this roll could move to.
    var moveTargets: [SourceInfo] = []
    /// A sentence while a move, a delete or an open is under way.
    var busy: String?
    let compact: Bool
    let onOpen: () -> Void
    let onRename: () -> Void
    let onExport: () -> Void
    let onDelete: () -> Void
    var onMove: (String) -> Void = { _ in }

    @Environment(RollStore.self) private var store
    @Environment(\.palette) private var palette
    @State private var cover: [CGImage] = []
    @State private var confirmingDelete = false
    @State private var movingTo: SourceInfo?

    var body: some View {
        let progress = rollProgress(roll)
        let withLook = roll.pictures.filter { $0.grade != nil }.count
        VStack(alignment: .leading, spacing: 0) {
            RollCover(images: cover, roll: roll, remoteOnly: remoteOnly)
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
                    if busy == nil { menu }
                }
                facts(progress: progress, withLook: withLook)
                if remoteOnly {
                    Text("on \(label(roll.sourceId)) · not yet on this device")
                        .font(Brand.mono(compact ? 10 : 11))
                        .foregroundStyle(palette.faint)
                }
                if let busy {
                    Text(busy)
                        .font(Brand.mono(compact ? 10 : 11))
                        .foregroundStyle(palette.muted)
                        .accessibilityAddTraits(.updatesFrequently)
                }
            }
            .padding(compact ? 10 : 14)
        }
        .background(palette.surface, in: RoundedRectangle(cornerRadius: Brand.paperRadius))
        .overlay(
            RoundedRectangle(cornerRadius: Brand.paperRadius)
                .stroke(isOpen ? palette.accent : palette.line, lineWidth: 1)
        )
        .opacity(remoteOnly ? 0.75 : 1)
        .contentShape(RoundedRectangle(cornerRadius: Brand.paperRadius))
        .onTapGesture {
            if busy == nil { onOpen() }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Open \(roll.name)")
        .task(id: coverKey) { await loadCover() }
        .confirmationDialog("Delete “\(roll.name)”?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive, action: onDelete)
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Every picture's develop and look go with it. The files stay where they are.")
        }
        .confirmationDialog(movingTo.map { "Move “\(roll.name)” to \(label($0.id))?" } ?? "",
                            isPresented: Binding(get: { movingTo != nil }, set: { if !$0 { movingTo = nil } }),
                            titleVisibility: .visible) {
            Button("Move") {
                if let target = movingTo { onMove(target.id) }
                movingTo = nil
            }
            Button("Cancel", role: .cancel) { movingTo = nil }
        } message: {
            Text("The roll will be kept there from now on, and reopen from any device connected to it. Its pictures never travel — only what you did to them.")
        }
    }

    private var menu: some View {
        Menu {
            Button(isOpen ? "Resume" : remoteOnly ? "Open here" : "Open", action: onOpen)
            if !remoteOnly {
                Button("Rename…", action: onRename)
                Button("Export \(rollFileExtension)", action: onExport)
                    .help("The whole roll on disk — a backup, and how it reaches another machine")
                ForEach(moveTargets, id: \.id) { target in
                    Button("Move to \(label(target.id))…") { movingTo = target }
                }
            }
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

    /// A source as a sentence names it — this device, or the instance's label.
    private func label(_ id: String) -> String {
        deviceWords(sourceLabel(id, registry: ConnectionStore.shared.registry))
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
    /// Only on an instance: its thumbnails never travel.
    var remoteOnly = false
    @Environment(\.palette) private var palette

    private var words: String {
        if remoteOnly { return "pictures drawn once opened here" }
        return roll.pictures.isEmpty ? "no pictures yet" : "pictures drawn once opened"
    }

    var body: some View {
        GeometryReader { geo in
            if images.isEmpty {
                Text(words)
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
