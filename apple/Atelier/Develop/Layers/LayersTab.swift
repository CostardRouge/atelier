// The inspector's LAYERS tab — the web's `LayersPanel.tsx` + `MaskPanel.tsx`
// + the open layer's develop, in `PictureWorkbench.tsx`'s order:
//
//   Layers   the stack, top first — add by kind, the eye, the name, the
//            opacity, up / down, delete; a row's menu renames, duplicates
//            and moves; under it, how the open layer's mask is shown
//   Mask     the open layer's mask and its combined parts (`MaskSection`)
//   Light · Tone · Colour, Curve — the SAME sections the Adjust tab draws,
//            bound to the layer's own `DevelopSettings`: a layer's
//            adjustment IS a develop (`render-layers.md`), so a local
//            exposure is the maths of a global one and folds under `layer.`
//
// `LayersSectionPlaceholder` is the name `InspectorView` calls (the shell's
// contract, `PendingSections.swift`); it is the real tab now.

import SwiftUI
import AtelierKit

/// The name the inspector calls for the Layers tab.
struct LayersSectionPlaceholder: View {
    @Bindable var editor: RollEditor
    var body: some View { LayersTab(editor: editor) }
}

struct LayersTab: View {
    @Bindable var editor: RollEditor

    var body: some View {
        let state = editor.layerState
        VStack(alignment: .leading, spacing: 0) {
            LayerListSection(editor: editor, state: state)
            if let layer = editor.openLayer {
                MaskSection(editor: editor, state: state, layer: layer)
                DevelopSlidersSection(settings: editor.openLayerDevelopBinding, foldPrefix: "layer.")
                DevelopCurveSection(settings: editor.openLayerDevelopBinding, histogram: editor.histogram,
                                    foldPrefix: "layer.")
                    // The curve's own drag state belongs to one layer.
                    .id(layer.id)
            }
        }
    }
}

/// One way to add a layer — the web's `KINDS`, in its order.
struct LayerKindOption: Identifiable {
    let kind: MaskKind?
    let label: String
    var id: String { kind?.rawValue ?? "none" }

    static let all: [LayerKindOption] = [
        LayerKindOption(kind: .linear, label: "Linear"),
        LayerKindOption(kind: .radial, label: "Radial"),
        LayerKindOption(kind: .luma, label: "Brightness"),
        LayerKindOption(kind: .colour, label: "Colour"),
        LayerKindOption(kind: .brush, label: "Painted"),
        LayerKindOption(kind: .subject, label: "Subject"),
        LayerKindOption(kind: nil, label: "Whole picture"),
    ]
}

/// The stack, drawn TOP FIRST — every layer UI since Photoshop shows the top
/// of the stack at the top — while every helper speaks the real order and is
/// addressed by id, so the reversal cannot leak into an index.
struct LayerListSection: View {
    @Bindable var editor: RollEditor
    let state: LayerEditState
    @State private var renaming: String?
    @State private var draftName = ""
    @State private var confirmDelete: AdjustLayer?
    @FocusState private var nameFocused: Bool
    @Environment(\.palette) private var palette

    static let hint = "A layer is an ordinary develop that applies only where its mask says. Linear is a straight edge with a soft transition — a darkened sky; radial is an ellipse — a face lifted out of its surround, or a vignette drawn on purpose; brightness picks a band of tone wherever it falls in the frame; colour picks the colours you tap, wherever they are; painted is drawn by hand on the picture; subject is found by a model from a point you tap. A layer’s mask can be COMBINED with further ones — added, subtracted or intersected — in the layer’s own mask panel. Everything on the Develop tab works inside a layer, so a local exposure, a local white balance and a local curve are the same controls you already know. Layers apply on top of the picture as you see it, after its own develop and its look, so what a slider does here is what you are looking at."

    var body: some View {
        let layers = editor.layerList
        let full = layers.count >= maxLayers
        DevelopSection(id: "layers", title: "Layers", info: [Self.hint],
                       marked: !drawingLayers(layers).isEmpty, foldable: false) {
            addGrid(full: full)
            if full {
                Text("\(maxLayers) layers is the limit — each one is a pass over the whole picture")
                    .font(Brand.mono(10))
                    .foregroundStyle(palette.faint)
            }
            if layers.isEmpty {
                Text("No layers. Add one and it changes nothing until you move a slider on it.")
                    .font(Brand.mono(11))
                    .foregroundStyle(palette.faint)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                VStack(spacing: 4) {
                    ForEach(Array(layers.reversed()), id: \.id) { layer in
                        row(layer, layers)
                    }
                }
            }
            if editor.openLayer != nil {
                maskView
            }
        }
        .confirmationDialog(deleteTitle, isPresented: Binding(get: { confirmDelete != nil },
                                                            set: { if !$0 { confirmDelete = nil } }),
                            titleVisibility: .visible) {
            Button("Delete layer", role: .destructive) {
                if let layer = confirmDelete { editor.layerRemove(layer.id) }
                confirmDelete = nil
            }
            Button("Cancel", role: .cancel) { confirmDelete = nil }
        } message: {
            Text("Its mask and its develop go with it. ⌘Z brings it back.")
        }
    }

