// A new roll in one sheet — the web's `NewRollModal.tsx`: a NAME to replace,
// never a blank to fill in (`Roll · 15 Sep`, selected on entry so typing
// replaces it); where it is KEPT — asked only when a second source can keep
// rolls, the trip and project pickers' rule; and whether it starts with the
// photos already ticked in the Library, which is how most rolls begin (on by
// default whenever something is ticked).

import SwiftUI
import AtelierKit

/// `Roll · 15 Sep` — also what a roll started from one picture is called.
func defaultRollName(_ now: Date = Date()) -> String {
    "Roll · \(now.formatted(.dateTime.day().month(.abbreviated)))"
}

/// What the sheet hands over — the web's `NewRollChoices`.
struct NewRollChoices: Equatable {
    var name: String
    var sourceId: String
    /// Start with the photos ticked in the Library.
    var withTicked: Bool
}

struct NewRollSheet: View {
    /// The sources that can keep a roll; the picker shows only with two.
    var sources: [SourceInfo] = []
    /// How many photographs the Library has ticked.
    var tickedCount = 0
    let onCreate: (NewRollChoices) -> Void
    let onCancel: () -> Void

    @Environment(\.palette) private var palette
    @State private var name = defaultRollName()
    @State private var sourceId = defaultSourceId
    @State private var withTicked = true
    @FocusState private var focused: Bool

    private var trimmed: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 4) {
                Text("New roll")
                    .font(Brand.display(28))
                    .foregroundStyle(palette.ink)
                Text("The photographs you mean to develop, each keeping its own light and colour.")
                    .font(Brand.sans(15))
                    .foregroundStyle(palette.muted)
            }
            VStack(alignment: .leading, spacing: 6) {
                Eyebrow("Name")
                TextField("Name", text: $name)
                    .textFieldStyle(.roundedBorder)
                    .font(Brand.sans(16))
                    .focused($focused)
                    .onSubmit(create)
            }
            if sources.count > 1 {
                keepOn
            }
            ticked
            Hairline()
            HStack(spacing: 16) {
                Spacer()
                Button("Cancel", action: onCancel)
                    .keyboardShortcut(.cancelAction)
                    .buttonStyle(.borderless)
                Button("Create roll", action: create)
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.borderedProminent)
                    .disabled(trimmed.isEmpty)
            }
        }
        .padding(24)
        .frame(minWidth: 320, idealWidth: 416)
        .background(palette.surface)
        .presentationDetents([.medium, .large])
        .onAppear { focused = true }
    }

    private var keepOn: some View {
        VStack(alignment: .leading, spacing: 6) {
            Eyebrow("Keep on")
            Picker("Keep on", selection: $sourceId) {
                ForEach(sources, id: \.id) { source in
                    Text(source.id == defaultSourceId ? "this device (local)" : source.label).tag(source.id)
                }
            }
            .labelsHidden()
            .pickerStyle(.menu)
            .font(Brand.sans(15))
        }
    }

    private var ticked: some View {
        Toggle(isOn: Binding(get: { withTicked && tickedCount > 0 }, set: { withTicked = $0 })) {
            Text(tickedCount == 0
                 ? "Nothing ticked in the Library — add pictures once it is open"
                 : "Start with the \(tickedCount == 1 ? "photo" : "\(tickedCount) photos") ticked in the Library")
                .font(Brand.sans(14))
                .foregroundStyle(tickedCount == 0 ? palette.faint : palette.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
        .disabled(tickedCount == 0)
        #if os(macOS)
        .toggleStyle(.checkbox)
        #endif
    }

    private func create() {
        guard !trimmed.isEmpty else { return }
        onCreate(NewRollChoices(name: trimmed, sourceId: sourceId, withTicked: withTicked && tickedCount > 0))
    }
}

#Preview("New roll") {
    NewRollSheet(sources: [localSource], tickedCount: 3, onCreate: { _ in }, onCancel: {})
}
