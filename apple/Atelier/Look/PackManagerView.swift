// "Your packs" — the web's `LutPackImportModal.tsx`: what this device's vault
// holds and what it WEIGHS, the packs an instance keeps that this device does
// not, and the two-step import of a pack folder (or the zip it came in).
//
// Every row says what it costs, here and on the instance (`PackWeight.swift`),
// and two different verbs answer that — the difference is the point:
// - a TICK puts a category or a look away: presentation only, the bytes stay
//   and a grade already wearing it still renders;
// - FORGET reclaims the bytes, here and on the instance, and is the only one
//   of the two a document can notice. Its question quotes what comes back,
//   MEASURED off the vault, never promised.

import SwiftUI
import UniformTypeIdentifiers
import AtelierKit

struct PackManagerView: View {
    @Environment(LookLibrary.self) private var library
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @State private var model = PackManagerModel()
    @State private var picking = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text("Looks you bought — kept on this device, never in an exported file.")
                        .font(Brand.sans(14))
                        .foregroundStyle(palette.muted)
                    if !library.packs.isEmpty {
                        vault
                    }
                    ForEach(library.hosts, id: \.sourceId) { host in
                        ElsewherePacks(host: host)
                    }
                    pickSection
                    report
                }
                .padding(18)
                .frame(maxWidth: 720, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .top)
            }
            .background(palette.surface)
            .navigationTitle("Your packs")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .disabled(model.importing)
                }
            }
            .safeAreaInset(edge: .bottom) {
                Text("Stored on this device, and on the instance you keep a pack on — nowhere else.")
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 10)
                    .background(palette.surface)
            }
        }
        .interactiveDismissDisabled(model.importing)
        .fileImporter(isPresented: $picking, allowedContentTypes: [.folder, .zip]) { result in
            if case .success(let url) = result { model.pick(url) }
        }
        .task(id: library.packs.map(\.id)) {
            library.refreshHosts()
            await model.measure(library)
        }
        #if os(macOS)
        .frame(minWidth: 560, idealWidth: 680, minHeight: 520, idealHeight: 720)
        #endif
    }

    // MARK: - what the vault holds

    private var vault: some View {
        let total = vaultWeight(library.packs, model.sizes)
        let instances = instanceWeights(library.packs, model.sizes)
        var line = "\(formatPackBytes(total.here)) here"
        for entry in instances { line += " · \(formatPackBytes(entry.bytes)) on \(entry.sourceId)" }
        if total.unweighed > 0 { line += " · \(total.unweighed) not weighed" }
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Eyebrow("On this device")
                Spacer(minLength: 8)
                Text(line)
                    .font(Brand.mono(11))
                    .foregroundStyle(palette.muted)
                    .monospacedDigit()
            }
            ForEach(library.packs, id: \.id) { pack in
                PackRowView(pack: pack, sizes: model.sizes, onForgotten: {
                    model.forgetReport()
                    Task { await model.measure(library) }
                })
            }
        }
    }

    // MARK: - the pick, then what was read

    @ViewBuilder
    private var pickSection: some View {
        if let progress = model.progress {
            VStack(alignment: .leading, spacing: 4) {
                Text("Reading \(min(progress.done + 1, progress.total)) of \(progress.total)…")
                    .font(Brand.sans(14))
                    .foregroundStyle(palette.ink)
                Text(progress.file)
                    .font(Brand.mono(11))
                    .foregroundStyle(palette.muted)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        } else if let picked = model.picked {
            pickedSection(picked)
        } else {
            VStack(alignment: .leading, spacing: 6) {
                Button("Choose a pack folder…") { picking = true }
                    .buttonStyle(.borderedProminent)
                Text("The folder the pack came in, with its categories inside — or the zip it came as. Everything that is not a .cube is left where it is.")
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func pickedSection(_ picked: PickedPack) -> some View {
        let root = picked.rootName.isEmpty ? "the folder" : picked.rootName
        return VStack(alignment: .leading, spacing: 12) {
            Eyebrow("\(picked.files.count) looks in “\(root)” · \(formatPackBytes(picked.bytes)) to read")
            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 8) {
                GridRow {
                    fieldLabel("Pack")
                    TextField("AUTHENTIC", text: $model.name)
                }
                GridRow {
                    fieldLabel("Author")
                    TextField("Who made it", text: $model.author)
                }
                GridRow {
                    fieldLabel("Link")
                    TextField("Where you bought it (optional)", text: $model.link)
                        #if os(iOS)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        #endif
                }
            }
            .textFieldStyle(.roundedBorder)
            .font(Brand.sans(15))
            VStack(spacing: 4) {
                ForEach(Array(model.preview.enumerated()), id: \.offset) { _, row in
                    HStack {
                        Text(row.folder)
                            .font(Brand.sans(12))
                            .foregroundStyle(palette.inkSoft)
                            .lineLimit(1)
                        Spacer(minLength: 8)
                        Text("\(row.looks)")
                            .font(Brand.mono(11))
                            .foregroundStyle(palette.muted)
                            .monospacedDigit()
                    }
                }
            }
            HStack(spacing: 10) {
                Button("Import \(picked.files.count) looks") {
                    Task { await model.run(library) }
                }
                .buttonStyle(.borderedProminent)
                Button("Choose another folder") {
                    model.discardPick()
                    picking = true
                }
                .buttonStyle(.bordered)
            }
        }
    }

    private func fieldLabel(_ text: String) -> some View {
        Text(text)
            .font(Brand.sans(12))
            .foregroundStyle(palette.muted)
    }

    // MARK: - the import's report

    @ViewBuilder
    private var report: some View {
        if let done = model.done {
            VStack(alignment: .leading, spacing: 3) {
                Text(doneLine(done))
                    .font(Brand.sans(14))
                    .foregroundStyle(palette.ok)
                Text("They are in the look picker now, under the pack’s name.")
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.muted)
            }
        }
        if !model.failed.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text("\(model.failed.count) NOT TAKEN")
                    .font(Brand.eyebrow)
                    .kerning(1.2)
                    .foregroundStyle(palette.warn)
                ForEach(Array(model.failed.enumerated()), id: \.offset) { _, failure in
                    (Text(failure.file).font(Brand.mono(11)) + Text(" — \(failure.reason)").font(Brand.sans(12)))
                        .foregroundStyle(palette.inkSoft)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        if let error = model.error {
            Text(error)
                .font(Brand.sans(12))
                .foregroundStyle(palette.danger)
        }
    }

    private func doneLine(_ done: (looks: Int, stored: Int, reused: Int)) -> String {
        var line = "\(done.looks) looks in the vault"
        if done.stored > 0 { line += " · \(formatPackBytes(done.stored)) written" }
        if done.reused > 0 { line += " · \(done.reused) already here" }
        return line + "."
    }
}

// MARK: - the packs an instance keeps that this device does not

/// Adding one copies its INDEX only — 40 MB of lattices is not something to
/// download because a list was opened; they follow one at a time, as
/// pictures ask for them.
private struct ElsewherePacks: View {
    let host: PackHost
    @Environment(LookLibrary.self) private var library
    @Environment(\.palette) private var palette
    @State private var there: [LutPackIndex]?
    @State private var error: String?
    @State private var busy: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Always something in the tree, so the ask below runs even while
            // there is nothing to show yet.
            Color.clear.frame(height: 0)
            if let error {
                Text("\(host.sourceId) — \(error)")
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.muted)
            } else if let there, !there.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Eyebrow("On \(host.sourceId)")
                    ForEach(there, id: \.id) { pack in
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(packTitle(pack))
                                    .font(Brand.sans(14, weight: .medium))
                                    .foregroundStyle(palette.ink)
                                    .lineLimit(1)
                                Text("\(pack.looks.count) looks · its looks download as you use them")
                                    .font(Brand.mono(11))
                                    .foregroundStyle(palette.muted)
                            }
                            Spacer(minLength: 8)
                            Button(busy == pack.id ? "Adding…" : "Add here") {
                                busy = pack.id
                                Task {
                                    await library.adopt(pack, from: host.sourceId)
                                    busy = nil
                                }
                            }
                            .buttonStyle(.bordered)
                            .disabled(busy == pack.id)
                        }
                        .padding(10)
                        .background(palette.paper, in: RoundedRectangle(cornerRadius: Brand.controlRadius))
                        .overlay(RoundedRectangle(cornerRadius: Brand.controlRadius).stroke(palette.line, lineWidth: 1))
                    }
                }
            }
        }
        // Re-asked whenever this device's packs change: adopting one must
        // take it off the list.
        .task(id: library.packs.map(\.id)) {
            error = nil
            do {
                there = try await library.remotePacksNotHere(host)
            } catch {
                self.error = String(describing: error)
            }
        }
    }
}

/// A pack's name as a list shows it: its name, `· author` after it.
func packTitle(_ pack: LutPackIndex) -> String {
    let name = pack.name.isEmpty ? "Pack" : pack.name
    return pack.author.isEmpty ? name : "\(name) · \(pack.author)"
}

#Preview("Your packs") {
    PackManagerView()
        .environment(LookLibrary.preview)
}
