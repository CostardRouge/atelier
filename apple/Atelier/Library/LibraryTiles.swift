// The Library's rows and tiles — the web's `AssetRow`, `AssetTile` and `Cover`
// (`AssetSidebar.tsx`) and `WinnowTile` (`WinnowScopeGrid.tsx`).
//
// - A ROW (the docked column, a library): a tick, an 80×56 cover that is its
//   own target — LOOKING at a picture and putting it to WORK are two verbs —,
//   the name, the facts line (`JPEG + DNG · 20.7 MB`, the shooting rate when
//   the log measured one), the kind chip, and ✕ under the pointer.
// - A TILE (the phone's sheet, a picker): the picture is the big target and
//   SETS it; looking at it large moves to a corner (⤢). No name column, no
//   tick: the pool's tick decides nothing in a tool that reads the ACTIVE
//   asset, and a name is not what tells two frames of one moment apart.
// - An INSTANCE tile: the instance's thumbnail (`WinnowThumbView`, which
//   retries), ▶ and `srt` on a clip, ✓ when it is in the pool — drawn on the
//   active tile too, in the accent: two independent facts are drawn
//   independently (`architecture.md`) —, Winnow's culling in its corner
//   (read-only), and the row's fetch as a hairline on its bottom edge
//   (`TaskEdge`, the task being scoped `<host>/<id>`), under `fetching…`.
// - Every one of them is the handle of a DRAG onto a tool (`assetDragSource`);
//   a cover is read when its row scrolls into view, never before.
// - Pixel heights, never an aspect ratio, on a grid tile (`frontend.md`).

import SwiftUI
import AtelierKit

/// What dragging a pool asset carries: the picture is here, so the drop gets
/// its file at once — the image, else the clip.
@MainActor
func libraryDragItem(_ asset: Asset, library: LibraryStore) -> AssetDragItem? {
    guard asset.parts.image != nil || asset.parts.video != nil else { return nil }
    return AssetDragItem(key: libraryDragKey(asset.id), label: asset.baseName, origin: .library,
                         resolve: { library.dropped(asset) })
}

/// A small fact laid ON a picture — a cadence, a `+DNG`.
private struct CoverChip: View {
    let text: String
    @Environment(\.palette) private var palette

    var body: some View {
        Text(text.uppercased())
            .font(Brand.mono(8))
            .kerning(0.4)
            .foregroundStyle(palette.onMedia)
            .padding(.horizontal, 4)
            .padding(.vertical, 1)
            .background(Color.black.opacity(0.62), in: RoundedRectangle(cornerRadius: 4))
    }
}

// MARK: - a row of the docked column

struct LibraryAssetRow: View {
    let asset: Asset
    let selected: Bool
    let active: Bool
    let usable: Bool
    let onToggle: () -> Void
    let onActivate: () -> Void
    /// Look at it large; nil when there is nothing to look at (a lone `.srt`).
    let onPreview: (() -> Void)?
    let onRemove: () -> Void

    @Environment(LibraryStore.self) private var library
    @Environment(\.palette) private var palette
    @State private var hovering = false

