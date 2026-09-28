// One project in the gallery — the web's `ProjectCard`: the stage thumbnail
// the autosave baked (so the gallery decodes no media), the name, `open` on
// the project last opened here, and a mono line of facts — the format, when
// it last moved, how long its clip runs, how many elements, how many files.
//
// The WHOLE card opens the project; the other verbs sit behind its ⋯, the
// destructive one apart and confirmed with what goes and what stays. A card
// kept only on an instance is greyed and says so; opening it pulls it first.

import ImageIO
import SwiftUI
import AtelierKit

struct StudioProjectCard: View {
    let doc: ProjectDoc
    let isOpen: Bool
    /// Kept on an instance and not yet mirrored here: opening pulls it first.
    let remoteOnly: Bool
    /// The other sources this project could move to.
    let moveTargets: [SourceInfo]
    /// A sentence while a move, a delete or an open is under way.
    let busy: String?
    let compact: Bool
    let onOpen: () -> Void
    let onDelete: () -> Void
    let onDuplicate: () -> Void
    let onMove: (String) -> Void

    @Environment(\.palette) private var palette
    @State private var thumbnail: CGImage?
    @State private var confirmingDelete = false
    @State private var movingTo: SourceInfo?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            preview
                .aspectRatio(16 / 9, contentMode: .fit)
                .background(palette.frame)
                .clipShape(UnevenRoundedRectangle(topLeadingRadius: Brand.paperRadius, topTrailingRadius: Brand.paperRadius))
            VStack(alignment: .leading, spacing: compact ? 6 : 8) {
                HStack(spacing: 8) {
                    Text(doc.name.isEmpty ? "Untitled project" : doc.name)
                        .font(Brand.sans(compact ? 14 : 16, weight: .semibold))
                        .foregroundStyle(palette.ink)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .help(doc.name)
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
                facts
                if remoteOnly {
                    Text("on \(label(doc.sourceId)) · not yet on this device")
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
        .accessibilityLabel("Open \(doc.name)")
        .accessibilityAddTraits(.isButton)
        .task(id: doc.updatedAt) { thumbnail = await StudioProjectCard.decode(doc.thumbnail) }
        .confirmationDialog("Delete “\(doc.name)”?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive, action: onDelete)
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Its overlays, look and settings go with it. The media files stay where they are.")
        }
        .confirmationDialog(movingTo.map { "Move “\(doc.name)” to \(label($0.id))?" } ?? "",
                            isPresented: Binding(get: { movingTo != nil }, set: { if !$0 { movingTo = nil } }),
                            titleVisibility: .visible) {
            Button("Move") {
                if let target = movingTo { onMove(target.id) }
                movingTo = nil
            }
            Button("Cancel", role: .cancel) { movingTo = nil }
        } message: {
            Text("The project will be kept there from now on, and reopen from any device connected to it. Its media never travels.")
        }
    }

    @ViewBuilder
    private var preview: some View {
        if let thumbnail {
            Image(decorative: thumbnail, scale: 1)
                .resizable()
                .aspectRatio(contentMode: .fill)
        } else {
            Text(remoteOnly ? "preview drawn once opened here" : "no preview yet")
                .font(Brand.mono(11))
                .foregroundStyle(palette.muted)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var menu: some View {
        Menu {
            Button(isOpen ? "Resume" : remoteOnly ? "Open here" : "Open", action: onOpen)
            if !remoteOnly {
                Button("Use as template", action: onDuplicate)
                    .help("New project reusing this one's overlays, look and settings")
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
        .accessibilityLabel("More actions for \(doc.name)")
    }

    private var facts: some View {
        let aspect = aspectPreset(doc.settings.aspectId)
        let elements = doc.elements.count
        let files = doc.media.files.count
        return HStack(spacing: 6) {
            if let aspect {
                Text(aspect.id).foregroundStyle(palette.inkSoft)
                dot
            }
            Text(Date(timeIntervalSince1970: doc.updatedAt / 1000),
                 format: .dateTime.day().month(.abbreviated).hour().minute())
            if let duration = doc.durationSeconds, duration > 0 {
                dot
                Text(formatDuration(duration))
            }
            dot
            Text("\(elements) element\(elements == 1 ? "" : "s")")
            if files > 0 {
                dot
                Text("\(files) file\(files == 1 ? "" : "s")")
            }
        }
        .font(Brand.mono(compact ? 10 : 11))
        .monospacedDigit()
        .foregroundStyle(palette.muted)
        .lineLimit(1)
    }

    /// A source as a sentence names it — this device, or the instance's label.
    private func label(_ id: String) -> String {
        deviceWords(sourceLabel(id, registry: ConnectionStore.shared.registry))
    }

    private var dot: some View {
        Text("·").foregroundStyle(palette.faint)
    }

    /// The baked JPEG decoded off the main actor.
    private static func decode(_ data: Data?) async -> CGImage? {
        guard let data else { return nil }
        return await Task.detached(priority: .utility) { () -> CGImage? in
            guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
            return CGImageSourceCreateImageAtIndex(source, 0, nil)
        }.value
    }
}

#Preview("Project cards") {
    let doc = createProjectDoc("Vol du soir", "9:16", defaultElementsPreset(), .default)
    HStack(alignment: .top, spacing: 16) {
        StudioProjectCard(doc: doc, isOpen: true, remoteOnly: false, moveTargets: [], busy: nil, compact: false,
                          onOpen: {}, onDelete: {}, onDuplicate: {}, onMove: { _ in })
        StudioProjectCard(doc: doc, isOpen: false, remoteOnly: true, moveTargets: [], busy: "moving to winnow…",
                          compact: false, onOpen: {}, onDelete: {}, onDuplicate: {}, onMove: { _ in })
    }
    .frame(width: 560)
    .padding()
}
