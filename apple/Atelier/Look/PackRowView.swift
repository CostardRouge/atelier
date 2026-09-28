// One pack in the vault — the web's `PackRow` + `LookRow`
// (`LutPackImportModal.tsx`): what it holds, what it weighs here and on the
// instance it is kept on, what shows in the pickers, and the two verbs that
// reclaim bytes.
//
// Hiding is PRESENTATION — the looks stay stored and a grade already wearing
// a hidden one still renders (`docs/lut-packs.md` §6); it answers a pack whose
// cameras you do not own. The weight beside it answers the other half: the
// bytes those looks still cost. The expander hangs off the pack's LOOKS, not
// its tree: "My looks" (every upload, no categories) must still be reachable.

import SwiftUI
import AtelierKit

struct PackRowView: View {
    let pack: LutPackIndex
    let sizes: LatticeSizes
    let onForgotten: () -> Void

    @Environment(LookLibrary.self) private var library
    @Environment(\.palette) private var palette
    @State private var open = false
    @State private var push: PushProgress?
    @State private var pushing = false
    @State private var pushError: String?
    /// The pack itself (`nil` look), or one of its looks, waiting on the question.
    @State private var asking: Asking?
    @State private var forgetting = false
    @State private var note: String?

    private struct Asking: Identifiable {
        let look: PackLook?
        var id: String { look?.id ?? "pack" }
    }

