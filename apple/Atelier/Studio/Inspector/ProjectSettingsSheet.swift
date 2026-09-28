// Project settings, DaVinci-style — the web's `ProjectSettingsModal.tsx`:
// everything chosen at creation stays editable mid-flight. The name, the
// destination format, the CADENCE correction (follow the flight log, or set by
// hand as "this clip plays N× slower / faster than life"), the capture-time
// SHIFT (a sign, hours, minutes, days — never a timezone: the log has no zone
// to convert from), then the project file: Export settings writes the
// portable half composed from the LIVE state and this draft; Import a file…
// replaces it after an inline confirmation. The prose that justifies each
// control is folded behind an ⓘ beside its legend, one tap away, rather than
// pushing Apply off a phone's screen.
//
// House style: READ-ONLY here. On the web a project's look is saved as the
// house style by the dev server alone, into a file committed to the
// repository; this build carries no project house style, and the section says
// so rather than offering a verb that could not write anywhere.

import SwiftUI
import UniformTypeIdentifiers
import AtelierKit

struct ProjectSettingsSheet: View {
    @Bindable var editor: StudioEditor
    @Environment(\.palette) private var palette

    @State private var name = ""
    @State private var aspectId = aspectPresets[0].id
    @State private var negative = false
    @State private var hours = 0
    @State private var minutes = 0
    @State private var days = 0
    @State private var cadence = CadenceDraft(mode: .auto, slower: true, factor: 1)
    /// An imported file waits for its confirmation: it overwrites the whole portable half.
    @State private var pending: ProjectFile?
    @State private var importError: String?
    @State private var choosingFile = false
    @State private var exporting: ProjectFileDocument?
    @State private var infos: Set<String> = []
    @State private var seeded = false

