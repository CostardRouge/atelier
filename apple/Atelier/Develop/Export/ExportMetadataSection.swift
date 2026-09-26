// What a delivered file SAYS beyond its pixels — the web's `MetadataSection.tsx`
// (`docs/lightroom-gaps.md` §9, M1–M4): the signature, always; what leaves,
// chosen for the whole roll in groups, with its one cost said aloud (the
// camera's block copied whole only while every capture group stays); the
// author's rights from an IDENTITY kept with the preset book, so every device
// signs the same way; and the picture's own title and caption.
//
// Every field is typed into a DRAFT and written when it is left or on Return:
// the book is a document, and a name is not worth a write per keystroke; a
// picture's words are one undo step per field left.

import SwiftUI
import AtelierKit

struct ExportMetadataSection: View {
    @Bindable var editor: RollEditor
    @Environment(\.palette) private var palette
    @State private var creator = ""
    @State private var copyright = ""
    @FocusState private var focus: Field?

    enum Field: Hashable {
        case creator, copyright
    }

    static let info = [
        "Every file leaves signed: its EXIF Software and its XMP CreatorTool say \(atelierSoftware). That mark is also how Atelier recognises its own exports beside the originals, so it is not a switch.",
        "What leaves is chosen for the whole roll, in groups: All keeps everything (the GPS included), Share online drops the position and the serial numbers, Minimal writes your rights and the signature alone. While every group of the capture is kept, the camera’s EXIF is copied whole; leaving one out rebuilds it from the fields Atelier reads, and the maker notes stay behind. A HEIC carries what the system’s writer maps, which may leave the maker notes behind too.",
        "The place name is read from the picture’s own GPS against the city index that ships with Atelier — nothing is sent anywhere — and written as XMP photoshop:City / Country, even when the position itself is left out. A town is named only within 30 km; farther out only the country is, and the run says which pictures got no town.",
        "A picture’s title and caption are its own — written as XMP dc:title and dc:description, the caption also as EXIF ImageDescription, which Lightroom and Capture One show as the caption. No preset, paste or “apply to” carries them.",
        "Your name and copyright are written into every file as EXIF Artist / Copyright and XMP dc:creator / dc:rights, over whatever the camera carried. They are kept with your presets, so another device signs the same way. In the line, {year} is the year the picture was TAKEN and {creator} your name. Nothing is written until you give a name.",
    ]

    var body: some View {
        let choice = editor.metaChoice
        let rights = resolveRights(DeliveryIdentity(creator: creator, copyright: copyright), editor.openCaptureYear)
        DevelopSection(id: "metadata", title: "Metadata", info: ExportMetadataSection.info) {
            WhatLeaves(editor: editor, choice: choice)
            ExportRow("Creator") {
                TextField("Your name", text: $creator)
                    .textFieldStyle(.roundedBorder)
                    .font(Brand.sans(13))
                    .focused($focus, equals: .creator)
                    .onSubmit { commitIdentity() }
            }
            ExportRow("Copyright") {
                VStack(alignment: .leading, spacing: 3) {
                    TextField(defaultCopyrightTemplate, text: $copyright)
                        .textFieldStyle(.roundedBorder)
                        .font(Brand.sans(13))
                        .focused($focus, equals: .copyright)
                        .onSubmit { commitIdentity() }
                    if let line = rights.copyright {
                        ExportHint("Reads \(line)\(editor.pool.exif[editor.openId ?? ""]?.dateTimeOriginal != nil ? " on this picture" : "")")
                    } else {
                        ExportHint("Written once a creator is set.")
                    }
                }
            }
            if let picture = editor.picture {
                PictureWords(editor: editor, picture: picture, written: choice.words)
                    .id(picture.id)
            }
        }
        .onAppear { seed(editor.deliveryIdentity) }
        .onChange(of: editor.deliveryIdentity) { _, stored in
            // The book loads after the view, and another device may write it:
            // follow it unless a name is being typed.
            if focus == nil { seed(stored) }
        }
        .onChange(of: focus) { before, now in
            editor.textEditing = now != nil
            if before != nil && now != before { commitIdentity() }
        }
    }

    private func seed(_ identity: DeliveryIdentity) {
        creator = identity.creator
        copyright = identity.copyright
    }

    private func commitIdentity() {
        let name = creator.trimmingCharacters(in: .whitespacesAndNewlines)
        let line = copyright.trimmingCharacters(in: .whitespacesAndNewlines)
        let next = DeliveryIdentity(creator: name, copyright: line.isEmpty ? defaultCopyrightTemplate : line)
        seed(next)
        if !sameIdentity(next, editor.deliveryIdentity) { editor.presets.setIdentity(next) }
    }
}

/// The roll's choice of what leaves: three presets, and the groups one row
/// each — the whole row the target, as in the Pictures table. The signature is
/// drawn among them, ticked and locked, so its absent switch does not read as
/// an oversight.
private struct WhatLeaves: View {
    @Bindable var editor: RollEditor
    let choice: MetaChoice
    @Environment(\.palette) private var palette