    var body: some View {
        let cover = library.covers[asset.id]
        let timing = cover?.facts.timing
        let scale = timing?.scale
        let cadence = scale.flatMap { isRealtime($0) ? nil : timeScaleTag($0) }
        let fps = coverFpsText(timing)
        let isPhoto = asset.kind == .photo
        HStack(spacing: 10) {
            Button(action: onToggle) {
                Image(systemName: selected ? "checkmark.square.fill" : "square")
                    .foregroundStyle(selected ? palette.ink : palette.faint)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Select \(asset.baseName)")
            coverView(cover, chip: cadence ?? (isPhoto ? libraryPairTag(asset.parts) : nil), fps: fps)
            Button(action: onActivate) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(asset.baseName)
                        .font(Brand.sans(12, weight: .medium))
                        .foregroundStyle(palette.ink)
                        .lineLimit(1)
                    Text(assetFactsLine(asset, cover?.facts))
                        .font(Brand.mono(10))
                        .foregroundStyle(palette.muted)
                        .lineLimit(1)
                    KindChip(kind: asset.kind)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(!usable)
            .help(helpText(cover?.facts.timing, fps))
            if removeShown {
                Button(action: onRemove) {
                    Text("✕").font(Brand.sans(11)).foregroundStyle(palette.faint)
                }
                .buttonStyle(.plain)
                .help("Remove from library")
                .accessibilityLabel("Remove \(asset.baseName)")
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(active || selected || hovering ? palette.surface : Color.clear,
                    in: RoundedRectangle(cornerRadius: 11))
        .overlay(
            RoundedRectangle(cornerRadius: 11)
                .strokeBorder(active ? palette.accent : (selected ? palette.lineStrong : Color.clear),
                              lineWidth: active ? 2 : 1)
        )
        .opacity(usable ? 1 : 0.45)
        .onHover { hovering = $0 }
        .onAppear { library.ensureCover(asset.id) }
        .assetDragSource(usable ? libraryDragItem(asset, library: library) : nil)
        .contextMenu {
            if let onPreview { Button("Look at \(asset.baseName)", action: onPreview) }
            Button("Use in this tool", action: onActivate).disabled(!usable)
            Divider()
            Button("Remove from library", role: .destructive, action: onRemove)
        }
    }

    private var removeShown: Bool {
        #if os(macOS)
        return hovering
        #else
        return false
        #endif
    }

    private func helpText(_ timing: TimeScaleReading?, _ fps: String?) -> String {
        let use = usable ? "Use \(asset.baseName) in this tool" : "\(asset.baseName) — not usable by this tool"
        let cadence = cadenceSentence(timing, fps)
        return cadence.isEmpty ? use : "\(use) — \(cadence)"
    }

    /// The same 80×56 frame for every row: a portrait clip pillarboxes here
    /// too, and every title starts at the same x.
    @ViewBuilder
    private func coverView(_ cover: LibraryCover?, chip: String?, fps: String?) -> some View {
        let frame = ZStack {
            palette.frame
            if let thumb = cover?.thumbnail {
                Image(decorative: thumb, scale: 1, orientation: .up)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
            } else {
                Text(asset.kind == .photo ? (cover?.facts.imageType ?? "◇") : "▶")
                    .font(Brand.mono(9))
                    .foregroundStyle(palette.muted)
            }
        }
        .frame(width: 80, height: 56)
        .clipShape(RoundedRectangle(cornerRadius: 4))
        .overlay(alignment: .topLeading) { if let chip { CoverChip(text: chip).padding(3) } }
        .overlay(alignment: .bottomLeading) { if let fps { CoverChip(text: fps).padding(3) } }
        if let onPreview {
            Button(action: onPreview) { frame }
                .buttonStyle(.plain)
                .help(usable ? "Look at \(asset.baseName) — or drag the row onto the picture" : "Look at \(asset.baseName)")
                .accessibilityLabel("Look at \(asset.baseName)")
        } else {
            frame
        }
    }
}

/// The kind chip under a row's facts, in the paper palette's washes.
private struct KindChip: View {
    let kind: AssetKind
    @Environment(\.palette) private var palette

    var body: some View {
        Text(assetKindLabel(kind).uppercased())
            .font(Brand.mono(8))
            .kerning(0.5)
            .foregroundStyle(ink)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(ink.opacity(0.4), lineWidth: 1))
    }

    private var ink: Color {
        switch kind {
        case .videoTelemetry: return palette.ok
        case .video: return palette.warn
        case .photo: return palette.danger
        default: return palette.inkSoft
        }
    }
}

// MARK: - a tile of the sheet

struct LibraryAssetTile: View {
    let asset: Asset
    let active: Bool
    let usable: Bool
    let onActivate: () -> Void
    let onPreview: (() -> Void)?

    @Environment(LibraryStore.self) private var library
    @Environment(\.palette) private var palette

    var body: some View {
        let cover = library.covers[asset.id]
        let pair = asset.parts.video == nil ? libraryPairTag(asset.parts) : nil
        ZStack(alignment: .bottomLeading) {
            Button(action: onActivate) {
                ZStack {
                    palette.paper2
                    if let thumb = cover?.thumbnail {
                        Image(decorative: thumb, scale: 1, orientation: .up)
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                    } else {
                        Text(asset.parts.video != nil ? "▶" : (cover?.facts.imageType ?? "◇"))
                            .font(Brand.mono(9))
                            .foregroundStyle(palette.muted)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .clipped()
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(!usable)
            // The tile is the picture's name here, so the name goes on the tile.
            Text(asset.baseName)
                .font(Brand.mono(8))
                .foregroundStyle(palette.onMedia)
                .lineLimit(1)
                .padding(.horizontal, 4)
                .padding(.bottom, 2)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(LinearGradient(colors: [.clear, Color.black.opacity(0.6)], startPoint: .top, endPoint: .bottom))
                .allowsHitTesting(false)
        }
        .frame(height: 66)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(alignment: .topLeading) { if let pair { CoverChip(text: pair).padding(3).allowsHitTesting(false) } }
        .overlay(alignment: .topTrailing) {
            if let onPreview {
                Button(action: onPreview) {
                    Image(systemName: "arrow.up.left.and.arrow.down.right")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(palette.inkSoft)
                        .frame(width: 24, height: 24)
                        .background(palette.surface.opacity(0.85), in: RoundedRectangle(cornerRadius: 6))
                }
                .buttonStyle(.plain)
                .padding(2)
                .accessibilityLabel("Look at \(asset.baseName)")
            }
        }
        .overlay {
            if active {
                RoundedRectangle(cornerRadius: 10).strokeBorder(palette.accent, lineWidth: 2).allowsHitTesting(false)
            }
        }
        .opacity(usable ? 1 : 0.45)
        .onAppear { library.ensureCover(asset.id) }
        .assetDragSource(usable ? libraryDragItem(asset, library: library) : nil)
        .help(usable ? "Use \(asset.baseName) here" : "\(asset.baseName) — not usable by this tool")
    }
}

// MARK: - an instance's tile

struct LibraryInstanceTile: View {
    let row: WinnowAssetRow
    let client: WinnowClient
    /// The instance's host — the row's task scope is `<host>/<id>`.
    let host: String
    /// In the pool already.
    let have: Bool
    /// The tool's active asset.
    let active: Bool
    /// This row is being fetched.
    let fetching: Bool
    let disabled: Bool
    /// Looking at it (browse) or fetching it (pick) — the tool decides.
    let looks: Bool
    let dragItem: AssetDragItem?
    let onTap: () -> Void

    @Environment(\.palette) private var palette

    var body: some View {
        Button(action: onTap) {
            WinnowThumbView(client: client, id: row.id, label: row.mediaType == .video ? "video" : "photo")
                .frame(maxWidth: .infinity)
                .frame(height: 74)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .strokeBorder(active ? palette.accent : (have ? palette.lineStrong : palette.line), lineWidth: active ? 2 : 1)
        )
        .overlay(alignment: .topLeading) {
            if row.mediaType == .video {
                CoverChip(text: row.hasTelemetry ? "▶ srt" : "▶").padding(4).allowsHitTesting(false)
            }
        }
        .overlay(alignment: .bottomTrailing) {
            if have {
                Text("✓")
                    .font(.system(size: 8, weight: .bold))
                    .foregroundStyle(active ? palette.paper : palette.ink)
                    .frame(width: 14, height: 14)
                    .background(active ? palette.accent : palette.paper, in: Circle())
                    .overlay(Circle().stroke(active ? palette.accent : palette.lineStrong, lineWidth: 1))
                    .padding(4)
                    .help("In the library")
                    .allowsHitTesting(false)
            }
        }
        .overlay(alignment: .topTrailing) {
            WinnowCullMark(culling: cullingFromRow(row), onMedia: true)
                .padding(3)
                .allowsHitTesting(false)
        }
        .overlay {
            if fetching {
                ZStack {
                    Color.black.opacity(0.55)
                    Text("fetching…").font(Brand.mono(9)).foregroundStyle(palette.onMedia)
                }
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .allowsHitTesting(false)
            }
        }
        // The row's fetch — its bytes against its weight — on the tile's edge.
        .overlay { TaskEdge(scope: "\(host)/\(row.id)") }
        .assetDragSource(dragItem)
        .help(helpText)
        .accessibilityLabel(row.filename)
        .accessibilityAddTraits(active ? .isSelected : [])
    }

    private var helpText: String {
        var text = "\(looks ? "Look at" : "Use") \(row.filename)"
        if row.hasTelemetry { text += " · flight log" }
        let culled = describeCulling(cullingFromRow(row))
        if !culled.isEmpty { text += " · Winnow: \(culled)" }
        if have { text += " · in the library" }
        if dragItem != nil { text += " — or drag it onto the picture" }
        return text
    }
}