    var body: some View {
        NavigationStack {
            ScrollViewReader { reader in
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        section("Name") {
                            TextField("Project name", text: $name)
                                .font(Brand.sans(16))
                                .textFieldStyle(.roundedBorder)
                                .onSubmit(apply)
                        }
                        section("Format", info: ["The project's format seeds new export variants; the Export tab can still add other formats per variant."]) {
                            StudioAspectGrid(selection: $aspectId)
                        }
                        section("Cadence", info: [
                            "Slow motion and time-lapse are conformed: the file plays at a speed the camera never shot at, so every speed read from the flight log — ground, vertical — would be divided by the wrong seconds. The log's own timestamps say what the real cadence was.",
                            "Only rates move: a heading is a direction and survives any conform, and the clock badges keep reading the capture time, which is why they tick slowly on a ralenti — that part is true.",
                        ]) {
                            cadenceControls
                        }
                        section("Capture-time shift", info: [
                            "The flight log records a bare wall-clock reading with no timezone — whatever the aircraft's clock said. If it was off, correct it here: the shift applies to every clock, date and timestamp element at once, and rolls the date when it crosses midnight.",
                            "Minutes cover the half- and quarter-hour zones; days are for a controller that came back from a flat battery with the wrong date.",
                        ]) {
                            shiftControls
                        }
                        Hairline()
                        section("Import / export", info: [
                            "A project file carries the settings only — overlays, style, grade, format, capture-time shift and the export matrix. Never your media, and never this clip's cadence: it is a template you can keep, share or reuse on another machine.",
                        ]) {
                            fileControls
                        }
                        .id("file")
                        Hairline()
                        section("House style") {
                            Text("No house style is carried by this build: a new project without a template starts from the default deck. On the web, a project's look is saved as the house style from the dev server, into a file committed to the repository — projects that already exist never change.")
                                .font(Brand.sans(12))
                                .foregroundStyle(palette.muted)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .padding(24)
                }
                .onChange(of: pending != nil) { _, shown in
                    // Below the fold on a short screen, a confirmation reads as "nothing happened".
                    if shown { withAnimation { reader.scrollTo("file", anchor: .bottom) } }
                }
            }
            .background(palette.surface)
            // On a view of its own: two file panels chained on ONE view answer
            // only the last.
            .fileExporter(isPresented: Binding(get: { exporting != nil }, set: { if !$0 { exporting = nil } }),
                          document: exporting, contentType: .json,
                          defaultFilename: exporting?.fileName ?? projectFileName(name)) { _ in
                exporting = nil
            }
            .navigationTitle("Project settings")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { editor.settingsOpen = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    // Never while an imported file waits for its own answer.
                    Button("Apply", action: apply)
                        .disabled(pending != nil)
                }
            }
        }
        .onAppear(perform: seed)
        .fileImporter(isPresented: $choosingFile, allowedContentTypes: [.json]) { result in
            if case .success(let url) = result { read(url) }
        }
        #if os(macOS)
        .frame(minWidth: 480, minHeight: 620)
        #endif
    }

    // MARK: - the controls

    private var cadenceControls: some View {
        VStack(alignment: .leading, spacing: 8) {
            modeButton(.auto, title: "Follow the flight log", detail: measuredCadenceLabel(editor.timing), mono: true)
            modeButton(.manual, title: "Set it by hand",
                       detail: "For footage whose log says nothing — or a conform you did yourself.", mono: false)
            if cadence.mode == .manual {
                HStack(spacing: 8) {
                    Text("This clip plays").font(Brand.sans(12)).foregroundStyle(palette.inkSoft)
                    TextField("Factor", value: $cadence.factor, format: .number)
                        .font(Brand.mono(13))
                        .textFieldStyle(.roundedBorder)
                        .frame(width: 70)
                        #if os(iOS)
                        .keyboardType(.decimalPad)
                        #endif
                    Text("×").font(Brand.sans(12)).foregroundStyle(palette.inkSoft)
                    Picker("Direction", selection: $cadence.slower) {
                        Text("slower").tag(true)
                        Text("faster").tag(false)
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .fixedSize()
                    Text("than life").font(Brand.sans(12)).foregroundStyle(palette.inkSoft)
                }
                .padding(.leading, 12)
            }
        }
    }

    private func modeButton(_ mode: TimeScaleMode, title: String, detail: String, mono: Bool) -> some View {
        let on = cadence.mode == mode
        return Button {
            cadence.mode = mode
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(Brand.sans(14, weight: .semibold)).foregroundStyle(palette.ink)
                Text(detail)
                    .font(mono ? Brand.mono(11) : Brand.sans(11))
                    .foregroundStyle(palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(on ? palette.accentWash : palette.paper, in: RoundedRectangle(cornerRadius: Brand.controlRadius))
            .overlay(RoundedRectangle(cornerRadius: Brand.controlRadius).stroke(on ? palette.accent : palette.line, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private var shiftControls: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                Picker("Direction", selection: $negative) {
                    Text("+").tag(false)
                    Text("−").tag(true)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .fixedSize()
                .accessibilityLabel("Earlier or later")
                Stepper(value: $hours, in: 0...23) {
                    shiftValue("Hours", "\(hours)")
                }
                .fixedSize()
            }
            HStack(spacing: 12) {
                Stepper(value: $minutes, in: 0...59, step: 15) {
                    shiftValue("Minutes", String(format: "%02d", minutes))
                }
                .fixedSize()
                Stepper(value: $days, in: -366...366) {
                    shiftValue("Days", "\(days)")
                }
                .fixedSize()
            }
            if hours != 0 || minutes != 0 || days != 0 {
                Button("Clear") {
                    negative = false
                    hours = 0
                    minutes = 0
                    days = 0
                }
                .buttonStyle(DevelopLinkButtonStyle(active: true))
            }
        }
    }

    private func shiftValue(_ label: String, _ value: String) -> some View {
        HStack(spacing: 6) {
            Text(label.uppercased()).font(Brand.mono(10)).kerning(1).foregroundStyle(palette.muted)
            Text(value).font(Brand.mono(13)).monospacedDigit().foregroundStyle(palette.ink)
        }
    }

    @ViewBuilder
    private var fileControls: some View {
        HStack(spacing: 10) {
            Button {
                let draft = self.draft
                exporting = ProjectFileDocument(
                    text: editor.projectFileText(name: draft.name, aspectId: draft.aspectId, timeShift: draft.timeShift),
                    fileName: projectFileName(draft.name)
                )
            } label: {
                Label("Export settings", systemImage: "square.and.arrow.up")
            }
            .buttonStyle(DevelopPillButtonStyle())
            Button {
                choosingFile = true
            } label: {
                Label("Import a file…", systemImage: "square.and.arrow.down")
            }
            .buttonStyle(DevelopPillButtonStyle())
        }
        if let pending {
            VStack(alignment: .leading, spacing: 8) {
                Text(projectImportQuestion(pending))
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Text(projectImportSummary(pending))
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 16) {
                    Button("Replace the settings") {
                        let file = pending
                        self.pending = nil
                        editor.importProjectFile(file)
                    }
                    .buttonStyle(DevelopLinkButtonStyle(active: true))
                    Button("Keep mine") { self.pending = nil }
                        .buttonStyle(DevelopLinkButtonStyle())
                }
            }
            .padding(12)
            .background(palette.accentWash, in: RoundedRectangle(cornerRadius: Brand.controlRadius))
            .overlay(RoundedRectangle(cornerRadius: Brand.controlRadius).stroke(palette.accent, lineWidth: 1))
        }
        if let importError {
            Text(importError)
                .font(Brand.sans(12))
                .foregroundStyle(palette.danger)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func section<Content: View>(_ label: String, info: [String] = [],
                                        @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Eyebrow(label)
                if !info.isEmpty {
                    DevelopInfoDot(about: label.lowercased(), isOpen: Binding(
                        get: { infos.contains(label) },
                        set: { open in if open { infos.insert(label) } else { infos.remove(label) } }
                    ))
                }
            }
            if infos.contains(label) {
                DevelopNote(paragraphs: info)
            }
            content()
        }
    }

    // MARK: - the draft

    private struct Draft {
        var name: String
        var aspectId: String
        var timeShift: TimeShift
        var timeScale: TimeScaleSetting
    }

    private var draft: Draft {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let shift = TimeShift(minutes: shiftMinutes(negative: negative, hours: hours, minutes: minutes), days: Double(days))
        return Draft(name: trimmed.isEmpty ? editor.edit.name : trimmed, aspectId: aspectId, timeShift: shift,
                     timeScale: timeScaleFromDraft(cadence))
    }

    private func seed() {
        guard !seeded else { return }
        seeded = true
        let edit = editor.edit
        name = edit.name
        aspectId = edit.aspectId
        let parts = shiftParts(edit.timeShift.minutes)
        negative = parts.negative
        hours = parts.hours
        minutes = parts.minutes
        days = Int(edit.timeShift.days.rounded())
        // An override typed for another clip is not this clip's: the draft
        // opens on what this clip's telemetry measured.
        let setting: TimeScaleSetting = editor.overridden ? edit.timeScale : .auto
        cadence = cadenceDraft(setting, measured: editor.timing)
    }

    private func apply() {
        guard pending == nil else { return }
        let d = draft
        editor.applySettings(name: d.name, aspectId: d.aspectId, timeShift: d.timeShift, timeScale: d.timeScale)
    }

    /// A chosen file read; a bad one explains itself instead of throwing.
    private func read(_ url: URL) {
        importError = nil
        pending = nil
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url), let text = String(data: data, encoding: .utf8) else {
            importError = "This file could not be read."
            return
        }
        switch parseProjectFile(text) {
        case .success(let file): pending = file
        case .failure(let error): importError = error.message
        }
    }
}

/// A `.atelier.json` as the file exporter carries it — the web's bytes.
struct ProjectFileDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }
    static var writableContentTypes: [UTType] { [.json] }

    var text: String
    var fileName: String

    init(text: String, fileName: String) {
        self.text = text
        self.fileName = fileName
    }

    init(configuration: ReadConfiguration) throws {
        text = String(data: configuration.file.regularFileContents ?? Data(), encoding: .utf8) ?? ""
        fileName = configuration.file.filename ?? projectFileName("project")
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: Data(text.utf8))
    }
}
