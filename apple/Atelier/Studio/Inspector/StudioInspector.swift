// The Studio inspector — the web's `StudioEditor.tsx` right column, in its
// inspector grammar (`studio.md`, «The Studio inspector speaks the inspector
// grammar»): five tabs over sections, the panels INSIDE them the landed
// `Studio/Panels/` views, wrapped the way the web wraps them.
//
// - Overlay: Add an element (a CONTROLLED fold), the intro scene (its window
//   as the badge), Outro (Add an outro, or its panel), Elements (the count as
//   badge, Default deck / Reset deck in its header, the list capped and
//   scrolling on its own), then — for the selection — Element style and
//   Timing, and Guides;
// - Style: one Title style section;
// - Grade: the open media's DEVELOP as a settled row first (correction before
//   look, on screen as in the cube), then the grade stack;
// - Info: the media's facts and the telemetry under the playhead;
// - Export: the export task's panel (`PendingExport.swift`).
//
// Picking an element — here or on the stage — brings its settings into view
// (`ScrollViewReader`), the web's `scrollIntoView({block: 'nearest'})`.

import SwiftUI
import AtelierKit

struct StudioInspector: View {
    @Bindable var editor: StudioEditor
    /// The tabs drawn on top — a wide screen's column; on a phone the drawer's
    /// strip is the tabs.
    let showsTabs: Bool
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(spacing: 0) {
            if showsTabs {
                Picker("Inspector", selection: $editor.tab) {
                    ForEach(StudioTab.allCases, id: \.self) { tab in
                        Text(tab.label).tag(tab)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .padding(12)
            }
            ScrollViewReader { reader in
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        switch editor.tab {
                        case .overlay: overlay
                        case .style: style
                        case .grade: grade
                        case .info: info
                        case .export: StudioExportPanel(editor: editor)
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.bottom, 24)
                }
                .onChange(of: selectionKey) { _, _ in
                    guard editor.selectedId != nil, editor.tab == .overlay else { return }
                    withAnimation(.easeOut(duration: 0.2)) { reader.scrollTo(StudioInspector.elementAnchor) }
                }
            }
        }
    }

    /// Keyed on the tab too: coming back from another tab scrolls even when
    /// the selection itself did not change.
    private var selectionKey: String { "\(editor.selectedId ?? "-")|\(editor.tab.rawValue)" }

    static let elementAnchor = "studio.element-panel"

    // MARK: - Overlay

