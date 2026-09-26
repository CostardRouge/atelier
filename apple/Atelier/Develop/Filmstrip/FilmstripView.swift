// The roll as a band under the stage — the web's `Filmstrip.tsx`: the
// pictures in the strip's order, the open one outlined in the accent and kept
// in view as ←/→ step; a plain click OPENS one, Shift or ⌘-click marks it for
// a batch instead (a checkmark, never a second ring that would fight the open
// one). Ignored pictures are dimmed, or left out when the author hides them —
// never the open one: the stage must stay in the strip. Adding is the bar's
// verb, never a second copy here. There is no drag to reorder on the web
// either (`lightroom-gaps.md` item 29 is still open).
//
// On a touch screen, where there is no Shift, the same two gestures are the
// cell's context menu: *Select* and *Select up to here*.

import SwiftUI
import AtelierKit

struct FilmstripView: View {
    @Bindable var editor: RollEditor
    let compact: Bool
    @Environment(\.palette) private var palette

    private var shown: [RollPicture] {
        editor.pictures.filter { $0.id == editor.openId || editor.showIgnored || !isIgnored($0) }
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: 6) {
                    ForEach(shown, id: \.id) { picture in
                        FilmstripCell(editor: editor, picture: picture, size: compact ? 56 : 72)
                            .id(picture.id)
                    }
                }
                // Room for the × badge, which overhangs its cell: a scroller
                // that clips x clips y too.
                .padding(.top, 6)
                .padding(.trailing, 6)
                .padding(.bottom, 4)
                .padding(.leading, 2)
            }
            .onChange(of: editor.openId, initial: true) { _, id in
                guard let id else { return }
                withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(id, anchor: .center) }
            }
        }
        .accessibilityLabel("Pictures on this roll")
    }
}

struct FilmstripCell: View {
    @Bindable var editor: RollEditor
    let picture: RollPicture
    let size: CGFloat

    @Environment(PicturePool.self) private var pool
    @Environment(\.palette) private var palette
    @State private var hovering = false

    private var open: Bool { editor.openId == picture.id }
    private var selected: Bool { editor.visibleSelected.contains(picture.id) }

    var body: some View {
        let edits = pictureEdits(picture)
        let availability = editor.availability(picture)
        let unreachable = availability != .ready && availability != .preview
        let variant = variantNumber(picture)
        let label = pictureLabel(picture)
        ZStack {
            palette.frame
            if let thumb = pool.thumbnails[picture.id] {
                Image(decorative: thumb, scale: 1, orientation: .up)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
                    .frame(width: size, height: size)
                    .clipped()
                    .opacity(unreachable ? 0.45 : 1)
                    .saturation(unreachable ? 0 : 1)
            } else {
                Text(cellWords(availability))
                    .font(Brand.mono(9))
                    .foregroundStyle(palette.muted)
                    .multilineTextAlignment(.center)
                    .padding(3)
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: Brand.controlRadius - 3))
        .overlay(
            RoundedRectangle(cornerRadius: Brand.controlRadius - 3)
                .stroke(open ? palette.accent : (hovering ? palette.lineStrong : Color.clear), lineWidth: 2)
        )
        .overlay(alignment: .topLeading) {
            if selected {
                Image(systemName: "checkmark")
                    .font(.system(size: 8, weight: .bold))
                    .foregroundStyle(palette.paper)
                    .frame(width: 16, height: 16)
                    .background(palette.accent, in: Circle())
                    .padding(4)
            }
        }
        .overlay(alignment: .topTrailing) {
            if unreachable && pool.thumbnails[picture.id] != nil {
                Text("!")
                    .font(Brand.mono(9))
                    .foregroundStyle(palette.danger)
                    .frame(width: 16, height: 16)
                    .background(palette.surface, in: Circle())
                    .padding(4)
            }
        }
        .overlay(alignment: .bottomLeading) {
            HStack(spacing: 3) {
                if variant > 1 {
                    Text("\(variant)")
                        .font(Brand.mono(9))
                        .foregroundStyle(palette.ink)
                        .frame(minWidth: 16, minHeight: 16)
                        .background(palette.surface.opacity(0.85), in: Capsule())
                }
                if !edits.isEmpty {
                    Circle().fill(palette.accent).frame(width: 6, height: 6)
                }
            }
            .padding(4)
            .allowsHitTesting(false)
        }
        .overlay(alignment: .bottomTrailing) {
            DeliveryBadge(editor: editor, picture: picture, hovering: hovering)
                .padding(3)
        }
        .overlay(alignment: .topTrailing) {
            removeBadge(label)
        }
        .opacity(isIgnored(picture) && !open ? (hovering ? 0.7 : 0.35) : 1)
        .contentShape(Rectangle())
        .onTapGesture { click() }
        .onHover { hovering = $0 }
        .contextMenu {
            Text(label)
            Button(selected ? "Deselect" : "Select") {
                editor.click(picture.id, SelectionModifiers(metaKey: true))
            }
            Button("Select up to here") {
                editor.click(picture.id, SelectionModifiers(shiftKey: true))
            }
            Divider()
            Button("Take it off the roll…", role: .destructive) { editor.requestRemove(picture) }
        }
        .task(id: picture.id) {
            pool.requestThumbnail(editor.rollId, picture, skipBake: open)
        }
        .help(helpText(edits))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(label)\(edits.isEmpty ? "" : ", developed")\(selected ? ", selected" : "")\(unreachable ? ", not available" : "")")
        .accessibilityAddTraits(open ? .isSelected : [])
    }

