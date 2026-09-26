// The creation sheet — the web's `NewProjectModal.tsx`, After-Effects style:
// name the project, pick the destination FORMAT (presets named by
// destination — a creator thinks "Reels", not "1080×1920"), optionally start
// from another project as a template, choose where it is kept (only when
// there is a choice), and point its media folder. Everything can be changed
// later. Explicitly out, as on the web: bitrate, codec, look, destination —
// export-time decisions.
//
// The folder is REMEMBERED (a security-scoped bookmark, the document's
// `media.dirHandle`) and never copied; its files are listed and hashed here so
// the project knows its working set before its first open.

import SwiftUI
import UniformTypeIdentifiers
import AtelierKit

struct NewProjectSheet: View {
    let templates: [ProjectDoc]
    /// The sources that can hold a project; with ONE the picker is not drawn.
    let sources: [SourceInfo]
    let onCreate: (NewProjectChoices) -> Void
    let onCancel: () -> Void

    @Environment(\.palette) private var palette
    @State private var name = "Untitled project"
    @State private var aspectId = aspectPresets[0].id
    @State private var templateId = ""
    @State private var sourceId = defaultSourceId
    @State private var folder: NewProjectFolder?
    @State private var pickingFolder = false
    @State private var listing = false
    @State private var infoOpen = false
    @FocusState private var nameFocused: Bool

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    Text("Everything can be changed later.")
                        .font(Brand.sans(14))
                        .foregroundStyle(palette.muted)
                    field("Name") {
                        TextField("Untitled project", text: $name)
                            .font(Brand.sans(16))
                            .textFieldStyle(.roundedBorder)
                            .focused($nameFocused)
                            .onSubmit(submit)
                    }
                    field("Format") {
                        StudioAspectGrid(selection: $aspectId)
                        Text("Shown on the project card; drives composition framing when export templates land.")
                            .font(Brand.sans(11))
                            .foregroundStyle(palette.faint)
                    }
                    if !templates.isEmpty {
                        field("Start from") {
                            Picker("Start from", selection: $templateId) {
                                // No house style is carried by this build, so no
                                // template means the factory deck — said as such.
                                Text("Blank").tag("")
                                ForEach(templates, id: \.id) { t in
                                    Text("\(t.name) — overlays, look & settings").tag(t.id)
                                }
                            }
                            .labelsHidden()
                            .pickerStyle(.menu)
                        }
                    }
                    if sources.count > 1 {
                        field("Keep on") {
                            Picker("Keep on", selection: $sourceId) {
                                ForEach(sources, id: \.id) { s in
                                    Text(s.id == defaultSourceId ? "this device (local)" : s.label).tag(s.id)
                                }
                            }
                            .labelsHidden()
                            .pickerStyle(.menu)
                            Text(sourceId == defaultSourceId
                                 ? "Stays on this device. Export a project file to share its settings."
                                 : "Saved to \(sourceId) as you edit, so it resumes from another device. The media folder stays on this machine.")
                                .font(Brand.sans(11))
                                .foregroundStyle(palette.faint)
                        }
                    }
                    field("Media folder (optional)") {
                        HStack(spacing: 12) {
                            Button(listing ? "Opening…" : folder != nil ? "Change folder…" : "Choose folder…") {
                                pickingFolder = true
                            }
                            .buttonStyle(DevelopPillButtonStyle())
                            .disabled(listing)
                            if let folder {
                                let count = folder.entries.count
                                Text("\(folder.url.lastPathComponent) · \(count) file\(count == 1 ? "" : "s")")
                                    .font(Brand.sans(12))
                                    .foregroundStyle(palette.muted)
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                            }
                        }
                        HStack(spacing: 6) {
                            Text("Optional")
                                .font(Brand.sans(11))
                                .foregroundStyle(palette.faint)
                            DevelopInfoDot(about: "the folder", isOpen: $infoOpen)
                        }
                        if infoOpen {
                            DevelopNote(paragraphs: [
                                "The folder is remembered (never copied) so the project reopens in one click. You can also add files from the editor later.",
                            ])
                        }
                    }
                }
                .padding(24)
            }
            .background(palette.surface)
            .navigationTitle("New project")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onCancel)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create project", action: submit)
                        .disabled(listing)
                }
            }
        }
        .onAppear {
            if !sources.contains(where: { $0.id == defaultSourceId }), let first = sources.first {
                sourceId = first.id
            }
            nameFocused = true
        }
        .fileImporter(isPresented: $pickingFolder, allowedContentTypes: [.folder]) { result in
            guard case .success(let url) = result else { return }
            Task { await list(url) }
        }
        #if os(macOS)
        .frame(minWidth: 480, minHeight: 560)
        #endif
    }

    private func field<Content: View>(_ label: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Eyebrow(label)
            content()
        }
    }

    /// The folder's files listed and hashed; its scope passes to the project.
    private func list(_ url: URL) async {
        listing = true
        defer { listing = false }
        if let previous = folder, previous.scoped { previous.url.stopAccessingSecurityScopedResource() }
        let scoped = url.startAccessingSecurityScopedResource()
        guard let bookmark = RollStore.makeBookmark(url) else {
            if scoped { url.stopAccessingSecurityScopedResource() }
            folder = nil
            return
        }
        let entries = await Task.detached(priority: .userInitiated) { StudioMediaFiles.list(folder: url) }.value
        // The working set a project keeps: what the Studio edits.
        let usable = entries.filter { classifyPart($0.ref.name) != .other }
        let refs = await Task.detached(priority: .userInitiated) { StudioMediaFiles.hashed(usable) }.value
        folder = NewProjectFolder(url: url, bookmark: bookmark, entries: usable, refs: refs, scoped: scoped)
    }

    private func submit() {
        guard !listing else { return }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        onCreate(NewProjectChoices(name: trimmed.isEmpty ? "Untitled project" : trimmed, aspectId: aspectId,
                                   templateId: templateId.isEmpty ? nil : templateId, folder: folder,
                                   sourceId: sourceId))
    }
}