    private var hidden: Set<String> { Set(pack.hidden) }
    private var keptOn: String? { pack.sourceId.flatMap { $0.isEmpty ? nil : $0 } }
    /// Somewhere to put it: the instance it is kept on, else the first that can.
    private var target: PackHost? {
        library.hosts.first { $0.sourceId == keptOn } ?? library.hosts.first
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            if let pushError {
                Text(pushError).font(Brand.sans(12)).foregroundStyle(palette.warn)
            }
            if let note {
                Text(note).font(Brand.sans(12)).foregroundStyle(palette.ok)
            }
            if open { looks }
        }
        .padding(10)
        .background(palette.paper, in: RoundedRectangle(cornerRadius: Brand.controlRadius))
        .overlay(RoundedRectangle(cornerRadius: Brand.controlRadius).stroke(palette.line, lineWidth: 1))
        .alert(asking.map { title($0) } ?? "", isPresented: Binding(get: { asking != nil }, set: { if !$0 { asking = nil } }),
               presenting: asking) { question in
            Button("Forget", role: .destructive) { Task { await forget(question.look) } }
                .disabled(forgetting)
            Button("Cancel", role: .cancel) { asking = nil }
        } message: { question in
            Text(message(question.look))
        }
    }

    // MARK: - the row

    private var header: some View {
        let weight = packWeight(pack, sizes)
        var line = "\(pack.looks.count) looks · \(formatPackBytes(weight.here)) here"
        if let keptOn { line += " · \(formatPackBytes(weight.instance)) on \(keptOn)" }
        if weight.unweighed > 0 { line += " · \(weight.unweighed) not weighed" }
        let shown = visibleLooks(pack).count
        if !pack.hidden.isEmpty { line += " · \(pack.looks.count - shown) hidden" }
        return ViewThatFits(in: .horizontal) {
            HStack(spacing: 10) {
                titleBlock(line)
                Spacer(minLength: 8)
                verbs
            }
            VStack(alignment: .leading, spacing: 8) {
                titleBlock(line)
                HStack(spacing: 10) { verbs }
            }
        }
    }

    private func titleBlock(_ line: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            (Text(pack.name.isEmpty ? "Pack" : pack.name).foregroundStyle(palette.ink)
                + Text(pack.author.isEmpty ? "" : " · \(pack.author)").foregroundStyle(palette.muted))
                .font(Brand.sans(14, weight: .medium))
                .lineLimit(1)
            Text(line)
                .font(Brand.mono(11))
                .foregroundStyle(palette.muted)
                .monospacedDigit()
        }
    }

    @ViewBuilder
    private var verbs: some View {
        if let target, !pushing {
            Button(keptOn != nil ? "Push" : "Keep on \(target.sourceId)") {
                Task { await keep(on: target.sourceId) }
            }
            .buttonStyle(.borderless)
            .help(keptOn != nil ? "Send what \(target.sourceId) is missing"
                  : "Keep this pack on \(target.sourceId), so your other devices can use it")
        }
        if pushing {
            Text(push.map { $0.total > 0 ? "\($0.done)/\($0.total)" : "Checking…" } ?? "Checking…")
                .font(Brand.mono(11))
                .foregroundStyle(palette.muted)
        }
        if !pack.looks.isEmpty {
            Button(open ? "Done" : "Looks…") { withAnimation(.easeOut(duration: 0.15)) { open.toggle() } }
                .buttonStyle(.borderless)
        }
        Button("Forget") { asking = Asking(look: nil) }
            .buttonStyle(.borderless)
            .help(keptOn.map { "Forget this pack and its looks, here and on \($0)" }
                  ?? "Forget this pack and its looks on this device")
    }

    // MARK: - what shows, and what it weighs

    private var looks: some View {
        VStack(alignment: .leading, spacing: 6) {
            Hairline()
            HStack(spacing: 6) {
                Eyebrow("What shows, and what it weighs")
                InfoNote(paragraphs: [
                    "A tick decides what the look pickers offer. It is presentation only: the bytes stay, and a grade already wearing an unticked look still renders.",
                    "A weight reading “there” is a look whose bytes are not on this device — it downloads by itself when a picture asks for it.",
                ])
            }
            ForEach(Array(flattenPack(pack).enumerated()), id: \.offset) { _, entry in
                switch entry {
                case let .node(node, depth):
                    nodeRow(node, depth)
                case let .look(look, depth):
                    lookRow(look, depth)
                }
            }
        }
    }

    private func nodeRow(_ node: PackNode, _ depth: Int) -> some View {
        let branch = pack.looks.filter { $0.node == node.id || $0.node.hasPrefix("\(node.id)/") }
        return HStack(spacing: 8) {
            Toggle(isOn: Binding(get: { !hidden.contains(node.id) }, set: { _ in toggle(node.id) })) {
                Text(node.label)
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.inkSoft)
                    .lineLimit(1)
            }
            .toggleStyle(CheckToggleStyle())
            Spacer(minLength: 6)
            // What the node HOLDS, not what shows: a count that fell to zero
            // on an untick would read as a category that lost its looks.
            Text("\(branch.count)")
                .font(Brand.mono(11)).foregroundStyle(palette.muted).monospacedDigit()
            Text(formatPackBytes(looksBytes(branch, sizes)))
                .font(Brand.mono(11)).foregroundStyle(palette.muted).monospacedDigit()
        }
        .padding(.leading, CGFloat(depth) * 14)
    }

    private func lookRow(_ look: PackLook, _ depth: Int) -> some View {
        let weight = lookWeight(pack, look, sizes)
        return HStack(spacing: 8) {
            Toggle(isOn: Binding(get: { !hidden.contains(look.id) }, set: { _ in toggle(look.id) })) {
                Text(look.label)
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.muted)
                    .lineLimit(1)
            }
            .toggleStyle(CheckToggleStyle())
            Spacer(minLength: 6)
            Text(lookWeightLabel(weight))
                .font(Brand.mono(11))
                .foregroundStyle(weight.where == .here ? palette.inkSoft : palette.muted)
                .monospacedDigit()
                .help(deviceWords(lookWeightNote(weight, keptOn)))
            Button {
                asking = Asking(look: look)
            } label: {
                Image(systemName: "trash").font(.system(size: 11))
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Forget “\(look.label)”")
        }
        .padding(.leading, CGFloat(depth) * 14)
    }

    private func toggle(_ id: String) {
        var next = hidden
        if next.contains(id) { next.remove(id) } else { next.insert(id) }
        let list = pack.hidden.filter { next.contains($0) } + next.filter { !pack.hidden.contains($0) }.sorted()
        Task { await library.setHidden(pack.id, list) }
    }

    // MARK: - the verbs

    private func keep(on sourceId: String) async {
        pushError = nil
        pushing = true
        push = PushProgress(done: 0, total: 0, bytes: 0)
        do {
            let result = try await library.keep(pack.id, on: sourceId) { progress in
                Task { @MainActor in push = progress }
            }
            if !result.missingLocally.isEmpty {
                pushError = "\(result.missingLocally.count) looks are not on this device, so they were not sent."
            }
        } catch {
            pushError = String(describing: error)
        }
        pushing = false
        push = nil
    }

    private func title(_ question: Asking) -> String {
        if let look = question.look { return "Forget “\(look.label)”?" }
        return "Forget “\(pack.name.isEmpty ? "this pack" : pack.name)”?"
    }

    /// What the question quotes, and what the answer reports: MEASURED, not
    /// promised — a look whose lattice another look also ships frees nothing.
    private func message(_ look: PackLook?) -> String {
        let doomed = look.map { [$0.id] } ?? pack.looks.map(\.id)
        let wouldFree = hashBytes(freedHashes(library.packs, pack.id, doomed).free, sizes)
        let whole = look == nil
        var lines: [String] = []
        if wouldFree > 0 {
            lines.append("\(formatPackBytes(wouldFree)) come back\(keptOn.map { ", here and on \($0)" } ?? "").")
        } else {
            lines.append("No bytes come back: another look still holds the same lattice.")
        }
        let leaves = whole ? "Its \(pack.looks.count) looks leave the pickers." : "It leaves the pickers."
        let grade = wouldFree > 0
            ? "A grade already wearing \(whole ? "one of them" : "it") will say the look is gone instead of rendering flat."
            : "A grade already wearing it keeps rendering, from the lattice the other look holds."
        lines.append("\(leaves) \(grade) Importing the folder again brings \(whole ? "them" : "it") back.")
        if !whole { lines.append("To keep the bytes and only put the look away, cancel and untick it instead.") }
        return lines.joined(separator: "\n\n")
    }

    private func forget(_ look: PackLook?) async {
        pushError = nil
        note = nil
        forgetting = true
        do {
            if let look {
                let result = try await library.forgetLook(pack.id, look.id)
                note = "Forgot “\(look.label)” — \(forgotten(result))"
            } else {
                _ = try await library.forgetPack(pack.id)
            }
            onForgotten()
        } catch {
            pushError = String(describing: error)
        }
        forgetting = false
        asking = nil
    }
}

/// A tick box — the web's checkbox, drawn the same on a phone and a Mac.
struct CheckToggleStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        CheckBody(configuration: configuration)
    }

    private struct CheckBody: View {
        let configuration: ToggleStyleConfiguration
        @Environment(\.palette) private var palette

        var body: some View {
            Button {
                configuration.isOn.toggle()
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: configuration.isOn ? "checkmark.square.fill" : "square")
                        .foregroundStyle(configuration.isOn ? palette.accent : palette.muted)
                    configuration.label
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(configuration.isOn ? .isSelected : [])
        }
    }
}

/// An ⓘ with its note unfolded under it — the web's `InfoDot`, for a sheet
/// that is not a Develop section.
struct InfoNote: View {
    let paragraphs: [String]
    @State private var open = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            DevelopInfoDot(about: "this", isOpen: $open)
            if open { DevelopNote(paragraphs: paragraphs) }
        }
    }
}
