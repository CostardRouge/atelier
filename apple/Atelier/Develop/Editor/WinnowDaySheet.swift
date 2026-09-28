// One day of the connected Winnow, picked from INSIDE a roll — the web's
// `WinnowDaySheet.tsx` (F3 of `docs/develop-tool.md` §9): the Library is no
// longer the way in.
//
// What it hands back is REFERENCES, made from the instance's rows
// (`rowMediaRef`): nothing is fetched here but the list and the tiles'
// thumbnails, and the roll fetches each picture when it is looked at
// (`RollEditor+Winnow.swift`). Photographs only — a roll develops stills.
// Everything the roll does not hold starts ticked (the hook chooser's rule: a
// person came for the day), and what it holds is shown and cannot be ticked
// twice. The day steps with ‹ ›, or is picked in the platform's own date
// field; the list is ONE request, capped at 400 rows, re-asked per day.

import SwiftUI
import AtelierKit

/// One photograph of the day, and whether the roll holds it already.
struct DayPhoto {
    let row: WinnowAssetRow
    let ref: SavedMediaRef
    let onRoll: Bool
}

struct WinnowDaySheet: View {
    /// The day it opens on — the open picture's (`pictureDay`).
    let initialDay: String
    /// The refs already on the roll.
    let held: [SavedMediaRef]
    let onCancel: () -> Void
    let onAdd: ([SavedMediaRef], String) -> Void

    @Environment(ConnectionStore.self) private var connections: ConnectionStore?
    @Environment(\.palette) private var palette
    @State private var day: String
    /// Nil while asking.
    @State private var rows: [WinnowAssetRow]?
    @State private var problem: RowsProblem?
    @State private var ticked: Set<Int> = []
    @State private var generation = 0

    init(initialDay: String, held: [SavedMediaRef], onCancel: @escaping () -> Void,
         onAdd: @escaping ([SavedMediaRef], String) -> Void) {
        self.initialDay = initialDay
        self.held = held
        self.onCancel = onCancel
        self.onAdd = onAdd
        _day = State(initialValue: initialDay)
    }

    private var connection: WinnowConnection? { connections?.first }
    private var client: WinnowClient? { connections?.firstClient }

    /// The day's photographs, each with its ref and whether the roll holds it.
    private var photos: [DayPhoto] {
        guard let rows, let host = connection?.id else { return [] }
        let now = nowMillis()
        return rows.filter { $0.mediaType == .photo }.map { row in
            let ref = rowMediaRef(host, row, now: now)
            return DayPhoto(row: row, ref: ref, onRoll: held.contains { sameMediaRef($0, ref) })
        }
    }

    var body: some View {
        let photos = self.photos
        let chosen = photos.filter { !$0.onRoll && ticked.contains($0.row.id) }
        VStack(alignment: .leading, spacing: 12) {
            header
            status(photos, chosen: chosen.count)
            grid(photos)
            Hairline()
            footer(photos, chosen: chosen.map(\.ref))
        }
        .padding(20)
        .frame(minWidth: 320, idealWidth: 700, minHeight: 420, idealHeight: 640)
        .background(palette.surface)
        .presentationDetents([.large])
        .task(id: "\(day)|\(generation)|\(connection?.id ?? "")") { await load() }
    }

    // MARK: - the day

