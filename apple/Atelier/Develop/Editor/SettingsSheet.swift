// The one picker for every verb that carries MORE than the develop — the web's
// `SettingsSheet.tsx` over `picture-sections.ts`: copy (⌘⇧C), paste what was
// copied (⌘⇧V), apply to the marked pictures or to the others, and — read
// the other way — RESET the ticked sections of this picture (one undo step,
// no confirmation). Lightroom's Copy Settings dialog, as one sheet; the
// per-tab Apply-to verbs stay for the one-section gesture.
//
// The ticks are remembered on this device (`atelier.develop.sections`). Each
// row says whether THIS picture has anything in that section, so a copy of an
// untouched section reads as what it is: a reset of the others. Never
// carried: which file a picture is developed from, its RAW base, its title
// and caption, whether it leaves.

import SwiftUI
import AtelierKit

struct SettingsSheet: View {
    @Bindable var editor: RollEditor
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        if let picture = editor.picture {
            content(picture)
        }
    }

    private func content(_ picture: RollPicture) -> some View {
        let edited = sectionsWithEdits(picture)
        let ticked = editor.tickedSections
        let none = ticked.isEmpty
        let selection = editor.selectionTargets.filter { id in
            !(editor.pictures.first { $0.id == id }.map(isIgnored) ?? false)
        }
        let others = editor.otherIds
        return NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if let held = editor.heldSettings {
                        HStack(spacing: 8) {
                            Text("Copied from \(pictureLabel(held.from)): \(labels(held.sections))")
                                .font(Brand.mono(11))
                                .foregroundStyle(palette.inkSoft)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            Button("Paste") { act { editor.pasteSectionsHere() } }
                                .buttonStyle(DevelopPillButtonStyle())
                                .help("Paste ⌘⇧V — these sections onto this picture")
                        }
                        .padding(10)
                        .background(palette.paper2, in: RoundedRectangle(cornerRadius: Brand.controlRadius))
                        .overlay(RoundedRectangle(cornerRadius: Brand.controlRadius).stroke(palette.line, lineWidth: 1))
                    }

                    HStack(spacing: 6) {
                        Eyebrow("Tick")
                        quick("All", pictureSections.map(\.id))
                        quick("Edited here", pictureSections.map(\.id).filter { edited.contains($0) })
                        quick("Shared", defaultCopySections)
                        quick("None", [])
                    }

                    VStack(spacing: 0) {
                        ForEach(pictureSections, id: \.id) { section in
                            row(section, on: ticked.contains(section.id), edited: edited.contains(section.id))
                            Hairline()
                        }
                    }
                    .overlay(alignment: .top) { Hairline() }

                    Text("A ticked section that is as shot here resets it on the pictures it reaches. Never carried: which file a picture is developed from, its RAW base, its title and caption, whether it leaves.")
                        .font(Brand.sans(13))
                        .foregroundStyle(palette.muted)
                        .fixedSize(horizontal: false, vertical: true)

                    verbs(none: none, anyEdited: ticked.contains { edited.contains($0) }, selection: selection, others: others)
                }
                .padding(16)
            }
            .background(palette.surface)
            .navigationTitle("Settings of \(pictureLabel(picture))")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
        #if os(macOS)
        .frame(minWidth: 460, minHeight: 560)
        #endif
    }

    private func row(_ section: PictureSectionInfo, on: Bool, edited: Bool) -> some View {
        Button {
            var next = editor.tickedSections
            if on { next.removeAll { $0 == section.id } } else { next.append(section.id) }
            editor.setTickedSections(next)
        } label: {
            HStack(spacing: 10) {
                Image(systemName: on ? "checkmark.square.fill" : "square")
                    .font(.system(size: 18))
                    .foregroundStyle(on ? palette.accent : palette.lineStrong)
                VStack(alignment: .leading, spacing: 2) {
                    Text(section.label)
                        .font(Brand.sans(15))
                        .foregroundStyle(on ? palette.ink : palette.muted)
                    Text(section.hint)
                        .font(Brand.sans(12))
                        .foregroundStyle(palette.faint)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                Text(edited ? "edited" : "as shot")
                    .font(Brand.mono(10))
                    .foregroundStyle(edited ? palette.accentInk : palette.faint)
            }
            .padding(.vertical, 8)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func quick(_ label: String, _ value: [PictureSection]) -> some View {
        Button(label) { editor.setTickedSections(value) }
            .buttonStyle(DevelopLinkButtonStyle())
    }

    @ViewBuilder
    private func verbs(none: Bool, anyEdited: Bool, selection: [String], others: [String]) -> some View {
        let ticked = editor.tickedSections
        HStack(spacing: 8) {
            Button("Reset") { act { editor.resetSectionsOf(ticked) } }
                .buttonStyle(DevelopLinkButtonStyle())
                .disabled(none || !anyEdited)
                .help("Reset — the ticked sections of this picture back to as shot (⌘Z brings them back)")
            Spacer(minLength: 8)
            Button("Copy") { act { editor.copySectionsOf(ticked) } }
                .buttonStyle(DevelopPillButtonStyle())
                .disabled(none)
                .help("Copy ⌘⇧C — hold these sections for another picture, in this session")
        }
        if !selection.isEmpty || !others.isEmpty {
            HStack(spacing: 8) {
                Spacer(minLength: 0)
                if !selection.isEmpty {
                    Button("Apply to \(selection.count) selected") { act { editor.applySectionsTo(selection, ticked) } }
                        .buttonStyle(DevelopPillButtonStyle())
                        .disabled(none)
                }
                if !others.isEmpty {
                    Button("Apply to \(others.count) other picture\(others.count == 1 ? "" : "s")") {
                        act { editor.applySectionsTo(others, ticked) }
                    }
                    .buttonStyle(DevelopPillButtonStyle())
                    .disabled(none)
                    .help("Every other picture of the roll that is not ignored")
                }
            }
        }
    }

    private func labels(_ sections: [PictureSection]) -> String {
        sections.compactMap { id in pictureSections.first { $0.id == id }?.label }.joined(separator: ", ")
    }

    private func act(_ run: () -> Void) {
        run()
        dismiss()
    }
}
