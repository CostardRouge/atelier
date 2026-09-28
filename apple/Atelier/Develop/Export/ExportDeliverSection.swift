// Deliver — the web's Deliver section of `ExportPanel.tsx`, and the verbs
// `RollEditor.tsx` builds: into a folder, or — this app's addition — into
// Photos; JPEG, or the HEIC this app adds (both choices this DEVICE's, never
// the roll's); *Replace a file of the same name* (the roll's, off by default).
//
// The verb asks for the folder FIRST, at the click, and the run starts from
// the answer: pick, then render, then write (`deliver-files.ts` — the order
// is the whole point there, and it is kept here though nothing times the
// click out). A running export says what it is doing, how far it has gone,
// and carries its Cancel; the last run's sentence stays, every line of it one
// tap away.

import SwiftUI
import UniformTypeIdentifiers
import AtelierKit

struct ExportDeliverSection: View {
    @Bindable var editor: RollEditor
    @Environment(\.palette) private var palette
    @State private var picking = false
    @State private var pending: [String] = []
    @State private var detailsOpen = false

    static let info = [
        "Into a folder you choose — picked at the click, before a pixel is rendered — or into Photos. A picture this device cannot reach is skipped and said.",
        "A picture leaves under its own name, so the name it wants is often one the folder already holds. Replace off writes -1, -2 beside what is there and says how many; on, the file of that name is overwritten — and a folder that ignores capitals, as the Mac’s and the iPhone’s do, reads DJI_0101.jpg and DJI_0101.JPG as one file.",
        "Photos takes each picture’s first target, under the picture’s own name; the other targets need a folder. The format and where the files go are this device’s choices — the roll keeps the web’s JPEG targets.",
        "Sending the pictures home to your Winnow is not offered: its upload files them into the incoming as new captures rather than into the Gallery, so they would be neither where you keep them nor linked to their original.",
    ]

    var body: some View {
        let run = editor.exportRun
        let export = editor.exportSettings
        let verbs = editor.exportVerbs
        DevelopSection(id: "deliver", title: "Deliver", info: ExportDeliverSection.info) {
            ExportRow("Format") {
                VStack(alignment: .leading, spacing: 3) {
                    Picker("Format", selection: Binding(get: { run.format }, set: { run.setFormat($0) })) {
                        ForEach(ExportFormat.allCases) { format in
                            Text(format.title).tag(format)
                        }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    ExportHint(run.format == .jpeg
                        ? "the web’s — every viewer reads it"
                        : "this device’s — smaller, read by Apple’s and recent systems; the roll keeps the web’s JPEG")
                }
            }
            ExportRow("Into") {
                Picker("Into", selection: Binding(get: { run.destination }, set: { run.setDestination($0) })) {
                    ForEach(RunDestinationKind.allCases) { kind in
                        Text(kind.title).tag(kind)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            }
            if run.destination == .folder {
                VStack(alignment: .leading, spacing: 3) {
                    Toggle(isOn: Binding(get: { export.replace }, set: { on in editor.setExport { $0.replace = on } })) {
                        Text("Replace a file of the same name")
                            .font(Brand.sans(13))
                            .foregroundStyle(palette.ink)
                    }
                    .toggleStyle(.switch)
                    .accessibilityLabel("Replace files of the same name")
                    ExportHint(export.replace
                        ? "What the folder holds under that name is overwritten."
                        : "A name already in the folder is numbered — DJI_0101-1.jpg.")
                }
            }
            VStack(alignment: .leading, spacing: 10) {
                ForEach(verbs) { verb in
                    VStack(alignment: .leading, spacing: 3) {
                        Button {
                            request(verb.ids)
                        } label: {
                            Label(verb.label, systemImage: run.destination == .photos ? "photo.badge.plus" : "square.and.arrow.up")
                        }
                        .buttonStyle(DevelopPillButtonStyle())
                        .disabled(run.running)
                        if let hint = verb.hint {
                            Text(hint)
                                .font(Brand.mono(10))
                                .foregroundStyle(palette.faint)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                if verbs.isEmpty {
                    ExportHint("Open a picture to export it.")
                }
            }
            if run.running {
                progress(run)
            } else if let note = run.note {
                outcome(note, details: run.details)
            }
        }
        .fileImporter(isPresented: $picking, allowedContentTypes: [.folder]) { result in
            let ids = pending
            pending = []
            switch result {
            case .success(let folder):
                editor.startExport(ids, to: .folder(folder))
            case .failure(let error):
                editor.exportRun.note = "No folder could be chosen — \(error.localizedDescription)"
            }
        }
    }

    /// A verb's click: the folder asked for first, or Photos straight away
    /// (its permission is asked by the run before anything is rendered).
    private func request(_ ids: [String]) {
        guard !ids.isEmpty, !editor.exportRun.running else { return }
        editor.exportRun.note = nil
        if editor.exportRun.destination == .photos {
            editor.startExport(ids, to: .photos)
        } else {
            pending = ids
            picking = true
        }
    }

    private func progress(_ run: RollRunState) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(run.exporting ?? "")
                .font(Brand.mono(11))
                .foregroundStyle(palette.inkSoft)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.updatesFrequently)
            HStack(spacing: 10) {
                ProgressView(value: run.progress ?? 0)
                    .tint(palette.accent)
                Button("Cancel") { editor.cancelExport() }
                    .buttonStyle(DevelopLinkButtonStyle())
                    .help("Stop between two pictures — what was written stays")
            }
        }
    }

    @ViewBuilder
    private func outcome(_ note: String, details: [String]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(note)
                .font(Brand.sans(12))
                .foregroundStyle(palette.inkSoft)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
            if details.count > 1 {
                Button(detailsOpen ? "Fewer words" : "Every line (\(details.count))") {
                    withAnimation(.easeOut(duration: 0.15)) { detailsOpen.toggle() }
                }
                .buttonStyle(DevelopLinkButtonStyle())
                if detailsOpen {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(details.indices, id: \.self) { i in
                            Text(details[i])
                                .font(Brand.mono(10))
                                .foregroundStyle(palette.muted)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .textSelection(.enabled)
                }
            }
        }
    }
}

#Preview("Deliver") {
    ScrollView {
        ExportDeliverSection(editor: ExportPreview.editor())
            .padding(14)
    }
    .frame(width: 360, height: 500)
    .darkroom()
}