    private var deleteTitle: String {
        confirmDelete.map { "Delete “\(layerLabel($0, editor.layerList))”?" } ?? ""
    }

    // MARK: - adding

    private func addGrid(full: Bool) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 92), spacing: 6)], alignment: .leading, spacing: 6) {
            ForEach(LayerKindOption.all) { option in
                let title: String = "+ \(option.label)"
                let tip: String = option.kind == nil
                    ? "A layer over the whole picture — a shape can be given later"
                    : "A new layer with a \(option.label.lowercased()) mask, on top"
                Button(title) { editor.layerAdd(option.kind) }
                    .buttonStyle(DevelopPillButtonStyle())
                    .disabled(full)
                    .help(tip)
            }
        }
    }

    // MARK: - one row

    private func row(_ layer: AdjustLayer, _ layers: [AdjustLayer]) -> some View {
        let selected = layer.id == editor.openLayer?.id
        let label = layerLabel(layer, layers)
        let spoken: String = layer.enabled ? "Hide \(label)" : "Show \(label)"
        let eyeTip: String = layer.enabled ? "Hide this layer" : "Show this layer"
        let openTip: String = selected ? "Close this layer" : "Open this layer — its mask and its develop"
        return HStack(spacing: 6) {
            // Visibility is a VERB, not a field: an eye crossed out says which
            // state it is in, where an unticked box only says which it is not.
            Button {
                editor.layerToggleEnabled(layer.id)
            } label: {
                Image(systemName: layer.enabled ? "eye" : "eye.slash")
                    .font(.system(size: 12, weight: .medium))
                    .frame(width: 26, height: 26)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(layer.enabled ? palette.inkSoft : palette.faint)
            .accessibilityLabel(spoken)
            .help(eyeTip)

            if renaming == layer.id {
                TextField("Layer name", text: $draftName, prompt: Text(describeMask(layer.mask)))
                    .font(Brand.mono(11))
                    .textFieldStyle(.plain)
                    .focused($nameFocused)
                    .onSubmit { commitRename(layer.id) }
                    .onChange(of: nameFocused) { _, focused in
                        editor.textEditing = focused
                        if !focused { commitRename(layer.id) }
                    }
                    #if os(macOS)
                    .onExitCommand { cancelRename() }
                    #endif
                    .onAppear { nameFocused = true }
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                Button {
                    editor.layerSelect(selected ? nil : layer.id)
                } label: {
                    HStack(spacing: 0) {
                        Text(label)
                            .strikethrough(!layer.enabled)
                            .foregroundStyle(layer.enabled ? palette.ink : palette.faint)
                        if layer.opacity < 1 {
                            Text(" · \(Int((layer.opacity * 100).rounded())) %")
                                .foregroundStyle(palette.faint)
                        }
                    }
                    .font(Brand.mono(11))
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? .isSelected : [])
                .help(openTip)
            }

            rowButton("chevron.up", "Move up") { editor.layerMove(layer.id, 1) }
            rowButton("chevron.down", "Move down") { editor.layerMove(layer.id, -1) }
            rowButton("trash", "Delete layer") { delete(layer) }
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 3)
        .background(RoundedRectangle(cornerRadius: 8).fill(selected ? palette.paper2 : Color.clear))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(selected ? palette.accent : palette.line, lineWidth: 1))
        .contextMenu {
            Button {
                startRename(layer)
            } label: {
                Label("Rename…", systemImage: "pencil")
            }
            Button {
                editor.layerDuplicate(layer.id)
            } label: {
                Label("Duplicate", systemImage: "plus.square.on.square")
            }
            .disabled(layers.count >= maxLayers)
            Button {
                editor.layerToggleEnabled(layer.id)
            } label: {
                Label(layer.enabled ? "Hide" : "Show", systemImage: layer.enabled ? "eye.slash" : "eye")
            }
            Divider()
            Button {
                editor.layerMove(layer.id, 1)
            } label: {
                Label("Move up", systemImage: "chevron.up")
            }
            Button {
                editor.layerMove(layer.id, -1)
            } label: {
                Label("Move down", systemImage: "chevron.down")
            }
            Divider()
            Button(role: .destructive) {
                delete(layer)
            } label: {
                Label("Delete layer", systemImage: "trash")
            }
        }
    }

    private func rowButton(_ symbol: String, _ label: String, _ run: @escaping () -> Void) -> some View {
        Button(action: run) {
            Image(systemName: symbol)
                .font(.system(size: 11, weight: .medium))
                .frame(width: 24, height: 24)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(palette.muted)
        .accessibilityLabel(label)
        .help(label)
    }

    /// A layer that changes something goes through a question; one that
    /// changes nothing yet goes at once — and ⌘Z brings either back.
    private func delete(_ layer: AdjustLayer) {
        if isDefaultDevelop(layer.develop) {
            editor.layerRemove(layer.id)
        } else {
            confirmDelete = layer
        }
    }

    // MARK: - renaming

    private func startRename(_ layer: AdjustLayer) {
        draftName = layer.name
        renaming = layer.id
    }

    /// An emptied name gives the row back to its mask's description.
    private func commitRename(_ id: String) {
        guard renaming == id else { return }
        renaming = nil
        editor.textEditing = false
        editor.layerRename(id, draftName)
    }

    private func cancelRename() {
        renaming = nil
        editor.textEditing = false
    }

    // MARK: - how the open layer's mask is shown

    /// HOW the mask is shown, and WHEN: by itself while Pick or Paint is on —
    /// the moment the mask is being made — else only when pinned, since a red
    /// wash left on by accident reads as the picture.
    private var maskView: some View {
        let autoShown = editor.maskPointerKind != nil
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text("Mask")
                    .font(Brand.mono(10))
                    .foregroundStyle(palette.faint)
                Picker("Show the mask", selection: Binding(get: { state.maskView },
                                                          set: { editor.layersSetMaskView($0) })) {
                    ForEach(MaskView.allCases, id: \.self) { view in
                        Text(view.label).tag(view)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                Spacer(minLength: 4)
                Button("Done") { editor.layerSelect(nil) }
                    .buttonStyle(DevelopLinkButtonStyle())
                    .help("Close the layer — Esc")
            }
            Toggle(isOn: Binding(get: { state.showMask }, set: { editor.layersSetShowMask($0) })) {
                Text(autoShown ? "keep it shown once Pick / Paint is off · M"
                               : "show it now — it shows by itself while picking or painting · M")
                    .font(Brand.mono(10))
                    .foregroundStyle(palette.faint)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .toggleStyle(.switch)
            .controlSize(.mini)
        }
        .padding(.top, 4)
    }
}

// MARK: - previews

/// A roll of one picture carrying a few layers, for the previews — nothing
/// here reaches a document on disk that anything else reads.
@MainActor
enum LayersPreviewFixture {
    static var layers: [AdjustLayer] {
        var sky = createLayer(.linear, id: "sky")
        sky.name = "Sky"
        sky.develop.exposure = -0.7
        var face = createLayer(.radial, id: "face")
        face.develop.shadows = 30
        face.opacity = 0.6
        var person = createLayer(.subject, id: "person")
        person.mask = .subject(SubjectMask(points: [AtelierKit.Point(0.52, 0.6)]))
        var rest = createLayer(nil, id: "rest")
        rest.except = "person"
        rest.develop.saturation = -40
        rest.parts = [MaskPart(op: .subtract, mask: .radial(.default))]
        return [sky, face, person, rest]
    }

    static func editor(open: String? = "rest") -> RollEditor {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("atelier-layers-preview")
        let store = RollStore(root: root)
        var doc = createRollDoc(name: "Layers preview")
        var picture = createRollPicture(SavedMediaRef(name: "DJI_0101.JPG", size: 9_400_000, lastModified: 0))
        picture.layers = layers
        doc.pictures = [picture]
        store.insert(doc)
        let editor = RollEditor(store: store, pool: PicturePool(store: store), presets: PresetBookStore(root: root),
                                rollId: doc.id)
        editor.tab = .layers
        editor.layerSelect(open)
        return editor
    }
}

#Preview("Layers") {
    ScrollView {
        LayersTab(editor: LayersPreviewFixture.editor())
            .padding(14)
    }
    .frame(minWidth: 340, minHeight: 700)
    .background(Palette.darkroom.surface)
    .darkroom()
}

#Preview("No layers") {
    let editor = LayersPreviewFixture.editor(open: nil)
    editor.writeLayers { _ in [] }
    return ScrollView {
        LayersTab(editor: editor)
            .padding(14)
    }
    .frame(minWidth: 340, minHeight: 300)
    .background(Palette.darkroom.surface)
    .darkroom()
}
