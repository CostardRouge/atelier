// The row above the photograph — the web's stage bar (`develop-roll.md`,
// «The stage bar: four controls, and nothing inserted»): the picture's NAME,
// which is the menu of its capture's files (`DevelopBaseChip`, the Adjust
// task's), a word said beside it (`· copied`), the ± pill, and ONE WELL of
// verbs: Copy · Paste · Reset (a ghost, apart — it throws work away), then
// past a hairline the stage's own — Settings (⌘⇧C), `A/B`, `?`. On a phone
// the verbs take a line of their own under the name, at a finger's height;
// on the crop the clipboard's three step aside (there is no develop to copy
// on that stage).

import SwiftUI
import AtelierKit

struct StageBar: View {
    @Bindable var editor: RollEditor
    @Bindable var zoom: LookingZoom
    let compact: Bool
    @Environment(\.palette) private var palette

    private var cropping: Bool { editor.tab == .crop }
    private var height: CGFloat { compact ? 34 : 28 }

    var body: some View {
        if compact {
            VStack(alignment: .leading, spacing: 6) {
                name
                HStack(spacing: 8) {
                    Spacer(minLength: 0)
                    if editor.stage != nil { zoomPill(large: true) }
                    well
                }
            }
        } else {
            HStack(spacing: 8) {
                name
                Spacer(minLength: 8)
                if editor.stage != nil { zoomPill(large: false) }
                well
            }
        }
    }

    /// The ± pill: the crop stage's own VIEW on the Crop tab (its zoom is
    /// inspection, the zone's size is the crop), the Looking zoom elsewhere —
    /// whose menu offers the zoomed view as a crop.
    @ViewBuilder
    private func zoomPill(large: Bool) -> some View {
        if cropping {
            CropZoomPill(editor: editor, large: large)
        } else {
            StageZoomPill(zoom: zoom, cropToView: editor.cropToViewAction(zoom), large: large)
        }
    }

    private var name: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            if let picture = editor.picture {
                // The name and what its bytes are. No row to choose yet: the
                // app's RAW path (`CIRAWFilter`) honours neither a rendition
                // nor a rung, and a choice that changes nothing would lie —
                // with no rows the chip draws the name as TEXT.
                DevelopBaseChip(name: pictureLabel(picture), chip: editor.fidelityChip, rows: [], current: nil,
                                base: .proxy, rungs: [], onRendition: { _ in }, onBase: { _ in })
            }
            if let told = editor.told {
                Text("· \(told)")
                    .font(Brand.mono(12))
                    .foregroundStyle(palette.accentInk)
                    .lineLimit(1)
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.2), value: editor.told)
    }

    private var well: some View {
        HStack(spacing: 2) {
            if !cropping {
                glyph("doc.on.doc", "Copy this develop",
                      editor.asShot ? "Nothing to copy — this picture is as shot" : "Copy ⌘C — keep these numbers for the next picture, in this session") {
                    editor.copyDevelopHere()
                }
                .disabled(editor.asShot)
                glyph("doc.on.clipboard", "Paste a develop onto this picture",
                      editor.canPasteDevelop ? "Paste ⌘V — replace these numbers with the copied ones" : "Nothing copied yet") {
                    editor.pasteDevelopHere()
                }
                .disabled(!editor.canPasteDevelop)
                glyph("arrow.counterclockwise", "Reset to as shot", "Reset to as shot — throw these numbers away", ghost: true) {
                    editor.resetDevelop()
                }
                .disabled(editor.asShot)
                Rectangle().fill(palette.lineStrong).frame(width: 1, height: 16).padding(.horizontal, 4)
                glyph("gearshape", "Copy, paste or apply settings",
                      "Settings ⌘⇧C — copy this picture’s sections, paste them, or apply them to other pictures") {
                    editor.settingsOpen = true
                }
                if editor.stage != nil { abPill }
            }
            Button {
                editor.helpOpen = true
            } label: {
                Text("?")
                    .font(Brand.mono(12))
                    .frame(width: height, height: height)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(palette.muted)
            .help("Keys and gestures (H)")
            .accessibilityLabel("Keys and gestures")
        }
        .disabled(editor.picture == nil)
        .padding(2)
        .background(palette.paper2, in: RoundedRectangle(cornerRadius: Brand.controlRadius))
        .overlay(RoundedRectangle(cornerRadius: Brand.controlRadius).stroke(palette.line, lineWidth: 1))
    }

    private func glyph(_ symbol: String, _ label: String, _ help: String, ghost: Bool = false,
                       action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: compact ? 14 : 12, weight: .medium))
                .frame(width: height, height: height)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(ghost ? palette.muted : palette.inkSoft)
        .help(help)
        .accessibilityLabel(label)
    }

    /// `A/B` — the Studio's word and colours. Suspended (a tool holds the
    /// pointer): dashed and faint, never claiming to be on.
    private var abPill: some View {
        let held = editor.compareOn && editor.activeTool.suspendsCompare
        let on = editor.compareOn && !held
        return Button {
            editor.setCompareOn(!editor.compareOn)
        } label: {
            Text("A/B")
                .font(Brand.mono(10))
                .kerning(0.6)
                .padding(.horizontal, 8)
                .frame(height: height)
                .foregroundStyle(held ? palette.faint : (on ? palette.accentInk : palette.muted))
                .background(on ? palette.accentWash : (held ? palette.paper2 : palette.surface),
                            in: RoundedRectangle(cornerRadius: Brand.controlRadius - 2))
                .overlay(
                    RoundedRectangle(cornerRadius: Brand.controlRadius - 2)
                        .strokeBorder(on ? palette.accent : palette.lineStrong,
                                      style: StrokeStyle(lineWidth: 1, dash: held ? [3, 2] : []))
                )
        }
        .buttonStyle(.plain)
        .help(held
              ? "Before / after — suspended while a tool has the pointer; the divider comes back where it was"
              : (on ? "Before / after — the divider is on, and a drag across the picture places it"
                    : "Before / after — off: the whole picture is shown corrected"))
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}
