// The personal presets and the batch verbs — the web's
// `DevelopPresetsSection` and `DevelopApplySection` (`DevelopSections.tsx`),
// in the Adjust tab's own fold frame (`DevelopSection`).
//
// A chip writes a COPY of its numbers into the draft — applied, never
// followed, so editing a preset later changes no picture; there is no factory
// set; a preset saved here may carry the picture's LOOK too (`+ look`). The
// batch verbs write the same numbers onto other pictures NOW, each as its own
// copy — the look under it stays theirs.

import SwiftUI
import AtelierKit

struct PresetsSection: View {
    @Bindable var editor: RollEditor
    @Environment(PresetBookStore.self) private var presets
    @Environment(\.palette) private var palette
    @State private var naming = false
    @State private var name = ""
    @State private var withLook = false
    @FocusState private var nameFocused: Bool

    private var canSave: Bool { !editor.asShot || editor.picture?.grade != nil }

    var body: some View {
        DevelopSection(id: "presets", title: "Presets", info: [
            "Your own names for a light, kept \(presets.keptOn). A chip writes a COPY of its numbers here — applied, never followed, so editing a preset later changes no picture. There is no factory set.",
            "A preset may carry the picture’s LOOK too (+ look); it is worn by the picture it is applied to.",
        ], defaultOpen: true) {
            VStack(alignment: .leading, spacing: 10) {
                Text("kept \(presets.keptOn)")
                    .font(Brand.mono(10))
                    .foregroundStyle(palette.muted)
                if !presets.presets.isEmpty {
                    PresetChipFlow(spacing: 6) {
                        ForEach(presets.presets, id: \.id) { preset in
                            chip(preset)
                        }
                    }
                }
                if naming {
                    namingRow
                } else {
                    Button("Save current as…") {
                        naming = true
                        nameFocused = true
                    }
                    .buttonStyle(DevelopPillButtonStyle())
                    .disabled(!canSave)
                    .help(canSave ? "Keep these numbers under a name of your own" : "Move a slider first")
                }
            }
        }
    }

    private func chip(_ preset: DevelopPreset) -> some View {
        HStack(spacing: 0) {
            Button {
                editor.wearPreset(preset)
            } label: {
                HStack(spacing: 4) {
                    Text(preset.name)
                    if preset.look != nil {
                        Text("+ look").font(Brand.mono(9)).foregroundStyle(palette.accentInk)
                    }
                }
                .font(Brand.sans(12))
                .foregroundStyle(palette.inkSoft)
                .padding(.leading, 10)
                .padding(.trailing, 6)
                .padding(.vertical, 5)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help(describeDevelop(preset.settings) + (preset.look != nil ? " · and its look" : ""))
            Rectangle().fill(palette.line).frame(width: 1, height: 18)
            Button {
                presets.remove(preset.id)
            } label: {
                Text("×")
                    .font(Brand.mono(11))
                    .foregroundStyle(palette.muted)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 5)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Remove preset \(preset.name)")
            .help("Remove this preset — the pictures it was applied to keep their numbers")
        }
        .background(palette.paper, in: Capsule())
        .overlay(Capsule().stroke(palette.lineStrong, lineWidth: 1))
    }

    private var namingRow: some View {
        HStack(spacing: 6) {
            TextField("Name this light", text: $name)
                .textFieldStyle(.roundedBorder)
                .font(Brand.sans(14))
                .focused($nameFocused)
                .onSubmit(save)
                .onChange(of: nameFocused) { _, focused in editor.textEditing = focused }
                #if os(macOS)
                .onExitCommand { close() }
                #endif
            if editor.picture?.grade != nil {
                Toggle("+ look", isOn: $withLook)
                    .toggleStyle(.button)
                    .font(Brand.mono(10))
                    .help("Save this picture’s look with the light")
            }
            Button("Save", action: save)
                .buttonStyle(DevelopPillButtonStyle())
                .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            Button("Cancel", action: close)
                .buttonStyle(DevelopLinkButtonStyle())
        }
    }

    private func close() {
        naming = false
        editor.textEditing = false
    }

    private func save() {
        let label = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !label.isEmpty else { return }
        editor.savePreset(named: label, withLook: withLook && editor.picture?.grade != nil)
        name = ""
        close()
    }
}

/// The host's batch verbs, each run on its click and said beside the name.
struct ApplySection: View {
    @Bindable var editor: RollEditor
    let verbs: [ApplyVerb]
    var title = "Apply to…"
    var id = "apply"
    @Environment(\.palette) private var palette

    var body: some View {
        if !verbs.isEmpty {
            DevelopSection(id: id, title: title,
                           info: ["The same settings written onto other pictures, now, each as its own copy."],
                           foldable: verbs.count > 1) {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(verbs) { verb in
                        VStack(alignment: .leading, spacing: 3) {
                            Button(verb.label) {
                                verb.run()
                                editor.tell("done · \(verb.label.lowercased())")
                            }
                            .buttonStyle(DevelopPillButtonStyle())
                            Text(verb.hint)
                                .font(Brand.mono(10))
                                .foregroundStyle(palette.faint)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
        }
    }
}

/// Chips that wrap onto as many lines as they need.
struct PresetChipFlow: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var line: CGFloat = 0
        var widest: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > width {
                y += line + spacing
                x = 0
                line = 0
            }
            x += size.width + spacing
            line = max(line, size.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: min(widest, width), height: y + line)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var line: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX && x + size.width > bounds.maxX {
                y += line + spacing
                x = bounds.minX
                line = 0
            }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            line = max(line, size.height)
        }
    }
}