/// The destination formats as a two-column grid of shape tiles — the web's
/// preset buttons, each with its outline drawn at its own ratio.
struct StudioAspectGrid: View {
    @Binding var selection: String
    @Environment(\.palette) private var palette

    /// The outline of a preset: 26 pt on its long side, the short side at its ratio.
    static func glyph(_ preset: AspectPreset) -> CGSize {
        let long = 26.0
        if preset.w >= preset.h {
            let short = (long * preset.h / preset.w).rounded()
            return CGSize(width: long, height: short)
        }
        let short = (long * preset.w / preset.h).rounded()
        return CGSize(width: short, height: long)
    }

    var body: some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
            ForEach(aspectPresets, id: \.id) { preset in
                let on = preset.id == selection
                Button {
                    selection = preset.id
                } label: {
                    HStack(spacing: 12) {
                        let glyph = StudioAspectGrid.glyph(preset)
                        RoundedRectangle(cornerRadius: 2)
                            .strokeBorder(palette.inkSoft, lineWidth: 1.5)
                            .frame(width: glyph.width, height: glyph.height)
                            .frame(width: 28)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(preset.id)
                                .font(Brand.sans(14, weight: .semibold))
                                .foregroundStyle(palette.ink)
                            Text(preset.label)
                                .font(Brand.sans(11))
                                .foregroundStyle(palette.muted)
                                .lineLimit(1)
                                .truncationMode(.tail)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .background(on ? palette.accentWash : palette.paper, in: RoundedRectangle(cornerRadius: Brand.controlRadius))
                    .overlay(
                        RoundedRectangle(cornerRadius: Brand.controlRadius)
                            .stroke(on ? palette.accent : palette.line, lineWidth: 1)
                    )
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
                .accessibilityLabel("\(preset.id), \(preset.label)")
            }
        }
    }
}

#Preview("New project") {
    NewProjectSheet(templates: [createProjectDoc("Vol du soir", "9:16", [], .default)], sources: [],
                    onCreate: { _ in }, onCancel: {})
}
