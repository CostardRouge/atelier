// The Develop inspector — the web's `PanelHost` over `PictureWorkbench`'s
// five tabs, in their order and with their sections in theirs:
//
//   Adjust   the histogram · Auto · white balance (a RAW) · light & colour ·
//            presence · levels · curve · mixer · grading · vignette ·
//            presets · apply to… · the look (+ apply look to…)
//   Detail   repair · detail
//   Layers   the layers and their masks
//   Crop     crop · apply crop to… · borders · apply borders to… ·
//            perspective · lens (`Develop/Crop/`)
//   Export   what leaves, and how
//
// One section = one slot, named after the web's section. The Adjust sections
// are `Develop/Panels/` — pure views over the develop's binding; the rest are
// the stand-ins of `PendingSections.swift` until their tasks land. On a wide
// screen the tabs are a segmented strip pinned at the top of the column; on
// a phone the strip is the drawer's own (`InspectorDrawer`) and this draws
// the sections alone.

import SwiftUI
import AtelierKit

struct InspectorView: View {
    @Bindable var editor: RollEditor
    /// Draw the tab strip — a wide screen's column; a phone's drawer has its own.
    let showsTabs: Bool
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(spacing: 0) {
            if showsTabs {
                Picker("Inspector", selection: $editor.tab) {
                    ForEach(WorkbenchTab.allCases, id: \.self) { tab in
                        Text(tab.label).tag(tab)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .padding(12)
                Hairline()
            }
            if let picture = editor.picture {
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        InspectorTab(editor: editor, tab: editor.tab, picture: picture)
                    }
                    .padding(.horizontal, 14)
                    .padding(.bottom, 20)
                }
                .scrollDismissesKeyboard(.interactively)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Text("No picture open.")
                        .foregroundStyle(palette.inkSoft)
                    Text("Add pictures from Photos, Files or a folder, then pick one in the strip.")
                        .font(Brand.sans(13))
                        .foregroundStyle(palette.muted)
                }
                .padding(16)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
        }
    }
}

/// One tab's sections, in the web's order.
struct InspectorTab: View {
    @Bindable var editor: RollEditor
    let tab: WorkbenchTab
    let picture: RollPicture

    var body: some View {
        switch tab {
        case .adjust: adjust
        case .detail: detail
        case .layers: LayersSectionPlaceholder(editor: editor)
        case .crop: CropTabSections(editor: editor)
        case .export: ExportSectionPlaceholder(editor: editor)
        }
    }

    @ViewBuilder
    private var adjust: some View {
        Group {
            DevelopHistogramView(histogram: editor.histogram, clipping: editor.clipping,
                                 onClipping: { editor.clipping.toggle() }, readout: editor.readoutStore)
                .padding(.vertical, 12)
            DevelopAutoSection(settings: editor.developBinding, stats: editor.pool.stats[picture.id],
                               picking: editor.activeTool == .eyedropper,
                               onPicking: { editor.setTool($0 ? .eyedropper : .none) },
                               onTold: { editor.tell($0) })
            // The camera's white comes from the decoder, which the app's does not
            // hand out yet: the section says so on a RAW and draws nothing elsewhere.
            WhiteBalanceSection(settings: editor.developBinding, white: nil)
            DevelopSlidersSection(settings: editor.developBinding)
            PresenceSection(detail: editor.detailBinding)
        }
        Group {
            DevelopLevelsSection(settings: editor.developBinding)
            DevelopCurveSection(settings: editor.developBinding, histogram: editor.histogram)
            DevelopMixerSection(settings: editor.developBinding)
            DevelopGradingSection(settings: editor.developBinding)
                .id(picture.id)
            VignetteSection(vignette: editor.vignetteBinding)
        }
        Group {
            PresetsSection(editor: editor)
            ApplySection(editor: editor, verbs: editor.developApplyVerbs)
            LookSectionPlaceholder(editor: editor)
        }
    }

    @ViewBuilder
    private var detail: some View {
        RepairSectionPlaceholder(editor: editor)
        DetailSection(detail: editor.detailBinding)
    }
}