    /// A plain click opens; Shift or ⌘ marks for a batch.
    private func click() {
        #if os(macOS)
        let flags = NSEvent.modifierFlags
        let mods = SelectionModifiers(shiftKey: flags.contains(.shift), metaKey: flags.contains(.command),
                                      ctrlKey: flags.contains(.control))
        editor.click(picture.id, mods)
        #else
        editor.click(picture.id, SelectionModifiers())
        #endif
    }

    /// Hover reveals it where a pointer can hover; a touch screen shows it always.
    private var removeShown: Bool {
        #if os(macOS)
        return hovering
        #else
        return true
        #endif
    }

    @ViewBuilder
    private func removeBadge(_ label: String) -> some View {
        if removeShown {
            Button {
                editor.requestRemove(picture)
            } label: {
                Text("×")
                    .font(Brand.mono(11))
                    .foregroundStyle(palette.muted)
                    .frame(width: 20, height: 20)
                    .background(palette.surface, in: Circle())
                    .overlay(Circle().stroke(palette.lineStrong, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .offset(x: 4, y: -4)
            .accessibilityLabel("Take \(label) off the roll")
            .help("Take it off the roll — the file stays where it is")
        }
    }

    /// What an empty cell says, in a word or two — the stage says the rest.
    private func cellWords(_ a: PictureAvailability) -> String {
        switch a {
        case .ready, .preview: return "…"
        case .fetching: return ""
        case .waiting: return "on its instance"
        case .failed: return "not fetched"
        case .gone: return "gone"
        case .unconnected: return "not connected"
        case .local: return "not open"
        }
    }

    /// `+1.2 EV · contrast +10 · look · crop` — the develop's numbers, then every other kind of edit.
    private func helpText(_ edits: [PictureEdit]) -> String {
        let label = pictureLabel(picture)
        let variant = variantNumber(picture) > 1 ? " (a variant)" : ""
        let what: String
        if edits.isEmpty {
            what = "as shot"
        } else {
            let others = edits.filter { $0 != .develop }.map(\.rawValue)
            what = ([describeDevelop(picture.develop)] + others).joined(separator: " · ")
        }
        #if os(macOS)
        let hint = " — Shift or ⌘-click to select for a batch"
        #else
        let hint = ""
        #endif
        return "\(label)\(variant) — \(what)\(hint)"
    }
}

/// The cell's delivery state and the gesture on it: a tap sends ↔ holds
/// (`toggledDelivery`), its menu (a right-click, a held finger) ignores and
/// brings back. Filled means the author decided; dashed means the roll's rule
/// answers. A picture on the rule that stays out — the untouched majority of a
/// big roll — shows its badge only under the pointer (always on a touch
/// screen), so the strip does not wear a hundred grey rings.
struct DeliveryBadge: View {
    @Bindable var editor: RollEditor
    let picture: RollPicture
    let hovering: Bool
    @Environment(\.palette) private var palette

    var body: some View {
        let state = picture.deliver
        let ignored = state == .ignore
        let leaves = delivers(picture)
        let said = ignored ? "ignored" : (leaves ? "leaves" : "held back")
        Button {
            editor.deliver(picture.id, ignored ? .ignore : .toggle)
        } label: {
            Image(systemName: ignored ? "eye.slash" : (leaves ? "arrow.up" : "minus"))
                .font(.system(size: 8, weight: .bold))
                .foregroundStyle(ink(state: state, ignored: ignored, leaves: leaves))
                .frame(width: size, height: size)
                .background(ground(state: state, leaves: leaves), in: Circle())
                .overlay(
                    Circle().strokeBorder(border(state: state, ignored: ignored, leaves: leaves),
                                          style: StrokeStyle(lineWidth: state == .auto && !ignored ? 1.5 : 1,
                                                             dash: state == .auto && !ignored ? [2, 2] : []))
                )
        }
        .buttonStyle(.plain)
        .opacity(visible(state: state, ignored: ignored, leaves: leaves) ? 1 : 0)
        .contextMenu {
            Button(ignored ? "Bring it back" : "Ignore it") { editor.deliver(picture.id, .ignore) }
            if !ignored {
                Button(leaves ? "Hold it back" : "Send it") { editor.deliver(picture.id, .toggle) }
            }
            Button("Back to the roll’s rule") { editor.deliver(picture.id, .auto) }
        }
        .accessibilityLabel("\(pictureLabel(picture)) \(said) — \(ignored ? "bring it back" : (leaves ? "hold it back" : "send it"))")
        .help("\(said.prefix(1).uppercased())\(said.dropFirst())\(state == .auto && !ignored ? " (the roll’s rule: edited pictures leave)" : "") — click to \(ignored ? "bring it back" : (leaves ? "hold it back" : "send it"))")
    }

    private var size: CGFloat {
        #if os(macOS)
        return 18
        #else
        return 24
        #endif
    }

    private func visible(state: DeliverState, ignored: Bool, leaves: Bool) -> Bool {
        if ignored || leaves || state == .no { return true }
        #if os(macOS)
        return hovering
        #else
        return true
        #endif
    }

    private func ink(state: DeliverState, ignored: Bool, leaves: Bool) -> Color {
        if ignored { return palette.muted }
        if leaves { return state == .yes ? palette.onMedia : palette.accentInk }
        return state == .no ? palette.inkSoft : palette.muted
    }

    private func ground(state: DeliverState, leaves: Bool) -> Color {
        leaves && state == .yes ? palette.accent : palette.surface.opacity(0.85)
    }

    private func border(state: DeliverState, ignored: Bool, leaves: Bool) -> Color {
        if ignored { return palette.lineStrong }
        if leaves { return palette.accent }
        return state == .no ? palette.inkSoft : palette.lineStrong
    }
}
