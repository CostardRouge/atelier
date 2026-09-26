// Which pictures an export takes, one ROW per picture — the web's
// `DeliveryTable.tsx` (`docs/lightroom-gaps.md` §10, E2): the run plan's own
// line for each, and a tick. The WHOLE row is the target — 48 points, a
// finger's worth — never the tick alone, which nobody hits on a phone (his
// words). A tap gives the other answer (`toggledDelivery`), ↺ puts a picture
// the author decided back on the roll's rule, › opens it. Ignored pictures
// are folded into their own group at the bottom, a row there bringing the
// picture back into the work — and the group opens by itself when the picture
// on the stage is one of them. The filters are the roll's four and E4's
// *Changed*; Winnow's *Picks* wait for the app's Winnow client.

import CoreGraphics
import SwiftUI
import AtelierKit

/// The table's filters: the roll's four, and E4's — what leaves and was never
/// exported from here, or changed since.
enum ExportTableFilter: String, CaseIterable, Identifiable {
    case all, edited, leaving, held, changed
    var id: String { rawValue }

    var label: String {
        switch self {
        case .all: return "All"
        case .edited: return "Edited"
        case .leaving: return "Leaving"
        case .held: return "Held"
        case .changed: return "Changed"
        }
    }

    func matches(_ p: RollPicture, _ marks: ExportMarks) -> Bool {
        switch self {
        case .all: return matchesDeliveryFilter(p, .all)
        case .edited: return matchesDeliveryFilter(p, .edited)
        case .leaving: return matchesDeliveryFilter(p, .leaving)
        case .held: return matchesDeliveryFilter(p, .held)
        case .changed: return matchesDeliveryFilter(p, .leaving) && needsExport(p, marks)
        }
    }
}

struct ExportPicturesSection: View {
    @Bindable var editor: RollEditor

    static let info = [
        "Which pictures leave. By default the ones you EDITED do; a tap on a row gives the other answer — send a picture you did not touch, hold back one you did — and ↺ puts it back on the rule. P does the same on the picture on the stage, U puts it back on the rule.",
        "An ignored picture (M) is out of the roll’s work: it never leaves, the arrows step over it, “apply to the others” leaves it alone. It is folded at the bottom; a tap there brings it back.",
    ]

    var body: some View {
        DevelopSection(id: "pictures", title: "Pictures", info: ExportPicturesSection.info) {
            ExportPicturesTable(editor: editor)
        }
    }
}

struct ExportPicturesTable: View {
    @Bindable var editor: RollEditor
    @State private var showing: ExportTableFilter = .all
    @State private var ignoredOpen = false
    @Environment(\.palette) private var palette

    var body: some View {
        let pictures = editor.pictures
        let marks = editor.exportMarks
        let lines = editor.runLines
        let shown = pictures.filter { showing.matches($0, marks) }
        let ignored = pictures.filter(isIgnored)
        let openIgnored = ignored.contains { $0.id == editor.openId }
        let unfolded = ignoredOpen || openIgnored
        let leaving = pictures.filter(delivers).count
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                PresetChipFlow(spacing: 5) {
                    ForEach(ExportTableFilter.allCases) { f in
                        filterChip(f)
                    }
                }
                Spacer(minLength: 6)
                Text("\(leaving) of \(pictures.count - ignored.count) leave")
                    .font(Brand.mono(10))
                    .monospacedDigit()
                    .foregroundStyle(palette.faint)
                    .fixedSize()
            }
            VStack(alignment: .leading, spacing: 0) {
                Hairline()
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(shown, id: \.id) { p in
                        row(p, lines: lines, marks: marks)
                    }
                }
                if shown.isEmpty {
                    Text("No picture on this roll answers “\(showing.label)”.")
                        .font(Brand.mono(10))
                        .foregroundStyle(palette.faint)
                        .padding(.vertical, 10)
                }
                if !ignored.isEmpty {
                    Button {
                        ignoredOpen.toggle()
                    } label: {
                        HStack(spacing: 6) {
                            Text(unfolded ? "▾" : "▸")
                            Text("Ignored · \(ignored.count)".uppercased())
                                .kerning(0.8)
                            Spacer(minLength: 0)
                        }
                        .font(Brand.sans(10, weight: .semibold))
                        .foregroundStyle(palette.muted)
                        .frame(minHeight: 36)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityValue(unfolded ? "expanded" : "collapsed")
                    Hairline()
                    if unfolded {
                        LazyVStack(alignment: .leading, spacing: 0) {
                            ForEach(ignored, id: \.id) { p in
                                row(p, lines: lines, marks: marks)
                            }
                        }
                    }
                }
            }
        }
    }

    private func filterChip(_ f: ExportTableFilter) -> some View {
        let on = showing == f
        return Button {
            showing = f
        } label: {
            Text(f.label)
                .font(Brand.mono(10))
                .foregroundStyle(on ? palette.accentInk : palette.muted)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .overlay(Capsule().stroke(on ? palette.accent : palette.lineStrong, lineWidth: 1))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
        .help(f == .changed ? "Leaving, and never exported from this device or edited since" : "Show \(f.label.lowercased())")
    }

    private func row(_ p: RollPicture, lines: [String: String], marks: ExportMarks) -> some View {
        ExportPictureRow(
            picture: p,
            open: p.id == editor.openId,
            line: lines[p.id],
            mark: marks[p.id],
            state: marks[p.id] != nil ? exportState(p, marks) : nil,
            thumb: editor.pool.thumbnails[p.id],
            onAct: { editor.deliver(p.id, isIgnored(p) ? .ignore : .toggle) },
            onRule: { editor.deliver(p.id, .auto) },
            onOpen: { editor.open(p.id) }
        )
        .onAppear { editor.pool.requestThumbnail(editor.rollId, p) }
    }
}