    @ViewBuilder
    private var overlay: some View {
        let edit = editor.edit
        StudioFoldSection(title: "Add an element", isOpen: $editor.paletteOpen) {
            ElementPaletteView(elements: edit.elements, cue: editor.activeCue, theme: edit.theme,
                               timeShift: edit.timeShift, isOpen: $editor.paletteOpen, bare: true) { element in
                editor.addElement(element)
            }
        }
        if let scene = editor.introScene {
            DevelopSection(id: "studio.scene", title: scene.name, badge: OverlayPanels.sceneBadge(scene),
                           remember: .local) {
                ScenePanelView(scene: editor.sceneBinding(scene.id),
                               memberCount: edit.elements.filter { $0.sceneId == scene.id }.count,
                               playhead: editor.windowTime) {
                    editor.removeScene(scene.id)
                }
            }
        }
        DevelopSection(id: "studio.outro", title: "Outro", badge: edit.outro.map { OverlayPanels.outroBadge($0) },
                       info: ["A closing card the export keeps encoding after the footage — appended, never over it."],
                       remember: .local) {
            if edit.outro != nil {
                OutroPanelView(outro: editor.outroBinding, aspect: editor.outroAspect) {
                    editor.removeOutro()
                }
            } else {
                OverlayPanelRow("Card") {
                    Button {
                        editor.addOutro()
                    } label: {
                        Label("Add an outro", systemImage: "plus")
                    }
                    .buttonStyle(DevelopPillButtonStyle())
                }
            }
        }
        StudioFoldSection(title: "Elements", badge: "\(edit.elements.count)", isOpen: $editor.listOpen,
                          actions: { deckActions(count: edit.elements.count) }) {
            if editor.resettingDeck && !edit.elements.isEmpty {
                let n = edit.elements.count
                Text("Replace \(n) element\(n > 1 ? "s" : "") with the default deck?")
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.muted)
            }
            // Capped and scrolling on its own: a deck of fifteen readouts used
            // to push the style panel off the bottom of the inspector.
            ScrollView {
                ElementListView(elements: edit.elements, selectedId: editor.selectedId, cue: editor.activeCue,
                                timeShift: edit.timeShift,
                                onSelect: { editor.select($0) },
                                onRemove: { editor.removeElement($0) },
                                onToggleVisible: { editor.toggleVisible($0) },
                                onMove: { editor.reorderElements($0, $1) })
            }
            .frame(maxHeight: 240)
        }
        if let element = editor.selectedElement {
            VStack(alignment: .leading, spacing: 0) {
                DevelopSection(id: "studio.element-style", title: "Element style",
                               info: ["The selected element’s own look. Delete removes it."], remember: .local) {
                    ElementPanelView(element: editor.elementBinding(element.id), theme: edit.theme)
                }
                DevelopSection(id: "studio.element-timing", title: "Timing", remember: .local) {
                    TimingPanelView(element: editor.elementBinding(element.id), scene: editor.selectedScene,
                                    playhead: editor.windowTime)
                }
            }
            .id(StudioInspector.elementAnchor)
        }
        DevelopSection(id: "studio.guides", title: "Guides", remember: .local) {
            GuidesControlView(guides: editor.binding(\.guides), frameAspect: editor.frameAspect, layout: .rows)
        }
    }

    @ViewBuilder
    private func deckActions(count: Int) -> some View {
        if count == 0 {
            Button("Default deck") { editor.loadDefaultDeck() }
                .buttonStyle(DevelopLinkButtonStyle())
        } else if editor.resettingDeck {
            HStack(spacing: 10) {
                Button("Reset") { editor.loadDefaultDeck() }
                    .buttonStyle(OverlayPanelDangerButtonStyle())
                Button("Keep") { editor.resettingDeck = false }
                    .buttonStyle(DevelopLinkButtonStyle())
            }
        } else {
            Button("Reset deck") { editor.resettingDeck = true }
                .buttonStyle(DevelopLinkButtonStyle())
        }
    }

    // MARK: - Style

    private var style: some View {
        DevelopSection(id: "studio.title-style", title: "Title style",
                       info: ["One look for every title and readout of the project; an element can still depart from it on its own style."],
                       remember: .local) {
            StylePanelView(theme: editor.binding(\.theme), heading: nil)
        }
    }

    // MARK: - Grade

    @ViewBuilder
    private var grade: some View {
        DevelopSettledRow(
            id: "studio.develop",
            info: ["This media’s own correction — exposure, tone, colour — applied before every look below. It belongs to this picture or clip and is kept with the project’s media, never in a project file."],
            develop: editor.activeDevelop,
            canOpen: editor.activeFile != nil && editor.hasFrame,
            onOpen: { editor.openDevelop() },
            onReset: { editor.setActiveDevelop(nil) }
        )
        DevelopSection(id: "studio.grade", title: "Grade", remember: .local) {
            GradeStackView(grade: editor.binding(\.grade), picture: lookPicture,
                           previewHeight: editor.renderedSize.map { Double($0.height) }, previewDraws: true)
        }
    }

    /// The still on the stage, for the look gallery's scene — the web hands
    /// its decoded photo over and nothing for a clip.
    private var lookPicture: LookPicture? {
        guard editor.isPhoto, let image = editor.source, let active = editor.active else { return nil }
        return LookPicture(image: image, label: editor.activeImage?.name, key: active.id)
    }

    // MARK: - Info

    @ViewBuilder
    private var info: some View {
        if let active = editor.active {
            InfoPanelView(baseName: active.baseName, fileBytes: editor.activeFile?.size, detail: editor.activeDetail,
                          duration: editor.playback.duration, cues: editor.cues, cue: editor.activeCue,
                          timing: editor.timing, scale: editor.scale, overridden: editor.overridden,
                          photo: editor.isPhoto ? (editor.photoExif ?? ExifData()) : nil)
                .padding(.top, 4)
        }
    }
}
