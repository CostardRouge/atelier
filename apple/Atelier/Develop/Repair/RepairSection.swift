// Repair — heal, clone, dust — at the top of the Detail tab. Port of
// `src/tools/develop/RepairPanel.tsx`, in its order and its words: the
// Repair switch beside Heal / Clone, Size and Feather (the SELECTED patch's
// when a ring was taken hold of, else what the next patch is placed with),
// the selected patch's line with Done and Remove, Find spots with the count
// it proposes and Heal all, the Sensitivity and the map, then Undo last and
// Clear. The maths is the kernel's (`Render/Repair.swift`), the state and the
// verbs `Store/RollEditor+Repair.swift`, the gestures `RepairStageOverlay`.
//
// `RepairSectionPlaceholder` is the name `InspectorView` calls (the shell's
// contract, `PendingSections.swift`); it is the real section now.

import SwiftUI
import AtelierKit

/// The name the inspector calls for the Detail tab's repair.
struct RepairSectionPlaceholder: View {
    @Bindable var editor: RollEditor
    var body: some View { RepairSection(editor: editor) }
}

struct RepairSection: View {
    @Bindable var editor: RollEditor
    @State private var confirmClear = false
    @Environment(\.palette) private var palette

    static let hint = "A patch replaces a disc of the picture with another disc’s pixels, feathered at its edge. Heal copies the source’s TEXTURE and shifts it to the destination’s own tone — measured on the surroundings of each disc, never on the spot itself — so a sensor mark disappears into a sky that is not quite the same blue where it was borrowed from. Clone copies the source exactly, for a thing that must be moved rather than blended. With Repair on, a tap places a patch and takes its source from beside it; a DRAG from the spot points at where to borrow from, at any distance — the source turns round the spot as the hand does. Every ring on the picture stays alive: drag a solid ring to move its patch, CLICK it to take the patch off (the cursor shows a −), drag its dashed ring to change where it borrows from and click that one to edit the patch with the sliders below; ⌫ also takes the edited one off. Find spots draws the picture as a map of what falls below its surroundings — the marks a monitor hides at the fit read as bright discs — and proposes the small round ones as dotted rings: tap one to heal it, or heal them all. Patches are numbers on the roll, never pixels: they follow a crop and a full-size export."

