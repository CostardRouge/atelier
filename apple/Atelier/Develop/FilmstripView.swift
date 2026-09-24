// The filmstrip: the roll's pictures in order, the open one outlined in the
// accent, each thumbnail rendered as shot and kept for the roll's life.

import SwiftUI
import AtelierKit

struct FilmstripView: View {
    @Bindable var editor: RollEditor
    @Environment(\.palette) private var palette

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: 8) {
                    ForEach(editor.pictures, id: \.id) { picture in
                        FilmstripCell(editor: editor, picture: picture)
                            .id(picture.id)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
            }
            .onChange(of: editor.selectedId) { _, id in
                if let id { withAnimation { proxy.scrollTo(id, anchor: .center) } }
            }
        }
        .background(palette.paper2)
    }
}

private struct FilmstripCell: View {
    @Bindable var editor: RollEditor
    let picture: RollPicture
    @Environment(\.palette) private var palette

    private var selected: Bool { editor.selectedId == picture.id }

    var body: some View {
        ZStack {
            palette.frame
            if let thumb = editor.thumbnails[picture.id] {
                Image(decorative: thumb, scale: 1, orientation: .up)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            } else {
                ProgressView().controlSize(.small).tint(palette.onMedia)
            }
        }
        .frame(width: 96, height: 68)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay(alignment: .bottomLeading) {
            if isEdited(picture) {
                Circle().fill(palette.accent).frame(width: 6, height: 6).padding(5)
            }
        }
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .stroke(selected ? palette.accent : palette.line, lineWidth: selected ? 2 : 1)
        )
        .contentShape(Rectangle())
        .onTapGesture { editor.select(picture.id) }
        .task(id: picture.id) { await editor.loadThumbnail(picture.id) }
        .contextMenu {
            Text(picture.ref.name)
            Button("Remove from roll", role: .destructive) { editor.remove(picture.id) }
        }
        .accessibilityLabel(picture.ref.name)
    }
}