/// One picture's row.
private struct ExportPictureRow: View {
    let picture: RollPicture
    let open: Bool
    let line: String?
    let mark: ExportMark?
    /// E4's word, only once a picture has left from here.
    let state: ExportState?
    let thumb: CGImage?
    let onAct: () -> Void
    let onRule: () -> Void
    let onOpen: () -> Void
    @Environment(\.palette) private var palette

    var body: some View {
        let ignored = picture.deliver == .ignore
        let on = delivers(picture)
        let name = pictureLabel(picture)
        HStack(spacing: 8) {
            tick(ignored: ignored, on: on)
            thumbnail
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(name)
                        .font(Brand.mono(11))
                        .foregroundStyle(on ? palette.ink : palette.faint)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    chips
                }
                if let said = ExportPictureRow.said(line, file: picture.ref.name) {
                    Text(said)
                        .font(Brand.mono(10))
                        .foregroundStyle(on ? palette.inkSoft : palette.faint)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
            if picture.deliver == .yes || picture.deliver == .no {
                Button(action: onRule) {
                    Image(systemName: "arrow.counterclockwise")
                        .font(Brand.sans(13))
                        .foregroundStyle(palette.accentInk)
                        .frame(width: 32, height: 32)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(name): back to the roll’s rule")
                .help("Back to the roll’s rule — edited pictures leave")
            }
            if !open {
                Button(action: onOpen) {
                    Image(systemName: "chevron.right")
                        .font(Brand.sans(12))
                        .foregroundStyle(palette.muted)
                        .frame(width: 32, height: 32)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Open \(name)")
                .help("Open this picture")
            }
        }
        .padding(.leading, open ? 6 : 3)
        .padding(.trailing, 2)
        .frame(minHeight: 48)
        .overlay(alignment: .leading) {
            if open {
                Rectangle().fill(palette.accent).frame(width: 3)
            }
        }
        .overlay(alignment: .bottom) { Hairline() }
        .contentShape(Rectangle())
        .onTapGesture(perform: onAct)
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel("\(name)\(ignored ? ", ignored" : "")")
        .accessibilityValue(on ? "leaves" : "held back")
        .help(ignored ? "Ignored — tap to bring it back into the roll" : on ? "Leaves — tap to hold it back" : "Held back — tap to send it")
    }

    private func tick(ignored: Bool, on: Bool) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 5)
                .fill(on && !ignored ? palette.accent : Color.clear)
            RoundedRectangle(cornerRadius: 5)
                .stroke(on && !ignored ? palette.accent : palette.lineStrong, lineWidth: 2)
            if ignored {
                Image(systemName: "eye.slash")
                    .font(Brand.sans(10, weight: .semibold))
                    .foregroundStyle(palette.faint)
            } else if on {
                Image(systemName: "checkmark")
                    .font(Brand.sans(10, weight: .bold))
                    .foregroundStyle(palette.onMedia)
            }
        }
        .frame(width: 20, height: 20)
        .accessibilityHidden(true)
    }

    @ViewBuilder
    private var thumbnail: some View {
        ZStack {
            palette.frame
            if let thumb {
                Image(decorative: thumb, scale: 1, orientation: .up)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            }
        }
        .frame(width: 40, height: 28)
        .clipShape(RoundedRectangle(cornerRadius: 3))
        .accessibilityHidden(true)
    }

    @ViewBuilder
    private var chips: some View {
        if picture.deliver == .yes || picture.deliver == .no {
            Text(picture.deliver == .yes ? "send" : "hold")
                .font(Brand.mono(9))
                .foregroundStyle(palette.inkSoft)
                .padding(.horizontal, 5)
                .overlay(Capsule().stroke(palette.lineStrong, lineWidth: 1))
        }
        if let mark, state == .changed {
            Text("changed")
                .font(Brand.mono(9))
                .foregroundStyle(palette.accentInk)
                .padding(.horizontal, 5)
                .overlay(Capsule().stroke(palette.accent, lineWidth: 1))
                .help("Exported \(ExportPictureRow.when(mark.at)) — edited since")
        }
        if let mark, state == .current {
            Text("✓ \(ExportPictureRow.when(mark.at))")
                .font(Brand.mono(9))
                .foregroundStyle(palette.faint)
                .help("Exported from this device, unchanged since")
        }
    }

    /// The plan's line without the file's name, which the row already shows:
    /// `name ← …` keeps its arrow — it says where the pixels come from — and
    /// `name — …` loses the dash that only joined the name.
    static func said(_ line: String?, file: String) -> String? {
        guard let line else { return nil }
        guard line.hasPrefix("\(file) ") else { return line }
        var rest = String(line.dropFirst(file.count + 1))
        if rest.hasPrefix("— ") { rest = String(rest.dropFirst(2)) }
        return rest
    }

    private static let timeFormat: DateFormatter = {
        let f = DateFormatter()
        f.dateStyle = .none
        f.timeStyle = .short
        return f
    }()

    private static let dayFormat: DateFormatter = {
        let f = DateFormatter()
        f.setLocalizedDateFormatFromTemplate("d MMM")
        return f
    }()

    /// When a picture last left, as a reader says it: a time today, else a date.
    static func when(_ at: Double, now: Date = Date()) -> String {
        let day = Date(timeIntervalSince1970: at / 1000)
        return Calendar.current.isDate(day, inSameDayAs: now) ? timeFormat.string(from: day) : dayFormat.string(from: day)
    }
}

#Preview("Pictures") {
    ScrollView {
        ExportPicturesSection(editor: ExportPreview.editor())
            .padding(14)
    }
    .frame(width: 360, height: 500)
    .darkroom()
}