    var body: some View {
        let state = editor.repairState
        let patches = editor.repairPatches
        let full = patches.count >= maxPatches
        let selected = editor.repairSelected
        let edited = editor.repairEdited
        let title: String = patches.isEmpty ? "Repair" : "Repair · \(describePatches(patches))"
        DevelopSection(id: "repair", title: title, info: [Self.hint], marked: !patches.isEmpty) {
            armRow(state: state, full: full, kind: edited.kind)
            sliders(edited, selected: selected != nil)
            selectionLine(selected: selected, patches: patches, full: full)
            dustRow(state: state, full: full)
            if state.dust.on {
                dustControls(state)
            }
            if !patches.isEmpty {
                listVerbs
            }
        }
        .confirmationDialog(clearTitle(patches.count), isPresented: $confirmClear, titleVisibility: .visible) {
            Button("Clear", role: .destructive) { editor.repairClear() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Every patch of this picture goes. ⌘Z brings them back.")
        }
    }

    private func clearTitle(_ n: Int) -> String {
        "Take off \(n == 1 ? "the patch" : "all \(n) patches")?"
    }

    // MARK: - Repair, Heal / Clone

    private func armRow(state: RepairEditState, full: Bool, kind: PatchKind) -> some View {
        HStack(spacing: 8) {
            Button(state.repairing ? "Repairing…" : "Repair") { editor.repairSetRepairing(!state.repairing) }
                .buttonStyle(DevelopPillButtonStyle(on: state.repairing))
                .disabled(full && !state.repairing)
                .accessibilityAddTraits(state.repairing ? .isSelected : [])
                .help("Tap the picture to place a patch, drag from a spot to say where it borrows from")
            Picker("Patch", selection: Binding(get: { kind }, set: { editor.repairSetTool(kind: $0) })) {
                Text("Heal").tag(PatchKind.heal)
                Text("Clone").tag(PatchKind.clone)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .frame(maxWidth: .infinity)
        }
    }

    // MARK: - Size, Feather

    @ViewBuilder
    private func sliders(_ edited: RepairTool, selected: Bool) -> some View {
        let suffix = selected ? " · this patch" : ""
        let size = String(format: "%.1f %%", edited.radius * 100)
        let feather = "\(Int(DevelopNumbers.jsRound(edited.feather * 100))) %"
        DevelopRangeSlider("Size\(suffix)", value: edited.radius, in: patchRadiusRange.min...patchRadiusRange.max,
                           step: 0.002, reset: defaultPatchRadius, printed: size) { value in
            editor.repairSetTool(radius: value)
        }
        DevelopRangeSlider("Feather\(suffix)", value: edited.feather, in: 0...1, step: 0.05,
                           reset: defaultPatchFeather, printed: feather) { value in
            editor.repairSetTool(feather: value)
        }
    }

    // MARK: - the selected patch

    @ViewBuilder
    private func selectionLine(selected: Patch?, patches: [Patch], full: Bool) -> some View {
        if let selected {
            let at = (patches.firstIndex { $0.id == selected.id } ?? 0) + 1
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("patch \(at) of \(patches.count) · drag its ring to move it, \(pointerWord) it to take it off, drag the dashed one to change its source")
                    .font(Brand.mono(10))
                    .foregroundStyle(palette.faint)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 4)
                Button("Done") { editor.repairDeselect() }
                    .buttonStyle(DevelopLinkButtonStyle())
                    .help("Let go of this patch (Esc)")
                Button("Remove") { editor.repairRemoveSelected() }
                    .buttonStyle(DevelopLinkButtonStyle())
                    .help("Take this patch off (⌫)")
            }
        } else if !patches.isEmpty {
            Text(full ? "\(maxPatches) patches, the most a picture holds"
                      : "drag a ring to move it · \(pointerWord) a solid ring to take it off · \(pointerWord) a dashed one to edit it")
                .font(Brand.mono(10))
                .foregroundStyle(palette.faint)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var pointerWord: String {
        #if os(macOS)
        return "click"
        #else
        return "tap"
        #endif
    }

    // MARK: - finding dust

    private func dustRow(state: RepairEditState, full: Bool) -> some View {
        let found = editor.repairVisibleSpots?.count
        return HStack(spacing: 8) {
            Button(state.dust.on ? "Finding spots…" : "Find spots") {
                editor.repairSetDust { $0.on.toggle() }
            }
            .buttonStyle(DevelopPillButtonStyle(on: state.dust.on))
            .accessibilityAddTraits(state.dust.on ? .isSelected : [])
            .help("Look over the picture for sensor spots: a map of what falls below its surroundings, and the small round marks proposed as rings")
            if state.dust.on {
                Text(dustStatus(state: state, found: found))
                    .font(Brand.mono(10))
                    .foregroundStyle(palette.faint)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .accessibilityAddTraits(.updatesFrequently)
                Spacer(minLength: 4)
                if let found, found > 0 {
                    Button("Heal all") { editor.repairHealAll() }
                        .buttonStyle(DevelopLinkButtonStyle())
                        .disabled(full)
                        .help(full ? "\(maxPatches) patches, the most a picture holds" : "Heal every proposed spot from its cleanest neighbour")
                }
            }
        }
        .padding(.top, 4)
    }

    /// The web's three words — plus the one a scan off the main thread has:
    /// it is under way.
    private func dustStatus(state: RepairEditState, found: Int?) -> String {
        if state.measuring { return "looking over the picture…" }
        guard let found else { return "the picture is not decoded yet" }
        if found == 0 { return "no spot proposed" }
        return "\(found) spot\(found == 1 ? "" : "s") proposed"
    }

    @ViewBuilder
    private func dustControls(_ state: RepairEditState) -> some View {
        let sensitivity = state.dust.sensitivity
        DevelopRangeSlider("Sensitivity", value: sensitivity, in: 0...1, step: 0.02, reset: defaultDustSensitivity,
                           printed: "\(Int(DevelopNumbers.jsRound(sensitivity * 100))) %") { value in
            editor.repairSetDust { $0.sensitivity = value }
        }
        Toggle(isOn: Binding(get: { state.dust.map }, set: { on in editor.repairSetDust { $0.map = on } })) {
            Text("show the map — the picture as what falls below its surroundings")
                .font(Brand.mono(10))
                .foregroundStyle(palette.faint)
                .fixedSize(horizontal: false, vertical: true)
        }
        .toggleStyle(.switch)
        .controlSize(.mini)
        Text("\(pointerWord) a dotted ring to heal that spot · a proposal is never a patch until it is taken")
            .font(Brand.mono(10))
            .foregroundStyle(palette.faint)
            .fixedSize(horizontal: false, vertical: true)
    }

    // MARK: - the list

    private var listVerbs: some View {
        HStack(spacing: 12) {
            Spacer(minLength: 0)
            Button("Undo last") { editor.repairRemoveLast() }
                .buttonStyle(DevelopLinkButtonStyle())
                .help("Take off the last patch placed")
            Button("Clear") { confirmClear = true }
                .buttonStyle(DevelopLinkButtonStyle())
                .help("Take off every patch of this picture")
        }
    }
}

// MARK: - previews

#Preview("Repair · a patch selected") {
    ScrollView {
        RepairSection(editor: RepairPreviewFixture.editor())
            .padding(14)
    }
    .frame(minWidth: 340, minHeight: 520)
    .background(Palette.darkroom.surface)
    .darkroom()
}

#Preview("Repair · finding spots") {
    let editor = RepairPreviewFixture.editor(selected: nil, repairing: false)
    editor.repairState.dust.on = true
    return ScrollView {
        RepairSection(editor: editor)
            .padding(14)
    }
    .frame(minWidth: 340, minHeight: 520)
    .background(Palette.darkroom.surface)
    .darkroom()
}