    private var header: some View {
        HStack(spacing: 8) {
            Text("Add from \(connection?.id ?? "your Winnow")")
                .font(Brand.display(24))
                .foregroundStyle(palette.ink)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: 8)
            Button { step(-1) } label: { Image(systemName: "chevron.left") }
                .buttonStyle(.borderless)
                .accessibilityLabel("The day before")
            DatePicker("Day", selection: dateBinding, displayedComponents: .date)
                .labelsHidden()
                .datePickerStyle(.compact)
            Button { step(1) } label: { Image(systemName: "chevron.right") }
                .buttonStyle(.borderless)
                .accessibilityLabel("The day after")
        }
    }

    private var dateBinding: Binding<Date> {
        Binding(
            get: { WinnowDaySheet.date(day) ?? Date() },
            set: { day = todayIso($0, in: .current) }
        )
    }

    private func step(_ by: Int) {
        if let next = addDays(day, by) { day = next }
    }

    /// `YYYY-MM-DD` at local noon — a day in this device's zone.
    static func date(_ iso: String) -> Date? {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return Calendar.current.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12))
    }

    // MARK: - what the instance answered

    private func load() async {
        rows = nil
        problem = nil
        guard !day.isEmpty, let client, let host = connection?.id else { return }
        do {
            let all = try await client.allAssets(AssetQuery(dateFrom: day, dateTo: day), cap: 400)
            if Task.isCancelled { return }
            rows = all
            // A new day starts with everything the roll does not hold ticked.
            let now = nowMillis()
            let free = all.filter { row in
                row.mediaType == .photo && !held.contains { sameMediaRef($0, rowMediaRef(host, row, now: now)) }
            }
            ticked = Set(free.map(\.id))
        } catch is CancellationError {
            return
        } catch {
            if Task.isCancelled { return }
            rows = []
            if (error as? WinnowError)?.kind == .unauthenticated {
                problem = RowsProblem(text: "Not signed in to \(host).", login: client.loginUrl())
            } else {
                let said = (error as? LocalizedError)?.errorDescription ?? String(describing: error)
                problem = RowsProblem(text: deviceWords(said), login: nil)
            }
        }
    }

    private func status(_ photos: [DayPhoto], chosen: Int) -> some View {
        let onRoll = photos.filter(\.onRoll).count
        let line: String
        if connection == nil {
            line = "No Winnow is connected — connect one in Sources."
        } else if rows == nil {
            line = "asking…"
        } else if photos.isEmpty {
            line = "no photographs on this day"
        } else {
            let count = "\(photos.count) photograph\(photos.count == 1 ? "" : "s")"
            line = count + (onRoll > 0 ? " · \(onRoll) already on the roll" : "") + " · \(chosen) ticked"
        }
        return HStack(spacing: 6) {
            Text(line).foregroundStyle(palette.muted)
            if let problem {
                Text("· \(problem.text)").foregroundStyle(palette.danger)
                if let login = problem.login, let url = URL(string: login) {
                    Link("Sign in", destination: url).underline()
                }
                Button("Try again") { generation += 1 }
                    .buttonStyle(.plain)
                    .underline()
            }
        }
        .font(Brand.mono(11))
        .monospacedDigit()
        .lineLimit(2)
    }

    // MARK: - the tiles

    @ViewBuilder
    private func grid(_ photos: [DayPhoto]) -> some View {
        if connection != nil && rows == nil {
            HStack(spacing: 10) {
                ProgressView()
                Text("Asking the instance…").font(Brand.mono(12)).foregroundStyle(palette.muted)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                // Rows pinned in points: a tile grid never lets its rows be sized
                // by what is inside them (`frontend.md`).
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 100), spacing: 8)], spacing: 8) {
                    if let client {
                        ForEach(photos, id: \.row.id) { photo in
                            tile(photo.row, onRoll: photo.onRoll, client: client)
                        }
                    }
                }
            }
            .frame(maxHeight: .infinity)
        }
    }

    private func tile(_ row: WinnowAssetRow, onRoll: Bool, client: WinnowClient) -> some View {
        let on = ticked.contains(row.id)
        return Button {
            if on { ticked.remove(row.id) } else { ticked.insert(row.id) }
        } label: {
            WinnowThumbView(client: client, id: row.id, label: row.ext)
                .frame(height: 100)
                .frame(maxWidth: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: Brand.paperRadius - 4))
                .overlay(
                    RoundedRectangle(cornerRadius: Brand.paperRadius - 4)
                        .strokeBorder(on && !onRoll ? palette.accent : Color.clear, lineWidth: 2)
                )
                .overlay(alignment: .topLeading) { if !onRoll { tick(on) } }
                .overlay(alignment: .bottom) { if onRoll { onRollBand } }
                .opacity(onRoll ? 0.45 : (on ? 1 : 0.7))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(onRoll)
        .help(row.filename)
        .accessibilityLabel("\(row.filename)\(onRoll ? ", already on the roll" : on ? ", ticked" : "")")
    }

    private func tick(_ on: Bool) -> some View {
        Image(systemName: "checkmark")
            .font(.system(size: 9, weight: .bold))
            .foregroundStyle(on ? palette.paper : Color.clear)
            .frame(width: 20, height: 20)
            .background(on ? palette.accent : palette.surface.opacity(0.8), in: Circle())
            .overlay(Circle().stroke(on ? palette.accent : palette.lineStrong, lineWidth: 1))
            .padding(6)
    }

    private var onRollBand: some View {
        Text("on the roll")
            .font(Brand.mono(9))
            .foregroundStyle(palette.onMedia)
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(palette.frame.opacity(0.7))
    }

    // MARK: - the verbs

    private func footer(_ photos: [DayPhoto],
                        chosen: [SavedMediaRef]) -> some View {
        let free = photos.filter { !$0.onRoll }
        let all = !free.isEmpty && chosen.count == free.count
        return HStack(spacing: 14) {
            if !free.isEmpty {
                Button(all ? "Tick none" : "Tick all") {
                    ticked = all ? [] : Set(free.map(\.row.id))
                }
                .buttonStyle(.borderless)
            }
            Spacer()
            Button("Cancel", action: onCancel)
                .keyboardShortcut(.cancelAction)
                .buttonStyle(.borderless)
            Button(chosen.isEmpty ? "Add" : "Add \(chosen.count) to the roll") {
                guard let host = connection?.id, !chosen.isEmpty else { return }
                onAdd(chosen, host)
            }
            .keyboardShortcut(.defaultAction)
            .buttonStyle(.borderedProminent)
            .disabled(chosen.isEmpty)
        }
    }
}

#Preview("A day of the instance") {
    WinnowDaySheet(initialDay: "2026-09-14", held: [], onCancel: {}, onAdd: { _, _ in })
        .environment(ConnectionStore.preview(connections: [(host: "winnow.steeve.website", sheet: ConnectionStore.previewSheet)]))
}
