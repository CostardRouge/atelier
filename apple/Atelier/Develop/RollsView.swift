// The Develop tool's door: the rolls this device keeps, newest first.

import SwiftUI
import AtelierKit

struct RollsView: View {
    @Environment(RollStore.self) private var store
    @Environment(\.palette) private var palette
    @State private var renaming: RollDoc?
    @State private var newName = ""

    var body: some View {
        Group {
            if store.rolls.isEmpty {
                ContentUnavailableView {
                    Label("No roll yet", systemImage: "camera.aperture")
                } description: {
                    Text("A roll is a set of pictures, each with its own develop, crop and look — the same document the web app keeps, so one made here opens there.")
                } actions: {
                    Button("New roll") { newRoll() }
                        .buttonStyle(.borderedProminent)
                }
            } else {
                List {
                    ForEach(store.rolls, id: \.id) { roll in
                        NavigationLink(value: roll.id) {
                            RollRow(roll: roll)
                        }
                        .contextMenu {
                            Button("Rename…") { startRenaming(roll) }
                            Button("Delete", role: .destructive) { store.delete(roll.id) }
                        }
                    }
                    .onDelete { offsets in
                        for i in offsets { store.delete(store.rolls[i].id) }
                    }
                }
                .listStyle(.plain)
            }
        }
        .navigationTitle("Develop")
        .navigationDestination(for: String.self) { id in
            RollView(rollId: id)
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { newRoll() } label: { Label("New roll", systemImage: "plus") }
            }
        }
        .alert("Rename roll", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Name", text: $newName)
            Button("Rename") {
                if let roll = renaming { store.rename(roll.id, to: newName) }
                renaming = nil
            }
            Button("Cancel", role: .cancel) { renaming = nil }
        }
    }

    private func newRoll() {
        let count = store.rolls.count + 1
        store.create(name: "Roll \(count)")
    }

    private func startRenaming(_ roll: RollDoc) {
        newName = roll.name
        renaming = roll
    }
}

private struct RollRow: View {
    let roll: RollDoc
    @Environment(\.palette) private var palette

    var body: some View {
        let progress = rollProgress(roll)
        VStack(alignment: .leading, spacing: 3) {
            Text(roll.name)
                .font(Brand.display(20))
                .foregroundStyle(palette.ink)
            HStack(spacing: 6) {
                Text(progress.total == 0 ? "Empty" : "\(progress.developed) of \(progress.total) developed")
                if progress.ignored > 0 {
                    Text("·")
                    Text("\(progress.ignored) set aside")
                }
                Text("·")
                Text(Date(timeIntervalSince1970: roll.updatedAt / 1000), style: .relative)
            }
            .font(Brand.mono(11))
            .foregroundStyle(palette.muted)
        }
        .padding(.vertical, 4)
    }
}