    var body: some View {
        let preset = presetOf(choice)
        VStack(alignment: .leading, spacing: 8) {
            ExportRow("Leaves") {
                Picker("What leaves", selection: Binding(get: { preset?.rawValue ?? "custom" }, set: { id in
                    guard let next = metaPresets.first(where: { $0.id.rawValue == id }) else { return }
                    editor.setMetaChoice(next.choice)
                })) {
                    ForEach(metaPresets, id: \.id) { p in
                        Text(p.label).tag(p.id.rawValue)
                    }
                    if preset == nil {
                        Text("Custom").tag("custom")
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            }
            VStack(alignment: .leading, spacing: 0) {
                Hairline()
                ForEach(metaGroups, id: \.id) { group in
                    GroupRow(label: group.label, hint: group.hint, on: choice[group.id], locked: false) {
                        var next = choice
                        next[group.id].toggle()
                        editor.setMetaChoice(next)
                    }
                }
                GroupRow(label: "Signature", hint: "\(atelierSoftware) — always written", on: true, locked: true) {}
            }
            ExportHint(keepsWholeBlock(choice)
                ? "The camera’s own EXIF travels whole, maker notes included."
                : "The camera’s EXIF is rebuilt from its fields: the maker notes, the serial numbers and every tag Atelier does not name stay behind.")
            if editor.exportRun.format == .heic {
                ExportHint("A HEIC carries what the system’s writer maps — the maker notes may stay behind.", tone: .warn)
            }
        }
    }
}

private struct GroupRow: View {
    let label: String
    let hint: String
    let on: Bool
    let locked: Bool
    let toggle: () -> Void
    @Environment(\.palette) private var palette

    var body: some View {
        HStack(spacing: 10) {
            ZStack {
                RoundedRectangle(cornerRadius: 5)
                    .fill(on ? (locked ? palette.lineStrong : palette.accent) : Color.clear)
                RoundedRectangle(cornerRadius: 5)
                    .stroke(on ? (locked ? palette.lineStrong : palette.accent) : palette.lineStrong, lineWidth: 2)
                if on {
                    Image(systemName: "checkmark")
                        .font(Brand.sans(10, weight: .bold))
                        .foregroundStyle(palette.onMedia)
                }
            }
            .frame(width: 20, height: 20)
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(label)
                    .font(Brand.sans(13))
                    .foregroundStyle(on ? palette.ink : palette.muted)
                Text(hint)
                    .font(Brand.sans(11))
                    .foregroundStyle(palette.faint)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 6)
        .frame(minHeight: 44)
        .overlay(alignment: .bottom) { Hairline() }
        .contentShape(Rectangle())
        .onTapGesture {
            if !locked { toggle() }
        }
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel(label)
        .accessibilityValue(on ? "leaves" : "left out")
        .help(locked ? "Always written — it is how Atelier knows its own exports" : hint)
    }
}

/// The two words that are the PICTURE's, drafted and written when the field
/// is left — one undo step per field.
private struct PictureWords: View {
    @Bindable var editor: RollEditor
    let picture: RollPicture
    /// Whether the roll writes them — *Title and caption* ticked.
    let written: Bool
    @State private var title = ""
    @State private var caption = ""
    @FocusState private var focus: Word?
    @Environment(\.palette) private var palette

    enum Word: Hashable {
        case title, caption
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ExportRow("Title") {
                TextField("This picture’s title", text: $title)
                    .textFieldStyle(.roundedBorder)
                    .font(Brand.sans(13))
                    .focused($focus, equals: .title)
                    .onSubmit { commit() }
            }
            ExportRow("Caption") {
                VStack(alignment: .leading, spacing: 3) {
                    TextField("What it shows, where, who", text: $caption, axis: .vertical)
                        .textFieldStyle(.roundedBorder)
                        .font(Brand.sans(13))
                        .lineLimit(3...6)
                        .focused($focus, equals: .caption)
                    if !written {
                        ExportHint("Kept on the picture, not written: Title and caption is off for this roll.")
                    }
                }
            }
        }
        .onAppear { follow() }
        .onChange(of: picture.title) { _, _ in if focus == nil { follow() } }
        .onChange(of: picture.caption) { _, _ in if focus == nil { follow() } }
        .onChange(of: title) { _, next in if next.count > 200 { title = String(next.prefix(200)) } }
        .onChange(of: caption) { _, next in if next.count > 2000 { caption = String(next.prefix(2000)) } }
        .onChange(of: focus) { before, now in
            editor.textEditing = now != nil
            if before != nil && now != before { commit() }
        }
        .onDisappear {
            // Another picture opened while a word was being typed: the words
            // are still this one's.
            guard focus != nil else { return }
            commit()
            editor.textEditing = false
        }
    }

    /// The stored words — an undo, or another device, moves them.
    private func follow() {
        title = picture.title ?? ""
        caption = picture.caption ?? ""
    }

    private func commit() {
        editor.setWords(picture.id, title: title, caption: caption)
    }
}

#Preview("Metadata") {
    ScrollView {
        ExportMetadataSection(editor: ExportPreview.editor())
            .padding(14)
    }
    .frame(width: 360, height: 800)
    .darkroom()
}
